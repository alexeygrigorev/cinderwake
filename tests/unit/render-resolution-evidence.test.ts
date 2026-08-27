import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  evaluateRenderResolutionEvidence,
  expectedBackingStore,
  measurePngCropSharpness,
  runRenderResolutionNegativeControls,
} from "../../scripts/lib/render-resolution-evidence.mjs";
import type { RenderResolutionEvidenceInputV1 } from "../../scripts/lib/render-resolution-evidence.mjs";

type EvidenceFixture = Required<RenderResolutionEvidenceInputV1>;

function evidenceFixture(): EvidenceFixture {
  const geometrySamples = [
    {
      profileId: "desktop-dpr1",
      logicalViewport: { width: 960, height: 540 },
      css: { width: 960, height: 540 },
      backing: { width: 960, height: 540 },
      devicePixelRatio: 1,
      manifestDpr: 1,
    },
    {
      profileId: "phone-portrait-high-dpr",
      logicalViewport: { width: 960, height: 540 },
      css: { width: 1500.4375, height: 844 },
      backing: { width: 2880, height: 1620 },
      devicePixelRatio: 3,
      manifestDpr: 3,
    },
  ];
  const cropSamples = geometrySamples.flatMap(({ profileId, backing }) =>
    (["player", "terrain"] as const).map((role, index) => ({
      id: `${profileId}-${role}`,
      profileId,
      role,
      scenarioId: index === 0 ? "animation-idle" : "animation-walk",
      captureMode: "physical-canvas" as const,
      frameSize: { ...backing },
      crop: { x: 10 + index, y: 10, width: 32, height: 32 },
      blurMutation: "gaussian-blur-1.5",
      sharpness: {
        metric: "mean-absolute-laplacian-luma-v1",
        width: 32,
        height: 32,
        sampleCount: 900,
        meanAbsLaplacian: profileId === "desktop-dpr1" ? 20 : 8,
        highResidualRatio: 0.4,
      },
      blurredSharpness: {
        metric: "mean-absolute-laplacian-luma-v1",
        width: 32,
        height: 32,
        sampleCount: 900,
        meanAbsLaplacian: 2,
        highResidualRatio: 0.01,
      },
    })),
  );
  return { geometrySamples, cropSamples };
}

describe("render-resolution evidence", () => {
  it("mirrors the responsive backing-store policy", () => {
    expect(
      expectedBackingStore(evidenceFixture().geometrySamples[0]),
    ).toMatchObject({
      width: 960,
      height: 540,
      renderScale: 1,
    });
    expect(
      expectedBackingStore(evidenceFixture().geometrySamples[1]),
    ).toMatchObject({
      width: 2880,
      height: 1620,
      renderScale: 3,
    });
  });

  it("accepts a calibrated original-resolution crop corpus", () => {
    const result = evaluateRenderResolutionEvidence(evidenceFixture());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
    expect(result.calibration).toMatchObject({
      acceptedMinimumScore: 4,
      blurredControlMaximumScore: 1,
      threshold: 2.5,
      separation: 3,
    });
  });

  it.each([
    [
      "backing resolution",
      "backing-resolution-mismatch",
      (value: EvidenceFixture) => {
        value.geometrySamples[1]!.backing = { width: 960, height: 540 };
      },
    ],
    [
      "sharpness regression",
      "sharpness-regression",
      (value: EvidenceFixture) => {
        for (const sample of value.cropSamples)
          sample.sharpness.meanAbsLaplacian = 2;
      },
    ],
  ])("detects %s", (_name, expectedSignal, mutate) => {
    const value = evidenceFixture();
    mutate(value);

    const result = evaluateRenderResolutionEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedSignal);
  });

  it("detects every render-resolution mutation", () => {
    const controls = runRenderResolutionNegativeControls(evidenceFixture());

    expect(controls).toHaveLength(2);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
  });

  it("measures physical PNG crops and their blur mutation", async () => {
    const source = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(new Uint8Array(12 * 12 * 4).fill(255)),
          raw: { width: 12, height: 12, channels: 4 },
          left: 6,
          top: 6,
        },
      ])
      .png()
      .toBuffer();

    const result = await measurePngCropSharpness(source, {
      x: 4,
      y: 4,
      width: 16,
      height: 16,
    });

    expect(result.frameSize).toEqual({ width: 24, height: 24 });
    expect(result.crop).toEqual({ x: 4, y: 4, width: 16, height: 16 });
    expect(result.sharpness.metric).toBe("mean-absolute-laplacian-luma-v1");
    expect(result.sharpness.meanAbsLaplacian).toBeGreaterThan(
      result.blurredSharpness.meanAbsLaplacian,
    );
  });
});
