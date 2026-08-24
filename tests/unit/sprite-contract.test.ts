import { describe, expect, it } from "vitest";
import { CLIP_DURATIONS } from "../../src/game/constants";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type AnimationClip } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  TEMPORAL_ENTITY_IDS,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import {
  ENVIRONMENT_KIT_SPRITE_GEOMETRY,
  EXPECTED_CLIP_CADENCE,
  REQUIRED_SPRITE_CLIPS,
  assertDeterministicScenePlacement,
  assertRegisteredAssetFiles,
  loadProductionSpriteCatalog,
  validateManifestSpriteContract,
  validateSpriteCatalog,
  type SpriteCatalogV1,
} from "../framework/sprite-contract";

const CAMERA = { x: 480, y: 360, zoom: 1 };

function completeCatalog(
  assetUrl = "/assets/sprites/test-atlas.png",
): SpriteCatalogV1 {
  const assetId = "atlas:test";
  const sprites: Record<string, unknown> = {};
  for (const [spriteId, clipNames] of Object.entries(REQUIRED_SPRITE_CLIPS)) {
    const logicalSize = (
      ENVIRONMENT_KIT_SPRITE_GEOMETRY as Record<
        string,
        { width: number; height: number } | undefined
      >
    )[spriteId];
    const frames: Record<
      string,
      { x: number; y: number; width: number; height: number }
    > = {};
    const clips: Record<string, unknown> = {};
    let nextFrame = 0;
    for (const clipName of clipNames) {
      const cadence = EXPECTED_CLIP_CADENCE[clipName]!;
      const frameIdentities = Array.from(
        { length: cadence.frameCount },
        (_, index) => `${spriteId}:${clipName}:${index}`,
      );
      for (const frameIdentity of frameIdentities) {
        frames[frameIdentity] = {
          x: (nextFrame % 64) * 8,
          y: Math.floor(nextFrame / 64) * 8,
          width: logicalSize?.width ?? 8,
          height: logicalSize?.height ?? 8,
        };
        nextFrame += 1;
      }
      clips[clipName] = {
        frameIdentities,
        durationTicks: cadence.durationTicks,
        looping: cadence.looping,
      };
    }
    sprites[spriteId] = {
      id: spriteId,
      assetId,
      frames,
      clips,
      ...(logicalSize
        ? {
            logicalSize,
            anchor: {
              x: logicalSize.width / 2,
              y: logicalSize.height,
            },
          }
        : {}),
    };
  }
  return validateSpriteCatalog({
    schemaVersion: 1,
    revision: "test-revision",
    assets: {
      [assetId]: {
        id: assetId,
        url: assetUrl,
        mimeType: "image/png",
        pixelWidth: 512,
        pixelHeight: 512,
        revision: "test-revision",
      },
    },
    sprites,
  });
}

function spriteDrawCall(catalog: SpriteCatalogV1): Record<string, unknown> {
  const sprite = catalog.sprites["hero:vanguard"]!;
  const clip = sprite.clips.idle!;
  const frameIdentity = clip.frameIdentities[0]!;
  return {
    entityId: "player",
    type: "player",
    geometryId: "hero:vanguard",
    clip: "idle",
    frameIndex: 0,
    frameCount: clip.frameIdentities.length,
    clipDurationTicks: clip.durationTicks,
    renderMode: "sprite",
    spriteId: sprite.id,
    assetId: sprite.assetId,
    sourceRect: sprite.frames[frameIdentity],
    frameIdentity,
  };
}

describe("sprite atlas quality contract", () => {
  it("rejects procedural calls, source-rectangle drift, and cadence drift", () => {
    const catalog = completeCatalog();
    const call = spriteDrawCall(catalog);
    const manifest = {
      schemaVersion: 2,
      spriteCatalogRevision: catalog.revision,
      drawCalls: [call],
      sceneSprites: [],
    };
    expect(() =>
      validateManifestSpriteContract(
        {
          ...manifest,
          drawCalls: [{ ...call, renderMode: "procedural-vector" }],
        },
        catalog,
      ),
    ).toThrow("procedural fallback detected");
    expect(() =>
      validateManifestSpriteContract(
        {
          ...manifest,
          drawCalls: [
            {
              ...call,
              sourceRect: { ...(call.sourceRect as object), x: 99 },
            },
          ],
        },
        catalog,
      ),
    ).toThrow("sourceRect does not match");
    expect(() =>
      validateManifestSpriteContract(
        {
          ...manifest,
          drawCalls: [{ ...call, frameCount: 999 }],
        },
        catalog,
      ),
    ).toThrow("frameCount does not match");
  });

  it("detects a registered atlas file that is missing from public assets", async () => {
    const catalog = completeCatalog(
      "/assets/sprites/definitely-missing-sprite-contract.png",
    );
    await expect(assertRegisteredAssetFiles(catalog)).rejects.toThrow(
      "registered sprite asset is missing",
    );
  });

  it("registers exhaustive gameplay and scenery sprites backed by real PNGs", async () => {
    const catalog = await loadProductionSpriteCatalog();
    expect(Object.keys(catalog.sprites)).toEqual(
      expect.arrayContaining(Object.keys(REQUIRED_SPRITE_CLIPS)),
    );
    await expect(assertRegisteredAssetFiles(catalog)).resolves.toBeUndefined();
  });

  it("registers the reviewed environment kit with tight aspect-preserving frames", async () => {
    const catalog = await loadProductionSpriteCatalog();
    const expectedFrames = {
      "scenery:architecture:north-wall-solid": {
        x: 65,
        y: 96,
        width: 382,
        height: 351,
      },
      "scenery:structure:forge-workshop": {
        x: 577,
        y: 107,
        width: 383,
        height: 340,
      },
      "scenery:prop:lantern-a": {
        x: 1193,
        y: 65,
        width: 171,
        height: 383,
      },
      "scenery:prop:lantern-b": {
        x: 170,
        y: 577,
        width: 173,
        height: 382,
      },
      "scenery:prop:barricade-v2": {
        x: 577,
        y: 643,
        width: 385,
        height: 318,
      },
      "scenery:prop:raised-clutter-bench": {
        x: 1087,
        y: 640,
        width: 384,
        height: 318,
      },
    } as const;
    expect(catalog.assets["atlas:environment-kit-v2"]).toMatchObject({
      url: "/assets/sprites/environment-kit-v2.png",
      pixelWidth: 1536,
      pixelHeight: 1024,
    });
    for (const [spriteId, logicalSize] of Object.entries(
      ENVIRONMENT_KIT_SPRITE_GEOMETRY,
    )) {
      const sprite = catalog.sprites[spriteId]!;
      const frameIdentity = sprite.clips.static!.frameIdentities[0]!;
      expect(sprite.assetId).toBe("atlas:environment-kit-v2");
      expect(sprite.frames[frameIdentity]).toEqual(
        expectedFrames[spriteId as keyof typeof expectedFrames],
      );
      expect(sprite.logicalSize).toEqual(logicalSize);
      expect(sprite.anchor).toEqual({
        x: logicalSize.width / 2,
        y: logicalSize.height,
      });
      expect(
        Math.abs(
          sprite.frames[frameIdentity]!.width /
            sprite.frames[frameIdentity]!.height -
            logicalSize.width / logicalSize.height,
        ),
      ).toBeLessThan(0.01);
    }
    expect(
      new Set(
        Object.keys(ENVIRONMENT_KIT_SPRITE_GEOMETRY).map((spriteId) => {
          const sprite = catalog.sprites[spriteId]!;
          return JSON.stringify(
            sprite.frames[sprite.clips.static!.frameIdentities[0]!],
          );
        }),
      ).size,
    ).toBe(6);
  });

  it("emits sprite references and registered frame identities for every gameplay type", async () => {
    const catalog = await loadProductionSpriteCatalog();
    for (const scenarioId of [
      "temporal-vanguard-primary",
      "temporal-ranger-primary",
      "temporal-arcanist-primary",
      "temporal-ashfang-attack",
      "temporal-hexer-attack",
      "temporal-stonekin-attack",
      "temporal-loot-bob",
      "temporal-friendly-projectile",
      "mid-action",
    ]) {
      const state = worldFromScenario(BUILTIN_SCENARIOS[scenarioId]!);
      expect(() =>
        validateManifestSpriteContract(
          buildRenderManifest(state, CAMERA),
          catalog,
        ),
      ).not.toThrow();
    }
  });

  it("keeps atlas frame identity and source rectangles aligned for every clip tick", async () => {
    const catalog = await loadProductionSpriteCatalog();
    const heroScenarios = {
      vanguard: "temporal-vanguard-primary",
      ranger: "temporal-ranger-primary",
      arcanist: "temporal-arcanist-primary",
    } as const;
    for (const [classId, scenarioId] of Object.entries(heroScenarios)) {
      const state = worldFromScenario(BUILTIN_SCENARIOS[scenarioId]!);
      expect(state.player.classId).toBe(classId);
      for (const clip of Object.keys(CLIP_DURATIONS) as AnimationClip[]) {
        state.player.animation = {
          clip,
          startedAtTick: 0,
          lockedUntilTick: CLIP_DURATIONS[clip],
        };
        for (let tick = 0; tick <= CLIP_DURATIONS[clip]; tick += 1) {
          state.tick = tick;
          validateManifestSpriteContract(
            buildRenderManifest(state, CAMERA),
            catalog,
          );
        }
      }
    }
  });

  it("resolves every actor clip through authored north and south banks without flipping", async () => {
    const catalog = await loadProductionSpriteCatalog();
    const actorScenarios = {
      "hero:vanguard": ["temporal-vanguard-primary", "player"],
      "hero:ranger": ["temporal-ranger-primary", "player"],
      "hero:arcanist": ["temporal-arcanist-primary", "player"],
      "monster:ashfang": [
        "temporal-ashfang-attack",
        TEMPORAL_ENTITY_IDS.ashfangAttacker,
      ],
      "monster:hexer": [
        "temporal-hexer-attack",
        TEMPORAL_ENTITY_IDS.hexerAttacker,
      ],
      "monster:stonekin": [
        "temporal-stonekin-attack",
        TEMPORAL_ENTITY_IDS.stonekinAttacker,
      ],
    } as const;
    const facings = {
      north: { vector: { x: 0, y: -1024 }, suffix: ":north", flipX: false },
      east: { vector: { x: 1024, y: 0 }, suffix: "", flipX: false },
      south: { vector: { x: 0, y: 1024 }, suffix: ":south", flipX: false },
      west: { vector: { x: -1024, y: 0 }, suffix: "", flipX: true },
    } as const;

    for (const [geometryId, [scenarioId, entityId]] of Object.entries(
      actorScenarios,
    )) {
      const state = worldFromScenario(BUILTIN_SCENARIOS[scenarioId]!);
      const actor =
        entityId === "player"
          ? state.player
          : state.monsters.find(({ id }) => id === entityId)!;

      for (const clip of Object.keys(CLIP_DURATIONS) as AnimationClip[]) {
        actor.animation = {
          clip,
          startedAtTick: 0,
          lockedUntilTick: CLIP_DURATIONS[clip],
        };
        for (const [bucket, expected] of Object.entries(facings)) {
          actor.facing = { ...expected.vector };
          const manifest = buildRenderManifest(state, CAMERA);
          const call = manifest.drawCalls.find(
            ({ entityId: candidate }) => candidate === entityId,
          );
          expect(call, `${geometryId} ${clip} ${bucket}`).toMatchObject({
            geometryId,
            clip,
            facingBucket: bucket,
            spriteId: `${geometryId}${expected.suffix}`,
            flipX: expected.flipX,
          });
          validateManifestSpriteContract(manifest, catalog);
        }
      }
    }
  });

  it("keeps directional hero scenarios on their authored banks through action recovery", () => {
    const cases = [
      {
        scenarioId: "temporal-ranger-primary-north",
        action: "attack",
        direction: { x: 0, y: -1024 },
        spriteId: "hero:ranger:north",
        recoveryTick: CLIP_DURATIONS.attack,
      },
      {
        scenarioId: "temporal-arcanist-ability-south",
        action: "ability",
        direction: { x: 0, y: 1024 },
        spriteId: "hero:arcanist:south",
        recoveryTick: CLIP_DURATIONS.ability,
      },
    ] as const;

    for (const testCase of cases) {
      const state = worldFromScenario(BUILTIN_SCENARIOS[testCase.scenarioId]!);
      const target = state.monsters.find(
        ({ id }) => id === TEMPORAL_ENTITY_IDS.heroTarget,
      )!;
      const initialTargetHealth = target.health;
      expect(state.player.facing).toEqual(testCase.direction);
      expect(
        buildRenderManifest(state, CAMERA).drawCalls.find(
          ({ entityId }) => entityId === "player",
        ),
      ).toMatchObject({
        clip: "idle",
        spriteId: testCase.spriteId,
        flipX: false,
      });

      stepGame(state, {
        ...EMPTY_INPUT,
        attack: testCase.action === "attack",
        ability: testCase.action === "ability",
      });
      while (state.tick <= testCase.recoveryTick) {
        expect(
          buildRenderManifest(state, CAMERA).drawCalls.find(
            ({ entityId }) => entityId === "player",
          ),
          `${testCase.scenarioId} tick ${state.tick}`,
        ).toMatchObject({
          clip: testCase.action,
          spriteId: testCase.spriteId,
          flipX: false,
        });
        stepGame(state, EMPTY_INPUT);
      }

      expect(state.tick).toBe(testCase.recoveryTick + 1);
      expect(target.health).toBeLessThan(initialTargetHealth);
      expect(state.player.facing).toEqual(testCase.direction);
      expect(
        buildRenderManifest(state, CAMERA).drawCalls.find(
          ({ entityId }) => entityId === "player",
        ),
      ).toMatchObject({
        clip: "idle",
        spriteId: testCase.spriteId,
        flipX: false,
      });
    }
  });

  it("places every tile and exit deterministically as registered scenery sprites", async () => {
    const catalog = await loadProductionSpriteCatalog();
    for (const scenarioId of ["animation-idle", "combat-loot"]) {
      const state = worldFromScenario(BUILTIN_SCENARIOS[scenarioId]!);
      const first = buildRenderManifest(state, CAMERA);
      const second = buildRenderManifest(structuredClone(state), CAMERA);
      expect(() =>
        assertDeterministicScenePlacement(first, second, state, catalog),
      ).not.toThrow();
    }
  });

  it("proves the scenery composition assessor rejects known visual regressions", async () => {
    const catalog = await loadProductionSpriteCatalog();
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    const valid = buildRenderManifest(state, CAMERA);
    const mutations = [
      {
        expected: "scale does not match destination width",
        apply(manifest: typeof valid) {
          manifest.drawCalls.find(
            ({ entityId }) => entityId === "player",
          )!.scale = 0.43;
        },
      },
      {
        expected: "collision topology is visually absent",
        apply(manifest: typeof valid) {
          manifest.sceneSprites.find(({ spriteId }) =>
            spriteId.endsWith(":wall"),
          )!.opacity = 0;
        },
      },
      {
        expected: "missing collision declaration for scenery",
        apply(manifest: typeof valid) {
          manifest.sceneSprites.find(({ objectId }) =>
            objectId.startsWith("structure:0:"),
          )!.collision = undefined;
        },
      },
      {
        expected: "missing visible collision boundary",
        apply(manifest: typeof valid) {
          const index = manifest.sceneSprites.findIndex(({ objectId }) =>
            objectId.startsWith("boundary:south:"),
          );
          manifest.sceneSprites.splice(index, 1);
          manifest.sceneSprites.forEach((sprite, spriteIndex) => {
            sprite.zOrder = spriteIndex;
          });
        },
      },
      {
        expected: "missing floor-material blend",
        apply(manifest: typeof valid) {
          const boundary = manifest.sceneSprites.find(({ objectId }) =>
            objectId.startsWith("boundary:"),
          )!;
          const [, , x, y] = boundary.objectId.split(":");
          const index = manifest.sceneSprites.findIndex(
            ({ objectId }) => objectId === `edge-blend:${x}:${y}`,
          );
          manifest.sceneSprites.splice(index, 1);
          manifest.sceneSprites.forEach((sprite, spriteIndex) => {
            sprite.zOrder = spriteIndex;
          });
        },
      },
      {
        expected: "spawn structure is too small",
        apply(manifest: typeof valid) {
          manifest.sceneSprites.find(({ objectId }) =>
            objectId.startsWith("structure:0:"),
          )!.destinationRect.width = 100;
        },
      },
      {
        expected: "spawn structure destination overlaps",
        apply(manifest: typeof valid) {
          const player = manifest.drawCalls.find(
            ({ entityId }) => entityId === "player",
          )!;
          const structure = manifest.sceneSprites.find(({ objectId }) =>
            objectId.startsWith("structure:0:"),
          )!;
          structure.destinationRect.x = player.destinationRect.x;
          structure.destinationRect.y = player.destinationRect.y;
        },
      },
    ];
    for (const mutation of mutations) {
      const broken = structuredClone(valid);
      mutation.apply(broken);
      expect(() =>
        assertDeterministicScenePlacement(
          broken,
          structuredClone(broken),
          state,
          catalog,
        ),
      ).toThrow(mutation.expected);
    }
  });
});
