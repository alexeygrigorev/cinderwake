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
  const options = { preserveFraming: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      console.log(`Usage: node scripts/prepare-actor-pose.mjs --input <png> --output <png> [--preserve-framing]

Normalizes one isolated generated actor pose into one fixed 256x256
ActorAtlasV2 source cell without changing its aspect ratio. The optional
framing mode preserves the canonical 1024-to-256 canvas scale and only
shrinks further when required by the safe bounds.`);
      process.exit(0);
    }
    if (argument === "--preserve-framing") {
      options.preserveFraming = true;
      continue;
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
      const offset = (y * info.width + x) * 4;
      if (
        Math.min(
          data[offset + 3],
          keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
        ) < 24
      )
        continue;
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

async function contactEvidence(buffer, bounds) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const firstY = Math.max(bounds.top, bounds.top + bounds.height - 8);
  const lastY = bounds.top + bounds.height - 1;
  let pixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const alpha = Math.min(
        data[offset + 3],
        keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
      );
      if (alpha < 24) continue;
      pixels += 1;
      alphaWeight += alpha;
      weightedX += x * alpha;
    }
  }
  if (pixels === 0) throw new Error("Prepared pose has no bottom-band contact");
  return {
    firstY,
    lastY,
    pixels,
    alphaWeight,
    centroidX: weightedX / alphaWeight,
  };
}

function fitsSafeBounds(bounds) {
  return (
    bounds.left >= safeBounds.x &&
    bounds.top >= safeBounds.y &&
    bounds.left + bounds.width <= safeBounds.x + safeBounds.width &&
    bounds.top + bounds.height <= safeBounds.y + safeBounds.height
  );
}

function safeScaleCorrection(bounds) {
  const availableLeft = footAnchor.x - safeBounds.x;
  const availableRight = safeBounds.x + safeBounds.width - footAnchor.x;
  const availableTop = footAnchor.y - safeBounds.y;
  const usedLeft = Math.max(1, footAnchor.x - bounds.left);
  const usedRight = Math.max(1, bounds.left + bounds.width - footAnchor.x);
  const usedTop = Math.max(1, footAnchor.y - bounds.top);
  return Math.min(
    1,
    availableLeft / usedLeft,
    availableRight / usedRight,
    availableTop / usedTop,
  );
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const keyed = await normalizedKeyedInput(options.input);
  const cleaned = await removeBoundaryArtifacts(keyed);
  const inputBounds = await alphaBounds(cleaned, "isolated pose");
  const maximumScale = options.preserveFraming
    ? cellSize / normalizedInputSize
    : 1;
  let scale = Math.min(
    safeBounds.width / inputBounds.width,
    safeBounds.height / inputBounds.height,
    maximumScale,
  );
  const renderAtScale = async (attemptScale) => {
    const width = Math.max(1, Math.round(inputBounds.width * attemptScale));
    const height = Math.max(1, Math.round(inputBounds.height * attemptScale));
    const sprite = await sharp(cleaned)
      .extract(inputBounds)
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    const compose = (placementLeft, placementTop) =>
      sharp({
        create: {
          width: cellSize,
          height: cellSize,
          channels: 4,
          background: magenta,
        },
      })
        .composite([{ input: sprite, left: placementLeft, top: placementTop }])
        .png({ compressionLevel: 9, palette: true, quality: 100 })
        .toBuffer();
    let left = Math.round(footAnchor.x - width / 2);
    let top = footAnchor.y - height;
    let outputBuffer = await compose(left, top);
    let preparedInkBounds = await alphaBounds(
      outputBuffer,
      "prepared isolated pose",
    );
    if (options.preserveFraming) {
      left += Math.round(
        footAnchor.x - (preparedInkBounds.left + preparedInkBounds.width / 2),
      );
      top += footAnchor.y - (preparedInkBounds.top + preparedInkBounds.height);
      outputBuffer = await compose(left, top);
      preparedInkBounds = await alphaBounds(
        outputBuffer,
        "aligned prepared isolated pose",
      );
      const support = await contactEvidence(outputBuffer, preparedInkBounds);
      left += Math.round(footAnchor.x - support.centroidX);
      outputBuffer = await compose(left, top);
      preparedInkBounds = await alphaBounds(
        outputBuffer,
        "contact-aligned prepared isolated pose",
      );
    }
    return {
      width,
      height,
      left,
      top,
      outputBuffer,
      preparedInkBounds,
      preparedContact: await contactEvidence(outputBuffer, preparedInkBounds),
    };
  };
  let rendered = await renderAtScale(scale);
  for (
    let attempt = 0;
    options.preserveFraming && !fitsSafeBounds(rendered.preparedInkBounds);
    attempt += 1
  ) {
    if (attempt >= 8)
      throw new Error("Unable to fit contact-aligned pose in safe bounds");
    const correction = safeScaleCorrection(rendered.preparedInkBounds);
    scale *= correction < 1 ? correction * 0.995 : 0.99;
    rendered = await renderAtScale(scale);
  }
  const {
    width,
    height,
    left,
    top,
    outputBuffer,
    preparedInkBounds,
    preparedContact,
  } = rendered;
  if (!fitsSafeBounds(preparedInkBounds))
    throw new Error("Prepared pose leaves source-cell safe bounds");
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, outputBuffer);
  console.log(
    JSON.stringify(
      {
        input: path.relative(root, options.input),
        output: path.relative(root, options.output),
        normalizedInputSize,
        outputSize: cellSize,
        inputBounds,
        framingMode: options.preserveFraming
          ? "preserve-canonical-canvas"
          : "legacy-safe-fit",
        maximumScale,
        uniformScale: Number(scale.toFixed(6)),
        placementBounds: { left, top, width, height },
        preparedBounds: preparedInkBounds,
        contact: {
          ...preparedContact,
          centroidOffsetFromAnchor: Number(
            (preparedContact.centroidX - footAnchor.x).toFixed(6),
          ),
        },
        footAnchor,
        safeBounds,
      },
      null,
      2,
    ),
  );
}

await run();
