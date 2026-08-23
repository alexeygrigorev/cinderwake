import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const ROOT = process.cwd();
const SPEC = JSON.parse(
  await fs.readFile(path.join(ROOT, "art", "actor-atlas-v1.json"), "utf8"),
);
const SOURCE_SIZE = SPEC.source.pixelWidth;
const CELL_SIZE = SPEC.source.cellWidth;
const SOURCE_SCALE = CELL_SIZE / SPEC.atlas.cellWidth;
const SAFE = {
  x: SPEC.atlas.safeInkBounds.x * SOURCE_SCALE,
  y: SPEC.atlas.safeInkBounds.y * SOURCE_SCALE,
  width: SPEC.atlas.safeInkBounds.width * SOURCE_SCALE,
  height: SPEC.atlas.safeInkBounds.height * SOURCE_SCALE,
};
const FOOT_ANCHOR = {
  x: SPEC.atlas.footAnchor.x * SOURCE_SCALE,
  y: SPEC.atlas.footAnchor.y * SOURCE_SCALE,
};
const MAGENTA = { r: 255, g: 0, b: 255, alpha: 1 };

function usage() {
  console.log(`Usage: node scripts/prepare-actor-source.mjs --input <png> --output <png>

Normalizes a raw generated square onto the ActorAtlasV2 1024x1024 grid,
chroma-keys magenta shades, applies one shared scale across all 16 cells,
and grounds every cell on the declared source-space foot anchor.`);
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      usage();
      process.exit(0);
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--input" && name !== "--output")
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    options[name.slice(2)] = path.resolve(ROOT, value);
  }
  if (!options.input || !options.output)
    throw new Error("--input and --output are required");
  if (options.input === options.output)
    throw new Error("Preparation cannot overwrite its raw input");
  return options;
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

async function normalizedKeyedSource(inputPath) {
  const metadata = await sharp(inputPath).metadata();
  if (
    metadata.width !== metadata.height ||
    !metadata.width ||
    metadata.width < SOURCE_SIZE
  )
    throw new Error(
      `Raw candidate must be square and at least ${SOURCE_SIZE}px; received ${metadata.width}x${metadata.height}`,
    );
  const { data, info } = await sharp(inputPath)
    .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset + 3] = Math.min(
      data[offset + 3],
      keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
    );
    if (data[offset + 3] < 24) {
      data[offset + 3] = 0;
      continue;
    }
    const spill = Math.max(
      0,
      Math.min(data[offset], data[offset + 2]) - data[offset + 1] - 14,
    );
    data[offset] = Math.max(0, Math.round(data[offset] - spill * 0.88));
    data[offset + 2] = Math.max(0, Math.round(data[offset + 2] - spill * 0.88));
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function alphaBounds(buffer, label) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 24) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error(`${label} is blank`);
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function removeCellArtifacts(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[start * 4 + 3] < 24) continue;
    const queue = [start];
    const pixels = [];
    let touchesBoundary = false;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      pixels.push(pixel);
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1)
        touchesBoundary = true;
      for (const neighbor of [
        pixel - 1,
        pixel + 1,
        pixel - info.width,
        pixel + info.width,
      ]) {
        if (neighbor < 0 || neighbor >= pixelCount || visited[neighbor])
          continue;
        const neighborX = neighbor % info.width;
        if (Math.abs(neighborX - x) > 1 || data[neighbor * 4 + 3] < 24)
          continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ pixels, touchesBoundary });
  }
  const largest = Math.max(...components.map(({ pixels }) => pixels.length));
  const minimumUsefulComponent = Math.max(8, Math.floor(largest * 0.0005));
  for (const component of components) {
    if (component.pixels.length === largest) continue;
    if (
      !component.touchesBoundary &&
      component.pixels.length >= minimumUsefulComponent
    )
      continue;
    for (const pixel of component.pixels) data[pixel * 4 + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function extractCells(source) {
  return Promise.all(
    Array.from(
      { length: SPEC.source.columns * SPEC.source.rows },
      async (_, index) =>
        removeCellArtifacts(
          await sharp(source)
            .extract({
              left: (index % SPEC.source.columns) * CELL_SIZE,
              top: Math.floor(index / SPEC.source.columns) * CELL_SIZE,
              width: CELL_SIZE,
              height: CELL_SIZE,
            })
            .png()
            .toBuffer(),
        ),
    ),
  );
}

async function prepareCell(cell, bounds, scale) {
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const sprite = await sharp(cell)
    .extract(bounds)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const left = Math.round(FOOT_ANCHOR.x - width / 2);
  const top = FOOT_ANCHOR.y - height;
  if (
    left < SAFE.x ||
    top < SAFE.y ||
    left + width > SAFE.x + SAFE.width ||
    top + height > SAFE.y + SAFE.height
  )
    throw new Error("Prepared sprite leaves source-space safe bounds");
  return sharp({
    create: {
      width: CELL_SIZE,
      height: CELL_SIZE,
      channels: 4,
      background: MAGENTA,
    },
  })
    .composite([{ input: sprite, left, top }])
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toBuffer();
}

const options = parseArguments(process.argv.slice(2));
const source = await normalizedKeyedSource(options.input);
const cells = await extractCells(source);
const bounds = await Promise.all(
  cells.map((cell, index) => alphaBounds(cell, `cell ${index}`)),
);
const maximumWidth = Math.max(...bounds.map(({ width }) => width));
const maximumHeight = Math.max(...bounds.map(({ height }) => height));
const sharedScale = Math.min(
  SAFE.width / maximumWidth,
  SAFE.height / maximumHeight,
  1,
);
const preparedCells = await Promise.all(
  cells.map((cell, index) => prepareCell(cell, bounds[index], sharedScale)),
);
const composites = preparedCells.map((input, index) => ({
  input,
  left: (index % SPEC.source.columns) * CELL_SIZE,
  top: Math.floor(index / SPEC.source.columns) * CELL_SIZE,
}));
await fs.mkdir(path.dirname(options.output), { recursive: true });
await sharp({
  create: {
    width: SOURCE_SIZE,
    height: SOURCE_SIZE,
    channels: 4,
    background: MAGENTA,
  },
})
  .composite(composites)
  .png({ compressionLevel: 9, palette: true, quality: 100 })
  .toFile(options.output);

console.log(
  JSON.stringify(
    {
      input: path.relative(ROOT, options.input),
      output: path.relative(ROOT, options.output),
      normalizedSize: SOURCE_SIZE,
      cells: preparedCells.length,
      sharedScale: Number(sharedScale.toFixed(6)),
      footAnchor: FOOT_ANCHOR,
      safeInkBounds: SAFE,
    },
    null,
    2,
  ),
);
