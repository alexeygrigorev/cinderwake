import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import sharp from "sharp";

const manifest = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const root = process.cwd();
const SOURCE_SIZE = 1024;
const CELL_SIZE = 256;
const CHANNELS = 4;
const output = path.resolve(root, manifest.output);
await fs.mkdir(output, { recursive: true });
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const readBase = async (file) => {
  const metadata = await sharp(file).metadata();
  assert(
    metadata.width &&
      metadata.height &&
      metadata.width === metadata.height &&
      metadata.width >= SOURCE_SIZE,
    `Base source must be square and at least ${SOURCE_SIZE}px; received ${metadata.width}x${metadata.height}`,
  );
  const source = await fs.readFile(file);
  const { data, info } = await sharp(file)
    .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(
    info.width === SOURCE_SIZE &&
      info.height === SOURCE_SIZE &&
      info.channels === CHANNELS,
    "Normalized base source must decode to RGBA 1024x1024",
  );
  return {
    data,
    sourceSha256: hash(source),
    sourceDimensions: { width: metadata.width, height: metadata.height },
  };
};
const readCandidate = async (file) => {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(
    info.width === SOURCE_SIZE &&
      info.height === SOURCE_SIZE &&
      info.channels === CHANNELS,
    `Replacement candidate must decode to RGBA ${SOURCE_SIZE}x${SOURCE_SIZE}; received ${info.width}x${info.height} with ${info.channels} channels`,
  );
  return data;
};
const splice = async (family) => {
  const base = await readBase(path.resolve(root, manifest.base[family]));
  const candidate = await readCandidate(
    path.resolve(root, manifest.replacement[family].candidate),
  );
  const changed = [...new Set(manifest.replacement[family].cells)];
  assert(
    changed.length > 0 &&
      changed.every(
        (cell) => Number.isSafeInteger(cell) && cell >= 0 && cell < 16,
      ),
    `${family} replacement cells must be unique integers from 0 through 15`,
  );
  const mixed = Buffer.from(base.data);
  for (const cell of changed)
    for (let y = 0; y < CELL_SIZE; y++) {
      const offset =
        ((Math.floor(cell / 4) * CELL_SIZE + y) * SOURCE_SIZE +
          (cell % 4) * CELL_SIZE) *
        CHANNELS;
      candidate.copy(mixed, offset, offset, offset + CELL_SIZE * CHANNELS);
    }
  const file = path.join(
    output,
    `vanguard-${family === "primary" ? "source" : "directions-source"}.png`,
  );
  await sharp(mixed, {
    raw: { width: SOURCE_SIZE, height: SOURCE_SIZE, channels: CHANNELS },
  })
    .png()
    .toFile(file);
  return {
    family,
    file: path.relative(root, file),
    changed,
    baseSha256: hash(base.data),
    baseSourceSha256: base.sourceSha256,
    baseSourceDimensions: base.sourceDimensions,
    mixedSha256: hash(mixed),
  };
};
const report = {
  schemaVersion: 2,
  id: manifest.id,
  normalization: {
    width: SOURCE_SIZE,
    height: SOURCE_SIZE,
    operation: "resize-square-before-grid-splice",
  },
  families: await Promise.all([splice("primary"), splice("directions")]),
};
await fs.writeFile(
  path.join(output, "splice-report.json"),
  await prettier.format(JSON.stringify(report, null, 2), { parser: "json" }),
);
