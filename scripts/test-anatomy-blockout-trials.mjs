import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const manifestPath = path.join(
  root,
  "art/generation/anatomy-trials/ashfang-anatomy-blockout-v1.json",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function exactFile(record, label) {
  const contents = await fs.readFile(path.join(root, record.file));
  assert(sha256(contents) === record.sha256, `${label} has a stale sha256`);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
assert(
  manifest.schemaVersion === 1 &&
    manifest.contract === "CinderwakeAnatomyBlockoutIngressV1" &&
    manifest.evaluation.status === "rejected" &&
    manifest.preparation.expectedStatus === "rejected" &&
    manifest.visualReview.verdict === "ACCEPT-INTERNAL-REFERENCE-ONLY" &&
    manifest.visualReview.reviewedRawSha256 === manifest.candidateSha256 &&
    manifest.visualReview.acceptedAxes.length > 0 &&
    manifest.visualReview.rejectedAxes.length > 0,
  "anatomy blockout v1 contract or review is invalid",
);
await Promise.all([
  exactFile(
    { file: manifest.candidateFile, sha256: manifest.candidateSha256 },
    "anatomy candidate",
  ),
  ...manifest.referenceFiles.map((reference, index) =>
    exactFile(reference, `anatomy reference ${index}`),
  ),
]);
const prompt = await fs.readFile(path.join(root, manifest.promptFile));
assert(prompt.length > 0, "anatomy prompt is empty");

const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-anatomy-blockout-"),
);
try {
  const output = path.join(temporaryRoot, "unexpected.png");
  let evidence = "";
  try {
    await run(
      process.execPath,
      [
        path.join(root, "scripts/prepare-actor-pose.mjs"),
        "--input",
        path.join(root, manifest.candidateFile),
        "--output",
        output,
        "--preserve-framing",
      ],
      { cwd: root },
    );
  } catch (error) {
    evidence = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  assert(
    evidence.includes(manifest.preparation.expectedError),
    "magenta-contaminated anatomy blockout did not reproduce its exact ingress rejection",
  );
  const outputExists = await fs
    .access(output)
    .then(() => true)
    .catch(() => false);
  assert(!outputExists, "rejected anatomy blockout left a partial output");
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "Anatomy blockout ingress PASS: exact raw/reference hashes and internal visual review matched; magenta-contaminated foreground reproduced `isolated pose is blank` without partial output.",
);
