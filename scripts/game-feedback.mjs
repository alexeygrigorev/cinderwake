import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  componentReportValid,
  gameFeedbackVerdict,
} from "./lib/game-feedback.mjs";
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
async function report(complete = false) {
  const sourceStable = fingerprint === (await sourceIdentity());
  const verdict = gameFeedbackVerdict(
    results,
    complete && !interrupted,
    sourceStable,
  );
  const value = {
    schemaVersion: 1,
    verdict,
    complete: complete && !interrupted,
    sourceStable,
    fingerprint,
    results,
    limitation:
      "Automated pilots know the map. PASS is behavioral evidence, not proof of fun, human pacing, or visual quality.",
  };
  await fs.writeFile(
    path.join(output, "feedback.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(output, "feedback.md"),
    `# Game feedback: ${verdict}\n\n${value.limitation}\n\n${results.map((result) => `- ${result.id}: ${result.exitCode === 0 && result.reportValid ? "PASS" : "FAIL"}; [evidence](${result.evidence}); [log](${result.id}.log)`).join("\n")}\n${sourceStable ? "" : "\nSource changed during this run. Repeat after edits finish.\n"}`,
  );
  await fs.writeFile(
    path.join(output, "report.html"),
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Game feedback ${verdict}</title><style>body{background:#14191c;color:#e9e1d5;font:17px/1.6 system-ui;max-width:900px;margin:40px auto;padding:20px}a{color:#edc88e}li{margin:20px 0}code{color:#d6ac77}</style><h1>Game feedback: ${verdict}</h1><p>${value.limitation}</p><ul>${results.map((result) => `<li><strong>${escapeHtml(result.id)}: ${result.exitCode === 0 && result.reportValid ? "PASS" : "FAIL"}</strong> · <a href="${result.evidence}">Evidence</a> · <a href="${result.id}.log">Diagnostic log</a>${result.error ? `<p>${escapeHtml(result.error)}</p>` : ""}</li>`).join("")}</ul><p>${sourceStable ? "Source fingerprint held constant." : "Source changed. Rerun after edits finish."}</p><p><a href="feedback.json">Machine-readable summary</a></p>`,
  );
  return verdict;
}
await report();
const cases = [
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
      "tests/e2e/combat-controls.spec.ts",
      "tests/e2e/campaign.spec.ts",
      "--workers=1",
      "--reporter=list,json",
      "--output",
      path.join(output, "browser-artifacts"),
    ],
    json: "browser.json",
    evidence: "browser.json",
  },
];
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
  try {
    reportValid = componentReportValid(
      entry.id,
      JSON.parse(await fs.readFile(path.join(output, entry.json), "utf8")),
    );
  } catch {
    /* Missing or malformed evidence is not a pass. */
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
