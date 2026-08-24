#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import sharp from "sharp";

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(
  DIRECTORY,
  "raw/embercross-residents-idle-v1.png",
);
const DEFAULT_OUTPUT = path.join(
  DIRECTORY,
  "prepared/embercross-residents-idle-v1.png",
);
const DEFAULT_REPORT = path.join(DIRECTORY, "evidence/preparation-v1.json");
const GRID = 4;
const CELL = 256;
const SAFE_INSET = 24;
const FOOT_BASELINE = 227;
const ALPHA_THRESHOLD = 24;
const MIN_COMPONENT_AREA = 4;
const NEARBY_COMPONENT_DISTANCE = 12;
const ROW_IDS = [
  "npc:embercross:mara",
  "npc:embercross:oren",
  "npc:embercross:tess",
  "npc:embercross:ileya",
];
const POSE_IDS = ["neutral", "inhale", "weight-shift", "return"];

function parseArguments(arguments_) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || !["--input", "--output", "--report"].includes(name)) {
      throw new Error(
        "Usage: node prepare.mjs [--input raw.png] [--output prepared.png] [--report preparation.json]",
      );
    }
    options[name.slice(2)] = path.resolve(process.cwd(), value);
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function gridBoundaries(length) {
  return Array.from({ length: GRID + 1 }, (_, index) =>
    Math.floor((index * length) / GRID),
  );
}

function isLightNeutral(red, green, blue) {
  return (
    Math.min(red, green, blue) >= 232 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 10
  );
}

function removeBorderConnectedBackground(rgb, width, height) {
  const removed = new Uint8Array(width * height);
  const queue = [];
  const enqueue = (x, y) => {
    const pixel = y * width + x;
    if (removed[pixel]) return;
    const offset = pixel * 3;
    if (!isLightNeutral(rgb[offset], rgb[offset + 1], rgb[offset + 2])) {
      return;
    }
    removed[pixel] = 1;
    queue.push(pixel);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }

  const rgba = Buffer.alloc(width * height * 4);
  let removedPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (removed[pixel]) {
      removedPixels += 1;
      continue;
    }
    rgba[pixel * 4] = rgb[pixel * 3];
    rgba[pixel * 4 + 1] = rgb[pixel * 3 + 1];
    rgba[pixel * 4 + 2] = rgb[pixel * 3 + 2];
    rgba[pixel * 4 + 3] = 255;
  }
  return { rgba, removedPixels };
}

function connectedComponents(rgba, width, height) {
  const seen = new Uint8Array(width * height);
  const components = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || rgba[start * 4 + 3] < ALPHA_THRESHOLD) continue;
    const queue = [start];
    seen[start] = 1;
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const neighborX = x + xOffset;
          const neighborY = y + yOffset;
          if (
            neighborX < 0 ||
            neighborX >= width ||
            neighborY < 0 ||
            neighborY >= height
          ) {
            continue;
          }
          const neighbor = neighborY * width + neighborX;
          if (seen[neighbor] || rgba[neighbor * 4 + 3] < ALPHA_THRESHOLD) {
            continue;
          }
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    components.push({
      pixels,
      area: pixels.length,
      minX,
      minY,
      maxX,
      maxY,
    });
  }
  return components.sort((left, right) => right.area - left.area);
}

function boxDistance(left, right) {
  const horizontal = Math.max(
    left.minX - right.maxX - 1,
    right.minX - left.maxX - 1,
    0,
  );
  const vertical = Math.max(
    left.minY - right.maxY - 1,
    right.minY - left.maxY - 1,
    0,
  );
  return Math.hypot(horizontal, vertical);
}

function unionBounds(target, source) {
  target.minX = Math.min(target.minX, source.minX);
  target.minY = Math.min(target.minY, source.minY);
  target.maxX = Math.max(target.maxX, source.maxX);
  target.maxY = Math.max(target.maxY, source.maxY);
}

function isolateSubject(rgba, width, height) {
  const components = connectedComponents(rgba, width, height);
  if (components.length === 0 || components[0].area < 500) {
    throw new Error("No primary resident subject found in raw cell");
  }
  const primary = components[0];
  const retained = [primary];
  const bounds = {
    minX: primary.minX,
    minY: primary.minY,
    maxX: primary.maxX,
    maxY: primary.maxY,
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of components) {
      if (
        retained.includes(component) ||
        component.area < MIN_COMPONENT_AREA ||
        boxDistance(bounds, component) > NEARBY_COMPONENT_DISTANCE
      ) {
        continue;
      }
      retained.push(component);
      unionBounds(bounds, component);
      changed = true;
    }
  }

  const isolated = Buffer.alloc(rgba.length);
  for (const component of retained) {
    for (const pixel of component.pixels) {
      rgba.copy(isolated, pixel * 4, pixel * 4, pixel * 4 + 4);
    }
  }
  return {
    rgba: isolated,
    bounds,
    primaryArea: primary.area,
    retainedComponents: retained.length,
    retainedPixels: retained.reduce(
      (total, component) => total + component.area,
      0,
    ),
    excludedComponents: components.length - retained.length,
    excludedPixels: components
      .filter((component) => !retained.includes(component))
      .reduce((total, component) => total + component.area, 0),
  };
}

function cleanTransparentRgb(rgba) {
  const result = Buffer.from(rgba);
  for (let offset = 0; offset < result.length; offset += 4) {
    if (result[offset + 3] < ALPHA_THRESHOLD) {
      result.fill(0, offset, offset + 4);
    }
  }
  return result;
}

function alphaBounds(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error("Prepared resident became blank");
  return { minX, minY, maxX, maxY };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputBytes = await fs.readFile(options.input);
  const { data: rgb, info } = await sharp(inputBytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 1254 || info.height !== 1254) {
    throw new Error(
      `Resident raw source must be exactly 1254x1254; received ${info.width}x${info.height}`,
    );
  }

  const xBoundaries = gridBoundaries(info.width);
  const yBoundaries = gridBoundaries(info.height);
  const composites = [];
  const frames = [];
  const maximumWidth = CELL - SAFE_INSET * 2;
  const maximumHeight = FOOT_BASELINE - SAFE_INSET + 1;

  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const index = row * GRID + column;
      const rawLeft = xBoundaries[column];
      const rawTop = yBoundaries[row];
      const rawWidth = xBoundaries[column + 1] - rawLeft;
      const rawHeight = yBoundaries[row + 1] - rawTop;
      const rawCell = await sharp(rgb, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
        .extract({
          left: rawLeft,
          top: rawTop,
          width: rawWidth,
          height: rawHeight,
        })
        .raw()
        .toBuffer();
      const background = removeBorderConnectedBackground(
        rawCell,
        rawWidth,
        rawHeight,
      );
      const subject = isolateSubject(background.rgba, rawWidth, rawHeight);
      let disconnectedLightNeutralPixels = 0;
      let retainedLightNeutralPixels = 0;
      for (let pixel = 0; pixel < rawWidth * rawHeight; pixel += 1) {
        if (
          !isLightNeutral(
            rawCell[pixel * 3],
            rawCell[pixel * 3 + 1],
            rawCell[pixel * 3 + 2],
          )
        ) {
          continue;
        }
        if (background.rgba[pixel * 4 + 3] >= ALPHA_THRESHOLD) {
          disconnectedLightNeutralPixels += 1;
        }
        if (subject.rgba[pixel * 4 + 3] >= ALPHA_THRESHOLD) {
          retainedLightNeutralPixels += 1;
        }
      }
      const sourceWidth = subject.bounds.maxX - subject.bounds.minX + 1;
      const sourceHeight = subject.bounds.maxY - subject.bounds.minY + 1;
      const scale = Math.min(
        maximumWidth / sourceWidth,
        maximumHeight / sourceHeight,
        1,
      );
      const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
      const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));
      const resized = await sharp(subject.rgba, {
        raw: { width: rawWidth, height: rawHeight, channels: 4 },
      })
        .extract({
          left: subject.bounds.minX,
          top: subject.bounds.minY,
          width: sourceWidth,
          height: sourceHeight,
        })
        .resize(resizedWidth, resizedHeight, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
        })
        .raw()
        .toBuffer();
      const cleaned = cleanTransparentRgb(resized);
      const resizedBounds = alphaBounds(cleaned, resizedWidth, resizedHeight);
      const inkWidth = resizedBounds.maxX - resizedBounds.minX + 1;
      const inkHeight = resizedBounds.maxY - resizedBounds.minY + 1;
      const ink = await sharp(cleaned, {
        raw: { width: resizedWidth, height: resizedHeight, channels: 4 },
      })
        .extract({
          left: resizedBounds.minX,
          top: resizedBounds.minY,
          width: inkWidth,
          height: inkHeight,
        })
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
        .toBuffer();
      const destinationLeft = Math.round((CELL - inkWidth) / 2);
      const destinationTop = FOOT_BASELINE - inkHeight + 1;
      composites.push({
        input: ink,
        left: column * CELL + destinationLeft,
        top: row * CELL + destinationTop,
      });
      frames.push({
        index,
        row,
        column,
        residentId: ROW_IDS[row],
        poseId: POSE_IDS[column],
        rawCell: {
          left: rawLeft,
          top: rawTop,
          width: rawWidth,
          height: rawHeight,
        },
        backgroundExtraction: {
          method:
            "four-connected flood from cell border over light-neutral pixels only",
          lightNeutralMinimumChannel: 232,
          maximumChannelSpread: 10,
          removedPixels: background.removedPixels,
          disconnectedLightNeutralPixels,
          retainedLightNeutralPixels,
        },
        subjectIsolation: {
          primaryArea: subject.primaryArea,
          retainedComponents: subject.retainedComponents,
          retainedPixels: subject.retainedPixels,
          excludedComponents: subject.excludedComponents,
          excludedPixels: subject.excludedPixels,
          nearbyComponentMaximumDistance: NEARBY_COMPONENT_DISTANCE,
          bounds: subject.bounds,
        },
        sourceCrop: {
          left: subject.bounds.minX,
          top: subject.bounds.minY,
          width: sourceWidth,
          height: sourceHeight,
        },
        uniformScale: scale,
        resize: { width: resizedWidth, height: resizedHeight },
        transparentTrimAfterResize: resizedBounds,
        destination: {
          left: destinationLeft,
          top: destinationTop,
          width: inkWidth,
          height: inkHeight,
        },
        aspectScaleDelta: Math.abs(
          resizedWidth / sourceWidth - resizedHeight / sourceHeight,
        ),
      });
    }
  }

  const outputBytes = await sharp({
    create: {
      width: GRID * CELL,
      height: GRID * CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  const report = {
    schemaVersion: 1,
    operation:
      "exact floor-derived 4x4 cuts; border-connected light-neutral flood removal; dominant-plus-nearby component isolation; uniform fit; centered common foot baseline; zero transparent RGB",
    constants: {
      rows: GRID,
      columns: GRID,
      outputCell: CELL,
      safeInset: SAFE_INSET,
      footBaseline: FOOT_BASELINE,
      alphaThreshold: ALPHA_THRESHOLD,
      rawXBoundaries: xBoundaries,
      rawYBoundaries: yBoundaries,
    },
    input: {
      file: path.relative(process.cwd(), options.input),
      sha256: sha256(inputBytes),
      width: info.width,
      height: info.height,
    },
    output: {
      file: path.relative(process.cwd(), options.output),
      sha256: sha256(outputBytes),
      width: GRID * CELL,
      height: GRID * CELL,
    },
    rows: ROW_IDS,
    poses: POSE_IDS,
    frames,
  };
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.mkdir(path.dirname(options.report), { recursive: true });
  await fs.writeFile(options.output, outputBytes);
  await fs.writeFile(
    options.report,
    await prettier.format(JSON.stringify(report), { parser: "json" }),
  );
  process.stdout.write(
    `${path.relative(process.cwd(), options.output)} ${report.output.sha256}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
