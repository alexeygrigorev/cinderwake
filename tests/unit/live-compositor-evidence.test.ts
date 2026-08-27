import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  evaluateLiveCompositorEvidence,
  measurePngResidual,
  runLiveCompositorNegativeControls,
} from "../../scripts/lib/compositor-evidence.mjs";

type EffectKind = "slash" | "nova" | "impact";

function liveFixture() {
  const ownerPaints = [
    { ownerId: "player", bodyPaintCount: 1 },
    { ownerId: "monster:ashfang", bodyPaintCount: 1 },
  ];
  const liveSamples = Array.from({ length: 32 }, (_, index) => ({
    observedAtMs: index * 16.667,
    tick: 100 + Math.floor(index / 2),
    presentationTick: 100 + index / 2,
    expectedOwnerIds: ["monster:ashfang", "player"],
    observedOwnerIds: ["monster:ashfang", "player"],
    ownerPaints: structuredClone(ownerPaints),
  }));
  return {
    segments: [
      {
        id: "ordinary-live-idle-move-turn-attack",
        expectedTicks: [100, 101, 102],
        frames: [100, 101, 102].map((tick) => ({
          tick,
          expectedOwnerIds: ["player", "monster:ashfang"],
          observedOwnerIds: ["player", "monster:ashfang"],
          ownerPaints: structuredClone(ownerPaints),
        })),
      },
    ],
    residuals: [
      {
        differingPixels: 0,
        maxChannelDelta: 0,
        changedBounds: null,
      },
    ],
    effects: [
      {
        effectId: "effect:impact",
        kind: "impact" as EffectKind,
        expectedKind: "impact" as EffectKind,
        ownerId: "player",
        expectedOwnerId: "player",
        observedBefore: true,
        observedAfter: false,
        beforeTick: 10,
        afterTick: 18,
        startedAtTick: 10,
        expectedDespawnStateTick: 18,
      },
    ],
    liveProfiles: [
      {
        id: "desktop-60hz",
        required: true,
        samples: liveSamples,
      },
    ],
  };
}

describe("live compositor evidence", () => {
  it("accepts complete ownership, cadence, residual, and despawn evidence", () => {
    const result = evaluateLiveCompositorEvidence(liveFixture());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
  });

  it("detects every named live-compositor mutation", () => {
    const controls = runLiveCompositorNegativeControls(liveFixture());

    expect(controls).toHaveLength(6);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "stale-pixels-detected",
      "duplicate-owner-body",
      "expected-frame-absent",
      "stale-effect-retained",
      "effect-owner-mismatch",
      "presentation-cadence-stalled",
    ]);
  });

  it("rejects an expected owner that disappears from the manifest", () => {
    const evidence = liveFixture();
    evidence.segments[0]!.frames[1]!.observedOwnerIds = ["player"];

    const result = evaluateLiveCompositorEvidence(evidence);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("expected-frame-absent");
    expect(
      result.signals.find(({ id }) => id === "no-unexplained-absence")?.pass,
    ).toBe(false);
  });

  it("retains an observed-only profile without letting it mask gated evidence", () => {
    const evidence = liveFixture();
    evidence.liveProfiles!.push({
      id: "phone-portrait-rAF",
      required: false,
      samples: [],
    });

    const result = evaluateLiveCompositorEvidence(evidence);
    const cadence = result.signals.find(
      ({ id }) => id === "real-clock-cadence-complete",
    );

    expect(result.pass).toBe(true);
    expect(cadence?.pass).toBe(true);
    expect(cadence?.detail).toMatchObject({
      gatedProfileIds: ["desktop-60hz"],
      observedOnlyProfileIds: ["phone-portrait-rAF"],
      observedOnlyFailures: ["phone-portrait-rAF:cadence-stalled"],
    });
  });

  it("requires a residual measurement and a lifecycle observation", () => {
    const evidence = liveFixture();
    evidence.residuals = [];
    evidence.effects = [];
    evidence.liveProfiles = [];

    const result = evaluateLiveCompositorEvidence(evidence);

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([
      "stale-pixels-detected",
      "effect-owner-mismatch",
      "stale-effect-retained",
      "presentation-cadence-stalled",
    ]);
  });

  it("rejects an effect whose kind or owner disagrees with its expected metadata", () => {
    const evidence = liveFixture();
    evidence.effects[0]!.kind = "slash";

    const result = evaluateLiveCompositorEvidence(evidence);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("effect-owner-mismatch");
  });

  it("locates exact pixel residuals between reconstructed PNG frames", async () => {
    const first = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const second = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 1,
              height: 1,
              channels: 4,
              background: { r: 255, g: 32, b: 16, alpha: 1 },
            },
          },
          left: 2,
          top: 1,
        },
      ])
      .png()
      .toBuffer();

    await expect(measurePngResidual(first, first)).resolves.toMatchObject({
      differingPixels: 0,
      maxChannelDelta: 0,
      changedBounds: null,
    });
    await expect(measurePngResidual(first, second)).resolves.toMatchObject({
      width: 4,
      height: 3,
      differingPixels: 1,
      maxChannelDelta: 255,
      changedBounds: { x: 2, y: 1, width: 1, height: 1 },
    });
  });
});
