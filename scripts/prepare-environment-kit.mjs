#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const GRID_COLUMNS = 3;
const GRID_ROWS = 2;
const CELL_SIZE = 512;
const SAFE_INSET = 28;
const MIN_PRIMARY_AREA = 10_000;
const ATTACHMENT_AREA = 16;
const ATTACHMENT_DISTANCE = 42;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(
        "Usage: node scripts/prepare-environment-kit.mjs --input <raw.png> --output <prepared.png>",
      );
    }
    options[name.slice(2)] = value;
  }
  if (!options.input || !options.output) {
    throw new Error("Both --input and --output are required");
  }
  return options;
}

function keyedAlpha(red, green, blue) {
  const magentaDominance = Math.min(red, blue) - green;
  const magentaBalance = Math.abs(red - blue);
  if (magentaDominance >= 28 && magentaBalance <= 110) return 0;
  if (magentaDominance > 12 && magentaBalance < 130) {
    return Math.max(0, Math.round(((28 - magentaDominance) / 16) * 255));
  }
  const distance = Math.hypot(255 - red, green, 255 - blue);
  if (distance <= 24) return 0;
  if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
  return 255;
}

function connectedComponents(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  const stack = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (stack.length > 0) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (const neighbor of neighbors) {
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
        stack.push(neighbor);
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

function boxDistance(first, second) {
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

function unionBox(target, source) {
  target.minX = Math.min(target.minX, source.minX);
  target.minY = Math.min(target.minY, source.minY);
  target.maxX = Math.max(target.maxX, source.maxX);
  target.maxY = Math.max(target.maxY, source.maxY);
}

function recoverSixComponents(components) {
  const primaries = components
    .filter(({ area }) => area >= MIN_PRIMARY_AREA)
    .sort((left, right) => right.area - left.area)
    .slice(0, 6)
    .map((component) => ({ ...component }));
  if (primaries.length !== 6) {
    throw new Error(
      `Expected six primary components; found ${primaries.length}`,
    );
  }

  for (const fragment of components.filter(
    ({ area }) => area >= ATTACHMENT_AREA && area < MIN_PRIMARY_AREA,
  )) {
    const nearest = primaries
      .map((primary) => ({ primary, distance: boxDistance(primary, fragment) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (nearest.distance <= ATTACHMENT_DISTANCE)
      unionBox(nearest.primary, fragment);
  }

  const byRow = primaries.sort(
    (left, right) => left.centroidY - right.centroidY,
  );
  const top = byRow
    .slice(0, 3)
    .sort((left, right) => left.centroidX - right.centroidX);
  const bottom = byRow
    .slice(3)
    .sort((left, right) => left.centroidX - right.centroidX);
  return [...top, ...bottom];
}

function keyedRgba(rgb, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const red = rgb[pixel * 3];
    const green = rgb[pixel * 3 + 1];
    const blue = rgb[pixel * 3 + 2];
    const output = pixel * 4;
    const alpha = keyedAlpha(red, green, blue);
    const spill = Math.max(0, Math.min(red, blue) - green - 14);
    rgba[output] = Math.max(0, Math.round(red - spill * 0.88));
    rgba[output + 1] = green;
    rgba[output + 2] = Math.max(0, Math.round(blue - spill * 0.88));
    rgba[output + 3] = alpha < 24 ? 0 : alpha;
  }
  return rgba;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (Math.abs(info.width / info.height - GRID_COLUMNS / GRID_ROWS) > 0.015) {
    throw new Error(
      `Raw kit must have a 3:2 aspect ratio; received ${info.width}x${info.height}`,
    );
  }

  const mask = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    mask[pixel] =
      keyedAlpha(data[pixel * 3], data[pixel * 3 + 1], data[pixel * 3 + 2]) >=
      24
        ? 1
        : 0;
  }
  const components = connectedComponents(mask, info.width, info.height);
  const recovered = recoverSixComponents(components);
  const keyed = keyedRgba(data, info.width, info.height);
  const composites = [];

  for (let index = 0; index < recovered.length; index += 1) {
    const component = recovered[index];
    const padding = 4;
    const left = Math.max(0, component.minX - padding);
    const top = Math.max(0, component.minY - padding);
    const right = Math.min(info.width - 1, component.maxX + padding);
    const bottom = Math.min(info.height - 1, component.maxY + padding);
    const width = right - left + 1;
    const height = bottom - top + 1;
    const maximum = CELL_SIZE - SAFE_INSET * 2;
    const scale = Math.min(maximum / width, maximum / height, 1);
    const resizedWidth = Math.max(1, Math.round(width * scale));
    const resizedHeight = Math.max(1, Math.round(height * scale));
    const cut = await sharp(keyed, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extract({ left, top, width, height })
      .resize(resizedWidth, resizedHeight, { kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer();

    const column = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    composites.push({
      input: cut,
      left: column * CELL_SIZE + Math.round((CELL_SIZE - resizedWidth) / 2),
      top: row * CELL_SIZE + CELL_SIZE - SAFE_INSET - resizedHeight,
    });
  }

  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp({
    create: {
      width: GRID_COLUMNS * CELL_SIZE,
      height: GRID_ROWS * CELL_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);

  process.stdout.write(
    `Prepared six recovered components deterministically: ${path.relative(process.cwd(), output)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
