import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

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

const framingRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-pose-framing-"),
);
try {
  const outputs = ["first.png", "second.png"].map((name) =>
    path.join(framingRoot, name),
  );
  let preparation;
  for (const output of outputs) {
    const execution = await run(
      process.execPath,
      [
        path.join(root, "scripts", "prepare-actor-pose.mjs"),
        "--input",
        path.join(root, "art/generation/candidates/ashfang-idle-master-v2.png"),
        "--output",
        output,
        "--preserve-framing",
      ],
      { cwd: root },
    );
    preparation = JSON.parse(execution.stdout);
  }
  const [first, second] = await Promise.all(
    outputs.map((file) => fs.readFile(file)),
  );
  assert(
    first.equals(second),
    "preserved-framing preparation is not deterministic",
  );
  const metadata = await sharp(first).metadata();
  assert(
    metadata.width === 256 && metadata.height === 256,
    "preserved-framing preparation did not emit one 256px source cell",
  );
  assert(
    preparation.framingMode === "preserve-canonical-canvas" &&
      preparation.maximumScale === 0.25 &&
      preparation.uniformScale === 0.25 &&
      preparation.preparedBounds.width === 165 &&
      preparation.preparedBounds.height === 137,
    "preserved-framing preparation magnified or distorted authored canvas occupancy",
  );
} finally {
  await fs.rm(framingRoot, { recursive: true, force: true });
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
  `Actor pose trials PASS: canonical 1024→256 framing reproduced twice, ${trials.length}/${trials.length} exact rejections reproduced, 10/10 fixture-bound mutations caught, current exact-hash visual veto matched.`,
);
