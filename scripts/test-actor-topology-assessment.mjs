import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const executeFile = promisify(execFile);
const root = process.cwd();
const assessor = path.join(root, "scripts", "assess-actor-pose.mjs");
const baseManifest = path.join(
  root,
  "art/generation/pose-trials/ashfang-anatomy-blockout-v4.json",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function keyedAlpha(red, green, blue) {
  const magentaDominance = Math.min(red, blue) - green;
  const magentaBalance = Math.abs(red - blue);
  if (magentaDominance >= 28 && magentaBalance <= 110) return 0;
  if (magentaDominance > 12 && magentaBalance < 130)
    return Math.max(0, Math.round(((28 - magentaDominance) / 16) * 255));
  const distance = Math.hypot(255 - red, green, 255 - blue);
  if (distance <= 24) return 0;
  if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
  return 255;
}

async function rgba(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function writeRawPng(file, data, info) {
  await sharp(data, { raw: info })
    .png({ compressionLevel: 9, palette: false })
    .toFile(file);
  return fs.readFile(file);
}

async function contourMutation(source, destination) {
  const { data, info } = await rgba(source);
  const visible = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return false;
    const offset = (y * info.width + x) * 4;
    return (
      Math.min(
        data[offset + 3],
        keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
      ) >= 24
    );
  };
  let mutation = null;
  for (let y = 0; y < info.height && !mutation; y += 1)
    for (let x = 0; x < info.width; x += 1)
      if (
        visible(x, y) &&
        (!visible(x - 1, y) ||
          !visible(x + 1, y) ||
          !visible(x, y - 1) ||
          !visible(x, y + 1))
      ) {
        mutation = { x, y };
        break;
      }
  assert(mutation, "fixture has no visible contour pixel");
  const offset = (mutation.y * info.width + mutation.x) * 4;
  data[offset] = 255;
  data[offset + 1] = 0;
  data[offset + 2] = 255;
  data[offset + 3] = 255;
  return writeRawPng(destination, data, info);
}

async function translated(source, destination) {
  const { data, info } = await rgba(source);
  const shifted = Buffer.alloc(data.length);
  for (let index = 0; index < info.width * info.height; index += 1) {
    shifted[index * 4] = 255;
    shifted[index * 4 + 1] = 0;
    shifted[index * 4 + 2] = 255;
    shifted[index * 4 + 3] = 255;
  }
  for (let y = 0; y < info.height; y += 1)
    for (let x = 0; x < info.width - 1; x += 1) {
      const sourceOffset = (y * info.width + x) * 4;
      const destinationOffset = (y * info.width + x + 1) * 4;
      data.copy(shifted, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  return writeRawPng(destination, shifted, info);
}

async function executeTrial(directory, name, manifest) {
  const manifestPath = path.join(directory, `${name}.json`);
  const output = path.join(directory, `${name}-output`);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await executeFile(
    process.execPath,
    [assessor, "--trial", manifestPath, "--output", output],
    { cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  return {
    output,
    report: JSON.parse(await fs.readFile(path.join(output, "report.json"))),
  };
}

function withLock(base, referenceFile, referenceBytes, expectedViolations) {
  return {
    ...base,
    id: `topology-oracle-${expectedViolations.length ? "reject" : "accept"}`,
    mechanicalTargets: {
      ...base.mechanicalTargets,
      expectedAssessment: expectedViolations.length ? "fail" : "pass",
      expectedViolationCodes: expectedViolations,
    },
    topologyLock: {
      reference: { file: referenceFile, sha256: sha256(referenceBytes) },
      alphaThreshold: 24,
      maximumChangedPixels: 0,
    },
  };
}

const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-topology-oracle-"),
);
try {
  const base = JSON.parse(await fs.readFile(baseManifest, "utf8"));
  const preparedFile = path.resolve(root, base.preparation.file);
  const preparedBytes = await fs.readFile(preparedFile);

  const identicalManifest = withLock(base, preparedFile, preparedBytes, []);
  const [identicalFirst, identicalSecond] = await Promise.all([
    executeTrial(temporaryRoot, "identical-first", identicalManifest),
    executeTrial(temporaryRoot, "identical-second", identicalManifest),
  ]);
  assert(
    identicalFirst.report.topologyLock.pass &&
      identicalFirst.report.topologyLock.exact.changedPixels === 0,
    "an identical keyed visible mask did not pass",
  );
  const repeatedDiffs = await Promise.all(
    [identicalFirst, identicalSecond].map(({ output }) =>
      fs.readFile(path.join(output, "topology-diff.png")),
    ),
  );
  assert(
    repeatedDiffs[0].equals(repeatedDiffs[1]),
    "repeated topology diff artifacts are not byte-identical",
  );

  const contourFile = path.join(temporaryRoot, "contour-reference.png");
  const contourBytes = await contourMutation(preparedFile, contourFile);
  const contour = await executeTrial(
    temporaryRoot,
    "contour-mutation",
    withLock(base, contourFile, contourBytes, ["topology-mask-drift"]),
  );
  assert(
    contour.report.topologyLock.exact.changedPixels === 1 &&
      contour.report.expectation.actualViolationCodes.includes(
        "topology-mask-drift",
      ),
    "a one-pixel contour mutation was not rejected as topology-mask-drift",
  );

  const translatedFile = path.join(temporaryRoot, "translated-reference.png");
  const translatedBytes = await translated(preparedFile, translatedFile);
  const translation = await executeTrial(
    temporaryRoot,
    "translated",
    withLock(base, translatedFile, translatedBytes, ["topology-mask-drift"]),
  );
  assert(
    translation.report.topologyLock.exact.changedPixels > 0 &&
      translation.report.topologyLock.bestAlignmentDiagnostic.changedPixels ===
        0 &&
      !translation.report.topologyLock.pass &&
      translation.report.expectation.actualViolationCodes.includes(
        "topology-mask-drift",
      ),
    "best-alignment diagnostics incorrectly excused an exact translation",
  );

  const staleHash = withLock(base, preparedFile, preparedBytes, []);
  staleHash.topologyLock.reference.sha256 = "0".repeat(64);
  let staleHashRejected = false;
  try {
    await executeTrial(temporaryRoot, "stale-hash", staleHash);
  } catch (error) {
    staleHashRejected = error.stderr.includes(
      "topologyLock reference has a stale sha256",
    );
  }
  assert(staleHashRejected, "a stale topology reference hash was accepted");

  const wrongDimensionsFile = path.join(temporaryRoot, "wrong-dimensions.png");
  const wrongDimensionsBytes = await sharp(preparedFile)
    .resize(255, 256, { fit: "fill", kernel: "nearest" })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  await fs.writeFile(wrongDimensionsFile, wrongDimensionsBytes);
  let wrongDimensionsRejected = false;
  try {
    await executeTrial(
      temporaryRoot,
      "wrong-dimensions",
      withLock(base, wrongDimensionsFile, wrongDimensionsBytes, []),
    );
  } catch (error) {
    wrongDimensionsRejected = error.stderr.includes(
      "topologyLock reference dimensions must be 256x256",
    );
  }
  assert(
    wrongDimensionsRejected,
    "a stale topology reference dimension was accepted",
  );

  console.log(
    "Topology lock oracle passed: identical mask accepted; one-pixel contour drift and exact translation rejected; alignment remained diagnostic; stale hash/dimensions rejected; repeated diff PNGs were byte-identical.",
  );
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
