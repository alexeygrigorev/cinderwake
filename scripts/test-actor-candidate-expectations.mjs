import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const assessor = path.join(root, "scripts", "assess-actor-candidate.mjs");
const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-candidate-expectations-"),
);

function requireIncludes(value, expected) {
  if (!value.includes(expected))
    throw new Error(`Expected assessor failure to include ${expected}`);
}

try {
  let rejection;
  try {
    await run(
      process.execPath,
      [
        assessor,
        "--actor",
        "ashfang",
        "--family",
        "primary",
        "--profile",
        "ashfang-primary-v1",
        "--candidate",
        "art/generation/prepared/ashfang-primary-trial-v2.png",
        "--output",
        path.join(temporaryRoot, "mechanically-green-visually-rejected"),
        "--expect-assessment",
        "pass",
      ],
      { cwd: root },
    );
  } catch (error) {
    rejection = `${error.stderr ?? ""}\n${error.stdout ?? ""}`;
  }
  if (!rejection)
    throw new Error(
      "A mechanically green but visually rejected actor was incorrectly promoted",
    );
  requireIncludes(rejection, "actual=pass");
  requireIncludes(rejection, "recorded-art=rejected");
  requireIncludes(rejection, "recorded-preparation=rejected");
  requireIncludes(rejection, "visual-review=false");
  console.log(
    "Actor promotion expectation PASS: mechanical success cannot bypass rejected art, preparation, or missing exact-hash visual acceptance.",
  );
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
