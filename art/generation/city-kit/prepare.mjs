#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(DIRECTORY, "raw/embercross-city-kit-v1.png");
const DEFAULT_OUTPUT = path.join(
  DIRECTORY,
  "prepared/embercross-city-kit-v1.png",
);
const DEFAULT_REPORT = path.join(DIRECTORY, "evidence/preparation.json");
const COLUMNS = 3;
const ROWS = 2;
const CELL = 512;
const SAFE_INSET = 62;
const BASELINE = 446;
const ALPHA_THRESHOLD = 24;
const CELL_IDS = [
  "market-stall",
  "tavern",
  "infirmary",
  "city-gate",
  "road-sign",
  "bed-food-service",
];

function parseArguments(arguments_) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || !["--input", "--output", "--report"].includes(name)) {
      throw new Error(
        "Usage: node prepare.mjs [--input raw.png] [--output prepared.png] [--report preparation.json]",
      );
    }
    options[name.slice(2)] = path.resolve(process.cwd(), value);
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

function keyAndDecontaminate(rgb) {
  const rgba = Buffer.alloc((rgb.length / 3) * 4);
  for (let pixel = 0; pixel < rgb.length / 3; pixel += 1) {
    const input = pixel * 3;
    const output = pixel * 4;
    const red = rgb[input];
    const green = rgb[input + 1];
    const blue = rgb[input + 2];
    const alpha = keyedAlpha(red, green, blue);
    if (alpha < ALPHA_THRESHOLD) continue;
    const spill = Math.max(0, Math.min(red, blue) - green - 14);
    rgba[output] = Math.max(0, Math.round(red - spill * 0.88));
    rgba[output + 1] = green;
    rgba[output + 2] = Math.max(0, Math.round(blue - spill * 0.88));
    rgba[output + 3] = alpha;
  }
  return rgba;
}

function cleanResizedRgba(rgba) {
  const result = Buffer.from(rgba);
  for (let offset = 0; offset < result.length; offset += 4) {
    if (result[offset + 3] < ALPHA_THRESHOLD) {
      result.fill(0, offset, offset + 4);
      continue;
    }
    const spill = Math.max(
      0,
      Math.min(result[offset], result[offset + 2]) - result[offset + 1] - 14,
    );
    result[offset] = Math.max(0, Math.round(result[offset] - spill * 0.88));
    result[offset + 2] = Math.max(
      0,
      Math.round(result[offset + 2] - spill * 0.88),
    );
  }
  return result;
}

function alphaBounds(data, width, left, top) {
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const alpha = data[((top + y) * width + left + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error(`Blank city cell at ${left},${top}`);
  return { minX, minY, maxX, maxY, pixels };
}

function connectedComponents(data, width, left, top) {
  const mask = new Uint8Array(CELL * CELL);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const alpha = data[((top + y) * width + left + x) * 4 + 3];
      if (alpha >= ALPHA_THRESHOLD) mask[y * CELL + x] = 1;
    }
  }
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let area = 0;
    let minX = CELL;
    let minY = CELL;
    let maxX = -1;
    let maxY = -1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      const x = pixel % CELL;
      const y = Math.floor(pixel / CELL);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const neighbor of [
        pixel - 1,
        pixel + 1,
        pixel - CELL,
        pixel + CELL,
      ]) {
        if (
          neighbor < 0 ||
          neighbor >= mask.length ||
          seen[neighbor] ||
          !mask[neighbor]
        )
          continue;
        const neighborX = neighbor % CELL;
        const neighborY = Math.floor(neighbor / CELL);
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ area, minX, minY, maxX, maxY });
  }
  return components.sort(
    (leftComponent, rightComponent) => rightComponent.area - leftComponent.area,
  );
}

function boxDistance(first, second) {
  const horizontal = Math.max(
    first.minX - second.maxX - 1,
    second.minX - first.maxX - 1,
    0,
  );
  const vertical = Math.max(
    first.minY - second.maxY - 1,
    second.minY - first.maxY - 1,
    0,
  );
  return Math.hypot(horizontal, vertical);
}

function union(target, source) {
  target.minX = Math.min(target.minX, source.minX);
  target.minY = Math.min(target.minY, source.minY);
  target.maxX = Math.max(target.maxX, source.maxX);
  target.maxY = Math.max(target.maxY, source.maxY);
  target.pixels += source.area;
}

function recoverCellSubject(data, width, left, top) {
  const components = connectedComponents(data, width, left, top);
  if (components.length === 0 || components[0].area < 500) {
    throw new Error(`No primary subject found at ${left},${top}`);
  }
  const primary = components[0];
  const recovered = {
    minX: primary.minX,
    minY: primary.minY,
    maxX: primary.maxX,
    maxY: primary.maxY,
    pixels: primary.area,
  };
  const attached = [primary];
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of components) {
      if (attached.includes(component) || component.area < 16) continue;
      if (boxDistance(recovered, component) > 28) continue;
      attached.push(component);
      union(recovered, component);
      changed = true;
    }
  }
  return {
    bounds: recovered,
    primaryArea: primary.area,
    retainedComponents: attached.length,
    excludedComponents: components.length - attached.length,
    excludedPixels: components
      .filter((component) => !attached.includes(component))
      .reduce((total, component) => total + component.area, 0),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputBytes = await fs.readFile(options.input);
  const { data: rgb, info } = await sharp(inputBytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== COLUMNS * CELL || info.height !== ROWS * CELL) {
    throw new Error(
      `City-kit raw source must be 1536x1024; received ${info.width}x${info.height}`,
    );
  }

  const keyed = keyAndDecontaminate(rgb);
  const composites = [];
  const cells = [];
  const maximumWidth = CELL - SAFE_INSET * 2;
  const maximumHeight = BASELINE - SAFE_INSET + 1;

  for (let index = 0; index < CELL_IDS.length; index += 1) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const cellLeft = column * CELL;
    const cellTop = row * CELL;
    const allInkBounds = alphaBounds(keyed, info.width, cellLeft, cellTop);
    const recovery = recoverCellSubject(keyed, info.width, cellLeft, cellTop);
    const bounds = recovery.bounds;
    const sourceLeft = bounds.minX;
    const sourceTop = bounds.minY;
    const sourceRight = bounds.maxX;
    const sourceBottom = bounds.maxY;
    const sourceWidth = sourceRight - sourceLeft + 1;
    const sourceHeight = sourceBottom - sourceTop + 1;
    const scale = Math.min(
      maximumWidth / sourceWidth,
      maximumHeight / sourceHeight,
      1,
    );
    const destinationWidth = Math.max(1, Math.round(sourceWidth * scale));
    const destinationHeight = Math.max(1, Math.round(sourceHeight * scale));
    const resized = await sharp(keyed, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extract({
        left: cellLeft + sourceLeft,
        top: cellTop + sourceTop,
        width: sourceWidth,
        height: sourceHeight,
      })
      .resize(destinationWidth, destinationHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      })
      .raw()
      .toBuffer();
    const cleaned = cleanResizedRgba(resized);
    const cut = await sharp(cleaned, {
      raw: {
        width: destinationWidth,
        height: destinationHeight,
        channels: 4,
      },
    })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const destinationLeft = Math.round((CELL - destinationWidth) / 2);
    const destinationTop = BASELINE - destinationHeight + 1;
    composites.push({
      input: cut,
      left: cellLeft + destinationLeft,
      top: cellTop + destinationTop,
    });
    cells.push({
      index,
      id: CELL_IDS[index],
      sourceInkBounds: bounds,
      rawCell: {
        allInkBounds,
        touchesCellEdge:
          allInkBounds.minX === 0 ||
          allInkBounds.minY === 0 ||
          allInkBounds.maxX === CELL - 1 ||
          allInkBounds.maxY === CELL - 1,
        ...recovery,
      },
      sourceCrop: {
        left: sourceLeft,
        top: sourceTop,
        width: sourceWidth,
        height: sourceHeight,
      },
      uniformScale: scale,
      destination: {
        left: destinationLeft,
        top: destinationTop,
        width: destinationWidth,
        height: destinationHeight,
      },
      aspectScaleDelta: Math.abs(
        destinationWidth / sourceWidth - destinationHeight / sourceHeight,
      ),
      upscaled: scale > 1,
    });
  }

  const preparedBytes = await sharp({
    create: {
      width: COLUMNS * CELL,
      height: ROWS * CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();

  const report = {
    schemaVersion: 1,
    operation:
      "fixed semantic cell order; tolerant chroma key; magenta decontamination; per-cell crop; one aspect-preserving no-upscale fit; horizontal centering; common bottom baseline",
    constants: {
      columns: COLUMNS,
      rows: ROWS,
      cell: CELL,
      safeInset: SAFE_INSET,
      baseline: BASELINE,
      alphaThreshold: ALPHA_THRESHOLD,
    },
    input: {
      sha256: sha256(inputBytes),
      width: info.width,
      height: info.height,
    },
    output: {
      sha256: sha256(preparedBytes),
      width: COLUMNS * CELL,
      height: ROWS * CELL,
    },
    cells,
  };
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.mkdir(path.dirname(options.report), { recursive: true });
  await fs.writeFile(options.output, preparedBytes);
  await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${path.relative(process.cwd(), options.output)} ${report.output.sha256}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
