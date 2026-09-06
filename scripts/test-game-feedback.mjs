import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CAMPAIGN_CASES,
  CONTROL_CASE_IDS,
  browserCaseIdentity,
  collectBrowserCases,
  componentReportValid,
} from "./lib/game-feedback-contract.mjs";
import { gameFeedbackVerdict } from "./lib/game-feedback.mjs";
import {
  buildIssues,
  renderNextAction,
  shellQuote,
} from "./lib/game-feedback-diagnostics.mjs";

function passingRules() {
  return {
    success: true,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [
      {
        status: "passed",
        assertionResults: [{ status: "passed" }],
      },
    ],
  };
}

function passingControls() {
  return {
    verdict: "PASS",
    complete: true,
    plannedCases: [...CONTROL_CASE_IDS],
    failures: [],
    cases: CONTROL_CASE_IDS.map((id) => ({
      id,
      checks: [{ id: "check", pass: true }],
    })),
  };
}

function passingCampaign() {
  return {
    complete: true,
    pass: true,
    runtimeError: null,
    results: CAMPAIGN_CASES.map(({ seed, classId }, index) => ({
      id: `${index + 1}-${classId}-${seed}`,
      seed,
      classId,
      pass: true,
      phase: "won",
      replayMatched: true,
      snapshotMatched: true,
      saveResumeMatched: true,
      validationErrors: [],
    })),
  };
}

function passingBrowser() {
  const passingTest = () => ({
    projectId: "chromium",
    projectName: "chromium",
    expectedStatus: "passed",
    status: "expected",
    results: [{ status: "passed", errors: [] }],
  });
  return {
    config: { rootDir: "/repo/tests" },
    errors: [],
    stats: { expected: 2, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [
      {
        title: "e2e/arena.spec.ts",
        file: "e2e/arena.spec.ts",
        specs: [
          {
            title: "stands in the arena",
            file: "e2e/arena.spec.ts",
            ok: true,
            tests: [passingTest()],
          },
        ],
        suites: [
          {
            title: "touch controls",
            specs: [
              {
                title: "moves with the pad",
                ok: true,
                tests: [passingTest()],
              },
            ],
          },
        ],
      },
    ],
  };
}

function browserExpectation(report) {
  return collectBrowserCases(report, { repositoryRoot: "/repo" }).map(
    ({ id, project, file, titlePath }) => ({
      id,
      project,
      file,
      titlePath,
    }),
  );
}

test("aggregate rejects missing, duplicate and source-mixed evidence", () => {
  const passing = ["rules", "controls", "campaign", "browser"].map((id) => ({
    id,
    exitCode: 0,
    reportValid: true,
  }));
  assert.equal(gameFeedbackVerdict(passing, true, true), "PASS");
  assert.equal(gameFeedbackVerdict([], true, true), "INCOMPLETE");
  assert.equal(gameFeedbackVerdict(passing, false, true), "INCOMPLETE");
  assert.equal(gameFeedbackVerdict(passing, true, false), "FAIL");
  assert.equal(
    gameFeedbackVerdict(
      [
        ...passing.slice(0, 3),
        { id: "browser", exitCode: 0, reportValid: false },
      ],
      true,
      true,
    ),
    "FAIL",
  );
  assert.equal(
    gameFeedbackVerdict(
      [...passing.slice(0, 3), { id: "rules", exitCode: 0, reportValid: true }],
      true,
      true,
    ),
    "INCOMPLETE",
  );
});

test("passing component reports contain complete nested evidence", () => {
  const browser = passingBrowser();
  const expectedBrowserCases = browserExpectation(browser);
  assert.equal(componentReportValid("rules", passingRules()), true);
  assert.equal(componentReportValid("controls", passingControls()), true);
  assert.equal(componentReportValid("campaign", passingCampaign()), true);
  assert.equal(
    componentReportValid("browser", browser, {
      expectedBrowserCases,
      repositoryRoot: "/repo",
    }),
    true,
  );
});

test("controls reject duplicate, failed and summary-only cases", () => {
  const duplicate = passingControls();
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.equal(componentReportValid("controls", duplicate), false);

  const failed = passingControls();
  failed.cases[0].checks[0].pass = false;
  assert.equal(componentReportValid("controls", failed), false);

  const summaryOnly = passingControls();
  delete summaryOnly.cases;
  assert.equal(componentReportValid("controls", summaryOnly), false);

  const failuresRemoved = passingControls();
  delete failuresRemoved.failures;
  assert.equal(componentReportValid("controls", failuresRemoved), false);
});

test("campaign reports require each declared win and every replay proof", () => {
  const duplicate = passingCampaign();
  duplicate.results[1].seed = duplicate.results[0].seed;
  duplicate.results[1].classId = duplicate.results[0].classId;
  assert.equal(componentReportValid("campaign", duplicate), false);

  const replayMissing = passingCampaign();
  replayMissing.results[0].replayMatched = false;
  assert.equal(componentReportValid("campaign", replayMissing), false);

  const summaryOnly = {
    complete: true,
    pass: true,
    results: Array.from({ length: CAMPAIGN_CASES.length }, () => ({
      pass: true,
    })),
  };
  assert.equal(componentReportValid("campaign", summaryOnly), false);
});

test("browser reports bind exact project, file and title identities", () => {
  assert.equal(
    browserCaseIdentity({
      projectName: "chromium",
      file: "e2e\\arena.spec.ts",
      titlePath: ["stands in the arena"],
      rootDir: "/repo/tests",
      repositoryRoot: "/repo",
    }).file,
    "tests/e2e/arena.spec.ts",
  );
  const browser = passingBrowser();
  const expectedBrowserCases = browserExpectation(browser);
  assert.deepEqual(
    expectedBrowserCases.map(({ id }) => id),
    [
      "chromium :: tests/e2e/arena.spec.ts :: stands in the arena",
      "chromium :: tests/e2e/arena.spec.ts :: touch controls > moves with the pad",
    ],
  );

  const omitted = structuredClone(browser);
  omitted.suites[0].specs[0].title = "unrelated passing test";
  assert.equal(
    componentReportValid("browser", omitted, {
      expectedBrowserCases,
      repositoryRoot: "/repo",
    }),
    false,
  );

  const skipped = structuredClone(browser);
  skipped.stats.skipped = 1;
  skipped.suites[0].specs[0].tests[0].status = "skipped";
  assert.equal(
    componentReportValid("browser", skipped, {
      expectedBrowserCases,
      repositoryRoot: "/repo",
    }),
    false,
  );

  const flaky = structuredClone(browser);
  flaky.stats.flaky = 1;
  flaky.suites[0].specs[0].tests[0].results[0].status = "failed";
  assert.equal(
    componentReportValid("browser", flaky, {
      expectedBrowserCases,
      repositoryRoot: "/repo",
    }),
    false,
  );

  const summaryOnly = {
    stats: { expected: 22, skipped: 0, unexpected: 0, flaky: 0 },
  };
  assert.equal(
    componentReportValid("browser", summaryOnly, {
      expectedBrowserCases,
      repositoryRoot: "/repo",
    }),
    false,
  );
});

test("rules reject a passing headline that disagrees with nested results", () => {
  const failedNested = passingRules();
  failedNested.testResults[0].assertionResults[0].status = "failed";
  assert.equal(componentReportValid("rules", failedNested), false);

  const summaryOnly = {
    success: true,
    numTotalTests: 463,
    numFailedTests: 0,
    numPendingTests: 0,
  };
  assert.equal(componentReportValid("rules", summaryOnly), false);
});

test("diagnostics distinguish runtime, evidence, source and unknown failures", () => {
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "game-feedback-diagnostics-"),
  );
  try {
    fs.writeFileSync(path.join(outputDirectory, "browser.json"), "{}");
    fs.writeFileSync(path.join(outputDirectory, "browser.log"), "runtime log");
    const browserEntry = {
      id: "browser",
      command: "node",
      args: ["-e", "a'b <unsafe>"],
      json: "browser.json",
      evidence: "browser.json",
    };
    const timeoutIssues = buildIssues({
      complete: true,
      sourceStable: true,
      outputDirectory,
      componentDefinitions: [browserEntry],
      results: [
        {
          id: "browser",
          exitCode: null,
          error: "Component exceeded five-minute limit.",
          reportValid: false,
        },
      ],
    });
    assert.equal(timeoutIssues.length, 1);
    assert.equal(timeoutIssues[0].category, "unknown");
    assert.equal(timeoutIssues[0].code, "component-timeout");
    assert.equal(timeoutIssues[0].category === "transport", false);
    assert.equal(
      timeoutIssues[0].reproduceCommand.includes("'a'\"'\"'b"),
      true,
    );

    const sourceIssues = buildIssues({
      complete: true,
      sourceStable: false,
      outputDirectory,
      componentDefinitions: [],
      results: [],
    });
    assert.equal(sourceIssues[0].code, "source-changed");
    assert.deepEqual(sourceIssues[0].evidencePaths, ["feedback.json"]);

    const missingIssues = buildIssues({
      complete: true,
      sourceStable: true,
      outputDirectory,
      componentDefinitions: [
        {
          id: "rules",
          command: "node",
          args: ["scripts/run-rules.mjs"],
          json: "rules.json",
          evidence: "rules.json",
        },
      ],
      results: [{ id: "rules", exitCode: 0, reportValid: false }],
      reportErrors: new Map([
        ["rules", { kind: "missing", message: "ENOENT: <missing>" }],
      ]),
    });
    assert.equal(missingIssues[0].category, "evidence");
    assert.equal(missingIssues[0].code, "report-missing");

    fs.writeFileSync(path.join(outputDirectory, "rules.json"), "malformed");
    const malformedIssues = buildIssues({
      complete: true,
      sourceStable: true,
      outputDirectory,
      componentDefinitions: [
        {
          id: "rules",
          command: "node",
          args: ["scripts/run-rules.mjs"],
          json: "rules.json",
          evidence: "rules.json",
        },
      ],
      results: [{ id: "rules", exitCode: 0, reportValid: false }],
      reportErrors: new Map([
        [
          "rules",
          { kind: "malformed", message: "<script>alert('&')</script>" },
        ],
      ]),
    });
    assert.equal(malformedIssues[0].code, "report-malformed");
    const handoff = renderNextAction({
      verdict: "FAIL",
      complete: true,
      sourceStable: true,
      issues: malformedIssues,
      outputDirectory,
    });
    assert.equal(handoff.includes("<script>"), false);
    assert.equal(handoff.includes("&lt;script&gt;"), true);
    assert.match(handoff, /rules\.json/);
    assert.equal(handoff.split("\n").length <= 120, true);
    assert.equal(shellQuote("a'b"), `'a'"'"'b'`);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});
