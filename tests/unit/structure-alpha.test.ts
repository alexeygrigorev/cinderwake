import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  cleanStructurePixels,
  lightFringePixels,
} from "../../scripts/lib/structure-alpha.mjs";

describe("structure matte preparation", () => {
  it("rebuilds only structures deterministically and retains unrelated manifest entries", () => {
    const directory = mkdtempSync(join(tmpdir(), "cinderwake-structures-"));
    try {
      const preserved = { sha256: "sentinel", source: "untouched.png" };
      writeFileSync(
        join(directory, "build-manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          pipeline: "existing",
          outputs: { "untouched.png": preserved },
        }),
      );
      const script = fileURLToPath(
        new URL("../../scripts/build-sprite-assets.mjs", import.meta.url),
      );
      execFileSync(process.execPath, [
        script,
        "--structures-only",
        "--output-dir",
        directory,
      ]);
      expect(readdirSync(directory).sort()).toEqual([
        "build-manifest.json",
        "environment-structures.png",
      ]);
      const rebuilt = readFileSync(
        join(directory, "environment-structures.png"),
      );
      const shipped = readFileSync(
        new URL(
          "../../public/assets/sprites/environment-structures.png",
          import.meta.url,
        ),
      );
      expect(rebuilt.equals(shipped)).toBe(true);
      const manifest = JSON.parse(
        readFileSync(join(directory, "build-manifest.json"), "utf8"),
      );
      expect(manifest.pipeline).toBe("existing");
      expect(manifest.outputs["untouched.png"]).toEqual(preserved);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("removes both checkerboard colors and pale edge contamination while preserving interior stone and colored light", () => {
    const width = 20,
      height = 20;
    const input = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const value = (x + y) % 2 ? 231 : 254;
        input.set([value, value, value, 255], offset);
        if (x >= 4 && x < 16 && y >= 4 && y < 16)
          input.set([100, 95, 85, 255], offset);
      }
    }
    // Old light-key behavior left an almost-white, partially opaque fringe.
    const fringe = (4 * width + 8) * 4;
    input.set([210, 210, 210, 180], fringe);
    const stone = (10 * width + 10) * 4;
    input.set([205, 201, 195, 255], stone);
    const flame = (5 * width + 12) * 4;
    input.set([90, 238, 243, 255], flame);
    expect(lightFringePixels(input)).toBeGreaterThan(0);
    const output = cleanStructurePixels(input, width, height);
    expect(lightFringePixels(output)).toBe(0);
    expect([...output.subarray(stone, stone + 4)]).toEqual([
      205, 201, 195, 255,
    ]);
    expect([...output.subarray(flame, flame + 4)]).toEqual([90, 238, 243, 255]);
    for (let x = 0; x < width; x++) expect(output[x * 4 + 3]).toBe(0);
    expect(output[fringe]).toBeLessThan(120);
  });

  it("ships sixteen padded silhouettes with no checkerboard and a bounded light fringe", async () => {
    const file = new URL(
      "../../public/assets/sprites/environment-structures.png",
      import.meta.url,
    );
    const { data, info } = await sharp(readFileSync(file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1024, 1024]);
    let visible = 0;
    for (let offset = 3; offset < data.length; offset += 4)
      if (data[offset] > 0) visible++;
    // The rejected atlas had 10,444 such pixels (over 2% of visible ink).
    expect(lightFringePixels(data) / visible).toBeLessThan(0.01);
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        let ink = 0;
        for (let y = 0; y < 256; y++) {
          for (let x = 0; x < 256; x++) {
            const alpha =
              data[((row * 256 + y) * 1024 + column * 256 + x) * 4 + 3];
            if (alpha > 0) ink++;
            if (x < 5 || x >= 251 || y < 5 || y >= 251)
              expect(alpha, `cell ${row},${column} padding`).toBe(0);
          }
        }
        expect(ink).toBeGreaterThan(10_000);
      }
    }
    const manifest = JSON.parse(
      readFileSync(
        new URL(
          "../../public/assets/sprites/build-manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const entry = manifest.outputs["environment-structures.png"];
    expect(entry.source).toBe(
      "art/source/environment/structures-clean-source.png",
    );
    expect(entry.sha256).toBe(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
    );
    const source = readFileSync(
      new URL(
        "../../art/source/environment/structures-clean-source.png",
        import.meta.url,
      ),
    );
    expect(entry.sourceSha256).toBe(
      createHash("sha256").update(source).digest("hex"),
    );
  });
});
