import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const assessor = path.join(root, "scripts", "assess-actor-pose.mjs");
const trials = [
  {
    id: "ashfang-idle-master-v1",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v1.json",
    expectedViolations: [
      "contact-footprint",
      "runtime-aspect",
      "runtime-height",
    ],
    requiresReview: false,
  },
  {
    id: "ashfang-idle-master-v2",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v2.json",
    expectedViolations: ["foot-anchor", "runtime-height"],
    requiresReview: true,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const trial of trials) {
  const output = path.join(root, "quality-results", "actor-pose", trial.id);
  const execution = await run(
    process.execPath,
    [assessor, "--trial", path.join(root, trial.manifest), "--output", output],
    { cwd: root },
  );
  assert(
    execution.stderr.trim().length === 0,
    `${trial.id} wrote unexpected stderr`,
  );
  const report = JSON.parse(
    await fs.readFile(path.join(output, "report.json"), "utf8"),
  );
  assert(report.status === "rejected", `${trial.id} is not rejected`);
  assert(
    report.expectation.exactViolationSetMatch,
    `${trial.id} did not reproduce its exact violation set`,
  );
  assert(
    JSON.stringify(report.expectation.actualViolationCodes) ===
      JSON.stringify([...trial.expectedViolations].sort()),
    `${trial.id} reproduced unexpected violations`,
  );
  assert(
    report.negativeControls.length === 5 &&
      report.negativeControls.every(({ detected }) => detected),
    `${trial.id} did not catch all five fixture-bound mutations`,
  );
  if (trial.requiresReview)
    assert(
      report.visualReview?.verdict === "REJECT" &&
        report.visualReview.hashesMatch,
      `${trial.id} is missing its exact-hash independent rejection`,
    );
}

console.log(
  `Actor pose trials PASS: ${trials.length}/${trials.length} exact rejections reproduced, 10/10 fixture-bound mutations caught, current exact-hash visual veto matched.`,
);
