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
      console.log(`Usage: node scripts/prepare-actor-pose.mjs --input <png> --output <png> [--preserve-framing] [--topology-mask <png>]

Normalizes one isolated generated actor pose into one fixed 256x256
ActorAtlasV2 source cell without changing its aspect ratio. The optional
framing mode preserves the canonical 1024-to-256 canvas scale and only
shrinks further when required by the safe bounds. The optional topology mask
replaces the candidate silhouette in normalized 1024-space before placement.`);
      process.exit(0);
    }
    if (argument === "--preserve-framing") {
      options.preserveFraming = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--input" && name !== "--output" && name !== "--topology-mask")
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    const key = name === "--topology-mask" ? "topologyMask" : name.slice(2);
    options[key] = path.resolve(root, value);
  }
  if (!options.input || !options.output)
    throw new Error("--input and --output are required");
  if (options.input === options.output)
    throw new Error("Preparation cannot overwrite its raw input");
  if (options.topologyMask === options.output)
    throw new Error("Preparation cannot overwrite its topology mask");
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

async function normalizedKeyedTopology(inputPath) {
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || metadata.width !== metadata.height)
    throw new Error(
      `Topology mask must be a non-empty square image; received ${metadata.width}x${metadata.height}`,
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

async function enforceTopologyMask(candidateBuffer, topologyBuffer) {
  const [candidate, topology] = await Promise.all(
    [candidateBuffer, topologyBuffer].map((buffer) =>
      sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  if (
    candidate.info.width !== topology.info.width ||
    candidate.info.height !== topology.info.height
  )
    throw new Error("Candidate and topology mask normalized sizes differ");

  const { width, height } = candidate.info;
  const pixelCount = width * height;
  const candidateVisible = new Uint8Array(pixelCount);
  const referenceVisible = new Uint8Array(pixelCount);
  const referenceAlpha = new Uint8Array(pixelCount);
  const nearestSource = new Int32Array(pixelCount);
  nearestSource.fill(-1);
  const queue = new Int32Array(pixelCount);
  let queueLength = 0;
  let candidateVisiblePixels = 0;
  let referenceVisiblePixels = 0;
  let referenceAntialiasPixels = 0;
  let missingVisiblePixels = 0;
  let extraVisiblePixels = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const candidateAlpha = Math.min(
      candidate.data[offset + 3],
      keyedAlpha(
        candidate.data[offset],
        candidate.data[offset + 1],
        candidate.data[offset + 2],
      ),
    );
    const maskAlpha = Math.min(
      topology.data[offset + 3],
      keyedAlpha(
        topology.data[offset],
        topology.data[offset + 1],
        topology.data[offset + 2],
      ),
    );
    referenceAlpha[pixel] = maskAlpha;
    if (candidateAlpha >= 24) {
      candidateVisible[pixel] = 1;
      candidateVisiblePixels += 1;
      nearestSource[pixel] = pixel;
      queue[queueLength++] = pixel;
    }
    if (maskAlpha >= 24) {
      referenceVisible[pixel] = 1;
      referenceVisiblePixels += 1;
    } else if (maskAlpha > 0) {
      referenceAntialiasPixels += 1;
    }
  }
  if (candidateVisiblePixels === 0) throw new Error("isolated pose is blank");
  if (referenceVisiblePixels === 0) throw new Error("topology mask is blank");

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (referenceVisible[pixel] && !candidateVisible[pixel])
      missingVisiblePixels += 1;
    if (candidateVisible[pixel] && !referenceVisible[pixel])
      extraVisiblePixels += 1;
  }

  // A row-major multi-source flood gives every missing mask pixel the nearest
  // candidate foreground under four-neighbor Manhattan distance. Seed order,
  // followed by left/right/up/down neighbor order, is the stable tie break.
  for (let cursor = 0; cursor < queueLength; cursor += 1) {
    const pixel = queue[cursor];
    const x = pixel % width;
    const neighbors = [
      x > 0 ? pixel - 1 : -1,
      x + 1 < width ? pixel + 1 : -1,
      pixel >= width ? pixel - width : -1,
      pixel + width < pixelCount ? pixel + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || nearestSource[neighbor] !== -1) continue;
      nearestSource[neighbor] = nearestSource[pixel];
      queue[queueLength++] = neighbor;
    }
  }

  const output = Buffer.alloc(candidate.data.length);
  let changedPixels = 0;
  let exactMaskAfterEnforcement = true;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const maskAlpha = referenceAlpha[pixel];
    if (maskAlpha > 0) {
      const source = candidateVisible[pixel] ? pixel : nearestSource[pixel];
      const sourceOffset = source * 4;
      output[offset] = candidate.data[sourceOffset];
      output[offset + 1] = candidate.data[sourceOffset + 1];
      output[offset + 2] = candidate.data[sourceOffset + 2];
      output[offset + 3] = maskAlpha;
    }
    const candidateAlpha = candidate.data[offset + 3];
    const colorChanged =
      maskAlpha > 0 &&
      (output[offset] !== candidate.data[offset] ||
        output[offset + 1] !== candidate.data[offset + 1] ||
        output[offset + 2] !== candidate.data[offset + 2]);
    if (maskAlpha !== candidateAlpha || colorChanged) changedPixels += 1;
    const outputVisible =
      Math.min(
        output[offset + 3],
        keyedAlpha(output[offset], output[offset + 1], output[offset + 2]),
      ) >= 24;
    if (outputVisible !== Boolean(referenceVisible[pixel]))
      exactMaskAfterEnforcement = false;
  }
  if (!exactMaskAfterEnforcement)
    throw new Error(
      "Topology enforcement did not reproduce the reference mask",
    );

  return {
    buffer: await sharp(output, { raw: candidate.info }).png().toBuffer(),
    diagnostics: {
      coordinateSpace: `${width}x${height}`,
      distanceMetric: "four-neighbor-manhattan",
      tieOrder: "row-major-sources;left,right,up,down-neighbors",
      candidateVisiblePixels,
      referenceVisiblePixels,
      referenceAntialiasPixels,
      candidateMissingVisiblePixels: missingVisiblePixels,
      candidateExtraVisiblePixels: extraVisiblePixels,
      changedVisiblePixels: missingVisiblePixels + extraVisiblePixels,
      changedPixels,
      exactMaskAfterEnforcement,
    },
  };
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
  let cleaned = await removeBoundaryArtifacts(keyed);
  let topologyDiagnostics;
  if (options.topologyMask) {
    // Check the candidate independently so a topology stencil can never turn
    // a blank generation into an apparently valid prepared pose.
    await alphaBounds(cleaned, "isolated pose");
    const normalizedTopology = await normalizedKeyedTopology(
      options.topologyMask,
    );
    const cleanedTopology = await removeBoundaryArtifacts(normalizedTopology);
    await alphaBounds(cleanedTopology, "topology mask");
    const enforced = await enforceTopologyMask(cleaned, cleanedTopology);
    cleaned = enforced.buffer;
    topologyDiagnostics = {
      reference: path.relative(root, options.topologyMask),
      ...enforced.diagnostics,
    };
  }
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
        ...(topologyDiagnostics ? { topology: topologyDiagnostics } : {}),
      },
      null,
      2,
    ),
  );
}

await run();
