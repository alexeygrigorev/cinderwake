import { describe, expect, it } from "vitest";
import {
  assessSpriteLeakSample,
  evaluateSpriteLeakEvidence,
  runSpriteLeakNegativeControls,
} from "../../scripts/lib/sprite-leak-evidence.mjs";

function sampleFixture() {
  const width = 8;
  const height = 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 2; y < 6; y += 1)
    for (let x = 2; x < 6; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 80;
      rgba[offset + 1] = 120;
      rgba[offset + 2] = 160;
      rgba[offset + 3] = 255;
    }
  return {
    id: "fixture:actor:idle:0",
    width,
    height,
    rgba,
    cell: { x: 16, y: 32, width, height },
    sourceRect: { x: 16, y: 32, width, height },
    transparentBorder: { left: 2, top: 2, right: 2, bottom: 2 },
  };
}

describe("sprite leak evidence", () => {
  it("accepts a clean cell with a transparent contract border", () => {
    const assessment = assessSpriteLeakSample(sampleFixture());

    expect(assessment.pass).toBe(true);
    expect(assessment.failures).toEqual([]);
    expect(assessment.metrics).toMatchObject({
      inkPixels: 16,
      borderPixels: 48,
      borderInkPixels: 0,
      opaqueMattePixels: 0,
      fringePixels: 0,
      sourceRectInsideCell: true,
      sourceRectMatchesCell: true,
    });
  });

  it("detects every named cell, matte, and fringe mutation", () => {
    const controls = runSpriteLeakNegativeControls(sampleFixture());

    expect(controls).toHaveLength(3);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "cross-cell-ink-detected",
      "opaque-matte-detected",
      "colored-fringe-detected",
    ]);
  });

  it("aggregates all cells and rejects an empty corpus", () => {
    const clean = evaluateSpriteLeakEvidence({ samples: [sampleFixture()] });
    const empty = evaluateSpriteLeakEvidence({ samples: [] });

    expect(clean.pass).toBe(true);
    expect(clean.signals.every(({ pass }) => pass)).toBe(true);
    expect(empty.pass).toBe(false);
    expect(empty.signals.every(({ pass }) => !pass)).toBe(true);
  });

  it("reports a shifted source crop without requiring pixel heuristics", () => {
    const sample = sampleFixture();
    sample.sourceRect.x += 1;

    const assessment = assessSpriteLeakSample(sample);

    expect(assessment.pass).toBe(false);
    expect(assessment.failures.map(({ code }) => code)).toContain(
      "cross-cell-ink-detected",
    );
    expect(assessment.metrics.sourceRectInsideCell).toBe(false);
    expect(assessment.metrics.sourceRectMatchesCell).toBe(false);
  });
});
