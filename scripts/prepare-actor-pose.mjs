import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const actorSpec = JSON.parse(
  await fs.readFile(path.join(root, "art", "actor-atlas-v1.json"), "utf8"),
);
const normalizedInputSize = actorSpec.source.pixelWidth;
const cellSize = actorSpec.source.cellWidth;
const sourceScale = cellSize / actorSpec.atlas.cellWidth;
const safeBounds = {
  x: actorSpec.atlas.safeInkBounds.x * sourceScale,
  y: actorSpec.atlas.safeInkBounds.y * sourceScale,
  width: actorSpec.atlas.safeInkBounds.width * sourceScale,
  height: actorSpec.atlas.safeInkBounds.height * sourceScale,
};
const footAnchor = {
  x: actorSpec.atlas.footAnchor.x * sourceScale,
  y: actorSpec.atlas.footAnchor.y * sourceScale,
};
const magenta = { r: 255, g: 0, b: 255, alpha: 1 };

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      console.log(`Usage: node scripts/prepare-actor-pose.mjs --input <png> --output <png>

Normalizes one isolated generated actor pose into one fixed 256x256
ActorAtlasV2 source cell without changing its aspect ratio.`);
      process.exit(0);
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--input" && name !== "--output")
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    options[name.slice(2)] = path.resolve(root, value);
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

async function normalizedKeyedInput(inputPath) {
  const metadata = await sharp(inputPath).metadata();
  if (
    !metadata.width ||
    metadata.width !== metadata.height ||
    metadata.width < normalizedInputSize
  )
    throw new Error(
      `Raw pose must be square and at least ${normalizedInputSize}px; received ${metadata.width}x${metadata.height}`,
    );
  const { data, info } = await sharp(inputPath)
    .resize(normalizedInputSize, normalizedInputSize, {
      fit: "fill",
      kernel: "lanczos3",
    })
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

async function removeBoundaryArtifacts(buffer) {
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
        if (
          neighbor < 0 ||
          neighbor >= pixelCount ||
          visited[neighbor] ||
          data[neighbor * 4 + 3] < 24
        )
          continue;
        if (Math.abs((neighbor % info.width) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ pixels, touchesBoundary });
  }
  const largest = Math.max(0, ...components.map(({ pixels }) => pixels.length));
  for (const component of components) {
    if (!component.touchesBoundary || component.pixels.length === largest)
      continue;
    for (const pixel of component.pixels) data[pixel * 4 + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
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
      if (data[(y * info.width + x) * 4 + 3] < 24) continue;
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
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const keyed = await normalizedKeyedInput(options.input);
  const cleaned = await removeBoundaryArtifacts(keyed);
  const inputBounds = await alphaBounds(cleaned, "isolated pose");
  const scale = Math.min(
    safeBounds.width / inputBounds.width,
    safeBounds.height / inputBounds.height,
    1,
  );
  const width = Math.max(1, Math.round(inputBounds.width * scale));
  const height = Math.max(1, Math.round(inputBounds.height * scale));
  const sprite = await sharp(cleaned)
    .extract(inputBounds)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const left = Math.round(footAnchor.x - width / 2);
  const top = footAnchor.y - height;
  if (
    left < safeBounds.x ||
    top < safeBounds.y ||
    left + width > safeBounds.x + safeBounds.width ||
    top + height > safeBounds.y + safeBounds.height
  )
    throw new Error("Prepared pose leaves source-cell safe bounds");
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await sharp({
    create: {
      width: cellSize,
      height: cellSize,
      channels: 4,
      background: magenta,
    },
  })
    .composite([{ input: sprite, left, top }])
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(options.output);
  console.log(
    JSON.stringify(
      {
        input: path.relative(root, options.input),
        output: path.relative(root, options.output),
        normalizedInputSize,
        outputSize: cellSize,
        inputBounds,
        uniformScale: Number(scale.toFixed(6)),
        preparedBounds: { left, top, width, height },
        footAnchor,
        safeBounds,
      },
      null,
      2,
    ),
  );
}

await run();
