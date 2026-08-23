import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import manifest from "../art/generation/selection-v2.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const temporaryRoot = checkOnly
  ? await mkdtemp(path.join(tmpdir(), "cinderwake-selection-"))
  : undefined;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

try {
  for (const asset of manifest.assets) {
    const candidate = path.join(root, asset.candidateFile);
    const candidateBytes = await readFile(candidate);
    if (sha256(candidateBytes) !== asset.candidateSha256)
      throw new Error(`${asset.id} selection candidate hash is stale`);

    const output = checkOnly
      ? path.join(temporaryRoot, path.basename(asset.productionFile))
      : path.join(root, asset.productionFile);
    await mkdir(path.dirname(output), { recursive: true });
    await sharp(candidate)
      .resize({
        width: manifest.transformation.resize.width,
        withoutEnlargement: manifest.transformation.resize.withoutEnlargement,
      })
      .webp({
        quality: manifest.transformation.quality,
        smartSubsample: manifest.transformation.smartSubsample,
      })
      .toFile(output);

    const outputBytes = await readFile(output);
    if (sha256(outputBytes) !== asset.productionSha256)
      throw new Error(`${asset.id} selection production hash is stale`);
  }
  console.log(
    `${checkOnly ? "Verified" : "Built"} ${manifest.assets.length} deterministic selection sprites.`,
  );
} finally {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}
