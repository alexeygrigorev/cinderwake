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
  maximumAttachedEffectAnchorDistance: 1,
  maximumPresentationOffsetStepPerTick: 4,
} as const;

export interface CombatReadabilityRequirements {
  requiredEffectOwnerIds?: string[];
}

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
    attached: boolean;
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
  requirements: CombatReadabilityRequirements = {},
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
  for (const monster of monsters) {
    if (!manifest.worldUi.some(({ ownerId }) => ownerId === monster.entityId))
      violations.push(`combat:health-missing:${monster.entityId}`);
  }

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
      const attached =
        anchorDistance <=
        COMBAT_READABILITY_LIMITS.maximumAttachedEffectAnchorDistance;
      const paintsBehindActor = effect.zOrder < nearest.zOrder;
      if (attached && !paintsBehindActor)
        violations.push(`combat:attached-effect-depth:${effect.entityId}`);
      return [
        {
          effectId: effect.entityId,
          actorId: nearest.entityId,
          anchorDistance,
          attached,
          paintsBehindActor,
        },
      ];
    });

  for (const actorId of requirements.requiredEffectOwnerIds ?? []) {
    const candidates = attachedEffects
      .filter(({ actorId: ownerId }) => ownerId === actorId)
      .sort(
        (first, second) =>
          first.anchorDistance - second.anchorDistance ||
          first.effectId.localeCompare(second.effectId),
      );
    if (candidates.length === 0) {
      violations.push(`combat:attached-effect-missing:${actorId}`);
      continue;
    }
    if (!candidates[0]!.attached)
      violations.push(
        `combat:attached-effect-detached:${candidates[0]!.effectId}`,
      );
  }

  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    violations,
    evidence: { actorPairs, health, attachedEffects },
  };
}

export interface CombatSequenceFrame {
  id: string;
  manifest: RenderManifestV1;
  requiredEffectOwnerIds?: string[];
}

export function assessCombatSequence(frames: CombatSequenceFrame[]): {
  verdict: "PASS" | "FAIL";
  violations: string[];
  frames: Array<{ id: string; assessment: CombatReadabilityAssessment }>;
} {
  const violations: string[] = [];
  const assessedFrames = frames.map((frame) => {
    const assessment = assessCombatReadability(frame.manifest, {
      requiredEffectOwnerIds: frame.requiredEffectOwnerIds,
    });
    violations.push(
      ...assessment.violations.map((violation) => `${frame.id}:${violation}`),
    );
    return { id: frame.id, assessment };
  });
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const elapsedTicks = Math.max(
      1,
      current.manifest.presentationTick - previous.manifest.presentationTick,
    );
    for (const currentActor of current.manifest.drawCalls.filter(
      ({ type }) => type === "player" || type === "monster",
    )) {
      const previousActor = previous.manifest.drawCalls.find(
        ({ entityId }) => entityId === currentActor.entityId,
      );
      if (!previousActor) continue;
      const previousOffset = previousActor.presentationOffset ?? { x: 0, y: 0 };
      const currentOffset = currentActor.presentationOffset ?? { x: 0, y: 0 };
      const offsetStep = Math.hypot(
        currentOffset.x - previousOffset.x,
        currentOffset.y - previousOffset.y,
      );
      if (
        offsetStep >
        COMBAT_READABILITY_LIMITS.maximumPresentationOffsetStepPerTick *
          elapsedTicks
      )
        violations.push(
          `${current.id}:combat:presentation-snap:${currentActor.entityId}`,
        );
    }
  }
  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    violations,
    frames: assessedFrames,
  };
}
