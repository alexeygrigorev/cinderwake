import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  RANGER_DIRECTION_ACTIONS_SHA256,
  RANGER_RELEASE_CELL_SHA256,
  removeRangerDetachedArrow,
  prepareRangerProjectileAtlas,
} from "../../scripts/lib/ranger-projectile-preparation.mjs";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const atlasFile = new URL(
  "../../public/assets/sprites/actor-ranger.png",
  import.meta.url,
);
const originalCell = () =>
  sharp(
    readFileSync(
      new URL(
        "../../art/generation/ranger-north-attack/before-cell.png",
        import.meta.url,
      ),
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();

describe("Ranger detached projectile preparation", () => {
  it("does not apply a reviewed pixel mask to a different isolated generation candidate", async () => {
    const candidate = readFileSync(atlasFile);
    expect(
      await prepareRangerProjectileAtlas(candidate, "unreviewed-source", {
        candidateOutput: true,
      }),
    ).toEqual(candidate);
    await expect(
      prepareRangerProjectileAtlas(candidate, "unreviewed-source"),
    ).rejects.toThrow(/art changed/);
  });
  it("removes only the two detached components without moving or recoloring the actor and bow", async () => {
    const before = await originalCell();
    expect(hash(before)).toBe(RANGER_RELEASE_CELL_SHA256);
    const after = removeRangerDetachedArrow(
      before,
      RANGER_DIRECTION_ACTIONS_SHA256,
    );
    let changed = 0;
    for (let pixel = 0; pixel < 128 * 128; pixel++) {
      const offset = pixel * 4,
        x = pixel % 128;
      if (x <= 92 || before[offset + 3] === 0)
        expect(after.subarray(offset, offset + 4)).toEqual(
          before.subarray(offset, offset + 4),
        );
      else {
        expect([...after.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 0]);
        changed++;
      }
    }
    expect(changed).toBe(28);
    for (const column of [2, 3]) {
      const shipped = await sharp(readFileSync(atlasFile))
        .extract({ left: column * 128, top: 1280, width: 128, height: 128 })
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(shipped.equals(after)).toBe(true);
    }
  });

  it("fails closed if the source, arrow component, or actor/bow pixels change", async () => {
    const before = await originalCell();
    expect(() => removeRangerDetachedArrow(before, "changed-source")).toThrow(
      /art changed/,
    );
    for (const [x, y] of [
      [64, 50],
      [108, 39],
      [115, 39],
    ]) {
      const mutation = Buffer.from(before);
      mutation.set([255, 220, 180, 255], (y * 128 + x) * 4);
      expect(() =>
        removeRangerDetachedArrow(mutation, RANGER_DIRECTION_ACTIONS_SHA256),
      ).toThrow(/cell changed/);
    }
  });

  it("preserves every atlas pixel outside the 56 removed projectile pixels", async () => {
    const { data: after, info } = await sharp(readFileSync(atlasFile))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const baseline = Buffer.from(after),
      beforeCell = await originalCell();
    for (const column of [2, 3])
      for (let y = 0; y < 128; y++)
        beforeCell.copy(
          baseline,
          ((1280 + y) * 1024 + column * 128) * 4,
          y * 128 * 4,
          (y + 1) * 128 * 4,
        );
    const record = JSON.parse(
      readFileSync(
        new URL(
          "../../art/generation/ranger-north-attack/v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(hash(baseline)).toBe(record.baseline.decodedRgbaSha256);
    const prepared = await prepareRangerProjectileAtlas(
      await sharp(baseline, { raw: info }).png().toBuffer(),
      RANGER_DIRECTION_ACTIONS_SHA256,
    );
    const decoded = await sharp(prepared).ensureAlpha().raw().toBuffer();
    expect(decoded.equals(after)).toBe(true);
    let changed = 0;
    for (let offset = 0; offset < after.length; offset += 4)
      if (
        !after
          .subarray(offset, offset + 4)
          .equals(baseline.subarray(offset, offset + 4))
      )
        changed++;
    expect(changed).toBe(56);
  });

  it("rebuilds only Ranger deterministically and preserves unrelated manifest entries", () => {
    const directory = mkdtempSync(join(tmpdir(), "cinderwake-ranger-prep-"));
    try {
      const untouched = { sha256: "sentinel", source: "untouched.png" };
      writeFileSync(
        join(directory, "build-manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          pipeline: "existing",
          outputs: { "untouched.png": untouched },
        }),
      );
      execFileSync(process.execPath, [
        fileURLToPath(
          new URL("../../scripts/build-sprite-assets.mjs", import.meta.url),
        ),
        "--ranger-only",
        "--output-dir",
        directory,
      ]);
      expect(readdirSync(directory).sort()).toEqual([
        "actor-ranger.png",
        "build-manifest.json",
      ]);
      expect(
        readFileSync(join(directory, "actor-ranger.png")).equals(
          readFileSync(atlasFile),
        ),
      ).toBe(true);
      const manifest = JSON.parse(
        readFileSync(join(directory, "build-manifest.json"), "utf8"),
      );
      expect(manifest.outputs["untouched.png"]).toEqual(untouched);
      expect(manifest.pipeline).toBe("existing");
    } finally {
      rmSync(directory, { recursive: true });
    }
  }, 30_000);
});
