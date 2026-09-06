import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runGameFeedback } from "./lib/run-game-feedback.mjs";
import {
  BROWSER_TEST_FILES,
  CAMPAIGN_CASES,
  CONTROL_CASE_IDS,
  collectBrowserCases,
} from "./lib/game-feedback-contract.mjs";

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
const componentDefinitions = [
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

console.log(`Game feedback evidence: ${path.join(output, "report.html")}`);
const run = await runGameFeedback({
  componentDefinitions,
  outputDirectory: output,
  sourceIdentity,
  browserDiscovery,
  contract: {
    version: 1,
    controls: CONTROL_CASE_IDS,
    campaign: CAMPAIGN_CASES,
    browser: browserDiscovery.cases,
    browserDiscovery,
  },
});
console.log(`${run.verdict}: ${path.join(output, "report.html")}`);
process.exitCode = run.verdict === "PASS" ? 0 : run.interrupted ? 130 : 1;
