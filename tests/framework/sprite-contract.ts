import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildSceneryLayout } from "../../src/game/sceneryLayout";
import type { GameState } from "../../src/game/types";

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
  logicalSize?: { width: number; height: number };
  anchor?: { x: number; y: number };
}

export interface SpriteCatalogV1 {
  schemaVersion: 1;
  revision: string;
  assets: Record<string, SpriteAssetV1>;
  sprites: Record<string, SpriteDefinitionV1>;
}

export interface ManifestSpriteReferenceV2 {
  renderMode: "sprite";
  spriteId: string;
  assetId: string;
  sourceRect: SourceRectV1;
  frameIdentity: string;
}

export interface ManifestDrawCallV2 extends ManifestSpriteReferenceV2 {
  entityId: string;
  type: "player" | "monster" | "loot" | "projectile";
  geometryId: string;
  clip: string;
  frameIndex: number;
  frameCount: number;
  clipDurationTicks: number;
  destinationRect: { x: number; y: number; width: number; height: number };
  scale: number;
  opacity: number;
}

export interface ManifestSceneSpriteV2 extends ManifestSpriteReferenceV2 {
  objectId: string;
  kind: "tile" | "exit" | "prop";
  tile: { x: number; y: number };
  worldAnchor: { x: number; y: number };
  destinationRect: { x: number; y: number; width: number; height: number };
  opacity: number;
  zOrder: number;
  collision?: {
    mode: "solid" | "passable";
    shape: "ellipse";
    worldCenter: { x: number; y: number };
    halfWidth: number;
    halfHeight: number;
  } | null;
}

export interface RenderManifestV2Shape {
  schemaVersion: 2;
  spriteCatalogRevision: string;
  drawCalls: ManifestDrawCallV2[];
  sceneSprites: ManifestSceneSpriteV2[];
}

const ACTOR_CLIPS = ["idle", "walk", "attack", "ability", "hurt", "death"];
const ACTOR_SPRITES = [
  "hero:vanguard",
  "hero:ranger",
  "hero:arcanist",
  "monster:ashfang",
  "monster:hexer",
  "monster:stonekin",
];
const LOOT_SPRITES = ["gold", "tonic", "weapon"].flatMap((kind) =>
  ["common", "tempered", "relic"].map((rarity) => `loot:${kind}:${rarity}`),
);
export const ENVIRONMENT_KIT_SPRITE_GEOMETRY = {
  "scenery:architecture:north-wall-solid": { width: 187, height: 172 },
  "scenery:structure:forge-workshop": { width: 220, height: 195 },
  "scenery:prop:lantern-a": { width: 53, height: 118 },
  "scenery:prop:lantern-b": { width: 53, height: 118 },
  "scenery:prop:barricade-v2": { width: 107, height: 88 },
  "scenery:prop:raised-clutter-bench": { width: 124, height: 103 },
} as const;

export const REQUIRED_SPRITE_CLIPS: Record<string, readonly string[]> = {
  ...Object.fromEntries(
    ACTOR_SPRITES.flatMap((id) => [
      [id, ACTOR_CLIPS],
      [`${id}:north`, ACTOR_CLIPS],
      [`${id}:south`, ACTOR_CLIPS],
    ]),
  ),
  ...Object.fromEntries(LOOT_SPRITES.map((id) => [id, ["loot"]])),
  "projectile:friendly": ["projectile"],
  "projectile:hostile": ["projectile"],
  "scenery:tile:floor": ["static"],
  "scenery:tile:wall": ["static"],
  "scenery:edge:floor-blend": ["static"],
  "scenery:boundary:stone": ["static"],
  "scenery:boundary:wall-front": ["static"],
  "scenery:exit:locked": ["static"],
  "scenery:exit:open": ["static"],
  ...Object.fromEntries(
    Object.keys(ENVIRONMENT_KIT_SPRITE_GEOMETRY).map((id) => [id, ["static"]]),
  ),
};

export const EXPECTED_CLIP_CADENCE: Record<
  string,
  { frameCount: number; durationTicks: number; looping: boolean }
> = {
  idle: { frameCount: 6, durationTicks: 60, looping: true },
  walk: { frameCount: 8, durationTicks: 40, looping: true },
  attack: { frameCount: 6, durationTicks: 26, looping: false },
  ability: { frameCount: 8, durationTicks: 36, looping: false },
  hurt: { frameCount: 4, durationTicks: 12, looping: false },
  death: { frameCount: 8, durationTicks: 48, looping: false },
  loot: { frameCount: 4, durationTicks: 48, looping: true },
  projectile: { frameCount: 1, durationTicks: 1, looping: true },
  static: { frameCount: 1, durationTicks: 1, looping: true },
};

function fail(message: string): never {
  throw new Error(`Sprite contract: ${message}`);
}

function object(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${pathName} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(`${pathName} must be a non-empty string`);
  return value;
}

function integer(value: unknown, pathName: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    fail(`${pathName} must be a safe integer >= ${minimum}`);
  return value as number;
}

function boolean(value: unknown, pathName: string): boolean {
  if (typeof value !== "boolean") fail(`${pathName} must be boolean`);
  return value;
}

function finiteNumber(value: unknown, pathName: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    fail(`${pathName} must be a finite number >= ${minimum}`);
  return value;
}

function sourceRect(value: unknown, pathName: string): SourceRectV1 {
  const rect = object(value, pathName);
  return {
    x: integer(rect.x, `${pathName}.x`),
    y: integer(rect.y, `${pathName}.y`),
    width: integer(rect.width, `${pathName}.width`, 1),
    height: integer(rect.height, `${pathName}.height`, 1),
  };
}

function sameRect(first: SourceRectV1, second: SourceRectV1): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

export function validateSpriteCatalog(input: unknown): SpriteCatalogV1 {
  const root = object(input, "catalog");
  if (root.schemaVersion !== 1) fail("catalog.schemaVersion must be 1");
  const revision = nonEmptyString(root.revision, "catalog.revision");
  const assetsInput = object(root.assets, "catalog.assets");
  const spritesInput = object(root.sprites, "catalog.sprites");
  const assets: SpriteCatalogV1["assets"] = {};
  const sprites: SpriteCatalogV1["sprites"] = {};

  for (const [key, assetValue] of Object.entries(assetsInput)) {
    const item = object(assetValue, `catalog.assets.${key}`);
    const id = nonEmptyString(item.id, `catalog.assets.${key}.id`);
    if (id !== key) fail(`catalog asset key ${key} does not match id ${id}`);
    const url = nonEmptyString(item.url, `catalog.assets.${key}.url`);
    if (!url.startsWith("/assets/"))
      fail(`catalog.assets.${key}.url must be a local /assets/ URL`);
    if (item.mimeType !== "image/png")
      fail(`catalog.assets.${key}.mimeType must be image/png`);
    assets[key] = {
      id,
      url,
      mimeType: "image/png",
      pixelWidth: integer(
        item.pixelWidth,
        `catalog.assets.${key}.pixelWidth`,
        1,
      ),
      pixelHeight: integer(
        item.pixelHeight,
        `catalog.assets.${key}.pixelHeight`,
        1,
      ),
      revision: nonEmptyString(item.revision, `catalog.assets.${key}.revision`),
    };
  }
  if (Object.keys(assets).length === 0)
    fail("catalog.assets must not be empty");

  for (const [key, spriteValue] of Object.entries(spritesInput)) {
    const item = object(spriteValue, `catalog.sprites.${key}`);
    const id = nonEmptyString(item.id, `catalog.sprites.${key}.id`);
    if (id !== key) fail(`catalog sprite key ${key} does not match id ${id}`);
    const assetId = nonEmptyString(
      item.assetId,
      `catalog.sprites.${key}.assetId`,
    );
    const asset = assets[assetId];
    if (!asset)
      fail(`catalog.sprites.${key} references unknown asset ${assetId}`);
    const framesInput = object(item.frames, `catalog.sprites.${key}.frames`);
    const clipsInput = object(item.clips, `catalog.sprites.${key}.clips`);
    const frames: SpriteDefinitionV1["frames"] = {};
    const clips: SpriteDefinitionV1["clips"] = {};
    let logicalSize: SpriteDefinitionV1["logicalSize"];
    let anchor: SpriteDefinitionV1["anchor"];
    if (item.logicalSize !== undefined || item.anchor !== undefined) {
      const logicalSizeInput = object(
        item.logicalSize,
        `catalog.sprites.${key}.logicalSize`,
      );
      const anchorInput = object(item.anchor, `catalog.sprites.${key}.anchor`);
      logicalSize = {
        width: integer(
          logicalSizeInput.width,
          `catalog.sprites.${key}.logicalSize.width`,
          1,
        ),
        height: integer(
          logicalSizeInput.height,
          `catalog.sprites.${key}.logicalSize.height`,
          1,
        ),
      };
      anchor = {
        x: finiteNumber(anchorInput.x, `catalog.sprites.${key}.anchor.x`),
        y: finiteNumber(anchorInput.y, `catalog.sprites.${key}.anchor.y`),
      };
      if (anchor.x > logicalSize.width || anchor.y > logicalSize.height)
        fail(`catalog.sprites.${key}.anchor exceeds its logical dimensions`);
    }
    for (const [frameIdentity, rectValue] of Object.entries(framesInput)) {
      const rect = sourceRect(
        rectValue,
        `catalog.sprites.${key}.frames.${frameIdentity}`,
      );
      if (
        rect.x + rect.width > asset.pixelWidth ||
        rect.y + rect.height > asset.pixelHeight
      ) {
        fail(`sprite ${key} frame ${frameIdentity} exceeds atlas ${assetId}`);
      }
      frames[frameIdentity] = rect;
    }
    if (Object.keys(frames).length === 0)
      fail(`catalog.sprites.${key}.frames must not be empty`);
    for (const [clipName, clipValue] of Object.entries(clipsInput)) {
      const clip = object(
        clipValue,
        `catalog.sprites.${key}.clips.${clipName}`,
      );
      if (
        !Array.isArray(clip.frameIdentities) ||
        clip.frameIdentities.length === 0
      )
        fail(`sprite ${key} clip ${clipName} needs frameIdentities`);
      const frameIdentities = clip.frameIdentities.map((frame, index) => {
        const frameIdentity = nonEmptyString(
          frame,
          `catalog.sprites.${key}.clips.${clipName}.frameIdentities[${index}]`,
        );
        if (!frames[frameIdentity])
          fail(`sprite ${key} clip ${clipName} references ${frameIdentity}`);
        return frameIdentity;
      });
      if (new Set(frameIdentities).size !== frameIdentities.length)
        fail(`sprite ${key} clip ${clipName} repeats a frame identity`);
      const distinctRects = new Set(
        frameIdentities.map((frameIdentity) =>
          JSON.stringify(frames[frameIdentity]),
        ),
      );
      if (
        frameIdentities.length > 1 &&
        distinctRects.size !== frameIdentities.length
      )
        fail(`sprite ${key} clip ${clipName} reuses an atlas source rectangle`);
      clips[clipName] = {
        frameIdentities,
        durationTicks: integer(
          clip.durationTicks,
          `catalog.sprites.${key}.clips.${clipName}.durationTicks`,
          1,
        ),
        looping: boolean(
          clip.looping,
          `catalog.sprites.${key}.clips.${clipName}.looping`,
        ),
      };
    }
    sprites[key] = {
      id,
      assetId,
      frames,
      clips,
      ...(logicalSize && anchor ? { logicalSize, anchor } : {}),
    };
  }

  const catalog = { schemaVersion: 1 as const, revision, assets, sprites };
  assertRequiredSpriteRegistrations(catalog);
  return catalog;
}

export function assertRequiredSpriteRegistrations(
  catalog: SpriteCatalogV1,
): void {
  for (const [spriteId, clips] of Object.entries(REQUIRED_SPRITE_CLIPS)) {
    const sprite = catalog.sprites[spriteId];
    if (!sprite) fail(`required sprite ${spriteId} is not registered`);
    for (const clip of clips) {
      const definition = sprite.clips[clip];
      if (!definition)
        fail(`required sprite ${spriteId} is missing clip ${clip}`);
      const expected = EXPECTED_CLIP_CADENCE[clip]!;
      if (
        definition.frameIdentities.length !== expected.frameCount ||
        definition.durationTicks !== expected.durationTicks ||
        definition.looping !== expected.looping
      )
        fail(`required sprite ${spriteId} clip ${clip} has invalid cadence`);
    }
  }
  for (const [spriteId, expected] of Object.entries(
    ENVIRONMENT_KIT_SPRITE_GEOMETRY,
  )) {
    const sprite = catalog.sprites[spriteId]!;
    if (
      sprite.logicalSize?.width !== expected.width ||
      sprite.logicalSize.height !== expected.height
    )
      fail(
        `required environment-kit sprite ${spriteId} has invalid logical size`,
      );
    if (
      sprite.anchor?.x !== expected.width / 2 ||
      sprite.anchor.y !== expected.height
    )
      fail(
        `required environment-kit sprite ${spriteId} is not bottom-center anchored`,
      );
    const frameIdentity = sprite.clips.static!.frameIdentities[0]!;
    const frame = sprite.frames[frameIdentity]!;
    const sourceAspect = frame.width / frame.height;
    const logicalAspect = expected.width / expected.height;
    if (Math.abs(sourceAspect - logicalAspect) > 0.01)
      fail(
        `required environment-kit sprite ${spriteId} square-stretches its tight source ink`,
      );
  }
}

function assertSpriteReference(
  value: unknown,
  catalog: SpriteCatalogV1,
  pathName: string,
): asserts value is ManifestSpriteReferenceV2 {
  const reference = object(value, pathName);
  if (reference.renderMode !== "sprite")
    fail(
      `${pathName} must use renderMode sprite; procedural fallback detected`,
    );
  const spriteId = nonEmptyString(reference.spriteId, `${pathName}.spriteId`);
  const sprite = catalog.sprites[spriteId];
  if (!sprite) fail(`${pathName} references unregistered sprite ${spriteId}`);
  const assetId = nonEmptyString(reference.assetId, `${pathName}.assetId`);
  if (assetId !== sprite.assetId)
    fail(`${pathName}.assetId ${assetId} does not match sprite ${spriteId}`);
  const frameIdentity = nonEmptyString(
    reference.frameIdentity,
    `${pathName}.frameIdentity`,
  );
  const registeredRect = sprite.frames[frameIdentity];
  if (!registeredRect)
    fail(`${pathName} frame ${frameIdentity} is not registered on ${spriteId}`);
  const actualRect = sourceRect(reference.sourceRect, `${pathName}.sourceRect`);
  if (!sameRect(actualRect, registeredRect))
    fail(`${pathName}.sourceRect does not match frame ${frameIdentity}`);
}

export function validateManifestSpriteContract(
  input: unknown,
  catalog: SpriteCatalogV1,
): RenderManifestV2Shape {
  const manifest = object(input, "manifest");
  if (manifest.schemaVersion !== 2)
    fail(
      "manifest.schemaVersion must be 2; procedural V1 manifests are forbidden",
    );
  if (manifest.spriteCatalogRevision !== catalog.revision)
    fail(
      "manifest.spriteCatalogRevision does not match the registered catalog",
    );
  if (!Array.isArray(manifest.drawCalls))
    fail("manifest.drawCalls must be an array");
  if (!Array.isArray(manifest.sceneSprites))
    fail("manifest.sceneSprites must be an array");
  const drawCalls = manifest.drawCalls as unknown[];
  const sceneSprites = manifest.sceneSprites as unknown[];
  for (const [index, callValue] of drawCalls.entries()) {
    const pathName = `manifest.drawCalls[${index}]`;
    assertSpriteReference(callValue, catalog, pathName);
    const call = callValue as unknown as ManifestDrawCallV2;
    const sprite = catalog.sprites[call.spriteId]!;
    const clip = sprite.clips[call.clip];
    if (!clip)
      fail(`${pathName} sprite ${call.spriteId} has no ${call.clip} clip`);
    const frameIndex = integer(call.frameIndex, `${pathName}.frameIndex`);
    if (frameIndex >= clip.frameIdentities.length)
      fail(`${pathName}.frameIndex exceeds registered clip frames`);
    if (call.frameCount !== clip.frameIdentities.length)
      fail(`${pathName}.frameCount does not match registered clip cadence`);
    if (call.clipDurationTicks !== clip.durationTicks)
      fail(
        `${pathName}.clipDurationTicks does not match registered clip cadence`,
      );
    if (call.frameIdentity !== clip.frameIdentities[frameIndex])
      fail(`${pathName}.frameIdentity does not match clip frameIndex`);
    if (call.type === "player" || call.type === "monster") {
      if (typeof call.scale !== "number" || !Number.isFinite(call.scale))
        fail(`${pathName}.scale must be a finite number`);
      if (Math.abs(call.scale * 256 - call.destinationRect.width) > 0.51)
        fail(`${pathName}.scale does not match destination width`);
    }
  }
  for (const [index, sceneValue] of sceneSprites.entries())
    assertSpriteReference(
      sceneValue,
      catalog,
      `manifest.sceneSprites[${index}]`,
    );
  return manifest as unknown as RenderManifestV2Shape;
}

export function assertDeterministicScenePlacement(
  firstInput: unknown,
  secondInput: unknown,
  state: GameState,
  catalog: SpriteCatalogV1,
): void {
  const first = validateManifestSpriteContract(firstInput, catalog);
  const second = validateManifestSpriteContract(secondInput, catalog);
  if (
    JSON.stringify(first.sceneSprites) !== JSON.stringify(second.sceneSprites)
  )
    fail("sceneSprites placement differs for identical state and camera");
  const ids = new Set<string>();
  for (const [index, scene] of first.sceneSprites.entries()) {
    if (ids.has(scene.objectId))
      fail(`duplicate scene object ${scene.objectId}`);
    ids.add(scene.objectId);
    if (scene.zOrder !== index)
      fail(
        `scene object ${scene.objectId} has unstable zOrder ${scene.zOrder}`,
      );
  }
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const objectId = `tile:${x}:${y}`;
      const scene = first.sceneSprites.find(
        (item) => item.objectId === objectId,
      );
      if (!scene) fail(`missing deterministic scenery object ${objectId}`);
      if (scene.kind !== "tile" || scene.spriteId !== "scenery:tile:floor")
        fail(`${objectId} does not use the shared scale-matched floor base`);
      if (scene.tile.x !== x || scene.tile.y !== y)
        fail(`${objectId} tile coordinates are not deterministic`);
      if (
        scene.worldAnchor.x !== x * 1024 + 512 ||
        scene.worldAnchor.y !== y * 1024 + 512
      )
        fail(`${objectId} world anchor is not the tile center`);
      if (scene.opacity < 0.95)
        fail(
          `${objectId} shared floor base is visually absent at opacity ${scene.opacity}`,
        );
      const wall = state.map.tiles[y * state.map.width + x] === 1;
      const wallOverlay = first.sceneSprites.find(
        (item) => item.objectId === `wall-overlay:${x}:${y}`,
      );
      if (!wall && wallOverlay)
        fail(`${objectId} walkable cell has a blocked-material overlay`);
      if (
        wall &&
        (!wallOverlay ||
          wallOverlay.spriteId !== "scenery:tile:wall" ||
          wallOverlay.opacity <= 0)
      )
        fail(`${objectId} collision topology is visually absent`);
    }
  }
  for (const placement of buildSceneryLayout(state.map)) {
    const sprite = first.sceneSprites.find(
      ({ objectId }) => objectId === placement.id,
    );
    if (!sprite) fail(`missing visible scenery placement ${placement.id}`);
    if (!sprite.collision)
      fail(`missing collision declaration for scenery ${placement.id}`);
    if (sprite.collision.mode !== placement.collisionMode)
      fail(`collision mode differs for scenery ${placement.id}`);
    if (placement.collision) {
      if (
        sprite.collision.shape !== placement.collision.shape ||
        sprite.collision.worldCenter.x !== placement.collision.center.x ||
        sprite.collision.worldCenter.y !== placement.collision.center.y ||
        sprite.collision.halfWidth !== placement.collision.halfWidth ||
        sprite.collision.halfHeight !== placement.collision.halfHeight
      )
        fail(`collision footprint differs for scenery ${placement.id}`);
    } else if (
      sprite.collision.halfWidth !== 0 ||
      sprite.collision.halfHeight !== 0
    )
      fail(`passable scenery ${placement.id} has a solid footprint`);
  }
  const boundaryDirections = [
    { id: "north", dx: 0, dy: -1 },
    { id: "east", dx: 1, dy: 0 },
    { id: "south", dx: 0, dy: 1 },
    { id: "west", dx: -1, dy: 0 },
  ] as const;
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const wall = state.map.tiles[y * state.map.width + x] === 1;
      if (!wall) continue;
      const cardinalNeighborIsFloor = boundaryDirections.some(({ dx, dy }) => {
        const neighborX = x + dx;
        const neighborY = y + dy;
        return (
          neighborX >= 0 &&
          neighborY >= 0 &&
          neighborX < state.map.width &&
          neighborY < state.map.height &&
          state.map.tiles[neighborY * state.map.width + neighborX] === 0
        );
      });
      if (cardinalNeighborIsFloor) {
        const blend = first.sceneSprites.find(
          ({ objectId }) => objectId === `edge-blend:${x}:${y}`,
        );
        if (!blend || blend.spriteId !== "scenery:edge:floor-blend")
          fail(`missing floor-material blend at collision tile:${x}:${y}`);
        if (blend.opacity < 0.2)
          fail(`floor-material blend at collision tile:${x}:${y} is absent`);
      }
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
        const boundary = first.sceneSprites.find(
          ({ objectId }) => objectId === `boundary:${direction.id}:${x}:${y}`,
        );
        if (!boundary || boundary.spriteId !== "scenery:boundary:stone")
          fail(
            `missing visible collision boundary ${direction.id} of tile:${x}:${y}`,
          );
        if (boundary.opacity < 0.1)
          fail(
            `collision boundary ${direction.id} of tile:${x}:${y} is visually absent`,
          );
      }
    }
  }
  const player = first.drawCalls.find((item) => item.entityId === "player");
  const spawnStructure = first.sceneSprites.find((item) =>
    item.objectId.startsWith("structure:0:"),
  );
  if (!player) fail("missing player draw call for scene composition");
  if (!spawnStructure) fail("missing spawn structure for scene composition");
  const playerRect = player.destinationRect;
  const structureRect = spawnStructure.destinationRect;
  if (structureRect.width / playerRect.width < 1.45)
    fail("spawn structure is too small relative to the player");
  const overlapWidth = Math.max(
    0,
    Math.min(
      playerRect.x + playerRect.width,
      structureRect.x + structureRect.width,
    ) - Math.max(playerRect.x, structureRect.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(
      playerRect.y + playerRect.height,
      structureRect.y + structureRect.height,
    ) - Math.max(playerRect.y, structureRect.y),
  );
  const playerOverlapRatio =
    (overlapWidth * overlapHeight) / (playerRect.width * playerRect.height);
  // Atlas cells include broad transparent/grounding margins. A modest
  // rectangle intersection is expected when a tall landmark sits behind the
  // actor; the paired full-overlap mutation still rejects attachment.
  if (playerOverlapRatio > 0.2)
    fail(
      `spawn structure destination overlaps the player (${playerOverlapRatio.toFixed(3)})`,
    );
  const exit = first.sceneSprites.find(
    (item) => item.objectId === "exit:rift-gate",
  );
  if (!exit) fail("missing deterministic exit:rift-gate scene object");
  const expectedExit = state.exitUnlocked
    ? "scenery:exit:open"
    : "scenery:exit:locked";
  if (
    exit.kind !== "exit" ||
    exit.spriteId !== expectedExit ||
    exit.tile.x !== state.map.exit.x ||
    exit.tile.y !== state.map.exit.y
  )
    fail(`exit:rift-gate does not use deterministic ${expectedExit} placement`);
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature))
    fail("registered asset is not a valid PNG file");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export async function assertRegisteredAssetFiles(
  catalog: SpriteCatalogV1,
  projectRoot = process.cwd(),
): Promise<void> {
  for (const asset of Object.values(catalog.assets)) {
    const relativeUrl = asset.url.replace(/^\//, "").split(/[?#]/, 1)[0]!;
    const filePath = path.join(projectRoot, "public", relativeUrl);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      fail(`registered sprite asset is missing: ${filePath}`);
    }
    const dimensions = pngDimensions(buffer);
    if (
      dimensions.width !== asset.pixelWidth ||
      dimensions.height !== asset.pixelHeight
    )
      fail(`registered dimensions for ${asset.id} do not match its PNG`);
  }
}

export async function loadProductionSpriteCatalog(
  projectRoot = process.cwd(),
): Promise<SpriteCatalogV1> {
  const modulePath = path.join(projectRoot, "src/render/sprites.ts");
  try {
    await fs.access(modulePath);
  } catch {
    fail(`missing production sprite registry: ${modulePath}`);
  }
  const moduleUrl = `${pathToFileURL(modulePath).href}?contract=${Date.now()}`;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Record<
    string,
    unknown
  >;
  if (!("SPRITE_CATALOG" in loaded))
    fail("src/render/sprites.ts must export SPRITE_CATALOG");
  return validateSpriteCatalog(loaded.SPRITE_CATALOG);
}
