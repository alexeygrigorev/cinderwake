import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CONTROL_CASE_IDS } from "./lib/game-feedback-contract.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const browserFixture = String.raw`
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(process.env.GAME_TESTER_PACKAGE_JSON);
const { chromium } = require("@playwright/test");
const CONTROL_CASE_IDS = JSON.parse(process.env.CONTROL_CASE_IDS);
const mode = process.env.FIXTURE_MODE;
const output = process.env.FIXTURE_OUTPUT;
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    '<!doctype html><button id="attack">Attack</button><output id="health">100</output><script>document.querySelector("#attack").addEventListener("click", () => { if (window.effectiveAttack) document.querySelector("#health").textContent = "80"; });</script>',
  );
});

function closeServer() {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  if (mode === "missing") {
    await fs.writeFile(
      path.join(output, "server-started.json"),
      JSON.stringify({ port }),
    );
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
    await page.goto("http://127.0.0.1:" + port + "/fixture", {
      waitUntil: "load",
    });
    await page.evaluate((effectiveAttack) => {
      window.effectiveAttack = effectiveAttack;
    }, mode !== "ineffective");
    const healthBefore = Number(await page.locator("#health").textContent());
    await page.click("#attack");
    const healthAfter = Number(await page.locator("#health").textContent());
    const browserVersion = browser.version();
    const captureDirectory = path.join(output, "controls", "attack");
    await fs.mkdir(captureDirectory, { recursive: true });
    const statePath = path.join(captureDirectory, "state.json");
    const framePath = path.join(captureDirectory, "frame.png");
    const frameMetaPath = path.join(captureDirectory, "frame-meta.json");
    const capture = {
      tick: 7,
      statePath: "controls/attack/state.json",
      framePath: "controls/attack/frame.png",
      frameMetaPath: "controls/attack/frame-meta.json",
    };
    await page.screenshot({ path: framePath });
    await fs.writeFile(
      statePath,
      JSON.stringify({
        tick: capture.tick,
        healthBefore,
        healthAfter,
        framePath: capture.framePath,
        browserVersion,
        serverPort: port,
      }),
    );
    await fs.writeFile(
      frameMetaPath,
      JSON.stringify({
        tick: capture.tick,
        statePath: capture.statePath,
        framePath: capture.framePath,
      }),
    );

    const effective = mode !== "ineffective";
    const cases = CONTROL_CASE_IDS.map((id, index) => {
      const attackCase = id === "vanguard-combat";
      return {
        id,
        checks: [
          {
            id: attackCase ? "attack-damage" : "fixture-" + index,
            pass: attackCase ? effective : true,
            expected: attackCase
              ? "target health decreases after the attack"
              : "control evidence is retained",
            actual: attackCase ? healthAfter : true,
            evidence: attackCase ? "../attack/frame.png" : null,
          },
        ],
      };
    });
    const report = {
      verdict: effective ? "PASS" : "FAIL",
      complete: mode !== "interrupt",
      failures: effective ? [] : [{ id: "vanguard-combat" }],
      plannedCases: CONTROL_CASE_IDS,
      cases,
      capture,
      browserVersion,
    };
    if (mode === "interrupt") {
      await browser.close();
      browser = undefined;
    }
    await fs.writeFile(
      path.join(output, "controls.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    if (mode === "interrupt") await new Promise(() => {});
    if (mode === "runtime") throw new Error("fixture runtime failure");
  } finally {
    if (mode !== "interrupt") {
      await browser?.close();
      await closeServer();
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
`;

function runnerWrapper({ runnerPath, validatorPath }) {
  return String.raw`
import fs from "node:fs/promises";
import path from "node:path";
import { componentReportValid } from ${JSON.stringify(validatorPath)};
import { runGameFeedback } from ${JSON.stringify(runnerPath)};

const outputDirectory = process.env.RUNNER_OUTPUT;
const mode = process.env.FIXTURE_MODE;
const result = await runGameFeedback({
  componentDefinitions: [
    {
      id: "controls",
      command: process.execPath,
      args: [process.env.FIXTURE_SCRIPT],
      json: "controls.json",
      evidence: "controls/attack/frame.png",
      environment: {
        FIXTURE_MODE: mode,
        FIXTURE_OUTPUT: outputDirectory,
        CONTROL_CASE_IDS: process.env.CONTROL_CASE_IDS,
        GAME_TESTER_PACKAGE_JSON: process.env.GAME_TESTER_PACKAGE_JSON,
      },
      validateReport: (report) => componentReportValid("controls", report),
    },
  ],
  outputDirectory,
  sourceIdentity: async () => "integration-fixture-source-v1",
  browserDiscovery: {
    command: ["node", "integration-fixture"],
    report: { errors: [], suites: [] },
    cases: [],
    error: null,
  },
  contract: { version: 1, controls: JSON.parse(process.env.CONTROL_CASE_IDS) },
  timeoutMs: 15000,
});
await fs.writeFile(
  path.join(outputDirectory, "wrapper-result.json"),
  JSON.stringify({ verdict: result.verdict, complete: result.value.complete, interrupted: result.interrupted }) + "\n",
);
process.exitCode = result.verdict === "PASS" ? 0 : result.interrupted ? 130 : 1;
`;
}

async function exists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(file, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await exists(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function runWrapper(wrapperPath, outputDirectory, mode, interrupt = false) {
  const child = spawn(process.execPath, [wrapperPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CONTROL_CASE_IDS: JSON.stringify(CONTROL_CASE_IDS),
      FIXTURE_MODE: mode,
      FIXTURE_OUTPUT: outputDirectory,
      FIXTURE_SCRIPT: path.join(
        path.dirname(wrapperPath),
        "browser-fixture.mjs",
      ),
      GAME_TESTER_PACKAGE_JSON: path.join(repositoryRoot, "package.json"),
      RUNNER_OUTPUT: outputDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const completion = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${mode} integration fixture timed out\n${log}`));
    }, 45_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, log });
    });
  });
  return { child, completion, interrupt };
}

async function runScenario(wrapperPath, root, mode, interrupt = false) {
  const outputDirectory = path.join(root, mode);
  await fs.mkdir(outputDirectory, { recursive: true });
  const execution = runWrapper(wrapperPath, outputDirectory, mode, interrupt);
  try {
    if (interrupt)
      await waitForFile(path.join(outputDirectory, "controls.json"));
    else if (mode === "missing")
      await waitForFile(path.join(outputDirectory, "server-started.json"));
    if (interrupt) execution.child.kill("SIGTERM");
    const result = await execution.completion;
    const feedback = JSON.parse(
      await fs.readFile(path.join(outputDirectory, "feedback.json"), "utf8"),
    );
    return { ...result, feedback, outputDirectory };
  } catch (error) {
    execution.child.kill("SIGKILL");
    await execution.completion.catch(() => {});
    throw error;
  }
}

async function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function assertPortClosed(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await portIsOpen(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`fixture server still accepts connections on port ${port}`);
}

async function assertSynchronizedCapture(outputDirectory, report) {
  const capture = report.capture;
  assert.ok(capture, "capture metadata is retained");
  const state = JSON.parse(
    await fs.readFile(path.join(outputDirectory, capture.statePath), "utf8"),
  );
  const frameMeta = JSON.parse(
    await fs.readFile(
      path.join(outputDirectory, capture.frameMetaPath),
      "utf8",
    ),
  );
  const frame = await fs.stat(path.join(outputDirectory, capture.framePath));
  assert.ok(frame.size > 0, "captured frame is retained");
  assert.equal(state.tick, capture.tick);
  assert.equal(frameMeta.tick, capture.tick);
  assert.equal(state.framePath, capture.framePath);
  assert.equal(frameMeta.statePath, capture.statePath);
  assert.equal(frameMeta.framePath, capture.framePath);
}

async function assertIssueEvidence(outputDirectory, issue) {
  assert.ok(issue);
  for (const evidencePath of issue.evidencePaths)
    assert.equal(
      await exists(path.join(outputDirectory, evidencePath)),
      true,
      `evidence path should resolve: ${evidencePath}`,
    );
}

test(
  "game feedback runner drills real browser failures and cleans up isolated processes",
  { timeout: 180_000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "game-feedback-integration-"),
    );
    const fixturePath = path.join(root, "browser-fixture.mjs");
    const wrapperPath = path.join(root, "runner-wrapper.mjs");
    try {
      await fs.writeFile(fixturePath, browserFixture);
      await fs.writeFile(
        wrapperPath,
        runnerWrapper({
          runnerPath: path.join(
            repositoryRoot,
            "scripts/lib/run-game-feedback.mjs",
          ),
          validatorPath: path.join(
            repositoryRoot,
            "scripts/lib/game-feedback.mjs",
          ),
        }),
      );

      const valid = await runScenario(wrapperPath, root, "valid");
      assert.equal(valid.code, 0, valid.log);
      assert.equal(valid.feedback.verdict, "PASS");
      assert.equal(valid.feedback.complete, true);
      assert.equal(valid.feedback.sourceStable, true);
      assert.deepEqual(valid.feedback.issues, []);
      const validReport = JSON.parse(
        await fs.readFile(
          path.join(valid.outputDirectory, "controls.json"),
          "utf8",
        ),
      );
      assert.ok(validReport.browserVersion);
      assert.equal(validReport.capture.tick, 7);
      await assertSynchronizedCapture(valid.outputDirectory, validReport);
      const validState = JSON.parse(
        await fs.readFile(
          path.join(valid.outputDirectory, validReport.capture.statePath),
          "utf8",
        ),
      );
      await assertPortClosed(validState.serverPort);

      const ineffective = await runScenario(wrapperPath, root, "ineffective");
      assert.equal(ineffective.code, 1, ineffective.log);
      assert.equal(ineffective.feedback.verdict, "FAIL");
      const behaviorIssue = ineffective.feedback.issues[0];
      assert.equal(behaviorIssue.category, "behavior");
      assert.equal(behaviorIssue.code, "control-check-failed");
      assert.equal(behaviorIssue.caseId, "vanguard-combat/attack-damage");
      await assertIssueEvidence(ineffective.outputDirectory, behaviorIssue);
      const ineffectiveReport = JSON.parse(
        await fs.readFile(
          path.join(ineffective.outputDirectory, "controls.json"),
          "utf8",
        ),
      );
      await assertSynchronizedCapture(
        ineffective.outputDirectory,
        ineffectiveReport,
      );
      const ineffectiveState = JSON.parse(
        await fs.readFile(
          path.join(
            ineffective.outputDirectory,
            ineffectiveReport.capture.statePath,
          ),
          "utf8",
        ),
      );
      assert.equal(ineffectiveState.healthBefore, ineffectiveState.healthAfter);
      await assertPortClosed(ineffectiveState.serverPort);

      const runtime = await runScenario(wrapperPath, root, "runtime");
      assert.equal(runtime.code, 1, runtime.log);
      assert.equal(runtime.feedback.verdict, "FAIL");
      assert.equal(runtime.feedback.results[0].reportValid, true);
      assert.equal(runtime.feedback.issues[0].category, "runtime");
      assert.equal(runtime.feedback.issues[0].code, "component-process-failed");
      assert.match(
        await fs.readFile(
          path.join(runtime.outputDirectory, "controls.log"),
          "utf8",
        ),
        /fixture runtime failure/,
      );
      const runtimeReport = JSON.parse(
        await fs.readFile(
          path.join(runtime.outputDirectory, "controls.json"),
          "utf8",
        ),
      );
      await assertSynchronizedCapture(runtime.outputDirectory, runtimeReport);
      const runtimeState = JSON.parse(
        await fs.readFile(
          path.join(runtime.outputDirectory, runtimeReport.capture.statePath),
          "utf8",
        ),
      );
      await assertPortClosed(runtimeState.serverPort);

      const missing = await runScenario(wrapperPath, root, "missing");
      assert.equal(missing.code, 1, missing.log);
      assert.equal(missing.feedback.verdict, "FAIL");
      assert.equal(missing.feedback.results[0].reportValid, false);
      assert.equal(missing.feedback.issues[0].category, "evidence");
      assert.equal(missing.feedback.issues[0].code, "report-missing");
      assert.equal(
        await exists(path.join(missing.outputDirectory, "controls.json")),
        false,
      );
      const serverStarted = JSON.parse(
        await fs.readFile(
          path.join(missing.outputDirectory, "server-started.json"),
          "utf8",
        ),
      );
      assert.equal(
        await exists(
          path.join(missing.outputDirectory, "controls/attack/frame.png"),
        ),
        false,
      );
      await assertPortClosed(serverStarted.port);

      const interrupted = await runScenario(
        wrapperPath,
        root,
        "interrupt",
        true,
      );
      assert.equal(interrupted.code, 130, interrupted.log);
      assert.equal(interrupted.feedback.verdict, "INCOMPLETE");
      assert.equal(interrupted.feedback.complete, false);
      assert.notEqual(interrupted.feedback.verdict, "PASS");
      assert.equal(
        interrupted.feedback.issues[0].category,
        "runtime",
        JSON.stringify(interrupted.feedback.issues),
      );
      assert.equal(
        interrupted.feedback.issues[0].code,
        "component-interrupted",
      );
      const interruptedReport = JSON.parse(
        await fs.readFile(
          path.join(interrupted.outputDirectory, "controls.json"),
          "utf8",
        ),
      );
      await assertSynchronizedCapture(
        interrupted.outputDirectory,
        interruptedReport,
      );
      const interruptedState = JSON.parse(
        await fs.readFile(
          path.join(
            interrupted.outputDirectory,
            interruptedReport.capture.statePath,
          ),
          "utf8",
        ),
      );
      await assertPortClosed(interruptedState.serverPort);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
