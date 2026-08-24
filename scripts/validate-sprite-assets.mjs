import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const root = process.cwd();
const atlasDirectory = path.join(root, "public", "assets", "sprites");
const specPath = path.join(root, "art", "actor-atlas-v1.json");
const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
const environmentKitSpecPath = path.join(
  root,
  "art",
  "environment-kit-v2.json",
);
const environmentKitSpec = JSON.parse(
  await fs.readFile(environmentKitSpecPath, "utf8"),
);
const executeFile = promisify(execFile);
const expectedEnvironmentKit = {
  sha256: "2af4efd5dad1a3b0472c7360b53851f6d329ac6254aa59024f3191a06da00210",
  auditCommit: "7b4b55725c2726042aa57fd9d570d5a60655e850",
  width: 1536,
  height: 1024,
  cellSize: 512,
  ids: [
    "scenery:architecture:north-wall-solid",
    "scenery:structure:forge-workshop",
    "scenery:prop:lantern-a",
    "scenery:prop:lantern-b",
    "scenery:prop:barricade-v2",
    "scenery:prop:raised-clutter-bench",
  ],
  logicalHeights: [172, 195, 118, 118, 88, 103],
  bottomContacts: [446, 446, 447, 446, 448, 445],
};
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
  "environment-decals.png",
  "ui.png",
  "effects.png",
]) {
  const metadata = await sharp(path.join(atlasDirectory, fileName)).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024)
    throw new Error(`${fileName} must be exactly 1024x1024`);
}

const uiComponentContracts = {
  "ui-service-panel.png": {
    sourceRect: { left: 431, top: 534, width: 294, height: 198 },
  },
  "ui-service-button.png": {
    sourceRect: { left: 583, top: 95, width: 197, height: 82 },
  },
};
for (const [fileName, { sourceRect }] of Object.entries(uiComponentContracts)) {
  const componentPath = path.join(atlasDirectory, fileName);
  const metadata = await sharp(componentPath).metadata();
  if (
    metadata.width !== sourceRect.width ||
    metadata.height !== sourceRect.height
  )
    throw new Error(
      `${fileName} must be the declared ${sourceRect.width}x${sourceRect.height} tight UI crop`,
    );
  const [componentPixels, sourcePixels] = await Promise.all([
    sharp(componentPath).ensureAlpha().raw().toBuffer(),
    sharp(path.join(atlasDirectory, "ui.png"))
      .extract(sourceRect)
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);
  if (!componentPixels.equals(sourcePixels))
    throw new Error(`${fileName} pixels differ from its declared ui.png crop`);
}

const decalPath = path.join(atlasDirectory, "environment-decals.png");
for (let cellIndex = 0; cellIndex < 16; cellIndex += 1) {
  const cellSize = 256;
  const { data } = await sharp(decalPath)
    .extract({
      left: (cellIndex % 4) * cellSize,
      top: Math.floor(cellIndex / 4) * cellSize,
      width: cellSize,
      height: cellSize,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  let transparent = 0;
  let edgeInk = 0;
  for (let y = 0; y < cellSize; y += 1) {
    for (let x = 0; x < cellSize; x += 1) {
      const alpha = data[(y * cellSize + x) * 4 + 3];
      if (alpha >= 8) {
        ink += 1;
        if (x < 6 || y < 6 || x >= cellSize - 6 || y >= cellSize - 6)
          edgeInk += 1;
      } else transparent += 1;
    }
  }
  if (ink < 1_200)
    throw new Error(`environment-decals.png cell ${cellIndex} is blank`);
  if (transparent / (cellSize * cellSize) < 0.35)
    throw new Error(
      `environment-decals.png cell ${cellIndex} retained a background field`,
    );
  if (edgeInk > 0)
    throw new Error(
      `environment-decals.png cell ${cellIndex} crosses its safe cell boundary`,
    );
}

async function validateEnvironmentKitRaster(filePath, label) {
  const file = await fs.readFile(filePath);
  const fileHash = sha256(file);
  if (fileHash !== expectedEnvironmentKit.sha256)
    throw new Error(
      `${label} hash ${fileHash} differs from the independently approved bytes`,
    );
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== expectedEnvironmentKit.width ||
    info.height !== expectedEnvironmentKit.height ||
    info.channels !== 4
  )
    throw new Error(
      `${label} must decode exactly as ${expectedEnvironmentKit.width}x${expectedEnvironmentKit.height} RGBA`,
    );

  const hashes = [];
  for (const [index, definition] of environmentKitSpec.cells.entries()) {
    if (definition.index !== index)
      throw new Error(`Environment-kit cell ${index} has an unstable index`);
    if (definition.id !== expectedEnvironmentKit.ids[index])
      throw new Error(`Environment-kit cell ${index} semantic ID drifted`);
    if (
      definition.cell.x !==
        (index % environmentKitSpec.source.columns) *
          expectedEnvironmentKit.cellSize ||
      definition.cell.y !==
        Math.floor(index / environmentKitSpec.source.columns) *
          expectedEnvironmentKit.cellSize ||
      definition.cell.width !== expectedEnvironmentKit.cellSize ||
      definition.cell.height !== expectedEnvironmentKit.cellSize
    )
      throw new Error(
        `Environment-kit cell ${index} is not a fixed 512px cell`,
      );

    const cell = Buffer.alloc(
      expectedEnvironmentKit.cellSize * expectedEnvironmentKit.cellSize * 4,
    );
    let ink = 0;
    let minX = expectedEnvironmentKit.cellSize;
    let minY = expectedEnvironmentKit.cellSize;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < expectedEnvironmentKit.cellSize; y += 1) {
      const sourceOffset =
        ((definition.cell.y + y) * info.width + definition.cell.x) * 4;
      data.copy(
        cell,
        y * expectedEnvironmentKit.cellSize * 4,
        sourceOffset,
        sourceOffset + expectedEnvironmentKit.cellSize * 4,
      );
      for (let x = 0; x < expectedEnvironmentKit.cellSize; x += 1) {
        const offset = sourceOffset + x * 4;
        const alpha = data[offset + 3];
        const inBorder =
          x < 62 ||
          y < 62 ||
          x >= expectedEnvironmentKit.cellSize - 62 ||
          y >= expectedEnvironmentKit.cellSize - 62;
        if (inBorder && alpha !== 0)
          throw new Error(
            `${label} cell ${index} has nontransparent safe-border pixels`,
          );
        if (
          alpha === 0 &&
          (data[offset] || data[offset + 1] || data[offset + 2])
        )
          throw new Error(
            `${label} cell ${index} retains RGB contamination under transparency`,
          );
        if (alpha < 8) continue;
        ink += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (ink < 1_200) throw new Error(`${label} cell ${index} is blank`);
    const measuredInk = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
    if (JSON.stringify(measuredInk) !== JSON.stringify(definition.ink))
      throw new Error(`${label} cell ${index} tight ink bounds drifted`);
    if (maxY !== expectedEnvironmentKit.bottomContacts[index])
      throw new Error(`${label} cell ${index} bottom anchor drifted`);
    if (
      definition.logicalSize.height !==
      expectedEnvironmentKit.logicalHeights[index]
    )
      throw new Error(`Environment-kit cell ${index} logical height drifted`);
    const aspectWidth = Math.round(
      (definition.ink.width / definition.ink.height) *
        definition.logicalSize.height,
    );
    if (definition.logicalSize.width !== aspectWidth)
      throw new Error(
        `Environment-kit cell ${index} logical dimensions square-stretch its tight ink`,
      );
    if (
      definition.anchor.mode !== "bottom-center" ||
      definition.anchor.x !== definition.logicalSize.width / 2 ||
      definition.anchor.y !== definition.logicalSize.height
    )
      throw new Error(
        `Environment-kit cell ${index} does not use a bottom-center logical anchor`,
      );
    hashes.push(sha256(cell));
  }
  if (hashes.length !== 6 || new Set(hashes).size !== 6)
    throw new Error(`${label} must contain six nonblank unique source cells`);
  return file;
}

if (
  environmentKitSpec.source.sha256 !== expectedEnvironmentKit.sha256 ||
  environmentKitSpec.source.pixelWidth !== expectedEnvironmentKit.width ||
  environmentKitSpec.source.pixelHeight !== expectedEnvironmentKit.height ||
  environmentKitSpec.source.cellWidth !== expectedEnvironmentKit.cellSize ||
  environmentKitSpec.source.cellHeight !== expectedEnvironmentKit.cellSize ||
  environmentKitSpec.source.columns !== 3 ||
  environmentKitSpec.source.rows !== 2 ||
  environmentKitSpec.provenance.auditCommit !==
    expectedEnvironmentKit.auditCommit ||
  environmentKitSpec.cells.length !== 6
)
  throw new Error("Environment-kit production contract differs from its audit");

const productionEnvironmentKit = await validateEnvironmentKitRaster(
  path.join(root, environmentKitSpec.source.file),
  "environment-kit-v2 production source",
);
const preparedEnvironmentKit = await validateEnvironmentKitRaster(
  path.join(root, environmentKitSpec.provenance.preparedFile),
  "environment-kit-v2 approved prepared source",
);
const publicEnvironmentKit = await validateEnvironmentKitRaster(
  path.join(atlasDirectory, environmentKitSpec.atlas.file),
  "environment-kit-v2 public atlas",
);
if (
  !productionEnvironmentKit.equals(preparedEnvironmentKit) ||
  !productionEnvironmentKit.equals(publicEnvironmentKit)
)
  throw new Error(
    "Environment-kit production source, prepared ingress, and public atlas are not byte-identical",
  );

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
if (
  manifest.environmentKitSpec?.sha256 !==
  sha256(await fs.readFile(environmentKitSpecPath))
)
  throw new Error("Build manifest environment-kit metadata hash is stale");
if (
  manifest.environmentKitSpec.productionSource.file !==
    environmentKitSpec.source.file ||
  manifest.environmentKitSpec.productionSource.sha256 !==
    expectedEnvironmentKit.sha256 ||
  manifest.environmentKitSpec.preparedSource !==
    environmentKitSpec.provenance.preparedFile ||
  manifest.environmentKitSpec.auditCommit !== expectedEnvironmentKit.auditCommit
)
  throw new Error("Build manifest environment-kit provenance drifted");
if (!manifest.outputs[environmentKitSpec.atlas.file])
  throw new Error("Build manifest omits environment-kit-v2.png");
for (const [fileName, evidence] of Object.entries(manifest.outputs)) {
  const file = await fs.readFile(path.join(atlasDirectory, fileName));
  if (evidence.sha256 !== sha256(file))
    throw new Error(`Build manifest hash is stale for ${fileName}`);
}

const deterministicBuildDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-environment-kit-build-"),
);
try {
  const buildArguments = [
    path.join(root, "scripts", "build-sprite-assets.mjs"),
    "--environment-kit-only",
    "--output-dir",
    deterministicBuildDirectory,
  ];
  const buildOnce = async () => {
    const { stderr } = await executeFile(process.execPath, buildArguments, {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stderr.trim())
      throw new Error(`Environment-kit isolated build wrote stderr: ${stderr}`);
    return {
      atlas: await fs.readFile(
        path.join(deterministicBuildDirectory, environmentKitSpec.atlas.file),
      ),
      manifest: await fs.readFile(
        path.join(deterministicBuildDirectory, "build-manifest.json"),
      ),
    };
  };
  const first = await buildOnce();
  const second = await buildOnce();
  if (
    !first.atlas.equals(second.atlas) ||
    !first.manifest.equals(second.manifest)
  )
    throw new Error("Environment-kit isolated rebuild is nondeterministic");
  if (!first.atlas.equals(publicEnvironmentKit))
    throw new Error(
      "Environment-kit isolated rebuild differs from the committed public atlas",
    );
} finally {
  await fs.rm(deterministicBuildDirectory, { recursive: true, force: true });
}

console.log(
  `${spec.id} and environment-kit-v2 source sheets, runtime cadence, cells, anchors, safe bounds, dimensions, hashes, provenance, and deterministic rebuilds are valid.`,
);
