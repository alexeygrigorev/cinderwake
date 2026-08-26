import { describe, expect, it } from "vitest";
import {
  MOBILE_SCREEN_GESTURE_IDS,
  MOBILE_SCREEN_PROFILE_IDS,
  MOBILE_SCREEN_SCENARIO_IDS,
  evaluateMobileScreenEvidence,
} from "../../scripts/lib/mobile-screen-evidence.mjs";

function capture(tick: number, suffix: string) {
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${suffix}`,
    manifestHash: `manifest-${suffix}`,
    frameHash: `frame-${suffix}`,
  };
}

function target(id: string) {
  return {
    id,
    width: 50,
    height: 50,
    contained: true,
    hit: true,
    occluded: false,
  };
}

function profile(profileId: string) {
  const portrait = profileId === "phone-portrait";
  const selectionCapture = capture(1, `${profileId}-selection`);
  const gameCapture = capture(2, `${profileId}-game`);
  const gestures = MOBILE_SCREEN_GESTURE_IDS.map((id, index) => {
    const before = capture(3 + index * 3, `${profileId}-${id}-before`);
    const pressed = capture(4 + index * 3, `${profileId}-${id}-pressed`);
    const after = capture(5 + index * 3, `${profileId}-${id}-after`);
    return id === "rotate"
      ? {
          id,
          before,
          pressed,
          after: { ...after, orientation: "phone-landscape" },
          fromOrientation: "phone-portrait",
          toOrientation: "phone-landscape",
          orientationChanged: true,
        }
      : {
          id,
          before,
          pressed: { ...pressed, visualChanged: true },
          after: { ...after, semanticOutcome: true },
        };
  });
  return {
    profileId,
    viewport: portrait
      ? { width: 390, height: 844 }
      : { width: 844, height: 390 },
    mode: "observe-only",
    bridgeExposed: false,
    scenarioIds: [...MOBILE_SCREEN_SCENARIO_IDS],
    safeArea: {
      emulated: true,
      applied: true,
      insets: { top: 12, right: 10, bottom: 16, left: 10 },
      contentContained: true,
    },
    selection: {
      layout: {
        overflowX: false,
        overflowY: false,
        rootContained: true,
        stageContained: true,
      },
      targets: [target("begin"), target("class-card")],
      subject: {
        id: "selection-hero",
        contained: true,
        landmarks: [{ id: "head", contained: true }],
      },
    },
    game: {
      layout: {
        overflowX: false,
        overflowY: false,
        rootContained: true,
        stageContained: true,
        controlsVisible: true,
        controlsContained: true,
        controlHeightRatio: portrait ? 0.15 : 0.25,
        hudClusterDistance: 12,
        worldOverlapIds: [],
      },
      targets: [target("move-pad"), target("attack")],
      subject: {
        id: "game-actors",
        contained: true,
        landmarks: [{ id: "player", contained: true }],
      },
    },
    textMetrics: [
      {
        id: "objective",
        fontSize: 10,
        contrastRatio: 4.2,
        quietField: true,
        wrapValid: true,
        orphanToken: false,
      },
      {
        id: "mobile-actions",
        fontSize: 10,
        contrastRatio: 4.1,
        quietField: true,
        wrapValid: true,
        orphanToken: false,
      },
    ],
    orientation: { overlap: false, targetsContained: true },
    gestures,
    timeline: [
      selectionCapture,
      gameCapture,
      ...gestures.flatMap((item) => [item.before, item.pressed, item.after]),
    ],
  };
}

function evidence() {
  return {
    requiredProfiles: [...MOBILE_SCREEN_PROFILE_IDS],
    requiredScenarioIds: [...MOBILE_SCREEN_SCENARIO_IDS],
    profiles: [profile("phone-portrait"), profile("phone-landscape")],
  };
}

describe("mobile screen evidence evaluator", () => {
  it("accepts synchronized portrait and landscape production evidence", () => {
    const result = evaluateMobileScreenEvidence(evidence());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
    expect(result.timelineSynchronized).toBe(true);
  });

  it.each([
    [
      "undersized target",
      "touch-target-invalid",
      (value: any) => {
        value.profiles[0].game.targets[0].width = 24;
      },
    ],
    [
      "cropped subject",
      "subject-containment-failed",
      (value: any) => {
        value.profiles[0].selection.subject.landmarks[0].contained = false;
      },
    ],
    [
      "detached HUD",
      "hud-containment-failed",
      (value: any) => {
        value.profiles[0].game.layout.hudClusterDistance = 80;
      },
    ],
    [
      "suppressed press",
      "pressed-feedback-missing",
      (value: any) => {
        value.profiles[0].gestures[2].pressed.visualChanged = false;
      },
    ],
    [
      "orientation overlap",
      "orientation-overlap-detected",
      (value: any) => {
        value.profiles[0].orientation.overlap = true;
      },
    ],
    [
      "small phone copy",
      "phone-text-size-below-contract",
      (value: any) => {
        value.profiles[0].textMetrics[0].fontSize = 5;
      },
    ],
    [
      "low contrast phone copy",
      "phone-text-contrast-below-contract",
      (value: any) => {
        value.profiles[0].textMetrics[0].contrastRatio = 1.4;
      },
    ],
    [
      "ornament under copy",
      "copy-quiet-field-violated",
      (value: any) => {
        value.profiles[0].textMetrics[0].quietField = false;
      },
    ],
    [
      "orphan label wrap",
      "phone-copy-wrap-invalid",
      (value: any) => {
        value.profiles[0].textMetrics[0].orphanToken = true;
      },
    ],
  ])("detects %s", (_name, expectedFailure, mutate) => {
    const value = evidence();
    mutate(value);

    const result = evaluateMobileScreenEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });

  it("detects a desynchronized production capture", () => {
    const value = evidence();
    value.profiles[1].timeline[0].manifestTick += 1;

    const result = evaluateMobileScreenEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("mobile-evidence-desynchronized");
  });
});
