import { describe, expect, it } from "vitest";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { canonicalJson } from "../../src/testkit/canonical";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { stateFromSnapshot } from "../../src/testkit/stateSnapshots";

function finishStrike(state: ReturnType<typeof worldFromScenario>) {
  stepGame(state, { ...EMPTY_INPUT, attack: true });
  while (state.tick <= 8) stepGame(state, EMPTY_INPUT);
}

describe("earned player progression", () => {
  it("converts the first 80 earned XP into health and power", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["combat-loot"]!);
    state.player.xp = 65;
    state.player.power = 0;
    state.monsters[0]!.health = 18;
    state.player.health = 20;
    const maxHealth = state.player.maxHealth;
    finishStrike(state);
    expect(state.player).toMatchObject({
      xp: 80,
      level: 2,
      health: 32,
      maxHealth: maxHealth + 12,
      power: 2,
    });
    while (state.tick < 65) stepGame(state, EMPTY_INPUT);
    expect(state.player.level).toBe(2);
    expect(state.player.power).toBe(2);
  });

  it("crosses multiple earned thresholds exactly once and replays identically", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["combat-loot"]!);
    state.player.xp = 345;
    state.player.power = 0;
    state.monsters[0]!.health = 18;
    const copy = stateFromSnapshot(JSON.parse(canonicalJson(state)));
    finishStrike(state);
    finishStrike(copy);
    expect(state.player).toMatchObject({ xp: 360, level: 4, power: 6 });
    expect(canonicalJson(copy)).toBe(canonicalJson(state));
    expect(
      canonicalJson(stateFromSnapshot(JSON.parse(canonicalJson(state)))),
    ).toBe(canonicalJson(state));
  });

  it("cannot resurrect a player killed on the same tick as a rewarding hit", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["combat-loot"]!);
    state.player.xp = 65;
    state.player.health = 1;
    stepGame(state, { ...EMPTY_INPUT, attack: true });
    while (state.tick < 8) stepGame(state, EMPTY_INPUT);
    state.projectiles.push({
      id: "lethal",
      owner: "enemy",
      hostile: true,
      position: { ...state.player.position },
      previousPosition: { ...state.player.position },
      velocity: { x: 0, y: 0 },
      radius: 130,
      damage: 99,
      expiresAtTick: 30,
      color: "#ff0000",
      pierce: 0,
      spawnedAtTick: 0,
      hitTargets: [],
    });
    stepGame(state, EMPTY_INPUT);
    expect(state.player.xp).toBe(80);
    expect(state.phase).toBe("lost");
    expect(state.player.health).toBe(0);
  });
});
