import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  runTemporalSequenceNegativeControls,
  TEMPORAL_SEQUENCE_ENTRY_IDS,
  validateOrdinaryRouteTemporalStrips,
  validateTemporalSequenceCatalog,
} from "../../scripts/lib/temporal-sequence-evidence.mjs";
import { runTemporalProductionPixelNegativeControls } from "../../scripts/lib/temporal-pixel-evidence.mjs";

function passingCatalog() {
  const checks = {
    semanticFrameExact: true,
    semanticFrameCadence: true,
    stateManifestContract: true,
    renderSignatureDeterministic: true,
    actualPoseContinuous: true,
    attachedEffectBloomIsContinuous: true,
    oneShotLifecycle: true,
    oneShotFrameOrder: true,
    deathLifecycle: true,
  };
  return {
    schemaVersion: 1,
    pass: true,
    entries: TEMPORAL_SEQUENCE_ENTRY_IDS.map((id) => ({
      id,
      scenario:
        id === "enemy-death-lifecycle"
          ? "temporal-enemy-death"
          : id.startsWith("hero-")
            ? "temporal-vanguard-primary"
            : id.startsWith("enemy-")
              ? "temporal-ashfang-attack"
              : "animation-walk",
      category:
        id === "enemy-death-lifecycle"
          ? "lifecycles"
          : id.startsWith("hero-")
            ? "hero actions"
            : id.startsWith("enemy-")
              ? "enemy actions"
              : "locomotion",
      checks,
      pass: true,
    })),
  };
}

function ordinaryRouteFixture() {
  return {
    profiles: ["desktop-60hz", "phone-portrait-rAF"].map((id) => ({
      id,
      required: id === "desktop-60hz",
      actors: ["vanguard", "ranger", "arcanist"].map((actorId) => ({
        actorId,
        frameArtifacts: [
          "initial",
          "after-sustained-movement-and-turn",
          "after-first-attack",
          "after-second-attack",
          "after-ability",
        ].map((label, tick) => ({ label, tick })),
        samples: Array.from({ length: 30 }, () => ({})),
        videoArtifacts: { normal: { file: "normal.webm" } },
      })),
    })),
  };
}

describe("temporal sequence evidence", () => {
  it("requires the complete passing capture matrix and named signal groups", () => {
    const assessment = validateTemporalSequenceCatalog(passingCatalog());

    expect(assessment.pass).toBe(true);
    expect(assessment.failures).toEqual([]);
    expect(assessment.signals.map(({ id }) => id)).toEqual([
      "catalog-complete-and-passing",
      "cadence-continuity",
      "transition-continuity",
      "terminal-pose-retained",
    ]);
    expect(assessment.summary).toMatchObject({
      expectedEntries: 26,
      actualEntries: 26,
      passingEntries: 26,
      deviceProfiles: ["desktop", "phone-portrait"],
    });
  });

  it("detects every frame, crop, transform, recovery, and terminal mutation", () => {
    const controls = runTemporalSequenceNegativeControls();

    expect(controls).toHaveLength(6);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ id, signal }) => [id, signal])).toEqual([
      ["frame-duplicated-or-frozen", "frame-diversity-failed"],
      ["frames-reordered", "frame-order-failed"],
      ["crop-offset", "crop-continuity-failed"],
      ["one-frame-scale-or-centroid-pop", "transform-continuity-failed"],
      ["stale-recovery", "recovery-continuity-failed"],
      ["terminal-pose-skipped", "terminal-pose-failed"],
    ]);
  });

  it("requires every playable actor in both ordinary-route temporal profiles", () => {
    const assessment = validateOrdinaryRouteTemporalStrips(
      ordinaryRouteFixture(),
    );

    expect(assessment.pass).toBe(true);
    expect(assessment.failures).toEqual([]);
    expect(assessment.signal).toMatchObject({
      id: "ordinary-route-temporal-strips",
      pass: true,
    });
    expect(assessment.summary).toMatchObject({
      strips: 6,
      expectedStrips: 6,
    });
  });

  it("detects named controls after mutating production PNG frames", async () => {
    const frames = await Promise.all(
      [10, 20, 30, 40, 50].map((red) =>
        sharp({
          create: {
            width: 8,
            height: 8,
            channels: 4,
            background: { r: red, g: 40, b: 60, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
      ),
    );
    const controls = await runTemporalProductionPixelNegativeControls(frames);

    expect(controls).toHaveLength(6);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(
      controls.every(
        ({ pixelMutation }) => pixelMutation.changedFrameCount > 0,
      ),
    ).toBe(true);
  });
});
