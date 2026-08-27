import { describe, expect, it } from "vitest";
import {
  evaluateCompositorEvidence,
  runCompositorNegativeControls,
} from "../../scripts/lib/compositor-evidence.mjs";

function evidenceFixture() {
  return {
    repeat: {
      firstFrameHash: "frame-a",
      secondFrameHash: "frame-a",
    },
    transition: {
      afterFrameHash: "animation-idle",
      freshFrameHash: "animation-idle",
    },
    ownerPaints: [
      { ownerId: "player", bodyPaintCount: 1 },
      { ownerId: "monster:ashfang", bodyPaintCount: 1 },
    ],
  };
}

describe("compositor evidence", () => {
  it("accepts identical renders, clean transitions, and one body paint per owner", () => {
    const result = evaluateCompositorEvidence(evidenceFixture());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
  });

  it.each([
    [
      "duplicate render",
      "duplicate-body-detected",
      (value: any) => {
        value.repeat.secondFrameHash = "different";
      },
    ],
    [
      "stale transition",
      "stale-pixels-detected",
      (value: any) => {
        value.transition.afterFrameHash = "stale";
      },
    ],
    [
      "duplicate owner",
      "duplicate-owner-body",
      (value: any) => {
        value.ownerPaints[0].bodyPaintCount = 2;
      },
    ],
  ])("detects %s", (_name, expectedSignal, mutate) => {
    const value = evidenceFixture();
    mutate(value);

    const result = evaluateCompositorEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedSignal);
  });

  it("detects every compositor mutation", () => {
    const controls = runCompositorNegativeControls(evidenceFixture());

    expect(controls).toHaveLength(3);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
  });
});
