import { describe, expect, it } from "vitest";
import {
  GESTURE_INTENT_GESTURE_IDS,
  evaluateGestureIntentEvidence,
} from "../../scripts/lib/gesture-intent-evidence.mjs";

function capture(tick: number, x: number, y: number, attacks = 0) {
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}-${x}-${y}-${attacks}`,
    manifestHash: `manifest-${tick}-${x}-${y}-${attacks}`,
    frameHash: `frame-${tick}-${x}-${y}-${attacks}`,
    snapshot: {
      scenarioId: "animation-idle",
      tick,
      player: { position: { x, y } },
      eventLog: Array.from({ length: attacks }, (_, index) => ({
        type: "attack_started",
        sourceId: "player",
        id: `attack-${index}`,
      })),
    },
  };
}

function gesture(
  id: string,
  before: ReturnType<typeof capture>,
  after: ReturnType<typeof capture>,
) {
  return { id, type: "touch", before, after };
}

function profile(profileId: string) {
  const initial = capture(0, 10, 10);
  const tapBefore = capture(1, 10, 10);
  const tapAfter = capture(2, 12, 10);
  const directions = [
    ["joystick-north", 12, 9, 12, 8],
    ["joystick-east", 13, 8, 14, 8],
    ["joystick-south", 14, 9, 14, 10],
    ["joystick-west", 13, 10, 12, 10],
  ] as const;
  const gestures = [
    gesture("tap-open-ground", tapBefore, tapAfter),
    ...directions.map(([id, beforeX, beforeY, afterX, afterY], index) =>
      gesture(
        id,
        capture(3 + index * 2, beforeX, beforeY),
        capture(4 + index * 2, afterX, afterY),
      ),
    ),
    gesture("tap-strike", capture(11, 12, 10), capture(12, 12, 10, 1)),
  ];
  return {
    profileId,
    scenarioId: "animation-idle-open-floor",
    actualScenarioId: "animation-idle",
    initial: {
      injectionUsed: false,
      bridgeExposed: false,
      snapshot: initial.snapshot,
    },
    gestures,
    timeline: [
      initial,
      ...gestures.flatMap(({ before, after }) => [before, after]),
    ],
  };
}

describe("gesture intent evidence evaluator", () => {
  it("accepts ground movement, all cardinal joystick directions, and Strike separation", () => {
    const result = evaluateGestureIntentEvidence({
      profiles: [profile("phone-portrait"), profile("phone-landscape")],
      requiredProfiles: ["phone-portrait", "phone-landscape"],
    });

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
    expect(result.timelineSynchronized).toBe(true);
  });

  it.each([
    [
      "swapped Strike binding",
      "gesture-intent-mismatch",
      (value: any) => {
        value.profiles[0].gestures.find(
          ({ id }: { id: string }) => id === "tap-strike",
        ).after.snapshot.player.position.x += 2;
      },
    ],
    [
      "desynchronized capture",
      "gesture-evidence-desynchronized",
      (value: any) => {
        value.profiles[0].timeline[1].manifestTick += 1;
      },
    ],
    [
      "missing cardinal gesture",
      "gesture-intent-mismatch",
      (value: any) => {
        value.profiles[0].gestures = value.profiles[0].gestures.filter(
          ({ id }: { id: string }) => id !== "joystick-west",
        );
      },
    ],
  ])("detects %s", (_name, expectedFailure, mutate) => {
    const value = {
      profiles: [profile("phone-portrait"), profile("phone-landscape")],
      requiredProfiles: ["phone-portrait", "phone-landscape"],
    };
    mutate(value);

    const result = evaluateGestureIntentEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });

  it("publishes the contract gesture order", () => {
    expect(GESTURE_INTENT_GESTURE_IDS).toEqual([
      "tap-open-ground",
      "joystick-north",
      "joystick-east",
      "joystick-south",
      "joystick-west",
      "tap-strike",
    ]);
  });
});
