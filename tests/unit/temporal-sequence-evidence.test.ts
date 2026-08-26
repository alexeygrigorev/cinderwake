import { describe, expect, it } from "vitest";
import {
  runTemporalSequenceNegativeControls,
  TEMPORAL_SEQUENCE_ENTRY_IDS,
  validateTemporalSequenceCatalog,
} from "../../scripts/lib/temporal-sequence-evidence.mjs";

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
});
