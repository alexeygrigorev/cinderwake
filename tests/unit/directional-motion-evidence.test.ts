import { describe, expect, it } from "vitest";
import {
  DIRECTIONAL_MOTION_ACTOR_IDS,
  DIRECTIONAL_MOTION_DIRECTION_IDS,
  DIRECTIONAL_MOTION_SCENARIO_IDS,
  evaluateDirectionalMotionEvidence,
} from "../../scripts/lib/directional-motion-evidence.mjs";

const directions = {
  "move-north": { axis: "y", sign: -1, facing: "north" },
  "move-east": { axis: "x", sign: 1, facing: "east" },
  "move-south": { axis: "y", sign: 1, facing: "south" },
  "move-west": { axis: "x", sign: -1, facing: "west" },
} as const;

function capture(
  tick: number,
  world: { x: number; y: number },
  screen: { x: number; y: number },
  reference: { x: number; y: number },
  frame: string,
  facing: string,
  clip = "walk",
) {
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}-${world.x}-${world.y}`,
    manifestHash: `manifest-${tick}-${screen.x}-${screen.y}`,
    frameHash: `frame-${frame}`,
    snapshot: { player: { classId: "vanguard", position: world } },
    manifest: {
      drawCalls: [
        {
          entityId: "player",
          screenAnchor: screen,
          clip,
          facingBucket: facing,
        },
      ],
    },
    referenceScene: { objectId: "tile:10:1", screenAnchor: reference },
  };
}

function run(actorId: string, scenarioId: string) {
  const gestures = DIRECTIONAL_MOTION_DIRECTION_IDS.map((id, index) => {
    const direction = directions[id];
    const beforeWorld = { x: 100 + index * 10, y: 100 + index * 10 };
    const delta =
      direction.axis === "x"
        ? { x: direction.sign * 80, y: 0 }
        : { x: 0, y: direction.sign * 80 };
    const followReference =
      direction.axis === "x"
        ? { x: -direction.sign * 20, y: 0 }
        : { x: 0, y: -direction.sign * 20 };
    const before = capture(
      index * 4,
      beforeWorld,
      { x: 480, y: 270 },
      { x: 460, y: 210 },
      `before-${id}`,
      direction.facing,
    );
    const after = capture(
      index * 4 + 3,
      { x: beforeWorld.x + delta.x, y: beforeWorld.y + delta.y },
      scenarioId === DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera
        ? { x: 480 + delta.x, y: 270 + delta.y }
        : { x: 480, y: 270 },
      { x: 460 + followReference.x, y: 210 + followReference.y },
      `after-${id}`,
      direction.facing,
    );
    return {
      id,
      before,
      after,
      samples: [
        {
          tick: index * 4 + 1,
          presentationTick: index * 4 + 1,
          playerWorldAnchor: beforeWorld,
          playerScreenAnchor: { x: 480, y: 270 },
          playerFrameIdentity: `${id}-0`,
          playerClip: "walk",
          playerFacingBucket: direction.facing,
        },
        {
          tick: index * 4 + 2,
          presentationTick: index * 4 + 2,
          playerWorldAnchor: {
            x: beforeWorld.x + delta.x / 2,
            y: beforeWorld.y + delta.y / 2,
          },
          playerScreenAnchor: {
            x:
              480 +
              (scenarioId === DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera
                ? delta.x / 2
                : 0),
            y:
              270 +
              (scenarioId === DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera
                ? delta.y / 2
                : 0),
          },
          playerFrameIdentity: `${id}-1`,
          playerClip: "walk",
          playerFacingBucket: direction.facing,
        },
      ],
    };
  });
  return {
    actorId,
    scenarioId,
    initial: {
      injectionUsed: false,
      bridgeExposed: false,
      mode: "observe-only",
      snapshot: { player: { classId: actorId }, scenarioId },
      capture: capture(
        0,
        { x: 100, y: 100 },
        { x: 480, y: 270 },
        { x: 460, y: 210 },
        "initial",
        "east",
        "idle",
      ),
    },
    gestures,
    timeline: [...gestures.flatMap(({ before, after }) => [before, after])],
  };
}

function evidence() {
  return {
    profiles: ["desktop", "phone-portrait"].map((profileId) => ({
      profileId,
      runs: DIRECTIONAL_MOTION_ACTOR_IDS.flatMap((actorId) => [
        run(actorId, DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera),
        run(actorId, DIRECTIONAL_MOTION_SCENARIO_IDS.followCamera),
      ]),
    })),
    requiredProfiles: ["desktop", "phone-portrait"],
    requiredActorIds: [...DIRECTIONAL_MOTION_ACTOR_IDS],
    requiredScenarioIds: Object.values(DIRECTIONAL_MOTION_SCENARIO_IDS),
    requiredDirectionIds: [...DIRECTIONAL_MOTION_DIRECTION_IDS],
  };
}

describe("directional motion evidence evaluator", () => {
  it("accepts every actor, camera mode, and cardinal direction", () => {
    const result = evaluateDirectionalMotionEvidence(evidence());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.map(({ pass }) => pass)).toEqual([true, true, true]);
    expect(result.coverage).toMatchObject({
      hasAllProfiles: true,
      hasAllRuns: true,
      expectedRuns: 12,
      actualRuns: 12,
      timelinesSynchronized: true,
    });
  });

  it.each([
    [
      "reversed render projection",
      "screen-direction",
      (value: any) => {
        const gesture = value.profiles[0].runs[0].gestures[1];
        gesture.after.manifest.drawCalls[0].screenAnchor.x = 400;
      },
    ],
    [
      "frozen walk frame",
      "walk-frozen",
      (value: any) => {
        for (const sample of value.profiles[0].runs[0].gestures[0].samples)
          sample.playerFrameIdentity = "same-frame";
      },
    ],
    [
      "opposite facing",
      "facing-mismatch",
      (value: any) => {
        value.profiles[0].runs[0].gestures[0].samples.forEach(
          (sample: any) => (sample.playerFacingBucket = "south"),
        );
      },
    ],
  ])("detects %s", (_name, failure, mutate) => {
    const value = evidence();
    mutate(value);

    const result = evaluateDirectionalMotionEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(failure);
  });
});
