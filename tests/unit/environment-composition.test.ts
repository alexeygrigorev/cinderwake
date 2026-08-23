import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = process.cwd();
let outputRoot: string;
let report: {
  status: string;
  scopeNote: string;
  deterministicRepeatSha256Match: boolean;
  production: {
    pass: boolean;
    decals: {
      pass: boolean;
      cells: Array<{
        boundingBoxFillRatio: number;
        safeBorderInkPixels: number;
        violations: string[];
      }>;
    };
    floor: {
      pass: boolean;
      dimensions: { width: number; height: number; tilePixels: number };
      boundaryToInteriorRatio: number;
      edgeBandToCoreRatio: number;
      repeatedTileFraction: number;
      violations: string[];
    };
  };
  negativeControls: Array<{
    id: string;
    expectedViolation: string;
    detected: boolean;
    violations: string[];
  }>;
  artifacts: Record<string, { sha256: string; bytes: number }>;
};

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
  outputRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-environment-composition-"),
  );
  await run(
    process.execPath,
    [
      path.join(root, "scripts", "assess-environment-composition.mjs"),
      "--output",
      outputRoot,
    ],
    { cwd: root, timeout: 30_000 },
  );
  report = JSON.parse(
    await fs.readFile(path.join(outputRoot, "report.json"), "utf8"),
  );
});

afterAll(async () => {
  await fs.rm(outputRoot, { recursive: true, force: true });
});

describe("environment composition quality gate", () => {
  it("passes real decal alpha and runtime floor-composition pixels", () => {
    expect(report.status).toBe("pass");
    expect(report.production.pass).toBe(true);
    expect(report.production.decals.pass).toBe(true);
    expect(report.production.decals.cells).toHaveLength(16);
    expect(
      report.production.decals.cells.every(
        ({ safeBorderInkPixels, violations }) =>
          safeBorderInkPixels === 0 && violations.length === 0,
      ),
    ).toBe(true);
    expect(report.production.floor).toMatchObject({
      pass: true,
      dimensions: { width: 960, height: 720, tilePixels: 48 },
      violations: [],
    });
    expect(report.deterministicRepeatSha256Match).toBe(true);
    expect(report.scopeNote).toContain("does not prove");
  });

  it("proves each detector with a paired mutation of committed raster pixels", () => {
    expect(report.negativeControls).toEqual([
      expect.objectContaining({
        id: "decal-opaque-matte",
        expectedViolation: "opaque-rectangular-matte",
        detected: true,
      }),
      expect.objectContaining({
        id: "decal-cross-cell",
        expectedViolation: "cross-cell-boundary-ink",
        detected: true,
      }),
      expect.objectContaining({
        id: "floor-square-seams",
        expectedViolation: "square-floor-seams",
        detected: true,
      }),
      expect.objectContaining({
        id: "floor-obvious-repeat",
        expectedViolation: "obvious-repeated-floor-tiles",
        detected: true,
      }),
    ]);
    for (const control of report.negativeControls)
      expect(control.violations).toContain(control.expectedViolation);
  });

  it("writes hash-bound PNG and readable HTML evidence", async () => {
    const expectedPngs = [
      "floor-composition.png",
      "decal-composition.png",
      "decal-alpha-evidence.png",
      "mutations/decal-opaque-matte.png",
      "mutations/decal-cross-cell.png",
      "mutations/floor-square-seams.png",
      "mutations/floor-obvious-repeat.png",
    ];
    for (const relativePath of expectedPngs) {
      const bytes = await fs.readFile(path.join(outputRoot, relativePath));
      expect(report.artifacts[relativePath]).toEqual({
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBeGreaterThan(300);
      expect(metadata.height).toBeGreaterThan(200);
    }
    const html = await fs.readFile(path.join(outputRoot, "index.html"), "utf8");
    expect(html).toContain("Environment composition evidence");
    expect(html).toContain("Paired negative controls");
    expect(html).toContain("does not prove");
  });
});
