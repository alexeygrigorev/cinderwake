import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assessExpectations,
  defaultFeedbackPlan,
  feedbackVerdict,
  validateFeedbackPlan,
} from "./lib/feedback.mjs";

test("feedback never passes incomplete, missing or failed cases", () => {
  const passing = [{ id: "one", checks: [{ pass: true }] }];
  assert.equal(feedbackVerdict(passing, ["one", "two"], false), "INCOMPLETE");
  assert.equal(feedbackVerdict(passing, ["one", "two"]), "FAIL");
  assert.equal(feedbackVerdict(passing, ["one"]), "PASS");
  assert.equal(feedbackVerdict([], []), "FAIL");
  assert.equal(feedbackVerdict([{ id: "one", checks: [] }], ["one"]), "FAIL");
  assert.equal(
    feedbackVerdict([{ id: "one", checks: [{ pass: false }] }], ["one"]),
    "FAIL",
  );
});

test("causal checks detect frozen movement, ineffective attacks and missing evidence", () => {
  const samples = [
    { tick: 0, snapshot: { metrics: { distanceUnits: 400, damageDealt: 0 } } },
    {
      tick: 60,
      snapshot: {
        metrics: { distanceUnits: 1200, damageDealt: 18 },
        eventLog: [{ tick: 12, type: "attack_started", sourceId: "player" }],
      },
    },
  ];
  const expectations = [
    { id: "move", path: "metrics.distanceUnits", op: "deltaGte", value: 700 },
    { id: "hit", path: "metrics.damageDealt", op: "gte", value: 1 },
    {
      id: "strike",
      path: "eventLog",
      op: "eventCountGte",
      event: "attack_started",
      sourceId: "player",
      value: 1,
    },
  ];
  assert.ok(
    assessExpectations(expectations, samples).every(({ pass }) => pass),
  );
  const frozen = structuredClone(samples);
  frozen[1].snapshot.metrics.distanceUnits = 400;
  frozen[1].snapshot.metrics.damageDealt = 0;
  const checks = assessExpectations(expectations, frozen);
  assert.deepEqual(
    checks.map(({ pass }) => pass),
    [false, false, true],
  );
  assert.match(checks[1].message, /observed 0/);
  assert.equal(
    assessExpectations(
      [{ id: "missing", path: "missing.value", op: "lte", value: 20 }],
      samples,
    )[0].pass,
    false,
  );
  assert.equal(
    assessExpectations([{ ...expectations[1], at: 12 }], samples)[0].pass,
    false,
  );
  assert.equal(
    assessExpectations(
      [{ ...expectations[2], sourceId: "monster" }],
      samples,
    )[0].pass,
    false,
  );
});

test("plans reject ignored live expectations, bad ticks and invalid comparisons", () => {
  assert.equal(validateFeedbackPlan(defaultFeedbackPlan()).cases.length, 9);
  for (const mutate of [
    (plan) => {
      plan.cases[1].expect = [{ path: "player.health", op: "eq", value: -999 }];
    },
    (plan) => {
      plan.cases[0].ticks = [0, 0];
    },
    (plan) => {
      plan.cases[0].ticks = [0, Infinity];
    },
    (plan) => {
      plan.cases[0].ticks = [0, 36001];
    },
    (plan) => {
      plan.cases[0].expect = [];
    },
    (plan) => {
      plan.cases[0].expect[0].at = 999;
    },
    (plan) => {
      plan.cases[0].expect[0].op = "typo";
    },
    (plan) => {
      plan.cases[0].expect[0].value = "700";
    },
    (plan) => {
      plan.cases[1].id = plan.cases[0].id;
    },
  ]) {
    const plan = defaultFeedbackPlan();
    mutate(plan);
    assert.throws(() => validateFeedbackPlan(plan));
  }
});

function runFeedback(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/feedback.mjs", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Feedback timed out: ${log}`));
    }, 90000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

test(
  "browser feedback retains failure evidence, exact replay and clean custom outputs",
  { timeout: 180000 },
  async () => {
    // An unignored output catches accidental self-inclusion in source fingerprints.
    const temporary = await fs.mkdtemp(path.resolve(".feedback-test-"));
    try {
      const plan = { version: 1, cases: [defaultFeedbackPlan().cases[0]] };
      const planFile = path.join(temporary, "plan.json");
      await fs.writeFile(planFile, JSON.stringify(plan));
      const goodOutput = path.join(temporary, "good");
      const good = await runFeedback([
        "--plan",
        planFile,
        "--output",
        goodOutput,
      ]);
      assert.equal(good.code, 0, good.log);
      const report = JSON.parse(
        await fs.readFile(path.join(goodOutput, "feedback.json"), "utf8"),
      );
      assert.equal(report.verdict, "PASS");
      assert.equal(report.visualVerdict, "NEEDS_VISUAL_REVIEW");
      assert.equal(report.complete, true);
      const replay = JSON.parse(
        await fs.readFile(path.join(goodOutput, "replay-plan.json"), "utf8"),
      );
      assert.equal(replay.cases[0].scenario, undefined);
      assert.equal(replay.cases[0].state.schemaVersion, 2);

      replay.cases[0].expect.push({
        id: "injected-no-damage",
        path: "metrics.damageDealt",
        op: "eq",
        value: 0,
        hint: "Injected failing control",
      });
      replay.cases.push({
        ...structuredClone(plan.cases[0]),
        id: "invalid-scenario",
        scenario: "does-not-exist",
      });
      await fs.writeFile(planFile, JSON.stringify(replay));
      const badOutput = path.join(temporary, "bad");
      const bad = await runFeedback([
        "--plan",
        planFile,
        "--output",
        badOutput,
      ]);
      assert.equal(bad.code, 1, bad.log);
      const failed = JSON.parse(
        await fs.readFile(path.join(badOutput, "feedback.json"), "utf8"),
      );
      assert.deepEqual(
        failed.failures.map(({ id }) => id),
        ["injected-no-damage", "runner"],
      );
      assert.ok(failed.failures[0].actual > 0);
      assert.equal(
        failed.cases[0].checks.find(({ id }) => id === "deterministic-replay")
          .pass,
        true,
      );
      for (const file of [
        "feedback.md",
        "report.html",
        "vanguard-combat/contact-sheet.png",
        "vanguard-combat/timeline.json",
        "vanguard-combat/initial-state.json",
        "vanguard-combat/commands.json",
        "invalid-scenario/error.png",
        "invalid-scenario/console.json",
      ])
        assert.ok((await fs.stat(path.join(badOutput, file))).size > 0, file);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  },
);
