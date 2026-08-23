import {
  CLIP_DURATIONS,
  CLIP_FRAMES,
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../game/constants";
import type { AnimationClip, GameState, Vec2 } from "../game/types";

export interface CameraV1 {
  x: number;
  y: number;
  zoom: number;
}

export type CameraMode = "snap" | "smooth" | "fixed";

export interface DrawCallV1 {
  entityId: string;
  type: "player" | "monster" | "loot" | "projectile";
  geometryId: string;
  clip: AnimationClip | "loot" | "projectile";
  frameIndex: number;
  facing: Vec2;
  worldAnchor: Vec2;
  screenAnchor: Vec2;
  bounds: { x: number; y: number; width: number; height: number };
  footAnchor: Vec2;
  scale: number;
  tint: string;
  layer: "actors" | "items" | "projectiles";
  zOrder: number;
  visible: boolean;
}

export interface RenderManifestV1 {
  schemaVersion: 1;
  tick: number;
  simTick: number;
  presentationTick: number;
  interpolationAlpha: number;
  viewport: { width: number; height: number; dpr: 1 };
  camera: CameraV1;
  cameraTarget: CameraV1;
  cameraMode: CameraMode;
  drawCalls: DrawCallV1[];
}

export function screenFor(world: Vec2, camera: CameraV1): Vec2 {
  return {
    x: Math.round(
      VIEW_WIDTH / 2 + (world.x / UNITS_PER_TILE) * TILE_PIXELS - camera.x,
    ),
    y: Math.round(
      VIEW_HEIGHT / 2 + (world.y / UNITS_PER_TILE) * TILE_PIXELS - camera.y,
    ),
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

function intersectsViewport(bounds: DrawCallV1["bounds"]): boolean {
  return (
    bounds.x + bounds.width >= 0 &&
    bounds.y + bounds.height >= 0 &&
    bounds.x <= VIEW_WIDTH &&
    bounds.y <= VIEW_HEIGHT
  );
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
    x: Math.round(previous.x + (current.x - previous.x) * interpolationAlpha),
    y: Math.round(previous.y + (current.y - previous.y) * interpolationAlpha),
  });
  const calls: DrawCallV1[] = [];
  const add = (
    call: Omit<
      DrawCallV1,
      "screenAnchor" | "bounds" | "footAnchor" | "visible" | "zOrder"
    >,
    width: number,
    height: number,
  ): void => {
    const screenAnchor = screenFor(call.worldAnchor, camera);
    const scaledWidth = width * call.scale;
    const scaledHeight = height * call.scale;
    const bounds = {
      x: Math.round(screenAnchor.x - scaledWidth / 2),
      y: Math.round(screenAnchor.y - scaledHeight),
      width: Math.round(scaledWidth),
      height: Math.round(scaledHeight + 6),
    };
    calls.push({
      ...call,
      screenAnchor,
      bounds,
      footAnchor: { ...screenAnchor },
      visible: intersectsViewport(bounds),
      zOrder: 0,
    });
  };

  const playerTint = {
    vanguard: "#e49b51",
    ranger: "#9fcb74",
    arcanist: "#63d6cb",
  }[state.player.classId];
  add(
    {
      entityId: "player",
      type: "player",
      geometryId: `hero:${state.player.classId}`,
      clip: state.player.animation.clip,
      frameIndex: actorFrame(
        state.player.animation.clip,
        presentationTick,
        state.player.animation.startedAtTick,
      ),
      facing: state.player.facing,
      worldAnchor: presented(
        state.player.previousPosition,
        state.player.position,
      ),
      scale: 1,
      tint: playerTint,
      layer: "actors",
    },
    70,
    68,
  );

  const monsterTints = {
    ashfang: "#d86555",
    hexer: "#b86fda",
    stonekin: "#aa7860",
  } as const;
  for (const monster of state.monsters) {
    const scale =
      (monster.elite ? 1.2 : 1) * (monster.kind === "stonekin" ? 1.12 : 1);
    add(
      {
        entityId: monster.id,
        type: "monster",
        geometryId: `monster:${monster.kind}`,
        clip: monster.animation.clip,
        frameIndex: actorFrame(
          monster.animation.clip,
          presentationTick,
          monster.animation.startedAtTick,
        ),
        facing: monster.facing,
        worldAnchor: presented(monster.previousPosition, monster.position),
        scale,
        tint: monsterTints[monster.kind],
        layer: "actors",
      },
      monster.kind === "stonekin" ? 74 : 62,
      monster.kind === "stonekin" ? 72 : 58,
    );
  }

  for (const loot of state.loot) {
    const tint =
      loot.kind === "gold"
        ? "#f1be54"
        : loot.kind === "tonic"
          ? "#e65d76"
          : "#8cdded";
    add(
      {
        entityId: loot.id,
        type: "loot",
        geometryId: `loot:${loot.kind}:${loot.rarity}`,
        clip: "loot",
        frameIndex: Math.floor((presentationTick + loot.bobOffset) / 12) % 4,
        facing: { x: 0, y: 0 },
        worldAnchor: loot.position,
        scale:
          loot.rarity === "relic" ? 1.2 : loot.rarity === "tempered" ? 1.1 : 1,
        tint,
        layer: "items",
      },
      28,
      28,
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
        frameIndex: Math.floor(presentationTick) % 4,
        facing: projectile.velocity,
        worldAnchor: presented(
          projectile.previousPosition,
          projectile.position,
        ),
        scale: 1,
        tint: projectile.color,
        layer: "projectiles",
      },
      20,
      20,
    );
  }

  const layerRank = { items: 0, actors: 1, projectiles: 2 } as const;
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
    schemaVersion: 1,
    tick: state.tick,
    simTick: state.tick,
    presentationTick,
    interpolationAlpha,
    viewport: { width: VIEW_WIDTH, height: VIEW_HEIGHT, dpr: 1 },
    camera: { ...camera },
    cameraTarget: { ...(options.cameraTarget ?? camera) },
    cameraMode: options.cameraMode ?? "snap",
    drawCalls: calls,
  };
}
