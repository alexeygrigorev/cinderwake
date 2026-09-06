import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../game/constants";
import { monsterAttackProfile } from "../game/monsterAttackProfile";
import type { GameState, Vec2 } from "../game/types";
import { screenFor, type CameraV1, type DestinationRectV1 } from "./manifest";

/**
 * A presentation-only warning for one live elite radial-slam attack.
 *
 * Every geometric field is copied or projected from the pending attack. The
 * renderer must not infer the warning radius from an actor sprite cell: the
 * attack record is the same source used by simulation damage resolution.
 */
export interface CombatTelegraphV1 {
  paintId: string;
  paintRole: "combat-telegraph";
  layer: "effects";
  attackId: string;
  ownerId: string;
  worldCenter: Vec2;
  radius: number;
  impactTick: number;
  windupTicks: number;
  remainingTicks: number;
  countdownRatio: number;
  projectedCenter: Vec2;
  projectedRadius: number;
  projectedBounds: DestinationRectV1;
  visible: boolean;
}

function intersectsViewport(bounds: DestinationRectV1): boolean {
  return (
    bounds.x + bounds.width >= 0 &&
    bounds.y + bounds.height >= 0 &&
    bounds.x <= VIEW_WIDTH &&
    bounds.y <= VIEW_HEIGHT
  );
}

function clampedRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Build the only warning geometry used by the renderer. The warning exists
 * while the live attack is still pending, including the impact tick's
 * pre-resolution frame; once simulation resolves or cancels the attack, the
 * pending record disappears and so does this paint role.
 */
export function buildCombatTelegraphs(
  state: GameState,
  camera: CameraV1,
  presentationTick = state.tick,
): CombatTelegraphV1[] {
  const seenAttackIds = new Set<string>();
  return [...state.pendingAttacks]
    .sort((first, second) => first.id.localeCompare(second.id))
    .flatMap((attack) => {
      if (seenAttackIds.has(attack.id)) return [];
      seenAttackIds.add(attack.id);
      if (attack.kind !== "ability" || attack.impactTick < state.tick)
        return [];
      const owner = state.monsters.find(({ id }) => id === attack.ownerId);
      if (
        !owner ||
        owner.health <= 0 ||
        !owner.elite ||
        owner.kind !== "stonekin" ||
        monsterAttackProfile(owner).pattern !== "radial-slam"
      )
        return [];

      const projectedCenter = screenFor(attack.origin, camera);
      const projectedRadius =
        (attack.range / UNITS_PER_TILE) * TILE_PIXELS * camera.zoom;
      const projectedBounds = {
        x: projectedCenter.x - projectedRadius,
        y: projectedCenter.y - projectedRadius,
        width: projectedRadius * 2,
        height: projectedRadius * 2,
      };
      const windupTicks = monsterAttackProfile(owner).windupTicks;
      const remainingTicks = Math.max(0, attack.impactTick - presentationTick);
      return [
        {
          paintId: `combat-telegraph:${attack.id}`,
          paintRole: "combat-telegraph" as const,
          layer: "effects" as const,
          attackId: attack.id,
          ownerId: attack.ownerId,
          worldCenter: { ...attack.origin },
          radius: attack.range,
          impactTick: attack.impactTick,
          windupTicks,
          remainingTicks,
          countdownRatio: clampedRatio(remainingTicks / windupTicks),
          projectedCenter,
          projectedRadius,
          projectedBounds,
          visible: intersectsViewport(projectedBounds),
        },
      ];
    });
}
