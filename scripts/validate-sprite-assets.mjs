import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const atlasDirectory = path.join(root, "public", "assets", "sprites");
const actorIds = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];
const clipFrames = [6, 8, 6, 8, 4, 8];

async function assertCellHasInk(filePath, row, column) {
  const { data } = await sharp(filePath)
    .extract({ left: column * 256, top: row * 256, width: 256, height: 256 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  let edgeInk = 0;
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const alpha = data[(y * 256 + x) * 4 + 3];
      if (alpha < 8) continue;
      ink += 1;
      if (x < 2 || y < 2 || x > 253 || y > 253) edgeInk += 1;
    }
  }
  if (ink < 120)
    throw new Error(`${filePath} row ${row} frame ${column} is blank`);
  if (edgeInk > 0)
    throw new Error(`${filePath} row ${row} frame ${column} crosses its cell`);
}

for (const actorId of actorIds) {
  const filePath = path.join(atlasDirectory, `actor-${actorId}.png`);
  const metadata = await sharp(filePath).metadata();
  if (metadata.width !== 2048 || metadata.height !== 2048)
    throw new Error(`${filePath} must be exactly 2048x2048`);
  for (const [row, frameCount] of clipFrames.entries()) {
    for (let column = 0; column < frameCount; column += 1)
      await assertCellHasInk(filePath, row, column);
  }
}

for (const fileName of [
  "environment-terrain.png",
  "environment-structures.png",
  "environment-props.png",
  "ui.png",
  "effects.png",
]) {
  const metadata = await sharp(path.join(atlasDirectory, fileName)).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024)
    throw new Error(`${fileName} must be exactly 1024x1024`);
}

const lootMetadata = await sharp(
  path.join(atlasDirectory, "loot.png"),
).metadata();
if (lootMetadata.width !== 2048 || lootMetadata.height !== 2048)
  throw new Error("loot.png must be exactly 2048x2048");

await fs.access(path.join(atlasDirectory, "build-manifest.json"));
console.log("Sprite asset dimensions, cells, padding, and manifest are valid.");
