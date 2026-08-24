import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const executeFile = promisify(execFile);
const ROOT = process.cwd();
const ACTOR_SPEC_PATH = path.join(ROOT, "art", "actor-atlas-v1.json");
const TRIALS_PATH = path.join(ROOT, "art", "generation", "trials.json");
const ACCEPTED_PATH = path.join(
  ROOT,
  "art",
  "generation",
  "accepted-production.json",
);
const REPORT_DIRECTORY = path.join(
  ROOT,
  "quality-results",
  "generation-pipeline",
);
const BUILDER_PATH = path.join(ROOT, "scripts", "build-sprite-assets.mjs");
const PRODUCTION_DIRECTORY = path.join(ROOT, "public", "assets", "sprites");
const REPRESENTATIVE_ACTORS = ["vanguard", "ranger", "stonekin"];
const TRIAL_ACTORS = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];
const ALLOWED_TRIAL_STATUSES = new Set([
  "pending",
  "accepted-for-pipeline-proof",
  "rejected",
]);
const ALLOWED_PROMPT_RECORD_STATUSES = new Set([
  "reconstructed-after-generation",
  "exact-at-generation",
]);
const ACTOR_SPEC = JSON.parse(await fs.readFile(ACTOR_SPEC_PATH, "utf8"));
const SOURCE_FAMILIES = Object.keys(ACTOR_SPEC.source.files);

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function fileSha256(filePath) {
  return sha256(await fs.readFile(filePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNonEmptyString(value, label) {
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
}

function resolveProjectFile(relativePath, label) {
  assertNonEmptyString(relativePath, label);
  assert(!path.isAbsolute(relativePath), `${label} must be repo-relative`);
  const resolved = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, resolved);
  assert(
    relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== "..",
    `${label} must stay within the repository`,
  );
  return resolved;
}

async function readNonEmptyProjectFile(relativePath, label) {
  const filePath = resolveProjectFile(relativePath, label);
  let contents;
  try {
    contents = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(`${label} does not exist`, { cause: error });
    throw error;
  }
  assert(contents.length > 0, `${label} is empty`);
  return { contents, filePath };
}

function keyAlpha(red, green, blue) {
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

function largestComponentEvidence(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (const neighbor of neighbors) {
        if (
          neighbor < 0 ||
          neighbor >= mask.length ||
          visited[neighbor] ||
          !mask[neighbor]
        )
          continue;
        if (Math.abs((neighbor % width) - x) > 1) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (!largest || pixels > largest.pixels)
      largest = { pixels, minX, minY, maxX, maxY };
  }
  return largest;
}

async function sourceSheetEvidence(filePath, label) {
  const metadata = await sharp(filePath).metadata();
  const normalizedWidth = ACTOR_SPEC.source.pixelWidth;
  const normalizedHeight = ACTOR_SPEC.source.pixelHeight;
  assert(
    metadata.width === metadata.height && metadata.width >= normalizedWidth,
    `${label} must be a square source at least ${normalizedWidth}x${normalizedHeight}`,
  );
  const { data, info } = await sharp(filePath)
    .resize(normalizedWidth, normalizedHeight, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cellWidth = ACTOR_SPEC.source.cellWidth;
  const cellHeight = ACTOR_SPEC.source.cellHeight;
  const foregroundByCell = Array.from(
    { length: ACTOR_SPEC.source.columns * ACTOR_SPEC.source.rows },
    () => 0,
  );
  const masks = foregroundByCell.map(
    () => new Uint8Array(cellWidth * cellHeight),
  );
  let backgroundPixels = 0;
  let literalMagentaPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const alpha = data[offset + 3];
      if (
        alpha === 255 &&
        data[offset] === 255 &&
        data[offset + 1] === 0 &&
        data[offset + 2] === 255
      )
        literalMagentaPixels += 1;
      const isBackground =
        alpha < 8 ||
        keyAlpha(data[offset], data[offset + 1], data[offset + 2]) < 24;
      if (isBackground) {
        backgroundPixels += 1;
        continue;
      }
      const column = Math.floor(x / ACTOR_SPEC.source.cellWidth);
      const row = Math.floor(y / ACTOR_SPEC.source.cellHeight);
      const cellIndex = row * ACTOR_SPEC.source.columns + column;
      foregroundByCell[cellIndex] += 1;
      masks[cellIndex][
        (y % ACTOR_SPEC.source.cellHeight) * ACTOR_SPEC.source.cellWidth +
          (x % ACTOR_SPEC.source.cellWidth)
      ] = 1;
    }
  }
  const blankCell = foregroundByCell.findIndex((pixels) => pixels < 120);
  assert(blankCell < 0, `${label} cell ${blankCell} is blank`);
  const backgroundRatio = backgroundPixels / (info.width * info.height);
  assert(
    backgroundRatio >= 0.2,
    `${label} does not contain enough keyed background (${backgroundRatio.toFixed(3)})`,
  );
  const baselineTargetY = 236;
  const cells = masks.map((mask, index) => {
    const component = largestComponentEvidence(mask, cellWidth, cellHeight);
    assert(component, `${label} cell ${index} has no main component`);
    const margin = Math.min(
      component.minX,
      component.minY,
      cellWidth - 1 - component.maxX,
      cellHeight - 1 - component.maxY,
    );
    return {
      index,
      foregroundPixels: foregroundByCell[index],
      mainComponentPixels: component.pixels,
      mainComponentBounds: {
        left: component.minX,
        top: component.minY,
        width: component.maxX - component.minX + 1,
        height: component.maxY - component.minY + 1,
      },
      minimumMainComponentMargin: margin,
      touchesCellEdge: margin === 0,
      bottomInkY: component.maxY,
      baselineOffset: component.maxY - baselineTargetY,
    };
  });
  const literalMagentaRatio = literalMagentaPixels / (info.width * info.height);
  const bottomValues = cells.map(({ bottomInkY }) => bottomInkY);
  const baselineSpread = Math.max(...bottomValues) - Math.min(...bottomValues);
  const contractProblems = [];
  if (literalMagentaRatio < 0.2)
    contractProblems.push({
      code: "literal-magenta-ratio",
      actual: Number(literalMagentaRatio.toFixed(4)),
      minimum: 0.2,
    });
  const unsafeMarginCells = cells
    .filter(({ minimumMainComponentMargin }) => minimumMainComponentMargin < 4)
    .map(({ index, minimumMainComponentMargin }) => ({
      index,
      minimumMainComponentMargin,
    }));
  if (unsafeMarginCells.length > 0)
    contractProblems.push({
      code: "main-component-safe-margin",
      requiredPixels: 4,
      cells: unsafeMarginCells,
    });
  const baselineCells = cells
    .filter(({ baselineOffset }) => Math.abs(baselineOffset) > 16)
    .map(({ index, bottomInkY, baselineOffset }) => ({
      index,
      bottomInkY,
      baselineOffset,
    }));
  if (baselineCells.length > 0)
    contractProblems.push({
      code: "baseline-target",
      targetY: baselineTargetY,
      tolerancePixels: 16,
      cells: baselineCells,
    });
  if (baselineSpread > 20)
    contractProblems.push({
      code: "baseline-spread",
      actualPixels: baselineSpread,
      maximumPixels: 20,
    });
  return {
    sourcePixelWidth: metadata.width,
    sourcePixelHeight: metadata.height,
    normalizedPixelWidth: info.width,
    normalizedPixelHeight: info.height,
    backgroundRatio: Number(backgroundRatio.toFixed(4)),
    literalMagentaRatio: Number(literalMagentaRatio.toFixed(4)),
    minimumCellForegroundPixels: Math.min(...foregroundByCell),
    maximumCellForegroundPixels: Math.max(...foregroundByCell),
    baselineTargetY,
    baselineSpread,
    cells,
    contractProblems,
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function validateHash(file, declaredHash, label) {
  assertNonEmptyString(declaredHash, `${label}.sha256`);
  assert(/^[a-f0-9]{64}$/.test(declaredHash), `${label}.sha256 is invalid`);
  const actualHash = sha256(file.contents);
  assert(actualHash === declaredHash, `${label} has a stale sha256`);
  return actualHash;
}

async function validateTrials(
  manifest,
  { requireRepresentativeCoverage = true } = {},
) {
  assert(manifest.schemaVersion === 1, "trials schemaVersion must be 1");
  assert(
    manifest.contract === "CinderwakeGenerationTrialV1",
    "trials contract must be CinderwakeGenerationTrialV1",
  );
  await readNonEmptyProjectFile(manifest.styleBrief, "trials.styleBrief");
  await readNonEmptyProjectFile(manifest.actorContract, "trials.actorContract");
  assert(
    Array.isArray(manifest.trials) && manifest.trials.length > 0,
    "trials.trials must contain at least one generation trial",
  );
  const trialIds = new Set();
  const evidence = [];
  for (const [index, trial] of manifest.trials.entries()) {
    const label = `trials.trials[${index}]`;
    assertNonEmptyString(trial.id, `${label}.id`);
    assert(!trialIds.has(trial.id), `${label}.id is duplicated`);
    trialIds.add(trial.id);
    assert(TRIAL_ACTORS.includes(trial.actorId), `${label}.actorId is unknown`);
    assert(
      SOURCE_FAMILIES.includes(trial.sourceFamily),
      `${label}.sourceFamily is unknown`,
    );
    await readNonEmptyProjectFile(trial.promptFile, `${label}.promptFile`);
    const candidate = await readNonEmptyProjectFile(
      trial.candidateFile,
      `${label}.candidateFile`,
    );
    const candidateSha256 = await validateHash(
      candidate,
      trial.candidateSha256,
      `${label}.candidateFile`,
    );
    assert(
      Array.isArray(trial.referenceFiles) && trial.referenceFiles.length > 0,
      `${label}.referenceFiles must not be empty`,
    );
    for (const [referenceIndex, reference] of trial.referenceFiles.entries()) {
      const referenceLabel = `${label}.referenceFiles[${referenceIndex}]`;
      const referenceFile = await readNonEmptyProjectFile(
        reference.file,
        `${referenceLabel}.file`,
      );
      await validateHash(referenceFile, reference.sha256, referenceLabel);
    }
    assertNonEmptyString(trial.generation?.tool, `${label}.generation.tool`);
    assertNonEmptyString(
      trial.generation?.artifactId,
      `${label}.generation.artifactId`,
    );
    assert(
      ALLOWED_TRIAL_STATUSES.has(trial.evaluation?.status),
      `${label}.evaluation.status is invalid`,
    );
    assertNonEmptyString(trial.evaluation?.notes, `${label}.evaluation.notes`);
    if (trial.evaluation.status === "rejected") {
      assert(
        Array.isArray(trial.evaluation.reasons) &&
          trial.evaluation.reasons.length > 0,
        `${label}.evaluation.reasons must name at least one rejection reason`,
      );
      for (const [reasonIndex, reason] of trial.evaluation.reasons.entries()) {
        const reasonLabel = `${label}.evaluation.reasons[${reasonIndex}]`;
        assert(
          reason.kind === "structural" ||
            reason.kind === "mechanical" ||
            reason.kind === "visual",
          `${reasonLabel}.kind must be structural, mechanical, or visual`,
        );
        assertNonEmptyString(reason.code, `${reasonLabel}.code`);
        assertNonEmptyString(reason.detail, `${reasonLabel}.detail`);
      }
    }
    const candidateSourceSheet = await sourceSheetEvidence(
      candidate.filePath,
      `${label}.candidateFile`,
    );
    if (trial.evaluation.status === "accepted-for-pipeline-proof")
      assert(
        candidateSourceSheet.contractProblems.length === 0,
        `${label}.candidateFile is labeled accepted-for-pipeline-proof but violates the source contract`,
      );
    let preparation;
    if (trial.preparation) {
      assert(
        trial.preparation.tool === "scripts/prepare-actor-source.mjs",
        `${label}.preparation.tool must be scripts/prepare-actor-source.mjs`,
      );
      const expectedPreparationCommand = `node scripts/prepare-actor-source.mjs --input ${trial.candidateFile} --output ${trial.preparation.file}`;
      assert(
        trial.preparation.command === expectedPreparationCommand,
        `${label}.preparation.command does not match the declared input and output`,
      );
      assertNonEmptyString(
        trial.preparation.command,
        `${label}.preparation.command`,
      );
      assert(
        trial.preparation.status === "accepted-for-pipeline-proof" ||
          trial.preparation.status === "rejected",
        `${label}.preparation.status is invalid`,
      );
      assertNonEmptyString(
        trial.preparation.notes,
        `${label}.preparation.notes`,
      );
      const preparedFile = await readNonEmptyProjectFile(
        trial.preparation.file,
        `${label}.preparation.file`,
      );
      const preparedSha256 = await validateHash(
        preparedFile,
        trial.preparation.sha256,
        `${label}.preparation.file`,
      );
      const preparedSourceSheet = await sourceSheetEvidence(
        preparedFile.filePath,
        `${label}.preparation.file`,
      );
      assert(
        preparedSourceSheet.sourcePixelWidth === ACTOR_SPEC.source.pixelWidth &&
          preparedSourceSheet.sourcePixelHeight ===
            ACTOR_SPEC.source.pixelHeight,
        `${label}.preparation.file must already be normalized to ${ACTOR_SPEC.source.pixelWidth}x${ACTOR_SPEC.source.pixelHeight}`,
      );
      if (trial.preparation.status === "accepted-for-pipeline-proof")
        assert(
          preparedSourceSheet.contractProblems.length === 0,
          `${label}.preparation.file is labeled accepted-for-pipeline-proof but violates the source contract`,
        );
      preparation = {
        command: trial.preparation.command,
        file: trial.preparation.file,
        sha256: preparedSha256,
        tool: trial.preparation.tool,
        status: trial.preparation.status,
        notes: trial.preparation.notes,
        sourceSheet: preparedSourceSheet,
      };
    }
    let visualReview;
    if (trial.visualReview) {
      const reviewLabel = `${label}.visualReview`;
      assert(
        trial.visualReview.verdict === "ACCEPT" ||
          trial.visualReview.verdict === "REJECT" ||
          trial.visualReview.verdict === "UNCERTAIN",
        `${reviewLabel}.verdict is invalid`,
      );
      assertNonEmptyString(
        trial.visualReview.reviewer,
        `${reviewLabel}.reviewer`,
      );
      assert(
        preparation,
        `${reviewLabel} requires a prepared candidate for hash binding`,
      );
      assert(
        trial.visualReview.reviewedPreparedSha256 === preparation.sha256,
        `${reviewLabel}.reviewedPreparedSha256 does not match preparation.sha256`,
      );
      for (const axisName of ["acceptedAxes", "rejectedAxes"]) {
        const axes = trial.visualReview[axisName];
        assert(
          Array.isArray(axes) && axes.length > 0,
          `${reviewLabel}.${axisName} must contain at least one axis`,
        );
        axes.forEach((axis, axisIndex) =>
          assertNonEmptyString(
            axis,
            `${reviewLabel}.${axisName}[${axisIndex}]`,
          ),
        );
      }
      visualReview = structuredClone(trial.visualReview);
    }
    evidence.push({
      id: trial.id,
      actorId: trial.actorId,
      sourceFamily: trial.sourceFamily,
      status: trial.evaluation.status,
      candidateFile: trial.candidateFile,
      candidateSha256,
      evaluation: trial.evaluation,
      sourceSheet: candidateSourceSheet,
      preparation,
      visualReview,
    });
  }
  if (requireRepresentativeCoverage)
    for (const actorId of REPRESENTATIVE_ACTORS)
      assert(
        evidence.some((trial) => trial.actorId === actorId),
        `trials must contain at least one ${actorId} candidate`,
      );
  return evidence;
}

async function validateAcceptedProduction(manifest) {
  assert(
    manifest.schemaVersion === 1,
    "accepted-production schemaVersion must be 1",
  );
  assert(
    manifest.contract === "CinderwakeAcceptedActorSourcesV1",
    "accepted-production contract must be CinderwakeAcceptedActorSourcesV1",
  );
  assert(
    Array.isArray(manifest.actors),
    "accepted-production.actors must be an array",
  );
  const evidence = [];
  for (const actorId of REPRESENTATIVE_ACTORS) {
    const matchingActors = manifest.actors.filter(
      (actor) => actor.actorId === actorId,
    );
    assert(
      matchingActors.length === 1,
      `accepted-production must contain exactly one ${actorId} actor`,
    );
    const actor = matchingActors[0];
    assert(
      Array.isArray(actor.sources),
      `accepted-production ${actorId}.sources must be an array`,
    );
    assert(
      actor.sources.length === SOURCE_FAMILIES.length,
      `accepted-production ${actorId} must contain exactly ${SOURCE_FAMILIES.length} sources`,
    );
    for (const sourceFamily of SOURCE_FAMILIES) {
      const matchingSources = actor.sources.filter(
        (source) => source.sourceFamily === sourceFamily,
      );
      assert(
        matchingSources.length === 1,
        `accepted-production ${actorId} must contain exactly one ${sourceFamily} source`,
      );
      const source = matchingSources[0];
      const expectedFile = path.posix.join(
        "art",
        "source",
        "actors",
        ACTOR_SPEC.source.files[sourceFamily].replace("{actor}", actorId),
      );
      assert(
        source.file === expectedFile,
        `accepted-production ${actorId}.${sourceFamily}.file must be ${expectedFile}`,
      );
      const sourceFile = await readNonEmptyProjectFile(
        source.file,
        `accepted-production ${actorId}.${sourceFamily}.file`,
      );
      const sourceSha256 = await validateHash(
        sourceFile,
        source.sha256,
        `accepted-production ${actorId}.${sourceFamily}`,
      );
      assertNonEmptyString(
        source.generation?.tool,
        `accepted-production ${actorId}.${sourceFamily}.generation.tool`,
      );
      assertNonEmptyString(
        source.generation?.artifactId,
        `accepted-production ${actorId}.${sourceFamily}.generation.artifactId`,
      );
      const promptRecordStatus = source.generation?.promptRecordStatus;
      assert(
        ALLOWED_PROMPT_RECORD_STATUSES.has(promptRecordStatus),
        `accepted-production ${actorId}.${sourceFamily}.generation.promptRecordStatus is invalid`,
      );
      const promptRecordFile =
        promptRecordStatus === "reconstructed-after-generation"
          ? (source.briefFile ?? source.generation.briefFile)
          : (source.promptFile ?? source.generation.promptFile);
      await readNonEmptyProjectFile(
        promptRecordFile,
        `accepted-production ${actorId}.${sourceFamily}.${
          promptRecordStatus === "reconstructed-after-generation"
            ? "briefFile"
            : "promptFile"
        }`,
      );
      evidence.push({
        actorId,
        sourceFamily,
        file: source.file,
        sha256: sourceSha256,
        promptRecordStatus,
        sourceSheet: await sourceSheetEvidence(
          sourceFile.filePath,
          `accepted-production ${actorId}.${sourceFamily}.file`,
        ),
      });
    }
  }
  return evidence;
}

async function runBuilder(
  outputDirectory,
  actorIds = REPRESENTATIVE_ACTORS,
  actorSourceDirectory = undefined,
) {
  const arguments_ = [
    BUILDER_PATH,
    "--actors",
    actorIds.join(","),
    "--output-dir",
    outputDirectory,
    "--actors-only",
  ];
  if (actorSourceDirectory)
    arguments_.push("--source-dir", actorSourceDirectory);
  const { stdout, stderr } = await executeFile(process.execPath, arguments_, {
    cwd: ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert(stderr.trim() === "", `sprite builder wrote to stderr: ${stderr}`);
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(outputDirectory, "build-manifest.json"),
      "utf8",
    ),
  );
  const expectedOutputs = actorIds.map((actorId) => `actor-${actorId}.png`);
  assert(
    JSON.stringify(Object.keys(manifest.outputs)) ===
      JSON.stringify(expectedOutputs),
    "isolated builder emitted unexpected outputs",
  );
  return stdout.trim();
}

async function runtimeAtlasEvidence(filePath, label) {
  const metadata = await sharp(filePath).metadata();
  assert(
    metadata.width === ACTOR_SPEC.atlas.pixelWidth &&
      metadata.height === ACTOR_SPEC.atlas.pixelHeight,
    `${label} must be exactly ${ACTOR_SPEC.atlas.pixelWidth}x${ACTOR_SPEC.atlas.pixelHeight}`,
  );
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cellSize = ACTOR_SPEC.atlas.cellWidth;
  const safe = ACTOR_SPEC.atlas.safeInkBounds;
  const banks = [
    ...Object.entries(ACTOR_SPEC.clips),
    ...Object.entries(ACTOR_SPEC.directionalClips),
  ];
  let populatedCells = 0;
  for (const [bankName, bank] of banks) {
    const hashes = [];
    for (let column = 0; column < bank.sourceFrames.length; column += 1) {
      let ink = 0;
      let minX = cellSize;
      let minY = cellSize;
      let maxX = -1;
      let maxY = -1;
      const cell = Buffer.alloc(cellSize * cellSize * 4);
      for (let y = 0; y < cellSize; y += 1) {
        const sourceOffset =
          ((bank.atlasRow * cellSize + y) * info.width + column * cellSize) * 4;
        const destinationOffset = y * cellSize * 4;
        data.copy(
          cell,
          destinationOffset,
          sourceOffset,
          sourceOffset + cellSize * 4,
        );
        for (let x = 0; x < cellSize; x += 1) {
          if (cell[destinationOffset + x * 4 + 3] < 8) continue;
          ink += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      assert(ink >= 120, `${label} ${bankName} frame ${column} is blank`);
      assert(
        minX >= safe.x &&
          minY >= safe.y &&
          maxX < safe.x + safe.width &&
          maxY < safe.y + safe.height,
        `${label} ${bankName} frame ${column} leaves safeInkBounds`,
      );
      assert(
        maxY === ACTOR_SPEC.atlas.footAnchor.y - 1,
        `${label} ${bankName} frame ${column} is not grounded at the foot anchor`,
      );
      hashes.push(sha256(cell));
      populatedCells += 1;
    }
    assert(
      new Set(hashes).size >= Math.min(2, hashes.length),
      `${label} ${bankName} has no visual motion`,
    );
  }
  return {
    pixelWidth: metadata.width,
    pixelHeight: metadata.height,
    banksChecked: banks.length,
    populatedCellsChecked: populatedCells,
    safeInkBounds: safe,
    footAnchor: ACTOR_SPEC.atlas.footAnchor,
  };
}

async function writeTrialPreview(atlasPath, sourceFamily, trialId) {
  const banks = [
    ...Object.entries(ACTOR_SPEC.clips),
    ...Object.entries(ACTOR_SPEC.directionalClips),
  ].filter(([, bank]) => bank.source === sourceFamily);
  assert(banks.length > 0, `${trialId} source family has no runtime banks`);
  const cellSize = ACTOR_SPEC.atlas.cellWidth;
  const composites = [];
  for (const [rowIndex, [, bank]] of banks.entries()) {
    const row = await sharp(atlasPath)
      .extract({
        left: 0,
        top: bank.atlasRow * cellSize,
        width: ACTOR_SPEC.atlas.pixelWidth,
        height: cellSize,
      })
      .png()
      .toBuffer();
    composites.push({ input: row, left: 0, top: rowIndex * cellSize });
  }
  const previewDirectory = path.join(REPORT_DIRECTORY, "previews");
  await fs.mkdir(previewDirectory, { recursive: true });
  const safeId = trialId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const previewPath = path.join(previewDirectory, `${safeId}.png`);
  await sharp({
    create: {
      width: ACTOR_SPEC.atlas.pixelWidth,
      height: banks.length * cellSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(previewPath);
  return path.relative(REPORT_DIRECTORY, previewPath);
}

async function writeNormalizedCandidate(
  candidatePath,
  trialId,
  directoryName = "normalized",
) {
  const normalizedDirectory = path.join(REPORT_DIRECTORY, directoryName);
  await fs.mkdir(normalizedDirectory, { recursive: true });
  const safeId = trialId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const normalizedPath = path.join(normalizedDirectory, `${safeId}.png`);
  await sharp(candidatePath)
    .resize(ACTOR_SPEC.source.pixelWidth, ACTOR_SPEC.source.pixelHeight, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(normalizedPath);
  return path.relative(REPORT_DIRECTORY, normalizedPath);
}

async function verifyTrialBuilds(manifest, temporaryRoot) {
  if (!manifest) return [];
  const evidence = [];
  for (const trial of manifest.trials) {
    const safeId = trial.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
    const trialDirectory = path.join(temporaryRoot, `trial-${safeId}`);
    const sourceDirectory = path.join(trialDirectory, "sources");
    const outputDirectory = path.join(trialDirectory, "output");
    const rawCandidatePath = resolveProjectFile(
      trial.candidateFile,
      `${trial.id}.candidateFile`,
    );
    await Promise.all([
      fs.mkdir(sourceDirectory, { recursive: true }),
      fs.mkdir(outputDirectory, { recursive: true }),
    ]);
    let packedInputPath = rawCandidatePath;
    let preparationReproduction;
    if (trial.preparation) {
      const committedPreparedPath = resolveProjectFile(
        trial.preparation.file,
        `${trial.id}.preparation.file`,
      );
      const reproducedPreparedPath = path.join(
        trialDirectory,
        "reproduced-prepared.png",
      );
      const preparationResult = await executeFile(
        process.execPath,
        [
          path.join(ROOT, "scripts", "prepare-actor-source.mjs"),
          "--input",
          rawCandidatePath,
          "--output",
          reproducedPreparedPath,
        ],
        { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 },
      );
      assert(
        preparationResult.stderr.trim() === "",
        `${trial.id} preparation wrote to stderr`,
      );
      const [reproducedSha256, committedSha256] = await Promise.all([
        fileSha256(reproducedPreparedPath),
        fileSha256(committedPreparedPath),
      ]);
      assert(
        reproducedSha256 === trial.preparation.sha256 &&
          reproducedSha256 === committedSha256,
        `${trial.id} preparation is not byte-identical to its committed output`,
      );
      packedInputPath = reproducedPreparedPath;
      preparationReproduction = {
        command: trial.preparation.command,
        sha256: reproducedSha256,
        byteIdenticalToCommitted: true,
      };
    }
    for (const [sourceFamily, pattern] of Object.entries(
      ACTOR_SPEC.source.files,
    )) {
      const fileName = pattern.replace("{actor}", trial.actorId);
      const productionSource = path.join(
        ROOT,
        "art",
        "source",
        "actors",
        fileName,
      );
      const stagedSource = path.join(sourceDirectory, fileName);
      await fs.copyFile(productionSource, stagedSource);
      if (sourceFamily === trial.sourceFamily)
        await fs.copyFile(packedInputPath, stagedSource);
    }
    await runBuilder(outputDirectory, [trial.actorId], sourceDirectory);
    const atlasPath = path.join(outputDirectory, `actor-${trial.actorId}.png`);
    evidence.push({
      trialId: trial.id,
      actorId: trial.actorId,
      sourceFamily: trial.sourceFamily,
      rawVerdict: trial.evaluation.status,
      preparedVerdict: trial.preparation?.status ?? "not-present",
      packedInput: trial.preparation
        ? trial.preparation.status === "accepted-for-pipeline-proof"
          ? "prepared-pipeline-proof"
          : "prepared-rejected-diagnostic"
        : "raw-rejected-diagnostic",
      preparationReproduction,
      visualReview: trial.visualReview ?? null,
      atlasSha256: await fileSha256(atlasPath),
      rawNormalizedSourceFile: await writeNormalizedCandidate(
        rawCandidatePath,
        trial.id,
      ),
      preparedSourceFile: trial.preparation
        ? await writeNormalizedCandidate(packedInputPath, trial.id, "prepared")
        : undefined,
      runtimeAtlas: await runtimeAtlasEvidence(
        atlasPath,
        `${trial.id} runtime atlas`,
      ),
      previewFile: await writeTrialPreview(
        atlasPath,
        trial.sourceFamily,
        trial.id,
      ),
    });
  }
  return evidence;
}

async function verifyDeterministicBuilds(temporaryRoot) {
  const firstDirectory = path.join(temporaryRoot, "build-a");
  const secondDirectory = path.join(temporaryRoot, "build-b");
  await Promise.all([
    fs.mkdir(firstDirectory, { recursive: true }),
    fs.mkdir(secondDirectory, { recursive: true }),
  ]);
  const firstOutput = await runBuilder(firstDirectory);
  const secondOutput = await runBuilder(secondDirectory);
  const evidence = [];
  for (const actorId of REPRESENTATIVE_ACTORS) {
    const fileName = `actor-${actorId}.png`;
    const firstSha256 = await fileSha256(path.join(firstDirectory, fileName));
    const secondSha256 = await fileSha256(path.join(secondDirectory, fileName));
    const productionSha256 = await fileSha256(
      path.join(PRODUCTION_DIRECTORY, fileName),
    );
    assert(
      firstSha256 === secondSha256,
      `${actorId} builds are not byte-identical`,
    );
    assert(
      firstSha256 === productionSha256,
      `${actorId} isolated build differs from the committed production atlas`,
    );
    const metadata = await sharp(
      path.join(firstDirectory, fileName),
    ).metadata();
    assert(
      metadata.width === ACTOR_SPEC.atlas.pixelWidth &&
        metadata.height === ACTOR_SPEC.atlas.pixelHeight,
      `${actorId} isolated atlas dimensions are invalid`,
    );
    evidence.push({
      actorId,
      fileName,
      sha256: firstSha256,
      byteIdenticalAcrossBuilds: true,
      matchesCommittedProduction: true,
      pixelWidth: metadata.width,
      pixelHeight: metadata.height,
    });
  }
  return { builderOutput: [firstOutput, secondOutput], actors: evidence };
}

async function expectRejection(id, expectedText, operation) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(expectedText),
      `${id} rejected for the wrong reason: ${error.message}`,
    );
    return { id, status: "pass", rejectedBecause: expectedText };
  }
  throw new Error(`${id} fixture was incorrectly accepted`);
}

async function verifyNegativeFixtures(temporaryRoot) {
  const fixtureDirectory = path.join(temporaryRoot, "negative-fixtures");
  await fs.mkdir(fixtureDirectory, { recursive: true });
  const promptPath = path.join(fixtureDirectory, "prompt.md");
  const validCandidate = path.join(
    ROOT,
    "art",
    "source",
    "actors",
    "vanguard-source.png",
  );
  const referencePath = path.join(
    ROOT,
    "art",
    "source",
    "actors",
    "ranger-source.png",
  );
  await fs.writeFile(promptPath, "Synthetic verifier prompt fixture.\n");
  const relativePrompt = path.relative(ROOT, promptPath);
  const baseManifest = {
    schemaVersion: 1,
    contract: "CinderwakeGenerationTrialV1",
    styleBrief: "art/style-bible.md",
    actorContract: "art/actor-atlas-v1.json",
    trials: [
      {
        id: "synthetic-verifier-fixture",
        actorId: "vanguard",
        sourceFamily: "primary",
        promptFile: relativePrompt,
        candidateFile: path.relative(ROOT, validCandidate),
        candidateSha256: await fileSha256(validCandidate),
        referenceFiles: [
          {
            file: path.relative(ROOT, referencePath),
            sha256: await fileSha256(referencePath),
          },
        ],
        generation: { tool: "synthetic-fixture", artifactId: "not-an-asset" },
        evaluation: {
          status: "rejected",
          notes: "Validation fixture only.",
          reasons: [
            {
              kind: "structural",
              code: "synthetic-fixture",
              detail: "This is not a generated production candidate.",
            },
          ],
        },
      },
    ],
  };
  const validateFixture = (manifest) =>
    validateTrials(manifest, { requireRepresentativeCoverage: false });
  await validateFixture(baseManifest);
  const checks = [];
  checks.push(
    await expectRejection("missing-prompt", "promptFile does not exist", () =>
      validateFixture({
        ...baseManifest,
        trials: [
          {
            ...baseManifest.trials[0],
            promptFile: path.relative(
              ROOT,
              path.join(fixtureDirectory, "missing-prompt.md"),
            ),
          },
        ],
      }),
    ),
  );
  checks.push(
    await expectRejection("stale-hash", "has a stale sha256", () =>
      validateFixture({
        ...baseManifest,
        trials: [
          {
            ...baseManifest.trials[0],
            candidateSha256: "0".repeat(64),
          },
        ],
      }),
    ),
  );
  const badDimensionsPath = path.join(fixtureDirectory, "bad-dimensions.png");
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: "#ff00ff",
    },
  })
    .png()
    .toFile(badDimensionsPath);
  const badDimensions = {
    ...baseManifest.trials[0],
    candidateFile: path.relative(ROOT, badDimensionsPath),
    candidateSha256: await fileSha256(badDimensionsPath),
  };
  checks.push(
    await expectRejection("bad-dimensions", "must be a square source", () =>
      validateFixture({ ...baseManifest, trials: [badDimensions] }),
    ),
  );
  const blankCellPath = path.join(fixtureDirectory, "blank-cell.png");
  await sharp({
    create: {
      width: ACTOR_SPEC.source.pixelWidth,
      height: ACTOR_SPEC.source.pixelHeight,
      channels: 4,
      background: "#ff00ff",
    },
  })
    .png()
    .toFile(blankCellPath);
  const blankCell = {
    ...baseManifest.trials[0],
    candidateFile: path.relative(ROOT, blankCellPath),
    candidateSha256: await fileSha256(blankCellPath),
  };
  checks.push(
    await expectRejection("blank-cell", "cell 0 is blank", () =>
      validateFixture({ ...baseManifest, trials: [blankCell] }),
    ),
  );
  const candidateRelativePath = path.relative(ROOT, validCandidate);
  const visualReviewPreparedPath = path.join(
    fixtureDirectory,
    "visual-review-prepared.png",
  );
  await sharp(validCandidate)
    .resize(ACTOR_SPEC.source.pixelWidth, ACTOR_SPEC.source.pixelHeight, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .png()
    .toFile(visualReviewPreparedPath);
  const visualReviewPreparedRelativePath = path.relative(
    ROOT,
    visualReviewPreparedPath,
  );
  const staleVisualReview = {
    ...baseManifest.trials[0],
    preparation: {
      tool: "scripts/prepare-actor-source.mjs",
      command: `node scripts/prepare-actor-source.mjs --input ${candidateRelativePath} --output ${visualReviewPreparedRelativePath}`,
      file: visualReviewPreparedRelativePath,
      sha256: await fileSha256(visualReviewPreparedPath),
      status: "rejected",
      notes: "Synthetic prepared-source review binding fixture.",
    },
    visualReview: {
      verdict: "REJECT",
      reviewer: "synthetic-reviewer",
      reviewedPreparedSha256: "0".repeat(64),
      acceptedAxes: ["fixture accepted axis"],
      rejectedAxes: ["fixture rejected axis"],
    },
  };
  checks.push(
    await expectRejection(
      "stale-visual-review-hash",
      "reviewedPreparedSha256 does not match preparation.sha256",
      () =>
        validateFixture({
          ...baseManifest,
          trials: [staleVisualReview],
        }),
    ),
  );
  return checks;
}

function markdownReport(report) {
  const lines = [
    "# Generation pipeline verification",
    "",
    `**Result:** ${report.status.toUpperCase()}`,
    "",
    "This report verifies immutable generation inputs and the deterministic path from accepted 4×4 source sheets to runtime actor atlases. AI generation itself is intentionally not claimed to be deterministic. **Accepted for pipeline proof does not mean approved for production art.**",
    "",
    "## Reproduction metadata",
    "",
    `- Commit: \`${report.metadata.commit}\``,
    `- Generated: ${report.metadata.generatedAt}`,
    `- Node: ${report.metadata.node}`,
    `- sharp: ${report.metadata.sharp} (libvips ${report.metadata.libvips})`,
    `- Raw generated candidates: ${report.summary.rawAcceptedForPipelineProof} pipeline-proof accepted, ${report.summary.rawRejected} rejected`,
    `- Prepared candidates: ${report.summary.preparedAcceptedForPipelineProof} pipeline-proof accepted, ${report.summary.preparedRejected} rejected`,
    `- Fresh candidates production-approved: **${report.summary.freshProductionApproved}**`,
    "",
    "## Manifest checks",
    "",
    `- Generation trials: ${report.manifests.trials.status} (${report.manifests.trials.count} checked)`,
    `- Accepted production sources: ${report.manifests.acceptedProduction.status} (${report.manifests.acceptedProduction.count} checked)`,
    "",
    "## Fresh candidate packer trials",
    "",
    "| Trial | Actor/family | Raw verdict | Prepared verdict | Runtime cells | Raw normalized | Prepared | Packed preview |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.trialBuilds.map(
      (trial) =>
        `| ${trial.trialId} | ${trial.actorId}/${trial.sourceFamily} | ${trial.rawVerdict} | ${trial.preparedVerdict} | ${trial.runtimeAtlas.populatedCellsChecked} | [PNG](${trial.rawNormalizedSourceFile}) | ${trial.preparedSourceFile ? `[PNG](${trial.preparedSourceFile})` : "—"} | [PNG](${trial.previewFile}) |`,
    ),
    "",
    "## Deterministic actor builds",
    "",
    "| Actor | SHA-256 | Build A = Build B | Matches production |",
    "| --- | --- | --- | --- |",
    ...report.deterministicBuilds.actors.map(
      (actor) => `| ${actor.actorId} | \`${actor.sha256}\` | yes | yes |`,
    ),
    "",
    "## Rejection controls",
    "",
    ...report.negativeChecks.map(
      (check) =>
        `- ${check.id}: rejected as expected (${check.rejectedBecause})`,
    ),
    "",
    "## Reproduce",
    "",
    "```bash",
    report.command,
    "```",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlReport(report) {
  const trialCards = report.trialBuilds
    .map((trial) => {
      const manifestEvidence = report.manifests.trials.evidence.find(
        ({ id }) => id === trial.trialId,
      );
      const rawProblems = manifestEvidence?.sourceSheet.contractProblems
        .map(({ code }) => code)
        .join(", ");
      const preparedFigure = trial.preparedSourceFile
        ? `<figure><a href="${htmlEscape(trial.preparedSourceFile)}"><img src="${htmlEscape(trial.preparedSourceFile)}" alt="Prepared source sheet for ${htmlEscape(trial.trialId)}"></a><figcaption>Deterministically prepared source (${htmlEscape(trial.preparedVerdict)})</figcaption></figure>`
        : "";
      return `<article>
        <h3>${htmlEscape(trial.actorId)} · ${htmlEscape(trial.sourceFamily)}</h3>
        <p><code>${htmlEscape(trial.trialId)}</code></p>
        <p>Raw verdict: <strong>${htmlEscape(trial.rawVerdict)}</strong> · prepared verdict: <strong>${htmlEscape(trial.preparedVerdict)}</strong> · packed input: ${htmlEscape(trial.packedInput)}</p>
        <p>Raw exact <code>#ff00ff</code>: ${htmlEscape(manifestEvidence?.sourceSheet.literalMagentaRatio ?? "unknown")} · raw contract findings: ${htmlEscape(rawProblems || "none")}</p>
        <div class="evidence">
          <figure><a href="${htmlEscape(trial.rawNormalizedSourceFile)}"><img src="${htmlEscape(trial.rawNormalizedSourceFile)}" alt="Raw normalized 4 by 4 source sheet for ${htmlEscape(trial.trialId)}"></a><figcaption>Raw generation output normalized to 1024×1024 (${htmlEscape(trial.rawVerdict)})</figcaption></figure>
          ${preparedFigure}
          <figure><a href="${htmlEscape(trial.previewFile)}"><img src="${htmlEscape(trial.previewFile)}" alt="Packed runtime frames for ${htmlEscape(trial.trialId)}"></a><figcaption>Runtime banks packed from ${htmlEscape(trial.packedInput)} input</figcaption></figure>
        </div>
        <dl><dt>Atlas SHA-256</dt><dd><code>${htmlEscape(trial.atlasSha256)}</code></dd><dt>Runtime checks</dt><dd>${trial.runtimeAtlas.banksChecked} banks, ${trial.runtimeAtlas.populatedCellsChecked} populated cells, fixed safe bounds and foot anchor</dd></dl>
      </article>`;
    })
    .join("\n");
  const productionRows = report.deterministicBuilds.actors
    .map(
      (actor) =>
        `<tr><td>${htmlEscape(actor.actorId)}</td><td><code>${htmlEscape(actor.sha256)}</code></td><td>yes</td><td>yes</td></tr>`,
    )
    .join("\n");
  const negativeItems = report.negativeChecks
    .map(
      (check) =>
        `<li><strong>${htmlEscape(check.id)}</strong>: rejected as expected — ${htmlEscape(check.rejectedBecause)}</li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cinderwake generation pipeline verification</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #111719; color: #e9e0d1; }
    body { max-width: 1100px; margin: 0 auto; padding: 24px; line-height: 1.5; }
    h1, h2, h3 { color: #f3c889; }
    article { border: 1px solid #45545a; border-radius: 10px; padding: 16px; margin: 18px 0; background: #172023; }
    .pass { display: inline-block; padding: 5px 10px; border-radius: 999px; color: #0f1914; background: #83d39a; font-weight: 800; }
    .warning { padding: 12px 16px; border-left: 4px solid #e7a852; background: #282219; }
    .evidence { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    figure { margin: 0; min-width: 0; }
    img { width: 100%; height: auto; image-rendering: auto; background: #526b71; border-radius: 6px; }
    figcaption { margin-top: 5px; color: #bfc9c9; }
    code { overflow-wrap: anywhere; color: #d4e8ed; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px; border: 1px solid #45545a; text-align: left; vertical-align: top; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px 12px; }
    dt { color: #bfc9c9; }
    dd { margin: 0; }
    a { color: #9fd6e4; }
  </style>
</head>
<body>
  <h1>Generation pipeline verification</h1>
  <p class="pass">${htmlEscape(report.status.toUpperCase())}</p>
  <p>This report verifies immutable generation inputs and the deterministic path from accepted 4×4 source sheets to runtime actor atlases. AI generation itself is not claimed to be deterministic.</p>
  <p class="warning"><strong>Pipeline-proof acceptance is not production-art approval.</strong> The fresh candidates below exercise the ingress and packer contracts without replacing the shipped source art.</p>
  <h2>Reproduction metadata</h2>
  <dl>
    <dt>Commit</dt><dd><code>${htmlEscape(report.metadata.commit)}</code></dd>
    <dt>Generated</dt><dd>${htmlEscape(report.metadata.generatedAt)}</dd>
    <dt>Runtime</dt><dd>${htmlEscape(report.metadata.node)}, sharp ${htmlEscape(report.metadata.sharp)}, libvips ${htmlEscape(report.metadata.libvips)}</dd>
    <dt>Command</dt><dd><code>${htmlEscape(report.command)}</code></dd>
    <dt>Raw trials</dt><dd>${report.summary.rawAcceptedForPipelineProof} pipeline-proof accepted; ${report.summary.rawRejected} rejected</dd>
    <dt>Prepared trials</dt><dd>${report.summary.preparedAcceptedForPipelineProof} pipeline-proof accepted; ${report.summary.preparedRejected} rejected</dd>
    <dt>Fresh production approvals</dt><dd><strong>${report.summary.freshProductionApproved}</strong></dd>
  </dl>
  <p><a href="report.json">Machine-readable JSON</a> · <a href="index.md">Markdown report</a></p>
  <h2>Manifest checks</h2>
  <ul><li>Generation trials: ${htmlEscape(report.manifests.trials.status)} (${report.manifests.trials.count} checked)</li><li>Accepted production sources: ${htmlEscape(report.manifests.acceptedProduction.status)} (${report.manifests.acceptedProduction.count} checked)</li></ul>
  <h2>Fresh candidate packer trials</h2>
  ${trialCards || "<p>No trial manifest was present.</p>"}
  <h2>Deterministic production rebuilds</h2>
  <table><thead><tr><th>Actor</th><th>SHA-256</th><th>Build A = B</th><th>Matches production</th></tr></thead><tbody>${productionRows}</tbody></table>
  <h2>Rejection controls</h2>
  <ul>${negativeItems}</ul>
</body>
</html>
`;
}

async function writeReport(report) {
  await fs.mkdir(REPORT_DIRECTORY, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(REPORT_DIRECTORY, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(REPORT_DIRECTORY, "index.md"),
      markdownReport(report),
    ),
    fs.writeFile(path.join(REPORT_DIRECTORY, "index.html"), htmlReport(report)),
  ]);
}

async function reproductionMetadata() {
  let commit = process.env.GITHUB_SHA;
  if (!commit) {
    const result = await executeFile("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
    });
    commit = result.stdout.trim();
  }
  return {
    commit,
    generatedAt: new Date().toISOString(),
    node: process.version,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
  };
}

await fs.mkdir(path.join(ROOT, "quality-results"), { recursive: true });
const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-generation-pipeline-"),
);
const fixtureRoot = await fs.mkdtemp(
  path.join(ROOT, "quality-results", ".generation-pipeline-temp-"),
);
try {
  const trialsManifest = await readJsonIfPresent(TRIALS_PATH);
  const acceptedManifest = await readJsonIfPresent(ACCEPTED_PATH);
  const trialEvidence = trialsManifest
    ? await validateTrials(trialsManifest)
    : [];
  const acceptedEvidence = acceptedManifest
    ? await validateAcceptedProduction(acceptedManifest)
    : [];
  const trialBuilds = await verifyTrialBuilds(trialsManifest, temporaryRoot);
  const deterministicBuilds = await verifyDeterministicBuilds(temporaryRoot);
  const negativeChecks = await verifyNegativeFixtures(fixtureRoot);
  const rawAcceptedForPipelineProof = trialEvidence.filter(
    ({ status }) => status === "accepted-for-pipeline-proof",
  ).length;
  const rawRejected = trialEvidence.filter(
    ({ status }) => status === "rejected",
  ).length;
  const preparedAcceptedForPipelineProof = trialEvidence.filter(
    ({ preparation }) => preparation?.status === "accepted-for-pipeline-proof",
  ).length;
  const preparedRejected = trialEvidence.filter(
    ({ preparation }) => preparation?.status === "rejected",
  ).length;
  const report = {
    schemaVersion: 1,
    contract: "CinderwakeGenerationPipelineReportV1",
    status: "pass",
    command: "npm run art:generation:check",
    metadata: await reproductionMetadata(),
    actors: REPRESENTATIVE_ACTORS,
    summary: {
      rawAcceptedForPipelineProof,
      rawRejected,
      preparedAcceptedForPipelineProof,
      preparedRejected,
      freshProductionApproved: 0,
    },
    manifests: {
      trials: {
        status: trialsManifest ? "pass" : "not-present",
        count: trialEvidence.length,
        file: path.relative(ROOT, TRIALS_PATH),
        evidence: trialEvidence,
      },
      acceptedProduction: {
        status: acceptedManifest ? "pass" : "not-present",
        count: acceptedEvidence.length,
        file: path.relative(ROOT, ACCEPTED_PATH),
        evidence: acceptedEvidence,
      },
    },
    trialBuilds,
    deterministicBuilds,
    negativeChecks,
  };
  await writeReport(report);
  console.log(
    `Generation pipeline PASS: ${trialBuilds.length} raw verdicts enforced and prepared outputs reproduced/packed; ${REPRESENTATIVE_ACTORS.length} production actors built twice and matched; ${negativeChecks.length} rejection controls passed.`,
  );
  console.log(path.relative(ROOT, REPORT_DIRECTORY));
} finally {
  await Promise.all([
    fs.rm(temporaryRoot, { recursive: true, force: true }),
    fs.rm(fixtureRoot, { recursive: true, force: true }),
  ]);
}
