import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const manifest = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const root = process.cwd();
const output = path.resolve(root, manifest.output);
await fs.mkdir(output, { recursive: true });
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const splice = async (family) => {
  const base = await sharp(path.resolve(root, manifest.base[family])).ensureAlpha().raw().toBuffer();
  const candidate = await sharp(path.resolve(root, manifest.replacement[family].candidate)).ensureAlpha().raw().toBuffer();
  const mixed = Buffer.from(base);
  const changed = new Set(manifest.replacement[family].cells);
  for (const cell of changed) for (let y = 0; y < 256; y++) {
    const offset = ((Math.floor(cell / 4) * 256 + y) * 1024 + (cell % 4) * 256) * 4;
    candidate.copy(mixed, offset, offset, offset + 256 * 4);
  }
  const file = path.join(output, `vanguard-${family === "primary" ? "source" : "directions-source"}.png`);
  await sharp(mixed, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toFile(file);
  return { family, file: path.relative(root, file), changed: [...changed], baseSha256: hash(base), mixedSha256: hash(mixed) };
};
const report = { schemaVersion: 1, id: manifest.id, families: await Promise.all([splice("primary"), splice("directions")]) };
await fs.writeFile(path.join(output, "splice-report.json"), `${JSON.stringify(report, null, 2)}\n`);
