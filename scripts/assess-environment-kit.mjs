#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const execute = promisify(execFile);
const ROOT = process.cwd();
const CELL = 512;
const COLUMNS = 3;
const ROWS = 2;
const SAFE_MARGIN = 24;
const EXPECTED_BASELINE = 480;
const ALPHA_THRESHOLD = 24;

function parseArgs(argv) {
  const options = {
    record: path.join(ROOT, "art/generation/environment-kit-v1.json"),
    output: path.join(
      ROOT,
      "art/generation/environment-kit/evidence/environment-kit-v1",
    ),
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--record" && name !== "--output") || !value) {
      throw new Error(
        "Usage: node scripts/assess-environment-kit.mjs [--record <json>] [--output <directory>]",
      );
    }
    options[name.slice(2)] = path.resolve(ROOT, value);
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

function connectedComponents(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const neighbor of [
        pixel - 1,
        pixel + 1,
        pixel - width,
        pixel + width,
      ]) {
        if (
          neighbor < 0 ||
          neighbor >= mask.length ||
          seen[neighbor] ||
          !mask[neighbor]
        ) {
          continue;
        }
        const neighborX = neighbor % width;
        const neighborY = Math.floor(neighbor / width);
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({
      area,
      minX,
      minY,
      maxX,
      maxY,
      centroidX: sumX / area,
      centroidY: sumY / area,
    });
  }
  return components;
}

function boxGap(first, second) {
  const dx = Math.max(
    first.minX - second.maxX - 1,
    second.minX - first.maxX - 1,
    0,
  );
  const dy = Math.max(
    first.minY - second.maxY - 1,
    second.minY - first.maxY - 1,
    0,
  );
  return Math.hypot(dx, dy);
}

function analyzeRaw(data, info) {
  const pixels = info.width * info.height;
  const mask = new Uint8Array(pixels);
  let literalKeyPixels = 0;
  let keyablePixels = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const red = data[pixel * 3];
    const green = data[pixel * 3 + 1];
    const blue = data[pixel * 3 + 2];
    if (red === 255 && green === 0 && blue === 255) literalKeyPixels += 1;
    const alpha = keyedAlpha(red, green, blue);
    if (alpha < ALPHA_THRESHOLD) keyablePixels += 1;
    else mask[pixel] = 1;
  }
  const components = connectedComponents(mask, info.width, info.height);
  const primary = components
    .filter(({ area }) => area >= 10_000)
    .sort((left, right) => left.centroidY - right.centroidY);
  const ordered = [
    ...primary
      .slice(0, 3)
      .sort((left, right) => left.centroidX - right.centroidX),
    ...primary.slice(3).sort((left, right) => left.centroidX - right.centroidX),
  ];
  const requiredInsetX = Math.floor((info.width / COLUMNS) * 0.12);
  const requiredInsetY = Math.floor((info.height / ROWS) * 0.12);
  const cellCompliance = ordered.map((component, index) => {
    const left = (index % COLUMNS) * (info.width / COLUMNS);
    const top = Math.floor(index / COLUMNS) * (info.height / ROWS);
    const right = left + info.width / COLUMNS - 1;
    const bottom = top + info.height / ROWS - 1;
    const margins = {
      left: component.minX - left,
      top: component.minY - top,
      right: right - component.maxX,
      bottom: bottom - component.maxY,
    };
    return {
      index,
      bounds: [component.minX, component.minY, component.maxX, component.maxY],
      margins,
      requiredMargins: { x: requiredInsetX, y: requiredInsetY },
      pass:
        margins.left >= requiredInsetX &&
        margins.right >= requiredInsetX &&
        margins.top >= requiredInsetY &&
        margins.bottom >= requiredInsetY,
    };
  });
  let minimumGap = Number.POSITIVE_INFINITY;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      minimumGap = Math.min(minimumGap, boxGap(ordered[left], ordered[right]));
    }
  }
  const checks = [
    {
      id: "dimensions-3-to-2",
      pass: info.width === 1536 && info.height === 1024,
      value: `${info.width}x${info.height}`,
    },
    {
      id: "six-primary-components",
      pass: ordered.length === 6,
      value: ordered.length,
    },
    {
      id: "literal-chroma-background",
      pass: literalKeyPixels / pixels >= 0.45,
      value: literalKeyPixels / pixels,
    },
    {
      id: "deterministically-keyable-background",
      pass: keyablePixels / pixels >= 0.45,
      value: keyablePixels / pixels,
    },
    {
      id: "separated-component-boxes",
      pass: minimumGap >= 24,
      value: minimumGap,
    },
    {
      id: "declared-12-percent-cell-padding",
      pass:
        cellCompliance.length === 6 && cellCompliance.every(({ pass }) => pass),
      value: cellCompliance.filter(({ pass }) => pass).length,
    },
  ];
  return {
    pass: checks.every(({ pass }) => pass),
    checks,
    literalKeyRatio: literalKeyPixels / pixels,
    keyableRatio: keyablePixels / pixels,
    minimumPrimaryGap: minimumGap,
    primaryComponents: ordered,
    cellCompliance,
  };
}

function cellBounds(data, width, index) {
  const offsetX = (index % COLUMNS) * CELL;
  const offsetY = Math.floor(index / COLUMNS) * CELL;
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const alpha = data[((offsetY + y) * width + offsetX + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, area };
}

function supportEvidence(data, width, index, bounds) {
  const offsetX = (index % COLUMNS) * CELL;
  const offsetY = Math.floor(index / COLUMNS) * CELL;
  const height = bounds.maxY - bounds.minY + 1;
  const band = Math.max(3, Math.ceil(height * 0.05));
  let minX = CELL;
  let maxX = -1;
  let pixels = 0;
  for (let y = bounds.maxY - band + 1; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const alpha = data[((offsetY + y) * width + offsetX + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      pixels += 1;
    }
  }
  const widthPixels = Math.max(0, maxX - minX + 1);
  return {
    band,
    minX,
    maxX,
    pixels,
    width: widthPixels,
    widthRatio: widthPixels / (bounds.maxX - bounds.minX + 1),
  };
}

function doorwayAperture(data, width, bounds) {
  const samples = [];
  const startY = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.48);
  const endY = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.72);
  const centerStart = Math.round(
    bounds.minX + (bounds.maxX - bounds.minX) * 0.25,
  );
  const centerEnd = Math.round(
    bounds.minX + (bounds.maxX - bounds.minX) * 0.75,
  );
  for (let y = startY; y <= endY; y += 1) {
    let current = 0;
    let widest = 0;
    for (let x = centerStart; x <= centerEnd; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) {
        current += 1;
        widest = Math.max(widest, current);
      } else current = 0;
    }
    samples.push(widest);
  }
  const sorted = samples.sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    medianTransparentWidth: median,
    widthRatio: median / (bounds.maxX - bounds.minX + 1),
  };
}

function analyzePrepared(data, info, cells) {
  const violations = [];
  if (
    info.width !== CELL * COLUMNS ||
    info.height !== CELL * ROWS ||
    info.channels !== 4
  ) {
    violations.push("prepared-dimensions");
  }
  let opaquePixels = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] >= ALPHA_THRESHOLD) opaquePixels += 1;
  }
  if (opaquePixels / (info.width * info.height) > 0.55)
    violations.push("opaque-matte");

  const cellEvidence = cells.map((cell, index) => {
    const bounds = cellBounds(data, info.width, index);
    if (bounds.maxX < bounds.minX) {
      violations.push(`cell-${index}-blank`);
      return { ...cell, bounds, pass: false };
    }
    const width = bounds.maxX - bounds.minX + 1;
    const height = bounds.maxY - bounds.minY + 1;
    const margins = {
      left: bounds.minX,
      top: bounds.minY,
      right: CELL - 1 - bounds.maxX,
      bottom: CELL - 1 - bounds.maxY,
    };
    if (Math.min(...Object.values(margins)) < SAFE_MARGIN) {
      violations.push(`cell-${index}-unsafe-border`);
    }
    if (Math.abs(bounds.maxY - EXPECTED_BASELINE) > 2) {
      violations.push(`cell-${index}-foot-anchor-drift`);
    }
    const support = supportEvidence(data, info.width, index, bounds);
    if (support.widthRatio < 0.12 || support.widthRatio > 0.88) {
      violations.push(`cell-${index}-collision-footprint`);
    }
    const runtimeScale = cell.runtimeHeight / height;
    const runtime = {
      width: Number((width * runtimeScale).toFixed(2)),
      height: cell.runtimeHeight,
      silhouetteArea: Math.round(bounds.area * runtimeScale * runtimeScale),
      supportWidth: Number((support.width * runtimeScale).toFixed(2)),
      suggestedCollisionHalfWidth: Number(
        Math.max(
          5,
          Math.min(
            width * runtimeScale * 0.36,
            support.width * runtimeScale * 0.44,
          ),
        ).toFixed(2),
      ),
    };
    if (
      runtime.width < 20 ||
      runtime.silhouetteArea < 350 ||
      runtime.supportWidth < 7
    ) {
      violations.push(`cell-${index}-runtime-silhouette`);
    }
    const aperture =
      index === 0 ? doorwayAperture(data, info.width, bounds) : undefined;
    if (aperture && aperture.widthRatio < 0.16)
      violations.push("cell-0-doorway-aperture");
    return {
      ...cell,
      bounds,
      margins,
      support,
      runtime,
      aperture,
      safeToIntegrate: false,
      pass:
        Math.min(...Object.values(margins)) >= SAFE_MARGIN &&
        Math.abs(bounds.maxY - EXPECTED_BASELINE) <= 2 &&
        support.widthRatio >= 0.12 &&
        support.widthRatio <= 0.88 &&
        runtime.width >= 20 &&
        runtime.silhouetteArea >= 350 &&
        runtime.supportWidth >= 7 &&
        (!aperture || aperture.widthRatio >= 0.16),
    };
  });
  return {
    pass: violations.length === 0,
    violations: [...new Set(violations)],
    opaqueRatio: opaquePixels / (info.width * info.height),
    cells: cellEvidence,
  };
}

function mutatePrepared(source, id) {
  const data = Buffer.from(source);
  const width = CELL * COLUMNS;
  if (id === "opaque-gray-matte") {
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] >= ALPHA_THRESHOLD) continue;
      data[offset] = 52;
      data[offset + 1] = 48;
      data[offset + 2] = 50;
      data[offset + 3] = 255;
    }
  } else if (id === "cell-border-bleed") {
    for (let x = 0; x < CELL; x += 1) {
      const offset = (8 * width + x) * 4;
      data[offset] = 180;
      data[offset + 1] = 90;
      data[offset + 2] = 30;
      data[offset + 3] = 255;
    }
  } else if (id === "cross-cell-bridge") {
    for (let x = CELL - 10; x <= CELL + 10; x += 1) {
      const offset = (300 * width + x) * 4;
      data[offset] = 130;
      data[offset + 1] = 80;
      data[offset + 2] = 40;
      data[offset + 3] = 255;
    }
  } else if (id === "floating-foot-anchor") {
    const original = Buffer.from(data);
    const cellIndex = 3;
    const offsetX = (cellIndex % COLUMNS) * CELL;
    const offsetY = Math.floor(cellIndex / COLUMNS) * CELL;
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        data.fill(
          0,
          ((offsetY + y) * width + offsetX + x) * 4,
          ((offsetY + y) * width + offsetX + x) * 4 + 4,
        );
      }
    }
    for (let y = 20; y < CELL; y += 1) {
      const sourceStart = ((offsetY + y) * width + offsetX) * 4;
      const targetStart = ((offsetY + y - 20) * width + offsetX) * 4;
      original.copy(data, targetStart, sourceStart, sourceStart + CELL * 4);
    }
  } else if (id === "needle-contact-footprint") {
    const cellIndex = 4;
    const offsetX = (cellIndex % COLUMNS) * CELL;
    const offsetY = Math.floor(cellIndex / COLUMNS) * CELL;
    for (let y = EXPECTED_BASELINE - 24; y <= EXPECTED_BASELINE; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        const offset = ((offsetY + y) * width + offsetX + x) * 4;
        data[offset + 3] = 0;
      }
    }
    for (let y = EXPECTED_BASELINE - 24; y <= EXPECTED_BASELINE; y += 1) {
      const offset = ((offsetY + y) * width + offsetX + 256) * 4;
      data[offset] = 80;
      data[offset + 1] = 60;
      data[offset + 2] = 40;
      data[offset + 3] = 255;
    }
  }
  return data;
}

async function cellPng(preparedData, preparedInfo, index) {
  return sharp(preparedData, { raw: preparedInfo })
    .extract({
      left: (index % COLUMNS) * CELL,
      top: Math.floor(index / COLUMNS) * CELL,
      width: CELL,
      height: CELL,
    })
    .png()
    .toBuffer();
}

async function writeEvidence(
  output,
  preparedData,
  preparedInfo,
  assessment,
  controls,
) {
  await fs.mkdir(output, { recursive: true });
  const floor = await sharp(
    path.join(ROOT, "public/assets/sprites/environment-floor.png"),
  )
    .resize(960, 420, { fit: "cover" })
    .modulate({ brightness: 0.58, saturation: 0.58 })
    .ensureAlpha()
    .png()
    .toBuffer();
  const runtimeComposites = [];
  for (let index = 0; index < assessment.cells.length; index += 1) {
    const evidence = assessment.cells[index];
    const cell = await cellPng(preparedData, preparedInfo, index);
    const cut = await sharp(cell)
      .extract({
        left: evidence.bounds.minX,
        top: evidence.bounds.minY,
        width: evidence.bounds.maxX - evidence.bounds.minX + 1,
        height: evidence.bounds.maxY - evidence.bounds.minY + 1,
      })
      .resize({
        height: evidence.runtime.height,
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
    const metadata = await sharp(cut).metadata();
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const centerX = column * 320 + 160;
    const baseline = row === 0 ? 196 : 398;
    runtimeComposites.push({
      input: cut,
      left: Math.round(centerX - metadata.width / 2),
      top: baseline - metadata.height,
    });
  }
  await sharp(floor)
    .composite(runtimeComposites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(output, "runtime-scale-contact-sheet.png"));

  await sharp(preparedData, { raw: preparedInfo })
    .resize(768, 512, { kernel: sharp.kernel.lanczos3 })
    .flatten({ background: "#151116" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(output, "prepared-cuts-contact-sheet.png"));

  const mutationComposites = [];
  for (let index = 0; index < controls.length; index += 1) {
    const mutation = mutatePrepared(preparedData, controls[index].id);
    const image = await sharp(mutation, { raw: preparedInfo })
      .resize(384, 256)
      .flatten({ background: "#151116" })
      .png()
      .toBuffer();
    mutationComposites.push({
      input: image,
      left: (index % 2) * 384,
      top: Math.floor(index / 2) * 256,
    });
  }
  await sharp({
    create: {
      width: 768,
      height: Math.ceil(controls.length / 2) * 256,
      channels: 3,
      background: "#151116",
    },
  })
    .composite(mutationComposites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(output, "negative-controls-contact-sheet.png"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const record = JSON.parse(await fs.readFile(options.record, "utf8"));
  const rawPath = path.join(ROOT, record.generation.raw.file);
  const preparedPath = path.join(ROOT, record.preparation.file);
  const [rawBytes, preparedBytes] = await Promise.all([
    fs.readFile(rawPath),
    fs.readFile(preparedPath),
  ]);
  if (sha256(rawBytes) !== record.generation.raw.sha256)
    throw new Error("Raw hash is stale");
  if (sha256(preparedBytes) !== record.preparation.sha256) {
    throw new Error("Prepared hash is stale");
  }
  for (const source of [
    record.generation.prompt,
    ...record.generation.references,
  ]) {
    const bytes = await fs.readFile(path.join(ROOT, source.file));
    if (sha256(bytes) !== source.sha256)
      throw new Error(`${source.file} hash is stale`);
  }

  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-environment-kit-"),
  );
  const first = path.join(temp, "first.png");
  const second = path.join(temp, "second.png");
  try {
    for (const output of [first, second]) {
      await execute(process.execPath, [
        path.join(ROOT, "scripts/prepare-environment-kit.mjs"),
        "--input",
        rawPath,
        "--output",
        output,
      ]);
    }
    const [firstBytes, secondBytes] = await Promise.all([
      fs.readFile(first),
      fs.readFile(second),
    ]);
    if (
      sha256(firstBytes) !== sha256(secondBytes) ||
      sha256(firstBytes) !== record.preparation.sha256
    ) {
      throw new Error(
        "Preparation is not byte-identical to the recorded artifact",
      );
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }

  const raw = await sharp(rawBytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const prepared = await sharp(preparedBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rawAssessment = analyzeRaw(raw.data, raw.info);
  const preparedAssessment = analyzePrepared(
    prepared.data,
    prepared.info,
    record.grid.cells,
  );
  const controlDefinitions = [
    { id: "opaque-gray-matte", expectedViolation: "opaque-matte" },
    { id: "cell-border-bleed", expectedViolation: "cell-0-unsafe-border" },
    { id: "cross-cell-bridge", expectedViolation: "cell-0-unsafe-border" },
    {
      id: "floating-foot-anchor",
      expectedViolation: "cell-3-foot-anchor-drift",
    },
    {
      id: "needle-contact-footprint",
      expectedViolation: "cell-4-collision-footprint",
    },
  ];
  const negativeControls = controlDefinitions.map((control) => {
    const mutated = mutatePrepared(prepared.data, control.id);
    const assessment = analyzePrepared(
      mutated,
      prepared.info,
      record.grid.cells,
    );
    return {
      ...control,
      detected: assessment.violations.includes(control.expectedViolation),
      violations: assessment.violations,
    };
  });
  const controlsPass = negativeControls.every(({ detected }) => detected);
  const expectedQuarantine =
    (!rawAssessment.pass || !preparedAssessment.pass) &&
    record.review.evaluation === "rejected" &&
    record.review.productionApproved === false &&
    controlsPass;
  const report = {
    schemaVersion: 1,
    id: record.id,
    status: expectedQuarantine ? "rejected-as-recorded" : "audit-failed",
    promotionApproved: false,
    sources: {
      record: path.relative(ROOT, options.record),
      raw: { file: record.generation.raw.file, sha256: sha256(rawBytes) },
      prepared: {
        file: record.preparation.file,
        sha256: sha256(preparedBytes),
      },
      floorPreview: {
        file: "public/assets/sprites/environment-floor.png",
        sha256: sha256(
          await fs.readFile(
            path.join(ROOT, "public/assets/sprites/environment-floor.png"),
          ),
        ),
      },
    },
    deterministicPreparation: { pass: true, reproductions: 2 },
    rawAssessment,
    preparedAssessment,
    negativeControls,
    visualReview: record.review,
    integration: {
      safeCells: 0,
      totalCells: record.grid.cells.length,
      note: "Five prepared cells pass the mechanical proxies and the doorway fails usable-aperture width; no cell is integration-safe while the shared raw and visual verdict remains rejected.",
    },
  };

  await fs.mkdir(options.output, { recursive: true });
  await writeEvidence(
    options.output,
    prepared.data,
    prepared.info,
    preparedAssessment,
    negativeControls,
  );
  await fs.writeFile(
    path.join(options.output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const cellRows = preparedAssessment.cells
    .map(
      (cell) =>
        `<tr><td>${escapeHtml(cell.id)}</td><td>${cell.bounds.maxX - cell.bounds.minX + 1}×${cell.bounds.maxY - cell.bounds.minY + 1}</td><td>${cell.runtime.width}×${cell.runtime.height}</td><td>${cell.runtime.supportWidth}</td><td class="${cell.pass ? "pass" : "fail"}">${cell.pass ? "PASS" : "FAIL"}</td><td>REJECTED</td></tr>`,
    )
    .join("");
  const rawRows = rawAssessment.checks
    .map(
      (check) =>
        `<li class="${check.pass ? "pass" : "fail"}">${check.pass ? "PASS" : "FAIL"}: ${escapeHtml(check.id)} — ${escapeHtml(check.value)}</li>`,
    )
    .join("");
  const controls = negativeControls
    .map(
      (control) =>
        `<li class="${control.detected ? "pass" : "fail"}">${control.detected ? "CAUGHT" : "MISSED"}: ${escapeHtml(control.id)} → ${escapeHtml(control.expectedViolation)}</li>`,
    )
    .join("");
  const failures = record.review.failures
    .map((failure) => `<li>${escapeHtml(failure)}</li>`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cinderwake environment-kit candidate audit</title><style>body{max-width:1100px;margin:2rem auto;padding:0 1rem;background:#100d0e;color:#eadfce;font:16px/1.5 system-ui}img{max-width:100%;height:auto;border:1px solid #5e4741}code{color:#efbd70}.pass{color:#9ed8aa}.fail,.reject{color:#ef8d83}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;border:1px solid #5e4741;text-align:left}figure{margin:1.5rem 0}figcaption{color:#bba99d}</style></head><body><h1>Environment-kit candidate v1</h1><p class="reject"><strong>REJECTED / QUARANTINED.</strong> The art is materially more coordinated than the current mixed scene, but the raw raster violates the frozen chroma, cell-padding, shared-scale, and repeatable-wall requirements. No cell is safe to integrate independently because all six share one rejected source contract.</p><p>Raw <code>${report.sources.raw.sha256}</code><br>Prepared <code>${report.sources.prepared.sha256}</code><br>Built-in artifact <code>${escapeHtml(record.generation.artifactId)}</code></p><h2>Raw contract</h2><ul>${rawRows}</ul><h2>Prepared mechanics and runtime scale</h2><p>The deterministic recovery reproduces byte-identically. Five cells pass the safe-border, common-foot, silhouette, and contact-footprint proxies; the doorway fails the minimum usable-aperture proxy at its narrowed arch. These checks prove recoverability and expose collision ambiguity; they do not grant production approval.</p><table><thead><tr><th>Cell</th><th>Prepared ink</th><th>Runtime silhouette</th><th>Runtime support width</th><th>Mechanical</th><th>Integration</th></tr></thead><tbody>${cellRows}</tbody></table><figure><a href="runtime-scale-contact-sheet.png"><img src="runtime-scale-contact-sheet.png" alt="Six candidate components shown at their declared runtime heights on the current floor"></a><figcaption>Runtime-scale comparison on the current floor. Independent per-component scaling repairs presentation size, but it cannot make the raw shared-scale claim true.</figcaption></figure><figure><a href="prepared-cuts-contact-sheet.png"><img src="prepared-cuts-contact-sheet.png" alt="Deterministically prepared three by two component cuts"></a><figcaption>Prepared transparent cuts, flattened only for this review image.</figcaption></figure><h2>Visual rejection</h2><ul>${failures}</ul><h2>Paired negative controls</h2><ul>${controls}</ul><figure><a href="negative-controls-contact-sheet.png"><img src="negative-controls-contact-sheet.png" alt="Five deliberately damaged environment kit atlases"></a><figcaption>Opaque matte, border bleed, cross-cell bridge, floating foot, and needle-footprint mutations. The report evaluates mutated pixels through the same prepared assessor.</figcaption></figure><p>${escapeHtml(record.review.decision)}</p></body></html>`;
  await fs.writeFile(path.join(options.output, "index.html"), html);

  if (!expectedQuarantine)
    throw new Error("Environment-kit quarantine audit did not reproduce");
  process.stdout.write(
    `Environment kit rejected reproducibly: raw ${rawAssessment.checks.filter(({ pass }) => pass).length}/${rawAssessment.checks.length} checks pass, prepared ${preparedAssessment.cells.filter(({ pass }) => pass).length}/6 cells mechanically pass, ${negativeControls.filter(({ detected }) => detected).length}/${negativeControls.length} bad controls caught, 0/6 cells integration-safe.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
