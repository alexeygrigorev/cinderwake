import { describe, expect, it } from "vitest";
import { playReplay, type ReplayTapeV1 } from "../../src/testkit/replay";
import { buildRenderManifest } from "../../src/render/manifest";
import { worldFromScenario } from "../../src/testkit/scenarios";
import {
  CARDINAL_DIRECTIONS,
  cardinalMovementTape,
  monsterMovementScenario,
  playerMovementScenario,
  stationaryTape,
} from "../fixtures/directional-dynamics";

const CAMERA = { x: 720, y: 360, zoom: 0.9 };

function playerCall(state: ReturnType<typeof worldFromScenario>) {
  return buildRenderManifest(state, CAMERA).drawCalls.find(
    ({ entityId }) => entityId === "player",
  )!;
}

function monsterCall(state: ReturnType<typeof worldFromScenario>) {
  return buildRenderManifest(state, CAMERA).drawCalls.find(
    ({ entityId }) => entityId === "monster:directional-pursuer",
  )!;
}

describe("replayable cardinal movement dynamics", () => {
  it.each(CARDINAL_DIRECTIONS)(
    "moves the player %s through state and the fixed-camera manifest",
    (direction) => {
      const tape = cardinalMovementTape(direction);
      const first = playReplay(
        worldFromScenario(playerMovementScenario()),
        tape,
        8,
      );
      const second = playReplay(
        worldFromScenario(playerMovementScenario()),
        tape,
        8,
      );
      const initial = worldFromScenario(playerMovementScenario());
      const initialCall = playerCall(initial);
      const movedCall = playerCall(first.state);
      const delta = {
        x: first.state.player.position.x - initial.player.position.x,
        y: first.state.player.position.y - initial.player.position.y,
      };

      expect(first.hashes).toEqual(second.hashes);
      expect(delta[direction.axis] * direction.sign).toBe(
        first.state.player.moveSpeed * 8,
      );
      expect(delta[direction.axis === "x" ? "y" : "x"]).toBe(0);
      expect(first.state.player.velocity[direction.axis] * direction.sign).toBe(
        first.state.player.moveSpeed,
      );
      expect(first.state.player.animation.clip).toBe("walk");
      expect(movedCall.facingBucket).toBe(direction.id);
      expect(movedCall.worldAnchor).toEqual(first.state.player.position);
      expect(
        (movedCall.screenAnchor[direction.axis] -
          initialCall.screenAnchor[direction.axis]) *
          direction.sign,
      ).toBeGreaterThan(0);

      const stopped = playReplay(
        worldFromScenario(playerMovementScenario()),
        tape,
        9,
      ).state;
      expect(stopped.player.velocity).toEqual({ x: 0, y: 0 });
      expect(stopped.player.animation.clip).toBe("idle");
    },
  );

  it.each(CARDINAL_DIRECTIONS)(
    "moves a pursuing monster toward the player from %s",
    (direction) => {
      const first = playReplay(
        worldFromScenario(monsterMovementScenario(direction)),
        stationaryTape,
        8,
      );
      const second = playReplay(
        worldFromScenario(monsterMovementScenario(direction)),
        stationaryTape,
        8,
      );
      const initial = worldFromScenario(monsterMovementScenario(direction));
      const initialMonster = initial.monsters[0]!;
      const monster = first.state.monsters[0]!;
      const initialCall = monsterCall(initial);
      const movedCall = monsterCall(first.state);
      const delta = {
        x: monster.position.x - initialMonster.position.x,
        y: monster.position.y - initialMonster.position.y,
      };

      expect(first.hashes).toEqual(second.hashes);
      const monsterSign = -direction.sign;
      expect(delta[direction.axis] * monsterSign).toBe(monster.moveSpeed * 8);
      expect(delta[direction.axis === "x" ? "y" : "x"]).toBe(0);
      expect(monster.velocity[direction.axis] * monsterSign).toBe(
        monster.moveSpeed,
      );
      expect(monster.facing).not.toEqual({ x: 0, y: 0 });
      expect(monster.animation.clip).toBe("walk");
      expect(movedCall.facingBucket).toBe(direction.monsterFacing);
      expect(movedCall.worldAnchor).toEqual(monster.position);
      expect(
        (movedCall.screenAnchor[direction.axis] -
          initialCall.screenAnchor[direction.axis]) *
          monsterSign,
      ).toBeGreaterThan(0);
      expect(
        first.state.eventLog.some(({ type }) => type === "attack_started"),
      ).toBe(false);
    },
  );

  it("keeps the player route deterministic when the tape changes axes", () => {
    const tape: ReplayTapeV1 = {
      version: 1,
      scenarioId: "directional-player-dynamics",
      entries: [
        { tick: 0, input: { moveX: 1, moveY: 0 } },
        { tick: 1, input: { moveX: 0, moveY: -1 } },
      ],
    };
    const state = playReplay(
      worldFromScenario(playerMovementScenario()),
      tape,
      2,
    ).state;

    expect(state.player.position).toEqual({ x: 15_936, y: 7_616 });
    expect(state.player.velocity).toEqual({ x: 0, y: -64 });
    expect(state.player.facing).toEqual({ x: 0, y: -1024 });
  });
});
