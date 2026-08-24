import type {
  DestinationRectV1,
  DrawCallV1,
  RenderManifestV1,
  SceneSpriteV2,
} from "../../src/render/manifest";

export interface CityCompositionViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CityRoleEvidence {
  declaredCount: number;
  visibleCount: number;
  distinctVisibleSpriteCount: number;
  visibleSpriteIds: string[];
}

export interface CityActorOverlapEvidence {
  actorId: string;
  structureId: string;
  actorAreaRatio: number;
}

export interface CityActorPairOverlapEvidence {
  actorIds: [string, string];
  smallerActorAreaRatio: number;
}

export interface CityCompositionEvidence {
  viewport: CityCompositionViewport;
  requiredSceneIds: string[];
  missingRequiredSceneIds: string[];
  requiredActorIds: string[];
  missingRequiredActorIds: string[];
  roles: {
    structures: CityRoleEvidence;
    props: CityRoleEvidence;
    decals: CityRoleEvidence;
    actors: CityRoleEvidence;
  };
  visibleSecondarySceneryCount: number;
  visibleSecondarySpriteDiversity: number;
  sceneryUnionOccupancyRatio: number;
  horizontalCoverageRatio: number;
  verticalCoverageRatio: number;
  largestEmptyHorizontalBandRatio: number;
  largestEmptyVerticalBandRatio: number;
  dominantVisiblePropSpriteId: string | null;
  dominantVisiblePropCount: number;
  duplicatePropConcentration: number;
  playerVisibleFraction: number;
  maximumActorStructureOverlap: CityActorOverlapEvidence | null;
  maximumActorPairOverlap: CityActorPairOverlapEvidence | null;
}

export interface CityCompositionAssessment {
  pass: boolean;
  evidence: CityCompositionEvidence;
  violations: string[];
  /** Geometry is a prerequisite, never an aesthetic approval. */
  limitation: string;
  mandatoryVisualReview: true;
}

const REQUIRED_SCENE_IDS = [
  "building:embercross:market",
  "building:embercross:tavern",
  "building:embercross:infirmary",
  "gate:embercross:south",
] as const;

const REQUIRED_ACTOR_IDS = [
  "player",
  "npc:embercross:mara",
  "npc:embercross:oren",
  "npc:embercross:tess",
  "npc:embercross:ileya",
] as const;

const MINIMUM_VISIBLE_SECONDARY_SCENERY = 10;
const MINIMUM_VISIBLE_SECONDARY_DIVERSITY = 7;
const MINIMUM_SCENERY_OCCUPANCY = 0.075;
const MAXIMUM_SCENERY_OCCUPANCY = 0.7;
const MINIMUM_AXIS_COVERAGE = 0.5;
const MAXIMUM_EMPTY_AXIS_BAND = 0.42;
const MAXIMUM_DUPLICATE_PROP_CONCENTRATION = 0.58;
const MINIMUM_PLAYER_VISIBLE_FRACTION = 0.8;
const MAXIMUM_ACTOR_STRUCTURE_OVERLAP = 0.82;
const MAXIMUM_ACTOR_PAIR_OVERLAP = 0.65;

function isCityScene(sprite: SceneSpriteV2): boolean {
  return sprite.objectId.includes(":embercross:");
}

function isCityActor(actor: DrawCallV1): boolean {
  return (
    actor.entityId === "player" || actor.entityId.startsWith("npc:embercross:")
  );
}

function sceneRole(
  sprite: SceneSpriteV2,
): "structures" | "props" | "decals" | null {
  if (sprite.layer === "structures") return "structures";
  if (sprite.layer === "props") return "props";
  if (sprite.layer === "terrain" && sprite.objectId.startsWith("decal:"))
    return "decals";
  return null;
}

function intersectionRect(
  first: DestinationRectV1,
  second: CityCompositionViewport | DestinationRectV1,
): DestinationRectV1 | null {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function area(rect: DestinationRectV1): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function intersectionArea(
  first: DestinationRectV1,
  second: CityCompositionViewport | DestinationRectV1,
): number {
  const intersection = intersectionRect(first, second);
  return intersection ? area(intersection) : 0;
}

function rectangleUnionArea(
  rectangles: DestinationRectV1[],
  viewport: CityCompositionViewport,
): number {
  const clipped = rectangles.flatMap((rect) => {
    const intersection = intersectionRect(rect, viewport);
    return intersection ? [intersection] : [];
  });
  const xEdges = [
    ...new Set(clipped.flatMap((rect) => [rect.x, rect.x + rect.width])),
  ].sort((first, second) => first - second);
  let total = 0;
  for (let index = 0; index < xEdges.length - 1; index += 1) {
    const left = xEdges[index]!;
    const right = xEdges[index + 1]!;
    const intervals = clipped
      .filter((rect) => rect.x < right && rect.x + rect.width > left)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((first, second) => first[0] - second[0]);
    let coveredHeight = 0;
    let activeStart = 0;
    let activeEnd = 0;
    intervals.forEach(([start, end], intervalIndex) => {
      if (intervalIndex === 0) {
        activeStart = start;
        activeEnd = end;
      } else if (start <= activeEnd) activeEnd = Math.max(activeEnd, end);
      else {
        coveredHeight += activeEnd - activeStart;
        activeStart = start;
        activeEnd = end;
      }
    });
    if (intervals.length > 0) coveredHeight += activeEnd - activeStart;
    total += (right - left) * coveredHeight;
  }
  return total;
}

function axisCoverage(
  rectangles: DestinationRectV1[],
  viewport: CityCompositionViewport,
  axis: "x" | "y",
): { coverageRatio: number; largestEmptyBandRatio: number } {
  const start = viewport[axis];
  const size = axis === "x" ? viewport.width : viewport.height;
  const dimension = axis === "x" ? "width" : "height";
  const intervals = rectangles
    .flatMap((rect) => {
      const intervalStart = Math.max(start, rect[axis]);
      const intervalEnd = Math.min(start + size, rect[axis] + rect[dimension]);
      return intervalEnd > intervalStart
        ? [[intervalStart, intervalEnd] as const]
        : [];
    })
    .sort((first, second) => first[0] - second[0]);
  const merged: Array<[number, number]> = [];
  for (const [intervalStart, intervalEnd] of intervals) {
    const active = merged.at(-1);
    if (active && intervalStart <= active[1])
      active[1] = Math.max(active[1], intervalEnd);
    else merged.push([intervalStart, intervalEnd]);
  }
  const covered = merged.reduce(
    (total, [intervalStart, intervalEnd]) =>
      total + intervalEnd - intervalStart,
    0,
  );
  let cursor = start;
  let largestEmptyBand = 0;
  for (const [intervalStart, intervalEnd] of merged) {
    largestEmptyBand = Math.max(largestEmptyBand, intervalStart - cursor);
    cursor = intervalEnd;
  }
  largestEmptyBand = Math.max(largestEmptyBand, start + size - cursor);
  return {
    coverageRatio: covered / size,
    largestEmptyBandRatio: largestEmptyBand / size,
  };
}

function roleEvidence(
  declared: SceneSpriteV2[],
  visible: SceneSpriteV2[],
  role: "structures" | "props" | "decals",
): CityRoleEvidence {
  const declaredRole = declared.filter((sprite) => sceneRole(sprite) === role);
  const visibleRole = visible.filter((sprite) => sceneRole(sprite) === role);
  const spriteIds = [
    ...new Set(visibleRole.map(({ spriteId }) => spriteId)),
  ].sort();
  return {
    declaredCount: declaredRole.length,
    visibleCount: visibleRole.length,
    distinctVisibleSpriteCount: spriteIds.length,
    visibleSpriteIds: spriteIds,
  };
}

function actorRoleEvidence(
  declared: DrawCallV1[],
  visible: DrawCallV1[],
): CityRoleEvidence {
  const spriteIds = [
    ...new Set(visible.map(({ spriteId }) => spriteId)),
  ].sort();
  return {
    declaredCount: declared.length,
    visibleCount: visible.length,
    distinctVisibleSpriteCount: spriteIds.length,
    visibleSpriteIds: spriteIds,
  };
}

function maximumActorStructureOverlap(
  actors: DrawCallV1[],
  structures: SceneSpriteV2[],
): CityActorOverlapEvidence | null {
  const overlaps = actors.flatMap((actor) =>
    structures.map((structure) => ({
      actorId: actor.entityId,
      structureId: structure.objectId,
      actorAreaRatio:
        intersectionArea(actor.destinationRect, structure.destinationRect) /
        Math.max(1, area(actor.destinationRect)),
    })),
  );
  return (
    overlaps.sort(
      (first, second) => second.actorAreaRatio - first.actorAreaRatio,
    )[0] ?? null
  );
}

function maximumActorPairOverlap(
  actors: DrawCallV1[],
): CityActorPairOverlapEvidence | null {
  const overlaps: CityActorPairOverlapEvidence[] = [];
  actors.forEach((first, firstIndex) => {
    for (const second of actors.slice(firstIndex + 1)) {
      overlaps.push({
        actorIds: [first.entityId, second.entityId],
        smallerActorAreaRatio:
          intersectionArea(first.destinationRect, second.destinationRect) /
          Math.max(
            1,
            Math.min(area(first.destinationRect), area(second.destinationRect)),
          ),
      });
    }
  });
  return (
    overlaps.sort(
      (first, second) =>
        second.smallerActorAreaRatio - first.smallerActorAreaRatio,
    )[0] ?? null
  );
}

/**
 * Measures objective Embercross composition prerequisites for PRES-PROP-020
 * and PRES-DENSITY-022. Passing means the manifest has required roles,
 * diversity, spread, and focal-actor readability. It cannot establish beauty,
 * style coherence, saliency, material quality, or artistic hierarchy.
 */
export function assessCityComposition(
  manifest: RenderManifestV1,
  viewport: CityCompositionViewport = {
    x: 0,
    y: 0,
    width: manifest.viewport.width,
    height: manifest.viewport.height,
  },
): CityCompositionAssessment {
  const declaredScenes = manifest.sceneSprites.filter(isCityScene);
  const visibleScenes = declaredScenes.filter(
    ({ visible, destinationRect }) =>
      visible && intersectionArea(destinationRect, viewport) > 0,
  );
  const declaredActors = manifest.drawCalls.filter(isCityActor);
  const visibleActors = declaredActors.filter(
    ({ visible, destinationRect }) =>
      visible && intersectionArea(destinationRect, viewport) > 0,
  );
  const visibleStructures = visibleScenes.filter(
    (sprite) => sceneRole(sprite) === "structures",
  );
  const visibleProps = visibleScenes.filter(
    (sprite) => sceneRole(sprite) === "props",
  );
  const secondaryScenes = visibleScenes.filter(
    ({ objectId }) =>
      !(REQUIRED_SCENE_IDS as readonly string[]).includes(objectId),
  );
  const secondarySpriteIds = new Set(
    secondaryScenes.map(({ spriteId }) => spriteId),
  );
  const sceneryRectangles = visibleScenes.map(
    ({ destinationRect }) => destinationRect,
  );
  const horizontal = axisCoverage(sceneryRectangles, viewport, "x");
  const vertical = axisCoverage(sceneryRectangles, viewport, "y");
  const propFrequency = new Map<string, number>();
  for (const { spriteId } of visibleProps)
    propFrequency.set(spriteId, (propFrequency.get(spriteId) ?? 0) + 1);
  const dominantProp = [...propFrequency.entries()].sort(
    (first, second) =>
      second[1] - first[1] || first[0].localeCompare(second[0]),
  )[0];
  const player = declaredActors.find(({ entityId }) => entityId === "player");
  const playerVisibleFraction = player
    ? intersectionArea(player.destinationRect, viewport) /
      Math.max(1, area(player.destinationRect))
    : 0;
  const maximumStructureOverlap = maximumActorStructureOverlap(
    visibleActors,
    visibleStructures,
  );
  const maximumPairOverlap = maximumActorPairOverlap(visibleActors);
  const evidence: CityCompositionEvidence = {
    viewport: { ...viewport },
    requiredSceneIds: [...REQUIRED_SCENE_IDS],
    missingRequiredSceneIds: REQUIRED_SCENE_IDS.filter(
      (id) => !visibleScenes.some(({ objectId }) => objectId === id),
    ),
    requiredActorIds: [...REQUIRED_ACTOR_IDS],
    missingRequiredActorIds: REQUIRED_ACTOR_IDS.filter(
      (id) => !visibleActors.some(({ entityId }) => entityId === id),
    ),
    roles: {
      structures: roleEvidence(declaredScenes, visibleScenes, "structures"),
      props: roleEvidence(declaredScenes, visibleScenes, "props"),
      decals: roleEvidence(declaredScenes, visibleScenes, "decals"),
      actors: actorRoleEvidence(declaredActors, visibleActors),
    },
    visibleSecondarySceneryCount: secondaryScenes.length,
    visibleSecondarySpriteDiversity: secondarySpriteIds.size,
    sceneryUnionOccupancyRatio:
      rectangleUnionArea(sceneryRectangles, viewport) /
      (viewport.width * viewport.height),
    horizontalCoverageRatio: horizontal.coverageRatio,
    verticalCoverageRatio: vertical.coverageRatio,
    largestEmptyHorizontalBandRatio: horizontal.largestEmptyBandRatio,
    largestEmptyVerticalBandRatio: vertical.largestEmptyBandRatio,
    dominantVisiblePropSpriteId: dominantProp?.[0] ?? null,
    dominantVisiblePropCount: dominantProp?.[1] ?? 0,
    duplicatePropConcentration:
      visibleProps.length > 0
        ? (dominantProp?.[1] ?? 0) / visibleProps.length
        : 1,
    playerVisibleFraction,
    maximumActorStructureOverlap: maximumStructureOverlap,
    maximumActorPairOverlap: maximumPairOverlap,
  };
  const violations: string[] = [];
  if (evidence.missingRequiredSceneIds.length > 0)
    violations.push("city:required-scene-role-not-visible");
  if (evidence.missingRequiredActorIds.length > 0)
    violations.push("city:required-actor-role-not-visible");
  if (
    evidence.visibleSecondarySceneryCount < MINIMUM_VISIBLE_SECONDARY_SCENERY ||
    evidence.visibleSecondarySpriteDiversity <
      MINIMUM_VISIBLE_SECONDARY_DIVERSITY
  )
    violations.push("city:secondary-scenery-too-sparse");
  if (evidence.sceneryUnionOccupancyRatio < MINIMUM_SCENERY_OCCUPANCY)
    violations.push("city:authored-scenery-occupancy-too-low");
  if (evidence.sceneryUnionOccupancyRatio > MAXIMUM_SCENERY_OCCUPANCY)
    violations.push("city:authored-scenery-occupancy-too-high");
  if (
    evidence.horizontalCoverageRatio < MINIMUM_AXIS_COVERAGE ||
    evidence.verticalCoverageRatio < MINIMUM_AXIS_COVERAGE ||
    evidence.largestEmptyHorizontalBandRatio > MAXIMUM_EMPTY_AXIS_BAND ||
    evidence.largestEmptyVerticalBandRatio > MAXIMUM_EMPTY_AXIS_BAND
  )
    violations.push("city:large-empty-ground-band");
  if (
    visibleProps.length >= 4 &&
    evidence.duplicatePropConcentration > MAXIMUM_DUPLICATE_PROP_CONCENTRATION
  )
    violations.push("city:duplicate-prop-concentration-too-high");
  if (evidence.playerVisibleFraction < MINIMUM_PLAYER_VISIBLE_FRACTION)
    violations.push("city:focal-player-cropped-or-hidden");
  if (
    (evidence.maximumActorStructureOverlap?.actorAreaRatio ?? 0) >
    MAXIMUM_ACTOR_STRUCTURE_OVERLAP
  )
    violations.push("city:actor-covered-by-structure");
  if (
    (evidence.maximumActorPairOverlap?.smallerActorAreaRatio ?? 0) >
    MAXIMUM_ACTOR_PAIR_OVERLAP
  )
    violations.push("city:focal-actors-overlapped");
  return {
    pass: violations.length === 0,
    evidence,
    violations,
    limitation:
      "This geometry gate cannot approve beauty, style coherence, sprite quality, value contrast, or artistic hierarchy; PRES-PROP-020 and PRES-DENSITY-022 still require independent visual review of runtime frames.",
    mandatoryVisualReview: true,
  };
}
