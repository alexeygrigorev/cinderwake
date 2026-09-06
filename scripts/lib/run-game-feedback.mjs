import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { componentReportValid, gameFeedbackVerdict } from "./game-feedback.mjs";
import { buildIssues, renderNextAction } from "./game-feedback-diagnostics.mjs";
import { escapeHtml } from "./feedback.mjs";

const DEFAULT_TIMEOUT_MS = 300_000;

function sourceToken(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normalizedBrowserDiscovery(value) {
  const discovery = value && typeof value === "object" ? value : {};
  return {
    command: discovery.command ?? null,
    report: discovery.report ?? null,
    cases: Array.isArray(discovery.cases) ? discovery.cases : [],
    error: discovery.error ?? null,
  };
}

function validateDefinitions(definitions) {
  if (!Array.isArray(definitions) || !definitions.length)
    throw new Error("At least one feedback component is required");
  const ids = definitions.map((entry) => entry?.id);
  if (
    ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Feedback component IDs must be unique safe file names");
  for (const entry of definitions) {
    if (
      typeof entry.command !== "string" ||
      !Array.isArray(entry.args) ||
      typeof entry.json !== "string" ||
      typeof entry.evidence !== "string"
    )
      throw new Error(`${entry.id}: incomplete feedback component definition`);
  }
}

function reportHtml({ verdict, value, results, sourceStable }) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Game feedback ${verdict}</title><style>body{background:#14191c;color:#e9e1d5;font:17px/1.6 system-ui;max-width:900px;margin:40px auto;padding:20px}a{color:#edc88e}li{margin:20px 0}code{color:#d6ac77}</style><h1>Game feedback: ${verdict}</h1><p>${value.limitation}</p><ul>${results.map((result) => `<li><strong>${escapeHtml(result.id)}: ${result.exitCode === 0 && result.reportValid ? "PASS" : "FAIL"}</strong> · <a href="${result.evidence}">Evidence</a> · <a href="${result.id}.log">Diagnostic log</a>${result.error ? `<p>${escapeHtml(result.error)}</p>` : ""}</li>`).join("")}</ul><p><a href="next-action.md">First-failure handoff</a> · <a href="browser-list.json">Browser manifest</a></p><p>${sourceStable ? "Source fingerprint held constant." : "Source changed. Rerun after edits finish."}</p><p><a href="feedback.json">Machine-readable summary</a></p>`;
}

export async function runGameFeedback({
  componentDefinitions,
  outputDirectory,
  sourceIdentity,
  contract = {},
  browserDiscovery,
  environment = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  validateDefinitions(componentDefinitions);
  if (typeof sourceIdentity !== "function")
    throw new Error("A source identity provider is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000)
    throw new Error("Feedback timeout must be a safe integer from 1–900000 ms");

  const output = path.resolve(outputDirectory);
  await fs.mkdir(output, { recursive: true });
  const definitions = componentDefinitions.map((entry) => ({ ...entry }));
  const discovery = normalizedBrowserDiscovery(browserDiscovery);
  const initialFingerprint = sourceToken(await sourceIdentity());
  const results = [];
  const reports = new Map();
  const reportErrors = new Map();
  let child;
  let interrupted = false;
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      interrupted = true;
      if (child?.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      }
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  const contractValue = {
    version: contract.version ?? 1,
    controls: contract.controls ?? [],
    campaign: contract.campaign ?? [],
    browser: contract.browser ?? discovery.cases,
    browserDiscovery: {
      command: contract.browserDiscovery?.command ?? discovery.command,
      error: contract.browserDiscovery?.error ?? discovery.error,
      evidence: "browser-list.json",
    },
  };

  await fs.writeFile(
    path.join(output, "browser-list.json"),
    `${JSON.stringify(discovery.report ?? { error: discovery.error }, null, 2)}\n`,
  );

  async function writeReports(complete = false) {
    const sourceStable =
      initialFingerprint === sourceToken(await sourceIdentity());
    const runComplete = complete && !interrupted;
    const verdict = gameFeedbackVerdict(
      results,
      runComplete,
      sourceStable,
      definitions.map(({ id }) => id),
    );
    const issues = buildIssues({
      results,
      complete: runComplete,
      sourceStable,
      componentDefinitions: definitions,
      reports,
      reportErrors,
      outputDirectory: output,
      expectedBrowserCases: discovery.cases,
    });
    const value = {
      schemaVersion: 1,
      verdict,
      complete: runComplete,
      sourceStable,
      fingerprint: initialFingerprint,
      contract: contractValue,
      issues,
      results,
      limitation:
        "Automated pilots know the map. PASS is behavioral evidence, not proof of fun, human pacing, or visual quality.",
    };
    await fs.writeFile(
      path.join(output, "feedback.json"),
      `${JSON.stringify(value, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(output, "next-action.md"),
      renderNextAction({
        verdict,
        complete: runComplete,
        sourceStable,
        issues,
        outputDirectory: output,
      }),
    );
    await fs.writeFile(
      path.join(output, "feedback.md"),
      `# Game feedback: ${verdict}\n\n${value.limitation}\n\n${results.map((result) => `- ${result.id}: ${result.exitCode === 0 && result.reportValid ? "PASS" : "FAIL"}; [evidence](${result.evidence}); [log](${result.id}.log)`).join("\n")}\n- Browser test manifest: [browser-list.json](browser-list.json)\n- First-failure handoff: [next-action.md](next-action.md)\n${sourceStable ? "" : "\nSource changed during this run. Repeat after edits finish.\n"}`,
    );
    await fs.writeFile(
      path.join(output, "report.html"),
      reportHtml({ verdict, value, results, sourceStable }),
    );
    return { verdict, value };
  }

  async function runComponent(entry, log) {
    return new Promise((resolve) => {
      child = spawn(entry.command, entry.args, {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: {
          ...environment,
          ...(entry.environment ?? {}),
          PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(output, "browser.json"),
        },
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }, entry.timeoutMs ?? timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({ exitCode: null, error: error.message });
      });
      child.once("exit", (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          ...(timedOut
            ? {
                error:
                  entry.timeoutMs === undefined &&
                  timeoutMs === DEFAULT_TIMEOUT_MS
                    ? "Component exceeded five-minute limit."
                    : `Component exceeded ${entry.timeoutMs ?? timeoutMs} ms limit.`,
              }
            : signal
              ? { error: `Stopped by ${signal}` }
              : {}),
        });
      });
    });
  }

  try {
    await writeReports();
    for (const entry of definitions) {
      if (interrupted) break;
      const log = await fs.open(path.join(output, `${entry.id}.log`), "w");
      const started = Date.now();
      const outcome = await runComponent(entry, log);
      child = undefined;
      await log.close();
      let reportValid = false;
      let parsedReport;
      try {
        const rawReport = await fs.readFile(
          path.join(output, entry.json),
          "utf8",
        );
        try {
          parsedReport = JSON.parse(rawReport);
          reports.set(entry.id, parsedReport);
        } catch (error) {
          reportErrors.set(entry.id, {
            kind: "malformed",
            message: error.message,
          });
        }
      } catch (error) {
        reportErrors.set(entry.id, {
          kind: error.code === "ENOENT" ? "missing" : "read-error",
          message: error.message,
        });
      }
      if (parsedReport !== undefined && !reportErrors.has(entry.id)) {
        try {
          reportValid = await (entry.validateReport
            ? entry.validateReport(parsedReport, {
                expectedBrowserCases: discovery.cases,
              })
            : componentReportValid(entry.id, parsedReport, {
                expectedBrowserCases: discovery.cases,
              }));
        } catch (error) {
          reportErrors.set(entry.id, {
            kind: "malformed",
            message: `Report validation failed: ${error.message}`,
          });
        }
      }
      results.push({
        id: entry.id,
        ...outcome,
        reportValid: reportValid === true,
        evidence: entry.evidence,
        elapsedMs: Date.now() - started,
      });
      await writeReports();
    }
    const final = await writeReports(true);
    return {
      ...final,
      outputDirectory: output,
      results,
      interrupted,
    };
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    }
    for (const [signal, handler] of signalHandlers)
      process.removeListener(signal, handler);
  }
}
