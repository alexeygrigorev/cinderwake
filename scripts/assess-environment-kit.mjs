#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { format } from "prettier";
import sharp from "sharp";

const execute = promisify(execFile);
const ROOT = process.cwd();
const CELL = 512;
const COLUMNS = 3;
const ROWS = 2;
const DEFAULT_SAFE_MARGIN = 24;
const DEFAULT_EXPECTED_BASELINE = 480;
const ALPHA_THRESHOLD = 24;

function parseArgs(argv) {
  const options = {
    record: path.join(ROOT, "art/generation/environment-kit-v1.json"),
    output: path.join(
      ROOT,
      "art/generation/environment-kit/evidence/environment-kit-v1",
    ),
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--record" && name !== "--output") || !value) {
      throw new Error(
        "Usage: node scripts/assess-environment-kit.mjs [--record <json>] [--output <directory>]",
      );
    }
    options[name.slice(2)] = path.resolve(ROOT, value);
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function keyedAlpha(red, green, blue) {
  const dominance = Math.min(red, blue) - green;
  const balance = Math.abs(red - blue);
  if (dominance >= 28 && balance <= 110) return 0;
  if (dominance > 12 && balance < 130) {
    return Math.max(0, Math.round(((28 - dominance) / 16) * 255));
  }
  const distance = Math.hypot(255 - red, green, 255 - blue);
  if (distance <= 24) return 0;
  if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
  return 255;
}

function connectedComponents(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const neighbor of [
        pixel - 1,
        pixel + 1,
        pixel - width,
        pixel + width,
      ]) {
        if (
          neighbor < 0 ||
          neighbor >= mask.length ||
          seen[neighbor] ||
          !mask[neighbor]
        ) {
          continue;
        }
        const neighborX = neighbor % width;
        const neighborY = Math.floor(neighbor / width);
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({
      area,
      minX,
      minY,
      maxX,
      maxY,
      centroidX: sumX / area,
      centroidY: sumY / area,
    });
  }
  return components;
}

function boxGap(first, second) {
  const dx = Math.max(
    first.minX - second.maxX - 1,
    second.minX - first.maxX - 1,
    0,
  );
  const dy = Math.max(
    first.minY - second.maxY - 1,
    second.minY - first.maxY - 1,
    0,
  );
  return Math.hypot(dx, dy);
}

function analyzeRaw(data, info, grid) {
  const pixels = info.width * info.height;
  const mask = new Uint8Array(pixels);
  let literalKeyPixels = 0;
  let keyablePixels = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const red = data[pixel * 3];
    const green = data[pixel * 3 + 1];
    const blue = data[pixel * 3 + 2];
    if (red === 255 && green === 0 && blue === 255) literalKeyPixels += 1;
    const alpha = keyedAlpha(red, green, blue);
    if (alpha < ALPHA_THRESHOLD) keyablePixels += 1;
    else mask[pixel] = 1;
  }
  const components = connectedComponents(mask, info.width, info.height);
  const primary = components
    .filter(({ area }) => area >= 10_000)
    .sort((left, right) => left.centroidY - right.centroidY);
  const ordered = [
    ...primary
      .slice(0, 3)
      .sort((left, right) => left.centroidX - right.centroidX),
    ...primary.slice(3).sort((left, right) => left.centroidX - right.centroidX),
  ];
  const requiredInsetX =
    grid.rawSafeInset ?? Math.floor((info.width / COLUMNS) * 0.12);
  const requiredInsetY =
    grid.rawSafeInset ?? Math.floor((info.height / ROWS) * 0.12);
  const cellCompliance = ordered.map((component, index) => {
    const left = (index % COLUMNS) * (info.width / COLUMNS);
    const top = Math.floor(index / COLUMNS) * (info.height / ROWS);
    const right = left + info.width / COLUMNS - 1;
    const bottom = top + info.height / ROWS - 1;
    const margins = {
      left: component.minX - left,
      top: component.minY - top,
      right: right - component.maxX,
      bottom: bottom - component.maxY,
    };
    return {
      index,
      bounds: [component.minX, component.minY, component.maxX, component.maxY],
      margins,
      requiredMargins: { x: requiredInsetX, y: requiredInsetY },
      pass:
        margins.left >= requiredInsetX &&
        margins.right >= requiredInsetX &&
        margins.top >= requiredInsetY &&
        margins.bottom >= requiredInsetY,
    };
  });
  let minimumGap = Number.POSITIVE_INFINITY;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      minimumGap = Math.min(minimumGap, boxGap(ordered[left], ordered[right]));
    }
  }
  const checks = [
    {
      id: "dimensions-3-to-2",
      pass: info.width === 1536 && info.height === 1024,
      value: `${info.width}x${info.height}`,
    },
    {
      id: "six-primary-components",
      pass: ordered.length === 6,
      value: ordered.length,
    },
    {
      id: "literal-chroma-background",
      pass: literalKeyPixels / pixels >= 0.45,
      value: literalKeyPixels / pixels,
    },
    {
      id: "deterministically-keyable-background",
      pass: keyablePixels / pixels >= 0.45,
      value: keyablePixels / pixels,
    },
    {
      id: "separated-component-boxes",
      pass: minimumGap >= 24,
      value: minimumGap,
    },
    {
      id: grid.rawSafeInset
        ? "declared-cell-padding"
        : "declared-12-percent-cell-padding",
      pass:
        cellCompliance.length === 6 && cellCompliance.every(({ pass }) => pass),
      value: cellCompliance.filter(({ pass }) => pass).length,
    },
  ];
  return {
    pass: checks.every(({ pass }) => pass),
    checks,
    literalKeyRatio: literalKeyPixels / pixels,
    keyableRatio: keyablePixels / pixels,
    minimumPrimaryGap: minimumGap,
    primaryComponents: ordered,
    cellCompliance,
  };
}

function cellBounds(data, width, index) {
  const offsetX = (index % COLUMNS) * CELL;
  const offsetY = Math.floor(index / COLUMNS) * CELL;
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const alpha = data[((offsetY + y) * width + offsetX + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, area };
}

function supportEvidence(data, width, index, bounds) {
  const offsetX = (index % COLUMNS) * CELL;
  const offsetY = Math.floor(index / COLUMNS) * CELL;
  const height = bounds.maxY - bounds.minY + 1;
  const band = Math.max(3, Math.ceil(height * 0.05));
  let minX = CELL;
  let maxX = -1;
  let pixels = 0;
  for (let y = bounds.maxY - band + 1; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const alpha = data[((offsetY + y) * width + offsetX + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      pixels += 1;
    }
  }
  const widthPixels = Math.max(0, maxX - minX + 1);
  return {
    band,
    minX,
    maxX,
    pixels,
    width: widthPixels,
    widthRatio: widthPixels / (bounds.maxX - bounds.minX + 1),
  };
}

function doorwayAperture(data, width, bounds) {
  const samples = [];
  const startY = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.48);
  const endY = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.72);
  const centerStart = Math.round(
    bounds.minX + (bounds.maxX - bounds.minX) * 0.25,
  );
  const centerEnd = Math.round(
    bounds.minX + (bounds.maxX - bounds.minX) * 0.75,
  );
  for (let y = startY; y <= endY; y += 1) {
    let current = 0;
    let widest = 0;
    for (let x = centerStart; x <= centerEnd; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) {
        current += 1;
        widest = Math.max(widest, current);
      } else current = 0;
    }
    samples.push(widest);
  }
  const sorted = samples.sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    medianTransparentWidth: median,
    widthRatio: median / (bounds.maxX - bounds.minX + 1),
  };
}

function relativeDelta(first, second) {
  return Math.abs(first - second) / ((first + second) / 2);
}

function analyzePrepared(data, info, cells, grid, policy = {}) {
  const violations = [];
  const safeMargin = grid.safeInset ?? DEFAULT_SAFE_MARGIN;
  const expectedBaseline = grid.footBaseline ?? DEFAULT_EXPECTED_BASELINE;
  const baselineTolerance = policy.footBaselineTolerance ?? 2;
  const maximumOpaqueRatio = policy.maximumPreparedOpaqueRatio ?? 0.55;
  const spillDominance = policy.spillDominance ?? 20;
  const maximumSpillRatio = policy.maximumPreparedSpillRatio ?? 0.00015;
  if (
    info.width !== CELL * COLUMNS ||
    info.height !== CELL * ROWS ||
    info.channels !== 4
  ) {
    violations.push("prepared-dimensions");
  }
  let opaquePixels = 0;
  let transparentPixels = 0;
  let contaminatedTransparentPixels = 0;
  let weightedSpillPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (alpha < ALPHA_THRESHOLD) {
      transparentPixels += 1;
      if (red !== 0 || green !== 0 || blue !== 0)
        contaminatedTransparentPixels += 1;
      continue;
    }
    opaquePixels += 1;
    if (
      Math.min(red, blue) - green >= spillDominance &&
      Math.abs(red - blue) <= 130
    ) {
      weightedSpillPixels += alpha / 255;
    }
  }
  const pixels = info.width * info.height;
  const opaqueRatio = opaquePixels / pixels;
  const transparentRatio = transparentPixels / pixels;
  const transparentRgbContaminationRatio =
    transparentPixels === 0
      ? 1
      : contaminatedTransparentPixels / transparentPixels;
  const spillRatio =
    opaquePixels === 0 ? 1 : weightedSpillPixels / opaquePixels;
  if (opaqueRatio > maximumOpaqueRatio) violations.push("opaque-matte");
  if (transparentRatio < 1 - maximumOpaqueRatio)
    violations.push("transparent-matte-coverage");
  if (transparentRgbContaminationRatio > 0)
    violations.push("transparent-rgb-spill");
  if (spillRatio > maximumSpillRatio) violations.push("prepared-magenta-spill");

  const cellEvidence = cells.map((cell, index) => {
    const cellViolations = [];
    const bounds = cellBounds(data, info.width, index);
    if (bounds.maxX < bounds.minX) {
      const violation = `cell-${index}-blank`;
      violations.push(violation);
      return {
        ...cell,
        bounds,
        violations: [violation],
        preparedIntegrationSafe: false,
        pass: false,
      };
    }
    const width = bounds.maxX - bounds.minX + 1;
    const height = bounds.maxY - bounds.minY + 1;
    const margins = {
      left: bounds.minX,
      top: bounds.minY,
      right: CELL - 1 - bounds.maxX,
      bottom: CELL - 1 - bounds.maxY,
    };
    if (Math.min(...Object.values(margins)) < safeMargin) {
      cellViolations.push(`cell-${index}-unsafe-border`);
    }
    if (Math.abs(bounds.maxY - expectedBaseline) > baselineTolerance) {
      cellViolations.push(`cell-${index}-foot-anchor-drift`);
    }
    const support = supportEvidence(data, info.width, index, bounds);
    if (support.widthRatio < 0.12 || support.widthRatio > 0.88) {
      cellViolations.push(`cell-${index}-collision-footprint`);
    }
    const runtimeScale = cell.runtimeHeight / height;
    const runtime = {
      width: Number((width * runtimeScale).toFixed(2)),
      height: cell.runtimeHeight,
      silhouetteArea: Math.round(bounds.area * runtimeScale * runtimeScale),
      supportWidth: Number((support.width * runtimeScale).toFixed(2)),
      suggestedCollisionHalfWidth: Number(
        Math.max(
          5,
          Math.min(
            width * runtimeScale * 0.36,
            support.width * runtimeScale * 0.44,
          ),
        ).toFixed(2),
      ),
    };
    if (
      runtime.width < 20 ||
      runtime.silhouetteArea < 350 ||
      runtime.supportWidth < 7
    ) {
      cellViolations.push(`cell-${index}-runtime-silhouette`);
    }
    violations.push(...cellViolations);
    return {
      ...cell,
      bounds,
      margins,
      support,
      runtime,
      violations: cellViolations,
      preparedIntegrationSafe: false,
      pass: cellViolations.length === 0,
    };
  });

  const wallCell = cellEvidence[0];
  let wall;
  if (wallCell?.bounds?.maxX >= wallCell?.bounds?.minX) {
    const aperture = doorwayAperture(data, info.width, wallCell.bounds);
    const topology = policy.wall?.topology ?? "doorway";
    const maximumCentralGapRatio = policy.wall?.maximumCentralGapRatio ?? 0.08;
    const minimumCentralGapRatio = policy.wall?.minimumCentralGapRatio ?? 0.16;
    const minimumSupportWidthRatio =
      policy.wall?.minimumSupportWidthRatio ?? 0.12;
    const topologyPass =
      topology === "solid"
        ? aperture.widthRatio <= maximumCentralGapRatio &&
          wallCell.support.widthRatio >= minimumSupportWidthRatio
        : aperture.widthRatio >= minimumCentralGapRatio;
    const violation =
      topology === "solid"
        ? "cell-0-solid-wall-continuity"
        : "cell-0-doorway-aperture";
    if (!topologyPass) {
      violations.push(violation);
      wallCell.violations.push(violation);
      wallCell.pass = false;
    }
    wall = {
      topology,
      pass: topologyPass,
      aperture,
      supportWidthRatio: wallCell.support.widthRatio,
      thresholds:
        topology === "solid"
          ? { maximumCentralGapRatio, minimumSupportWidthRatio }
          : { minimumCentralGapRatio },
    };
    wallCell.wall = wall;
  }

  let lanternPair;
  if (policy.lanternPair) {
    const [firstIndex, secondIndex] = policy.lanternPair.indices;
    const first = cellEvidence[firstIndex];
    const second = cellEvidence[secondIndex];
    const heightDeltaRatio = relativeDelta(
      first.bounds.maxY - first.bounds.minY + 1,
      second.bounds.maxY - second.bounds.minY + 1,
    );
    const widthDeltaRatio = relativeDelta(
      first.bounds.maxX - first.bounds.minX + 1,
      second.bounds.maxX - second.bounds.minX + 1,
    );
    const supportDeltaRatio = relativeDelta(
      first.support.width,
      second.support.width,
    );
    const pass =
      heightDeltaRatio <= policy.lanternPair.maximumHeightDeltaRatio &&
      widthDeltaRatio <= policy.lanternPair.maximumWidthDeltaRatio &&
      supportDeltaRatio <= policy.lanternPair.maximumSupportDeltaRatio;
    lanternPair = {
      indices: policy.lanternPair.indices,
      pass,
      heightDeltaRatio,
      widthDeltaRatio,
      supportDeltaRatio,
      thresholds: {
        maximumHeightDeltaRatio: policy.lanternPair.maximumHeightDeltaRatio,
        maximumWidthDeltaRatio: policy.lanternPair.maximumWidthDeltaRatio,
        maximumSupportDeltaRatio: policy.lanternPair.maximumSupportDeltaRatio,
      },
    };
    if (!pass) {
      const violation = "shared-lantern-scale";
      violations.push(violation);
      for (const cell of [first, second]) {
        cell.violations.push(violation);
        cell.pass = false;
      }
    }
  }

  const bottomContacts = {
    expectedBaseline,
    tolerance: baselineTolerance,
    values: cellEvidence.map(({ bounds }) => bounds.maxY),
  };
  bottomContacts.maximumDelta = Math.max(
    ...bottomContacts.values.map((value) =>
      Math.abs(value - bottomContacts.expectedBaseline),
    ),
  );
  bottomContacts.pass = bottomContacts.maximumDelta <= bottomContacts.tolerance;

  return {
    pass: violations.length === 0,
    violations: [...new Set(violations)],
    matte: {
      pass:
        opaqueRatio <= maximumOpaqueRatio &&
        transparentRatio >= 1 - maximumOpaqueRatio &&
        transparentRgbContaminationRatio === 0,
      opaqueRatio,
      transparentRatio,
      transparentRgbContaminationRatio,
      maximumOpaqueRatio,
    },
    spill: {
      pass: spillRatio <= maximumSpillRatio,
      ratio: spillRatio,
      maximumRatio: maximumSpillRatio,
      dominance: spillDominance,
    },
    opaqueRatio,
    commonBottomContacts: bottomContacts,
    wall,
    lanternPair,
    cells: cellEvidence,
  };
}

function mutatePrepared(source, id, grid) {
  const data = Buffer.from(source);
  const width = CELL * COLUMNS;
  const expectedBaseline = grid.footBaseline ?? DEFAULT_EXPECTED_BASELINE;
  if (id === "opaque-gray-matte") {
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] >= ALPHA_THRESHOLD) continue;
      data[offset] = 52;
      data[offset + 1] = 48;
      data[offset + 2] = 50;
      data[offset + 3] = 255;
    }
  } else if (id === "cell-border-bleed") {
    for (let x = 0; x < CELL; x += 1) {
      const offset = (8 * width + x) * 4;
      data[offset] = 180;
      data[offset + 1] = 90;
      data[offset + 2] = 30;
      data[offset + 3] = 255;
    }
  } else if (id === "cross-cell-bridge") {
    for (let x = CELL - 10; x <= CELL + 10; x += 1) {
      const offset = (300 * width + x) * 4;
      data[offset] = 130;
      data[offset + 1] = 80;
      data[offset + 2] = 40;
      data[offset + 3] = 255;
    }
  } else if (id === "floating-foot-anchor") {
    const original = Buffer.from(data);
    const cellIndex = 3;
    const offsetX = (cellIndex % COLUMNS) * CELL;
    const offsetY = Math.floor(cellIndex / COLUMNS) * CELL;
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        data.fill(
          0,
          ((offsetY + y) * width + offsetX + x) * 4,
          ((offsetY + y) * width + offsetX + x) * 4 + 4,
        );
      }
    }
    for (let y = 20; y < CELL; y += 1) {
      const sourceStart = ((offsetY + y) * width + offsetX) * 4;
      const targetStart = ((offsetY + y - 20) * width + offsetX) * 4;
      original.copy(data, targetStart, sourceStart, sourceStart + CELL * 4);
    }
  } else if (id === "needle-contact-footprint") {
    const cellIndex = 4;
    const offsetX = (cellIndex % COLUMNS) * CELL;
    const offsetY = Math.floor(cellIndex / COLUMNS) * CELL;
    for (let y = expectedBaseline - 24; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        const offset = ((offsetY + y) * width + offsetX + x) * 4;
        data.fill(0, offset, offset + 4);
      }
    }
    for (let y = expectedBaseline - 24; y <= expectedBaseline; y += 1) {
      const offset = ((offsetY + y) * width + offsetX + 256) * 4;
      data[offset] = 80;
      data[offset + 1] = 60;
      data[offset + 2] = 40;
      data[offset + 3] = 255;
    }
  } else if (id === "lantern-scale-mismatch") {
    const original = Buffer.from(data);
    const cellIndex = 3;
    const offsetX = (cellIndex % COLUMNS) * CELL;
    const offsetY = Math.floor(cellIndex / COLUMNS) * CELL;
    const bounds = cellBounds(original, width, cellIndex);
    const scale = 0.72;
    const sourceWidth = bounds.maxX - bounds.minX + 1;
    const sourceHeight = bounds.maxY - bounds.minY + 1;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const targetLeft = Math.round((CELL - targetWidth) / 2);
    const targetTop = bounds.maxY - targetHeight + 1;
    for (let y = 0; y < CELL; y += 1) {
      const start = ((offsetY + y) * width + offsetX) * 4;
      data.fill(0, start, start + CELL * 4);
    }
    for (let y = 0; y < targetHeight; y += 1) {
      for (let x = 0; x < targetWidth; x += 1) {
        const sourceX =
          bounds.minX + Math.min(sourceWidth - 1, Math.floor(x / scale));
        const sourceY =
          bounds.minY + Math.min(sourceHeight - 1, Math.floor(y / scale));
        const sourceOffset =
          ((offsetY + sourceY) * width + offsetX + sourceX) * 4;
        const targetOffset =
          ((offsetY + targetTop + y) * width + offsetX + targetLeft + x) * 4;
        original.copy(data, targetOffset, sourceOffset, sourceOffset + 4);
      }
    }
  } else if (id === "solid-wall-center-gap") {
    const bounds = cellBounds(data, width, 0);
    const startX = Math.round(bounds.minX + (bounds.maxX - bounds.minX) * 0.4);
    const endX = Math.round(bounds.minX + (bounds.maxX - bounds.minX) * 0.6);
    const startY = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.48);
    const endY = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.72);
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      }
    }
  } else if (id === "magenta-edge-spill") {
    let painted = 0;
    for (let offset = 0; offset < data.length && painted < 3000; offset += 4) {
      if (data[offset + 3] < ALPHA_THRESHOLD) continue;
      data[offset] = 230;
      data[offset + 1] = 10;
      data[offset + 2] = 230;
      painted += 1;
    }
  }
  return data;
}

async function cellPng(preparedData, preparedInfo, index) {
  return sharp(preparedData, { raw: preparedInfo })
    .extract({
      left: (index % COLUMNS) * CELL,
      top: Math.floor(index / COLUMNS) * CELL,
      width: CELL,
      height: CELL,
    })
    .png()
    .toBuffer();
}

async function writeEvidence(
  output,
  preparedData,
  preparedInfo,
  assessment,
  controls,
  grid,
) {
  await fs.mkdir(output, { recursive: true });
  const floor = await sharp(
    path.join(ROOT, "public/assets/sprites/environment-floor.png"),
  )
    .resize(960, 420, { fit: "cover" })
    .modulate({ brightness: 0.58, saturation: 0.58 })
    .ensureAlpha()
    .png()
    .toBuffer();
  const runtimeComposites = [];
  for (let index = 0; index < assessment.cells.length; index += 1) {
    const evidence = assessment.cells[index];
    const cell = await cellPng(preparedData, preparedInfo, index);
    const cut = await sharp(cell)
      .extract({
        left: evidence.bounds.minX,
        top: evidence.bounds.minY,
        width: evidence.bounds.maxX - evidence.bounds.minX + 1,
        height: evidence.bounds.maxY - evidence.bounds.minY + 1,
      })
      .resize({
        height: evidence.runtime.height,
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
    const metadata = await sharp(cut).metadata();
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const centerX = column * 320 + 160;
    const baseline = row === 0 ? 196 : 398;
    runtimeComposites.push({
      input: cut,
      left: Math.round(centerX - metadata.width / 2),
      top: baseline - metadata.height,
    });
  }
  await sharp(floor)
    .composite(runtimeComposites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(output, "runtime-scale-contact-sheet.png"));

  await sharp(preparedData, { raw: preparedInfo })
    .resize(768, 512, { kernel: sharp.kernel.lanczos3 })
    .flatten({ background: "#151116" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(output, "prepared-cuts-contact-sheet.png"));

  const mutationComposites = [];
  for (let index = 0; index < controls.length; index += 1) {
    const mutation = mutatePrepared(preparedData, controls[index].id, grid);
    const image = await sharp(mutation, { raw: preparedInfo })
      .resize(384, 256)
      .flatten({ background: "#151116" })
      .png()
      .toBuffer();
    mutationComposites.push({
      input: image,
      left: (index % 2) * 384,
      top: Math.floor(index / 2) * 256,
    });
  }
  await sharp({
    create: {
      width: 768,
      height: Math.ceil(controls.length / 2) * 256,
      channels: 3,
      background: "#151116",
    },
  })
    .composite(mutationComposites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(output, "negative-controls-contact-sheet.png"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const record = JSON.parse(await fs.readFile(options.record, "utf8"));
  const rawPath = path.join(ROOT, record.generation.raw.file);
  const preparedPath = path.join(ROOT, record.preparation.file);
  const [rawBytes, preparedBytes] = await Promise.all([
    fs.readFile(rawPath),
    fs.readFile(preparedPath),
  ]);
  if (sha256(rawBytes) !== record.generation.raw.sha256)
    throw new Error("Raw hash is stale");
  if (sha256(preparedBytes) !== record.preparation.sha256) {
    throw new Error("Prepared hash is stale");
  }
  for (const source of [
    record.generation.prompt,
    ...record.generation.references,
  ]) {
    const bytes = await fs.readFile(path.join(ROOT, source.file));
    if (sha256(bytes) !== source.sha256)
      throw new Error(`${source.file} hash is stale`);
  }

  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-environment-kit-"),
  );
  const first = path.join(temp, "first.png");
  const second = path.join(temp, "second.png");
  try {
    for (const output of [first, second]) {
      const preparationArgs = [
        path.join(ROOT, "scripts/prepare-environment-kit.mjs"),
        "--input",
        rawPath,
        "--output",
        output,
      ];
      if (record.preparation.options?.safeInset !== undefined) {
        preparationArgs.push(
          "--safe-inset",
          String(record.preparation.options.safeInset),
        );
      }
      if (record.preparation.options?.postKeyCleanup !== undefined) {
        preparationArgs.push(
          "--post-key-cleanup",
          String(record.preparation.options.postKeyCleanup),
        );
      }
      await execute(process.execPath, preparationArgs);
    }
    const [firstBytes, secondBytes] = await Promise.all([
      fs.readFile(first),
      fs.readFile(second),
    ]);
    if (
      sha256(firstBytes) !== sha256(secondBytes) ||
      sha256(firstBytes) !== record.preparation.sha256
    ) {
      throw new Error(
        "Preparation is not byte-identical to the recorded artifact",
      );
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }

  const raw = await sharp(rawBytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const prepared = await sharp(preparedBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const policy = record.auditPolicy ?? {};
  const rawAssessment = analyzeRaw(raw.data, raw.info, record.grid);
  const preparedAssessment = analyzePrepared(
    prepared.data,
    prepared.info,
    record.grid.cells,
    record.grid,
    policy,
  );
  const controlDefinitions = [
    { id: "opaque-gray-matte", expectedViolation: "opaque-matte" },
    { id: "cell-border-bleed", expectedViolation: "cell-0-unsafe-border" },
    { id: "cross-cell-bridge", expectedViolation: "cell-0-unsafe-border" },
    {
      id: "floating-foot-anchor",
      expectedViolation: "cell-3-foot-anchor-drift",
    },
    {
      id: "needle-contact-footprint",
      expectedViolation: "cell-4-collision-footprint",
    },
  ];
  if (policy.lanternPair) {
    controlDefinitions.push({
      id: "lantern-scale-mismatch",
      expectedViolation: "shared-lantern-scale",
    });
  }
  if (policy.wall?.topology === "solid") {
    controlDefinitions.push({
      id: "solid-wall-center-gap",
      expectedViolation: "cell-0-solid-wall-continuity",
    });
  }
  if (policy.maximumPreparedSpillRatio !== undefined) {
    controlDefinitions.push({
      id: "magenta-edge-spill",
      expectedViolation: "prepared-magenta-spill",
    });
  }
  const negativeControls = controlDefinitions.map((control) => {
    const mutated = mutatePrepared(prepared.data, control.id, record.grid);
    const assessment = analyzePrepared(
      mutated,
      prepared.info,
      record.grid.cells,
      record.grid,
      policy,
    );
    return {
      ...control,
      detected: assessment.violations.includes(control.expectedViolation),
      violations: assessment.violations,
    };
  });
  const controlsPass = negativeControls.every(({ detected }) => detected);
  const failedRawChecks = rawAssessment.checks
    .filter(({ pass }) => !pass)
    .map(({ id }) => id);
  const remediableRawChecks = new Set(policy.rawRemediableChecks ?? []);
  const remediatedRawWarnings = failedRawChecks.filter((id) =>
    remediableRawChecks.has(id),
  );
  const unremediableRawFailures = failedRawChecks.filter(
    (id) => !remediableRawChecks.has(id),
  );
  const preparedIngressPass =
    unremediableRawFailures.length === 0 &&
    preparedAssessment.pass &&
    controlsPass;
  const expectedEvaluation = preparedIngressPass
    ? "pending-independent-visual-review"
    : "rejected";
  const dispositionMatchesRecord =
    record.review.evaluation === expectedEvaluation &&
    record.review.productionApproved === false;

  const preparedSharedViolations = preparedAssessment.violations.filter(
    (violation) =>
      !preparedAssessment.cells.some((cell) =>
        cell.violations.includes(violation),
      ),
  );
  for (const cell of preparedAssessment.cells) {
    const reasons = [
      ...unremediableRawFailures.map(
        (id) => `unremediable raw contract failure: ${id}`,
      ),
      ...preparedSharedViolations.map((id) => `shared prepared failure: ${id}`),
      ...cell.violations,
      ...(controlsPass ? [] : ["paired negative-control suite failed"]),
    ];
    cell.preparedIntegrationSafe = preparedIngressPass && cell.pass;
    cell.integrationReasons = cell.preparedIntegrationSafe
      ? [
          "deterministic prepared-ingress checks pass; independent visual acceptance is still required",
        ]
      : [...new Set(reasons)];
  }
  const preparedSafeCells = preparedAssessment.cells.filter(
    ({ preparedIntegrationSafe }) => preparedIntegrationSafe,
  ).length;
  const report = {
    schemaVersion: 2,
    id: record.id,
    status: dispositionMatchesRecord
      ? preparedIngressPass
        ? "prepared-ingress-pass-quarantined"
        : "rejected-as-recorded"
      : "audit-failed",
    promotionApproved: false,
    sources: {
      record: path.relative(ROOT, options.record),
      generation: {
        tool: record.generation.tool,
        artifactId: record.generation.artifactId,
        generationDirectoryId: record.generation.generationDirectoryId,
        calls: record.generation.calls,
        prompt: record.generation.prompt,
        references: record.generation.references,
      },
      raw: { file: record.generation.raw.file, sha256: sha256(rawBytes) },
      prepared: {
        file: record.preparation.file,
        sha256: sha256(preparedBytes),
      },
      floorPreview: {
        file: "public/assets/sprites/environment-floor.png",
        sha256: sha256(
          await fs.readFile(
            path.join(ROOT, "public/assets/sprites/environment-floor.png"),
          ),
        ),
      },
    },
    deterministicPreparation: { pass: true, reproductions: 2 },
    rawAssessment,
    strictRawVerdict: rawAssessment.pass ? "PASS" : "REJECT",
    preparedAssessment,
    preparedIngress: {
      pass: preparedIngressPass,
      verdict: preparedIngressPass ? "PASS" : "REJECT",
      policy:
        "Strict raw failures are never hidden. Only declared matte/padding failures may become remediated warnings, and only when preparation is byte-reproducible, every prepared check passes, and every paired negative control is caught.",
      remediatedRawWarnings,
      unremediableRawFailures,
      preparedViolations: preparedAssessment.violations,
    },
    negativeControls,
    visualReview: record.review,
    integration: {
      preparedSafeCells,
      totalCells: record.grid.cells.length,
      cells: preparedAssessment.cells.map(
        ({ index, id, preparedIntegrationSafe, integrationReasons }) => ({
          index,
          id,
          preparedIntegrationSafe,
          productionApproved: false,
          reasons: integrationReasons,
        }),
      ),
      note: preparedIngressPass
        ? "Prepared-safe means eligible for independent visual acceptance only. This audit does not authorize production or runtime promotion."
        : "No cell is prepared-integration-safe while a shared or cell-specific mechanical ingress failure remains.",
    },
  };

  await fs.mkdir(options.output, { recursive: true });
  await writeEvidence(
    options.output,
    prepared.data,
    prepared.info,
    preparedAssessment,
    negativeControls,
    record.grid,
  );
  await fs.writeFile(
    path.join(options.output, "report.json"),
    await format(JSON.stringify(report), { parser: "json" }),
  );
  const cellRows = preparedAssessment.cells
    .map(
      (cell) =>
        `<tr><td>${escapeHtml(cell.id)}</td><td>${cell.bounds.maxX - cell.bounds.minX + 1}×${cell.bounds.maxY - cell.bounds.minY + 1}</td><td>${cell.runtime.width}×${cell.runtime.height}</td><td>${cell.runtime.supportWidth}</td><td class="${cell.pass ? "pass" : "fail"}">${cell.pass ? "PASS" : "FAIL"}</td><td class="${cell.preparedIntegrationSafe ? "pass" : "fail"}">${cell.preparedIntegrationSafe ? "SAFE FOR VISUAL REVIEW" : "REJECT"}</td></tr>`,
    )
    .join("");
  const rawRows = rawAssessment.checks
    .map(
      (check) =>
        `<li class="${check.pass ? "pass" : "fail"}">${check.pass ? "PASS" : "FAIL"}: ${escapeHtml(check.id)} — ${escapeHtml(check.value)}</li>`,
    )
    .join("");
  const controls = negativeControls
    .map(
      (control) =>
        `<li class="${control.detected ? "pass" : "fail"}">${control.detected ? "CAUGHT" : "MISSED"}: ${escapeHtml(control.id)} → ${escapeHtml(control.expectedViolation)}</li>`,
    )
    .join("");
  const reviewNotes = [
    ...(record.review.failures ?? []),
    ...(record.review.warnings ?? []),
  ]
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");
  const rawVerdictClass = rawAssessment.pass ? "pass" : "fail";
  const ingressVerdictClass = preparedIngressPass ? "pass" : "fail";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cinderwake ${escapeHtml(record.id)} audit</title><style>body{max-width:1100px;margin:2rem auto;padding:0 1rem;background:#100d0e;color:#eadfce;font:16px/1.5 system-ui}img{max-width:100%;height:auto;border:1px solid #5e4741}code{color:#efbd70}.pass{color:#9ed8aa}.fail,.reject{color:#ef8d83}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;border:1px solid #5e4741;text-align:left}figure{margin:1.5rem 0}figcaption{color:#bba99d}</style></head><body><h1>${escapeHtml(record.id)}</h1><p><strong class="${rawVerdictClass}">Strict raw contract: ${report.strictRawVerdict}.</strong> <strong class="${ingressVerdictClass}">Deterministic prepared ingress: ${report.preparedIngress.verdict}.</strong> Production promotion remains prohibited; prepared-safe cells require independent visual acceptance.</p><p>Raw <code>${report.sources.raw.sha256}</code><br>Prepared <code>${report.sources.prepared.sha256}</code><br>Built-in artifact <code>${escapeHtml(record.generation.artifactId)}</code></p><h2>Strict raw contract</h2><ul>${rawRows}</ul><p>Only declared chroma/padding failures may be remediated warnings. All other raw failures block ingress.</p><h2>Prepared mechanics and runtime scale</h2><p>Preparation reproduced byte-identically twice. The same assessor checks transparent matte, spill, safe borders, common contacts, collision proxies, runtime silhouettes, the configured wall topology, and matching lantern scale.</p><table><thead><tr><th>Cell</th><th>Prepared ink</th><th>Runtime silhouette</th><th>Runtime support width</th><th>Mechanical</th><th>Prepared integration</th></tr></thead><tbody>${cellRows}</tbody></table><figure><a href="runtime-scale-contact-sheet.png"><img src="runtime-scale-contact-sheet.png" alt="Six candidate components at declared runtime heights on the current floor"></a><figcaption>Runtime-scale silhouettes and contacts on the current game floor.</figcaption></figure><figure><a href="prepared-cuts-contact-sheet.png"><img src="prepared-cuts-contact-sheet.png" alt="Deterministically prepared three by two component cuts"></a><figcaption>Prepared transparent cuts, flattened only for review.</figcaption></figure><h2>Recorded review status</h2><ul>${reviewNotes}</ul><h2>Paired negative controls</h2><ul>${controls}</ul><figure><a href="negative-controls-contact-sheet.png"><img src="negative-controls-contact-sheet.png" alt="Deliberately damaged environment kit atlases"></a><figcaption>${negativeControls.length} mutations evaluated through the same prepared assessor.</figcaption></figure><p>${escapeHtml(record.review.decision)}</p></body></html>`;
  await fs.writeFile(
    path.join(options.output, "index.html"),
    await format(html, { parser: "html" }),
  );

  if (!dispositionMatchesRecord)
    throw new Error("Environment-kit recorded disposition did not reproduce");
  process.stdout.write(
    `${record.id}: strict raw ${report.strictRawVerdict}, prepared ingress ${report.preparedIngress.verdict}; ${preparedAssessment.cells.filter(({ pass }) => pass).length}/${record.grid.cells.length} cells mechanically pass, ${negativeControls.filter(({ detected }) => detected).length}/${negativeControls.length} bad controls caught, ${preparedSafeCells}/${record.grid.cells.length} cells prepared-integration-safe, production promotion disabled.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
