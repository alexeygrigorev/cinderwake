import { CLIP_DURATIONS, CLIP_FRAMES } from "../game/constants";
import type { AnimationClip } from "../game/types";
import actorAtlasSpecJson from "../../art/actor-atlas-v1.json" with { type: "json" };

export interface SourceRectV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteAssetV1 {
  id: string;
  url: string;
  mimeType: "image/png";
  pixelWidth: number;
  pixelHeight: number;
  revision: string;
}

export interface SpriteClipV1 {
  frameIdentities: string[];
  durationTicks: number;
  looping: boolean;
}

export interface SpriteDefinitionV1 {
  id: string;
  assetId: string;
  frames: Record<string, SourceRectV1>;
  clips: Record<string, SpriteClipV1>;
}

export interface SpriteCatalogV1 {
  schemaVersion: 1;
  revision: string;
  assets: Record<string, SpriteAssetV1>;
  sprites: Record<string, SpriteDefinitionV1>;
}

type AuthoredFacing = "north" | "south";
type DirectionalClipKey = `${AuthoredFacing}${Capitalize<AnimationClip>}`;

interface ActorAtlasSpec {
  id: string;
  atlas: {
    pixelWidth: number;
    pixelHeight: number;
    cellWidth: number;
    cellHeight: number;
  };
  clips: Record<AnimationClip, { atlasRow: number }>;
  directionalClips: Record<DirectionalClipKey, { atlasRow: number }>;
}

const ACTOR_ATLAS_SPEC = actorAtlasSpecJson as ActorAtlasSpec;
export const SPRITE_CATALOG_REVISION = "cinder-node-v1-2026-08-24";
const ACTOR_CELL = ACTOR_ATLAS_SPEC.atlas.cellWidth;
const GRID_CELL = 256;

function asset(
  id: string,
  fileName: string,
  pixelWidth: number,
  pixelHeight: number,
): SpriteAssetV1 {
  return {
    id,
    url: `/assets/sprites/${fileName}`,
    mimeType: "image/png",
    pixelWidth,
    pixelHeight,
    revision: SPRITE_CATALOG_REVISION,
  };
}

const assets: Record<string, SpriteAssetV1> = {
  "atlas:actor:vanguard": asset(
    "atlas:actor:vanguard",
    "actor-vanguard.png",
    ACTOR_ATLAS_SPEC.atlas.pixelWidth,
    ACTOR_ATLAS_SPEC.atlas.pixelHeight,
  ),
  "atlas:actor:ranger": asset(
    "atlas:actor:ranger",
    "actor-ranger.png",
    ACTOR_ATLAS_SPEC.atlas.pixelWidth,
    ACTOR_ATLAS_SPEC.atlas.pixelHeight,
  ),
  "atlas:actor:arcanist": asset(
    "atlas:actor:arcanist",
    "actor-arcanist.png",
    ACTOR_ATLAS_SPEC.atlas.pixelWidth,
    ACTOR_ATLAS_SPEC.atlas.pixelHeight,
  ),
  "atlas:actor:ashfang": asset(
    "atlas:actor:ashfang",
    "actor-ashfang.png",
    ACTOR_ATLAS_SPEC.atlas.pixelWidth,
    ACTOR_ATLAS_SPEC.atlas.pixelHeight,
  ),
  "atlas:actor:hexer": asset(
    "atlas:actor:hexer",
    "actor-hexer.png",
    ACTOR_ATLAS_SPEC.atlas.pixelWidth,
    ACTOR_ATLAS_SPEC.atlas.pixelHeight,
  ),
  "atlas:actor:stonekin": asset(
    "atlas:actor:stonekin",
    "actor-stonekin.png",
    ACTOR_ATLAS_SPEC.atlas.pixelWidth,
    ACTOR_ATLAS_SPEC.atlas.pixelHeight,
  ),
  "atlas:terrain": asset(
    "atlas:terrain",
    "environment-terrain.png",
    1024,
    1024,
  ),
  "atlas:ground": asset("atlas:ground", "environment-ground.png", 1024, 1024),
  "atlas:floor": asset("atlas:floor", "environment-floor.png", 1024, 1024),
  "atlas:structures": asset(
    "atlas:structures",
    "environment-structures.png",
    1024,
    1024,
  ),
  "atlas:props": asset("atlas:props", "environment-props.png", 1024, 1024),
  "atlas:decals": asset("atlas:decals", "environment-decals.png", 1024, 1024),
  "atlas:effects": asset("atlas:effects", "effects.png", 1024, 1024),
  "atlas:loot": asset("atlas:loot", "loot.png", 2048, 2048),
  "atlas:ui": asset("atlas:ui", "ui.png", 1024, 1024),
  "atlas:glyphs": asset("atlas:glyphs", "glyphs.png", 1024, 512),
};

const ACTOR_CLIPS = [
  "idle",
  "walk",
  "attack",
  "ability",
  "hurt",
  "death",
] as const satisfies readonly AnimationClip[];

function actorSprite(
  id: string,
  assetId: string,
  facing?: "north" | "south",
): SpriteDefinitionV1 {
  const frames: Record<string, SourceRectV1> = {};
  const clips: Record<string, SpriteClipV1> = {};
  ACTOR_CLIPS.forEach((clip) => {
    const directionalKey = facing
      ? (`${facing}${clip[0]!.toUpperCase()}${clip.slice(1)}` as DirectionalClipKey)
      : undefined;
    const row = directionalKey
      ? ACTOR_ATLAS_SPEC.directionalClips[directionalKey].atlasRow
      : ACTOR_ATLAS_SPEC.clips[clip].atlasRow;
    const frameIdentities = Array.from(
      { length: CLIP_FRAMES[clip] },
      (_, frameIndex) => `${id}:${clip}:${frameIndex}`,
    );
    frameIdentities.forEach((frameIdentity, frameIndex) => {
      frames[frameIdentity] = {
        x: frameIndex * ACTOR_CELL,
        y: row * ACTOR_CELL,
        width: ACTOR_CELL,
        height: ACTOR_CELL,
      };
    });
    clips[clip] = {
      frameIdentities,
      durationTicks: CLIP_DURATIONS[clip],
      looping: clip === "idle" || clip === "walk",
    };
  });
  return { id, assetId, frames, clips };
}

function textureSprite(
  id: string,
  assetId: string,
  cellsPerAxis = 16,
): SpriteDefinitionV1 {
  const cellSize = 1024 / cellsPerAxis;
  const frameIdentities = Array.from(
    { length: cellsPerAxis * cellsPerAxis },
    (_, index) => `${id}:variant:${index}`,
  );
  return {
    id,
    assetId,
    frames: Object.fromEntries(
      frameIdentities.map((identity, index) => [
        identity,
        {
          x: (index % cellsPerAxis) * cellSize,
          y: Math.floor(index / cellsPerAxis) * cellSize,
          width: cellSize,
          height: cellSize,
        },
      ]),
    ),
    clips: {
      static: {
        frameIdentities: [frameIdentities[0]!],
        durationTicks: 1,
        looping: true,
      },
    },
  };
}

function singleFrameSprite(
  id: string,
  assetId: string,
  column: number,
  row: number,
  clipName: "projectile" | "static" = "static",
): SpriteDefinitionV1 {
  const frameIdentity = `${id}:${clipName}:0`;
  return {
    id,
    assetId,
    frames: {
      [frameIdentity]: {
        x: column * GRID_CELL,
        y: row * GRID_CELL,
        width: GRID_CELL,
        height: GRID_CELL,
      },
    },
    clips: {
      [clipName]: {
        frameIdentities: [frameIdentity],
        durationTicks: 1,
        looping: true,
      },
    },
  };
}

function fullFrameSprite(
  id: string,
  assetId: string,
  width: number,
  height: number,
): SpriteDefinitionV1 {
  const frameIdentity = `${id}:static:0`;
  return {
    id,
    assetId,
    frames: {
      [frameIdentity]: { x: 0, y: 0, width, height },
    },
    clips: {
      static: {
        frameIdentities: [frameIdentity],
        durationTicks: 1,
        looping: true,
      },
    },
  };
}

const sprites: Record<string, SpriteDefinitionV1> = {};
function register(definition: SpriteDefinitionV1): void {
  sprites[definition.id] = definition;
}

register(actorSprite("hero:vanguard", "atlas:actor:vanguard"));
register(actorSprite("hero:ranger", "atlas:actor:ranger"));
register(actorSprite("hero:arcanist", "atlas:actor:arcanist"));
register(actorSprite("monster:ashfang", "atlas:actor:ashfang"));
register(actorSprite("monster:hexer", "atlas:actor:hexer"));
register(actorSprite("monster:stonekin", "atlas:actor:stonekin"));
for (const [id, assetId] of [
  ["hero:vanguard", "atlas:actor:vanguard"],
  ["hero:ranger", "atlas:actor:ranger"],
  ["hero:arcanist", "atlas:actor:arcanist"],
  ["monster:ashfang", "atlas:actor:ashfang"],
  ["monster:hexer", "atlas:actor:hexer"],
  ["monster:stonekin", "atlas:actor:stonekin"],
] as const)
  for (const facing of ["north", "south"] as const)
    register(actorSprite(`${id}:${facing}`, assetId, facing));

const lootIds = [
  "loot:gold:common",
  "loot:gold:tempered",
  "loot:gold:relic",
  "loot:tonic:common",
  "loot:tonic:tempered",
  "loot:tonic:relic",
  "loot:weapon:common",
  "loot:weapon:tempered",
  "loot:weapon:relic",
];
lootIds.forEach((id, itemIndex) => {
  const frameIdentities = Array.from(
    { length: 4 },
    (_, frameIndex) => `${id}:loot:${frameIndex}`,
  );
  const frames = Object.fromEntries(
    frameIdentities.map((frameIdentity, frameIndex) => {
      const cell = itemIndex * 4 + frameIndex;
      return [
        frameIdentity,
        {
          x: (cell % 8) * GRID_CELL,
          y: Math.floor(cell / 8) * GRID_CELL,
          width: GRID_CELL,
          height: GRID_CELL,
        },
      ];
    }),
  );
  register({
    id,
    assetId: "atlas:loot",
    frames,
    clips: {
      loot: {
        frameIdentities,
        durationTicks: 48,
        looping: true,
      },
    },
  });
});

register(
  singleFrameSprite("projectile:friendly", "atlas:effects", 0, 0, "projectile"),
);
register(
  singleFrameSprite("projectile:hostile", "atlas:effects", 2, 0, "projectile"),
);
register(textureSprite("scenery:tile:floor", "atlas:floor"));
register(textureSprite("scenery:tile:wall", "atlas:ground"));
register(textureSprite("scenery:edge:floor-blend", "atlas:floor"));
const stoneBoundaryFrames = Object.fromEntries(
  Array.from({ length: 4 }, (_, index) => [
    `scenery:boundary:stone:variant:${index}`,
    { x: index * GRID_CELL, y: GRID_CELL * 2, width: GRID_CELL, height: 64 },
  ]),
);
register({
  id: "scenery:boundary:stone",
  assetId: "atlas:terrain",
  frames: stoneBoundaryFrames,
  clips: {
    static: {
      frameIdentities: ["scenery:boundary:stone:variant:0"],
      durationTicks: 1,
      looping: true,
    },
  },
});
const wallFrontFrames = Object.fromEntries(
  Array.from({ length: 4 }, (_, index) => [
    `scenery:boundary:wall-front:variant:${index}`,
    {
      x: index * GRID_CELL,
      y: GRID_CELL * 2,
      width: GRID_CELL,
      height: GRID_CELL,
    },
  ]),
);
register({
  id: "scenery:boundary:wall-front",
  assetId: "atlas:terrain",
  frames: wallFrontFrames,
  clips: {
    static: {
      frameIdentities: ["scenery:boundary:wall-front:variant:0"],
      durationTicks: 1,
      looping: true,
    },
  },
});
register(singleFrameSprite("scenery:exit:locked", "atlas:structures", 3, 1));
register(singleFrameSprite("scenery:exit:open", "atlas:structures", 3, 3));
register(singleFrameSprite("scenery:backdrop", "atlas:terrain", 0, 3));
register(fullFrameSprite("scenery:ground", "atlas:ground", 1024, 1024));

const structureNames = [
  "gatehouse",
  "chapel",
  "watchtower",
  "forge",
  "ruined-house",
  "mausoleum",
  "bridge",
  "ritual-door",
  "dead-tree",
  "well",
  "wagon",
  "gallows",
  "obelisk",
  "rubble",
  "witchlight-monument",
  "rift-portal",
];
structureNames.forEach((name, index) =>
  register(
    singleFrameSprite(
      `scenery:structure:${name}`,
      "atlas:structures",
      index % 4,
      Math.floor(index / 4),
    ),
  ),
);

const propNames = [
  "ember-brazier",
  "witchlight-lantern",
  "sarcophagus",
  "grave-markers",
  "merchant-crates",
  "weapon-rack",
  "barrels",
  "saint-statue",
  "thorn-pillar",
  "chain-cage",
  "ritual-totem",
  "barricade",
  "relic-chest",
  "open-chest",
  "gold-cache",
  "tonic-bottle",
];
propNames.forEach((name, index) =>
  register(
    singleFrameSprite(
      `scenery:prop:${name}`,
      "atlas:props",
      index % 4,
      Math.floor(index / 4),
    ),
  ),
);

const decalNames = [
  "scorch-ring",
  "blood-smear",
  "bone-pile",
  "occult-circle",
  "chain-coil",
  "broken-boards",
  "grave-rubble",
  "burnt-roots",
  "melted-candles",
  "dead-bramble",
  "discarded-armor",
  "cracked-embers",
  "banner-scrap",
  "saint-fragments",
  "claw-tracks",
  "grave-flowers",
] as const;
decalNames.forEach((name, index) =>
  register(
    singleFrameSprite(
      `scenery:decal:${name}`,
      "atlas:decals",
      index % 4,
      Math.floor(index / 4),
    ),
  ),
);

register(singleFrameSprite("effect:slash", "atlas:effects", 3, 0));
register(singleFrameSprite("effect:nova", "atlas:effects", 1, 2));
register(singleFrameSprite("effect:impact", "atlas:effects", 3, 1));
register(singleFrameSprite("effect:death", "atlas:effects", 2, 2));
register(singleFrameSprite("world-ui:shadow", "atlas:ui", 3, 1));
register(singleFrameSprite("world-ui:health-frame", "atlas:ui", 2, 0));
register(singleFrameSprite("world-ui:health-fill", "atlas:ui", 1, 0));

export const SPRITE_CATALOG: SpriteCatalogV1 = {
  schemaVersion: 1,
  revision: SPRITE_CATALOG_REVISION,
  assets,
  sprites,
};

const loadedImages = new Map<string, HTMLImageElement>();
let loadPromise: Promise<void> | undefined;
type SpriteLoadProgress = (loaded: number, total: number) => void;

export function resolveSpriteAssetUrl(url: string): string {
  const environment = (
    import.meta as ImportMeta & {
      env?: { BASE_URL?: string };
    }
  ).env;
  const base = environment?.BASE_URL ?? "/";
  if (base === "/") return url;
  return `${base.replace(/\/$/, "")}${url}`;
}

export function preloadSpriteAssets(
  onProgress: SpriteLoadProgress = () => undefined,
  timeoutMs = 15_000,
): Promise<void> {
  const definitions = Object.values(SPRITE_CATALOG.assets);
  onProgress(loadedImages.size, definitions.length);
  if (loadPromise) return loadPromise;
  if (typeof Image === "undefined")
    return Promise.reject(
      new Error("Sprite assets require a browser Image API"),
    );
  loadPromise = Promise.all(
    definitions.map(
      (definition) =>
        new Promise<void>((resolve, reject) => {
          if (loadedImages.has(definition.id)) {
            resolve();
            return;
          }
          const image = new Image();
          let settled = false;
          const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            callback();
          };
          const timeout = setTimeout(
            () =>
              finish(() =>
                reject(
                  new Error(`Timed out loading sprite atlas ${definition.id}`),
                ),
              ),
            timeoutMs,
          );
          image.onload = () => {
            if (
              image.naturalWidth !== definition.pixelWidth ||
              image.naturalHeight !== definition.pixelHeight
            ) {
              finish(() =>
                reject(
                  new Error(
                    `Sprite atlas ${definition.id} decoded at ${image.naturalWidth}x${image.naturalHeight}`,
                  ),
                ),
              );
              return;
            }
            finish(() => {
              loadedImages.set(definition.id, image);
              onProgress(loadedImages.size, definitions.length);
              resolve();
            });
          };
          image.onerror = () =>
            finish(() =>
              reject(new Error(`Unable to load sprite atlas ${definition.id}`)),
            );
          image.src = resolveSpriteAssetUrl(definition.url);
        }),
    ),
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      loadPromise = undefined;
      throw error;
    });
  return loadPromise;
}

export function spriteImage(assetId: string): HTMLImageElement {
  const image = loadedImages.get(assetId);
  if (!image) throw new Error(`Sprite atlas ${assetId} has not been decoded`);
  return image;
}

export function spriteFrame(
  spriteId: string,
  clip: string,
  frameIndex: number,
): {
  definition: SpriteDefinitionV1;
  assetId: string;
  frameIdentity: string;
  sourceRect: SourceRectV1;
} {
  const definition = SPRITE_CATALOG.sprites[spriteId];
  if (!definition) throw new Error(`Unknown sprite ${spriteId}`);
  const animation = definition.clips[clip];
  if (!animation) throw new Error(`Sprite ${spriteId} has no clip ${clip}`);
  const frameIdentity = animation.frameIdentities[frameIndex];
  if (!frameIdentity)
    throw new Error(
      `Sprite ${spriteId} clip ${clip} has no frame ${frameIndex}`,
    );
  return {
    definition,
    assetId: definition.assetId,
    frameIdentity,
    sourceRect: definition.frames[frameIdentity]!,
  };
}
