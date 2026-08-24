import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const execute = promisify(execFile);
const root = process.cwd();
const preparer = path.join(root, "scripts", "prepare-actor-pose.mjs");
const magenta = { r: 255, g: 0, b: 255, alpha: 1 };
const ink = { r: 34, g: 120, b: 88, alpha: 1 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
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

function pixelAt(image, x, y) {
  const offset = (y * image.info.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}

function effectiveAlphaAt(image, pixel) {
  const offset = pixel * 4;
  return Math.min(
    image.data[offset + 3],
    keyedAlpha(
      image.data[offset],
      image.data[offset + 1],
      image.data[offset + 2],
    ),
  );
}

async function assertMatchingVisibleMasks(expectedFile, actualFile) {
  const [expected, actual] = await Promise.all(
    [expectedFile, actualFile].map((file) => rgba(file)),
  );
  assert(
    expected.info.width === actual.info.width &&
      expected.info.height === actual.info.height,
    "prepared mask dimensions differ",
  );
  let mismatches = 0;
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    const pixel = offset / 4;
    const expectedVisible = effectiveAlphaAt(expected, pixel) >= 24;
    const actualVisible = effectiveAlphaAt(actual, pixel) >= 24;
    if (expectedVisible !== actualVisible) mismatches += 1;
  }
  assert(mismatches === 0, `${mismatches} prepared mask pixels differ`);
  return actual;
}

async function assertMatchingEffectiveAlpha(expectedFile, actualFile) {
  const [expected, actual] = await Promise.all(
    [expectedFile, actualFile].map((file) => rgba(file)),
  );
  let mismatches = 0;
  for (
    let pixel = 0;
    pixel < expected.info.width * expected.info.height;
    pixel += 1
  )
    if (effectiveAlphaAt(expected, pixel) !== effectiveAlphaAt(actual, pixel))
      mismatches += 1;
  assert(mismatches === 0, `${mismatches} prepared alpha pixels differ`);
}

async function assertOpaqueMagentaBackground(file, label) {
  const image = await rgba(file);
  let nonOpaquePixels = 0;
  let literalMagentaPixels = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] !== 255) nonOpaquePixels += 1;
    if (
      image.data[offset] === 255 &&
      image.data[offset + 1] === 0 &&
      image.data[offset + 2] === 255 &&
      image.data[offset + 3] === 255
    )
      literalMagentaPixels += 1;
  }
  const corners = [
    pixelAt(image, 0, 0),
    pixelAt(image, image.info.width - 1, 0),
    pixelAt(image, 0, image.info.height - 1),
    pixelAt(image, image.info.width - 1, image.info.height - 1),
  ];
  assert(
    nonOpaquePixels === 0 &&
      literalMagentaPixels / (image.info.width * image.info.height) >= 0.2 &&
      corners.every((pixel) => pixel.join(",") === "255,0,255,255"),
    `${label} is not an opaque literal-magenta prepared cell`,
  );
  return image;
}

async function expectFailure(arguments_, message, output) {
  let evidence = "";
  try {
    await execute(process.execPath, [preparer, ...arguments_], { cwd: root });
  } catch (error) {
    evidence = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  assert(evidence.includes(message), `missing failure evidence: ${message}`);
  if (output)
    assert(
      !(await fs
        .access(output)
        .then(() => true)
        .catch(() => false)),
      `failed preparation left partial output ${output}`,
    );
}

const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-topology-stencil-"),
);
try {
  const legacyManifest = JSON.parse(
    await fs.readFile(
      path.join(root, "art/generation/pose-trials/ashfang-idle-master-v2.json"),
      "utf8",
    ),
  );
  const legacyOutputs = ["legacy-first.png", "legacy-second.png"].map((file) =>
    path.join(temporaryRoot, file),
  );
  for (const output of legacyOutputs)
    await execute(
      process.execPath,
      [
        preparer,
        "--input",
        path.join(root, legacyManifest.candidateFile),
        "--output",
        output,
      ],
      { cwd: root },
    );
  const [legacyFirst, legacySecond] = await Promise.all(
    legacyOutputs.map((file) => fs.readFile(file)),
  );
  assert(
    legacyFirst.equals(legacySecond),
    "legacy preparation is not byte-deterministic",
  );
  assert(
    sha256(legacyFirst) === legacyManifest.preparation.sha256,
    "opt-in topology work changed a historical legacy preparation hash",
  );

  const candidate = path.join(temporaryRoot, "candidate.png");
  const reference = path.join(temporaryRoot, "reference.png");
  const expected = path.join(temporaryRoot, "reference-prepared.png");
  const outputs = ["topology-first.png", "topology-second.png"].map((file) =>
    path.join(temporaryRoot, file),
  );
  const rectangle = (width, height, background) =>
    sharp({
      create: { width, height, channels: 4, background },
    })
      .png()
      .toBuffer();
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: magenta },
  })
    .composite([
      {
        input: await rectangle(350, 400, ink),
        left: 400,
        top: 300,
      },
    ])
    .png()
    .toFile(candidate);
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: magenta },
  })
    .composite([
      {
        input: await rectangle(400, 400, { r: 12, g: 12, b: 12, alpha: 1 }),
        left: 300,
        top: 300,
      },
    ])
    .png()
    .toFile(reference);
  await execute(
    process.execPath,
    [preparer, "--input", reference, "--output", expected],
    { cwd: root },
  );

  let diagnostics;
  for (const output of outputs) {
    const execution = await execute(
      process.execPath,
      [
        preparer,
        "--input",
        candidate,
        "--output",
        output,
        "--topology-mask",
        reference,
      ],
      { cwd: root },
    );
    const report = JSON.parse(execution.stdout);
    if (diagnostics)
      assert(
        JSON.stringify(report.topology) === JSON.stringify(diagnostics),
        "topology diagnostics are not deterministic",
      );
    diagnostics = report.topology;
  }
  const [first, second] = await Promise.all(
    outputs.map((file) => fs.readFile(file)),
  );
  assert(first.equals(second), "topology-enforced output is not deterministic");
  assert(
    diagnostics.reference === path.relative(root, reference) &&
      diagnostics.coordinateSpace === "1024x1024" &&
      diagnostics.candidateVisiblePixels === 140_000 &&
      diagnostics.referenceVisiblePixels === 160_000 &&
      diagnostics.referenceAntialiasPixels === 0 &&
      diagnostics.candidateMissingVisiblePixels === 40_000 &&
      diagnostics.candidateExtraVisiblePixels === 20_000 &&
      diagnostics.changedVisiblePixels === 60_000 &&
      diagnostics.changedPixels === 60_000 &&
      diagnostics.exactMaskAfterEnforcement === true,
    "topology diagnostics do not exactly describe the synthetic contours",
  );
  const actual = await assertMatchingVisibleMasks(expected, outputs[0]);
  assert(
    pixelAt(actual, 30, 100).slice(0, 3).join(",") === "34,120,88",
    "a missing reference-foreground region was not filled from candidate ink",
  );
  assert(
    pixelAt(actual, 245, 100).slice(0, 3).join(",") === "255,0,255",
    "candidate ink outside the topology mask was not clipped to literal magenta",
  );
  assert(
    pixelAt(actual, 0, 0).slice(0, 3).join(",") === "255,0,255",
    "prepared background is not literal magenta",
  );

  const preparedReferenceOutput = path.join(
    temporaryRoot,
    "prepared-reference-output.png",
  );
  const preparedReferenceExecution = await execute(
    process.execPath,
    [
      preparer,
      "--input",
      candidate,
      "--output",
      preparedReferenceOutput,
      "--topology-mask",
      expected,
    ],
    { cwd: root },
  );
  const preparedReferenceReport = JSON.parse(preparedReferenceExecution.stdout);
  assert(
    preparedReferenceReport.topology.coordinateSpace === "1024x1024" &&
      preparedReferenceReport.topology.referenceVisiblePixels > 0 &&
      preparedReferenceReport.topology.exactMaskAfterEnforcement === true,
    "a prepared 256px topology reference was not normalized and enforced",
  );
  assert(
    pixelAt(await rgba(preparedReferenceOutput), 0, 0)
      .slice(0, 3)
      .join(",") === "255,0,255",
    "prepared-reference enforcement lost its literal-magenta background",
  );

  const syntheticPreparedOutput = path.join(
    temporaryRoot,
    "synthetic-prepared-locked.png",
  );
  const syntheticPreparedExecution = await execute(
    process.execPath,
    [
      preparer,
      "--input",
      candidate,
      "--output",
      syntheticPreparedOutput,
      "--topology-mask",
      reference,
      "--prepared-topology-mask",
      expected,
    ],
    { cwd: root },
  );
  const syntheticPreparedReport = JSON.parse(syntheticPreparedExecution.stdout);
  assert(
    syntheticPreparedReport.preparedTopology.exactFinalMask === true &&
      syntheticPreparedReport.preparedTopology.finalMaskMismatchPixels === 0 &&
      syntheticPreparedReport.preparedTopology.finalAlphaMismatchPixels === 0 &&
      syntheticPreparedReport.preparedTopology.background.opaquePixels ===
        65_536 &&
      syntheticPreparedReport.preparedTopology.background.literalMagentaRatio >=
        0.2 &&
      syntheticPreparedReport.preparedTopology.background
        .cornersLiteralMagenta === true,
    "synthetic prepared topology did not enforce the opaque chroma-key contract",
  );
  await Promise.all([
    assertMatchingVisibleMasks(expected, syntheticPreparedOutput),
    assertMatchingEffectiveAlpha(expected, syntheticPreparedOutput),
    assertOpaqueMagentaBackground(
      syntheticPreparedOutput,
      "synthetic prepared topology output",
    ),
  ]);

  const realisticCandidate = path.join(
    root,
    "art/generation/candidates/ashfang-idle-master-v8.png",
  );
  const realisticRawTopology = path.join(
    root,
    "art/generation/candidates/ashfang-anatomy-blockout-v4.png",
  );
  const realisticPreparedTopology = path.join(
    root,
    "art/generation/prepared/ashfang-anatomy-blockout-v4.png",
  );
  const realisticRawOnly = path.join(temporaryRoot, "realistic-raw-only.png");
  await execute(
    process.execPath,
    [
      preparer,
      "--input",
      realisticCandidate,
      "--output",
      realisticRawOnly,
      "--preserve-framing",
      "--topology-mask",
      realisticRawTopology,
    ],
    { cwd: root },
  );
  const realisticOutputs = [
    "realistic-locked-first.png",
    "realistic-locked-second.png",
  ].map((file) => path.join(temporaryRoot, file));
  let realisticReport;
  for (const output of realisticOutputs) {
    const execution = await execute(
      process.execPath,
      [
        preparer,
        "--input",
        realisticCandidate,
        "--output",
        output,
        "--preserve-framing",
        "--topology-mask",
        realisticRawTopology,
        "--prepared-topology-mask",
        realisticPreparedTopology,
      ],
      { cwd: root },
    );
    const report = JSON.parse(execution.stdout);
    if (realisticReport)
      assert(
        JSON.stringify(report.preparedTopology) ===
          JSON.stringify(realisticReport.preparedTopology),
        "prepared topology diagnostics are not deterministic",
      );
    realisticReport = report;
  }
  const [realisticFirst, realisticSecond] = await Promise.all(
    realisticOutputs.map((file) => fs.readFile(file)),
  );
  assert(
    realisticFirst.equals(realisticSecond),
    "prepared-topology output is not byte-deterministic",
  );
  assert(
    realisticReport.topology.exactMaskAfterEnforcement === true &&
      realisticReport.preparedTopology.reference ===
        path.relative(root, realisticPreparedTopology) &&
      realisticReport.preparedTopology.sha256 ===
        sha256(await fs.readFile(realisticPreparedTopology)) &&
      realisticReport.preparedTopology.coordinateSpace === "256x256" &&
      realisticReport.preparedTopology.candidateMissingVisiblePixels > 0 &&
      realisticReport.preparedTopology.candidateExtraVisiblePixels > 0 &&
      realisticReport.preparedTopology.changedVisiblePixels ===
        realisticReport.preparedTopology.candidateMissingVisiblePixels +
          realisticReport.preparedTopology.candidateExtraVisiblePixels &&
      realisticReport.preparedTopology.exactMaskAfterEnforcement === true &&
      realisticReport.preparedTopology.exactAlphaAfterEnforcement === true &&
      realisticReport.preparedTopology.finalMaskMismatchPixels === 0 &&
      realisticReport.preparedTopology.finalAlphaMismatchPixels === 0 &&
      realisticReport.preparedTopology.exactFinalMask === true &&
      realisticReport.preparedTopology.background.opaquePixels === 65_536 &&
      realisticReport.preparedTopology.background.literalMagentaRatio >= 0.2 &&
      realisticReport.preparedTopology.background.cornersLiteralMagenta ===
        true &&
      realisticReport.preparedBounds.left === 14 &&
      realisticReport.preparedBounds.top === 76 &&
      realisticReport.preparedBounds.width === 148 &&
      realisticReport.preparedBounds.height === 156 &&
      realisticReport.preparedBounds.top +
        realisticReport.preparedBounds.height ===
        realisticReport.footAnchor.y &&
      Math.abs(realisticReport.contact.centroidOffsetFromAnchor) <= 0.5,
    "combined raw/prepared topology diagnostics or final grounding are invalid",
  );
  const [rawOnlyImage, preparedReferenceImage, realisticLockedImage] =
    await Promise.all(
      [realisticRawOnly, realisticPreparedTopology, realisticOutputs[0]].map(
        (file) => rgba(file),
      ),
    );
  let missingPixel = -1;
  let extraPixel = -1;
  for (
    let pixel = 0;
    pixel <
    preparedReferenceImage.info.width * preparedReferenceImage.info.height;
    pixel += 1
  ) {
    const referenceAlpha = effectiveAlphaAt(preparedReferenceImage, pixel);
    const rawOnlyAlpha = effectiveAlphaAt(rawOnlyImage, pixel);
    if (missingPixel < 0 && referenceAlpha >= 24 && rawOnlyAlpha < 24)
      missingPixel = pixel;
    const referenceColor = pixelAt(
      preparedReferenceImage,
      pixel % preparedReferenceImage.info.width,
      Math.floor(pixel / preparedReferenceImage.info.width),
    );
    if (
      extraPixel < 0 &&
      referenceAlpha === 0 &&
      rawOnlyAlpha >= 24 &&
      referenceColor.slice(0, 3).join(",") === "255,0,255"
    )
      extraPixel = pixel;
  }
  assert(
    missingPixel >= 0 && extraPixel >= 0,
    "realistic raw-only render did not expose both post-resample gap classes",
  );
  assert(
    effectiveAlphaAt(realisticLockedImage, missingPixel) >= 24 &&
      pixelAt(
        realisticLockedImage,
        missingPixel % realisticLockedImage.info.width,
        Math.floor(missingPixel / realisticLockedImage.info.width),
      )
        .slice(0, 3)
        .join(",") !== "255,0,255",
    "prepared topology did not fill a realistic missing contour pixel",
  );
  assert(
    effectiveAlphaAt(realisticLockedImage, extraPixel) === 0 &&
      pixelAt(
        realisticLockedImage,
        extraPixel % realisticLockedImage.info.width,
        Math.floor(extraPixel / realisticLockedImage.info.width),
      ).join(",") === "255,0,255,255",
    "prepared topology did not clip a realistic extra contour pixel",
  );
  await Promise.all([
    assertMatchingVisibleMasks(realisticPreparedTopology, realisticOutputs[0]),
    assertMatchingEffectiveAlpha(
      realisticPreparedTopology,
      realisticOutputs[0],
    ),
    assertOpaqueMagentaBackground(
      realisticOutputs[0],
      "realistic prepared topology output",
    ),
  ]);

  const v9Candidate = path.join(
    root,
    "art/generation/candidates/ashfang-idle-master-v9.png",
  );
  const v9Outputs = ["v9-opaque-first.png", "v9-opaque-second.png"].map(
    (file) => path.join(temporaryRoot, file),
  );
  let v9PreparedDiagnostics;
  for (const output of v9Outputs) {
    const execution = await execute(
      process.execPath,
      [
        preparer,
        "--input",
        v9Candidate,
        "--output",
        output,
        "--preserve-framing",
        "--topology-mask",
        realisticRawTopology,
        "--prepared-topology-mask",
        realisticPreparedTopology,
      ],
      { cwd: root },
    );
    const report = JSON.parse(execution.stdout);
    if (v9PreparedDiagnostics)
      assert(
        JSON.stringify(report.preparedTopology) ===
          JSON.stringify(v9PreparedDiagnostics),
        "v9 prepared topology diagnostics are not deterministic",
      );
    v9PreparedDiagnostics = report.preparedTopology;
  }
  const [v9First, v9Second] = await Promise.all(
    v9Outputs.map((file) => fs.readFile(file)),
  );
  assert(
    v9First.equals(v9Second) &&
      sha256(v9First) ===
        "b131df47004ac0288ad76d546183bd5a9f84e1b743b26a3c54da1c2bf36c1b9f",
    "v9 opaque two-stage preparation did not reproduce its exact hash",
  );
  assert(
    v9PreparedDiagnostics.candidateMissingVisiblePixels === 178 &&
      v9PreparedDiagnostics.candidateExtraVisiblePixels === 492 &&
      v9PreparedDiagnostics.alphaFallbackPixels === 91 &&
      v9PreparedDiagnostics.finalMaskMismatchPixels === 0 &&
      v9PreparedDiagnostics.finalAlphaMismatchPixels === 0 &&
      v9PreparedDiagnostics.background.opaquePixels === 65_536 &&
      v9PreparedDiagnostics.background.literalMagentaPixels === 55_582 &&
      v9PreparedDiagnostics.background.cornersLiteralMagenta === true,
    "v9 did not reproduce its exact post-resample repair diagnostics",
  );
  await Promise.all([
    assertMatchingVisibleMasks(realisticPreparedTopology, v9Outputs[0]),
    assertMatchingEffectiveAlpha(realisticPreparedTopology, v9Outputs[0]),
    assertOpaqueMagentaBackground(v9Outputs[0], "v9 prepared topology output"),
  ]);

  const blank = path.join(temporaryRoot, "blank.png");
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: magenta },
  })
    .png()
    .toFile(blank);
  await expectFailure(
    [
      "--input",
      blank,
      "--output",
      path.join(temporaryRoot, "blank-candidate-output.png"),
      "--topology-mask",
      reference,
    ],
    "isolated pose is blank",
    path.join(temporaryRoot, "blank-candidate-output.png"),
  );
  await expectFailure(
    [
      "--input",
      candidate,
      "--output",
      path.join(temporaryRoot, "blank-reference-output.png"),
      "--topology-mask",
      blank,
    ],
    "topology mask is blank",
    path.join(temporaryRoot, "blank-reference-output.png"),
  );
  await expectFailure(
    [
      "--input",
      candidate,
      "--output",
      path.join(temporaryRoot, "stale-reference-output.png"),
      "--topology-mask",
      path.join(temporaryRoot, "stale-reference.png"),
    ],
    "stale-reference.png",
    path.join(temporaryRoot, "stale-reference-output.png"),
  );
  const blankPrepared = path.join(temporaryRoot, "blank-prepared.png");
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: magenta },
  })
    .png()
    .toFile(blankPrepared);
  await expectFailure(
    [
      "--input",
      realisticCandidate,
      "--output",
      path.join(temporaryRoot, "blank-prepared-output.png"),
      "--prepared-topology-mask",
      blankPrepared,
    ],
    "prepared topology mask is blank",
    path.join(temporaryRoot, "blank-prepared-output.png"),
  );
  await expectFailure(
    [
      "--input",
      realisticCandidate,
      "--output",
      path.join(temporaryRoot, "wrong-size-prepared-output.png"),
      "--prepared-topology-mask",
      blank,
    ],
    "Prepared topology mask must be exactly 256x256",
    path.join(temporaryRoot, "wrong-size-prepared-output.png"),
  );
  await expectFailure(
    [
      "--input",
      realisticCandidate,
      "--output",
      path.join(temporaryRoot, "stale-prepared-output.png"),
      "--prepared-topology-mask",
      path.join(temporaryRoot, "stale-prepared.png"),
    ],
    "stale-prepared.png",
    path.join(temporaryRoot, "stale-prepared-output.png"),
  );
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "Actor topology stencil PASS: legacy hash unchanged; source and exact prepared masks enforced deterministically; realistic v8/v9 post-resample holes filled and extras clipped; final alpha exact on an opaque literal-magenta background; diagnostics exact; blank, wrong-size, and stale inputs rejected without partial output.",
);
