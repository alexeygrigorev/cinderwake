import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import prettier from "prettier";
import sharp from "sharp";

const ROOT = process.cwd();
const ATLAS_WIDTH = 1024;
const ATLAS_HEIGHT = 2560;
const ATLAS_ROW_HEIGHT = 128;
const CHANNELS = 4;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveFile(manifestPath, declaredPath, label) {
  assert(
    typeof declaredPath === "string" && declaredPath.trim().length > 0,
    `${label} must be a non-empty path`,
  );
  return declaredPath.startsWith("./")
    ? path.resolve(path.dirname(manifestPath), declaredPath)
    : path.resolve(ROOT, declaredPath);
}

function relativeFile(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readAtlas(file, label) {
  const source = await fs.readFile(file);
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(
    info.width === ATLAS_WIDTH &&
      info.height === ATLAS_HEIGHT &&
      info.channels === CHANNELS,
    `${label} must decode to RGBA ${ATLAS_WIDTH}x${ATLAS_HEIGHT}; received ${info.width}x${info.height} with ${info.channels} channels`,
  );
  return {
    data,
    fileSha256: sha256(source),
    decodedSha256: sha256(data),
  };
}

function parseManifest(manifestPath, manifest) {
  assert(
    manifest.schemaVersion === 1,
    "Atlas splice manifest schemaVersion must be 1",
  );
  for (const key of ["id", "base", "candidate", "output", "report", "rows"])
    assert(
      Object.hasOwn(manifest, key),
      `Atlas splice manifest.${key} is required`,
    );
  assert(
    typeof manifest.id === "string" && manifest.id.length > 0,
    "Atlas splice manifest.id is required",
  );
  assert(
    Array.isArray(manifest.rows) && manifest.rows.length > 0,
    "Atlas splice manifest.rows must not be empty",
  );
  const rows = [...new Set(manifest.rows)];
  assert(
    rows.length === manifest.rows.length &&
      rows.every(
        (row) =>
          Number.isSafeInteger(row) &&
          row >= 0 &&
          row < ATLAS_HEIGHT / ATLAS_ROW_HEIGHT,
      ),
    `Atlas splice rows must be unique integers from 0 through ${ATLAS_HEIGHT / ATLAS_ROW_HEIGHT - 1}`,
  );
  const files = Object.fromEntries(
    ["base", "candidate", "output", "report"].map((key) => [
      key,
      resolveFile(manifestPath, manifest[key], `manifest.${key}`),
    ]),
  );
  assert(
    files.output !== files.base && files.output !== files.candidate,
    "Atlas splice output must not overwrite an input",
  );
  assert(
    files.output !== files.report,
    "Atlas splice output and report must be distinct",
  );
  assert(
    files.report !== files.base && files.report !== files.candidate,
    "Atlas splice report must not overwrite an input",
  );
  return { ...files, id: manifest.id, rows };
}

const manifestPath = path.resolve(ROOT, process.argv[2] ?? "");
assert(
  process.argv[2],
  "Usage: node scripts/splice-actor-atlas.mjs <manifest>",
);
let manifest;
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch (error) {
  throw new Error("Atlas splice manifest must contain valid JSON", {
    cause: error,
  });
}
const options = parseManifest(manifestPath, manifest);
const [base, candidate] = await Promise.all([
  readAtlas(options.base, "Base atlas"),
  readAtlas(options.candidate, "Candidate atlas"),
]);
const mixed = Buffer.from(base.data);
const rowBytes = ATLAS_WIDTH * ATLAS_ROW_HEIGHT * CHANNELS;
for (const row of options.rows) {
  const offset = row * rowBytes;
  candidate.data.copy(mixed, offset, offset, offset + rowBytes);
}
const outputBuffer = await sharp(mixed, {
  raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: CHANNELS },
})
  // Keep the copied rows byte-identical after decode. Palette quantization can
  // alter pixels in untouched rows even when the raw splice itself is exact.
  .png({ compressionLevel: 9 })
  .toBuffer();
await fs.mkdir(path.dirname(options.output), { recursive: true });
await fs.mkdir(path.dirname(options.report), { recursive: true });
await fs.writeFile(options.output, outputBuffer);
const outputSource = await fs.readFile(options.output);
const report = {
  schemaVersion: 1,
  id: options.id,
  grid: {
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    rowHeight: ATLAS_ROW_HEIGHT,
    channels: CHANNELS,
  },
  rows: options.rows,
  base: {
    file: relativeFile(options.base),
    sha256: base.fileSha256,
    decodedSha256: base.decodedSha256,
  },
  candidate: {
    file: relativeFile(options.candidate),
    sha256: candidate.fileSha256,
    decodedSha256: candidate.decodedSha256,
  },
  output: {
    file: relativeFile(options.output),
    sha256: sha256(outputSource),
    decodedSha256: sha256(mixed),
  },
  reproductionCommand: `node scripts/splice-actor-atlas.mjs ${relativeFile(manifestPath)}`,
};
await fs.writeFile(
  options.report,
  await prettier.format(JSON.stringify(report, null, 2), { parser: "json" }),
);
console.log(
  `Spliced ${options.rows.length} runtime atlas rows for ${options.id}: SHA-256 ${report.output.sha256}.`,
);
