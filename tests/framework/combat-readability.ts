import type {
  DestinationRectV1,
  DrawCallV1,
  RenderManifestV1,
} from "../../src/render/manifest";

export const COMBAT_READABILITY_LIMITS = {
  maximumPlayerMonsterDestinationOverlap: 0.57,
  minimumPlayerMonsterAnchorDistance: 48,
  maximumHealthWidthActorRatio: 0.37,
  maximumHealthHeightActorRatio: 0.18,
  minimumHealthInkGap: 3,
  maximumHealthInkGap: 5,
  maximumHealthCenterOffset: 1,
} as const;

export interface CombatReadabilityEvidence {
  actorPairs: Array<{
    monsterId: string;
    destinationOverlapRatio: number;
    anchorDistance: number;
    depthOrderCorrect: boolean;
  }>;
  health: Array<{
    ownerId: string;
    widthActorRatio: number;
    heightActorRatio: number;
    inkGap: number;
    centerOffset: number;
  }>;
  attachedEffects: Array<{
    effectId: string;
    actorId: string;
    anchorDistance: number;
    paintsBehindActor: boolean;
  }>;
}

export interface CombatReadabilityAssessment {
  verdict: "PASS" | "FAIL";
  violations: string[];
  evidence: CombatReadabilityEvidence;
}

function area(rect: DestinationRectV1): number {
  return rect.width * rect.height;
}

export function destinationOverlapRatio(
  first: DestinationRectV1,
  second: DestinationRectV1,
): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );
  return (width * height) / Math.max(1, Math.min(area(first), area(second)));
}

function screenDistance(first: DrawCallV1, second: DrawCallV1): number {
  return Math.hypot(
    first.screenAnchor.x - second.screenAnchor.x,
    first.screenAnchor.y - second.screenAnchor.y,
  );
}

/**
 * Pure manifest oracle for melee composition. It assesses production render
 * geometry and paint order without reading pixels, so arbitrary-state and
 * browser-sequence tests can reuse the same deterministic acceptance gate.
 */
export function assessCombatReadability(
  manifest: RenderManifestV1,
): CombatReadabilityAssessment {
  const violations: string[] = [];
  const player = manifest.drawCalls.find(
    ({ entityId }) => entityId === "player",
  );
  const monsters = manifest.drawCalls.filter(
    ({ type, visible }) => type === "monster" && visible,
  );
  const actors = manifest.drawCalls.filter(({ type }) =>
    ["player", "monster", "npc"].includes(type),
  );
  const actorPairs: CombatReadabilityEvidence["actorPairs"] = [];
  if (!player) violations.push("combat:missing-player");
  else {
    for (const monster of monsters) {
      const overlap = destinationOverlapRatio(
        player.destinationRect,
        monster.destinationRect,
      );
      const anchorDistance = screenDistance(player, monster);
      const footDelta = monster.footAnchor.y - player.footAnchor.y;
      const depthOrderCorrect =
        Math.abs(footDelta) < 0.01 ||
        (footDelta > 0
          ? monster.zOrder > player.zOrder
          : monster.zOrder < player.zOrder);
      actorPairs.push({
        monsterId: monster.entityId,
        destinationOverlapRatio: overlap,
        anchorDistance,
        depthOrderCorrect,
      });
      if (
        overlap >
        COMBAT_READABILITY_LIMITS.maximumPlayerMonsterDestinationOverlap
      )
        violations.push(`combat:body-overlap:${monster.entityId}`);
      if (
        anchorDistance <
        COMBAT_READABILITY_LIMITS.minimumPlayerMonsterAnchorDistance
      )
        violations.push(`combat:anchor-separation:${monster.entityId}`);
      if (!depthOrderCorrect)
        violations.push(`combat:actor-depth-order:${monster.entityId}`);
    }
  }

  const health = manifest.worldUi.map((worldUi) => {
    const owner = manifest.drawCalls.find(
      ({ entityId }) => entityId === worldUi.ownerId,
    );
    if (!owner) {
      violations.push(`combat:health-owner-missing:${worldUi.ownerId}`);
      return {
        ownerId: worldUi.ownerId,
        widthActorRatio: Number.POSITIVE_INFINITY,
        heightActorRatio: Number.POSITIVE_INFINITY,
        inkGap: Number.NEGATIVE_INFINITY,
        centerOffset: Number.POSITIVE_INFINITY,
      };
    }
    const widthActorRatio =
      worldUi.destinationRect.width / owner.destinationRect.width;
    const heightActorRatio =
      worldUi.destinationRect.height / owner.destinationRect.height;
    const inkGap =
      worldUi.actorInkTop -
      (worldUi.destinationRect.y + worldUi.destinationRect.height);
    const centerOffset = Math.abs(
      worldUi.destinationRect.x +
        worldUi.destinationRect.width / 2 -
        (owner.destinationRect.x + owner.destinationRect.width / 2),
    );
    if (
      widthActorRatio >
        COMBAT_READABILITY_LIMITS.maximumHealthWidthActorRatio ||
      heightActorRatio > COMBAT_READABILITY_LIMITS.maximumHealthHeightActorRatio
    )
      violations.push(`combat:health-dominates-actor:${worldUi.ownerId}`);
    if (
      inkGap < COMBAT_READABILITY_LIMITS.minimumHealthInkGap ||
      inkGap > COMBAT_READABILITY_LIMITS.maximumHealthInkGap ||
      centerOffset > COMBAT_READABILITY_LIMITS.maximumHealthCenterOffset
    )
      violations.push(`combat:health-detached:${worldUi.ownerId}`);
    return {
      ownerId: worldUi.ownerId,
      widthActorRatio,
      heightActorRatio,
      inkGap,
      centerOffset,
    };
  });

  const attachedEffects = manifest.drawCalls
    .filter(({ type }) => type === "effect")
    .flatMap((effect) => {
      const nearest = [...actors].sort(
        (first, second) =>
          screenDistance(effect, first) - screenDistance(effect, second) ||
          first.entityId.localeCompare(second.entityId),
      )[0];
      if (!nearest) return [];
      const anchorDistance = screenDistance(effect, nearest);
      if (anchorDistance > 1) return [];
      const paintsBehindActor = effect.zOrder < nearest.zOrder;
      if (!paintsBehindActor)
        violations.push(`combat:attached-effect-depth:${effect.entityId}`);
      return [
        {
          effectId: effect.entityId,
          actorId: nearest.entityId,
          anchorDistance,
          paintsBehindActor,
        },
      ];
    });

  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    violations,
    evidence: { actorPairs, health, attachedEffects },
  };
}
