import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const ROOT = process.cwd();
const MANIFEST_CONTRACT = "CinderwakeIsolatedPoseAssemblyV1";
const REPORT_CONTRACT = "CinderwakeIsolatedPoseAssemblyReportV1";
const ACTOR_CONTRACT_ID = "ActorAtlasV2";
const MAGENTA = { r: 255, g: 0, b: 255, alpha: 1 };
const HASH_PATTERN = /^[a-f\d]{64}$/;
const FORBIDDEN_CELL_FIELDS = new Set([
  "scale",
  "scaleX",
  "scaleY",
  "resize",
  "transform",
]);
const REQUIRED_VISUAL_AXES = [
  "identity-and-style",
  "anatomy-and-proportion",
  "pose-semantics",
  "animation-continuity",
  "grounding-and-contact",
  "raster-cleanliness",
];

function usage() {
  console.log(`Usage: node scripts/assemble-actor-source.mjs --manifest <json> --output <png> --report <json>

Builds one deterministic 4x4 ActorAtlasV2 source sheet from hash-bound
inherited cells and isolated raw poses. Isolated poses all use one shared
uniform scale and the contract-derived source-space foot anchor.`);
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      usage();
      process.exit(0);
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (!["--manifest", "--output", "--report"].includes(name))
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    options[name.slice(2)] = path.resolve(ROOT, value);
  }
  for (const name of ["manifest", "output", "report"])
    assert(options[name], `--${name} is required`);
  assert(
    new Set([options.manifest, options.output, options.report]).size === 3,
    "Manifest, output, and report paths must be distinct",
  );
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertObject(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
}

function assertString(value, label) {
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
}

function assertHash(value, label) {
  assert(
    typeof value === "string" && HASH_PATTERN.test(value),
    `${label} must be a lowercase SHA-256 hash`,
  );
}

function assertExactKeys(value, allowedKeys, label) {
  assertObject(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value))
    assert(allowed.has(key), `${label} contains unknown field "${key}"`);
  for (const key of allowedKeys)
    assert(Object.hasOwn(value, key), `${label}.${key} is required`);
}

function assertAllowedKeys(value, allowedKeys, label) {
  assertObject(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value))
    assert(allowed.has(key), `${label} contains unknown field "${key}"`);
}

function findForbiddenField(value, location = "cell") {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_CELL_FIELDS.has(key)) return { field: key, location };
    const result = findForbiddenField(nested, `${location}.${key}`);
    if (result) return result;
  }
  return null;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function displayPath(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative && !relative.startsWith(`..${path.sep}`)
    ? relative.split(path.sep).join("/")
    : filePath;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function resolveManifestFile(manifestPath, declaredPath, label) {
  assertString(declaredPath, label);
  if (path.isAbsolute(declaredPath)) return path.normalize(declaredPath);
  return declaredPath.startsWith("./")
    ? path.resolve(path.dirname(manifestPath), declaredPath)
    : path.resolve(ROOT, declaredPath);
}

async function readFileRecord(manifestPath, declaration, label, fileCache) {
  assertExactKeys(declaration, ["file", "sha256"], label);
  assertHash(declaration.sha256, `${label}.sha256`);
  const filePath = resolveManifestFile(
    manifestPath,
    declaration.file,
    `${label}.file`,
  );
  let contents = fileCache.get(filePath);
  if (!contents) {
    try {
      contents = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(`${label}.file does not exist`, { cause: error });
      throw error;
    }
    fileCache.set(filePath, contents);
  }
  assert(contents.length > 0, `${label}.file is empty`);
  const actualSha256 = sha256(contents);
  assert(
    actualSha256 === declaration.sha256,
    `${label}.sha256 mismatch: expected ${declaration.sha256}, received ${actualSha256}`,
  );
  return {
    contents,
    file: displayPath(filePath),
    filePath,
    sha256: actualSha256,
  };
}

function keyedAlpha(red, green, blue) {
  const magentaDominance = Math.min(red, blue) - green;
  const magentaBalance = Math.abs(red - blue);
  if (magentaDominance >= 28 && magentaBalance <= 110) return 0;
  if (magentaDominance > 12 && magentaBalance < 130)
    return Math.max(0, Math.round(((28 - magentaDominance) / 16) * 255));
  const distance = Math.hypot(255 - red, green, 255 - blue);
  if (distance <= 24) return 0;
  if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
  return 255;
}

async function normalizedKeyedPose(contents, normalizedInputSize, label) {
  const metadata = await sharp(contents).metadata();
  assert(
    metadata.width &&
      metadata.height &&
      metadata.width === metadata.height &&
      metadata.width >= normalizedInputSize,
    `${label} must be square and at least ${normalizedInputSize}px; received ${metadata.width}x${metadata.height}`,
  );
  const { data, info } = await sharp(contents)
    .resize(normalizedInputSize, normalizedInputSize, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset + 3] = Math.min(
      data[offset + 3],
      keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
    );
    if (data[offset + 3] < 24) {
      data[offset + 3] = 0;
      continue;
    }
    const spill = Math.max(
      0,
      Math.min(data[offset], data[offset + 2]) - data[offset + 1] - 14,
    );
    data[offset] = Math.max(0, Math.round(data[offset] - spill * 0.88));
    data[offset + 2] = Math.max(0, Math.round(data[offset + 2] - spill * 0.88));
  }
  return {
    buffer: await sharp(data, { raw: info }).png().toBuffer(),
    normalizedInput: {
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      width: info.width,
      height: info.height,
    },
  };
}

async function removeBoundaryArtifacts(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[start * 4 + 3] < 24) continue;
    const queue = [start];
    const pixels = [];
    let touchesBoundary = false;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      pixels.push(pixel);
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1)
        touchesBoundary = true;
      for (const neighbor of [
        pixel - 1,
        pixel + 1,
        pixel - info.width,
        pixel + info.width,
      ]) {
        if (
          neighbor < 0 ||
          neighbor >= pixelCount ||
          visited[neighbor] ||
          data[neighbor * 4 + 3] < 24
        )
          continue;
        if (Math.abs((neighbor % info.width) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ pixels, touchesBoundary });
  }
  assert(components.length > 0, "isolated pose is blank after chroma keying");
  const largest = Math.max(...components.map(({ pixels }) => pixels.length));
  const minimumUsefulComponent = Math.max(8, Math.floor(largest * 0.0005));
  for (const component of components) {
    if (component.pixels.length === largest) continue;
    if (
      !component.touchesBoundary &&
      component.pixels.length >= minimumUsefulComponent
    )
      continue;
    for (const pixel of component.pixels) data[pixel * 4 + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function alphaBounds(buffer, label) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 24) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  assert(right >= left && bottom >= top, `${label} is blank`);
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

async function validateContract(contractRecord) {
  let contract;
  try {
    contract = JSON.parse(contractRecord.contents.toString("utf8"));
  } catch (error) {
    throw new Error("actorContract.file is not valid JSON", { cause: error });
  }
  assert(
    contract.schemaVersion === 2 && contract.id === ACTOR_CONTRACT_ID,
    `actorContract.file must declare ${ACTOR_CONTRACT_ID} schemaVersion 2`,
  );
  const source = contract.source;
  assertObject(source, "actorContract.source");
  assert(
    source.pixelWidth === 1024 &&
      source.pixelHeight === 1024 &&
      source.columns === 4 &&
      source.rows === 4 &&
      source.cellWidth === 256 &&
      source.cellHeight === 256 &&
      source.background?.toLowerCase() === "#ff00ff",
    "actorContract.file must define the literal-magenta 1024x1024 4x4 source grid",
  );
  const atlas = contract.atlas;
  assertObject(atlas, "actorContract.atlas");
  for (const field of ["footAnchor", "safeInkBounds"])
    assertObject(atlas[field], `actorContract.atlas.${field}`);
  const sourceScale = source.cellWidth / atlas.cellWidth;
  assert(
    Number.isFinite(sourceScale) && sourceScale > 0,
    "actor source scale is invalid",
  );
  const safeInkBounds = {
    x: atlas.safeInkBounds.x * sourceScale,
    y: atlas.safeInkBounds.y * sourceScale,
    width: atlas.safeInkBounds.width * sourceScale,
    height: atlas.safeInkBounds.height * sourceScale,
  };
  const footAnchor = {
    x: atlas.footAnchor.x * sourceScale,
    y: atlas.footAnchor.y * sourceScale,
  };
  for (const [label, value] of [
    ["safeInkBounds.x", safeInkBounds.x],
    ["safeInkBounds.y", safeInkBounds.y],
    ["safeInkBounds.width", safeInkBounds.width],
    ["safeInkBounds.height", safeInkBounds.height],
    ["footAnchor.x", footAnchor.x],
    ["footAnchor.y", footAnchor.y],
  ])
    assert(
      Number.isSafeInteger(value),
      `contract-derived ${label} must be an integer`,
    );
  assert(
    footAnchor.x >= safeInkBounds.x &&
      footAnchor.x <= safeInkBounds.x + safeInkBounds.width &&
      footAnchor.y >= safeInkBounds.y &&
      footAnchor.y <= safeInkBounds.y + safeInkBounds.height,
    "contract-derived foot anchor must be inside source safe bounds",
  );
  return { contract, footAnchor, safeInkBounds, sourceScale };
}

async function validateBaseSheetMargins(contents, contract, safeInkBounds) {
  const { data, info } = await sharp(contents)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const localX = x % contract.source.cellWidth;
      const localY = y % contract.source.cellHeight;
      const insideSafeBounds =
        localX >= safeInkBounds.x &&
        localX < safeInkBounds.x + safeInkBounds.width &&
        localY >= safeInkBounds.y &&
        localY < safeInkBounds.y + safeInkBounds.height;
      if (insideSafeBounds) continue;
      const offset = (y * info.width + x) * 4;
      assert(
        data[offset] === 255 &&
          data[offset + 1] === 0 &&
          data[offset + 2] === 255 &&
          data[offset + 3] === 255,
        `baseSheet.file has a non-magenta pixel outside source safe bounds at ${x},${y}`,
      );
    }
  }
}

async function validateReferenceList(
  manifestPath,
  references,
  label,
  fileCache,
) {
  assert(
    Array.isArray(references) && references.length > 0,
    `${label} must not be empty`,
  );
  const records = [];
  for (const [index, reference] of references.entries()) {
    const referenceLabel = `${label}[${index}]`;
    assertExactKeys(reference, ["file", "sha256", "role"], referenceLabel);
    assertString(reference.role, `${referenceLabel}.role`);
    const fileRecord = await readFileRecord(
      manifestPath,
      { file: reference.file, sha256: reference.sha256 },
      referenceLabel,
      fileCache,
    );
    records.push({
      file: fileRecord.file,
      sha256: fileRecord.sha256,
      role: reference.role,
    });
  }
  return records;
}

function assertSharedGenerationContext(cells) {
  const first = cells[0];
  const expectedPrefix = JSON.stringify(first.commonPromptPrefix.declared);
  const expectedReferences = JSON.stringify(first.references.declared);
  for (const cell of cells.slice(1)) {
    assert(
      JSON.stringify(cell.commonPromptPrefix.declared) === expectedPrefix,
      `cell ${cell.index} commonPromptPrefix does not match the shared isolated-pose prefix`,
    );
    assert(
      JSON.stringify(cell.references.declared) === expectedReferences,
      `cell ${cell.index} references do not match the shared ordered reference set`,
    );
  }
}

function validateVisualReview(visualReview, outputSha256) {
  assertExactKeys(
    visualReview,
    ["verdict", "reviewer", "reviewedPreparedSha256", "axes"],
    "visualReview",
  );
  assert(
    visualReview.verdict === "ACCEPT" || visualReview.verdict === "REJECT",
    "visualReview.verdict must be ACCEPT or REJECT",
  );
  assertString(visualReview.reviewer, "visualReview.reviewer");
  assertHash(
    visualReview.reviewedPreparedSha256,
    "visualReview.reviewedPreparedSha256",
  );
  assert(
    visualReview.reviewedPreparedSha256 === outputSha256,
    "visualReview.reviewedPreparedSha256 does not match assembled output hash",
  );
  assert(
    Array.isArray(visualReview.axes) &&
      visualReview.axes.length === REQUIRED_VISUAL_AXES.length,
    `visualReview.axes must contain exactly ${REQUIRED_VISUAL_AXES.length} required axes`,
  );
  const axes = visualReview.axes.map((record, index) => {
    const label = `visualReview.axes[${index}]`;
    assertExactKeys(record, ["axis", "verdict", "notes"], label);
    assert(
      record.axis === REQUIRED_VISUAL_AXES[index],
      `${label}.axis must be "${REQUIRED_VISUAL_AXES[index]}"`,
    );
    assert(
      record.verdict === "ACCEPT" || record.verdict === "REJECT",
      `${label}.verdict must be ACCEPT or REJECT`,
    );
    assertString(record.notes, `${label}.notes`);
    return structuredClone(record);
  });
  const rejectedAxes = axes.filter(({ verdict }) => verdict === "REJECT");
  assert(
    visualReview.verdict === "ACCEPT"
      ? rejectedAxes.length === 0
      : rejectedAxes.length > 0,
    "visualReview.verdict must agree with its axis verdicts",
  );
  return {
    verdict: visualReview.verdict,
    reviewer: visualReview.reviewer,
    reviewedPreparedSha256: visualReview.reviewedPreparedSha256,
    axes,
  };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(options.manifest, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("--manifest must contain valid JSON", { cause: error });
    throw error;
  }
  assertAllowedKeys(
    manifest,
    [
      "schemaVersion",
      "contract",
      "id",
      "actorId",
      "sourceFamily",
      "actorContract",
      "styleBrief",
      "baseSheet",
      "cells",
      "preparedSha256",
      "visualReview",
    ],
    "manifest",
  );
  for (const key of [
    "schemaVersion",
    "contract",
    "id",
    "actorId",
    "sourceFamily",
    "actorContract",
    "styleBrief",
    "cells",
  ])
    assert(Object.hasOwn(manifest, key), `manifest.${key} is required`);
  assert(manifest.schemaVersion === 1, "manifest.schemaVersion must be 1");
  assert(
    manifest.contract === MANIFEST_CONTRACT,
    `manifest.contract must be ${MANIFEST_CONTRACT}`,
  );
  for (const key of ["id", "actorId", "sourceFamily"])
    assertString(manifest[key], `manifest.${key}`);

  const fileCache = new Map();
  const actorContract = await readFileRecord(
    options.manifest,
    manifest.actorContract,
    "actorContract",
    fileCache,
  );
  const { contract, footAnchor, safeInkBounds, sourceScale } =
    await validateContract(actorContract);
  const styleBrief = await readFileRecord(
    options.manifest,
    manifest.styleBrief,
    "styleBrief",
    fileCache,
  );

  let baseSheet = null;
  if (manifest.baseSheet) {
    baseSheet = await readFileRecord(
      options.manifest,
      manifest.baseSheet,
      "baseSheet",
      fileCache,
    );
    const metadata = await sharp(baseSheet.contents).metadata();
    assert(
      metadata.width === contract.source.pixelWidth &&
        metadata.height === contract.source.pixelHeight,
      `baseSheet.file must be ${contract.source.pixelWidth}x${contract.source.pixelHeight}`,
    );
    await validateBaseSheetMargins(baseSheet.contents, contract, safeInkBounds);
  }

  assert(Array.isArray(manifest.cells), "manifest.cells must be an array");
  assert(
    manifest.cells.length === 16,
    "manifest.cells must contain exactly 16 cells",
  );
  const seenIndexes = new Set();
  const cellDeclarations = [];
  for (const [declarationIndex, cell] of manifest.cells.entries()) {
    const label = `manifest.cells[${declarationIndex}]`;
    assertObject(cell, label);
    const forbidden = findForbiddenField(cell, label);
    assert(
      !forbidden,
      `${forbidden?.location} contains forbidden per-cell field "${forbidden?.field}"`,
    );
    assertExactKeys(cell, ["index", "semanticRole", "source"], label);
    assert(
      Number.isSafeInteger(cell.index) && cell.index >= 0 && cell.index < 16,
      `${label}.index must be an integer from 0 through 15`,
    );
    assert(
      !seenIndexes.has(cell.index),
      `manifest.cells contains duplicate cell ${cell.index}`,
    );
    seenIndexes.add(cell.index);
    assertString(cell.semanticRole, `${label}.semanticRole`);
    assertObject(cell.source, `${label}.source`);
    assert(
      cell.source.kind === "inherited" || cell.source.kind === "isolated",
      `${label}.source.kind must be inherited or isolated`,
    );
    if (cell.source.kind === "inherited") {
      assertExactKeys(cell.source, ["kind", "baseCell"], `${label}.source`);
      assert(
        baseSheet,
        `${label} is inherited but manifest.baseSheet is not declared`,
      );
      assert(
        Number.isSafeInteger(cell.source.baseCell) &&
          cell.source.baseCell >= 0 &&
          cell.source.baseCell < 16,
        `${label}.source.baseCell must be an integer from 0 through 15`,
      );
    } else {
      assertExactKeys(
        cell.source,
        [
          "kind",
          "raw",
          "prompt",
          "commonPromptPrefix",
          "references",
          "generation",
        ],
        `${label}.source`,
      );
    }
    cellDeclarations.push(cell);
  }
  assert(
    seenIndexes.size === 16 &&
      [...seenIndexes].every((index) => index >= 0 && index < 16),
    "manifest.cells must cover every cell index from 0 through 15 exactly once",
  );

  const isolatedCells = [];
  const inheritedCells = [];
  for (const cell of cellDeclarations) {
    const label = `cell ${cell.index}`;
    if (cell.source.kind === "inherited") {
      inheritedCells.push(cell);
      continue;
    }
    const raw = await readFileRecord(
      options.manifest,
      cell.source.raw,
      `${label}.raw`,
      fileCache,
    );
    const prompt = await readFileRecord(
      options.manifest,
      cell.source.prompt,
      `${label}.prompt`,
      fileCache,
    );
    const commonPromptPrefix = await readFileRecord(
      options.manifest,
      cell.source.commonPromptPrefix,
      `${label}.commonPromptPrefix`,
      fileCache,
    );
    assert(
      prompt.contents
        .toString("utf8")
        .startsWith(commonPromptPrefix.contents.toString("utf8")),
      `${label}.prompt must begin with the exact common prompt prefix`,
    );
    const references = await validateReferenceList(
      options.manifest,
      cell.source.references,
      `${label}.references`,
      fileCache,
    );
    assertExactKeys(
      cell.source.generation,
      ["tool", "artifactId"],
      `${label}.generation`,
    );
    assertString(cell.source.generation.tool, `${label}.generation.tool`);
    assertString(
      cell.source.generation.artifactId,
      `${label}.generation.artifactId`,
    );
    const normalized = await normalizedKeyedPose(
      raw.contents,
      contract.source.pixelWidth,
      `${label}.raw.file`,
    );
    const cleaned = await removeBoundaryArtifacts(normalized.buffer);
    const rawBounds = await alphaBounds(cleaned, `${label}.raw.file`);
    isolatedCells.push({
      index: cell.index,
      semanticRole: cell.semanticRole,
      raw,
      prompt,
      commonPromptPrefix: {
        ...commonPromptPrefix,
        declared: cell.source.commonPromptPrefix,
      },
      references: {
        records: references,
        declared: cell.source.references,
      },
      generation: structuredClone(cell.source.generation),
      normalizedInput: normalized.normalizedInput,
      cleaned,
      rawBounds,
    });
  }
  assert(
    isolatedCells.length > 0,
    "manifest.cells must contain at least one isolated pose",
  );
  assertSharedGenerationContext(isolatedCells);

  const maximumCleanedWidth = Math.max(
    ...isolatedCells.map(({ rawBounds }) => rawBounds.width),
  );
  const maximumCleanedHeight = Math.max(
    ...isolatedCells.map(({ rawBounds }) => rawBounds.height),
  );
  const sharedScale = Math.min(
    safeInkBounds.width / maximumCleanedWidth,
    safeInkBounds.height / maximumCleanedHeight,
    1,
  );
  assert(
    Number.isFinite(sharedScale) && sharedScale > 0,
    "shared scale is invalid",
  );

  const renderedIsolated = new Map();
  for (const cell of isolatedCells) {
    const width = Math.max(1, Math.round(cell.rawBounds.width * sharedScale));
    const height = Math.max(1, Math.round(cell.rawBounds.height * sharedScale));
    const sprite = await sharp(cell.cleaned)
      .extract(cell.rawBounds)
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    const left = Math.round(footAnchor.x - width / 2);
    const top = footAnchor.y - height;
    assert(
      left >= safeInkBounds.x &&
        top >= safeInkBounds.y &&
        left + width <= safeInkBounds.x + safeInkBounds.width &&
        top + height <= safeInkBounds.y + safeInkBounds.height,
      `cell ${cell.index} prepared pose leaves source-space safe bounds`,
    );
    const buffer = await sharp({
      create: {
        width: contract.source.cellWidth,
        height: contract.source.cellHeight,
        channels: 4,
        background: MAGENTA,
      },
    })
      .composite([{ input: sprite, left, top }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    renderedIsolated.set(cell.index, {
      ...cell,
      buffer,
      preparedBounds: { left, top, width, height },
    });
  }

  const inheritedBuffers = new Map();
  for (const cell of inheritedCells) {
    const baseCell = cell.source.baseCell;
    const buffer = await sharp(baseSheet.contents)
      .extract({
        left: (baseCell % contract.source.columns) * contract.source.cellWidth,
        top:
          Math.floor(baseCell / contract.source.columns) *
          contract.source.cellHeight,
        width: contract.source.cellWidth,
        height: contract.source.cellHeight,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    inheritedBuffers.set(cell.index, buffer);
  }

  const composites = cellDeclarations.map((cell) => ({
    input:
      cell.source.kind === "isolated"
        ? renderedIsolated.get(cell.index).buffer
        : inheritedBuffers.get(cell.index),
    left: (cell.index % contract.source.columns) * contract.source.cellWidth,
    top:
      Math.floor(cell.index / contract.source.columns) *
      contract.source.cellHeight,
  }));
  const outputBuffer = await sharp({
    create: {
      width: contract.source.pixelWidth,
      height: contract.source.pixelHeight,
      channels: 4,
      background: MAGENTA,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const outputSha256 = sha256(outputBuffer);
  if (manifest.preparedSha256 !== undefined) {
    assertHash(manifest.preparedSha256, "manifest.preparedSha256");
    assert(
      manifest.preparedSha256 === outputSha256,
      `manifest.preparedSha256 mismatch: expected ${manifest.preparedSha256}, received ${outputSha256}`,
    );
  }
  const visualReview = manifest.visualReview
    ? validateVisualReview(manifest.visualReview, outputSha256)
    : null;
  for (const inputPath of fileCache.keys())
    assert(
      options.output !== inputPath && options.report !== inputPath,
      `Output and report cannot overwrite manifest input ${displayPath(inputPath)}`,
    );

  const reportCells = cellDeclarations
    .toSorted((left, right) => left.index - right.index)
    .map((cell) => {
      if (cell.source.kind === "inherited")
        return {
          index: cell.index,
          semanticRole: cell.semanticRole,
          mode: "inherited",
          baseCell: cell.source.baseCell,
          effectiveScale: 1,
          sourceRegion: {
            left:
              (cell.source.baseCell % contract.source.columns) *
              contract.source.cellWidth,
            top:
              Math.floor(cell.source.baseCell / contract.source.columns) *
              contract.source.cellHeight,
            width: contract.source.cellWidth,
            height: contract.source.cellHeight,
          },
          preparedRegion: {
            left:
              (cell.index % contract.source.columns) *
              contract.source.cellWidth,
            top:
              Math.floor(cell.index / contract.source.columns) *
              contract.source.cellHeight,
            width: contract.source.cellWidth,
            height: contract.source.cellHeight,
          },
        };
      const rendered = renderedIsolated.get(cell.index);
      return {
        index: cell.index,
        semanticRole: cell.semanticRole,
        mode: "isolated",
        effectiveScale: Number(sharedScale.toFixed(8)),
        input: {
          raw: { file: rendered.raw.file, sha256: rendered.raw.sha256 },
          prompt: {
            file: rendered.prompt.file,
            sha256: rendered.prompt.sha256,
          },
          commonPromptPrefix: {
            file: rendered.commonPromptPrefix.file,
            sha256: rendered.commonPromptPrefix.sha256,
          },
          references: rendered.references.records,
          generation: rendered.generation,
          normalizedDimensions: rendered.normalizedInput,
        },
        rawBounds: rendered.rawBounds,
        preparedBounds: rendered.preparedBounds,
      };
    });
  const report = {
    schemaVersion: 1,
    contract: REPORT_CONTRACT,
    manifest: {
      file: displayPath(options.manifest),
      sha256: sha256(await fs.readFile(options.manifest)),
      id: manifest.id,
      actorId: manifest.actorId,
      sourceFamily: manifest.sourceFamily,
    },
    inputs: {
      actorContract: {
        file: actorContract.file,
        sha256: actorContract.sha256,
        id: contract.id,
      },
      styleBrief: { file: styleBrief.file, sha256: styleBrief.sha256 },
      baseSheet: baseSheet
        ? { file: baseSheet.file, sha256: baseSheet.sha256 }
        : null,
    },
    assembly: {
      outputSize: {
        width: contract.source.pixelWidth,
        height: contract.source.pixelHeight,
      },
      grid: {
        columns: contract.source.columns,
        rows: contract.source.rows,
        cellWidth: contract.source.cellWidth,
        cellHeight: contract.source.cellHeight,
      },
      literalBackground: contract.source.background.toLowerCase(),
      sourceScale,
      footAnchor,
      safeInkBounds,
      sharedIsolatedPoseScale: Number(sharedScale.toFixed(8)),
      maximumCleanedIsolatedPose: {
        width: maximumCleanedWidth,
        height: maximumCleanedHeight,
      },
      inheritedCells: inheritedCells.length,
      isolatedCells: isolatedCells.length,
      cells: reportCells,
    },
    output: {
      file: displayPath(options.output),
      sha256: outputSha256,
      declaredPreparedSha256: manifest.preparedSha256 ?? null,
    },
    artReview: visualReview
      ? { status: visualReview.verdict, ...visualReview }
      : {
          status: "UNREVIEWED",
          reason:
            "Mechanical assembly succeeded, but no exact-hash visual review was declared.",
        },
    reproductionCommand: [
      "node",
      "scripts/assemble-actor-source.mjs",
      "--manifest",
      displayPath(options.manifest),
      "--output",
      displayPath(options.output),
      "--report",
      displayPath(options.report),
    ]
      .map(shellQuote)
      .join(" "),
  };

  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.mkdir(path.dirname(options.report), { recursive: true });
  await fs.writeFile(options.output, outputBuffer);
  await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Assembled ${manifest.id}: ${isolatedCells.length} isolated + ${inheritedCells.length} inherited cells, shared scale ${Number(sharedScale.toFixed(8))}, SHA-256 ${outputSha256}, art ${report.artReview.status}.`,
  );
}

run().catch((error) => {
  console.error(`Actor pose assembly failed: ${error.message}`);
  process.exitCode = 1;
});
