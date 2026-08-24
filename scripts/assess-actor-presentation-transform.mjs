import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const actorSpec = JSON.parse(
  await fs.readFile(path.join(root, "art", "actor-atlas-v1.json"), "utf8"),
);
const cellSize = actorSpec.atlas.cellWidth;
const footAnchor = actorSpec.atlas.footAnchor;
const safeBounds = actorSpec.atlas.safeInkBounds;
const defaultExperiment = path.join(
  root,
  "art",
  "presentation-experiments",
  "ashfang-uniform-transform-v1.json",
);
const defaultOutput = path.join(
  root,
  "quality-results",
  "actor-presentation",
  "ashfang-uniform-transform-v1",
);
const clipLayout = [
  { id: "idle", row: actorSpec.clips.idle.atlasRow, frames: 6, looping: true },
  { id: "walk", row: actorSpec.clips.walk.atlasRow, frames: 8, looping: true },
  {
    id: "attack",
    row: actorSpec.clips.attack.atlasRow,
    frames: 6,
    recovery: true,
  },
  {
    id: "ability",
    row: actorSpec.clips.ability.atlasRow,
    frames: 8,
    recovery: true,
  },
  {
    id: "hurt",
    row: actorSpec.clips.hurt.atlasRow,
    frames: 4,
    recovery: true,
  },
  { id: "death", row: actorSpec.clips.death.atlasRow, frames: 8 },
];

function parseArguments(arguments_) {
  const options = { experiment: defaultExperiment, output: defaultOutput };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      console.log(`Usage: node scripts/assess-actor-presentation-transform.mjs [options]

Options:
  --experiment <json>  Immutable experiment metadata and search envelope
  --output <directory> Derived report and visual evidence`);
      process.exit(0);
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--experiment" && name !== "--output")
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

function median(values) {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function maximumLoopStep(values, measure) {
  return Math.max(
    ...values.map((value, index) =>
      measure(value, values[(index + 1) % values.length]),
    ),
  );
}

function maximumLinearStep(values, measure) {
  return Math.max(
    0,
    ...values
      .slice(0, -1)
      .map((value, index) => measure(value, values[index + 1])),
  );
}

async function alphaBounds(buffer, label) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error(`${label} is blank`);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

async function transformFrame(buffer, transform) {
  const bounds = await alphaBounds(buffer, "transform input");
  const width = Math.max(1, Math.round(bounds.width * transform.scaleX));
  const height = Math.max(1, Math.round(bounds.height * transform.scaleY));
  const sprite = await sharp(buffer)
    .extract(bounds)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const left =
    transform.anchor === "foot"
      ? Math.round(footAnchor.x - width / 2)
      : Math.round(bounds.left + (bounds.width - width) / 2);
  const top =
    transform.anchor === "foot"
      ? footAnchor.y - height
      : Math.round(bounds.top + (bounds.height - height) / 2);
  if (left < 0 || top < 0 || left + width > cellSize || top + height > cellSize)
    return {
      buffer: null,
      placement: { left, top, width, height },
      clipped: true,
    };
  const output = await sharp({
    create: {
      width: cellSize,
      height: cellSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: sprite, left, top }])
    .png()
    .toBuffer();
  return {
    buffer: output,
    placement: { left, top, width, height },
    clipped: false,
  };
}

async function atlasFrames(atlasBytes) {
  const frames = {};
  for (const clip of clipLayout) {
    frames[clip.id] = [];
    for (let column = 0; column < clip.frames; column += 1)
      frames[clip.id].push(
        await sharp(atlasBytes)
          .extract({
            left: column * cellSize,
            top: clip.row * cellSize,
            width: cellSize,
            height: cellSize,
          })
          .png()
          .toBuffer(),
      );
  }
  return frames;
}

async function canonicalFrames(currentFrames, experiment) {
  const frames = {};
  for (const clip of clipLayout) {
    frames[clip.id] = [];
    for (const frame of currentFrames[clip.id]) {
      if (clip.id !== "walk") {
        frames[clip.id].push(frame);
        continue;
      }
      const inverse = await transformFrame(frame, {
        scaleX: 1 / experiment.legacyWalkTransform.scaleX,
        scaleY: 1 / experiment.legacyWalkTransform.scaleY,
        anchor: "foot",
      });
      if (inverse.clipped)
        throw new Error("Legacy walk inverse unexpectedly clipped");
      frames[clip.id].push(inverse.buffer);
    }
  }
  return frames;
}

async function transformedFrames(frames, transform, onlyClip = undefined) {
  const output = {};
  const placements = {};
  for (const clip of clipLayout) {
    output[clip.id] = [];
    placements[clip.id] = [];
    for (const frame of frames[clip.id]) {
      if (onlyClip && clip.id !== onlyClip) {
        output[clip.id].push(frame);
        placements[clip.id].push(undefined);
        continue;
      }
      const transformed = await transformFrame(frame, transform);
      output[clip.id].push(transformed.buffer);
      placements[clip.id].push(transformed.placement);
    }
  }
  return { frames: output, placements };
}

async function frameEvidence(buffer, label) {
  if (!buffer)
    return {
      label,
      clipped: true,
      bounds: null,
      centroid: null,
      mask: null,
      sha256: null,
    };
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(cellSize * cellSize);
  let left = cellSize;
  let top = cellSize;
  let right = -1;
  let bottom = -1;
  let foregroundPixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < cellSize; y += 1) {
    for (let x = 0; x < cellSize; x += 1) {
      const offset = (y * info.width + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < 8) continue;
      mask[y * cellSize + x] = 1;
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
  return {
    label,
    clipped: false,
    foregroundPixels,
    bounds: {
      left,
      top,
      right,
      bottom,
      width: right - left + 1,
      height: bottom - top + 1,
      aspectRatio: rounded((right - left + 1) / (bottom - top + 1)),
    },
    centroid: {
      x: rounded(weightedX / alphaWeight),
      y: rounded(weightedY / alphaWeight),
    },
    mask,
    sha256: sha256(data),
  };
}

function maskIou(first, second) {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] && second[index]) intersection += 1;
    if (first[index] || second[index]) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

function dimensionStep(first, second) {
  return Math.max(
    Math.abs(first.bounds.width - second.bounds.width),
    Math.abs(first.bounds.height - second.bounds.height),
  );
}

function bankEvidence(frames, clip) {
  const centroidMeasure = (first, second) =>
    distance(first.centroid, second.centroid);
  const metrics = {
    minimumHeight: Math.min(...frames.map(({ bounds }) => bounds.height)),
    maximumHeight: Math.max(...frames.map(({ bounds }) => bounds.height)),
    medianHeight: median(frames.map(({ bounds }) => bounds.height)),
    maximumAspectRatio: Math.max(
      ...frames.map(({ bounds }) => bounds.aspectRatio),
    ),
    maximumCentroidStep: rounded(
      clip.looping
        ? maximumLoopStep(frames, centroidMeasure)
        : maximumLinearStep(frames, centroidMeasure),
    ),
    maximumHeightStep: clip.looping
      ? maximumLoopStep(frames, (first, second) =>
          Math.abs(first.bounds.height - second.bounds.height),
        )
      : maximumLinearStep(frames, (first, second) =>
          Math.abs(first.bounds.height - second.bounds.height),
        ),
    maximumDimensionStep: clip.looping
      ? maximumLoopStep(frames, dimensionStep)
      : maximumLinearStep(frames, dimensionStep),
    minimumMaskIou: rounded(
      Math.min(
        ...(clip.looping ? frames : frames.slice(0, -1)).map((frame, index) =>
          maskIou(frame.mask, frames[(index + 1) % frames.length].mask),
        ),
      ),
    ),
  };
  return metrics;
}

async function assess(frames, experiment, transformContract) {
  const evidence = {};
  let clipped = false;
  for (const clip of clipLayout) {
    evidence[clip.id] = [];
    for (const [index, frame] of frames[clip.id].entries()) {
      const measured = await frameEvidence(frame, `${clip.id} ${index}`);
      clipped ||= measured.clipped;
      evidence[clip.id].push(measured);
    }
  }
  const banks = Object.fromEntries(
    clipLayout.map((clip) => [
      clip.id,
      clipped ? null : bankEvidence(evidence[clip.id], clip),
    ]),
  );
  const thresholds = experiment.thresholds;
  const violations = [];
  if (clipped) violations.push({ code: "frame-clipping" });
  if (!transformContract.uniform)
    violations.push({ code: "nonuniform-transform-envelope" });
  if (
    transformContract.maximumAxisScaleRatio > thresholds.maximumAxisScaleRatio
  )
    violations.push({
      code: "axis-scale-distortion",
      actual: transformContract.maximumAxisScaleRatio,
      maximum: thresholds.maximumAxisScaleRatio,
    });
  if (!clipped) {
    const unsafe = Object.entries(evidence).flatMap(([clipId, clipFrames]) =>
      clipFrames
        .map((frame, index) => ({ clipId, index, frame }))
        .filter(
          ({ frame }) =>
            frame.bounds.left < safeBounds.x ||
            frame.bounds.top < safeBounds.y ||
            frame.bounds.right >= safeBounds.x + safeBounds.width ||
            frame.bounds.bottom >= safeBounds.y + safeBounds.height,
        )
        .map(({ clipId, index }) => `${clipId}:${index}`),
    );
    if (unsafe.length > 0)
      violations.push({ code: "safe-ink-bounds", frames: unsafe });
    const floating = Object.entries(evidence).flatMap(([clipId, clipFrames]) =>
      clipFrames
        .map((frame, index) => ({ clipId, index, bottom: frame.bounds.bottom }))
        .filter(({ bottom }) => bottom !== footAnchor.y - 1),
    );
    if (floating.length > 0)
      violations.push({ code: "foot-anchor-drift", frames: floating });
    if (banks.idle.minimumHeight < thresholds.runtimeIdleMinimumHeight)
      violations.push({
        code: "idle-minimum-height",
        actual: banks.idle.minimumHeight,
        minimum: thresholds.runtimeIdleMinimumHeight,
      });
    if (
      banks.idle.medianHeight < thresholds.runtimeIdleMedianHeightMinimum ||
      banks.idle.medianHeight > thresholds.runtimeIdleMedianHeightMaximum
    )
      violations.push({
        code: "idle-median-height",
        actual: banks.idle.medianHeight,
        range: [
          thresholds.runtimeIdleMedianHeightMinimum,
          thresholds.runtimeIdleMedianHeightMaximum,
        ],
      });
    if (
      banks.idle.maximumAspectRatio > thresholds.runtimeIdleMaximumAspectRatio
    )
      violations.push({
        code: "idle-maximum-aspect",
        actual: banks.idle.maximumAspectRatio,
        maximum: thresholds.runtimeIdleMaximumAspectRatio,
      });
    for (const clipId of ["idle", "walk"]) {
      const bank = banks[clipId];
      if (bank.maximumCentroidStep > thresholds.runtimeLoopMaximumCentroidStep)
        violations.push({
          code: `${clipId}-centroid-step`,
          actual: bank.maximumCentroidStep,
          maximum: thresholds.runtimeLoopMaximumCentroidStep,
        });
      if (bank.maximumHeightStep > thresholds.runtimeLoopMaximumHeightStep)
        violations.push({
          code: `${clipId}-height-step`,
          actual: bank.maximumHeightStep,
          maximum: thresholds.runtimeLoopMaximumHeightStep,
        });
      if (bank.minimumMaskIou < thresholds.runtimeLoopMinimumMaskIou)
        violations.push({
          code: `${clipId}-mask-iou`,
          actual: bank.minimumMaskIou,
          minimum: thresholds.runtimeLoopMinimumMaskIou,
        });
    }
    const idleWalkHeightDifference = Math.abs(
      banks.idle.medianHeight - banks.walk.medianHeight,
    );
    if (
      idleWalkHeightDifference >
      thresholds.runtimeIdleWalkMaximumMedianHeightDifference
    )
      violations.push({
        code: "idle-walk-height-mismatch",
        actual: idleWalkHeightDifference,
        maximum: thresholds.runtimeIdleWalkMaximumMedianHeightDifference,
      });
    for (const clipId of ["attack", "ability"]) {
      if (
        banks[clipId].maximumCentroidStep > thresholds.actionMaximumCentroidStep
      )
        violations.push({
          code: `${clipId}-centroid-step`,
          actual: banks[clipId].maximumCentroidStep,
          maximum: thresholds.actionMaximumCentroidStep,
        });
      if (
        banks[clipId].maximumDimensionStep >
        thresholds.actionMaximumDimensionStep
      )
        violations.push({
          code: `${clipId}-dimension-step`,
          actual: banks[clipId].maximumDimensionStep,
          maximum: thresholds.actionMaximumDimensionStep,
        });
    }
    if (banks.hurt.maximumCentroidStep > thresholds.hurtMaximumCentroidStep)
      violations.push({
        code: "hurt-centroid-step",
        actual: banks.hurt.maximumCentroidStep,
        maximum: thresholds.hurtMaximumCentroidStep,
      });
    if (banks.death.maximumCentroidStep > thresholds.deathMaximumCentroidStep)
      violations.push({
        code: "death-centroid-step",
        actual: banks.death.maximumCentroidStep,
        maximum: thresholds.deathMaximumCentroidStep,
      });
    if (banks.death.maximumDimensionStep > thresholds.deathMaximumDimensionStep)
      violations.push({
        code: "death-dimension-step",
        actual: banks.death.maximumDimensionStep,
        maximum: thresholds.deathMaximumDimensionStep,
      });
    const idleSha = evidence.idle[0].sha256;
    const brokenRecoveries = ["attack", "ability", "hurt"].filter(
      (clipId) => evidence[clipId].at(-1).sha256 !== idleSha,
    );
    if (brokenRecoveries.length > 0)
      violations.push({
        code: "clip-to-idle-frame-mismatch",
        clips: brokenRecoveries,
      });
  }
  return {
    pass: violations.length === 0,
    transformContract,
    banks,
    violations,
    frames: Object.fromEntries(
      Object.entries(evidence).map(([clipId, clipFrames]) => [
        clipId,
        clipFrames.map((frame) => {
          const serialized = { ...frame };
          delete serialized.mask;
          return serialized;
        }),
      ]),
    ),
  };
}

function projectedBank(cells, scaleX, scaleY) {
  return cells.map(({ bounds, centroid }) => ({
    bounds: {
      width: Math.max(1, Math.round(bounds.width * scaleX)),
      height: Math.max(1, Math.round(bounds.height * scaleY)),
    },
    centroid: {
      x: rounded(footAnchor.x + (centroid.x - footAnchor.x) * scaleX),
      y: rounded(footAnchor.y + (centroid.y - footAnchor.y) * scaleY),
    },
  }));
}

function rangeValues(range) {
  const values = [];
  const steps = Math.round((range.maximum - range.minimum) / range.step);
  for (let index = 0; index <= steps; index += 1)
    values.push(rounded(range.minimum + range.step * index));
  return values;
}

function searchEnvelope(canonicalEvidence, experiment) {
  const results = [];
  const idleBase = canonicalEvidence.idle;
  const walkBase = canonicalEvidence.walk;
  for (const scaleX of rangeValues(experiment.search.scaleX)) {
    for (const scaleY of rangeValues(experiment.search.scaleY)) {
      const idle = projectedBank(idleBase, scaleX, scaleY);
      const walk = projectedBank(walkBase, scaleX, scaleY);
      const idleHeights = idle.map(({ bounds }) => bounds.height);
      const walkHeights = walk.map(({ bounds }) => bounds.height);
      const idleWidths = idle.map(({ bounds }) => bounds.width);
      const idleMedian = median(idleHeights);
      const walkMedian = median(walkHeights);
      const maximumAspect = Math.max(
        ...idleWidths.map((width, index) => width / idleHeights[index]),
      );
      const heightMismatch = Math.abs(idleMedian - walkMedian);
      const axisScaleRatio = scaleY / scaleX;
      const failures = [];
      if (
        Math.min(...idleHeights) <
        experiment.thresholds.runtimeIdleMinimumHeight
      )
        failures.push("idle-minimum-height");
      if (
        idleMedian < experiment.thresholds.runtimeIdleMedianHeightMinimum ||
        idleMedian > experiment.thresholds.runtimeIdleMedianHeightMaximum
      )
        failures.push("idle-median-height");
      if (maximumAspect > experiment.thresholds.runtimeIdleMaximumAspectRatio)
        failures.push("idle-maximum-aspect");
      if (
        heightMismatch >
        experiment.thresholds.runtimeIdleWalkMaximumMedianHeightDifference
      )
        failures.push("idle-walk-height-mismatch");
      if (axisScaleRatio > experiment.thresholds.maximumAxisScaleRatio)
        failures.push("axis-scale-distortion");
      results.push({
        scaleX,
        scaleY,
        idleMinimumHeight: Math.min(...idleHeights),
        idleMedianHeight: idleMedian,
        walkMedianHeight: walkMedian,
        idleMaximumAspectRatio: rounded(maximumAspect),
        idleWalkMedianHeightDifference: heightMismatch,
        axisScaleRatio: rounded(axisScaleRatio),
        pass: failures.length === 0,
        failures,
      });
    }
  }
  return {
    candidatesChecked: results.length,
    passingCandidates: results.filter(({ pass }) => pass).length,
    ranges: experiment.search,
    failureCounts: Object.fromEntries(
      [
        "idle-minimum-height",
        "idle-median-height",
        "idle-maximum-aspect",
        "idle-walk-height-mismatch",
        "axis-scale-distortion",
      ].map((code) => [
        code,
        results.filter(({ failures }) => failures.includes(code)).length,
      ]),
    ),
    reviewTransformProjection: results.find(
      ({ scaleX, scaleY }) =>
        scaleX === experiment.reviewTransform.scaleX &&
        scaleY === experiment.reviewTransform.scaleY,
    ),
  };
}

async function canonicalEvidence(frames) {
  const evidence = {};
  for (const clip of clipLayout)
    evidence[clip.id] = await Promise.all(
      frames[clip.id].map((frame, index) =>
        frameEvidence(frame, `${clip.id} base ${index}`),
      ),
    );
  return evidence;
}

async function contactSheet(panels, outputPath) {
  const displayCell = 64;
  const labelWidth = 104;
  const rowHeight = 78;
  const panelHeader = 38;
  const panelWidth = labelWidth + displayCell * 8;
  const panelHeight = panelHeader + rowHeight * clipLayout.length;
  const width = panelWidth;
  const height = panelHeight * panels.length;
  const composites = [];
  const labels = [];
  for (const [panelIndex, panel] of panels.entries()) {
    const panelY = panelIndex * panelHeight;
    labels.push(
      `<rect x="0" y="${panelY}" width="${width}" height="${panelHeader}" fill="#24181b"/><text x="12" y="${panelY + 25}" fill="#f1c77d" font-family="sans-serif" font-size="16" font-weight="700">${panel.label}</text>`,
    );
    for (const [rowIndex, clip] of clipLayout.entries()) {
      const y = panelY + panelHeader + rowIndex * rowHeight;
      labels.push(
        `<text x="10" y="${y + 38}" fill="#ddcbb7" font-family="sans-serif" font-size="13">${clip.id}</text>`,
      );
      for (let column = 0; column < 8; column += 1) {
        const x = labelWidth + column * displayCell;
        labels.push(
          `<rect x="${x}" y="${y}" width="${displayCell}" height="${displayCell}" fill="url(#c)" stroke="#403538"/>`,
        );
        const frame = panel.frames[clip.id][column];
        if (!frame) continue;
        composites.push({
          input: await sharp(frame)
            .resize(displayCell, displayCell, { kernel: "nearest" })
            .png()
            .toBuffer(),
          left: x,
          top: y,
        });
      }
    }
  }
  const background = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="c" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#243033"/><path d="M0 0h6v6H0zM6 6h6v6H6z" fill="#1c272a"/></pattern></defs><rect width="100%" height="100%" fill="#0e0b0e"/>${labels.join("\n")}</svg>`,
  );
  await sharp(background)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function tintedMask(frame, color) {
  const { data, info } = await sharp(frame)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = Math.round(alpha * 0.62);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function maskOverlay(currentFrames, afterFrames, outputPath) {
  const selected = [
    ...currentFrames.idle.slice(0, 4).map((before, index) => ({
      label: `idle ${index}`,
      before,
      after: afterFrames.idle[index],
    })),
    ...currentFrames.walk.slice(0, 4).map((before, index) => ({
      label: `walk ${index}`,
      before,
      after: afterFrames.walk[index],
    })),
  ];
  const tile = 144;
  const width = tile * 4;
  const height = tile * 2 + 36;
  const labels = selected
    .map(
      ({ label }, index) =>
        `<text x="${(index % 4) * tile + 8}" y="${Math.floor(index / 4) * tile + 18}" fill="#ead8bb" font-family="sans-serif" font-size="12">${label}</text>`,
    )
    .join("");
  const background = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111013"/>${labels}<text x="8" y="${height - 10}" fill="#dc6c69" font-family="sans-serif" font-size="12">red = current production</text><text x="180" y="${height - 10}" fill="#69cddd" font-family="sans-serif" font-size="12">cyan = uniform experiment</text></svg>`,
  );
  const composites = [];
  for (const [index, item] of selected.entries()) {
    const left = (index % 4) * tile + 8;
    const top = Math.floor(index / 4) * tile + 8;
    composites.push(
      {
        input: await tintedMask(item.before, { r: 236, g: 74, b: 72 }),
        left,
        top,
      },
      {
        input: await tintedMask(item.after, { r: 72, g: 218, b: 235 }),
        left,
        top,
      },
    );
  }
  await sharp(background)
    .composite(composites)
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
  const violationItems = report.reviewAssessment.violations
    .map(
      ({ code, actual, maximum }) =>
        `<li><strong>${escapeHtml(code)}</strong>${actual === undefined ? "" : `: ${actual} (maximum ${maximum})`}</li>`,
    )
    .join("");
  const controls = report.negativeControls
    .map(
      ({ id, detected, violations }) =>
        `<li><strong>${escapeHtml(id)}</strong>: ${detected ? "caught" : "MISSED"} — ${escapeHtml(violations.join(", "))}</li>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Ashfang uniform transform experiment</title><style>body{max-width:1000px;margin:2rem auto;padding:0 1rem;background:#0c0a0c;color:#eadfce;font:16px/1.5 system-ui}code{color:#efbd70}img{max-width:100%;height:auto;border:1px solid #574448}.reject{color:#ef8d83}figure{margin:1.4rem 0}figcaption{color:#bba99d}</style></head><body><h1>Ashfang uniform transform experiment</h1><p class="reject"><strong>REJECTED:</strong> no production change is recommended.</p><p>${escapeHtml(report.recommendation)}</p><dl><dt>Immutable atlas</dt><dd><code>${report.sources.atlas.sha256}</code></dd><dt>Search</dt><dd>${report.search.candidatesChecked} uniform foot-anchored envelopes; ${report.search.passingCandidates} passed</dd><dt>Review transform</dt><dd><code>scaleX ${report.reviewTransform.scaleX}, scaleY ${report.reviewTransform.scaleY}</code></dd><dt>Idle / walk median height</dt><dd>${report.reviewAssessment.banks.idle.medianHeight} / ${report.reviewAssessment.banks.walk.medianHeight} px</dd></dl><h2>Why it fails</h2><ul>${violationItems}</ul><p>It does keep every frame inside safe ink bounds, every foot at Y ${footAnchor.y - 1}, and the attack, ability, and hurt terminal frames byte-identical to transformed idle. Those successes do not repair the stop/start scale pop or the source silhouette.</p><figure><a href="before-after-contact-sheet.png"><img src="before-after-contact-sheet.png" alt="Current Ashfang atlas beside the uniform transform experiment"></a><figcaption>All side-facing idle, walk, action, hurt, and death frames. The candidate uses one transform after removing the legacy walk-only deformation.</figcaption></figure><figure><a href="mask-overlay.png"><img src="mask-overlay.png" alt="Current and uniform Ashfang masks overlaid"></a><figcaption>Red is current production; cyan is the uniform transform. The idle grows while the canonical walk remains materially shorter.</figcaption></figure><h2>Paired bad-transform controls</h2><ul>${controls}</ul><p>Passing raster mechanics would still not prove that the prone source silhouette looks like a living predator. The independent visual rejection therefore remains authoritative even if a future transform clears these numeric gates.</p></body></html>`;
}

async function validateSource(record, label) {
  const filePath = path.resolve(root, record.file);
  const bytes = await fs.readFile(filePath);
  const actual = sha256(bytes);
  if (actual !== record.sha256)
    throw new Error(`${label} has a stale sha256: ${actual}`);
  return { filePath, bytes, sha256: actual };
}

function transformContract(transform, uniform = true) {
  return {
    uniform,
    transform,
    maximumAxisScaleRatio: rounded(
      Math.max(
        transform.scaleY / transform.scaleX,
        transform.scaleX / transform.scaleY,
      ),
    ),
  };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const experiment = JSON.parse(await fs.readFile(options.experiment, "utf8"));
  if (
    experiment.contract !== "CinderwakeActorPresentationExperimentV1" ||
    experiment.status !== "rejected"
  )
    throw new Error(
      "Experiment metadata must declare the rejected V1 contract",
    );
  const [atlas, primary] = await Promise.all([
    validateSource(experiment.sources.atlas, "experiment atlas"),
    validateSource(experiment.sources.primary, "experiment primary source"),
  ]);
  const current = await atlasFrames(atlas.bytes);
  const canonical = await canonicalFrames(current, experiment);
  const canonicalMetrics = await canonicalEvidence(canonical);
  const search = searchEnvelope(canonicalMetrics, experiment);
  const selected = await transformedFrames(
    canonical,
    experiment.reviewTransform,
  );
  const repeatedSelected = await transformedFrames(
    canonical,
    experiment.reviewTransform,
  );
  const selectedDigest = sha256(
    Buffer.concat(clipLayout.flatMap(({ id }) => selected.frames[id])),
  );
  const repeatedDigest = sha256(
    Buffer.concat(clipLayout.flatMap(({ id }) => repeatedSelected.frames[id])),
  );
  const reviewAssessment = await assess(
    selected.frames,
    experiment,
    transformContract(experiment.reviewTransform),
  );
  const centerTransform = {
    ...experiment.reviewTransform,
    anchor: "center",
  };
  const center = await transformedFrames(canonical, centerTransform);
  const centerAssessment = await assess(
    center.frames,
    experiment,
    transformContract(centerTransform),
  );
  const excessiveTransform = {
    scaleX: experiment.reviewTransform.scaleX,
    scaleY: 1.5,
    anchor: "foot",
  };
  const excessive = await transformedFrames(canonical, excessiveTransform);
  const excessiveAssessment = await assess(
    excessive.frames,
    experiment,
    transformContract(excessiveTransform),
  );
  const walkOnly = await transformedFrames(
    canonical,
    experiment.reviewTransform,
    "walk",
  );
  const walkOnlyAssessment = await assess(
    walkOnly.frames,
    experiment,
    transformContract(experiment.reviewTransform, false),
  );
  const controls = [
    {
      id: "center-anchor-drift",
      expectedViolation: "foot-anchor-drift",
      assessment: centerAssessment,
    },
    {
      id: "excessive-vertical-scale",
      expectedViolation: "idle-median-height",
      assessment: excessiveAssessment,
    },
    {
      id: "walk-only-transform",
      expectedViolation: "nonuniform-transform-envelope",
      assessment: walkOnlyAssessment,
    },
  ].map(({ id, expectedViolation, assessment }) => ({
    id,
    expectedViolation,
    detected: assessment.violations.some(
      ({ code }) => code === expectedViolation,
    ),
    violations: assessment.violations.map(({ code }) => code),
  }));
  const actualViolationCodes = reviewAssessment.violations.map(
    ({ code }) => code,
  );
  const expectedRejection =
    !reviewAssessment.pass &&
    search.passingCandidates === 0 &&
    experiment.expectedViolationCodes.every((code) =>
      actualViolationCodes.includes(code),
    );
  const controlsPass = controls.every(({ detected }) => detected);
  const deterministicRepeatSha256Match = selectedDigest === repeatedDigest;
  await fs.mkdir(options.output, { recursive: true });
  await Promise.all([
    contactSheet(
      [
        { label: "Current production atlas", frames: current },
        {
          label: `Uniform diagnostic · X ${experiment.reviewTransform.scaleX} · Y ${experiment.reviewTransform.scaleY}`,
          frames: selected.frames,
        },
      ],
      path.join(options.output, "before-after-contact-sheet.png"),
    ),
    maskOverlay(
      current,
      selected.frames,
      path.join(options.output, "mask-overlay.png"),
    ),
  ]);
  const report = {
    schemaVersion: 1,
    contract: "CinderwakeActorPresentationAssessmentV1",
    status: expectedRejection ? "rejected" : "unexpected",
    method: experiment.method,
    recommendation: experiment.recommendation,
    sources: {
      atlas: { file: experiment.sources.atlas.file, sha256: atlas.sha256 },
      primary: {
        file: experiment.sources.primary.file,
        sha256: primary.sha256,
      },
    },
    legacyWalkTransformRemovedForCanonicalComparison:
      experiment.legacyWalkTransform,
    reviewTransform: experiment.reviewTransform,
    search,
    reviewAssessment,
    clearedChecks: {
      safeInkBounds: !actualViolationCodes.includes("safe-ink-bounds"),
      footAnchor: !actualViolationCodes.includes("foot-anchor-drift"),
      recoveryTerminalEquality: !actualViolationCodes.includes(
        "clip-to-idle-frame-mismatch",
      ),
      actionContinuity: !actualViolationCodes.some(
        (code) => code.startsWith("attack-") || code.startsWith("ability-"),
      ),
    },
    deterministicRepeatSha256Match,
    negativeControls: controls,
    artifacts: ["before-after-contact-sheet.png", "mask-overlay.png"],
  };
  await Promise.all([
    fs.writeFile(
      path.join(options.output, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    fs.writeFile(path.join(options.output, "index.html"), htmlReport(report)),
  ]);
  if (!expectedRejection || !controlsPass || !deterministicRepeatSha256Match)
    throw new Error(
      `Presentation experiment contract failed: expected-rejection=${expectedRejection}, controls=${controlsPass}, deterministic=${deterministicRepeatSha256Match}`,
    );
  console.log(
    `Ashfang uniform transform rejected reproducibly: ${search.candidatesChecked} envelopes searched, 0 passed, ${controls.length}/${controls.length} bad transforms caught. No production asset changed.`,
  );
}

await run();
