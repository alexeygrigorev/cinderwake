import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";

it("ships a clear iron fence with transparent gaps, complete rails and no magenta spill", async () => {
  const file = new URL(
    "../../public/assets/sprites/iron-fence.png",
    import.meta.url,
  );
  const bytes = readFileSync(file);
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([1086, 471]);
  let keyedSpill = 0;
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const offset = pixel * 4;
    if (data[offset + 3] === 0) continue;
    if (Math.min(data[offset], data[offset + 2]) - data[offset + 1] > 28)
      keyedSpill++;
    const x = pixel % info.width,
      y = Math.floor(pixel / info.width);
    expect(x >= 2 && x < info.width - 2 && y >= 2 && y < info.height - 2).toBe(
      true,
    );
  }
  expect(keyedSpill).toBe(0);
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  for (const x of [150, 300, 450, 650, 800, 950]) {
    expect(alpha(x, 300), `open fence gap at x=${x}`).toBe(0);
    expect(alpha(x, 210), `upper rail at x=${x}`).toBeGreaterThan(200);
    expect(alpha(x, 405), `lower rail at x=${x}`).toBeGreaterThan(200);
  }
  const provenance = JSON.parse(
    readFileSync(
      new URL("../../art/generation/iron-fence-v1.json", import.meta.url),
      "utf8",
    ),
  );
  expect(provenance.output.sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
});

it("reproduces the standalone fence without rebuilding unrelated atlases", () => {
  const directory = mkdtempSync(join(tmpdir(), "cinderwake-fence-"));
  try {
    execFileSync(process.execPath, [
      fileURLToPath(
        new URL("../../scripts/build-sprite-assets.mjs", import.meta.url),
      ),
      "--fence-only",
      "--output-dir",
      directory,
    ]);
    expect(readdirSync(directory).sort()).toEqual([
      "build-manifest.json",
      "iron-fence.png",
    ]);
    expect(
      readFileSync(join(directory, "iron-fence.png")).equals(
        readFileSync(
          new URL(
            "../../public/assets/sprites/iron-fence.png",
            import.meta.url,
          ),
        ),
      ),
    ).toBe(true);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
