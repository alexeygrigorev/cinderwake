import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const staged = path.join(
  root,
  "art/generation/prepared/vanguard-walk-v3-staged",
);
const spliceReport = JSON.parse(
  await fs.readFile(path.join(staged, "splice-report.json"), "utf8"),
);
const atlasSpliceReport = JSON.parse(
  await fs.readFile(
    path.join(staged, "atlas", "atlas-splice-report.json"),
    "utf8",
  ),
);
const decode = async (file, normalize = false) => {
  const source = sharp(file);
  if (normalize) source.resize(1024, 1024, { fit: "fill", kernel: "lanczos3" });
  const { data, info } = await source
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4, `${file} must decode to RGBA`);
  return { data, width: info.width, height: info.height };
};
const cell = (image, index, size = 256, columns = 4) => {
  const x = (index % columns) * size;
  const y = Math.floor(index / columns) * size;
  assert.ok(
    x + size <= image.width && y + size <= image.height,
    `cell ${index} exceeds ${image.width}x${image.height}`,
  );
  const rowBytes = size * 4;
  const result = Buffer.allocUnsafe(size * rowBytes);
  for (let row = 0; row < size; row += 1) {
    const start = ((y + row) * image.width + x) * 4;
    image.data.copy(result, row * rowBytes, start, start + rowBytes);
  }
  return result;
};
const equal = (left, right, label) => {
  if (!left.equals(right)) throw new Error(`${label} does not match`);
};
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const spliceRaw = (base, candidate, cells) => {
  const mixed = Buffer.from(base);
  for (const index of cells)
    for (let row = 0; row < 256; row += 1) {
      const offset =
        ((Math.floor(index / 4) * 256 + row) * 1024 + (index % 4) * 256) * 4;
      candidate.copy(mixed, offset, offset, offset + 256 * 4);
    }
  return mixed;
};
for (const [family, cells] of [
  ["source", [4, 5, 6, 7]],
  ["directions-source", [4, 5, 6, 7, 12, 13, 14, 15]],
]) {
  const base = path.join(root, `art/source/actors/vanguard-${family}.png`);
  const candidate = path.join(
    root,
    `art/generation/prepared/vanguard-${family === "source" ? "primary" : "directions"}-walk-v3.png`,
  );
  const mixed = path.join(staged, `vanguard-${family}.png`);
  const [baseImage, candidateImage, mixedImage] = await Promise.all([
    decode(base, true),
    decode(candidate),
    decode(mixed),
  ]);
  const reportFamily = family === "source" ? "primary" : "directions";
  const report = spliceReport.families.find(
    (entry) => entry.family === reportFamily,
  );
  assert.ok(report, `splice report is missing ${family}`);
  assert.equal(spliceReport.schemaVersion, 2);
  assert.deepEqual(spliceReport.normalization, {
    width: 1024,
    height: 1024,
    operation: "resize-square-before-grid-splice",
  });
  const mixedRaw = spliceRaw(baseImage.data, candidateImage.data, cells);
  assert.equal(sha256(baseImage.data), report.baseSha256);
  assert.equal(sha256(await fs.readFile(base)), report.baseSourceSha256);
  assert.deepEqual(report.baseSourceDimensions, { width: 1254, height: 1254 });
  assert.equal(sha256(mixedRaw), report.mixedSha256);
  equal(mixedImage.data, mixedRaw, `${family} staged raster`);
  for (const index of cells)
    equal(
      cell(mixedImage, index),
      cell(candidateImage, index),
      `${family} cell ${index} provenance`,
    );
}
const production = path.join(root, "public/assets/sprites/actor-vanguard.png");
const candidateAtlas = path.join(staged, "atlas/actor-vanguard.png");
const fullCandidateAtlas = path.join(
  staged,
  "atlas-candidate/actor-vanguard.png",
);
const [productionImage, candidateAtlasImage, fullCandidateAtlasImage] =
  await Promise.all([
    decode(production),
    decode(candidateAtlas),
    decode(fullCandidateAtlas),
  ]);
assert.deepEqual(atlasSpliceReport.rows, [1, 7, 9]);
assert.equal(
  atlasSpliceReport.base.sha256,
  sha256(await fs.readFile(production)),
);
assert.equal(
  atlasSpliceReport.candidate.sha256,
  sha256(
    await fs.readFile(
      path.join(staged, "atlas-candidate", "actor-vanguard.png"),
    ),
  ),
);
assert.equal(
  atlasSpliceReport.output.sha256,
  sha256(await fs.readFile(candidateAtlas)),
);
for (let row = 0; row < 20; row += 1)
  for (let column = 0; column < 8; column += 1) {
    if ([1, 7, 9].includes(row))
      equal(
        cell(candidateAtlasImage, row * 8 + column, 128, 8),
        cell(fullCandidateAtlasImage, row * 8 + column, 128, 8),
        `replaced runtime atlas ${row}:${column}`,
      );
    else
      equal(
        cell(candidateAtlasImage, row * 8 + column, 128, 8),
        cell(productionImage, row * 8 + column, 128, 8),
        `unaffected runtime atlas ${row}:${column}`,
      );
  }
console.log(
  "PASS Vanguard surgical splice: source normalization and atlas rows 1,7,9 are provenance-bound",
);
