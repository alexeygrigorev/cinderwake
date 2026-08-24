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
const actorSpec = JSON.parse(
  await fs.readFile(path.join(root, "art", "actor-atlas-v1.json"), "utf8"),
);
const gameConstantsSource = await fs.readFile(
  path.join(root, "src", "game", "constants.ts"),
  "utf8",
);
const sourceCell = actorSpec.source.cellWidth;
const runtimeCell = actorSpec.atlas.cellWidth;
const sourceScale = sourceCell / runtimeCell;
const sourceSafeBounds = {
  x: actorSpec.atlas.safeInkBounds.x * sourceScale,
  y: actorSpec.atlas.safeInkBounds.y * sourceScale,
  width: actorSpec.atlas.safeInkBounds.width * sourceScale,
  height: actorSpec.atlas.safeInkBounds.height * sourceScale,
};
const sourceFootAnchor = {
  x: actorSpec.atlas.footAnchor.x * sourceScale,
  y: actorSpec.atlas.footAnchor.y * sourceScale,
};
const defaultTrial = path.join(
  root,
  "art",
  "generation",
  "pose-trials",
  "ashfang-idle-master-v1.json",
);
const defaultOutput = path.join(
  root,
  "quality-results",
  "actor-pose",
  "ashfang-idle-master-v1",
);

function gameConstant(name) {
  const value = Number(
    gameConstantsSource.match(
      new RegExp(`export const ${name}\\s*=\\s*(\\d+)`),
    )?.[1],
  );
  if (!Number.isFinite(value)) throw new Error(`Unable to read ${name}`);
  return value;
}

const collisionContract = {
  collisionRadiusWorldUnits: gameConstant("MONSTER_RADIUS"),
  unitsPerTile: gameConstant("UNITS_PER_TILE"),
  tilePixels: gameConstant("TILE_PIXELS"),
};

function parseArguments(arguments_) {
  const options = { trial: defaultTrial, output: defaultOutput };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      console.log(`Usage: node scripts/assess-actor-pose.mjs [options]

Options:
  --trial <json>        Isolated-pose trial provenance and expected verdict
  --output <directory> Derived mechanical and visual evidence`);
      process.exit(0);
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--trial" && name !== "--output")
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    options[name.slice(2)] = path.resolve(root, value);
  }
  return options;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
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

async function keyedImage(fileOrBuffer, { normalizeTo } = {}) {
  const image = sharp(fileOrBuffer);
  if (normalizeTo)
    image.resize(normalizeTo, normalizeTo, {
      fit: "fill",
      kernel: "lanczos3",
    });
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let literalMagentaPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (
      data[offset] === 255 &&
      data[offset + 1] === 0 &&
      data[offset + 2] === 255 &&
      data[offset + 3] === 255
    )
      literalMagentaPixels += 1;
    data[offset + 3] = Math.min(
      data[offset + 3],
      keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
    );
    if (data[offset + 3] < 8) data[offset + 3] = 0;
  }
  return {
    data,
    info,
    literalMagentaRatio: literalMagentaPixels / (info.width * info.height),
  };
}

function imageEvidence(image, label) {
  let left = image.info.width;
  let top = image.info.height;
  let right = -1;
  let bottom = -1;
  let foregroundPixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < image.info.height; y += 1) {
    for (let x = 0; x < image.info.width; x += 1) {
      const alpha = image.data[(y * image.info.width + x) * 4 + 3];
      if (alpha < 8) continue;
      foregroundPixels += 1;
      alphaWeight += alpha;
      weightedX += x * alpha;
      weightedY += y * alpha;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (foregroundPixels === 0) throw new Error(`${label} is blank`);
  const width = right - left + 1;
  const height = bottom - top + 1;
  return {
    label,
    foregroundPixels,
    bounds: {
      left,
      top,
      right,
      bottom,
      width,
      height,
      aspectRatio: rounded(width / height),
    },
    centroid: {
      x: rounded(weightedX / alphaWeight),
      y: rounded(weightedY / alphaWeight),
    },
  };
}

function contactEvidence(image, targets) {
  const expectedFootY = actorSpec.atlas.footAnchor.y - 1;
  const firstY = expectedFootY - targets.runtimeContactBandHeight + 1;
  let pixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let minimumX = image.info.width;
  let maximumX = -1;
  for (let y = firstY; y <= expectedFootY; y += 1) {
    for (let x = 0; x < image.info.width; x += 1) {
      const alpha = image.data[(y * image.info.width + x) * 4 + 3];
      if (alpha < 8) continue;
      pixels += 1;
      alphaWeight += alpha;
      weightedX += x * alpha;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
    }
  }
  if (pixels === 0)
    return {
      pixels,
      band: { firstY, lastY: expectedFootY },
      span: null,
      centroidX: null,
      centroidOffsetFromAnchor: null,
      anchorIntersectsSpan: false,
    };
  const centroidX = weightedX / alphaWeight;
  return {
    pixels,
    band: { firstY, lastY: expectedFootY },
    span: {
      minimumX,
      maximumX,
      width: maximumX - minimumX + 1,
    },
    centroidX: rounded(centroidX),
    centroidOffsetFromAnchor: rounded(centroidX - actorSpec.atlas.footAnchor.x),
    anchorIntersectsSpan:
      minimumX <= actorSpec.atlas.footAnchor.x &&
      maximumX >= actorSpec.atlas.footAnchor.x,
  };
}

async function projectRuntime(preparedImage) {
  const buffer = await sharp(preparedImage.data, { raw: preparedImage.info })
    .resize(runtimeCell, runtimeCell, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  return { buffer, image: await keyedImage(buffer) };
}

function assessPose(prepared, runtime, targets) {
  const source = imageEvidence(prepared, "prepared source cell");
  const projected = imageEvidence(runtime, "projected runtime cell");
  const contact = contactEvidence(runtime, targets);
  const violations = [];
  if (prepared.info.width !== sourceCell || prepared.info.height !== sourceCell)
    violations.push({
      code: "prepared-dimensions",
      actual: `${prepared.info.width}x${prepared.info.height}`,
      expected: `${sourceCell}x${sourceCell}`,
    });
  if (prepared.literalMagentaRatio < 0.2)
    violations.push({
      code: "literal-magenta-ratio",
      actual: rounded(prepared.literalMagentaRatio),
      minimum: 0.2,
    });
  if (
    source.bounds.left < sourceSafeBounds.x ||
    source.bounds.top < sourceSafeBounds.y ||
    source.bounds.right >= sourceSafeBounds.x + sourceSafeBounds.width ||
    source.bounds.bottom >= sourceSafeBounds.y + sourceSafeBounds.height
  )
    violations.push({
      code: "safe-ink-bounds",
      bounds: source.bounds,
      safeBounds: sourceSafeBounds,
    });
  if (source.bounds.bottom !== targets.sourceFootInkY)
    violations.push({
      code: "foot-anchor",
      actual: source.bounds.bottom,
      expected: targets.sourceFootInkY,
    });
  if (
    projected.bounds.height < targets.runtimeHeightMinimum ||
    projected.bounds.height > targets.runtimeHeightMaximum
  )
    violations.push({
      code: "runtime-height",
      actual: projected.bounds.height,
      range: [targets.runtimeHeightMinimum, targets.runtimeHeightMaximum],
    });
  if (projected.bounds.aspectRatio > targets.runtimeAspectRatioMaximum)
    violations.push({
      code: "runtime-aspect",
      actual: projected.bounds.aspectRatio,
      maximum: targets.runtimeAspectRatioMaximum,
    });
  const contactOffset = Math.abs(contact.centroidOffsetFromAnchor ?? Infinity);
  if (
    contactOffset > targets.runtimeContactCentroidOffsetMaximum ||
    (targets.runtimeAnchorMustIntersectContactSpan &&
      !contact.anchorIntersectsSpan)
  )
    violations.push({
      code: "contact-footprint",
      contact,
      maximumCentroidOffset: targets.runtimeContactCentroidOffsetMaximum,
      collisionRadiusLogicalPixels: rounded(
        (targets.collisionRadiusWorldUnits / targets.unitsPerTile) *
          targets.tilePixels,
      ),
    });
  return {
    pass: violations.length === 0,
    prepared: {
      ...source,
      literalMagentaRatio: rounded(prepared.literalMagentaRatio),
    },
    runtime: { ...projected, contact },
    violations,
  };
}

async function spriteFromPrepared(prepared, width, height, left, top) {
  const bounds = imageEvidence(prepared, "fixture source").bounds;
  const sprite = await sharp(prepared.data, { raw: prepared.info })
    .extract({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    })
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .png()
    .toBuffer();
  const buffer = await sharp({
    create: {
      width: sourceCell,
      height: sourceCell,
      channels: 4,
      background: { r: 255, g: 0, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: sprite, left, top }])
    .png()
    .toBuffer();
  return keyedImage(buffer);
}

async function contactCenteredFixture(prepared, width, height, top, targets) {
  const initialLeft = Math.round(sourceFootAnchor.x - width / 2);
  const initial = await spriteFromPrepared(
    prepared,
    width,
    height,
    initialLeft,
    top,
  );
  const runtime = await projectRuntime(initial);
  const contact = contactEvidence(runtime.image, targets);
  if (contact.centroidOffsetFromAnchor === null)
    throw new Error("Unable to find fixture contact footprint");
  const correctedLeft =
    initialLeft - Math.round(contact.centroidOffsetFromAnchor * sourceScale);
  return {
    prepared: await spriteFromPrepared(
      prepared,
      width,
      height,
      correctedLeft,
      top,
    ),
    left: correctedLeft,
  };
}

async function negativeControls(prepared, targets) {
  const validFixture = await contactCenteredFixture(
    prepared,
    180,
    160,
    72,
    targets,
  );
  const fixtureRuntime = await projectRuntime(validFixture.prepared);
  const fixtureAssessment = assessPose(
    validFixture.prepared,
    fixtureRuntime.image,
    targets,
  );
  if (!fixtureAssessment.pass)
    throw new Error(
      `Synthetic detector fixture must pass: ${fixtureAssessment.violations.map(({ code }) => code).join(", ")}`,
    );
  const definitions = [
    {
      id: "edge-cut",
      expectedViolation: "safe-ink-bounds",
      prepared: await spriteFromPrepared(prepared, 180, 160, 4, 72),
    },
    {
      id: "floating-anchor",
      expectedViolation: "foot-anchor",
      prepared: await spriteFromPrepared(
        prepared,
        180,
        160,
        validFixture.left,
        56,
      ),
    },
    {
      id: "overwide-silhouette",
      expectedViolation: "runtime-aspect",
      prepared: await spriteFromPrepared(prepared, 230, 150, 13, 82),
    },
    {
      id: "undersized-silhouette",
      expectedViolation: "runtime-height",
      prepared: (await contactCenteredFixture(prepared, 160, 120, 112, targets))
        .prepared,
    },
    {
      id: "collision-contact-offset",
      expectedViolation: "contact-footprint",
      prepared: await spriteFromPrepared(
        prepared,
        180,
        160,
        validFixture.left + 24,
        72,
      ),
    },
  ];
  return Promise.all(
    definitions.map(async ({ id, expectedViolation, prepared: mutation }) => {
      const runtime = await projectRuntime(mutation);
      const assessment = assessPose(mutation, runtime.image, targets);
      return {
        id,
        expectedViolation,
        detected: assessment.violations.some(
          ({ code }) => code === expectedViolation,
        ),
        violations: assessment.violations.map(({ code }) => code),
      };
    }),
  );
}

async function validateFile(record, label) {
  const filePath = path.resolve(root, record.file ?? record);
  const bytes = await fs.readFile(filePath);
  if (record.sha256 && sha256(bytes) !== record.sha256)
    throw new Error(`${label} has a stale sha256`);
  return { filePath, bytes, sha256: sha256(bytes) };
}

async function reproducePreparation(trial) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-pose-ingress-"),
  );
  try {
    const first = path.join(temporaryRoot, "prepared-a.png");
    const second = path.join(temporaryRoot, "prepared-b.png");
    const script = path.join(root, "scripts", "prepare-actor-pose.mjs");
    const input = path.resolve(root, trial.candidateFile);
    for (const output of [first, second]) {
      const arguments_ = [script, "--input", input, "--output", output];
      if (trial.preparation.preserveFraming)
        arguments_.push("--preserve-framing");
      const result = await executeFile(process.execPath, arguments_, {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (result.stderr.trim())
        throw new Error(`Pose preparation wrote to stderr: ${result.stderr}`);
    }
    const [firstBytes, secondBytes, committedBytes] = await Promise.all([
      fs.readFile(first),
      fs.readFile(second),
      fs.readFile(path.resolve(root, trial.preparation.file)),
    ]);
    const firstSha256 = sha256(firstBytes);
    const secondSha256 = sha256(secondBytes);
    const committedSha256 = sha256(committedBytes);
    if (
      firstSha256 !== secondSha256 ||
      firstSha256 !== committedSha256 ||
      firstSha256 !== trial.preparation.sha256
    )
      throw new Error(
        "Pose preparation is not byte-identical to committed output",
      );
    return {
      command: trial.preparation.command,
      sha256: firstSha256,
      deterministicRepeatSha256Match: true,
      byteIdenticalToCommitted: true,
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function svgBuffer(value) {
  return Buffer.from(value);
}

async function alphaPreview(image) {
  const data = Buffer.from(image.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    data[offset] = 235;
    data[offset + 1] = 225;
    data[offset + 2] = 205;
    data[offset + 3] = alpha;
  }
  return sharp(data, { raw: image.info }).png().toBuffer();
}

async function writePoseEvidence(
  candidatePath,
  preparedPath,
  prepared,
  runtimeBuffer,
  outputPath,
) {
  const tile = 256;
  const gap = 16;
  const header = 42;
  const width = tile * 4 + gap * 5;
  const height = header + tile + 38;
  const checker = `<pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#243033"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#1b2629"/></pattern>`;
  const labels = ["raw", "prepared 256", "runtime 128 × 2", "alpha mask"];
  const decoration = svgBuffer(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs>${checker}</defs><rect width="100%" height="100%" fill="#0e0b0e"/>${labels
      .map((label, index) => {
        const x = gap + index * (tile + gap);
        return `<text x="${x}" y="27" fill="#f1c77d" font-family="sans-serif" font-size="15">${label}</text><rect x="${x}" y="${header}" width="${tile}" height="${tile}" fill="url(#c)" stroke="#59464a"/>`;
      })
      .join(
        "",
      )}<text x="${gap}" y="${height - 10}" fill="#bda99b" font-family="sans-serif" font-size="12">Dashed safe region and foot anchor are measured in report.json.</text></svg>`,
  );
  const raw = await sharp(candidatePath)
    .resize(tile, tile, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const preparedDisplay = await sharp(preparedPath).png().toBuffer();
  const runtimeDisplay = await sharp(runtimeBuffer)
    .resize(tile, tile, { kernel: "nearest" })
    .png()
    .toBuffer();
  const alphaDisplay = await alphaPreview(prepared);
  await sharp(decoration)
    .composite(
      [raw, preparedDisplay, runtimeDisplay, alphaDisplay].map(
        (input, index) => ({
          input,
          left: gap + index * (tile + gap),
          top: header,
        }),
      ),
    )
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function atlasFrame(actorId) {
  return sharp(
    path.join(root, "public", "assets", "sprites", `actor-${actorId}.png`),
  )
    .extract({ left: 0, top: 0, width: runtimeCell, height: runtimeCell })
    .png()
    .toBuffer();
}

async function writeScaleComparison(runtimeBuffer, outputPath) {
  const actors = [
    { label: "isolated master", buffer: runtimeBuffer },
    { label: "production Ashfang", buffer: await atlasFrame("ashfang") },
    { label: "Vanguard", buffer: await atlasFrame("vanguard") },
    { label: "Hexer", buffer: await atlasFrame("hexer") },
    { label: "Stonekin", buffer: await atlasFrame("stonekin") },
  ];
  const tile = 168;
  const width = tile * actors.length;
  const height = 214;
  const decoration = svgBuffer(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#121014"/><path d="M0 174 H${width}" stroke="#b4723b" stroke-width="2"/>${actors
      .map(
        ({ label }, index) =>
          `<text x="${index * tile + 8}" y="202" fill="#e4d2bd" font-family="sans-serif" font-size="12">${label}</text>`,
      )
      .join("")}</svg>`,
  );
  await sharp(decoration)
    .composite(
      await Promise.all(
        actors.map(async ({ buffer }, index) => ({
          input: await sharp(buffer)
            .resize(160, 160, { kernel: "nearest" })
            .png()
            .toBuffer(),
          left: index * tile + 4,
          top: 14,
        })),
      ),
    )
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlReport(report) {
  const failures = report.trial.semanticReview.failed
    .map(
      ({ code, detail }) =>
        `<li><strong>${escapeHtml(code)}</strong>: ${escapeHtml(detail)}</li>`,
    )
    .join("");
  const mechanical = report.assessment.violations
    .map(
      ({ code, actual }) =>
        `<li><strong>${escapeHtml(code)}</strong>${actual === undefined ? "" : `: ${actual}`}</li>`,
    )
    .join("");
  const controls = report.negativeControls
    .map(
      ({ id, detected, violations }) =>
        `<li><strong>${escapeHtml(id)}</strong>: ${detected ? "caught" : "MISSED"} — ${escapeHtml(violations.join(", "))}</li>`,
    )
    .join("");
  const independentReview = report.visualReview
    ? `<h2>Independent exact-hash review</h2><p>Verdict: <strong>${escapeHtml(report.visualReview.verdict)}</strong> · reviewer <code>${escapeHtml(report.visualReview.reviewer)}</code> · all four reviewed hashes match: <strong>${report.visualReview.hashesMatch ? "yes" : "NO"}</strong>.</p><h3>Accepted axes</h3><ul>${report.visualReview.acceptedAxes.map((axis) => `<li>${escapeHtml(axis)}</li>`).join("")}</ul><h3>Rejected axes</h3><ul>${report.visualReview.rejectedAxes.map((axis) => `<li>${escapeHtml(axis)}</li>`).join("")}</ul>`
    : "<h2>Independent exact-hash review</h2><p>No independent review is recorded for this historical diagnostic.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(report.trial.id)}</title><style>body{max-width:1120px;margin:2rem auto;padding:0 1rem;background:#0c0a0c;color:#eadfce;font:16px/1.5 system-ui}.reject{color:#ef8d83}code{color:#efbd70}img{max-width:100%;height:auto;border:1px solid #584549}figure{margin:1.25rem 0}figcaption{color:#b8a699}</style></head><body><h1>${escapeHtml(report.trial.id)}</h1><p class="reject"><strong>REJECTED:</strong> this identity master cannot seed follow-up poses.</p><p>${escapeHtml(report.trial.recommendation)}</p><dl><dt>Raw SHA-256</dt><dd><code>${report.sources.candidate.sha256}</code></dd><dt>Prepared SHA-256</dt><dd><code>${report.sources.prepared.sha256}</code></dd><dt>Runtime ink</dt><dd>${report.assessment.runtime.bounds.width}×${report.assessment.runtime.bounds.height}, aspect ${report.assessment.runtime.bounds.aspectRatio}</dd><dt>Contact center / rig anchor</dt><dd>${report.assessment.runtime.contact.centroidX} / ${actorSpec.atlas.footAnchor.x} px</dd><dt>Shared collision radius</dt><dd>${report.collisionContract.logicalRadiusPixels} logical px</dd><dt>Raw literal magenta</dt><dd>${report.raw.literalMagentaRatio}</dd></dl><h2>Recorded visual findings</h2><ul>${failures}</ul>${independentReview}<h2>Mechanical review</h2><ul>${mechanical}</ul><figure><a href="pose-evidence.png"><img src="pose-evidence.png" alt="Raw, prepared, runtime, and alpha evidence"></a><figcaption>One generated pose through deterministic ingress at raw, 256-pixel source-cell, and 128-pixel runtime scale. Preparation preserves aspect ratio and reports the exact safe bounds and foot anchor.</figcaption></figure><figure><a href="runtime-scale-comparison.png"><img src="runtime-scale-comparison.png" alt="Isolated master beside production actors at runtime scale"></a><figcaption>The candidate and production actors share one logical ground line. Relative size, silhouette, material density, and support placement remain visual-review questions.</figcaption></figure><h2>Detector controls</h2><ul>${controls}</ul><p>Mechanical ingress cannot manufacture missing anatomy, correct viewpoint or style, or authorize follow-up generation.</p></body></html>`;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const trial = JSON.parse(await fs.readFile(options.trial, "utf8"));
  if (
    trial.contract !== "CinderwakeIsolatedActorPoseTrialV1" ||
    trial.evaluation.status !== "rejected" ||
    trial.preparation.status !== "rejected"
  )
    throw new Error("Pose trial must declare the rejected V1 contract");
  for (const [name, actual] of Object.entries(collisionContract))
    if (trial.mechanicalTargets[name] !== actual)
      throw new Error(
        `Pose trial ${name} is stale: ${trial.mechanicalTargets[name]} != ${actual}`,
      );
  const prompt = await validateFile(trial.promptFile, "trial prompt");
  if (prompt.bytes.length === 0) throw new Error("Trial prompt is empty");
  const [candidate, prepared, preparation] = await Promise.all([
    validateFile(
      { file: trial.candidateFile, sha256: trial.candidateSha256 },
      "trial candidate",
    ),
    validateFile(trial.preparation, "trial prepared pose"),
    reproducePreparation(trial),
    ...trial.referenceFiles.map((reference, index) =>
      validateFile(reference, `trial reference ${index}`),
    ),
  ]);
  const [rawImage, preparedImage] = await Promise.all([
    keyedImage(candidate.filePath, {
      normalizeTo: actorSpec.source.pixelWidth,
    }),
    keyedImage(prepared.filePath),
  ]);
  const runtime = await projectRuntime(preparedImage);
  const assessment = assessPose(
    preparedImage,
    runtime.image,
    trial.mechanicalTargets,
  );
  const negativeControlsResult = await negativeControls(
    preparedImage,
    trial.mechanicalTargets,
  );
  const actualViolationCodes = assessment.violations
    .map(({ code }) => code)
    .sort();
  const expectedViolationCodes = [
    ...trial.mechanicalTargets.expectedViolationCodes,
  ].sort();
  const expectedMechanicalRejection =
    !assessment.pass &&
    actualViolationCodes.length === expectedViolationCodes.length &&
    actualViolationCodes.every(
      (code, index) => code === expectedViolationCodes[index],
    );
  const controlsPass = negativeControlsResult.every(({ detected }) => detected);
  await fs.mkdir(options.output, { recursive: true });
  const poseEvidencePath = path.join(options.output, "pose-evidence.png");
  const runtimeComparisonPath = path.join(
    options.output,
    "runtime-scale-comparison.png",
  );
  await Promise.all([
    writePoseEvidence(
      candidate.filePath,
      prepared.filePath,
      preparedImage,
      runtime.buffer,
      poseEvidencePath,
    ),
    writeScaleComparison(runtime.buffer, runtimeComparisonPath),
  ]);
  const [poseEvidenceSha256, runtimeComparisonSha256] = await Promise.all([
    fs.readFile(poseEvidencePath).then(sha256),
    fs.readFile(runtimeComparisonPath).then(sha256),
  ]);
  const recordedVisualReview = trial.visualReview ?? null;
  const visualReviewHashesMatch = Boolean(
    recordedVisualReview &&
    recordedVisualReview.verdict === "REJECT" &&
    typeof recordedVisualReview.reviewer === "string" &&
    recordedVisualReview.reviewer.length > 0 &&
    recordedVisualReview.reviewedRawSha256 === candidate.sha256 &&
    recordedVisualReview.reviewedPreparedSha256 === prepared.sha256 &&
    recordedVisualReview.reviewedPoseEvidenceSha256 === poseEvidenceSha256 &&
    recordedVisualReview.reviewedRuntimeComparisonSha256 ===
      runtimeComparisonSha256 &&
    Array.isArray(recordedVisualReview.acceptedAxes) &&
    recordedVisualReview.acceptedAxes.length > 0 &&
    Array.isArray(recordedVisualReview.rejectedAxes) &&
    recordedVisualReview.rejectedAxes.length > 0,
  );
  const report = {
    schemaVersion: 1,
    contract: "CinderwakeIsolatedActorPoseAssessmentV1",
    status: expectedMechanicalRejection ? "rejected" : "unexpected",
    trial: {
      id: trial.id,
      actorId: trial.actorId,
      pose: trial.pose,
      evaluation: trial.evaluation,
      semanticReview: trial.semanticReview,
      recommendation: trial.recommendation,
    },
    sources: {
      prompt: {
        file: trial.promptFile,
        sha256: prompt.sha256,
      },
      candidate: {
        file: trial.candidateFile,
        sha256: candidate.sha256,
        artifactId: trial.generation.artifactId,
      },
      prepared: {
        file: trial.preparation.file,
        sha256: prepared.sha256,
      },
    },
    raw: {
      normalizedDimensions: `${rawImage.info.width}x${rawImage.info.height}`,
      literalMagentaRatio: rounded(rawImage.literalMagentaRatio),
      ink: imageEvidence(rawImage, "raw normalized pose"),
    },
    preparation,
    collisionContract: {
      ...collisionContract,
      logicalRadiusPixels: rounded(
        (collisionContract.collisionRadiusWorldUnits /
          collisionContract.unitsPerTile) *
          collisionContract.tilePixels,
      ),
    },
    assessment,
    expectation: {
      expectedViolationCodes,
      actualViolationCodes,
      exactViolationSetMatch: expectedMechanicalRejection,
    },
    visualReview: recordedVisualReview
      ? {
          ...recordedVisualReview,
          hashesMatch: visualReviewHashesMatch,
        }
      : null,
    negativeControls: negativeControlsResult,
    artifacts: ["pose-evidence.png", "runtime-scale-comparison.png"],
  };
  await Promise.all([
    fs.writeFile(
      path.join(options.output, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    fs.writeFile(path.join(options.output, "index.html"), htmlReport(report)),
  ]);
  if (
    !expectedMechanicalRejection ||
    !controlsPass ||
    (recordedVisualReview && !visualReviewHashesMatch)
  )
    throw new Error(
      `Pose assessment contract failed: expected-rejection=${expectedMechanicalRejection}, controls=${controlsPass}, visual-review=${recordedVisualReview ? visualReviewHashesMatch : "not-recorded"}`,
    );
  console.log(
    `Isolated Ashfang idle master rejected reproducibly: runtime ${assessment.runtime.bounds.width}x${assessment.runtime.bounds.height}, aspect ${assessment.runtime.bounds.aspectRatio}; ${negativeControlsResult.length}/${negativeControlsResult.length} controls caught. No production asset changed.`,
  );
}

await run();
