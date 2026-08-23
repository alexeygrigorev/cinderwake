import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const ROOT = process.cwd();
const CELL = 256;
const SOURCE_SIZE = 1024;
const ACTOR_ATLAS_SIZE = 2048;
const ACTOR_IDS = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];
const CLIPS = {
  idle: { row: 0, sourceCells: [0, 1, 2, 3, 2, 1] },
  walk: { row: 1, sourceCells: [4, 5, 6, 7, 4, 5, 6, 7] },
  attack: { row: 2, sourceCells: [8, 8, 9, 10, 10, 11] },
  ability: { row: 3, sourceCells: [12, 12, 13, 13, 14, 14, 15, 15] },
  hurt: { row: 4, sourceCells: [0, 1, 2, 3] },
  death: { row: 5, sourceCells: [0, 0, 0, 0, 0, 0, 0, 0] },
};
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

function inputPath(...segments) {
  return path.join(ROOT, "art", "source", ...segments);
}

function outputPath(fileName) {
  return path.join(ROOT, "public", "assets", "sprites", fileName);
}

function keyedAlpha(red, green, blue, mode) {
  if (mode === "magenta") {
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

async function normalizedActorCells(source) {
  const extracted = [];
  const bounds = [];
  for (let index = 0; index < 16; index += 1) {
    const buffer = await sharp(source)
      .extract({
        left: (index % 4) * CELL,
        top: Math.floor(index / 4) * CELL,
        width: CELL,
        height: CELL,
      })
      .png()
      .toBuffer();
    extracted.push(buffer);
    bounds.push(await alphaBounds(buffer));
  }
  const maximumWidth = Math.max(...bounds.map((item) => item.width));
  const maximumHeight = Math.max(...bounds.map((item) => item.height));
  const scale = Math.min(226 / maximumWidth, 222 / maximumHeight, 1);
  return Promise.all(
    extracted.map(async (buffer, index) => {
      const box = bounds[index];
      const width = Math.max(1, Math.round(box.width * scale));
      const height = Math.max(1, Math.round(box.height * scale));
      const sprite = await sharp(buffer)
        .extract(box)
        .resize(width, height, { fit: "fill", kernel: "lanczos3" })
        .png()
        .toBuffer();
      return sharp({
        create: {
          width: CELL,
          height: CELL,
          channels: 4,
          background: transparent,
        },
      })
        .composite([
          {
            input: sprite,
            left: Math.round(128 - width / 2),
            top: 232 - height,
          },
        ])
        .png()
        .toBuffer();
    }),
  );
}

async function hurtFrame(cell, frameIndex) {
  const strength = [0.58, 0.42, 0.26, 0.12][frameIndex];
  const { data, info } = await sharp(cell)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    data[offset] = Math.round(data[offset] + (255 - data[offset]) * strength);
    data[offset + 1] = Math.round(data[offset + 1] * (1 - strength * 0.55));
    data[offset + 2] = Math.round(data[offset + 2] * (1 - strength * 0.65));
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function deathFrame(cell, frameIndex) {
  const angles = [0, 6, 14, 25, 38, 51, 64, 72];
  const scale = [1, 0.99, 0.97, 0.94, 0.9, 0.86, 0.82, 0.79][frameIndex];
  const size = Math.round(CELL * scale);
  const collapsed = await sharp(cell)
    .rotate(angles[frameIndex], { background: transparent })
    .resize(size, size, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  return sharp({
    create: { width: CELL, height: CELL, channels: 4, background: transparent },
  })
    .composite([
      {
        input: collapsed,
        left: Math.round((CELL - size) / 2),
        top: CELL - size,
      },
    ])
    .png()
    .toBuffer();
}

async function buildActor(actorId) {
  const source = await normalizeSource(
    inputPath("actors", `${actorId}-source.png`),
    "magenta",
  );
  const cells = await normalizedActorCells(source);
  const composites = [];
  for (const [clipName, clip] of Object.entries(CLIPS)) {
    for (const [frameIndex, sourceIndex] of clip.sourceCells.entries()) {
      let input = cells[sourceIndex];
      if (clipName === "hurt") input = await hurtFrame(input, frameIndex);
      if (clipName === "death") input = await deathFrame(input, frameIndex);
      composites.push({
        input,
        left: frameIndex * CELL,
        top: clip.row * CELL,
      });
    }
  }
  const destination = outputPath(`actor-${actorId}.png`);
  await sharp({
    create: {
      width: ACTOR_ATLAS_SIZE,
      height: ACTOR_ATLAS_SIZE,
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

async function buildTerrainAtlas(sourcePath, destination) {
  const normalized = await sharp(sourcePath)
    .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const composites = [];
  for (let index = 0; index < 16; index += 1) {
    const tile = await sharp(normalized)
      .extract({
        left: (index % 4) * CELL + 3,
        top: Math.floor(index / 4) * CELL + 3,
        width: CELL - 6,
        height: CELL - 6,
      })
      .resize(CELL, CELL, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    composites.push({
      input: tile,
      left: (index % 4) * CELL,
      top: Math.floor(index / 4) * CELL,
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
        left: (definition.cell % 4) * CELL,
        top: Math.floor(definition.cell / 4) * CELL,
        width: CELL,
        height: CELL,
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
        left: (cellIndex % 8) * CELL + Math.round((CELL - width) / 2),
        top:
          Math.floor(cellIndex / 8) * CELL + 232 - height - [0, 4, 7, 3][frame],
      });
    }
  }
  const destination = outputPath("loot.png");
  await sharp({
    create: {
      width: ACTOR_ATLAS_SIZE,
      height: ACTOR_ATLAS_SIZE,
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

await fs.mkdir(outputPath("."), { recursive: true });
const outputs = [];
for (const actorId of ACTOR_IDS) outputs.push(await buildActor(actorId));
const terrainPath = await buildTerrainAtlas(
  inputPath("environment", "terrain-source.png"),
  outputPath("environment-terrain.png"),
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
  structuresPath,
  propsPath,
  uiPath,
  effectsPath,
  await buildLootAtlas(propsPath, effectsPath),
);

const manifest = {
  schemaVersion: 1,
  pipeline: "ActorAtlasV1",
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
