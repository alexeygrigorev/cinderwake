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
const calibrationSpec = JSON.parse(
  await fs.readFile(
    path.join(root, "art", "actor-calibration-v1.json"),
    "utf8",
  ),
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
const sourceFootY = actorSpec.atlas.footAnchor.y * sourceScale;
const sourceLastInkY = sourceFootY - 1;
const defaultCandidate = path.join(
  root,
  "art",
  "generation",
  "prepared",
  "ashfang-primary-trial-v2.png",
);
const defaultOutput = path.join(
  root,
  "quality-results",
  "actor-candidate-calibration",
  "ashfang-primary-trial-v2",
);

function parseArguments(arguments_) {
  const options = {
    actorId: "ashfang",
    sourceFamily: "primary",
    profileId: "ashfang-primary-v1",
    candidate: defaultCandidate,
    output: defaultOutput,
    expectedAssessment: "pass",
    expectedViolations: [],
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      console.log(`Usage: node scripts/assess-actor-candidate.mjs [options]

Options:
  --actor <id>          Actor identity whose other five source families calibrate scale
  --family <id>         Candidate source family (currently primary)
  --profile <id>        Threshold profile from art/actor-calibration-v1.json
  --candidate <png>     Prepared 1024x1024 candidate source
  --output <directory>  Derived JSON, HTML, and contact-sheet evidence
  --expect-assessment <pass|fail>
                        Required mechanical outcome (default: pass)
  --expect-violation <code>
                        Named violation required for an expected failure; repeatable`);
      process.exit(0);
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (
      name !== "--actor" &&
      name !== "--family" &&
      name !== "--profile" &&
      name !== "--candidate" &&
      name !== "--output" &&
      name !== "--expect-assessment" &&
      name !== "--expect-violation"
    )
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    if (name === "--actor") options.actorId = value;
    else if (name === "--family") options.sourceFamily = value;
    else if (name === "--profile") options.profileId = value;
    else if (name === "--candidate")
      options.candidate = path.resolve(root, value);
    else if (name === "--output") options.output = path.resolve(root, value);
    else if (name === "--expect-assessment") options.expectedAssessment = value;
    else options.expectedViolations.push(value);
  }
  if (!new Set(["pass", "fail"]).has(options.expectedAssessment))
    throw new Error("--expect-assessment must be pass or fail");
  if (
    options.expectedAssessment === "fail" &&
    options.expectedViolations.length === 0
  )
    throw new Error(
      "Expected candidate failures require at least one --expect-violation",
    );
  if (
    options.expectedAssessment === "pass" &&
    options.expectedViolations.length > 0
  )
    throw new Error("--expect-violation requires --expect-assessment fail");
  if (options.sourceFamily !== "primary")
    throw new Error(
      "The current calibration profile requires the primary idle/walk layout",
    );
  const profile = calibrationSpec.profiles[options.profileId];
  if (!profile)
    throw new Error(`Unknown calibration profile: ${options.profileId}`);
  if (
    profile.actorId !== options.actorId ||
    profile.sourceFamily !== options.sourceFamily
  )
    throw new Error(
      `Calibration profile ${options.profileId} requires ${profile.actorId}/${profile.sourceFamily}`,
    );
  options.thresholds = profile.thresholds;
  options.acceptanceBrief = profile.acceptanceBrief;
  return options;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
}

function median(values) {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function maximumLoopStep(values) {
  return Math.max(
    ...values.map((value, index) =>
      Math.abs(value - values[(index + 1) % values.length]),
    ),
  );
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

async function keyedSource(filePath, { requireExact = false } = {}) {
  const metadata = await sharp(filePath).metadata();
  if (
    !metadata.width ||
    metadata.width !== metadata.height ||
    metadata.width < actorSpec.source.pixelWidth ||
    (requireExact && metadata.width !== actorSpec.source.pixelWidth)
  )
    throw new Error(
      requireExact
        ? `Prepared candidate must be exactly ${actorSpec.source.pixelWidth}x${actorSpec.source.pixelHeight}`
        : `Actor source must be square and at least ${actorSpec.source.pixelWidth}x${actorSpec.source.pixelHeight}`,
    );
  const image = sharp(filePath);
  if (metadata.width !== actorSpec.source.pixelWidth)
    image.resize(actorSpec.source.pixelWidth, actorSpec.source.pixelHeight, {
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

function cellEvidence(source, index) {
  const originX = (index % actorSpec.source.columns) * sourceCell;
  const originY = Math.floor(index / actorSpec.source.columns) * sourceCell;
  const alpha = new Uint8Array(sourceCell * sourceCell);
  for (let y = 0; y < sourceCell; y += 1) {
    for (let x = 0; x < sourceCell; x += 1) {
      const offset = ((originY + y) * source.info.width + originX + x) * 4;
      const value = source.data[offset + 3];
      if (value >= 8) alpha[y * sourceCell + x] = value;
    }
  }
  // Match the real packer: discard boundary-connected fragments except when
  // the boundary component is the main silhouette itself. This prevents raw
  // source-grid residue from incorrectly determining the shared actor scale.
  const visited = new Uint8Array(alpha.length);
  const components = [];
  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || alpha[start] === 0) continue;
    const queue = [start];
    const pixels = [];
    let touchesBoundary = false;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      pixels.push(pixel);
      const x = pixel % sourceCell;
      const y = Math.floor(pixel / sourceCell);
      if (x === 0 || y === 0 || x === sourceCell - 1 || y === sourceCell - 1)
        touchesBoundary = true;
      for (const neighbor of [
        pixel - 1,
        pixel + 1,
        pixel - sourceCell,
        pixel + sourceCell,
      ]) {
        if (
          neighbor < 0 ||
          neighbor >= alpha.length ||
          visited[neighbor] ||
          alpha[neighbor] === 0
        )
          continue;
        if (Math.abs((neighbor % sourceCell) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ pixels, touchesBoundary });
  }
  const largestPixels = Math.max(
    0,
    ...components.map(({ pixels }) => pixels.length),
  );
  for (const component of components) {
    if (!component.touchesBoundary || component.pixels.length === largestPixels)
      continue;
    for (const pixel of component.pixels) alpha[pixel] = 0;
  }
  let left = sourceCell;
  let top = sourceCell;
  let right = -1;
  let bottom = -1;
  let foregroundPixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < sourceCell; y += 1) {
    for (let x = 0; x < sourceCell; x += 1) {
      const pixelAlpha = alpha[y * sourceCell + x];
      if (pixelAlpha < 8) continue;
      foregroundPixels += 1;
      alphaWeight += pixelAlpha;
      weightedX += x * pixelAlpha;
      weightedY += y * pixelAlpha;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (foregroundPixels === 0)
    return {
      index,
      row: Math.floor(index / actorSpec.source.columns),
      column: index % actorSpec.source.columns,
      foregroundPixels,
      blank: true,
      bounds: null,
      centroid: null,
      groundOffset: null,
      insideSafeBounds: false,
    };
  const width = right - left + 1;
  const height = bottom - top + 1;
  return {
    index,
    row: Math.floor(index / actorSpec.source.columns),
    column: index % actorSpec.source.columns,
    foregroundPixels,
    blank: false,
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
    groundOffset: bottom - sourceLastInkY,
    insideSafeBounds:
      left >= sourceSafeBounds.x &&
      top >= sourceSafeBounds.y &&
      right < sourceSafeBounds.x + sourceSafeBounds.width &&
      bottom < sourceSafeBounds.y + sourceSafeBounds.height,
  };
}

function sourceEvidence(source) {
  return Array.from(
    { length: actorSpec.source.columns * actorSpec.source.rows },
    (_, index) => cellEvidence(source, index),
  );
}

async function familyEvidence(filePath) {
  return sourceEvidence(await keyedSource(filePath));
}

async function calibratedScale(options, candidateCells) {
  const allCells = [...candidateCells];
  for (const [sourceFamily, pattern] of Object.entries(
    actorSpec.source.files,
  )) {
    if (sourceFamily === options.sourceFamily) continue;
    const filePath = path.join(
      root,
      "art",
      "source",
      "actors",
      pattern.replace("{actor}", options.actorId),
    );
    allCells.push(...(await familyEvidence(filePath)));
  }
  const populated = allCells.filter(({ blank }) => !blank);
  const maximumWidth = Math.max(...populated.map(({ bounds }) => bounds.width));
  const maximumHeight = Math.max(
    ...populated.map(({ bounds }) => bounds.height),
  );
  return Math.min(
    actorSpec.atlas.safeInkBounds.width / maximumWidth,
    actorSpec.atlas.safeInkBounds.height / maximumHeight,
    1,
  );
}

function projectedCell(cell, scale) {
  if (cell.blank) return { index: cell.index, blank: true };
  const width = Math.max(1, Math.round(cell.bounds.width * scale));
  const height = Math.max(1, Math.round(cell.bounds.height * scale));
  return {
    index: cell.index,
    blank: false,
    width,
    height,
    aspectRatio: rounded(width / height),
    groundY: actorSpec.atlas.footAnchor.y - 1,
    centroid: {
      x: rounded(
        actorSpec.atlas.footAnchor.x -
          width / 2 +
          ((cell.centroid.x - cell.bounds.left) / cell.bounds.width) * width,
      ),
      y: rounded(
        actorSpec.atlas.footAnchor.y -
          height +
          ((cell.centroid.y - cell.bounds.top) / cell.bounds.height) * height,
      ),
    },
  };
}

function groupEvidence(cells) {
  const heights = cells.map(({ height }) => height);
  const aspects = cells.map(({ aspectRatio }) => aspectRatio);
  const centroidY = cells.map(({ centroid }) => centroid.y);
  return {
    cells,
    minimumHeight: Math.min(...heights),
    maximumHeight: Math.max(...heights),
    medianHeight: median(heights),
    maximumAspectRatio: Math.max(...aspects),
    maximumLoopHeightStep: maximumLoopStep(heights),
    maximumLoopCentroidStep: rounded(maximumLoopStep(centroidY)),
  };
}

function walkSupportContactEvidence(source) {
  const masks = Array.from({ length: 4 }, (_, offset) => {
    const index = 4 + offset;
    const originX = (index % actorSpec.source.columns) * sourceCell;
    const originY = Math.floor(index / actorSpec.source.columns) * sourceCell;
    let bottom = -1;
    for (let y = 0; y < sourceCell; y += 1) {
      for (let x = 0; x < sourceCell; x += 1) {
        const alpha =
          source.data[
            ((originY + y) * source.info.width + originX + x) * 4 + 3
          ];
        if (alpha > 96) bottom = Math.max(bottom, y);
      }
    }
    return Array.from({ length: sourceCell }, (_, x) => {
      let occupiedRows = 0;
      for (let y = Math.max(0, bottom - 15); y <= bottom; y += 1) {
        const alpha =
          source.data[
            ((originY + y) * source.info.width + originX + x) * 4 + 3
          ];
        if (alpha > 96) occupiedRows += 1;
      }
      return occupiedRows >= 2;
    });
  });
  let unionColumns = 0;
  let persistentColumns = 0;
  for (let x = 0; x < sourceCell; x += 1) {
    const occupiedPhases = masks.reduce(
      (count, mask) => count + (mask[x] ? 1 : 0),
      0,
    );
    if (occupiedPhases > 0) unionColumns += 1;
    if (occupiedPhases === masks.length) persistentColumns += 1;
  }
  return {
    alphaThreshold: 96,
    contactBandHeight: 16,
    minimumOccupiedRows: 2,
    unionColumns,
    persistentColumns,
    persistentContactRatio: rounded(
      unionColumns === 0 ? 1 : persistentColumns / unionColumns,
    ),
  };
}

async function assessSource(options, source) {
  const { thresholds } = options;
  const cells = sourceEvidence(source);
  const scale = await calibratedScale(options, cells);
  const projected = cells.map((cell) => projectedCell(cell, scale));
  const idle = groupEvidence(projected.slice(0, 4));
  const walk = groupEvidence(projected.slice(4, 8));
  const walkSupportContact = walkSupportContactEvidence(source);
  const violations = [];
  const blankCells = cells
    .filter(
      ({ blank, foregroundPixels }) =>
        blank || foregroundPixels < thresholds.minimumForegroundPixels,
    )
    .map(({ index }) => index);
  if (blankCells.length > 0)
    violations.push({ code: "blank-cell", cells: blankCells });
  if (source.literalMagentaRatio < thresholds.literalMagentaRatioMinimum)
    violations.push({
      code: "literal-magenta-ratio",
      actual: rounded(source.literalMagentaRatio),
      minimum: thresholds.literalMagentaRatioMinimum,
    });
  const unsafeCells = cells
    .filter(({ insideSafeBounds }) => !insideSafeBounds)
    .map(({ index }) => index);
  if (unsafeCells.length > 0)
    violations.push({ code: "safe-ink-bounds", cells: unsafeCells });
  const ungroundedCells = cells
    .filter(
      ({ groundOffset }) =>
        groundOffset === null ||
        Math.abs(groundOffset) > thresholds.sourceGroundTolerancePixels,
    )
    .map(({ index, groundOffset }) => ({ index, groundOffset }));
  if (ungroundedCells.length > 0)
    violations.push({ code: "ground-anchor", cells: ungroundedCells });
  if (idle.minimumHeight < thresholds.runtimeIdleMinimumHeight)
    violations.push({
      code: "idle-minimum-height",
      actual: idle.minimumHeight,
      minimum: thresholds.runtimeIdleMinimumHeight,
    });
  if (
    idle.medianHeight < thresholds.runtimeIdleMedianHeightMinimum ||
    idle.medianHeight > thresholds.runtimeIdleMedianHeightMaximum
  )
    violations.push({
      code: "idle-median-height",
      actual: idle.medianHeight,
      range: [
        thresholds.runtimeIdleMedianHeightMinimum,
        thresholds.runtimeIdleMedianHeightMaximum,
      ],
    });
  if (idle.maximumAspectRatio > thresholds.runtimeIdleMaximumAspectRatio)
    violations.push({
      code: "idle-maximum-aspect",
      actual: idle.maximumAspectRatio,
      maximum: thresholds.runtimeIdleMaximumAspectRatio,
    });
  for (const [name, group] of [
    ["idle", idle],
    ["walk", walk],
  ]) {
    if (group.maximumLoopHeightStep > thresholds.runtimeLoopMaximumHeightStep)
      violations.push({
        code: `${name}-loop-height-step`,
        actual: group.maximumLoopHeightStep,
        maximum: thresholds.runtimeLoopMaximumHeightStep,
      });
    if (
      group.maximumLoopCentroidStep > thresholds.runtimeLoopMaximumCentroidStep
    )
      violations.push({
        code: `${name}-loop-centroid-step`,
        actual: group.maximumLoopCentroidStep,
        maximum: thresholds.runtimeLoopMaximumCentroidStep,
      });
  }
  const idleWalkMedianHeightDifference = Math.abs(
    idle.medianHeight - walk.medianHeight,
  );
  if (
    idleWalkMedianHeightDifference >
    thresholds.runtimeIdleWalkMaximumMedianHeightDifference
  )
    violations.push({
      code: "idle-walk-height-mismatch",
      actual: idleWalkMedianHeightDifference,
      maximum: thresholds.runtimeIdleWalkMaximumMedianHeightDifference,
    });
  if (
    walkSupportContact.persistentContactRatio >
    thresholds.maximumPersistentWalkContactRatio
  )
    violations.push({
      code: "walk-support-contact-persistent",
      actual: walkSupportContact.persistentContactRatio,
      maximum: thresholds.maximumPersistentWalkContactRatio,
      persistentColumns: walkSupportContact.persistentColumns,
      unionColumns: walkSupportContact.unionColumns,
    });
  return {
    pass: violations.length === 0,
    literalMagentaRatio: rounded(source.literalMagentaRatio),
    calibratedSharedScale: rounded(scale),
    sourceContract: {
      cellPixels: sourceCell,
      safeInkBounds: sourceSafeBounds,
      groundInkY: sourceLastInkY,
    },
    cells,
    projectedRuntimeWithoutActorOverrides: {
      idle,
      walk,
      idleWalkMedianHeightDifference,
      walkSupportContact,
    },
    violations,
  };
}

function sourceFromData(data, info, literalMagentaRatio) {
  return { data, info, literalMagentaRatio };
}

function magentaCell() {
  return sharp({
    create: {
      width: sourceCell,
      height: sourceCell,
      channels: 4,
      background: { r: 255, g: 0, b: 255, alpha: 0 },
    },
  })
    .raw()
    .toBuffer();
}

async function replaceCell(source, index, replacement) {
  const data = Buffer.from(source.data);
  const originX = (index % actorSpec.source.columns) * sourceCell;
  const originY = Math.floor(index / actorSpec.source.columns) * sourceCell;
  for (let y = 0; y < sourceCell; y += 1) {
    const targetStart = ((originY + y) * source.info.width + originX) * 4;
    const sourceStart = y * sourceCell * 4;
    replacement.copy(
      data,
      targetStart,
      sourceStart,
      sourceStart + sourceCell * 4,
    );
  }
  return sourceFromData(data, source.info, source.literalMagentaRatio);
}

async function cellBuffer(source, index) {
  return sharp(source.data, { raw: source.info })
    .extract({
      left: (index % actorSpec.source.columns) * sourceCell,
      top: Math.floor(index / actorSpec.source.columns) * sourceCell,
      width: sourceCell,
      height: sourceCell,
    })
    .raw()
    .toBuffer();
}

async function translatedCell(source, index, deltaX, deltaY) {
  const input = await cellBuffer(source, index);
  const background = await magentaCell();
  for (let y = 0; y < sourceCell; y += 1) {
    for (let x = 0; x < sourceCell; x += 1) {
      const targetX = x + deltaX;
      const targetY = y + deltaY;
      if (
        targetX < 0 ||
        targetX >= sourceCell ||
        targetY < 0 ||
        targetY >= sourceCell
      )
        continue;
      const sourceOffset = (y * sourceCell + x) * 4;
      const targetOffset = (targetY * sourceCell + targetX) * 4;
      input.copy(background, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return background;
}

async function oversizedCell(source, index) {
  const evidence = cellEvidence(source, index);
  const input = await cellBuffer(source, index);
  return sharp(input, {
    raw: { width: sourceCell, height: sourceCell, channels: 4 },
  })
    .extract({
      left: evidence.bounds.left,
      top: evidence.bounds.top,
      width: evidence.bounds.width,
      height: evidence.bounds.height,
    })
    .resize(sourceCell, sourceCell, { fit: "fill", kernel: "nearest" })
    .raw()
    .toBuffer();
}

async function negativeControls(options) {
  const fixture = await keyedSource(defaultCandidate, { requireExact: true });
  const baseline = await assessSource(options, fixture);
  if (!baseline.pass)
    throw new Error(
      "Actor candidate rejection controls require the mechanically green v2 fixture",
    );
  const repeatedWalkCell = await cellBuffer(fixture, 4);
  let stuckWalk = fixture;
  for (const index of [5, 6, 7])
    stuckWalk = await replaceCell(stuckWalk, index, repeatedWalkCell);
  const mutations = [
    {
      id: "cut-cell-at-left-edge",
      expectedViolation: "safe-ink-bounds",
      source: await replaceCell(
        fixture,
        0,
        await translatedCell(fixture, 0, -40, 0),
      ),
    },
    {
      id: "oversized-action-shrinks-rig",
      expectedViolation: "idle-minimum-height",
      source: await replaceCell(fixture, 15, await oversizedCell(fixture, 15)),
    },
    {
      id: "walk-frame-jumps-off-ground",
      expectedViolation: "ground-anchor",
      source: await replaceCell(
        fixture,
        6,
        await translatedCell(fixture, 6, 0, -24),
      ),
    },
    {
      id: "walk-support-mask-stuck",
      expectedViolation: "walk-support-contact-persistent",
      source: stuckWalk,
    },
  ];
  return Promise.all(
    mutations.map(async ({ id, expectedViolation, source: mutation }) => {
      const assessment = await assessSource(options, mutation);
      return {
        id,
        expectedViolation,
        fixture: path.relative(root, defaultCandidate),
        fixtureBaselinePass: baseline.pass,
        detected:
          baseline.pass &&
          !assessment.pass &&
          assessment.violations.some(({ code }) => code === expectedViolation),
        violations: assessment.violations.map(({ code }) => code),
      };
    }),
  );
}

function svgBuffer(value) {
  return Buffer.from(value);
}

async function writeContactSheet(source, outputPath) {
  const tileWidth = 160;
  const tileHeight = 160;
  const titleHeight = 48;
  const width = actorSpec.source.columns * tileWidth;
  const height = titleHeight + actorSpec.source.rows * tileHeight;
  const labels = [
    "idle 0",
    "idle 1",
    "idle 2",
    "idle 3",
    "walk 0",
    "walk 1",
    "walk 2",
    "walk 3",
    "attack 0",
    "attack 1",
    "attack 2",
    "attack 3",
    "ability 0",
    "ability 1",
    "ability 2",
    "ability 3",
  ];
  const overlays = [];
  const decorations = [];
  for (let index = 0; index < labels.length; index += 1) {
    const column = index % actorSpec.source.columns;
    const row = Math.floor(index / actorSpec.source.columns);
    const x = column * tileWidth + 16;
    const y = titleHeight + row * tileHeight + 24;
    const cell = await sharp(source.data, { raw: source.info })
      .extract({
        left: column * sourceCell,
        top: row * sourceCell,
        width: sourceCell,
        height: sourceCell,
      })
      .resize(runtimeCell, runtimeCell, { kernel: "nearest" })
      .png()
      .toBuffer();
    overlays.push({ input: cell, left: x, top: y });
    decorations.push(
      `<rect x="${column * tileWidth + 8}" y="${titleHeight + row * tileHeight + 8}" width="144" height="144" rx="4" fill="#19151a" stroke="#59484c"/>`,
      `<rect x="${x + actorSpec.atlas.safeInkBounds.x}" y="${y + actorSpec.atlas.safeInkBounds.y}" width="${actorSpec.atlas.safeInkBounds.width}" height="${actorSpec.atlas.safeInkBounds.height}" fill="none" stroke="#67553f" stroke-dasharray="3 3"/>`,
      `<line x1="${x}" y1="${y + actorSpec.atlas.footAnchor.y}" x2="${x + runtimeCell}" y2="${y + actorSpec.atlas.footAnchor.y}" stroke="#d98a3d" stroke-opacity="0.65"/>`,
      `<text x="${column * tileWidth + 14}" y="${titleHeight + row * tileHeight + 22}" fill="#ead8bb" font-family="sans-serif" font-size="12">${index}: ${labels[index]}</text>`,
    );
  }
  const decoration =
    svgBuffer(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0f0c10"/>
    <text x="16" y="30" fill="#f1c77d" font-family="sans-serif" font-size="18" font-weight="700">Prepared 4×4 cut · safe bounds + foot anchor</text>
    ${decorations.join("\n")}
  </svg>`);
  await sharp(decoration)
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function buildCandidateAtlas(options) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-actor-calibration-"),
  );
  try {
    const sourceDirectory = path.join(temporaryRoot, "sources");
    const outputDirectory = path.join(temporaryRoot, "output");
    await Promise.all([
      fs.mkdir(sourceDirectory, { recursive: true }),
      fs.mkdir(outputDirectory, { recursive: true }),
    ]);
    for (const [sourceFamily, pattern] of Object.entries(
      actorSpec.source.files,
    )) {
      const fileName = pattern.replace("{actor}", options.actorId);
      await fs.copyFile(
        sourceFamily === options.sourceFamily
          ? options.candidate
          : path.join(root, "art", "source", "actors", fileName),
        path.join(sourceDirectory, fileName),
      );
    }
    const build = await executeFile(
      process.execPath,
      [
        path.join(root, "scripts", "build-sprite-assets.mjs"),
        "--actors",
        options.actorId,
        "--source-dir",
        sourceDirectory,
        "--output-dir",
        outputDirectory,
        "--actors-only",
      ],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
    );
    if (build.stderr.trim())
      throw new Error(
        `Candidate atlas builder wrote to stderr: ${build.stderr}`,
      );
    return fs.readFile(
      path.join(outputDirectory, `actor-${options.actorId}.png`),
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function runtimeCellEvidence(atlas, atlasWidth, row, column) {
  let left = runtimeCell;
  let top = runtimeCell;
  let right = -1;
  let bottom = -1;
  let foregroundPixels = 0;
  for (let y = 0; y < runtimeCell; y += 1) {
    for (let x = 0; x < runtimeCell; x += 1) {
      const offset =
        ((row * runtimeCell + y) * atlasWidth + column * runtimeCell + x) * 4;
      if (atlas[offset + 3] < 8) continue;
      foregroundPixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {
    row,
    column,
    foregroundPixels,
    bounds: {
      left,
      top,
      right,
      bottom,
      width: right - left + 1,
      height: bottom - top + 1,
    },
  };
}

async function runtimeEvidence(atlasBytes, actorId) {
  const { data, info } = await sharp(atlasBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    atlasSha256: sha256(atlasBytes),
    currentBuiltIdle: Array.from({ length: 6 }, (_, column) =>
      runtimeCellEvidence(
        data,
        info.width,
        actorSpec.clips.idle.atlasRow,
        column,
      ),
    ),
    currentBuiltWalk: Array.from({ length: 8 }, (_, column) =>
      runtimeCellEvidence(
        data,
        info.width,
        actorSpec.clips.walk.atlasRow,
        column,
      ),
    ),
    legacyWalkOverrideApplied: Boolean(
      actorSpec.actorOverrides?.[actorId]?.clips?.walk?.frameTransform,
    ),
  };
}

async function writeScaleComparison(options, candidateAtlas, outputPath) {
  const actors = [options.actorId, "vanguard", "hexer", "stonekin"];
  const labels = [
    `${options.actorId} trial`,
    "vanguard production",
    "hexer production",
    "stonekin production",
  ];
  const tileWidth = 192;
  const width = tileWidth * actors.length;
  const height = 224;
  const overlays = [];
  for (const [index, actorId] of actors.entries()) {
    const atlas =
      index === 0
        ? candidateAtlas
        : await fs.readFile(
            path.join(
              root,
              "public",
              "assets",
              "sprites",
              `actor-${actorId}.png`,
            ),
          );
    const frame = await sharp(atlas)
      .extract({ left: 0, top: 0, width: runtimeCell, height: runtimeCell })
      .resize(runtimeCell * 1.25, runtimeCell * 1.25, { kernel: "nearest" })
      .png()
      .toBuffer();
    overlays.push({ input: frame, left: index * tileWidth + 16, top: 40 });
  }
  const decoration =
    svgBuffer(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#151116"/>
    <path d="M0 185 H${width}" stroke="#a46b3a" stroke-width="2"/>
    ${labels
      .map(
        (label, index) =>
          `<text x="${index * tileWidth + 12}" y="212" fill="#ead8bb" font-family="sans-serif" font-size="13">${label}</text>`,
      )
      .join("\n")}
  </svg>`);
  await sharp(decoration)
    .composite(overlays)
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
  const cellRows = report.assessment.cells
    .map(
      (cell) =>
        `<tr><td>${cell.index}</td><td>${cell.row}/${cell.column}</td><td>${cell.foregroundPixels}</td><td>${cell.bounds ? `${cell.bounds.left}, ${cell.bounds.top}, ${cell.bounds.width}×${cell.bounds.height}` : "blank"}</td><td>${cell.groundOffset ?? "—"}</td><td>${cell.insideSafeBounds ? "pass" : "fail"}</td></tr>`,
    )
    .join("");
  const controls = report.negativeControls
    .map(
      (control) =>
        `<li><strong>${escapeHtml(control.id)}</strong>: ${control.detected ? "caught" : "MISSED"} (${escapeHtml(control.violations.join(", "))})</li>`,
    )
    .join("");
  const mechanicalViolations = report.assessment.violations
    .map(
      (violation) =>
        `<li><code>${escapeHtml(violation.code)}</code>: ${escapeHtml(JSON.stringify(violation))}</li>`,
    )
    .join("");
  const recordedReasons = (report.recordedArtEvaluation.reasons ?? [])
    .map(
      (reason) =>
        `<li><code>${escapeHtml(reason.code)}</code>: ${escapeHtml(reason.detail)}</li>`,
    )
    .join("");
  const visualReview = report.recordedVisualReview;
  const visualReviewSection = visualReview
    ? `<h2>Independent exact-hash review</h2><p>Verdict: <strong>${escapeHtml(visualReview.verdict)}</strong>. Reviewer: <code>${escapeHtml(visualReview.reviewer)}</code>. Prepared SHA-256: <code>${escapeHtml(visualReview.reviewedPreparedSha256)}</code>.</p><h3>Accepted axes</h3><ul>${visualReview.acceptedAxes.map((axis) => `<li>${escapeHtml(axis)}</li>`).join("")}</ul><h3>Rejected axes</h3><ul>${visualReview.rejectedAxes.map((axis) => `<li>${escapeHtml(axis)}</li>`).join("")}</ul>`
    : "<p>No independent exact-hash visual review is recorded.</p>";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Actor candidate calibration</title>
<style>body{max-width:1100px;margin:2rem auto;padding:0 1rem;background:#0d0b0d;color:#eadfce;font:16px/1.5 system-ui}code{color:#f1c77d}img{max-width:100%;height:auto;border:1px solid #5b4848;background:#171217}table{width:100%;border-collapse:collapse}th,td{padding:.45rem;border-bottom:1px solid #493b3d;text-align:left}.pass{color:#8ed59c}.warn{color:#efb267}figure{margin:1rem 0}figcaption{color:#bbaa9b}</style></head>
<body><h1>Actor candidate calibration</h1>
<p class="${report.status === "pass" ? "pass" : "warn"}">Mechanical gate: <strong>${escapeHtml(report.status.toUpperCase())}</strong>. Recorded art verdict: <strong>${escapeHtml(report.recordedArtVerdict)}</strong>.</p>
<p class="${report.expectation.met ? "pass" : "warn"}">Expected mechanical outcome: <strong>${escapeHtml(report.expectation.assessment.toUpperCase())}</strong>${report.expectation.violations.length > 0 ? ` with <code>${escapeHtml(report.expectation.violations.join(", "))}</code>` : ""}. Reproduced: <strong>${report.expectation.met ? "YES" : "NO"}</strong>.</p>
<p>This report proves cuts, scale, grounding, and loop continuity. It intentionally does not approve anatomy, style, action semantics, or production promotion.</p>
<dl><dt>Candidate</dt><dd><code>${escapeHtml(report.candidate.file)}</code></dd><dt>SHA-256</dt><dd><code>${report.candidate.sha256}</code></dd><dt>Calibrated shared scale</dt><dd>${report.assessment.calibratedSharedScale}</dd><dt>Projected idle height</dt><dd>minimum ${report.assessment.projectedRuntimeWithoutActorOverrides.idle.minimumHeight}, median ${report.assessment.projectedRuntimeWithoutActorOverrides.idle.medianHeight}</dd><dt>Projected idle aspect</dt><dd>maximum ${report.assessment.projectedRuntimeWithoutActorOverrides.idle.maximumAspectRatio}</dd></dl>
<figure><a href="contact-sheet.png"><img src="contact-sheet.png" alt="All sixteen prepared Ashfang cells with safe bounds and anchor guides"></a><figcaption>All sixteen deterministic cuts. The dashed box is safe ink; the orange line is the foot anchor.</figcaption></figure>
<figure><a href="scale-comparison.png"><img src="scale-comparison.png" alt="Ashfang candidate beside production actors at one logical scale"></a><figcaption>Same-scale first-idle comparison. Visual acceptance remains human or vision-model review.</figcaption></figure>
<h2>Every prepared cell</h2><table><thead><tr><th>Cell</th><th>row/column</th><th>ink px</th><th>ink bbox</th><th>ground offset</th><th>safe bounds</th></tr></thead><tbody>${cellRows}</tbody></table>
<h2>Deterministic negative controls</h2><ul>${controls}</ul>
<h2>Verdict boundary</h2><p>Mechanical assessment: <strong>${escapeHtml(report.status)}</strong>. Expected-rejection verification: <strong>${escapeHtml(report.verificationStatus)}</strong>. Recorded raw/art verdict: <strong>${escapeHtml(report.recordedArtVerdict)}</strong>. Recorded prepared verdict: <strong>${escapeHtml(report.recordedPreparationVerdict)}</strong>. Mechanical success never implies visual or production approval.</p>${mechanicalViolations ? `<h3>Mechanical violations</h3><ul>${mechanicalViolations}</ul>` : "<p>No mechanical violations were measured.</p>"}${recordedReasons ? `<h3>Recorded raw/art reasons</h3><ul>${recordedReasons}</ul>` : ""}<p>${escapeHtml(report.recordedArtEvaluation.notes)}</p>${visualReviewSection}
</body></html>`;
}

async function recordedVerdict(options) {
  const trials = JSON.parse(
    await fs.readFile(
      path.join(root, "art", "generation", "trials.json"),
      "utf8",
    ),
  );
  const relativeCandidate = path.relative(root, options.candidate);
  const trial = trials.trials.find(
    ({ preparation }) => preparation?.file === relativeCandidate,
  );
  if (!trial)
    throw new Error("Candidate is missing from generation trials metadata");
  return {
    trialId: trial.id,
    evaluation: trial.evaluation.status,
    preparation: trial.preparation.status,
    evaluationRecord: trial.evaluation,
    visualReview: trial.visualReview ?? null,
  };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const [candidateBytes, source, verdict] = await Promise.all([
    fs.readFile(options.candidate),
    keyedSource(options.candidate, { requireExact: true }),
    recordedVerdict(options),
  ]);
  const assessment = await assessSource(options, source);
  const controls = await negativeControls(options);
  const candidateAtlas = await buildCandidateAtlas(options);
  const runtime = await runtimeEvidence(candidateAtlas, options.actorId);
  const controlsPass = controls.every(({ detected }) => detected);
  const status = assessment.pass && controlsPass ? "pass" : "fail";
  const actualViolationCodes = new Set(
    assessment.violations.map(({ code }) => code),
  );
  const missingExpectedViolations = options.expectedViolations.filter(
    (code) => !actualViolationCodes.has(code),
  );
  const unexpectedViolations = [...actualViolationCodes].filter(
    (code) => !options.expectedViolations.includes(code),
  );
  const expectedAssessmentMet =
    options.expectedAssessment === "pass"
      ? assessment.pass
      : !assessment.pass &&
        missingExpectedViolations.length === 0 &&
        unexpectedViolations.length === 0;
  const recordedPreparationMet =
    options.expectedAssessment === "pass" || verdict.preparation === "rejected";
  const candidateSha256 = sha256(candidateBytes);
  const visualReviewMet =
    options.expectedAssessment === "pass" ||
    (verdict.visualReview?.verdict === "REJECT" &&
      verdict.visualReview.reviewedPreparedSha256 === candidateSha256);
  const expectationMet =
    expectedAssessmentMet &&
    controlsPass &&
    recordedPreparationMet &&
    visualReviewMet;
  await fs.mkdir(options.output, { recursive: true });
  await Promise.all([
    writeContactSheet(source, path.join(options.output, "contact-sheet.png")),
    writeScaleComparison(
      options,
      candidateAtlas,
      path.join(options.output, "scale-comparison.png"),
    ),
  ]);
  const report = {
    schemaVersion: 2,
    contract: "CinderwakeActorCandidateCalibrationV2",
    status,
    verificationStatus: expectationMet ? "pass" : "fail",
    scope:
      "Deterministic mechanical assessment only; visual art and production promotion remain separately reviewed.",
    candidate: {
      actorId: options.actorId,
      sourceFamily: options.sourceFamily,
      trialId: verdict.trialId,
      file: path.relative(root, options.candidate),
      sha256: candidateSha256,
    },
    recordedArtVerdict: verdict.evaluation,
    recordedPreparationVerdict: verdict.preparation,
    recordedArtEvaluation: verdict.evaluationRecord,
    recordedVisualReview: verdict.visualReview,
    expectation: {
      assessment: options.expectedAssessment,
      violations: options.expectedViolations,
      missingExpectedViolations,
      unexpectedViolations,
      assessmentMet: expectedAssessmentMet,
      negativeControlsMet: controlsPass,
      recordedPreparationMet,
      visualReviewMet,
      met: expectationMet,
    },
    profile: {
      id: options.profileId,
      acceptanceBrief: options.acceptanceBrief,
    },
    thresholds: options.thresholds,
    assessment,
    runtimeBuiltWithCurrentActorOverrides: runtime,
    negativeControls: controls,
    artifacts: ["contact-sheet.png", "scale-comparison.png"],
  };
  await Promise.all([
    fs.writeFile(
      path.join(options.output, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    fs.writeFile(path.join(options.output, "index.html"), htmlReport(report)),
  ]);
  if (!expectationMet)
    throw new Error(
      `Actor candidate expectation failed: expected=${options.expectedAssessment}, actual=${assessment.pass ? "pass" : "fail"}, missing-violations=${missingExpectedViolations.join(",") || "none"}, unexpected-violations=${unexpectedViolations.join(",") || "none"}, negative-controls=${controlsPass}, recorded-preparation=${verdict.preparation}, visual-review=${visualReviewMet}`,
    );
  if (options.expectedAssessment === "fail") {
    console.log(
      `Actor candidate rejection reproduced: ${options.expectedViolations.join(", ")}; 16/16 cells measured and ${controls.length}/${controls.length} rejection controls caught; recorded preparation remains ${verdict.preparation}.`,
    );
    return;
  }
  console.log(
    `Actor candidate calibration passed mechanically: 16/16 cells measured, idle median ${assessment.projectedRuntimeWithoutActorOverrides.idle.medianHeight}px, ${controls.length}/${controls.length} rejection controls caught; recorded art verdict remains ${verdict.evaluation}.`,
  );
}

await run();
