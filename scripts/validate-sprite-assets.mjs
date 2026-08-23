import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const atlasDirectory = path.join(root, "public", "assets", "sprites");
const specPath = path.join(root, "art", "actor-atlas-v1.json");
const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
const actorIds = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function declaredConstants(source, name) {
  const body = source.match(
    new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`),
  )?.[1];
  if (!body) throw new Error(`Unable to parse ${name} from game constants`);
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\s*(\d+)/g)].map((match) => [
      match[1],
      Number(match[2]),
    ]),
  );
}

const constantsSource = await fs.readFile(
  path.join(root, "src", "game", "constants.ts"),
  "utf8",
);
const runtimeFrames = declaredConstants(constantsSource, "CLIP_FRAMES");
const runtimeDurations = declaredConstants(constantsSource, "CLIP_DURATIONS");

for (const [clipName, clip] of Object.entries(spec.clips)) {
  if (clip.frameCount !== clip.sourceFrames.length)
    throw new Error(`${clipName} frameCount differs from sourceFrames`);
  if (runtimeFrames[clipName] !== clip.frameCount)
    throw new Error(`${clipName} runtime frame count drifted from ${spec.id}`);
  if (runtimeDurations[clipName] !== clip.durationTicks)
    throw new Error(`${clipName} runtime duration drifted from ${spec.id}`);
}

async function cellEvidence(filePath, row, column) {
  const cell = spec.atlas.cellWidth;
  const { data } = await sharp(filePath)
    .extract({
      left: column * cell,
      top: row * cell,
      width: cell,
      height: cell,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  let minX = cell;
  let minY = cell;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const alpha = data[(y * cell + x) * 4 + 3];
      if (alpha < 8) continue;
      ink += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (ink < 120)
    throw new Error(`${filePath} row ${row} frame ${column} is blank`);
  const safe = spec.atlas.safeInkBounds;
  if (
    minX < safe.x ||
    minY < safe.y ||
    maxX >= safe.x + safe.width ||
    maxY >= safe.y + safe.height
  )
    throw new Error(
      `${filePath} row ${row} frame ${column} leaves safeInkBounds`,
    );
  if (maxY !== spec.atlas.footAnchor.y - 1)
    throw new Error(
      `${filePath} row ${row} frame ${column} is not grounded at the declared anchor`,
    );
  return sha256(data);
}

const banks = [
  ...Object.entries(spec.clips),
  ...Object.entries(spec.directionalClips),
];
for (const actorId of actorIds) {
  for (const pattern of Object.values(spec.source.files))
    await fs.access(
      path.join(
        root,
        "art",
        "source",
        "actors",
        pattern.replace("{actor}", actorId),
      ),
    );
  const filePath = path.join(atlasDirectory, `actor-${actorId}.png`);
  const metadata = await sharp(filePath).metadata();
  if (
    metadata.width !== spec.atlas.pixelWidth ||
    metadata.height !== spec.atlas.pixelHeight
  )
    throw new Error(
      `${filePath} must be exactly ${spec.atlas.pixelWidth}x${spec.atlas.pixelHeight}`,
    );
  for (const [bankName, bank] of banks) {
    const hashes = [];
    for (let column = 0; column < bank.sourceFrames.length; column += 1)
      hashes.push(await cellEvidence(filePath, bank.atlasRow, column));
    if (new Set(hashes).size < Math.min(2, hashes.length))
      throw new Error(`${filePath} bank ${bankName} has no visual motion`);
  }
}

for (const fileName of [
  "environment-terrain.png",
  "environment-ground.png",
  "environment-structures.png",
  "environment-props.png",
  "ui.png",
  "effects.png",
]) {
  const metadata = await sharp(path.join(atlasDirectory, fileName)).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024)
    throw new Error(`${fileName} must be exactly 1024x1024`);
}

const fixedDimensions = {
  "loot.png": [2048, 2048],
  "glyphs.png": [1024, 512],
};
for (const [fileName, [width, height]] of Object.entries(fixedDimensions)) {
  const metadata = await sharp(path.join(atlasDirectory, fileName)).metadata();
  if (metadata.width !== width || metadata.height !== height)
    throw new Error(`${fileName} must be exactly ${width}x${height}`);
}

const manifest = JSON.parse(
  await fs.readFile(path.join(atlasDirectory, "build-manifest.json"), "utf8"),
);
if (manifest.pipeline !== spec.id)
  throw new Error("Build manifest pipeline differs from actor metadata");
if (manifest.actorSpec.sha256 !== sha256(await fs.readFile(specPath)))
  throw new Error("Build manifest actor metadata hash is stale");
for (const [fileName, evidence] of Object.entries(manifest.outputs)) {
  const file = await fs.readFile(path.join(atlasDirectory, fileName));
  if (evidence.sha256 !== sha256(file))
    throw new Error(`Build manifest hash is stale for ${fileName}`);
}

console.log(
  `${spec.id} source sheets, runtime cadence, cells, anchors, safe bounds, dimensions, and hashes are valid.`,
);
