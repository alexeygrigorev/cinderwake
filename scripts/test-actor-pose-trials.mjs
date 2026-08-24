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
  {
    id: "ashfang-idle-master-v3",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v3.json",
    expectedViolations: [],
    requiresReview: true,
  },
  {
    id: "ashfang-idle-master-v4",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v4.json",
    expectedViolations: [],
    requiresReview: true,
  },
  {
    id: "ashfang-idle-master-v5",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v5.json",
    expectedViolations: [],
    requiresReview: true,
  },
  {
    id: "ashfang-idle-master-v6",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v6.json",
    expectedViolations: ["runtime-aspect", "runtime-height"],
    requiresReview: true,
  },
  {
    id: "ashfang-idle-master-v7",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v7.json",
    expectedViolations: ["runtime-aspect", "runtime-height"],
    requiresReview: true,
  },
  {
    id: "ashfang-anatomy-blockout-v2",
    manifest: "art/generation/pose-trials/ashfang-anatomy-blockout-v2.json",
    expectedViolations: [],
    requiresReview: true,
  },
  {
    id: "ashfang-anatomy-blockout-v3",
    manifest: "art/generation/pose-trials/ashfang-anatomy-blockout-v3.json",
    expectedViolations: ["runtime-height"],
    requiresReview: true,
  },
  {
    id: "ashfang-anatomy-blockout-v4",
    manifest: "art/generation/pose-trials/ashfang-anatomy-blockout-v4.json",
    expectedViolations: [],
    requiresReview: true,
  },
  {
    id: "ashfang-idle-master-v8",
    manifest: "art/generation/pose-trials/ashfang-idle-master-v8.json",
    expectedViolations: [],
    requiresReview: true,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function visibleContact(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => {
    const offset = (y * info.width + x) * 4;
    return Math.min(
      data[offset + 3],
      keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
    );
  };
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1)
    for (let x = 0; x < info.width; x += 1) if (alphaAt(x, y) >= 24) bottom = y;
  let alphaWeight = 0;
  let weightedX = 0;
  for (let y = bottom - 7; y <= bottom; y += 1)
    for (let x = 0; x < info.width; x += 1) {
      const alpha = alphaAt(x, y);
      if (alpha < 24) continue;
      alphaWeight += alpha;
      weightedX += x * alpha;
    }
  return { bottom, centroidX: weightedX / alphaWeight };
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
      preparation.placementBounds.width === 165 &&
      preparation.placementBounds.height === 137 &&
      preparation.preparedBounds.top + preparation.preparedBounds.height ===
        232 &&
      Math.abs(preparation.contact.centroidOffsetFromAnchor) <= 0.5,
    "preserved-framing preparation magnified or distorted authored canvas occupancy",
  );
} finally {
  await fs.rm(framingRoot, { recursive: true, force: true });
}

const asymmetricRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-pose-asymmetric-contact-"),
);
try {
  const input = path.join(asymmetricRoot, "input.png");
  const output = path.join(asymmetricRoot, "output.png");
  const rectangle = async (width, height, background) =>
    sharp({
      create: { width, height, channels: 4, background },
    })
      .png()
      .toBuffer();
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 0, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: await rectangle(880, 620, {
          r: 40,
          g: 34,
          b: 42,
          alpha: 1,
        }),
        left: 60,
        top: 120,
      },
      {
        input: await rectangle(40, 160, {
          r: 34,
          g: 28,
          b: 36,
          alpha: 1,
        }),
        left: 60,
        top: 740,
      },
      {
        input: await rectangle(120, 160, {
          r: 34,
          g: 28,
          b: 36,
          alpha: 0.2,
        }),
        left: 100,
        top: 740,
      },
    ])
    .png()
    .toFile(input);
  const execution = await run(
    process.execPath,
    [
      path.join(root, "scripts", "prepare-actor-pose.mjs"),
      "--input",
      input,
      "--output",
      output,
      "--preserve-framing",
    ],
    { cwd: root },
  );
  const preparation = JSON.parse(execution.stdout);
  const contact = await visibleContact(output);
  assert(
    preparation.uniformScale < 0.2 &&
      preparation.preparedBounds.left >= 10 &&
      preparation.preparedBounds.left + preparation.preparedBounds.width <=
        246 &&
      contact.bottom === 231 &&
      Math.abs(contact.centroidX - 128) <= 0.5,
    "asymmetric alpha-weighted support was not shrunk and contact-aligned inside safe bounds",
  );
} finally {
  await fs.rm(asymmetricRoot, { recursive: true, force: true });
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
    report.verificationStatus === "pass" &&
      report.expectation.exactViolationSetMatch &&
      report.expectation.mechanicalOutcomeMet,
    `${trial.id} did not reproduce its exact mechanical outcome`,
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

const mechanicallyGreenTrial = trials.find(
  ({ expectedViolations }) => expectedViolations.length === 0,
);
assert(
  mechanicallyGreenTrial,
  "pose-trial suite is missing a mechanically green visual-veto fixture",
);
const reviewGateRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-pose-review-gate-"),
);
try {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, mechanicallyGreenTrial.manifest), "utf8"),
  );
  delete manifest.visualReview;
  const manifestPath = path.join(reviewGateRoot, "missing-review.json");
  const output = path.join(reviewGateRoot, "report");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let evidence = "";
  try {
    await run(
      process.execPath,
      [assessor, "--trial", manifestPath, "--output", output],
      { cwd: root },
    );
  } catch (error) {
    evidence = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  assert(
    evidence.includes("visual-review=required-but-missing"),
    "mechanically green pose passed without an exact-hash visual veto",
  );
  const report = JSON.parse(
    await fs.readFile(path.join(output, "report.json"), "utf8"),
  );
  assert(
    report.verificationStatus === "fail" &&
      report.expectation.visualReviewRequired &&
      !report.expectation.visualReviewSatisfied,
    "missing visual review did not remain an explicit failed verification",
  );
} finally {
  await fs.rm(reviewGateRoot, { recursive: true, force: true });
}

console.log(
  `Actor pose trials PASS: canonical 1024→256 framing reproduced twice, ${trials.length}/${trials.length} exact rejections reproduced, ${trials.length * 5}/${trials.length * 5} fixture-bound mutations caught, mechanically green missing-review mutation rejected, current exact-hash visual veto matched.`,
);
