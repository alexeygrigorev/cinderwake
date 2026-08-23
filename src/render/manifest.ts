import {
  CLIP_DURATIONS,
  CLIP_FRAMES,
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../game/constants";
import { buildSceneryLayout } from "../game/sceneryLayout";
import type { AnimationClip, GameState, Vec2 } from "../game/types";
import {
  SPRITE_CATALOG,
  SPRITE_CATALOG_REVISION,
  spriteFrame,
  type SourceRectV1,
} from "./sprites";

export interface CameraV1 {
  x: number;
  y: number;
  zoom: number;
}

export type CameraMode = "snap" | "smooth" | "fixed";

export interface DestinationRectV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpriteReferenceV2 {
  renderMode: "sprite";
  spriteId: string;
  assetId: string;
  sourceRect: SourceRectV1;
  frameIdentity: string;
}

export interface DrawCallV1 extends SpriteReferenceV2 {
  entityId: string;
  type: "player" | "monster" | "loot" | "projectile" | "effect";
  geometryId: string;
  clip: AnimationClip | "loot" | "projectile" | "static";
  frameIndex: number;
  frameCount: number;
  visualPhase: number;
  clipDurationTicks: number;
  clipStartedAtTick: number;
  clipLockedUntilTick: number;
  facing: Vec2;
  facingBucket: "north" | "east" | "south" | "west" | "none";
  flipX: boolean;
  worldAnchor: Vec2;
  screenAnchor: Vec2;
  destinationRect: DestinationRectV1;
  bounds: DestinationRectV1;
  footAnchor: Vec2;
  scale: number;
  tint: string;
  opacity: number;
  layer: "actors" | "items" | "projectiles" | "effects";
  zOrder: number;
  visible: boolean;
}

export interface SceneSpriteV2 extends SpriteReferenceV2 {
  objectId: string;
  kind: "tile" | "exit" | "prop";
  tile: { x: number; y: number };
  worldAnchor: Vec2;
  screenAnchor: Vec2;
  destinationRect: DestinationRectV1;
  layer: "terrain" | "structures" | "props" | "exit";
  zOrder: number;
  visible: boolean;
  opacity: number;
  rotation?: number;
  collision?: {
    mode: "solid" | "passable";
    shape: "ellipse";
    worldCenter: Vec2;
    halfWidth: number;
    halfHeight: number;
  } | null;
}

export interface WorldUiCallV1 {
  id: string;
  type: "monster-health";
  ownerId: string;
  destinationRect: DestinationRectV1;
  actorInkTop: number;
  healthRatio: number;
  visible: boolean;
}

export interface RenderManifestV1 {
  schemaVersion: 2;
  spriteCatalogRevision: string;
  tick: number;
  simTick: number;
  presentationTick: number;
  interpolationAlpha: number;
  viewport: { width: number; height: number; dpr: 1 };
  camera: CameraV1;
  cameraTarget: CameraV1;
  cameraMode: CameraMode;
  sceneSprites: SceneSpriteV2[];
  drawCalls: DrawCallV1[];
  worldUi: WorldUiCallV1[];
}

export interface EntityMaskV1 {
  entityId: string;
  mode: "isolated-draw-call";
  renderVisible: boolean;
  width: number;
  height: number;
  anchor: Vec2;
  inkBounds: { x: number; y: number; width: number; height: number };
  centroid: Vec2;
  alphaPixels: number;
  bottomOffset: number;
  maskInternalClipping: boolean;
  pixelHash: string;
  image: string;
}

export function screenFor(world: Vec2, camera: CameraV1): Vec2 {
  return {
    x: VIEW_WIDTH / 2 + (world.x / UNITS_PER_TILE) * TILE_PIXELS - camera.x,
    y: VIEW_HEIGHT / 2 + (world.y / UNITS_PER_TILE) * TILE_PIXELS - camera.y,
  };
}

export function actorFrame(
  clip: AnimationClip,
  tick: number,
  startedAtTick: number,
): number {
  const elapsed = Math.max(0, tick - startedAtTick);
  const duration = CLIP_DURATIONS[clip];
  const frameCount = CLIP_FRAMES[clip];
  if (["attack", "ability", "hurt", "death"].includes(clip))
    return Math.min(
      frameCount - 1,
      Math.floor((elapsed * frameCount) / duration),
    );
  return Math.floor(((elapsed % duration) * frameCount) / duration);
}

function intersectsViewport(bounds: DestinationRectV1): boolean {
  return (
    bounds.x + bounds.width >= 0 &&
    bounds.y + bounds.height >= 0 &&
    bounds.x <= VIEW_WIDTH &&
    bounds.y <= VIEW_HEIGHT
  );
}

function facingBucket(facing: Vec2): DrawCallV1["facingBucket"] {
  if (facing.x === 0 && facing.y === 0) return "none";
  if (Math.abs(facing.x) >= Math.abs(facing.y))
    return facing.x < 0 ? "west" : "east";
  return facing.y < 0 ? "north" : "south";
}

function spriteReference(
  spriteId: string,
  clip: string,
  frameIndex: number,
): SpriteReferenceV2 {
  const frame = spriteFrame(spriteId, clip, frameIndex);
  return {
    renderMode: "sprite",
    spriteId,
    assetId: frame.assetId,
    sourceRect: { ...frame.sourceRect },
    frameIdentity: frame.frameIdentity,
  };
}

function sceneReference(spriteId: string, variantIndex = 0): SpriteReferenceV2 {
  const sprite = SPRITE_CATALOG.sprites[spriteId];
  if (!sprite) throw new Error(`Scene sprite ${spriteId} is not registered`);
  const identities = Object.keys(sprite.frames);
  const frameIdentity = identities[variantIndex % identities.length]!;
  return {
    renderMode: "sprite",
    spriteId,
    assetId: sprite.assetId,
    sourceRect: { ...sprite.frames[frameIdentity]! },
    frameIdentity,
  };
}

function destinationAt(
  anchor: Vec2,
  width: number,
  height: number,
  sourceAnchor: Vec2 = { x: 128, y: 232 },
): DestinationRectV1 {
  return {
    x: Math.round(anchor.x - (sourceAnchor.x / 256) * width),
    y: Math.round(anchor.y - (sourceAnchor.y / 256) * height),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function buildSceneSprites(
  state: GameState,
  camera: CameraV1,
): SceneSpriteV2[] {
  const scene: SceneSpriteV2[] = [];
  const groundSize = Math.max(
    VIEW_WIDTH,
    VIEW_HEIGHT,
    state.map.width * TILE_PIXELS,
    state.map.height * TILE_PIXELS,
  );
  const groundWorldAnchor = {
    x: (state.map.width * UNITS_PER_TILE) / 2,
    y: (state.map.height * UNITS_PER_TILE) / 2,
  };
  const groundScreenAnchor = screenFor(groundWorldAnchor, camera);
  const groundDestination = destinationAt(
    groundScreenAnchor,
    groundSize,
    groundSize,
    { x: 128, y: 128 },
  );
  scene.push({
    ...sceneReference("scenery:ground"),
    objectId: "ground:continuous-ash-stone",
    kind: "prop",
    tile: { x: -1, y: -1 },
    worldAnchor: groundWorldAnchor,
    screenAnchor: groundScreenAnchor,
    destinationRect: groundDestination,
    layer: "terrain",
    zOrder: 0,
    visible: intersectsViewport(groundDestination),
    // This full-map image is only an underlay for sub-pixel gaps at canvas
    // edges. The visible ground is assembled from scale-matched atlas cells
    // below, so collision topology can never expose a differently scaled
    // square "debug patch".
    opacity: 0.22,
  });
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const wall = state.map.tiles[y * state.map.width + x] === 1;
      const worldAnchor = {
        x: x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
        y: y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
      };
      const screenAnchor = screenFor(worldAnchor, camera);
      const destinationRect = destinationAt(
        screenAnchor,
        TILE_PIXELS,
        TILE_PIXELS,
        { x: 128, y: 128 },
      );
      scene.push({
        // Every cell receives the same contiguous floor material at the same
        // scale. Blocked terrain is a second translucent material pass. This
        // removes the visible map-sized rectangle caused by mixing a stretched
        // background with cell-sized walkable-floor fragments.
        ...sceneReference("scenery:tile:floor", (y % 16) * 16 + (x % 16)),
        objectId: `tile:${x}:${y}`,
        kind: "tile",
        tile: { x, y },
        worldAnchor,
        screenAnchor,
        destinationRect,
        layer: "terrain",
        zOrder: scene.length,
        visible: intersectsViewport(destinationRect),
        opacity: 1,
      });
      if (!wall) continue;

      let cardinalFloor = 0;
      let diagonalFloor = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighborX = x + dx;
          const neighborY = y + dy;
          if (
            neighborX < 0 ||
            neighborY < 0 ||
            neighborX >= state.map.width ||
            neighborY >= state.map.height ||
            state.map.tiles[neighborY * state.map.width + neighborX] !== 0
          )
            continue;
          if (dx === 0 || dy === 0) cardinalFloor += 1;
          else diagonalFloor += 1;
        }
      }
      const wallOpacity =
        cardinalFloor > 0 ? 0.34 : diagonalFloor > 0 ? 0.48 : 0.62;
      scene.push({
        ...sceneReference("scenery:tile:wall", (y % 16) * 16 + (x % 16)),
        objectId: `wall-overlay:${x}:${y}`,
        kind: "tile",
        tile: { x, y },
        worldAnchor,
        screenAnchor,
        destinationRect,
        layer: "terrain",
        zOrder: scene.length,
        visible: intersectsViewport(destinationRect),
        opacity: wallOpacity,
      });
    }
  }

  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      if (state.map.tiles[y * state.map.width + x] === 0) continue;
      let cardinalFloor = 0;
      let diagonalFloor = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighborX = x + dx;
          const neighborY = y + dy;
          if (
            neighborX < 0 ||
            neighborY < 0 ||
            neighborX >= state.map.width ||
            neighborY >= state.map.height ||
            state.map.tiles[neighborY * state.map.width + neighborX] !== 0
          )
            continue;
          if (dx === 0 || dy === 0) cardinalFloor += 1;
          else diagonalFloor += 1;
        }
      }
      const opacity = cardinalFloor > 0 ? 0.24 : diagonalFloor > 0 ? 0.11 : 0;
      if (opacity === 0) continue;
      const worldAnchor = {
        x: x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
        y: y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
      };
      const screenAnchor = screenFor(worldAnchor, camera);
      const destinationRect = destinationAt(
        screenAnchor,
        TILE_PIXELS,
        TILE_PIXELS,
        { x: 128, y: 128 },
      );
      scene.push({
        ...sceneReference("scenery:edge:floor-blend", (y % 16) * 16 + (x % 16)),
        objectId: `edge-blend:${x}:${y}`,
        kind: "tile",
        tile: { x, y },
        worldAnchor,
        screenAnchor,
        destinationRect,
        layer: "terrain",
        zOrder: scene.length,
        visible: intersectsViewport(destinationRect),
        opacity,
      });
    }
  }

  // Thin raster masonry follows every blocked/walkable transition. Rotating
  // one authored strip produces a continuous room outline without stamping a
  // full facade onto every wall cell or obscuring the painted ground.
  const boundaryDirections = [
    { id: "north", dx: 0, dy: -1, ax: 0.5, ay: 0, rotation: 0 },
    { id: "east", dx: 1, dy: 0, ax: 1, ay: 0.5, rotation: Math.PI / 2 },
    { id: "south", dx: 0, dy: 1, ax: 0.5, ay: 1, rotation: 0 },
    { id: "west", dx: -1, dy: 0, ax: 0, ay: 0.5, rotation: Math.PI / 2 },
  ] as const;
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const wall = state.map.tiles[y * state.map.width + x] === 1;
      if (!wall) continue;
      for (const direction of boundaryDirections) {
        const neighborX = x + direction.dx;
        const neighborY = y + direction.dy;
        if (
          neighborX < 0 ||
          neighborY < 0 ||
          neighborX >= state.map.width ||
          neighborY >= state.map.height ||
          state.map.tiles[neighborY * state.map.width + neighborX] !== 0
        )
          continue;
        const worldAnchor = {
          x: (x + direction.ax) * UNITS_PER_TILE,
          y: (y + direction.ay) * UNITS_PER_TILE,
        };
        const screenAnchor = screenFor(worldAnchor, camera);
        const destinationRect = destinationAt(screenAnchor, 54, 12, {
          x: 128,
          y: 128,
        });
        scene.push({
          ...sceneReference(
            "scenery:boundary:stone",
            (direction.rotation ? y : x) % 4,
          ),
          objectId: `boundary:${direction.id}:${x}:${y}`,
          kind: "prop",
          tile: { x, y },
          worldAnchor,
          screenAnchor,
          destinationRect,
          layer: "terrain",
          zOrder: scene.length,
          visible: intersectsViewport(destinationRect),
          opacity: 0.13,
          rotation: direction.rotation,
        });
      }
    }
  }

  for (const placement of buildSceneryLayout(state.map)) {
    const spriteId = `scenery:${placement.kind}:${placement.name}`;
    const screenAnchor = screenFor(placement.worldAnchor, camera);
    const structureSize =
      placement.name === "ruined-house"
        ? 158
        : placement.name === "dead-tree"
          ? 172
          : placement.name === "well" || placement.name === "wagon"
            ? 154
            : placement.name === "obelisk" || placement.name === "rubble"
              ? 144
              : 196;
    const decalSize =
      placement.name === "blood-smear" ||
      placement.name === "occult-circle" ||
      placement.name === "claw-tracks"
        ? 108
        : placement.name === "scorch-ring" ||
            placement.name === "broken-boards" ||
            placement.name === "dead-bramble"
          ? 96
          : 78;
    const size =
      placement.kind === "structure"
        ? structureSize
        : placement.kind === "decal"
          ? decalSize
          : 82;
    const destinationRect = destinationAt(
      screenAnchor,
      size,
      size,
      placement.kind === "decal" ? { x: 128, y: 128 } : undefined,
    );
    scene.push({
      ...sceneReference(spriteId),
      objectId: placement.id,
      kind: "prop",
      tile: { ...placement.tile },
      worldAnchor: { ...placement.worldAnchor },
      screenAnchor,
      destinationRect,
      layer:
        placement.kind === "structure"
          ? "structures"
          : placement.kind === "decal"
            ? "terrain"
            : "props",
      zOrder: scene.length,
      visible: intersectsViewport(destinationRect),
      opacity: 1,
      collision: placement.collision
        ? {
            mode: "solid",
            shape: placement.collision.shape,
            worldCenter: { ...placement.collision.center },
            halfWidth: placement.collision.halfWidth,
            halfHeight: placement.collision.halfHeight,
          }
        : {
            mode: "passable",
            shape: "ellipse",
            worldCenter: { ...placement.worldAnchor },
            halfWidth: 0,
            halfHeight: 0,
          },
    });
  }

  const exitTile = state.map.exit;
  const exitWorld = {
    x: exitTile.x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
    y: exitTile.y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
  };
  const exitScreen = screenFor(exitWorld, camera);
  const exitSprite = state.exitUnlocked
    ? "scenery:exit:open"
    : "scenery:exit:locked";
  const exitDestination = destinationAt(exitScreen, 132, 132);
  scene.push({
    ...sceneReference(exitSprite),
    objectId: "exit:rift-gate",
    kind: "exit",
    tile: { ...exitTile },
    worldAnchor: exitWorld,
    screenAnchor: exitScreen,
    destinationRect: exitDestination,
    layer: "exit",
    zOrder: scene.length,
    visible: intersectsViewport(exitDestination),
    opacity: state.exitUnlocked ? 1 : 0.92,
  });
  return scene;
}

export function buildRenderManifest(
  state: GameState,
  camera: CameraV1,
  options: {
    interpolationAlpha?: number;
    cameraTarget?: CameraV1;
    cameraMode?: CameraMode;
  } = {},
): RenderManifestV1 {
  const interpolationAlpha = Math.max(
    0,
    Math.min(1, options.interpolationAlpha ?? 1),
  );
  const presentationTick = Math.max(0, state.tick - (1 - interpolationAlpha));
  const presented = (previous: Vec2, current: Vec2): Vec2 => ({
    x: previous.x + (current.x - previous.x) * interpolationAlpha,
    y: previous.y + (current.y - previous.y) * interpolationAlpha,
  });
  const calls: DrawCallV1[] = [];
  const add = (
    semantic: Omit<
      DrawCallV1,
      | keyof SpriteReferenceV2
      | "screenAnchor"
      | "destinationRect"
      | "bounds"
      | "footAnchor"
      | "visible"
      | "zOrder"
      | "facingBucket"
      | "flipX"
    >,
    width: number,
    height: number,
  ): void => {
    const bucket = facingBucket(semantic.facing);
    const screenAnchor = screenFor(semantic.worldAnchor, camera);
    const destinationRect = destinationAt(screenAnchor, width, height);
    const directionalSpriteId =
      (bucket === "north" || bucket === "south") &&
      (semantic.type === "player" || semantic.type === "monster")
        ? `${semantic.geometryId}:${bucket}`
        : semantic.geometryId;
    calls.push({
      ...semantic,
      ...spriteReference(
        directionalSpriteId,
        semantic.clip,
        semantic.frameIndex,
      ),
      screenAnchor,
      destinationRect,
      bounds: { ...destinationRect },
      footAnchor: { ...screenAnchor },
      facingBucket: bucket,
      flipX: bucket === "west",
      visible: intersectsViewport(destinationRect),
      zOrder: 0,
    });
  };

  const playerClip = state.player.animation.clip;
  const playerFrame = actorFrame(
    playerClip,
    presentationTick,
    state.player.animation.startedAtTick,
  );
  const playerSpritePixels = 118;
  add(
    {
      entityId: "player",
      type: "player",
      geometryId: `hero:${state.player.classId}`,
      clip: playerClip,
      frameIndex: playerFrame,
      frameCount: CLIP_FRAMES[playerClip],
      visualPhase: playerFrame / Math.max(1, CLIP_FRAMES[playerClip] - 1),
      clipDurationTicks: CLIP_DURATIONS[playerClip],
      clipStartedAtTick: state.player.animation.startedAtTick,
      clipLockedUntilTick: state.player.animation.lockedUntilTick,
      facing: state.player.facing,
      worldAnchor: presented(
        state.player.previousPosition,
        state.player.position,
      ),
      scale: playerSpritePixels / 256,
      tint: "#ffffff",
      opacity: 1,
      layer: "actors",
    },
    playerSpritePixels,
    playerSpritePixels,
  );

  for (const monster of state.monsters) {
    const clip = monster.animation.clip;
    const frame = actorFrame(
      clip,
      presentationTick,
      monster.animation.startedAtTick,
    );
    const dimensions = {
      ashfang: { width: 128, height: 108 },
      hexer: { width: 102, height: 112 },
      stonekin: { width: 128, height: 128 },
    }[monster.kind];
    const eliteScale = monster.elite ? 1.16 : 1;
    add(
      {
        entityId: monster.id,
        type: "monster",
        geometryId: `monster:${monster.kind}`,
        clip,
        frameIndex: frame,
        frameCount: CLIP_FRAMES[clip],
        visualPhase: frame / Math.max(1, CLIP_FRAMES[clip] - 1),
        clipDurationTicks: CLIP_DURATIONS[clip],
        clipStartedAtTick: monster.animation.startedAtTick,
        clipLockedUntilTick: monster.animation.lockedUntilTick,
        facing: monster.facing,
        worldAnchor: presented(monster.previousPosition, monster.position),
        scale: (dimensions.width / 256) * eliteScale,
        tint: "#ffffff",
        opacity: monster.health > 0 || monster.removeAtTick === null ? 1 : 0.8,
        layer: "actors",
      },
      dimensions.width * eliteScale,
      dimensions.height * eliteScale,
    );
  }

  for (const loot of state.loot) {
    const lootPhaseTick =
      (((presentationTick + loot.bobOffset) % 48) + 48) % 48;
    const frameIndex = Math.floor(lootPhaseTick / 12);
    add(
      {
        entityId: loot.id,
        type: "loot",
        geometryId: `loot:${loot.kind}:${loot.rarity}`,
        clip: "loot",
        frameIndex,
        frameCount: 4,
        visualPhase: lootPhaseTick / 48,
        clipDurationTicks: 48,
        clipStartedAtTick: -loot.bobOffset,
        clipLockedUntilTick: 0,
        facing: { x: 0, y: 0 },
        worldAnchor: loot.position,
        scale: loot.rarity === "relic" ? 0.25 : 0.21,
        tint: "#ffffff",
        opacity: 1,
        layer: "items",
      },
      loot.rarity === "relic" ? 64 : 54,
      loot.rarity === "relic" ? 64 : 54,
    );
  }

  for (const projectile of state.projectiles) {
    add(
      {
        entityId: projectile.id,
        type: "projectile",
        geometryId: projectile.hostile
          ? "projectile:hostile"
          : "projectile:friendly",
        clip: "projectile",
        frameIndex: 0,
        frameCount: 1,
        visualPhase: 0,
        clipDurationTicks: 1,
        clipStartedAtTick: projectile.spawnedAtTick,
        clipLockedUntilTick: projectile.expiresAtTick,
        facing: projectile.velocity,
        worldAnchor: presented(
          projectile.previousPosition,
          projectile.position,
        ),
        scale: 0.16,
        tint: "#ffffff",
        opacity: 1,
        layer: "projectiles",
      },
      42,
      42,
    );
  }

  for (const effect of state.effects) {
    const elapsed = presentationTick - effect.startedAtTick;
    const duration = Math.max(1, effect.expiresAtTick - effect.startedAtTick);
    add(
      {
        entityId: effect.id,
        type: "effect",
        geometryId: `effect:${effect.kind}`,
        clip: "static",
        frameIndex: 0,
        frameCount: 1,
        visualPhase: Math.max(0, Math.min(1, elapsed / duration)),
        clipDurationTicks: 1,
        clipStartedAtTick: effect.startedAtTick,
        clipLockedUntilTick: effect.expiresAtTick,
        facing: { x: 1, y: 0 },
        worldAnchor: effect.position,
        scale: 0.32,
        tint: effect.color,
        opacity: Math.max(0.12, 0.62 * (1 - elapsed / duration)),
        layer: "effects",
      },
      58 + (effect.radius / UNITS_PER_TILE) * 18,
      58 + (effect.radius / UNITS_PER_TILE) * 18,
    );
  }

  const layerRank = {
    items: 0,
    actors: 1,
    projectiles: 2,
    effects: 3,
  } as const;
  calls.sort(
    (a, b) =>
      layerRank[a.layer] - layerRank[b.layer] ||
      a.footAnchor.y - b.footAnchor.y ||
      a.entityId.localeCompare(b.entityId),
  );
  calls.forEach((call, index) => {
    call.zOrder = index;
  });
  return {
    schemaVersion: 2,
    spriteCatalogRevision: SPRITE_CATALOG_REVISION,
    tick: state.tick,
    simTick: state.tick,
    presentationTick,
    interpolationAlpha,
    viewport: { width: VIEW_WIDTH, height: VIEW_HEIGHT, dpr: 1 },
    camera: { ...camera },
    cameraTarget: { ...(options.cameraTarget ?? camera) },
    cameraMode: options.cameraMode ?? "snap",
    sceneSprites: buildSceneSprites(state, camera),
    drawCalls: calls,
    worldUi: [],
  };
}
