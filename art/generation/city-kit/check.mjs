#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const execute = promisify(execFile);
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIRECTORY, "../../..");
const CELL = 512;
const COLUMNS = 3;
const ALPHA_THRESHOLD = 24;

function parseArguments(arguments_) {
  const options = {
    record: path.join(DIRECTORY, "record.json"),
    audit: path.join(DIRECTORY, "evidence/audit.json"),
    runtimeSheet: path.join(
      DIRECTORY,
      "evidence/runtime-scale-contact-sheet.png",
    ),
    cutsDirectory: path.join(DIRECTORY, "evidence/cuts"),
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !value ||
      !["--record", "--audit", "--runtime-sheet", "--cuts-directory"].includes(
        name,
      )
    ) {
      throw new Error(
        "Usage: node check.mjs [--record record.json] [--audit audit.json] [--runtime-sheet preview.png] [--cuts-directory directory]",
      );
    }
    const key =
      name === "--runtime-sheet"
        ? "runtimeSheet"
        : name === "--cuts-directory"
          ? "cutsDirectory"
          : name.slice(2);
    options[key] = path.resolve(process.cwd(), value);
  }
  return options;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function keyedAlpha(red, green, blue) {
  const dominance = Math.min(red, blue) - green;
  const balance = Math.abs(red - blue);
  if (dominance >= 28 && balance <= 110) return 0;
  if (dominance > 12 && balance < 130) {
    return Math.max(0, Math.round(((28 - dominance) / 16) * 255));
  }
  const distance = Math.hypot(255 - red, green, 255 - blue);
  if (distance <= 24) return 0;
  if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
  return 255;
}

function boundsForCell(data, width, index) {
  const left = (index % COLUMNS) * CELL;
  const top = Math.floor(index / COLUMNS) * CELL;
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  let contaminatedTransparentPixels = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const offset = ((top + y) * width + left + x) * 4;
      const alpha = data[offset + 3];
      if (
        alpha === 0 &&
        (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0)
      ) {
        contaminatedTransparentPixels += 1;
      }
      if (alpha < ALPHA_THRESHOLD) continue;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area,
    margins: {
      left: minX,
      top: minY,
      right: CELL - 1 - maxX,
      bottom: CELL - 1 - maxY,
    },
    contaminatedTransparentPixels,
  };
}

function gateAperture(data, width, bounds, index) {
  const cellLeft = (index % COLUMNS) * CELL;
  const cellTop = Math.floor(index / COLUMNS) * CELL;
  const startX = Math.round(CELL * 0.46);
  const endX = Math.round(CELL * 0.54);
  const startY = Math.round(bounds.minY + bounds.height * 0.43);
  const endY = Math.round(bounds.maxY - bounds.height * 0.08);
  let transparent = 0;
  let total = 0;
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      total += 1;
      if (data[((cellTop + y) * width + cellLeft + x) * 4 + 3] < 24) {
        transparent += 1;
      }
    }
  }
  return {
    transparentRatio: transparent / total,
    sample: [startX, startY, endX, endY],
  };
}

async function writeRuntimeSheet(prepared, preparation, record, output) {
  const canvasWidth = 960;
  const canvasHeight = 520;
  const positions = [
    [20, 15],
    [340, 15],
    [660, 15],
    [20, 275],
    [340, 275],
    [660, 275],
  ];
  const overlays = [];
  for (const [index, cell] of preparation.cells.entries()) {
    const runtimeHeight = record.grid.cells[index].runtimeHeight;
    const runtimeWidth = Math.max(
      1,
      Math.round(
        (cell.destination.width / cell.destination.height) * runtimeHeight,
      ),
    );
    const cut = await sharp(prepared)
      .extract({
        left: (index % COLUMNS) * CELL + cell.destination.left,
        top: Math.floor(index / COLUMNS) * CELL + cell.destination.top,
        width: cell.destination.width,
        height: cell.destination.height,
      })
      .resize(runtimeWidth, runtimeHeight, { fit: "fill" })
      .png()
      .toBuffer();
    overlays.push({
      input: cut,
      left: positions[index][0] + Math.round((280 - runtimeWidth) / 2),
      top: positions[index][1] + 225 - runtimeHeight,
    });
  }
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 32, g: 27, b: 25, alpha: 1 },
    },
  })
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(output);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const record = JSON.parse(await fs.readFile(options.record, "utf8"));
  const preparation = JSON.parse(
    await fs.readFile(path.join(ROOT, record.preparation.report), "utf8"),
  );
  const promptBytes = await fs.readFile(
    path.join(ROOT, record.generation.prompt.file),
  );
  const referenceBytes = await Promise.all(
    record.generation.references.map(({ file }) =>
      fs.readFile(path.join(ROOT, file)),
    ),
  );
  const rawPath = path.join(ROOT, record.generation.raw.file);
  const rawBytes = await fs.readFile(rawPath);
  const preparedBytes = await fs.readFile(
    path.join(ROOT, record.preparation.file),
  );
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-city-kit-"),
  );
  const first = path.join(temporary, "first.png");
  const second = path.join(temporary, "second.png");
  const firstReport = path.join(temporary, "first.json");
  const secondReport = path.join(temporary, "second.json");
  try {
    await execute(process.execPath, [
      path.join(DIRECTORY, "prepare.mjs"),
      "--input",
      rawPath,
      "--output",
      first,
      "--report",
      firstReport,
    ]);
    await execute(process.execPath, [
      path.join(DIRECTORY, "prepare.mjs"),
      "--input",
      rawPath,
      "--output",
      second,
      "--report",
      secondReport,
    ]);
    const firstBytes = await fs.readFile(first);
    const secondBytes = await fs.readFile(second);

    const { data: rawRgb, info: rawInfo } = await sharp(rawBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let literalMagenta = 0;
    let keyable = 0;
    for (let offset = 0; offset < rawRgb.length; offset += 3) {
      if (
        rawRgb[offset] === 255 &&
        rawRgb[offset + 1] === 0 &&
        rawRgb[offset + 2] === 255
      ) {
        literalMagenta += 1;
      }
      if (
        keyedAlpha(rawRgb[offset], rawRgb[offset + 1], rawRgb[offset + 2]) < 24
      ) {
        keyable += 1;
      }
    }
    const { data, info } = await sharp(preparedBytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cells = record.grid.cells.map((cell, index) => {
      const bounds = boundsForCell(data, info.width, index);
      const prep = preparation.cells[index];
      const checks = {
        nonblank: bounds.area > 500,
        safeBorders: Object.values(bounds.margins).every(
          (margin) => margin >= record.grid.safeInset,
        ),
        commonBaseline: Math.abs(bounds.maxY - record.grid.footBaseline) <= 1,
        noTransparentRgb: bounds.contaminatedTransparentPixels === 0,
        noUpscaling: prep.uniformScale <= 1,
        aspectPreserved: prep.aspectScaleDelta <= 0.005,
        horizontallyAnchored:
          Math.abs((bounds.minX + bounds.maxX) / 2 - 255.5) <= 2,
        sourceSubjectIsolated:
          prep.sourceInkBounds.minX > 0 &&
          prep.sourceInkBounds.minY > 0 &&
          prep.sourceInkBounds.maxX < CELL - 1 &&
          prep.sourceInkBounds.maxY < CELL - 1,
      };
      if (cell.id === "city-gate") {
        const aperture = gateAperture(data, info.width, bounds, index);
        checks.openWalkableAperture = aperture.transparentRatio >= 0.48;
        return {
          ...cell,
          bounds,
          preparation: prep,
          aperture,
          checks,
          pass: Object.values(checks).every(Boolean),
        };
      }
      return {
        ...cell,
        bounds,
        preparation: prep,
        checks,
        pass: Object.values(checks).every(Boolean),
      };
    });
    await fs.mkdir(options.cutsDirectory, { recursive: true });
    for (const cell of cells) {
      const file = `${String(cell.index).padStart(2, "0")}-${cell.id}.png`;
      const bytes = await sharp(preparedBytes)
        .extract({
          left: (cell.index % COLUMNS) * CELL,
          top: Math.floor(cell.index / COLUMNS) * CELL,
          width: CELL,
          height: CELL,
        })
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
        .toBuffer();
      await fs.writeFile(path.join(options.cutsDirectory, file), bytes);
      cell.atlasCell = {
        file: path.relative(ROOT, path.join(options.cutsDirectory, file)),
        sha256: sha256(bytes),
        sourceRect: {
          x: (cell.index % COLUMNS) * CELL,
          y: Math.floor(cell.index / COLUMNS) * CELL,
          width: CELL,
          height: CELL,
        },
      };
    }
    let requestedEditInvariant;
    if (record.generation.requestedEditInvariant) {
      const { data: referenceRgb, info: referenceInfo } = await sharp(
        referenceBytes[0],
      )
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cellsCompared =
        record.generation.requestedEditInvariant.unchangedReferenceCellIndices.map(
          (index) => {
            let changedPixels = 0;
            const left = (index % COLUMNS) * CELL;
            const top = Math.floor(index / COLUMNS) * CELL;
            for (let y = 0; y < CELL; y += 1) {
              for (let x = 0; x < CELL; x += 1) {
                const rawOffset = ((top + y) * rawInfo.width + left + x) * 3;
                const referenceOffset =
                  ((top + y) * referenceInfo.width + left + x) * 3;
                if (
                  rawRgb[rawOffset] !== referenceRgb[referenceOffset] ||
                  rawRgb[rawOffset + 1] !== referenceRgb[referenceOffset + 1] ||
                  rawRgb[rawOffset + 2] !== referenceRgb[referenceOffset + 2]
                ) {
                  changedPixels += 1;
                }
              }
            }
            return {
              index,
              changedPixels,
              changedRatio: changedPixels / (CELL * CELL),
              pass: changedPixels === 0,
            };
          },
        );
      requestedEditInvariant = {
        pass: cellsCompared.every(({ pass }) => pass),
        cellsCompared,
        note: record.generation.requestedEditInvariant.note,
      };
    }

    const checks = {
      promptHash: sha256(promptBytes) === record.generation.prompt.sha256,
      referenceHashes: referenceBytes.every(
        (bytes, index) =>
          sha256(bytes) === record.generation.references[index].sha256,
      ),
      rawHash: sha256(rawBytes) === record.generation.raw.sha256,
      preparedHash: sha256(preparedBytes) === record.preparation.sha256,
      recordedPreparationHash:
        preparation.output.sha256 === record.preparation.sha256,
      exactDimensions:
        rawInfo.width === 1536 &&
        rawInfo.height === 1024 &&
        info.width === 1536 &&
        info.height === 1024,
      deterministicRepeat:
        sha256(firstBytes) === sha256(secondBytes) &&
        sha256(firstBytes) === sha256(preparedBytes),
      sixFixedCells: cells.length === 6,
      allCellsMechanicallySafe: cells.every(({ pass }) => pass),
    };
    const audit = {
      schemaVersion: 1,
      verdict: Object.values(checks).every(Boolean) ? "PASS" : "REJECT",
      scope:
        "deterministic prepared ingress only; semantic and production acceptance remain visual decisions",
      strictRaw: {
        literalMagentaRatio: literalMagenta / (rawInfo.width * rawInfo.height),
        keyableBackgroundRatio: keyable / (rawInfo.width * rawInfo.height),
        literalMattePass:
          literalMagenta / (rawInfo.width * rawInfo.height) >= 0.45,
      },
      hashes: {
        prompt: sha256(promptBytes),
        references: referenceBytes.map((bytes) => sha256(bytes)),
        raw: sha256(rawBytes),
        prepared: sha256(preparedBytes),
      },
      requestedEditInvariant,
      checks,
      cells,
    };
    await fs.mkdir(path.dirname(options.audit), { recursive: true });
    await fs.writeFile(options.audit, `${JSON.stringify(audit, null, 2)}\n`);
    await writeRuntimeSheet(
      preparedBytes,
      preparation,
      record,
      options.runtimeSheet,
    );
    process.stdout.write(
      `${record.id} ${audit.verdict}; ${cells.filter(({ pass }) => pass).length}/6 cells pass; raw literal magenta ${(audit.strictRaw.literalMagentaRatio * 100).toFixed(2)}%; prepared ${audit.hashes.prepared}\n`,
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
