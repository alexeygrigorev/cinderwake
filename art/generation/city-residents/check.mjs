#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import sharp from "sharp";

const execute = promisify(execFile);
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIRECTORY, "../../..");
const GRID = 4;
const CELL = 256;
const SAFE_INSET = 24;
const FOOT_BASELINE = 227;
const ALPHA_THRESHOLD = 24;

function parseArguments(arguments_) {
  const options = {
    record: path.join(DIRECTORY, "record-v1.json"),
    prepared: path.join(DIRECTORY, "prepared/embercross-residents-idle-v1.png"),
    preparation: path.join(DIRECTORY, "evidence/preparation-v1.json"),
    audit: path.join(DIRECTORY, "evidence/audit-v1.json"),
    runtimeSheet: path.join(
      DIRECTORY,
      "evidence/runtime-scale-contact-sheet-v1.png",
    ),
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !value ||
      ![
        "--record",
        "--prepared",
        "--preparation",
        "--audit",
        "--runtime-sheet",
      ].includes(name)
    ) {
      throw new Error(
        "Usage: node check.mjs [--record record.json] [--prepared atlas.png] [--preparation report.json] [--audit audit.json] [--runtime-sheet sheet.png]",
      );
    }
    const key = name === "--runtime-sheet" ? "runtimeSheet" : name.slice(2);
    options[key] = path.resolve(process.cwd(), value);
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function spread(values) {
  return Math.max(...values) - Math.min(...values);
}

function relativeSpread(values) {
  const center = median(values);
  return center === 0 ? Number.POSITIVE_INFINITY : spread(values) / center;
}

function frameOrigin(index) {
  return {
    left: (index % GRID) * CELL,
    top: Math.floor(index / GRID) * CELL,
  };
}

function analyzeFrame(data, atlasWidth, index) {
  const { left, top } = frameOrigin(index);
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  let centroidXTotal = 0;
  let centroidYTotal = 0;
  let boundaryInk = 0;
  let transparentPixels = 0;
  let contaminatedTransparentPixels = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const offset = ((top + y) * atlasWidth + left + x) * 4;
      const alpha = data[offset + 3];
      if (alpha === 0) {
        transparentPixels += 1;
        if (
          data[offset] !== 0 ||
          data[offset + 1] !== 0 ||
          data[offset + 2] !== 0
        ) {
          contaminatedTransparentPixels += 1;
        }
      }
      if (alpha < ALPHA_THRESHOLD) continue;
      area += 1;
      centroidXTotal += x;
      centroidYTotal += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === CELL - 1 || y === CELL - 1) {
        boundaryInk += 1;
      }
    }
  }
  if (area === 0) {
    return {
      index,
      area,
      bounds: null,
      centroid: null,
      support: null,
      boundaryInk,
      transparentRatio: transparentPixels / (CELL * CELL),
      contaminatedTransparentPixels,
    };
  }

  const supportStart = Math.max(minY, maxY - 5);
  let supportArea = 0;
  let supportMinX = CELL;
  let supportMaxX = -1;
  let supportCentroidXTotal = 0;
  for (let y = supportStart; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const alpha = data[((top + y) * atlasWidth + left + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      supportArea += 1;
      supportMinX = Math.min(supportMinX, x);
      supportMaxX = Math.max(supportMaxX, x);
      supportCentroidXTotal += x;
    }
  }
  const bounds = {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    margins: {
      left: minX,
      top: minY,
      right: CELL - 1 - maxX,
      bottom: CELL - 1 - maxY,
    },
  };
  return {
    index,
    area,
    bounds,
    centroid: {
      x: centroidXTotal / area,
      y: centroidYTotal / area,
    },
    support: {
      startY: supportStart,
      area: supportArea,
      minX: supportMinX,
      maxX: supportMaxX,
      width: supportMaxX - supportMinX + 1,
      centroidX: supportCentroidXTotal / supportArea,
    },
    boundaryInk,
    transparentRatio: transparentPixels / (CELL * CELL),
    contaminatedTransparentPixels,
  };
}

function compareFrames(data, atlasWidth, firstIndex, secondIndex) {
  const first = frameOrigin(firstIndex);
  const second = frameOrigin(secondIndex);
  let meaningfullyDifferentPixels = 0;
  let union = 0;
  let intersection = 0;
  let absoluteDifference = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const firstOffset = ((first.top + y) * atlasWidth + first.left + x) * 4;
      const secondOffset =
        ((second.top + y) * atlasWidth + second.left + x) * 4;
      let pixelDifference = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        pixelDifference += Math.abs(
          data[firstOffset + channel] - data[secondOffset + channel],
        );
      }
      absoluteDifference += pixelDifference;
      if (pixelDifference > 24) meaningfullyDifferentPixels += 1;
      const firstInk = data[firstOffset + 3] >= ALPHA_THRESHOLD;
      const secondInk = data[secondOffset + 3] >= ALPHA_THRESHOLD;
      if (firstInk || secondInk) union += 1;
      if (firstInk && secondInk) intersection += 1;
    }
  }
  return {
    firstIndex,
    secondIndex,
    differentPixelRatio: meaningfullyDifferentPixels / (CELL * CELL),
    meanAbsoluteChannelDifference: absoluteDifference / (CELL * CELL * 4),
    silhouetteIou: union === 0 ? 0 : intersection / union,
  };
}

function auditAtlasRaw(data, width, height, preparation) {
  const frames = Array.from({ length: GRID * GRID }, (_, index) =>
    analyzeFrame(data, width, index),
  );
  const rows = [];
  for (let row = 0; row < GRID; row += 1) {
    const rowFrames = frames.slice(row * GRID, row * GRID + GRID);
    const allMeasurable = rowFrames.every(
      ({ bounds, centroid, support }) => bounds && centroid && support,
    );
    if (!allMeasurable) {
      rows.push({
        row,
        residentId: preparation.rows[row],
        measurable: false,
        checks: {
          heightContinuity: false,
          widthContinuity: false,
          centroidContinuity: false,
          supportContinuity: false,
          distinctFrames: false,
          loopClosure: false,
        },
        pass: false,
      });
      continue;
    }
    const heights = rowFrames.map(({ bounds }) => bounds.height);
    const widths = rowFrames.map(({ bounds }) => bounds.width);
    const centroidXs = rowFrames.map(({ centroid }) => centroid.x);
    const centroidYs = rowFrames.map(({ centroid }) => centroid.y);
    const supportCentroidXs = rowFrames.map(({ support }) => support.centroidX);
    const supportWidths = rowFrames.map(({ support }) => support.width);
    const comparisons = [];
    for (let left = 0; left < GRID; left += 1) {
      for (let right = left + 1; right < GRID; right += 1) {
        comparisons.push(
          compareFrames(data, width, row * GRID + left, row * GRID + right),
        );
      }
    }
    const adjacent = [0, 1, 2].map((column) =>
      compareFrames(data, width, row * GRID + column, row * GRID + column + 1),
    );
    const closure = compareFrames(data, width, row * GRID, row * GRID + 3);
    const metrics = {
      heightRelativeSpread: relativeSpread(heights),
      widthRelativeSpread: relativeSpread(widths),
      centroidXSpread: spread(centroidXs),
      centroidYSpread: spread(centroidYs),
      supportCentroidXSpread: spread(supportCentroidXs),
      supportWidthRelativeSpread: relativeSpread(supportWidths),
      minimumPairDifferenceRatio: Math.min(
        ...comparisons.map(({ differentPixelRatio }) => differentPixelRatio),
      ),
      minimumPairSilhouetteDifference: Math.min(
        ...comparisons.map(({ silhouetteIou }) => 1 - silhouetteIou),
      ),
      adjacent,
      closure,
      minimumAdjacentSilhouetteIou: Math.min(
        ...adjacent.map(({ silhouetteIou }) => silhouetteIou),
      ),
    };
    const checks = {
      heightContinuity: metrics.heightRelativeSpread <= 0.03,
      widthContinuity: metrics.widthRelativeSpread <= 0.08,
      centroidContinuity:
        metrics.centroidXSpread <= 3 && metrics.centroidYSpread <= 4,
      supportContinuity:
        metrics.supportCentroidXSpread <= 4 &&
        metrics.supportWidthRelativeSpread <= 0.2,
      distinctFrames:
        metrics.minimumPairDifferenceRatio >= 0.05 &&
        metrics.minimumPairSilhouetteDifference >= 0.01,
      loopClosure:
        closure.silhouetteIou >= 0.88 &&
        closure.silhouetteIou >= metrics.minimumAdjacentSilhouetteIou - 0.05,
    };
    rows.push({
      row,
      residentId: preparation.rows[row],
      measurable: true,
      frames: rowFrames.map(({ index }) => index),
      values: {
        heights,
        widths,
        centroidXs,
        centroidYs,
        supportCentroidXs,
        supportWidths,
      },
      metrics,
      checks,
      pass: Object.values(checks).every(Boolean),
    });
  }

  const checks = {
    exactDimensions: width === GRID * CELL && height === GRID * CELL,
    sixteenFrames: frames.length === GRID * GRID,
    allNonblank: frames.every(({ area }) => area >= 500),
    noBoundaryInk: frames.every(({ boundaryInk }) => boundaryInk === 0),
    safeInsets: frames.every(
      ({ bounds }) =>
        bounds &&
        Object.values(bounds.margins).every((margin) => margin >= SAFE_INSET),
    ),
    noTransparentRgb: frames.every(
      ({ contaminatedTransparentPixels }) =>
        contaminatedTransparentPixels === 0,
    ),
    transparentBackground: frames.every(
      ({ transparentRatio }) => transparentRatio >= 0.35,
    ),
    commonBaseline: frames.every(
      ({ bounds }) => bounds && Math.abs(bounds.maxY - FOOT_BASELINE) <= 1,
    ),
    aspectPreserved:
      preparation.frames.length === GRID * GRID &&
      preparation.frames.every(
        ({ aspectScaleDelta }) => aspectScaleDelta <= 0.006,
      ),
    rowHeightContinuity: rows.every(
      ({ checks: rowChecks }) => rowChecks.heightContinuity,
    ),
    rowWidthContinuity: rows.every(
      ({ checks: rowChecks }) => rowChecks.widthContinuity,
    ),
    rowCentroidContinuity: rows.every(
      ({ checks: rowChecks }) => rowChecks.centroidContinuity,
    ),
    rowSupportContinuity: rows.every(
      ({ checks: rowChecks }) => rowChecks.supportContinuity,
    ),
    frameDistinctness: rows.every(
      ({ checks: rowChecks }) => rowChecks.distinctFrames,
    ),
    loopClosure: rows.every(({ checks: rowChecks }) => rowChecks.loopClosure),
  };
  return {
    checks,
    frames,
    rows,
    pass: Object.values(checks).every(Boolean),
  };
}

function clearCell(data, atlasWidth, index) {
  const { left, top } = frameOrigin(index);
  for (let y = 0; y < CELL; y += 1) {
    data.fill(
      0,
      ((top + y) * atlasWidth + left) * 4,
      ((top + y) * atlasWidth + left + CELL) * 4,
    );
  }
}

function copyCell(data, atlasWidth, sourceIndex, destinationIndex) {
  const source = frameOrigin(sourceIndex);
  const destination = frameOrigin(destinationIndex);
  for (let y = 0; y < CELL; y += 1) {
    const sourceStart = ((source.top + y) * atlasWidth + source.left) * 4;
    const destinationStart =
      ((destination.top + y) * atlasWidth + destination.left) * 4;
    data.copy(data, destinationStart, sourceStart, sourceStart + CELL * 4);
  }
}

function shiftCell(data, atlasWidth, index, xOffset, yOffset) {
  const { left, top } = frameOrigin(index);
  const source = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y += 1) {
    const sourceStart = ((top + y) * atlasWidth + left) * 4;
    data.copy(source, y * CELL * 4, sourceStart, sourceStart + CELL * 4);
  }
  clearCell(data, atlasWidth, index);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const destinationX = x + xOffset;
      const destinationY = y + yOffset;
      if (
        destinationX < 0 ||
        destinationX >= CELL ||
        destinationY < 0 ||
        destinationY >= CELL
      ) {
        continue;
      }
      const sourceOffset = (y * CELL + x) * 4;
      const destinationOffset =
        ((top + destinationY) * atlasWidth + left + destinationX) * 4;
      source.copy(data, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

function fillTransparentBackdrop(data, atlasWidth, index) {
  const { left, top } = frameOrigin(index);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const offset = ((top + y) * atlasWidth + left + x) * 4;
      if (data[offset + 3] >= ALPHA_THRESHOLD) continue;
      data[offset] = 240;
      data[offset + 1] = 240;
      data[offset + 2] = 240;
      data[offset + 3] = 255;
    }
  }
}

function mutationEvidence(original, width, height, preparation) {
  const mutations = [
    {
      id: "blank-frame",
      requiredFailedChecks: ["allNonblank"],
      mutate(data) {
        clearCell(data, width, 2);
      },
    },
    {
      id: "jumped-frame",
      requiredFailedChecks: ["commonBaseline", "rowCentroidContinuity"],
      mutate(data) {
        shiftCell(data, width, 5, 0, -12);
      },
    },
    {
      id: "boundary-leak",
      requiredFailedChecks: ["noBoundaryInk", "safeInsets"],
      mutate(data) {
        const { left, top } = frameOrigin(9);
        const offset = (top * width + left) * 4;
        data[offset] = 255;
        data[offset + 1] = 0;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      },
    },
    {
      id: "duplicate-frame",
      requiredFailedChecks: ["frameDistinctness"],
      mutate(data) {
        copyCell(data, width, 12, 13);
      },
    },
    {
      id: "opaque-backdrop",
      requiredFailedChecks: ["transparentBackground", "noBoundaryInk"],
      mutate(data) {
        fillTransparentBackdrop(data, width, 7);
      },
    },
  ];
  return mutations.map(({ id, requiredFailedChecks, mutate }) => {
    const candidate = Buffer.from(original);
    mutate(candidate);
    const audit = auditAtlasRaw(candidate, width, height, preparation);
    const observedFailedChecks = Object.entries(audit.checks)
      .filter(([, pass]) => !pass)
      .map(([name]) => name);
    return {
      id,
      requiredFailedChecks,
      observedFailedChecks,
      rejected: !audit.pass,
      pass:
        !audit.pass &&
        requiredFailedChecks.every((name) => audit.checks[name] === false),
    };
  });
}

async function checkerTile(size, light, dark) {
  const data = Buffer.alloc(size * size * 4);
  const block = 16;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color =
        (Math.floor(x / block) + Math.floor(y / block)) % 2 ? light : dark;
      const offset = (y * size + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function writeRuntimeSheet(preparedBytes, output) {
  const tile = 160;
  const actorBox = 128;
  const background = await checkerTile(tile, [49, 43, 39], [39, 34, 32]);
  const composites = [];
  for (let index = 0; index < GRID * GRID; index += 1) {
    const column = index % GRID;
    const row = Math.floor(index / GRID);
    composites.push({
      input: background,
      left: column * tile,
      top: row * tile,
    });
    const frame = await sharp(preparedBytes)
      .extract({
        left: column * CELL,
        top: row * CELL,
        width: CELL,
        height: CELL,
      })
      .resize(actorBox, actorBox, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    composites.push({
      input: frame,
      left: column * tile + Math.round((tile - actorBox) / 2),
      top: row * tile + Math.round((tile - actorBox) / 2),
    });
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp({
    create: {
      width: GRID * tile,
      height: GRID * tile,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const record = JSON.parse(await fs.readFile(options.record, "utf8"));
  const preparation = JSON.parse(
    await fs.readFile(options.preparation, "utf8"),
  );
  const promptBytes = await fs.readFile(
    path.join(ROOT, record.generation.prompt.file),
  );
  const rawPath = path.join(ROOT, record.generation.raw.file);
  const rawBytes = await fs.readFile(rawPath);
  const preparedBytes = await fs.readFile(options.prepared);
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-resident-atlas-"),
  );
  try {
    const repeats = [];
    for (let index = 0; index < 2; index += 1) {
      const output = path.join(temporary, `repeat-${index}.png`);
      const report = path.join(temporary, `repeat-${index}.json`);
      await execute(process.execPath, [
        path.join(DIRECTORY, "prepare.mjs"),
        "--input",
        rawPath,
        "--output",
        output,
        "--report",
        report,
      ]);
      repeats.push(await fs.readFile(output));
    }

    const { data, info } = await sharp(preparedBytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mechanical = auditAtlasRaw(
      data,
      info.width,
      info.height,
      preparation,
    );
    const mutations = mutationEvidence(
      data,
      info.width,
      info.height,
      preparation,
    );
    const hashes = {
      prompt: sha256(promptBytes),
      raw: sha256(rawBytes),
      prepared: sha256(preparedBytes),
      repeatOne: sha256(repeats[0]),
      repeatTwo: sha256(repeats[1]),
    };
    const provenanceChecks = {
      promptHash: hashes.prompt === record.generation.prompt.sha256,
      rawHash: hashes.raw === record.generation.raw.sha256,
      rawDimensions:
        record.generation.raw.width === 1254 &&
        record.generation.raw.height === 1254,
      declaredGrid:
        record.declaredGrid.columns === GRID &&
        record.declaredGrid.rows === GRID &&
        record.declaredGrid.rowIds.join("|") === preparation.rows.join("|") &&
        record.declaredGrid.columnPoses.join("|") ===
          preparation.poses.join("|"),
      exactFloorBoundaries:
        preparation.constants.rawXBoundaries.join(",") ===
          "0,313,627,940,1254" &&
        preparation.constants.rawYBoundaries.join(",") === "0,313,627,940,1254",
      preparationBindsPrepared: preparation.output.sha256 === hashes.prepared,
      deterministicRepeat:
        hashes.repeatOne === hashes.repeatTwo &&
        hashes.repeatOne === hashes.prepared,
      allNegativeMutationsDetected: mutations.every(({ pass }) => pass),
    };
    const audit = {
      schemaVersion: 1,
      verdict:
        Object.values(provenanceChecks).every(Boolean) && mechanical.pass
          ? "PASS"
          : "REJECT",
      scope:
        "deterministic preparation and animation-mechanics acceptance only; production registration and semantic visual acceptance are explicitly out of scope",
      thresholds: {
        alpha: ALPHA_THRESHOLD,
        safeInset: SAFE_INSET,
        footBaseline: FOOT_BASELINE,
        minimumTransparentRatio: 0.35,
        maximumHeightRelativeSpread: 0.03,
        maximumWidthRelativeSpread: 0.08,
        maximumCentroidXSpread: 3,
        maximumCentroidYSpread: 4,
        maximumSupportCentroidXSpread: 4,
        maximumSupportWidthRelativeSpread: 0.2,
        minimumPairDifferenceRatio: 0.05,
        minimumPairSilhouetteDifference: 0.01,
        minimumLoopSilhouetteIou: 0.88,
      },
      hashes,
      provenanceChecks,
      mechanical,
      mutationProof: {
        note: "Each mutation must fail its named checks, not merely produce any rejection.",
        allDetected: mutations.every(({ pass }) => pass),
        mutations,
      },
    };
    await fs.mkdir(path.dirname(options.audit), { recursive: true });
    await fs.writeFile(
      options.audit,
      await prettier.format(JSON.stringify(audit), { parser: "json" }),
    );
    await writeRuntimeSheet(preparedBytes, options.runtimeSheet);
    process.stdout.write(
      `${record.id} ${audit.verdict}; ${mechanical.frames.filter(({ area }) => area >= 500).length}/16 nonblank; ${mechanical.rows.filter(({ pass }) => pass).length}/4 rows pass; ${mutations.filter(({ pass }) => pass).length}/5 mutations detected; prepared ${hashes.prepared}\n`,
    );
    if (audit.verdict !== "PASS") process.exitCode = 1;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
