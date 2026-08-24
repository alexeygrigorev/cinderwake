import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const ROOT = process.cwd();
const ACTOR_SPEC_PATH = path.join(ROOT, "art", "actor-atlas-v1.json");
const ACTOR_SPEC = JSON.parse(await fs.readFile(ACTOR_SPEC_PATH, "utf8"));
const ACTOR_CELL = ACTOR_SPEC.atlas.cellWidth;
const SOURCE_CELL = ACTOR_SPEC.source.cellWidth;
const GRID_CELL = ACTOR_SPEC.source.cellWidth;
const SOURCE_SIZE = ACTOR_SPEC.source.pixelWidth;
const ACTOR_ATLAS_WIDTH = ACTOR_SPEC.atlas.pixelWidth;
const ACTOR_ATLAS_HEIGHT = ACTOR_SPEC.atlas.pixelHeight;
const LOOT_ATLAS_SIZE = 2048;
const ACTOR_IDS = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

function printUsage() {
  console.log(`Usage: node scripts/build-sprite-assets.mjs [options]

Options:
  --actors <ids>       Comma-separated actor IDs (default: every actor)
  --source-dir <path>  Actor source directory (default: art/source/actors)
  --output-dir <path>  Output directory (default: public/assets/sprites)
  --actors-only        Build actor atlases and their manifest only
  --help               Show this help`);
}

function parseArguments(args) {
  let actors = [...ACTOR_IDS];
  let actorSourceDirectory = path.join(ROOT, "art", "source", "actors");
  let outputDirectory = path.join(ROOT, "public", "assets", "sprites");
  let actorsOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      printUsage();
      process.exit(0);
    }
    if (argument === "--actors-only") {
      actorsOnly = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (
      name !== "--actors" &&
      name !== "--source-dir" &&
      name !== "--output-dir"
    )
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    if (name === "--actors") {
      actors = [...new Set(value.split(",").map((id) => id.trim()))].filter(
        Boolean,
      );
      if (actors.length === 0) throw new Error("--actors cannot be empty");
      const unknown = actors.filter((id) => !ACTOR_IDS.includes(id));
      if (unknown.length > 0)
        throw new Error(`Unknown actor ID(s): ${unknown.join(", ")}`);
    } else if (name === "--source-dir") {
      actorSourceDirectory = path.resolve(ROOT, value);
    } else {
      outputDirectory = path.resolve(ROOT, value);
    }
  }
  return { actors, actorsOnly, actorSourceDirectory, outputDirectory };
}

const OPTIONS = parseArguments(process.argv.slice(2));

function inputPath(...segments) {
  return path.join(ROOT, "art", "source", ...segments);
}

function outputPath(fileName) {
  return path.join(OPTIONS.outputDirectory, fileName);
}

function keyedAlpha(red, green, blue, mode) {
  if (mode === "magenta") {
    const magentaDominance = Math.min(red, blue) - green;
    const magentaBalance = Math.abs(red - blue);
    // Generated chroma backgrounds contain dark anti-aliased magenta around
    // silhouettes, not only literal #ff00ff. Key the hue as well as the exact
    // color so those connected fields cannot survive as rectangular halos.
    if (magentaDominance >= 28 && magentaBalance <= 110) return 0;
    if (magentaDominance > 12 && magentaBalance < 130)
      return Math.max(0, Math.round(((28 - magentaDominance) / 16) * 255));
    const distance = Math.hypot(255 - red, green, 255 - blue);
    if (distance <= 24) return 0;
    if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
    return 255;
  }
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  const brightness = (red + green + blue) / 3;
  if (spread < 18 && brightness >= 232) return 0;
  if (spread < 24 && brightness > 202)
    return Math.round(((232 - brightness) / 30) * 255);
  return 255;
}

async function normalizeSource(filePath, keyMode) {
  const { data, info } = await sharp(filePath)
    .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const keyed = keyedAlpha(red, green, blue, keyMode);
    data[offset + 3] = Math.min(data[offset + 3], keyed);
    if (keyMode === "magenta" && data[offset + 3] > 0) {
      const spill = Math.max(0, Math.min(red, blue) - green - 14);
      data[offset] = Math.max(0, Math.round(red - spill * 0.88));
      data[offset + 2] = Math.max(0, Math.round(blue - spill * 0.88));
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function normalizeDecalSource(filePath) {
  const keyed = await normalizeSource(filePath, "light");
  const { data, info } = await sharp(keyed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const matte = 238;
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    const brightness = (red + green + blue) / 3;
    if (spread < 40 && brightness > 150) {
      const neutralAlpha = Math.max(
        0,
        Math.min(255, Math.round(((230 - brightness) / 80) * 255)),
      );
      data[offset + 3] = Math.min(data[offset + 3], neutralAlpha);
    }
    const alpha = data[offset + 3] / 255;
    if (alpha <= 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      continue;
    }
    if (alpha < 1) {
      for (let channel = 0; channel < 3; channel += 1)
        data[offset + channel] = Math.max(
          0,
          Math.min(
            255,
            Math.round((data[offset + channel] - matte * (1 - alpha)) / alpha),
          ),
        );
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function alphaBounds(buffer) {
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
      if (data[(y * info.width + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("Source cell is blank");
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
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
    if (visited[start] || data[start * 4 + 3] < 8) continue;
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
      const neighbors = [
        pixel - 1,
        pixel + 1,
        pixel - info.width,
        pixel + info.width,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= pixelCount || visited[neighbor])
          continue;
        const neighborX = neighbor % info.width;
        if (Math.abs(neighborX - x) > 1 || data[neighbor * 4 + 3] < 8) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ pixels, touchesBoundary });
  }
  const largest = Math.max(...components.map(({ pixels }) => pixels.length));
  for (const component of components) {
    if (!component.touchesBoundary || component.pixels.length === largest)
      continue;
    for (const pixel of component.pixels) data[pixel * 4 + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function extractActorCells(source) {
  const cells = [];
  for (let index = 0; index < 16; index += 1) {
    const extracted = await sharp(source)
      .extract({
        left: (index % 4) * SOURCE_CELL,
        top: Math.floor(index / 4) * SOURCE_CELL,
        width: SOURCE_CELL,
        height: SOURCE_CELL,
      })
      .png()
      .toBuffer();
    cells.push(await removeBoundaryArtifacts(extracted));
  }
  return cells;
}

async function cleanLowAlpha(buffer, threshold = 24) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4)
    if (data[offset + 3] < threshold) data[offset + 3] = 0;
  return sharp(data, { raw: info }).png().toBuffer();
}

async function reanchorCell(buffer) {
  const cleaned = await cleanLowAlpha(buffer);
  const bounds = await alphaBounds(cleaned);
  const sprite = await sharp(cleaned).extract(bounds).png().toBuffer();
  return sharp({
    create: {
      width: ACTOR_CELL,
      height: ACTOR_CELL,
      channels: 4,
      background: transparent,
    },
  })
    .composite([
      {
        input: sprite,
        left: Math.round(ACTOR_SPEC.atlas.footAnchor.x - bounds.width / 2),
        top: ACTOR_SPEC.atlas.footAnchor.y - bounds.height,
      },
    ])
    .png()
    .toBuffer();
}

async function normalizedActorCellSets(sources) {
  const extractedSets = {};
  const records = [];
  for (const [sourceId, source] of Object.entries(sources)) {
    const cells = await extractActorCells(source);
    extractedSets[sourceId] = cells;
    for (const [index, buffer] of cells.entries())
      records.push({
        sourceId,
        index,
        buffer,
        bounds: await alphaBounds(buffer),
      });
  }
  const safe = ACTOR_SPEC.atlas.safeInkBounds;
  const maximumWidth = Math.max(...records.map(({ bounds }) => bounds.width));
  const maximumHeight = Math.max(...records.map(({ bounds }) => bounds.height));
  const scale = Math.min(
    safe.width / maximumWidth,
    safe.height / maximumHeight,
    1,
  );
  const normalized = {};
  for (const sourceId of Object.keys(extractedSets)) normalized[sourceId] = [];
  for (const { sourceId, index, buffer, bounds } of records) {
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const sprite = await sharp(buffer)
      .extract(bounds)
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    const cell = await sharp({
      create: {
        width: ACTOR_CELL,
        height: ACTOR_CELL,
        channels: 4,
        background: transparent,
      },
    })
      .composite([
        {
          input: sprite,
          left: Math.round(ACTOR_SPEC.atlas.footAnchor.x - width / 2),
          top: ACTOR_SPEC.atlas.footAnchor.y - height,
        },
      ])
      .png()
      .toBuffer();
    normalized[sourceId][index] = await reanchorCell(cell);
  }
  return normalized;
}

async function blendedFrame(first, second, mix) {
  const [a, b] = await Promise.all(
    [first, second].map((buffer) =>
      sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  const output = Buffer.alloc(a.data.length);
  for (let offset = 0; offset < output.length; offset += 4) {
    const alphaA = (a.data[offset + 3] / 255) * (1 - mix);
    const alphaB = (b.data[offset + 3] / 255) * mix;
    const alpha = alphaA + alphaB;
    for (let channel = 0; channel < 3; channel += 1)
      output[offset + channel] = alpha
        ? Math.round(
            (a.data[offset + channel] * alphaA +
              b.data[offset + channel] * alphaB) /
              alpha,
          )
        : 0;
    output[offset + 3] = Math.round(alpha * 255);
  }
  return reanchorCell(await sharp(output, { raw: a.info }).png().toBuffer());
}

async function transformedFrame(buffer, transform) {
  if (!transform) return buffer;
  if (transform.anchor !== "foot")
    throw new Error(`Unsupported frame transform anchor: ${transform.anchor}`);
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  )
    throw new Error("Frame transform scales must be positive finite numbers");
  const cleaned = await cleanLowAlpha(buffer);
  const bounds = await alphaBounds(cleaned);
  const width = Math.max(1, Math.round(bounds.width * scaleX));
  const height = Math.max(1, Math.round(bounds.height * scaleY));
  const sprite = await sharp(cleaned)
    .extract(bounds)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  return reanchorCell(
    await sharp({
      create: {
        width: ACTOR_CELL,
        height: ACTOR_CELL,
        channels: 4,
        background: transparent,
      },
    })
      .composite([
        {
          input: sprite,
          left: Math.round(ACTOR_SPEC.atlas.footAnchor.x - width / 2),
          top: ACTOR_SPEC.atlas.footAnchor.y - height,
        },
      ])
      .png()
      .toBuffer(),
  );
}

async function frameFromRecipe(cellsBySource, sourceId, recipe) {
  if (Number.isInteger(recipe)) return cellsBySource[sourceId][recipe];
  if (recipe.source) return cellsBySource[recipe.source][recipe.cell];
  const cells = cellsBySource[sourceId];
  return blendedFrame(cells[recipe.from], cells[recipe.to], recipe.mix);
}

function clipForActor(actorId, family, clipId, clip) {
  const override = ACTOR_SPEC.actorOverrides?.[actorId]?.[family]?.[clipId];
  return override ? { ...clip, ...override } : clip;
}

async function buildActor(actorId) {
  const sourceFiles = ACTOR_SPEC.source.files;
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(sourceFiles).map(async ([sourceId, pattern]) => [
        sourceId,
        await normalizeSource(
          path.join(
            OPTIONS.actorSourceDirectory,
            pattern.replace("{actor}", actorId),
          ),
          "magenta",
        ),
      ]),
    ),
  );
  const cellsBySource = await normalizedActorCellSets(sources);
  const composites = [];
  const banks = [
    ...Object.entries(ACTOR_SPEC.clips).map(([clipId, clip]) => [
      clipId,
      clipForActor(actorId, "clips", clipId, clip),
    ]),
    ...Object.entries(ACTOR_SPEC.directionalClips).map(([clipId, clip]) => [
      clipId,
      clipForActor(actorId, "directionalClips", clipId, clip),
    ]),
  ];
  for (const [, clip] of banks) {
    for (const [frameIndex, recipe] of clip.sourceFrames.entries())
      composites.push({
        input: await transformedFrame(
          await frameFromRecipe(cellsBySource, clip.source, recipe),
          clip.frameTransform,
        ),
        left: frameIndex * ACTOR_CELL,
        top: clip.atlasRow * ACTOR_CELL,
      });
  }
  const destination = outputPath(`actor-${actorId}.png`);
  await sharp({
    create: {
      width: ACTOR_ATLAS_WIDTH,
      height: ACTOR_ATLAS_HEIGHT,
      channels: 4,
      background: transparent,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

async function buildGrid(sourcePath, destination, mode = undefined) {
  const image = mode
    ? sharp(await normalizeSource(sourcePath, mode))
    : sharp(sourcePath).resize(SOURCE_SIZE, SOURCE_SIZE, {
        fit: "fill",
        kernel: "lanczos3",
      });
  await image
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

async function buildContinuousFloor(sourcePath, destination) {
  const source = await sharp(sourcePath)
    .resize(SOURCE_SIZE, SOURCE_SIZE, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const broadLighting = await sharp(sourcePath)
    .resize(SOURCE_SIZE, SOURCE_SIZE, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .blur(80)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.alloc(source.data.length);
  const clamp = (value, minimum, maximum) =>
    Math.max(minimum, Math.min(maximum, value));
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const sourceLuma =
      source.data[offset] * 0.2126 +
      source.data[offset + 1] * 0.7152 +
      source.data[offset + 2] * 0.0722;
    const broadLuma =
      broadLighting.data[offset] * 0.2126 +
      broadLighting.data[offset + 1] * 0.7152 +
      broadLighting.data[offset + 2] * 0.0722;
    // Preserve cracks, roots, grit, and irregular stone from the continuous
    // source while removing its baked orange/cyan spotlight. A brighter
    // neutral midpoint leaves collision overlays readable without restoring
    // the rejected atlas of square cobblestone slabs.
    const localLuma = clamp(46 + (sourceLuma - broadLuma) * 0.88, 14, 88);
    pixels[offset] = Math.round(
      clamp(localLuma + 2 + (source.data[offset] - sourceLuma) * 0.06, 0, 255),
    );
    pixels[offset + 1] = Math.round(
      clamp(localLuma + (source.data[offset + 1] - sourceLuma) * 0.06, 0, 255),
    );
    pixels[offset + 2] = Math.round(
      clamp(
        localLuma - 4 + (source.data[offset + 2] - sourceLuma) * 0.06,
        0,
        255,
      ),
    );
  }
  await sharp(pixels, {
    raw: {
      width: source.info.width,
      height: source.info.height,
      channels: 3,
    },
  })
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

async function buildDecalAtlas(sourcePath, destination) {
  const normalized = await normalizeDecalSource(sourcePath);
  const cells = await extractActorCells(normalized);
  const composites = [];
  for (const [index, extracted] of cells.entries()) {
    const cleaned = await cleanLowAlpha(extracted, 18);
    const bounds = await alphaBounds(cleaned);
    const scale = Math.min(220 / bounds.width, 208 / bounds.height, 1);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const sprite = await sharp(cleaned)
      .extract(bounds)
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    composites.push({
      input: sprite,
      left: (index % 4) * GRID_CELL + Math.round((GRID_CELL - width) / 2),
      top:
        Math.floor(index / 4) * GRID_CELL +
        Math.round((GRID_CELL - height) / 2),
    });
  }
  await sharp({
    create: {
      width: SOURCE_SIZE,
      height: SOURCE_SIZE,
      channels: 4,
      background: transparent,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

async function buildTerrainAtlas(sourcePath, destination) {
  const normalized = await sharp(sourcePath)
    .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const composites = [];
  for (let index = 0; index < 16; index += 1) {
    const tile = await sharp(normalized)
      .extract({
        left: (index % 4) * GRID_CELL + 3,
        top: Math.floor(index / 4) * GRID_CELL + 3,
        width: GRID_CELL - 6,
        height: GRID_CELL - 6,
      })
      .resize(GRID_CELL, GRID_CELL, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    composites.push({
      input: tile,
      left: (index % 4) * GRID_CELL,
      top: Math.floor(index / 4) * GRID_CELL,
    });
  }
  await sharp({
    create: {
      width: SOURCE_SIZE,
      height: SOURCE_SIZE,
      channels: 4,
      background: transparent,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

async function buildLootAtlas(propsPath, effectsPath) {
  const definitions = [
    { source: propsPath, cell: 14 },
    { source: propsPath, cell: 14 },
    { source: propsPath, cell: 14 },
    { source: propsPath, cell: 15 },
    { source: propsPath, cell: 15 },
    { source: propsPath, cell: 15 },
    { source: effectsPath, cell: 12 },
    { source: effectsPath, cell: 13 },
    { source: effectsPath, cell: 14 },
  ];
  const composites = [];
  for (const [itemIndex, definition] of definitions.entries()) {
    const source = await sharp(definition.source)
      .extract({
        left: (definition.cell % 4) * GRID_CELL,
        top: Math.floor(definition.cell / 4) * GRID_CELL,
        width: GRID_CELL,
        height: GRID_CELL,
      })
      .png()
      .toBuffer();
    const bounds = await alphaBounds(source);
    const cropped = await sharp(source).extract(bounds).png().toBuffer();
    for (let frame = 0; frame < 4; frame += 1) {
      const pulse = [0.82, 0.88, 0.92, 0.86][frame];
      const width = Math.max(1, Math.round(bounds.width * pulse));
      const height = Math.max(1, Math.round(bounds.height * pulse));
      const sprite = await sharp(cropped)
        .resize(width, height, { fit: "fill", kernel: "lanczos3" })
        .png()
        .toBuffer();
      const cellIndex = itemIndex * 4 + frame;
      composites.push({
        input: sprite,
        left: (cellIndex % 8) * GRID_CELL + Math.round((GRID_CELL - width) / 2),
        top:
          Math.floor(cellIndex / 8) * GRID_CELL +
          232 -
          height -
          [0, 4, 7, 3][frame],
      });
    }
  }
  const destination = outputPath("loot.png");
  await sharp({
    create: {
      width: LOOT_ATLAS_SIZE,
      height: LOOT_ATLAS_SIZE,
      channels: 4,
      background: transparent,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function buildGlyphAtlas() {
  const columns = 16;
  const rows = 8;
  const glyphCell = 64;
  const composites = [];
  for (let codePoint = 32; codePoint <= 126; codePoint += 1) {
    const index = codePoint - 32;
    const glyph = String.fromCodePoint(codePoint);
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${glyphCell}" height="${glyphCell}" viewBox="0 0 ${glyphCell} ${glyphCell}"><text x="32" y="45" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="38" font-weight="600" stroke="#0a0b0b" stroke-width="3" paint-order="stroke" fill="#f0e4d1">${xmlEscape(glyph)}</text></svg>`,
    );
    composites.push({
      input: svg,
      left: (index % columns) * glyphCell,
      top: Math.floor(index / columns) * glyphCell,
    });
  }
  const destination = outputPath("glyphs.png");
  await sharp({
    create: {
      width: columns * glyphCell,
      height: rows * glyphCell,
      channels: 4,
      background: transparent,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(destination);
  return destination;
}

await fs.mkdir(outputPath("."), { recursive: true });
const outputs = [];
for (const actorId of OPTIONS.actors) outputs.push(await buildActor(actorId));
if (!OPTIONS.actorsOnly) {
  const terrainPath = await buildTerrainAtlas(
    inputPath("environment", "terrain-source.png"),
    outputPath("environment-terrain.png"),
  );
  const groundPath = await buildGrid(
    inputPath("environment", "ground-source.png"),
    outputPath("environment-ground.png"),
  );
  const floorPath = await buildContinuousFloor(
    inputPath("environment", "ground-source.png"),
    outputPath("environment-floor.png"),
  );
  const structuresPath = await buildGrid(
    inputPath("environment", "structures-source.png"),
    outputPath("environment-structures.png"),
    "light",
  );
  const propsPath = await buildGrid(
    inputPath("environment", "props-source.png"),
    outputPath("environment-props.png"),
    "magenta",
  );
  const decalsPath = await buildDecalAtlas(
    inputPath("environment", "decals-source.png"),
    outputPath("environment-decals.png"),
  );
  const uiPath = await buildGrid(
    inputPath("ui", "ui-source.png"),
    outputPath("ui.png"),
    "magenta",
  );
  const effectsPath = await buildGrid(
    inputPath("ui", "effects-source.png"),
    outputPath("effects.png"),
    "magenta",
  );
  outputs.push(
    terrainPath,
    groundPath,
    floorPath,
    structuresPath,
    propsPath,
    decalsPath,
    uiPath,
    effectsPath,
    await buildLootAtlas(propsPath, effectsPath),
    await buildGlyphAtlas(),
  );
}

const manifest = {
  schemaVersion: 1,
  pipeline: ACTOR_SPEC.id,
  actorSpec: {
    source: path.relative(ROOT, ACTOR_SPEC_PATH),
    sha256: await sha256(ACTOR_SPEC_PATH),
  },
  builtAt: "deterministic-from-committed-source",
  outputs: Object.fromEntries(
    await Promise.all(
      outputs.map(async (filePath) => [
        path.basename(filePath),
        {
          sha256: await sha256(filePath),
          source: path.relative(ROOT, filePath),
        },
      ]),
    ),
  ),
};
await fs.writeFile(
  outputPath("build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Built ${outputs.length} deterministic sprite atlases.`);
