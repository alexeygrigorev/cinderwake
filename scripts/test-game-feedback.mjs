import { test } from "node:test";
import assert from "node:assert/strict";
import {
  componentReportValid,
  gameFeedbackVerdict,
} from "./lib/game-feedback.mjs";
test("aggregate rejects missing, interrupted and source-mixed evidence", () => {
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
      [
        ...passing.slice(0, 3),
        { id: "browser", exitCode: null, reportValid: true },
      ],
      true,
      true,
    ),
    "FAIL",
  );
});
test("zero exit without full declared evidence cannot pass", () => {
  assert.equal(
    componentReportValid("controls", { verdict: "PASS", complete: false }),
    false,
  );
  assert.equal(componentReportValid("campaign", { results: [] }), false);
  assert.equal(
    componentReportValid("browser", {
      stats: { expected: 21, skipped: 0, unexpected: 0 },
    }),
    false,
  );
  assert.equal(
    componentReportValid("browser", {
      stats: { expected: 22, skipped: 0, unexpected: 0 },
    }),
    true,
  );
  assert.equal(
    componentReportValid("browser", {
      stats: { expected: 22, skipped: 1, unexpected: 0 },
    }),
    false,
  );
  assert.equal(
    componentReportValid("rules", {
      success: true,
      numTotalTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
    }),
    false,
  );
  assert.equal(
    gameFeedbackVerdict(
      Array.from({ length: 4 }, () => ({
        id: "rules",
        exitCode: 0,
        reportValid: true,
      })),
      true,
      true,
    ),
    "INCOMPLETE",
  );
});
