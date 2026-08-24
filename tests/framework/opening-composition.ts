import type {
  RenderManifestV1,
  SceneSpriteV2,
} from "../../src/render/manifest";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../../src/game/constants";

export interface OpeningCompositionEvidence {
  visibleBoundaryCount: number;
  visibleWallFrontCount: number;
  uniqueWallFrontTileCount: number;
  wallHorizontalSpanRatio: number;
  wallVerticalSpanRatio: number;
  thresholdVisible: boolean;
  thresholdDistanceFromPlayer: number | null;
  visibleLanternCount: number;
  lanternDistanceImbalance: number | null;
  openingFocalCount: number;
  openingFocalAreaRatio: number;
  maximumOpeningFocalAreaRatio: number;
  visibleBackdropCount: number;
  uniqueBackdropSpriteCount: number;
  backdropAreaRatio: number;
  backdropCollisionViolationCount: number;
  forgeVisibleFraction: number;
  raisedCollisionViolationCount: number;
  adjacentRoomLeakCount: number;
  environmentKitVisibleRoleCount: number;
  environmentKitSpriteMismatchCount: number;
  warmFloorLightCount: number;
  detachedWarmFloorLightCount: number;
  northWallFeatureCount: number;
  northWallStretchedCount: number;
  northWallLegacyFacadeCount: number;
  northWallShellTileCount: number;
  northWallVisibleCapCount: number;
  northWallMissingCapCount: number;
  northWallMismatchedCapCount: number;
}

export interface OpeningCompositionAssessment {
  pass: boolean;
  evidence: OpeningCompositionEvidence;
  violations: string[];
  limitation: string;
}

export interface OpeningCompositionViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FULL_VIEWPORT: OpeningCompositionViewport = {
  x: 0,
  y: 0,
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
};

function distance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function spanRatio(
  sprites: SceneSpriteV2[],
  axis: "x" | "y",
  viewport: OpeningCompositionViewport,
): number {
  if (sprites.length === 0) return 0;
  const viewportStart = viewport[axis];
  const viewportSize = axis === "x" ? viewport.width : viewport.height;
  const start = Math.max(
    viewportStart,
    Math.min(...sprites.map(({ destinationRect }) => destinationRect[axis])),
  );
  const size = axis === "x" ? "width" : "height";
  const end = Math.min(
    viewportStart + viewportSize,
    Math.max(
      ...sprites.map(
        ({ destinationRect }) => destinationRect[axis] + destinationRect[size],
      ),
    ),
  );
  return Math.max(0, end - start) / viewportSize;
}

function intersectionArea(
  rect: { x: number; y: number; width: number; height: number },
  viewport: OpeningCompositionViewport,
): number {
  const width = Math.max(
    0,
    Math.min(rect.x + rect.width, viewport.x + viewport.width) -
      Math.max(rect.x, viewport.x),
  );
  const height = Math.max(
    0,
    Math.min(rect.y + rect.height, viewport.y + viewport.height) -
      Math.max(rect.y, viewport.y),
  );
  return width * height;
}

function clippedRect(
  rect: { x: number; y: number; width: number; height: number },
  viewport: OpeningCompositionViewport,
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(rect.x, viewport.x);
  const y = Math.max(rect.y, viewport.y);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  const bottom = Math.min(rect.y + rect.height, viewport.y + viewport.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function rectangleUnionArea(
  rectangles: Array<{ x: number; y: number; width: number; height: number }>,
  viewport: OpeningCompositionViewport,
): number {
  const clipped = rectangles.flatMap((rect) => {
    const value = clippedRect(rect, viewport);
    return value ? [value] : [];
  });
  const edges = [
    ...new Set(clipped.flatMap((rect) => [rect.x, rect.x + rect.width])),
  ].sort((first, second) => first - second);
  let area = 0;
  for (let index = 0; index < edges.length - 1; index += 1) {
    const left = edges[index]!;
    const right = edges[index + 1]!;
    const intervals = clipped
      .filter((rect) => rect.x < right && rect.x + rect.width > left)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((first, second) => first[0] - second[0]);
    let coveredY = 0;
    let activeStart = 0;
    let activeEnd = 0;
    intervals.forEach(([start, end], intervalIndex) => {
      if (intervalIndex === 0) {
        activeStart = start;
        activeEnd = end;
      } else if (start <= activeEnd) activeEnd = Math.max(activeEnd, end);
      else {
        coveredY += activeEnd - activeStart;
        activeStart = start;
        activeEnd = end;
      }
    });
    if (intervals.length > 0) coveredY += activeEnd - activeStart;
    area += (right - left) * coveredY;
  }
  return area;
}

function roomIndex(objectId: string): number | null {
  const match = objectId.match(/^(?:structure|prop|decal):(\d+):/);
  return match ? Number(match[1]) : null;
}

/**
 * Measures only concrete opening-room composition contracts. These checks can
 * prove that a visible boundary, doorway cue, and authored focal mass exist;
 * they cannot prove that the resulting picture is attractive or stylistically
 * coherent, which remains a screenshot-review responsibility.
 */
export function assessOpeningComposition(
  manifest: RenderManifestV1,
  viewport: OpeningCompositionViewport = FULL_VIEWPORT,
): OpeningCompositionAssessment {
  const visible = manifest.sceneSprites.filter(
    ({ visible, destinationRect }) =>
      visible && intersectionArea(destinationRect, viewport) > 0,
  );
  const boundaries = visible.filter(({ objectId }) =>
    objectId.startsWith("boundary:"),
  );
  const wallFronts = visible.filter(({ objectId }) =>
    objectId.startsWith("wall-front:"),
  );
  const threshold = visible.find(({ objectId }) =>
    objectId.startsWith("architecture:opening:threshold:"),
  );
  const lanterns = visible.filter(({ objectId }) =>
    objectId.startsWith("architecture:opening:lantern:"),
  );
  const player = manifest.drawCalls.find(
    ({ entityId, visible: playerVisible }) =>
      entityId === "player" && playerVisible,
  );
  const openingFocals = visible.filter(({ objectId }) => {
    const index = roomIndex(objectId);
    return index === 0 && !objectId.startsWith("decal:");
  });
  const forge = manifest.sceneSprites.find(
    ({ objectId }) => objectId === "structure:0:forge",
  );
  const backdrops = visible.filter(({ objectId }) =>
    objectId.startsWith("architecture:opening:backdrop:"),
  );
  const adjacentRoomLeaks = visible.filter(({ objectId }) => {
    const index = roomIndex(objectId);
    return index !== null && index > 0;
  });
  const raisedCollisionViolations = visible.filter(
    ({ layer, collision }) =>
      layer !== "terrain" &&
      (!collision || collision.mode !== "solid" || collision.halfWidth <= 0),
  );
  const wallTileKeys = new Set(
    wallFronts.map(({ tile }) => `${tile.x}:${tile.y}`),
  );
  const environmentKitRoles = [
    {
      objectId: "structure:0:forge",
      spriteId: "scenery:structure:forge-workshop",
    },
    {
      objectId: "architecture:opening:lantern:0",
      spriteId: "scenery:prop:lantern-a",
    },
    {
      objectId: "architecture:opening:lantern:1",
      spriteId: "scenery:prop:lantern-b",
    },
    {
      objectId: "prop:0:barricade-v2",
      spriteId: "scenery:prop:barricade-v2",
    },
    {
      objectId: "prop:0:raised-clutter-bench",
      spriteId: "scenery:prop:raised-clutter-bench",
    },
  ] as const;
  const visibleKitRoles = environmentKitRoles.flatMap((role) => {
    const sprite = visible.find(({ objectId }) => objectId === role.objectId);
    return sprite ? [{ role, sprite }] : [];
  });
  const forgeLight = visible.find(({ objectId }) =>
    objectId.startsWith("decal:0:0:scorch-ring"),
  );
  const lanternLights = visible.filter(({ objectId }) =>
    objectId.startsWith("architecture:opening:lantern-light:"),
  );
  const warmFloorLights = forgeLight
    ? [forgeLight, ...lanternLights]
    : lanternLights;
  const raisedLightOwners = [forge, ...lanterns].filter(
    (sprite): sprite is SceneSpriteV2 => Boolean(sprite),
  );
  const detachedWarmFloorLights = warmFloorLights.filter((light) =>
    raisedLightOwners.every(
      ({ worldAnchor }) =>
        worldAnchor.x !== light.worldAnchor.x ||
        worldAnchor.y !== light.worldAnchor.y,
    ),
  );
  const northWalls = manifest.sceneSprites.filter(
    ({ objectId }) => objectId === "architecture:opening:north-wall",
  );
  const northWallLegacyFacades = manifest.sceneSprites.filter(({ objectId }) =>
    objectId.startsWith("wall-front:"),
  );
  const wallOverlayKeys = new Set(
    manifest.sceneSprites
      .filter(({ objectId }) => objectId.startsWith("wall-overlay:"))
      .map(({ tile }) => `${tile.x}:${tile.y}`),
  );
  const northWallShellTiles = northWalls.flatMap((wall) => {
    const isSouthEdgeWall = (x: number) =>
      wallOverlayKeys.has(`${x}:${wall.tile.y}`) &&
      !wallOverlayKeys.has(`${x}:${wall.tile.y + 1}`);
    if (!isSouthEdgeWall(wall.tile.x)) return [];
    let firstX = wall.tile.x;
    let lastX = wall.tile.x;
    while (isSouthEdgeWall(firstX - 1)) firstX -= 1;
    while (isSouthEdgeWall(lastX + 1)) lastX += 1;
    return Array.from({ length: lastX - firstX + 1 }, (_, index) => ({
      x: firstX + index,
      y: wall.tile.y,
    }));
  });
  const northWallCaps = northWallShellTiles.map((tile) => ({
    tile,
    sprite: manifest.sceneSprites.find(
      ({ objectId }) => objectId === `boundary:south:${tile.x}:${tile.y}`,
    ),
  }));
  const missingNorthWallCaps = northWallCaps.filter(
    ({ sprite }) => !sprite || !sprite.visible,
  );
  const mismatchedNorthWallCaps = northWallCaps.filter(
    ({ tile, sprite }) =>
      Boolean(sprite) &&
      (sprite!.spriteId !== "scenery:boundary:stone" ||
        sprite!.tile.x !== tile.x ||
        sprite!.tile.y !== tile.y ||
        sprite!.sourceRect.height !== 64),
  );
  const lanternDistances = threshold
    ? lanterns.map(({ screenAnchor }) =>
        distance(screenAnchor, threshold.screenAnchor),
      )
    : [];
  const evidence: OpeningCompositionEvidence = {
    visibleBoundaryCount: boundaries.length,
    visibleWallFrontCount: wallFronts.length,
    uniqueWallFrontTileCount: wallTileKeys.size,
    wallHorizontalSpanRatio: spanRatio(boundaries, "x", viewport),
    wallVerticalSpanRatio: spanRatio(boundaries, "y", viewport),
    thresholdVisible: Boolean(threshold),
    thresholdDistanceFromPlayer:
      threshold && player
        ? distance(threshold.screenAnchor, player.screenAnchor)
        : null,
    visibleLanternCount: lanterns.length,
    lanternDistanceImbalance:
      lanternDistances.length === 2
        ? Math.abs(lanternDistances[0]! - lanternDistances[1]!)
        : null,
    openingFocalCount: openingFocals.length,
    openingFocalAreaRatio:
      rectangleUnionArea(
        openingFocals.map(({ destinationRect }) => destinationRect),
        viewport,
      ) /
      (viewport.width * viewport.height),
    // A portrait cover-crop exposes barely half the horizontal world area, so
    // the same fully visible forge necessarily occupies a larger share. Keep
    // a bounded portrait allowance instead of contradicting the 85% focal
    // visibility contract.
    maximumOpeningFocalAreaRatio:
      viewport.width / viewport.height < 0.75 ? 0.36 : 0.28,
    visibleBackdropCount: backdrops.length,
    uniqueBackdropSpriteCount: new Set(
      backdrops.map(({ spriteId }) => spriteId),
    ).size,
    backdropAreaRatio:
      rectangleUnionArea(
        backdrops.map(({ destinationRect }) => destinationRect),
        viewport,
      ) /
      (viewport.width * viewport.height),
    backdropCollisionViolationCount: backdrops.filter(
      ({ collision }) =>
        !collision || collision.mode !== "solid" || collision.halfWidth <= 0,
    ).length,
    forgeVisibleFraction: forge
      ? intersectionArea(forge.destinationRect, viewport) /
        (forge.destinationRect.width * forge.destinationRect.height)
      : 0,
    raisedCollisionViolationCount: raisedCollisionViolations.length,
    adjacentRoomLeakCount: adjacentRoomLeaks.length,
    environmentKitVisibleRoleCount: visibleKitRoles.length,
    environmentKitSpriteMismatchCount: visibleKitRoles.filter(
      ({ role, sprite }) => sprite.spriteId !== role.spriteId,
    ).length,
    warmFloorLightCount: warmFloorLights.length,
    detachedWarmFloorLightCount: detachedWarmFloorLights.length,
    northWallFeatureCount: northWalls.length,
    northWallStretchedCount: northWalls.filter(
      ({ destinationRect }) =>
        Math.abs(destinationRect.width - 187 * manifest.camera.zoom) > 0.01 ||
        Math.abs(destinationRect.height - 172 * manifest.camera.zoom) > 0.01,
    ).length,
    northWallLegacyFacadeCount: northWallLegacyFacades.length,
    northWallShellTileCount: northWallShellTiles.length,
    northWallVisibleCapCount:
      northWallCaps.length - missingNorthWallCaps.length,
    northWallMissingCapCount: missingNorthWallCaps.length,
    northWallMismatchedCapCount: mismatchedNorthWallCaps.length,
  };

  const violations: string[] = [];
  if (evidence.visibleBoundaryCount < 12)
    violations.push("opening:insufficient-visible-collision-boundary");
  if (evidence.wallHorizontalSpanRatio < 0.35)
    violations.push("opening:wall-horizontal-span-too-small");
  if (evidence.wallVerticalSpanRatio < 0.35)
    violations.push("opening:wall-depth-span-too-small");
  if (!evidence.thresholdVisible)
    violations.push("opening:threshold-cue-not-visible");
  if (
    evidence.thresholdDistanceFromPlayer === null ||
    evidence.thresholdDistanceFromPlayer < 80 ||
    evidence.thresholdDistanceFromPlayer > 420
  )
    violations.push("opening:threshold-not-legible-from-player");
  if (evidence.visibleLanternCount !== 2)
    violations.push("opening:threshold-lantern-pair-not-visible");
  if (
    evidence.lanternDistanceImbalance === null ||
    evidence.lanternDistanceImbalance > 4
  )
    violations.push("opening:threshold-lanterns-not-balanced");
  if (evidence.openingFocalCount < 2)
    violations.push("opening:authored-focal-occupancy-too-sparse");
  if (
    evidence.openingFocalAreaRatio < 0.025 ||
    evidence.openingFocalAreaRatio > evidence.maximumOpeningFocalAreaRatio
  )
    violations.push("opening:authored-focal-area-out-of-range");
  if (evidence.forgeVisibleFraction < 0.85)
    violations.push("opening:focal-forge-cropped");
  if (
    viewport.width / viewport.height >= 1.2 &&
    (evidence.visibleBackdropCount < 2 || evidence.backdropAreaRatio < 0.04)
  )
    violations.push("opening:wide-backdrop-too-sparse");
  if (
    evidence.visibleBackdropCount > 1 &&
    evidence.uniqueBackdropSpriteCount !== evidence.visibleBackdropCount
  )
    violations.push("opening:wide-backdrop-obviously-repeated");
  if (evidence.backdropCollisionViolationCount > 0)
    violations.push("opening:backdrop-missing-solid-collision");
  if (evidence.raisedCollisionViolationCount > 0)
    violations.push("opening:raised-scenery-missing-solid-collision");
  if (evidence.adjacentRoomLeakCount > 0)
    violations.push("opening:adjacent-room-fragment-visible");
  if (
    evidence.environmentKitVisibleRoleCount !== 5 ||
    evidence.environmentKitSpriteMismatchCount > 0
  )
    violations.push("opening:environment-kit-role-missing-or-mismatched");
  if (
    evidence.warmFloorLightCount !== 3 ||
    evidence.detachedWarmFloorLightCount > 0
  )
    violations.push("opening:warm-floor-light-missing-or-detached");
  if (evidence.northWallFeatureCount > 1)
    violations.push("opening:north-wall-repeated");
  if (evidence.northWallStretchedCount > 0)
    violations.push("opening:north-wall-stretched");
  if (
    evidence.northWallFeatureCount === 1 &&
    evidence.northWallLegacyFacadeCount > 0
  )
    violations.push("opening:north-wall-legacy-facade-present");
  if (
    evidence.northWallFeatureCount === 1 &&
    (evidence.northWallShellTileCount === 0 ||
      evidence.northWallMissingCapCount > 0)
  )
    violations.push("opening:north-wall-shell-cap-missing");
  if (
    evidence.northWallFeatureCount === 1 &&
    evidence.northWallMismatchedCapCount > 0
  )
    violations.push("opening:north-wall-shell-cap-mismatched");

  return {
    pass: violations.length === 0,
    evidence,
    violations,
    limitation:
      "Geometry and occupancy metrics do not prove beauty; review all four committed gameplay PNGs at actual size.",
  };
}
