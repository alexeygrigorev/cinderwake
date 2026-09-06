import { describe, expect, it } from "vitest";
import { UNITS_PER_TILE } from "../../src/game/constants";
import {
  getMonsterAttackProfile,
  monsterAttackProfile,
} from "../../src/game/monsterAttackProfile";
import type { MonsterState } from "../../src/game/types";

function monster(overrides: Partial<MonsterState> = {}): MonsterState {
  return {
    id: "monster:profile",
    kind: "ashfang",
    position: { x: 0, y: 0 },
    previousPosition: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: { x: 1024, y: 0 },
    radius: 300,
    health: 100,
    maxHealth: 100,
    armor: 0,
    moveSpeed: 40,
    attackDamage: 11,
    attackRange: 900,
    attackReadyTick: 0,
    elite: false,
    guaranteedLoot: false,
    deathTick: null,
    removeAtTick: null,
    animation: { clip: "idle", startedAtTick: 0, lockedUntilTick: 0 },
    ...overrides,
  };
}

describe("monster attack profile", () => {
  it("specifies the Bell Keeper slam just above half health", () => {
    expect(
      monsterAttackProfile(
        monster({
          kind: "stonekin",
          elite: true,
          health: 51,
          maxHealth: 100,
          attackDamage: 23,
        }),
      ),
    ).toEqual({
      pattern: "radial-slam",
      windupTicks: 48,
      recoveryTicks: 24,
      cooldownTicks: 132,
      range: 2 * UNITS_PER_TILE,
      damage: 23,
    });
  });

  it("switches cooldown exactly at half health without changing damage", () => {
    const atHalf = monsterAttackProfile(
      monster({
        kind: "stonekin",
        elite: true,
        health: 50,
        maxHealth: 100,
        attackDamage: 23,
      }),
    );
    const belowHalf = monsterAttackProfile(
      monster({
        kind: "stonekin",
        elite: true,
        health: 49,
        maxHealth: 100,
        attackDamage: 23,
      }),
    );

    expect(atHalf.cooldownTicks).toBe(96);
    expect(belowHalf.cooldownTicks).toBe(96);
    expect(atHalf.damage).toBe(23);
    expect(belowHalf.damage).toBe(23);
  });

  it.each([
    ["ashfang", false, "cone", 7, 19, 75, 850, 11],
    ["ashfang", true, "cone", 7, 19, 75, 850, 19],
    ["hexer", false, "projectile", 12, 14, 105, 5 * UNITS_PER_TILE, 7],
    ["hexer", true, "projectile", 12, 14, 105, 5 * UNITS_PER_TILE, 13],
    ["stonekin", false, "cone", 10, 16, 110, 1050, 11],
  ] as const)(
    "preserves the current %s %s timing, range and damage",
    (
      kind,
      elite,
      pattern,
      windupTicks,
      recoveryTicks,
      cooldownTicks,
      range,
      damage,
    ) => {
      const actual = monsterAttackProfile(
        monster({
          kind,
          elite,
          attackDamage: damage,
          attackRange: range,
        }),
      );

      expect(actual).toEqual({
        pattern,
        windupTicks,
        recoveryTicks,
        cooldownTicks,
        range,
        damage,
      });
    },
  );

  it("is pure and exposes the same profile through its named alias", () => {
    const input = monster({
      kind: "stonekin",
      elite: true,
      health: 80,
      maxHealth: 100,
      attackDamage: 17,
    });
    const before = structuredClone(input);
    expect(getMonsterAttackProfile(input)).toEqual(monsterAttackProfile(input));
    expect(input).toEqual(before);
  });
});
