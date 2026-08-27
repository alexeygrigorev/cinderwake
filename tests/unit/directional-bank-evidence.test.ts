import { describe, expect, it } from "vitest";
import {
  DIRECTIONAL_BANK_ACTOR_IDS,
  DIRECTIONAL_BANK_DIRECTION_IDS,
  evaluateDirectionalBankEvidence,
} from "../../scripts/lib/directional-bank-evidence.mjs";

const directions = {
  "move-north": {
    x: 0,
    y: -1,
    axis: "y",
    sign: -1,
    facing: "north",
    opposite: "move-south",
  },
  "move-east": {
    x: 1,
    y: 0,
    axis: "x",
    sign: 1,
    facing: "east",
    opposite: "move-west",
  },
  "move-south": {
    x: 0,
    y: 1,
    axis: "y",
    sign: 1,
    facing: "south",
    opposite: "move-north",
  },
  "move-west": {
    x: -1,
    y: 0,
    axis: "x",
    sign: -1,
    facing: "west",
    opposite: "move-east",
  },
} as const;

type Facing = (typeof directions)[keyof typeof directions]["facing"];

function vector(facing: Facing) {
  return {
    north: { x: 0, y: -1024 },
    east: { x: 1024, y: 0 },
    south: { x: 0, y: 1024 },
    west: { x: -1024, y: 0 },
  }[facing];
}

function spriteId(actorId: string, facing: Facing) {
  const geometryId = `hero:${actorId}`;
  return facing === "north" || facing === "south"
    ? `${geometryId}:${facing}`
    : geometryId;
}

function playerCall(actorId: string, facing: Facing, clip: string) {
  const facingVector = vector(facing);
  return {
    entityId: "player",
    type: "player",
    geometryId: `hero:${actorId}`,
    spriteId: spriteId(actorId, facing),
    facing: facingVector,
    facingBucket: facing,
    flipX: facing === "west",
    clip,
  };
}

function capture(
  tick: number,
  actorId: string,
  facing: Facing,
  position: { x: number; y: number },
  clip = "walk",
  pendingAttacks: unknown[] = [],
) {
  const facingVector = vector(facing);
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}-${actorId}-${facing}`,
    manifestHash: `manifest-${tick}-${actorId}-${facing}`,
    frameHash: `frame-${tick}-${actorId}-${facing}`,
    snapshot: {
      tick,
      player: {
        classId: actorId,
        position,
        facing: facingVector,
        animation: { clip },
        pendingAttacks,
      },
    },
    manifest: {
      tick,
      drawCalls: [playerCall(actorId, facing, clip)],
    },
  };
}

function run(profileId: string, actorId: string) {
  return {
    profileId,
    actorId,
    scenarioId: `fixed-camera-open-floor-${actorId}`,
    directions: DIRECTIONAL_BANK_DIRECTION_IDS.map((directionId, index) => {
      const expected = directions[directionId];
      const opposite = directions[expected.opposite];
      const start = { x: 1_000 + index * 100, y: 1_000 + index * 100 };
      const moved = {
        x: start.x + expected.x * 64,
        y: start.y + expected.y * 64,
      };
      const turned = {
        x: moved.x - expected.x * 10,
        y: moved.y - expected.y * 10,
      };
      const actionPosition = { x: 2_000 + index * 100, y: 2_000 };
      const attack = {
        id: `attack:${actorId}:${directionId}`,
        ownerId: "player",
        kind: "primary",
        origin: { ...actionPosition },
        direction: vector(expected.facing),
      };
      const produced =
        actorId === "vanguard"
          ? [
              {
                type: "effect",
                ownerId: "player",
                position: { ...actionPosition },
              },
            ]
          : [
              {
                type: "projectile",
                ownerId: "player",
                position: { ...actionPosition },
                velocity: {
                  x: vector(expected.facing).x / 4,
                  y: vector(expected.facing).y / 4,
                },
              },
            ];
      return {
        directionId,
        turnDirectionId: expected.opposite,
        movement: {
          before: capture(index * 10, actorId, expected.facing, start, "idle"),
          after: capture(index * 10 + 6, actorId, expected.facing, moved),
          turn: capture(index * 10 + 7, actorId, opposite.facing, turned),
        },
        action: {
          kind: "primary",
          before: capture(
            index * 10 + 20,
            actorId,
            expected.facing,
            actionPosition,
            "idle",
          ),
          after: capture(
            index * 10 + 21,
            actorId,
            expected.facing,
            actionPosition,
            "attack",
            [attack],
          ),
          impact: capture(
            index * 10 + 29,
            actorId,
            expected.facing,
            actionPosition,
            "attack",
          ),
          pendingAttack: attack,
          produced,
        },
      };
    }),
  };
}

function evidence() {
  return {
    profiles: ["desktop", "phone-portrait"].map((profileId) => ({
      profileId,
      runs: DIRECTIONAL_BANK_ACTOR_IDS.map((actorId) =>
        run(profileId, actorId),
      ),
    })),
    requiredProfiles: ["desktop", "phone-portrait"],
    requiredActorIds: [...DIRECTIONAL_BANK_ACTOR_IDS],
    requiredDirectionIds: [...DIRECTIONAL_BANK_DIRECTION_IDS],
  };
}

describe("PRES-FACING-015 evidence oracle", () => {
  it("accepts every actor, profile, bank, turn, and authored origin", () => {
    const result = evaluateDirectionalBankEvidence(evidence());

    expect(result).toMatchObject({ pass: true, failures: [] });
    expect(result.signals.map(({ pass }) => pass)).toEqual([true, true, true]);
    expect(result.coverage).toMatchObject({
      hasAllProfiles: true,
      hasAllRuns: true,
      hasAllDirections: true,
      expectedRuns: 6,
      actualRuns: 6,
      timelinesSynchronized: true,
    });
  });

  it.each([
    [
      "opposite bank selected",
      "sprite-bank-mismatch",
      (value: ReturnType<typeof evidence>) => {
        const direction = value.profiles[0]!.runs[0]!.directions.find(
          ({ directionId }) => directionId === "move-east",
        )!;
        direction.movement.after.manifest.drawCalls[0]!.spriteId =
          "hero:vanguard:south";
      },
    ],
    [
      "west reflection missing",
      "west-reflection-missing",
      (value: ReturnType<typeof evidence>) => {
        const direction = value.profiles[0]!.runs[0]!.directions.find(
          ({ directionId }) => directionId === "move-west",
        )!;
        direction.movement.after.manifest.drawCalls[0]!.flipX = false;
      },
    ],
    [
      "stale bank after turn",
      "stale-facing-bank",
      (value: ReturnType<typeof evidence>) => {
        const direction = value.profiles[0]!.runs[0]!.directions.find(
          ({ directionId }) => directionId === "move-east",
        )!;
        direction.movement.turn.manifest.drawCalls[0]!.facingBucket = "east";
        direction.movement.turn.manifest.drawCalls[0]!.spriteId =
          "hero:vanguard";
        direction.movement.turn.manifest.drawCalls[0]!.flipX = false;
      },
    ],
    [
      "unmirrored attack origin",
      "attack-origin-not-mirrored",
      (value: ReturnType<typeof evidence>) => {
        const attack =
          value.profiles[0]!.runs[0]!.directions[0]!.action.pendingAttack;
        attack.origin.x += 1;
      },
    ],
  ])("detects %s", (_name, failure, mutate) => {
    const value = evidence();
    mutate(value);

    const result = evaluateDirectionalBankEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(failure);
  });
});
