import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const root = process.cwd();
const atlasRoot = path.join(root, "public", "assets", "sprites");
const floorPath = path.join(atlasRoot, "environment-floor.png");
const decalPath = path.join(atlasRoot, "environment-decals.png");
const defaultOutput = path.join(
  root,
  "quality-results",
  "environment-composition",
);
const defaultScreenRoot = path.join(
  root,
  "tests",
  "e2e",
  "screen-contract.spec.ts-snapshots",
);

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 720;
const FLOOR_ATLAS_GRID = 16;
const FLOOR_SOURCE_CELL = 64;
const DECAL_ATLAS_GRID = 4;
const DECAL_SOURCE_CELL = 256;
const DECAL_ALPHA_THRESHOLD = 8;
const DECAL_SAFE_BORDER = 8;
const FLOOR_EDGE_BAND = 3;

// These thresholds are defect tripwires, not an aesthetic score. They are
// deliberately kept beside the measurements and serialized into the report.
const THRESHOLDS = Object.freeze({
  decalMaximumBoundingBoxFillRatio: 0.75,
  decalMaximumSafeBorderInkPixels: 0,
  floorMaximumEdgeBandToCoreRatio: 1.25,
  floorMaximumBoundaryToInteriorRatio: 1.35,
  floorMaximumRepeatedTileFraction: 0.25,
  screenMaximumCoarseOrthogonalEdgeShare: 0.385,
  screenMaximumMeanCoarseOrthogonalEdgeShare: 0.365,
});

const GAME_SCREEN_NAMES = [
  "desktop-game-chromium-linux.png",
  "narrow-desktop-game-chromium-linux.png",
  "phone-landscape-game-chromium-linux.png",
  "phone-portrait-game-chromium-linux.png",
];

const DECAL_NAMES = [
  "scorch-ring",
  "blood-smear",
  "bone-pile",
  "occult-circle",
  "chain-coil",
  "broken-boards",
  "grave-rubble",
  "burnt-roots",
  "melted-candles",
  "dead-bramble",
  "discarded-armor",
  "cracked-embers",
  "banner-scrap",
  "saint-fragments",
  "claw-tracks",
  "grave-flowers",
];

const DECAL_RENDER_SIZES = DECAL_NAMES.map((name) =>
  ["blood-smear", "occult-circle", "claw-tracks"].includes(name)
    ? 108
    : ["scorch-ring", "broken-boards", "dead-bramble"].includes(name)
      ? 96
      : 78,
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, portion) {
  const ordered = [...values].sort((first, second) => first - second);
  return ordered[Math.floor((ordered.length - 1) * portion)];
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function copyRawRect(
  source,
  sourceWidth,
  target,
  targetWidth,
  targetX,
  targetY,
  width,
  height,
) {
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * sourceWidth * 4;
    const targetStart = ((targetY + y) * targetWidth + targetX) * 4;
    source.copy(target, targetStart, sourceStart, sourceStart + width * 4);
  }
}

async function readRuntimeTilePixels() {
  const constants = await fs.readFile(
    path.join(root, "src", "game", "constants.ts"),
    "utf8",
  );
  const value = Number(
    constants.match(/export const TILE_PIXELS\s*=\s*(\d+)/)?.[1],
  );
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Unable to read TILE_PIXELS from game constants");
  const manifest = await fs.readFile(
    path.join(root, "src", "render", "manifest.ts"),
    "utf8",
  );
  if (!manifest.includes("(y % 16) * 16 + (x % 16)"))
    throw new Error(
      "Floor atlas selection changed; update the composition assessor with the renderer",
    );
  return value;
}

function decalCellEvidence(atlas, atlasWidth, cellIndex) {
  const cellX = (cellIndex % DECAL_ATLAS_GRID) * DECAL_SOURCE_CELL;
  const cellY = Math.floor(cellIndex / DECAL_ATLAS_GRID) * DECAL_SOURCE_CELL;
  let inkPixels = 0;
  let safeBorderInkPixels = 0;
  let minimumX = DECAL_SOURCE_CELL;
  let minimumY = DECAL_SOURCE_CELL;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < DECAL_SOURCE_CELL; y += 1) {
    for (let x = 0; x < DECAL_SOURCE_CELL; x += 1) {
      const alpha = atlas[((cellY + y) * atlasWidth + cellX + x) * 4 + 3];
      if (alpha < DECAL_ALPHA_THRESHOLD) continue;
      inkPixels += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      if (
        x < DECAL_SAFE_BORDER ||
        y < DECAL_SAFE_BORDER ||
        x >= DECAL_SOURCE_CELL - DECAL_SAFE_BORDER ||
        y >= DECAL_SOURCE_CELL - DECAL_SAFE_BORDER
      )
        safeBorderInkPixels += 1;
    }
  }
  if (inkPixels === 0)
    return {
      index: cellIndex,
      name: DECAL_NAMES[cellIndex],
      inkPixels,
      safeBorderInkPixels,
      boundingBox: null,
      boundingBoxFillRatio: 0,
      violations: ["blank-decal"],
    };
  const boundingBox = {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX + 1,
    height: maximumY - minimumY + 1,
  };
  const boundingBoxFillRatio =
    inkPixels / (boundingBox.width * boundingBox.height);
  const violations = [];
  if (boundingBoxFillRatio > THRESHOLDS.decalMaximumBoundingBoxFillRatio)
    violations.push("opaque-rectangular-matte");
  if (safeBorderInkPixels > THRESHOLDS.decalMaximumSafeBorderInkPixels)
    violations.push("cross-cell-boundary-ink");
  return {
    index: cellIndex,
    name: DECAL_NAMES[cellIndex],
    inkPixels,
    safeBorderInkPixels,
    boundingBox,
    boundingBoxFillRatio: rounded(boundingBoxFillRatio),
    violations,
  };
}

function assessDecalAtlas(atlas, atlasWidth) {
  const cells = Array.from({ length: DECAL_ATLAS_GRID ** 2 }, (_, index) =>
    decalCellEvidence(atlas, atlasWidth, index),
  );
  return {
    pass: cells.every(({ violations }) => violations.length === 0),
    maximumBoundingBoxFillRatio: Math.max(
      ...cells.map(({ boundingBoxFillRatio }) => boundingBoxFillRatio),
    ),
    safeBorderInkPixels: cells.reduce(
      (sum, cell) => sum + cell.safeBorderInkPixels,
      0,
    ),
    cells,
    violations: [...new Set(cells.flatMap(({ violations }) => violations))],
  };
}

async function resizedFloorCell(floorPathname, sourceX, sourceY, tilePixels) {
  return sharp(floorPathname)
    .extract({
      left: sourceX * FLOOR_SOURCE_CELL,
      top: sourceY * FLOOR_SOURCE_CELL,
      width: FLOOR_SOURCE_CELL,
      height: FLOOR_SOURCE_CELL,
    })
    .resize(tilePixels, tilePixels, { kernel: "cubic" })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function composeFloor(tilePixels, repeatSingleTile = false) {
  const columns = Math.ceil(VIEW_WIDTH / tilePixels);
  const rows = Math.ceil(VIEW_HEIGHT / tilePixels);
  const width = columns * tilePixels;
  const height = rows * tilePixels;
  const pixels = Buffer.alloc(width * height * 4);
  const cellCache = new Map();
  const tileHashes = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const sourceX = repeatSingleTile ? 0 : x % FLOOR_ATLAS_GRID;
      const sourceY = repeatSingleTile ? 0 : y % FLOOR_ATLAS_GRID;
      const key = `${sourceX}:${sourceY}`;
      let cell = cellCache.get(key);
      if (!cell) {
        cell = await resizedFloorCell(floorPath, sourceX, sourceY, tilePixels);
        cellCache.set(key, cell);
      }
      copyRawRect(
        cell,
        tilePixels,
        pixels,
        width,
        x * tilePixels,
        y * tilePixels,
        tilePixels,
        tilePixels,
      );
      tileHashes.push(sha256(cell));
    }
  }
  return { pixels, width, height, columns, rows, tileHashes };
}

function lineEnergies(pixels, width, height, tilePixels) {
  const luma = (x, y) => {
    const offset = (y * width + x) * 4;
    return (
      pixels[offset] * 0.2126 +
      pixels[offset + 1] * 0.7152 +
      pixels[offset + 2] * 0.0722
    );
  };
  const boundary = [];
  const interior = [];
  const edgeBand = [];
  const core = [];
  for (let x = 1; x < width; x += 1) {
    let energy = 0;
    for (let y = 0; y < height; y += 1)
      energy += Math.abs(luma(x, y) - luma(x - 1, y));
    energy /= height;
    const remainder = x % tilePixels;
    const distance = Math.min(remainder, tilePixels - remainder);
    (remainder === 0 ? boundary : interior).push(energy);
    (distance <= FLOOR_EDGE_BAND ? edgeBand : core).push(energy);
  }
  for (let y = 1; y < height; y += 1) {
    let energy = 0;
    for (let x = 0; x < width; x += 1)
      energy += Math.abs(luma(x, y) - luma(x, y - 1));
    energy /= width;
    const remainder = y % tilePixels;
    const distance = Math.min(remainder, tilePixels - remainder);
    (remainder === 0 ? boundary : interior).push(energy);
    (distance <= FLOOR_EDGE_BAND ? edgeBand : core).push(energy);
  }
  return { boundary, interior, edgeBand, core };
}

function assessFloorComposition(composition, tilePixels) {
  const energies = lineEnergies(
    composition.pixels,
    composition.width,
    composition.height,
    tilePixels,
  );
  const counts = new Map();
  for (const hash of composition.tileHashes)
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  const repeatedTileFraction =
    [...counts.values()].reduce((sum, count) => sum + count - 1, 0) /
    composition.tileHashes.length;
  const boundaryToInteriorRatio =
    mean(energies.boundary) / mean(energies.interior);
  const edgeBandToCoreRatio = mean(energies.edgeBand) / mean(energies.core);
  const violations = [];
  if (boundaryToInteriorRatio > THRESHOLDS.floorMaximumBoundaryToInteriorRatio)
    violations.push("square-floor-seams");
  if (edgeBandToCoreRatio > THRESHOLDS.floorMaximumEdgeBandToCoreRatio)
    violations.push("tile-edge-band-prominence");
  if (repeatedTileFraction > THRESHOLDS.floorMaximumRepeatedTileFraction)
    violations.push("obvious-repeated-floor-tiles");
  return {
    pass: violations.length === 0,
    dimensions: {
      width: composition.width,
      height: composition.height,
      columns: composition.columns,
      rows: composition.rows,
      tilePixels,
    },
    boundaryMeanLumaDelta: rounded(mean(energies.boundary)),
    interiorMeanLumaDelta: rounded(mean(energies.interior)),
    boundaryToInteriorRatio: rounded(boundaryToInteriorRatio),
    edgeBandMeanLumaDelta: rounded(mean(energies.edgeBand)),
    coreMeanLumaDelta: rounded(mean(energies.core)),
    edgeBandToCoreRatio: rounded(edgeBandToCoreRatio),
    boundaryP95LumaDelta: rounded(percentile(energies.boundary, 0.95)),
    distinctTilePixels: counts.size,
    repeatedTileFraction: rounded(repeatedTileFraction),
    maximumIdenticalTileUses: Math.max(...counts.values()),
    violations,
  };
}

function opaqueMatteMutation(atlas, atlasWidth) {
  const mutated = Buffer.from(atlas);
  const cell = decalCellEvidence(mutated, atlasWidth, 0);
  for (
    let y = cell.boundingBox.y;
    y < cell.boundingBox.y + cell.boundingBox.height;
    y += 1
  ) {
    for (
      let x = cell.boundingBox.x;
      x < cell.boundingBox.x + cell.boundingBox.width;
      x += 1
    ) {
      const offset = (y * atlasWidth + x) * 4;
      // Preserve the committed RGB matte hidden below transparent pixels and
      // change alpha only. This simulates a failed background-removal step.
      mutated[offset + 3] = 255;
    }
  }
  return mutated;
}

function crossCellMutation(atlas, atlasWidth) {
  const mutated = Buffer.from(atlas);
  const cellIndex = 5;
  const source = Buffer.alloc(DECAL_SOURCE_CELL ** 2 * 4);
  const originX = (cellIndex % DECAL_ATLAS_GRID) * DECAL_SOURCE_CELL;
  const originY = Math.floor(cellIndex / DECAL_ATLAS_GRID) * DECAL_SOURCE_CELL;
  for (let y = 0; y < DECAL_SOURCE_CELL; y += 1) {
    const start = ((originY + y) * atlasWidth + originX) * 4;
    mutated.copy(
      source,
      y * DECAL_SOURCE_CELL * 4,
      start,
      start + DECAL_SOURCE_CELL * 4,
    );
    mutated.fill(0, start, start + DECAL_SOURCE_CELL * 4);
  }
  const evidence = decalCellEvidence(atlas, atlasWidth, cellIndex);
  const shift = evidence.boundingBox.x + 10;
  for (let y = 0; y < DECAL_SOURCE_CELL; y += 1) {
    for (let x = 0; x < DECAL_SOURCE_CELL; x += 1) {
      const targetX = originX + x - shift;
      if (targetX < 0 || targetX >= atlasWidth) continue;
      const sourceOffset = (y * DECAL_SOURCE_CELL + x) * 4;
      const targetOffset = ((originY + y) * atlasWidth + targetX) * 4;
      source.copy(mutated, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return mutated;
}

function squareSeamMutation(composition, tilePixels) {
  const mutated = {
    ...composition,
    pixels: Buffer.from(composition.pixels),
    tileHashes: [...composition.tileHashes],
  };
  for (let y = 0; y < mutated.height; y += 1) {
    for (let x = 0; x < mutated.width; x += 1) {
      if (x % tilePixels < tilePixels - 2 && y % tilePixels < tilePixels - 2)
        continue;
      const offset = (y * mutated.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1)
        mutated.pixels[offset + channel] = Math.round(
          mutated.pixels[offset + channel] * 0.25,
        );
    }
  }
  return mutated;
}

async function screenGridEvidence(pixels, info) {
  const blurred = await sharp(pixels, { raw: info })
    .grayscale()
    .blur(4)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gradients = [];
  for (let y = 4; y < blurred.info.height - 4; y += 2) {
    for (let x = 4; x < blurred.info.width - 4; x += 2) {
      const horizontal =
        blurred.data[y * blurred.info.width + x + 2] -
        blurred.data[y * blurred.info.width + x - 2];
      const vertical =
        blurred.data[(y + 2) * blurred.info.width + x] -
        blurred.data[(y - 2) * blurred.info.width + x];
      gradients.push({
        horizontal,
        vertical,
        magnitude: Math.hypot(horizontal, vertical),
      });
    }
  }
  const strongThreshold = percentile(
    gradients.map(({ magnitude }) => magnitude),
    0.75,
  );
  let coarseOrthogonalEnergy = 0;
  let strongEnergy = 0;
  for (const gradient of gradients) {
    if (gradient.magnitude < strongThreshold || gradient.magnitude <= 0.5)
      continue;
    const angle =
      (Math.atan2(Math.abs(gradient.vertical), Math.abs(gradient.horizontal)) *
        180) /
      Math.PI;
    strongEnergy += gradient.magnitude;
    if (angle <= 15 || angle >= 75)
      coarseOrthogonalEnergy += gradient.magnitude;
  }
  return {
    coarseOrthogonalEdgeShare: rounded(coarseOrthogonalEnergy / strongEnergy),
    strongGradientThreshold: rounded(strongThreshold),
    sampleCount: gradients.length,
  };
}

async function assessGameScreens(screenRoot) {
  const profiles = [];
  for (const fileName of GAME_SCREEN_NAMES) {
    const filePath = path.join(screenRoot, fileName);
    const bytes = await fs.readFile(filePath);
    const decoded = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    profiles.push({
      fileName,
      sha256: sha256(bytes),
      dimensions: {
        width: decoded.info.width,
        height: decoded.info.height,
      },
      ...(await screenGridEvidence(decoded.data, decoded.info)),
    });
  }
  const edgeShares = profiles.map(
    ({ coarseOrthogonalEdgeShare }) => coarseOrthogonalEdgeShare,
  );
  const meanCoarseOrthogonalEdgeShare = rounded(mean(edgeShares));
  const maximumCoarseOrthogonalEdgeShare = Math.max(...edgeShares);
  const violations = [];
  if (
    maximumCoarseOrthogonalEdgeShare >
    THRESHOLDS.screenMaximumCoarseOrthogonalEdgeShare
  )
    violations.push("screen-square-grid-salience");
  if (
    meanCoarseOrthogonalEdgeShare >
    THRESHOLDS.screenMaximumMeanCoarseOrthogonalEdgeShare
  )
    violations.push("screen-orthogonal-edge-mean");
  return {
    pass: violations.length === 0,
    meanCoarseOrthogonalEdgeShare,
    maximumCoarseOrthogonalEdgeShare,
    profiles,
    violations,
  };
}

function squareGridScreenMutation(pixels, info) {
  const mutated = Buffer.from(pixels);
  const scale = Math.max(info.width / VIEW_WIDTH, info.height / VIEW_HEIGHT);
  const period = 48 * scale;
  const thickness = Math.max(5, Math.round(period * 0.07));
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (x % period < period - thickness && y % period < period - thickness)
        continue;
      const offset = (y * info.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1)
        mutated[offset + channel] = Math.round(mutated[offset + channel] * 0.1);
    }
  }
  return mutated;
}

async function screenContactSheet(screenRoot) {
  const cells = [];
  for (const [index, fileName] of GAME_SCREEN_NAMES.entries()) {
    const image = await sharp(path.join(screenRoot, fileName))
      .resize(480, 300, {
        fit: "contain",
        background: { r: 5, g: 8, b: 9, alpha: 1 },
      })
      .png()
      .toBuffer();
    cells.push({
      input: image,
      left: (index % 2) * 480,
      top: Math.floor(index / 2) * 300,
    });
  }
  return sharp({
    create: {
      width: 960,
      height: 600,
      channels: 4,
      background: { r: 5, g: 8, b: 9, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

async function pngBuffer(raw, width, height) {
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function decalComposition(floor, decalAtlas) {
  const base = await pngBuffer(floor.pixels, floor.width, floor.height);
  const overlays = [];
  for (let index = 0; index < DECAL_NAMES.length; index += 1) {
    const size = DECAL_RENDER_SIZES[index];
    const cell = await sharp(decalAtlas, {
      raw: { width: 1024, height: 1024, channels: 4 },
    })
      .extract({
        left: (index % 4) * DECAL_SOURCE_CELL,
        top: Math.floor(index / 4) * DECAL_SOURCE_CELL,
        width: DECAL_SOURCE_CELL,
        height: DECAL_SOURCE_CELL,
      })
      .resize(size, size, { kernel: "cubic" })
      .png()
      .toBuffer();
    const centerX = 120 + (index % 4) * 240;
    const centerY = 90 + Math.floor(index / 4) * 178;
    overlays.push({
      input: cell,
      left: Math.round(centerX - size / 2),
      top: Math.round(centerY - size / 2),
    });
  }
  return sharp(base).composite(overlays).png().toBuffer();
}

async function decalMutationPreview(floor, decalAtlas, cellIndex, size = 150) {
  const floorCrop = await sharp(
    await pngBuffer(floor.pixels, floor.width, floor.height),
  )
    .extract({ left: 0, top: 0, width: 360, height: 240 })
    .png()
    .toBuffer();
  const cell = await sharp(decalAtlas, {
    raw: { width: 1024, height: 1024, channels: 4 },
  })
    .extract({
      left: (cellIndex % 4) * DECAL_SOURCE_CELL,
      top: Math.floor(cellIndex / 4) * DECAL_SOURCE_CELL,
      width: DECAL_SOURCE_CELL,
      height: DECAL_SOURCE_CELL,
    })
    .resize(size, size, { kernel: "cubic" })
    .png()
    .toBuffer();
  return sharp(floorCrop)
    .composite([{ input: cell, left: 105, top: 45 }])
    .png()
    .toBuffer();
}

async function alphaEvidence(decalAtlas) {
  const alpha = Buffer.alloc(1024 * 1024 * 4);
  for (let index = 0; index < 1024 * 1024; index += 1) {
    const sourceAlpha = decalAtlas[index * 4 + 3];
    alpha[index * 4] = sourceAlpha;
    alpha[index * 4 + 1] = sourceAlpha;
    alpha[index * 4 + 2] = sourceAlpha;
    alpha[index * 4 + 3] = 255;
  }
  return pngBuffer(alpha, 1024, 1024);
}

async function writeArtifact(outputRoot, name, bytes, artifacts) {
  const target = path.join(outputRoot, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  artifacts[name] = { sha256: sha256(bytes), bytes: bytes.length };
}

function renderHtml(report) {
  const controls = report.negativeControls
    .map(
      (control) =>
        `<tr><td><code>${escapeHtml(control.id)}</code></td><td>${control.detected ? "caught" : "MISSED"}</td><td>${escapeHtml(control.violations.join(", "))}</td></tr>`,
    )
    .join("");
  const cells = report.production.decals.cells
    .map(
      (cell) =>
        `<tr><td>${cell.index}</td><td>${escapeHtml(cell.name)}</td><td>${cell.boundingBoxFillRatio}</td><td>${cell.safeBorderInkPixels}</td><td>${cell.violations.length ? escapeHtml(cell.violations.join(", ")) : "pass"}</td></tr>`,
    )
    .join("");
  const screens = report.production.screens.profiles
    .map(
      (screen) =>
        `<tr><td>${escapeHtml(screen.fileName)}</td><td>${screen.dimensions.width}×${screen.dimensions.height}</td><td>${screen.coarseOrthogonalEdgeShare}</td><td><code>${screen.sha256.slice(0, 16)}</code></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cinderwake environment composition gate</title>
  <style>
    :root { color: #e8e3d8; background: #090d0f; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 1180px; padding: 36px 18px 72px; line-height: 1.55; }
    h1, h2 { color: #efc278; font-family: Georgia, serif; font-weight: 400; }
    .status { color: ${report.status === "pass" ? "#80d7a5" : "#ff887f"}; font: 700 .78rem ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
    .note { max-width: 860px; color: #a9b6b2; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 16px; }
    figure { margin: 0; padding: 8px; background: #11191c; border: 1px solid #344348; }
    img { display: block; width: 100%; height: auto; }
    figcaption { padding: 8px 2px 2px; color: #a9b6b2; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th, td { padding: 8px; border-bottom: 1px solid #29353a; text-align: left; }
    th { color: #efc278; }
    code { color: #acd2c7; }
  </style>
</head>
<body>
  <div class="status">${escapeHtml(report.status)} · deterministic raster tripwires</div>
  <h1>Environment composition evidence</h1>
  <p class="note">${escapeHtml(report.scopeNote)}</p>
  <h2>Committed production pixels</h2>
  <div class="gallery">
    <figure><a href="screen-game-matrix.png"><img src="screen-game-matrix.png" alt="Four actual screen-contract gameplay PNGs"></a><figcaption>The four committed screen-contract gameplay PNGs used by the coarse square-grid detector.</figcaption></figure>
    <figure><a href="floor-composition.png"><img src="floor-composition.png" alt="Runtime-scale floor composition"></a><figcaption>960×720 floor composition using the renderer's 16×16 atlas order and runtime tile size.</figcaption></figure>
    <figure><a href="decal-composition.png"><img src="decal-composition.png" alt="Decals composited over the real floor"></a><figcaption>Every decal composited over committed floor pixels at its runtime size.</figcaption></figure>
    <figure><a href="decal-alpha-evidence.png"><img src="decal-alpha-evidence.png" alt="Decal alpha evidence"></a><figcaption>Exact alpha field used for matte and cell-boundary checks.</figcaption></figure>
  </div>
  <h2>Paired negative controls</h2>
  <table><thead><tr><th>Mutation</th><th>Result</th><th>Detected violations</th></tr></thead><tbody>${controls}</tbody></table>
  <div class="gallery">
    <figure><a href="mutations/decal-opaque-matte.png"><img src="mutations/decal-opaque-matte.png" alt="Injected opaque decal matte"></a><figcaption>Real decal RGB with failed alpha removal.</figcaption></figure>
    <figure><a href="mutations/decal-cross-cell.png"><img src="mutations/decal-cross-cell.png" alt="Injected cross-cell decal contamination"></a><figcaption>Real decal pixels shifted across their atlas cell.</figcaption></figure>
    <figure><a href="mutations/floor-square-seams.png"><img src="mutations/floor-square-seams.png" alt="Injected square floor seams"></a><figcaption>Runtime composition with an injected trailing-edge seam.</figcaption></figure>
    <figure><a href="mutations/floor-obvious-repeat.png"><img src="mutations/floor-obvious-repeat.png" alt="Injected repeated floor tile"></a><figcaption>Runtime composition reusing one real committed floor cell.</figcaption></figure>
    <figure><a href="mutations/screen-square-grid.png"><img src="mutations/screen-square-grid.png" alt="Injected square grid over an actual gameplay screen"></a><figcaption>An actual committed gameplay screenshot with the rejected hard square-grid failure exaggerated at runtime tile scale.</figcaption></figure>
  </div>
  <h2>Actual gameplay screen measurements</h2>
  <table><thead><tr><th>Screen</th><th>Size</th><th>coarse orthogonal edge share</th><th>SHA-256</th></tr></thead><tbody>${screens}</tbody></table>
  <p class="note">Cross-profile mean: <code>${report.production.screens.meanCoarseOrthogonalEdgeShare}</code>; maximum: <code>${report.production.screens.maximumCoarseOrthogonalEdgeShare}</code>. This signal is a regression tripwire for the independently rejected rectilinear floor, not a semantic judgment of scenery quality.</p>
  <h2>Per-decal measurements</h2>
  <table><thead><tr><th>Cell</th><th>Name</th><th>bbox fill</th><th>border ink</th><th>Result</th></tr></thead><tbody>${cells}</tbody></table>
  <p class="note">Floor boundary/core ratio: <code>${report.production.floor.boundaryToInteriorRatio}</code>; edge-band/core ratio: <code>${report.production.floor.edgeBandToCoreRatio}</code>; repeated tile fraction: <code>${report.production.floor.repeatedTileFraction}</code>.</p>
</body>
</html>
`;
}

async function run() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const screenRootIndex = args.indexOf("--screen-root");
  const outputRoot =
    outputIndex >= 0
      ? path.resolve(root, args[outputIndex + 1])
      : defaultOutput;
  if (outputIndex >= 0 && !args[outputIndex + 1])
    throw new Error("--output requires a path");
  const screenRoot =
    screenRootIndex >= 0
      ? path.resolve(root, args[screenRootIndex + 1])
      : defaultScreenRoot;
  if (screenRootIndex >= 0 && !args[screenRootIndex + 1])
    throw new Error("--screen-root requires a path");

  const tilePixels = await readRuntimeTilePixels();
  const [floorBytes, decalBytes, decalRaw] = await Promise.all([
    fs.readFile(floorPath),
    fs.readFile(decalPath),
    sharp(decalPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (decalRaw.info.width !== 1024 || decalRaw.info.height !== 1024)
    throw new Error("Decal atlas must remain 1024x1024");

  const floor = await composeFloor(tilePixels);
  const deterministicFloor = await composeFloor(tilePixels);
  const productionDecals = assessDecalAtlas(decalRaw.data, decalRaw.info.width);
  const productionFloor = assessFloorComposition(floor, tilePixels);
  const productionScreens = await assessGameScreens(screenRoot);

  const matteAtlas = opaqueMatteMutation(decalRaw.data, decalRaw.info.width);
  const crossCellAtlas = crossCellMutation(decalRaw.data, decalRaw.info.width);
  const seamFloor = squareSeamMutation(floor, tilePixels);
  const repeatedFloor = await composeFloor(tilePixels, true);
  const desktopScreen = await sharp(path.join(screenRoot, GAME_SCREEN_NAMES[0]))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const squareGridScreen = squareGridScreenMutation(
    desktopScreen.data,
    desktopScreen.info,
  );
  const squareGridScreenAssessment = await screenGridEvidence(
    squareGridScreen,
    desktopScreen.info,
  );
  const squareGridScreenViolations =
    squareGridScreenAssessment.coarseOrthogonalEdgeShare >
    THRESHOLDS.screenMaximumCoarseOrthogonalEdgeShare
      ? ["screen-square-grid-salience"]
      : [];
  const matteAssessment = assessDecalAtlas(matteAtlas, decalRaw.info.width);
  const crossCellAssessment = assessDecalAtlas(
    crossCellAtlas,
    decalRaw.info.width,
  );
  const seamAssessment = assessFloorComposition(seamFloor, tilePixels);
  const repeatAssessment = assessFloorComposition(repeatedFloor, tilePixels);
  const mutationAssessments = [
    {
      id: "decal-opaque-matte",
      expectedViolation: "opaque-rectangular-matte",
      assessment: matteAssessment,
      evidence: matteAssessment,
    },
    {
      id: "decal-cross-cell",
      expectedViolation: "cross-cell-boundary-ink",
      assessment: crossCellAssessment,
      evidence: crossCellAssessment,
    },
    {
      id: "floor-square-seams",
      expectedViolation: "square-floor-seams",
      assessment: seamAssessment,
      evidence: seamAssessment,
    },
    {
      id: "floor-obvious-repeat",
      expectedViolation: "obvious-repeated-floor-tiles",
      assessment: repeatAssessment,
      evidence: repeatAssessment,
    },
    {
      id: "screen-square-grid",
      expectedViolation: "screen-square-grid-salience",
      assessment: {
        pass: squareGridScreenViolations.length === 0,
        violations: squareGridScreenViolations,
      },
      evidence: squareGridScreenAssessment,
    },
  ];
  const negativeControls = mutationAssessments.map(
    ({ id, expectedViolation, assessment, evidence }) => ({
      id,
      expectedViolation,
      detected:
        !assessment.pass && assessment.violations.includes(expectedViolation),
      violations: assessment.violations,
      evidence,
    }),
  );

  const artifacts = {};
  await fs.mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeArtifact(
      outputRoot,
      "screen-game-matrix.png",
      await screenContactSheet(screenRoot),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "floor-composition.png",
      await pngBuffer(floor.pixels, floor.width, floor.height),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "decal-composition.png",
      await decalComposition(floor, decalRaw.data),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "decal-alpha-evidence.png",
      await alphaEvidence(decalRaw.data),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "mutations/decal-opaque-matte.png",
      await decalMutationPreview(floor, matteAtlas, 0),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "mutations/decal-cross-cell.png",
      await decalMutationPreview(floor, crossCellAtlas, 5),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "mutations/floor-square-seams.png",
      await pngBuffer(seamFloor.pixels, seamFloor.width, seamFloor.height),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "mutations/floor-obvious-repeat.png",
      await pngBuffer(
        repeatedFloor.pixels,
        repeatedFloor.width,
        repeatedFloor.height,
      ),
      artifacts,
    ),
    writeArtifact(
      outputRoot,
      "mutations/screen-square-grid.png",
      await pngBuffer(
        squareGridScreen,
        desktopScreen.info.width,
        desktopScreen.info.height,
      ),
      artifacts,
    ),
  ]);

  const deterministicRepeatSha256Match =
    sha256(floor.pixels) === sha256(deterministicFloor.pixels);
  const productionPass =
    productionDecals.pass && productionFloor.pass && productionScreens.pass;
  const controlsPass = negativeControls.every(({ detected }) => detected);
  const report = {
    schemaVersion: 1,
    project: "cinderwake",
    status:
      productionPass && controlsPass && deterministicRepeatSha256Match
        ? "pass"
        : "fail",
    scopeNote:
      "These deterministic pixel metrics inspect the four actual gameplay screen-contract PNGs and catch known rectangular matte, atlas-boundary contamination, coarse square-grid, tile seam, and obvious-repeat regressions. Passing them does not prove that an environment is beautiful, well composed, or ready for human visual acceptance.",
    runtimeContract: {
      viewport: { width: VIEW_WIDTH, height: VIEW_HEIGHT },
      floorAtlasGrid: FLOOR_ATLAS_GRID,
      floorSourceCellPixels: FLOOR_SOURCE_CELL,
      tilePixels,
      decalAtlasGrid: DECAL_ATLAS_GRID,
      decalSourceCellPixels: DECAL_SOURCE_CELL,
    },
    thresholds: THRESHOLDS,
    sources: {
      "environment-floor.png": { sha256: sha256(floorBytes) },
      "environment-decals.png": { sha256: sha256(decalBytes) },
    },
    deterministicRepeatSha256Match,
    production: {
      pass: productionPass,
      decals: productionDecals,
      floor: productionFloor,
      screens: productionScreens,
    },
    negativeControls,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).sort(([first], [second]) =>
        first.localeCompare(second),
      ),
    ),
  };
  await fs.writeFile(
    path.join(outputRoot, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await fs.writeFile(path.join(outputRoot, "index.html"), renderHtml(report));

  if (report.status !== "pass")
    throw new Error(
      `Environment composition gate failed: production=${productionPass}, negative-controls=${controlsPass}, deterministic=${deterministicRepeatSha256Match}`,
    );
  console.log(
    `Environment composition gate passed: 16 decals, ${floor.columns * floor.rows} runtime floor tiles, 4 gameplay screens, 5/5 paired mutations caught.`,
  );
}

await run();
