import { describe, expect, it } from "vitest";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type CharacterClass } from "../../src/game/types";
import { worldFromScenario } from "../../src/testkit/scenarios";

function arena(classId: CharacterClass = "vanguard") {
  return worldFromScenario({
    schemaVersion: 1,
    id: `combat-feel-${classId}`,
    seed: "combat-feel",
    classId,
    map: {
      mode: "explicit",
      rows: [
        "##############",
        "#............#",
        "#............#",
        "#...P.......E#",
        "#............#",
        "#............#",
        "##############",
      ],
    },
    player: { tile: [4, 3], facing: [1024, 0] },
    monsters: [{ id: "target", kind: "ashfang", tile: [5.9, 3], health: 100 }],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  });
}

describe("combat feel through deterministic player input", () => {
  it("connects a moving cleave from the player's impact position", () => {
    const state = arena();
    const initialPosition = { ...state.player.position };
    for (let tick = 0; tick <= 8; tick += 1)
      stepGame(state, {
        ...EMPTY_INPUT,
        moveX: 1,
        attack: tick === 0,
        aim: state.monsters[0]!.position,
      });

    expect(state.player.position.x - initialPosition.x).toBe(9 * 64);
    expect(state.metrics.damageDealt).toBe(18);
    expect(
      state.effects.find(({ kind }) => kind === "slash")?.position,
    ).toEqual(state.player.position);
  });

  it.each(["ranger", "arcanist"] as const)(
    "%s releases a moving shot from the current player position",
    (classId) => {
      const state = arena(classId);
      const impactTick = classId === "ranger" ? 6 : 8;
      for (let tick = 0; tick <= impactTick; tick += 1)
        stepGame(state, {
          ...EMPTY_INPUT,
          moveY: 1,
          attack: tick === 0,
          aim: state.monsters[0]!.position,
        });
      expect(state.projectiles).toHaveLength(1);
      expect(state.projectiles[0]!.position).toEqual(state.player.position);
    },
  );

  it("aims an untargeted strike at a nearby enemy while retreating", () => {
    const state = arena();
    state.monsters[0]!.position.x = state.player.position.x + 1000;
    stepGame(state, { ...EMPTY_INPUT, moveX: -1, attack: true });
    while (state.tick <= 8) stepGame(state, EMPTY_INPUT);
    expect(state.player.velocity).toEqual({ x: 0, y: 0 });
    expect(state.pendingAttacks).toHaveLength(0);
    expect(state.metrics.damageDealt).toBe(18);
  });

  it("respects deliberate cursor aiming even when a foe is behind the player", () => {
    const state = arena();
    state.monsters[0]!.position.x = state.player.position.x + 1000;
    stepGame(state, {
      ...EMPTY_INPUT,
      attack: true,
      aim: { x: state.player.position.x - 1000, y: state.player.position.y },
    });
    while (state.tick <= 8) stepGame(state, EMPTY_INPUT);
    expect(state.metrics.damageDealt).toBe(0);
  });

  it("does not cleave or auto-target an enemy through a wall", () => {
    const state = arena();
    state.player.position.x += 480;
    state.map.tiles[3 * state.map.width + 5] = 1;
    state.monsters[0]!.position.x = state.player.position.x + 1500;
    state.player.facing = { x: 0, y: 1024 };
    stepGame(state, { ...EMPTY_INPUT, attack: true });
    expect(state.pendingAttacks[0]!.direction).toEqual({ x: 0, y: 1024 });
    // Explicit aiming does not permit damage through a solid either.
    state.pendingAttacks[0]!.direction = { x: 1024, y: 0 };
    while (state.tick <= 8) stepGame(state, EMPTY_INPUT);
    expect(state.metrics.damageDealt).toBe(0);
  });
});
