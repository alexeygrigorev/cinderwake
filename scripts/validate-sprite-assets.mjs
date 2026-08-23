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
  "environment-floor.png",
  "environment-structures.png",
  "environment-props.png",
  "ui.png",
  "effects.png",
]) {
  const metadata = await sharp(path.join(atlasDirectory, fileName)).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024)
    throw new Error(`${fileName} must be exactly 1024x1024`);
}

function terrainMaterialEvidence(data, width, height) {
  const cellMeans = [];
  for (let cellY = 0; cellY < 4; cellY += 1) {
    for (let cellX = 0; cellX < 4; cellX += 1) {
      const sums = [0, 0, 0];
      let samples = 0;
      for (let y = cellY * 256; y < (cellY + 1) * 256; y += 4) {
        for (let x = cellX * 256; x < (cellX + 1) * 256; x += 4) {
          const offset = (y * width + x) * 3;
          for (let channel = 0; channel < 3; channel += 1)
            sums[channel] += data[offset + channel];
          samples += 1;
        }
      }
      cellMeans.push(sums.map((value) => value / samples));
    }
  }
  const luma = cellMeans.map(
    ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue,
  );
  const redChroma = cellMeans.map(([red, green]) => red - green);
  const blueChroma = cellMeans.map((channels) => channels[2] - channels[1]);
  const range = (values) => Math.max(...values) - Math.min(...values);
  const edgeDifference = (axis, first, second) => {
    let total = 0;
    let samples = 0;
    if (axis === "x") {
      for (let y = 0; y < height; y += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          total += Math.abs(
            data[(y * width + first) * 3 + channel] -
              data[(y * width + second) * 3 + channel],
          );
          samples += 1;
        }
      }
    } else {
      for (let x = 0; x < width; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          total += Math.abs(
            data[(first * width + x) * 3 + channel] -
              data[(second * width + x) * 3 + channel],
          );
          samples += 1;
        }
      }
    }
    return total / samples;
  };
  const internalX = [256, 512, 768].map((x) => edgeDifference("x", x - 1, x));
  const internalY = [256, 512, 768].map((y) => edgeDifference("y", y - 1, y));
  return {
    lumaRange: range(luma),
    redChromaRange: range(redChroma),
    blueChromaRange: range(blueChroma),
    wrapX: edgeDifference("x", 0, width - 1),
    wrapY: edgeDifference("y", 0, height - 1),
    internalXMax: Math.max(...internalX),
    internalYMax: Math.max(...internalY),
  };
}

function terrainMaterialViolations(evidence) {
  const violations = [];
  if (
    evidence.lumaRange > 6 ||
    evidence.redChromaRange > 3 ||
    evidence.blueChromaRange > 3
  )
    violations.push("broad-lighting-gradient");
  if (evidence.wrapX > evidence.internalXMax * 1.5 + 2)
    violations.push("horizontal-wrap-seam");
  if (evidence.wrapY > evidence.internalYMax * 1.5 + 2)
    violations.push("vertical-wrap-seam");
  return violations;
}

const floorPixels = await sharp(
  path.join(atlasDirectory, "environment-floor.png"),
)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const floorEvidence = terrainMaterialEvidence(
  floorPixels.data,
  floorPixels.info.width,
  floorPixels.info.height,
);
const floorViolations = terrainMaterialViolations(floorEvidence);
if (floorViolations.length > 0)
  throw new Error(
    `environment-floor.png material contract failed: ${floorViolations.join(", ")}`,
  );

const gradientMutation = Buffer.from(floorPixels.data);
for (let y = 0; y < floorPixels.info.height; y += 1) {
  for (let x = 0; x < floorPixels.info.width / 2; x += 1) {
    const offset = (y * floorPixels.info.width + x) * 3;
    gradientMutation[offset] = Math.min(255, gradientMutation[offset] + 40);
  }
}
const seamMutation = Buffer.from(floorPixels.data);
for (let y = 0; y < floorPixels.info.height; y += 1) {
  const offset = (y * floorPixels.info.width + floorPixels.info.width - 1) * 3;
  seamMutation.fill(255, offset, offset + 3);
}
const materialNegativeControls = [
  terrainMaterialViolations(
    terrainMaterialEvidence(
      gradientMutation,
      floorPixels.info.width,
      floorPixels.info.height,
    ),
  ).includes("broad-lighting-gradient"),
  terrainMaterialViolations(
    terrainMaterialEvidence(
      seamMutation,
      floorPixels.info.width,
      floorPixels.info.height,
    ),
  ).includes("horizontal-wrap-seam"),
];
if (!materialNegativeControls.every(Boolean))
  throw new Error("Terrain material negative controls were not detected");

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
