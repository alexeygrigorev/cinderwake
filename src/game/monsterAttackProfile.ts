import { CLIP_DURATIONS, UNITS_PER_TILE } from "./constants";
import { MONSTERS } from "./content";
import type { MonsterKind, MonsterState } from "./types";

export type MonsterAttackPattern = "cone" | "projectile" | "radial-slam";

export interface MonsterAttackProfile {
  pattern: MonsterAttackPattern;
  windupTicks: number;
  recoveryTicks: number;
  cooldownTicks: number;
  range: number;
  damage: number;
}

const CURRENT_WINDUP_TICKS: Record<MonsterKind, number> = {
  ashfang: 7,
  hexer: 12,
  stonekin: 10,
};

/**
 * Return the attack timing and geometry for one monster without changing it.
 *
 * The ordinary profiles describe the existing primary-attack behavior. Their
 * recovery completes the current 26-tick attack animation lock so this card
 * does not change gameplay; the elite Stonekin profile is the first-playtest
 * Bell Keeper hypothesis and is intentionally not wired into scheduling yet.
 */
export function monsterAttackProfile(
  monster: MonsterState,
): MonsterAttackProfile {
  if (monster.kind === "stonekin" && monster.elite) {
    return {
      pattern: "radial-slam",
      windupTicks: 48,
      recoveryTicks: 24,
      cooldownTicks: monster.health <= monster.maxHealth / 2 ? 96 : 132,
      range: 2 * UNITS_PER_TILE,
      damage: monster.attackDamage,
    };
  }

  const windupTicks = CURRENT_WINDUP_TICKS[monster.kind];
  return {
    pattern: monster.kind === "hexer" ? "projectile" : "cone",
    windupTicks,
    recoveryTicks: CLIP_DURATIONS.attack - windupTicks,
    cooldownTicks: MONSTERS[monster.kind].attackCooldown,
    range: monster.attackRange,
    damage: monster.attackDamage,
  };
}

export const getMonsterAttackProfile = monsterAttackProfile;
