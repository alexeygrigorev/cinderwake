import { describe, expect, it } from "vitest";
import {
  evaluateLiveCompositorEvidence,
  runLiveCompositorNegativeControls,
} from "../../scripts/lib/compositor-evidence.mjs";

function liveFixture() {
  const ownerPaints = [
    { ownerId: "player", bodyPaintCount: 1 },
    { ownerId: "monster:ashfang", bodyPaintCount: 1 },
  ];
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
        observedBefore: true,
        observedAfter: false,
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

    expect(controls).toHaveLength(4);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "stale-pixels-detected",
      "duplicate-owner-body",
      "expected-frame-absent",
      "stale-effect-retained",
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

  it("requires a residual measurement and a lifecycle observation", () => {
    const evidence = liveFixture();
    evidence.residuals = [];
    evidence.effects = [];

    const result = evaluateLiveCompositorEvidence(evidence);

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([
      "stale-pixels-detected",
      "stale-effect-retained",
    ]);
  });
});
