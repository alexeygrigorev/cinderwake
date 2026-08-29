import { expect, test, type Page } from "@playwright/test";
import type { ReplayTapeV1 } from "../../src/testkit/replay";
import type { ScenarioV1 } from "../../src/testkit/scenarios";
import { horizontalFlipForGeometry } from "../../src/render/sprites";
import {
  CARDINAL_DIRECTIONS,
  cardinalMovementTape,
  monsterMovementScenario,
  playerMovementScenario,
  stationaryTape,
} from "../fixtures/directional-dynamics";

type ActorState = {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  facing: { x: number; y: number };
  animation: { clip: string };
};

type SequenceCapture = {
  tick: number;
  snapshot: {
    tick: number;
    player: ActorState;
    monsters: Array<ActorState & { id: string }>;
  };
  manifest: {
    tick: number;
    drawCalls: Array<{
      entityId: string;
      spriteId: string;
      worldAnchor: { x: number; y: number };
      screenAnchor: { x: number; y: number };
      facingBucket: string;
      flipX: boolean;
    }>;
  };
  frame: string;
};

type DynamicsCapture = {
  tick: number;
  stateTick: number;
  manifestTick: number;
  actor: {
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    facing: { x: number; y: number };
    animation: { clip: string };
  };
  call: {
    spriteId: string;
    worldAnchor: { x: number; y: number };
    screenAnchor: { x: number; y: number };
    facingBucket: string;
    flipX: boolean;
  };
  frameIsPng: boolean;
  frameLength: number;
};

type ReplayEvidence = {
  initial: DynamicsCapture;
  moved: DynamicsCapture;
  finalStateHash: string;
  replayedFinalStateHash: string;
  replayedFramesEqual: boolean;
};

function captureActor(
  capture: SequenceCapture,
  actorId: string,
): DynamicsCapture {
  const actor =
    actorId === "player"
      ? capture.snapshot.player
      : capture.snapshot.monsters.find(
          ({ id }: { id: string }) => id === actorId,
        );
  const call = capture.manifest.drawCalls.find(
    ({ entityId }: { entityId: string }) => entityId === actorId,
  );
  if (!actor || !call)
    throw new Error(`Missing ${actorId} at tick ${capture.tick}`);
  return {
    tick: capture.tick,
    stateTick: capture.snapshot.tick,
    manifestTick: capture.manifest.tick,
    actor: {
      position: actor.position,
      velocity: actor.velocity,
      facing: actor.facing,
      animation: { clip: actor.animation.clip },
    },
    call: {
      spriteId: call.spriteId,
      worldAnchor: call.worldAnchor,
      screenAnchor: call.screenAnchor,
      facingBucket: call.facingBucket,
      flipX: call.flipX,
    },
    frameIsPng: capture.frame.startsWith("data:image/png;base64,"),
    frameLength: capture.frame.length,
  };
}

async function replay(
  page: Page,
  scenario: ScenarioV1,
  tape: ReplayTapeV1,
  actorId: string,
): Promise<ReplayEvidence> {
  const raw = await page.evaluate(
    ({ scenario: currentScenario, tape: currentTape }) => {
      const bridge = window.__GAME_TEST__;
      if (!bridge)
        throw new Error("Directional dynamics bridge is unavailable");

      const run = () => {
        bridge.reset();
        bridge.queueInputs(currentTape.entries);
        const captures = bridge.captureSequence([0, 8], { render: true });
        return {
          initial: captures[0]!,
          moved: captures[1]!,
          finalStateHash: bridge.stateHash(),
        };
      };

      bridge.loadScenario(currentScenario);
      const first = run();
      const second = run();
      return {
        first,
        second,
        finalStateHash: first.finalStateHash,
        replayedFinalStateHash: second.finalStateHash,
        replayedFramesEqual:
          first.initial.frame === second.initial.frame &&
          first.moved.frame === second.moved.frame &&
          first.moved.frame.length === second.moved.frame.length,
      };
    },
    { scenario, tape },
  );
  return {
    initial: captureActor(raw.first.initial, actorId),
    moved: captureActor(raw.first.moved, actorId),
    finalStateHash: raw.finalStateHash,
    replayedFinalStateHash: raw.replayedFinalStateHash,
    replayedFramesEqual: raw.replayedFramesEqual,
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test.setTimeout(60_000);

test("exact input tapes keep player and monster cardinal motion aligned", async ({
  page,
}) => {
  for (const direction of CARDINAL_DIRECTIONS) {
    await test.step(`player ${direction.id}`, async () => {
      const evidence = await replay(
        page,
        playerMovementScenario(),
        cardinalMovementTape(direction),
        "player",
      );
      const delta =
        evidence.moved.actor.position[direction.axis] -
        evidence.initial.actor.position[direction.axis];
      const screenDelta =
        evidence.moved.call.screenAnchor[direction.axis] -
        evidence.initial.call.screenAnchor[direction.axis];

      expect(evidence.initial.tick).toBe(0);
      expect(evidence.moved.tick).toBe(8);
      expect(evidence.initial.stateTick).toBe(evidence.initial.manifestTick);
      expect(evidence.moved.stateTick).toBe(evidence.moved.manifestTick);
      expect(delta * direction.sign).toBe(
        evidence.moved.actor.velocity[direction.axis] * direction.sign * 8,
      );
      expect(screenDelta * direction.sign).toBeGreaterThan(0);
      expect(evidence.moved.call.facingBucket).toBe(direction.id);
      expect(evidence.moved.call.spriteId).toBe(
        direction.id === "east" || direction.id === "west"
          ? "hero:vanguard"
          : `hero:vanguard:${direction.id}`,
      );
      expect(evidence.moved.call.flipX).toBe(
        horizontalFlipForGeometry(`hero:vanguard`, direction.id),
      );
      expect(evidence.moved.actor.animation.clip).toBe("walk");
      expect(evidence.moved.frameIsPng).toBe(true);
      expect(evidence.moved.frameLength).toBeGreaterThan(1_000);
      expect(evidence.finalStateHash).toBe(evidence.replayedFinalStateHash);
      expect(evidence.replayedFramesEqual).toBe(true);
    });

    await test.step(`monster ${direction.id}`, async () => {
      const evidence = await replay(
        page,
        monsterMovementScenario(direction),
        stationaryTape,
        "monster:directional-pursuer",
      );
      const delta =
        evidence.moved.actor.position[direction.axis] -
        evidence.initial.actor.position[direction.axis];
      const screenDelta =
        evidence.moved.call.screenAnchor[direction.axis] -
        evidence.initial.call.screenAnchor[direction.axis];
      const monsterSign = -direction.sign;

      expect(
        evidence.moved.actor.velocity[direction.axis] * monsterSign,
      ).toBeGreaterThan(0);
      expect(delta * monsterSign).toBeGreaterThan(0);
      expect(screenDelta * monsterSign).toBeGreaterThan(0);
      expect(evidence.moved.call.facingBucket).toBe(direction.monsterFacing);
      expect(evidence.moved.call.spriteId).toBe(
        direction.monsterFacing === "east" || direction.monsterFacing === "west"
          ? "monster:ashfang"
          : `monster:ashfang:${direction.monsterFacing}`,
      );
      expect(evidence.moved.call.flipX).toBe(
        horizontalFlipForGeometry("monster:ashfang", direction.monsterFacing),
      );
      expect(evidence.moved.actor.animation.clip).toBe("walk");
      expect(evidence.moved.frameIsPng).toBe(true);
      expect(evidence.moved.frameLength).toBeGreaterThan(1_000);
      expect(evidence.finalStateHash).toBe(evidence.replayedFinalStateHash);
      expect(evidence.replayedFramesEqual).toBe(true);
    });
  }
});
