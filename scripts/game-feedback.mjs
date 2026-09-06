import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  componentReportValid,
  gameFeedbackVerdict,
} from "./lib/game-feedback.mjs";
import {
  BROWSER_TEST_FILES,
  CAMPAIGN_CASES,
  CONTROL_CASE_IDS,
  collectBrowserCases,
} from "./lib/game-feedback-contract.mjs";
import {
  buildIssues,
  renderNextAction,
} from "./lib/game-feedback-diagnostics.mjs";
import { escapeHtml } from "./lib/feedback.mjs";

if (process.argv.includes("--help")) {
  console.log(
    "Usage: npm run feedback:game\nRuns live controls, nine generated campaigns with exact save replay, and browser interaction/save/audio tests. Keeps incremental JSON/Markdown/HTML evidence. PASS verifies declared behavior, not subjective fun or visual approval.",
  );
  process.exit(0);
}
if (process.argv.length > 2) throw new Error("Unknown arguments; use --help.");
await fs.mkdir("quality-results/game-feedback", { recursive: true });
const output = path.resolve(
  await fs.mkdtemp("quality-results/game-feedback/run-"),
);
const sourceIdentity = async () => {
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const files = git("ls-files", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(Boolean);
  const source = {
    commit: git("rev-parse", "HEAD").trim(),
    diff: git("diff", "HEAD", "--binary"),
    untracked: {},
  };
  for (const file of files)
    source.untracked[file] = createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
};
const fingerprint = await sourceIdentity();
const results = [];
const reports = new Map();
const reportErrors = new Map();
let child,
  interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    if (child?.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  });
const cases = [
  {
    id: "rules",
    command: "npx",
    args: [
      "vitest",
      "run",
      "--reporter=json",
      `--outputFile=${path.join(output, "rules.json")}`,
    ],
    json: "rules.json",
    evidence: "rules.json",
  },
  {
    id: "controls",
    command: process.execPath,
    args: ["scripts/feedback.mjs", "--output", path.join(output, "controls")],
    json: "controls/feedback.json",
    evidence: "controls/report.html",
  },
  {
    id: "campaign",
    command: process.execPath,
    args: [
      "scripts/test-campaign-journey.mjs",
      "--output",
      path.join(output, "campaign"),
    ],
    json: "campaign/results.json",
    evidence: "campaign/report.md",
  },
  {
    id: "browser",
    command: "npx",
    args: [
      "playwright",
      "test",
      ...BROWSER_TEST_FILES,
      "--workers=1",
      "--reporter=list,json",
      "--output",
      path.join(output, "browser-artifacts"),
    ],
    json: "browser.json",
    evidence: "browser.json",
  },
];

function discoverBrowserCases() {
  const args = [
    "playwright",
    "test",
    ...BROWSER_TEST_FILES,
    "--list",
    "--reporter=json",
  ];
  try {
    const raw = execFileSync("npx", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const report = JSON.parse(raw);
    const cases = collectBrowserCases(report).map(
      ({ id, project, file, titlePath }) => ({
        id,
        project,
        file,
        titlePath,
      }),
    );
    const error =
      !Array.isArray(report.errors) || report.errors.length || !cases.length
        ? "Playwright list mode returned incomplete test evidence"
        : null;
    return {
      command: ["npx", ...args],
      report,
      cases: error ? [] : cases,
      error,
    };
  } catch (error) {
    return {
      command: ["npx", ...args],
      report: null,
      cases: [],
      error: error.stack ?? String(error),
    };
  }
}

const browserDiscovery = discoverBrowserCases();
await fs.writeFile(
  path.join(output, "browser-list.json"),
  `${JSON.stringify(browserDiscovery.report ?? { error: browserDiscovery.error }, null, 2)}\n`,
);
async function report(complete = false) {
  const sourceStable = fingerprint === (await sourceIdentity());
  const runComplete = complete && !interrupted;
  const verdict = gameFeedbackVerdict(results, runComplete, sourceStable);
  const issues = buildIssues({
    results,
    complete: runComplete,
    sourceStable,
    componentDefinitions: cases,
    reports,
    reportErrors,
    outputDirectory: output,
    expectedBrowserCases: browserDiscovery.cases,
  });
  const value = {
    schemaVersion: 1,
    verdict,
    complete: runComplete,
    sourceStable,
    fingerprint,
    contract: {
      version: 1,
      controls: CONTROL_CASE_IDS,
      campaign: CAMPAIGN_CASES,
      browser: browserDiscovery.cases,
      browserDiscovery: {
        command: browserDiscovery.command,
        error: browserDiscovery.error,
        evidence: "browser-list.json",
      },
    },
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
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Game feedback ${verdict}</title><style>body{background:#14191c;color:#e9e1d5;font:17px/1.6 system-ui;max-width:900px;margin:40px auto;padding:20px}a{color:#edc88e}li{margin:20px 0}code{color:#d6ac77}</style><h1>Game feedback: ${verdict}</h1><p>${value.limitation}</p><ul>${results.map((result) => `<li><strong>${escapeHtml(result.id)}: ${result.exitCode === 0 && result.reportValid ? "PASS" : "FAIL"}</strong> · <a href="${result.evidence}">Evidence</a> · <a href="${result.id}.log">Diagnostic log</a>${result.error ? `<p>${escapeHtml(result.error)}</p>` : ""}</li>`).join("")}</ul><p><a href="next-action.md">First-failure handoff</a> · <a href="browser-list.json">Browser manifest</a></p><p>${sourceStable ? "Source fingerprint held constant." : "Source changed. Rerun after edits finish."}</p><p><a href="feedback.json">Machine-readable summary</a></p>`,
  );
  return verdict;
}
await report();
console.log(`Game feedback evidence: ${path.join(output, "report.html")}`);
for (const entry of cases) {
  if (interrupted) break;
  console.log(`Running ${entry.id}…`);
  const log = await fs.open(path.join(output, `${entry.id}.log`), "w");
  const started = Date.now();
  const outcome = await new Promise((resolve) => {
    child = spawn(entry.command, entry.args, {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...process.env,
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
    }, 300_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, error: error.message });
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        ...(timedOut
          ? { error: "Component exceeded five-minute limit." }
          : signal
            ? { error: `Stopped by ${signal}` }
            : {}),
      });
    });
  });
  child = undefined;
  await log.close();
  let reportValid = false;
  let parsedReport;
  try {
    const rawReport = await fs.readFile(path.join(output, entry.json), "utf8");
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
      reportValid = componentReportValid(entry.id, parsedReport, {
        expectedBrowserCases: browserDiscovery.cases,
      });
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
    reportValid,
    evidence: entry.evidence,
    elapsedMs: Date.now() - started,
  });
  console.log(
    `${entry.id}: ${outcome.exitCode === 0 && reportValid ? "PASS" : "FAIL"}; ${path.join(output, `${entry.id}.log`)}`,
  );
  await report();
}
const verdict = await report(true);
console.log(`${verdict}: ${path.join(output, "report.html")}`);
process.exitCode = verdict === "PASS" ? 0 : interrupted ? 130 : 1;
