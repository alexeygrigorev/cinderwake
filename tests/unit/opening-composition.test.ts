import { describe, expect, it } from "vitest";
import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../../src/game/constants";
import type { RenderManifestV1 } from "../../src/render/manifest";
import { buildRenderManifest } from "../../src/render/manifest";
import { isFloor } from "../../src/game/dungeon";
import {
  buildSceneryLayout,
  openingNorthWallFeature,
} from "../../src/game/sceneryLayout";
import {
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { assessOpeningComposition } from "../framework/opening-composition";

function openingManifest(): RenderManifestV1 {
  const state = worldFromScenario(createRunScenario("cinder-041", "vanguard"));
  const targetX = (state.player.position.x / UNITS_PER_TILE) * TILE_PIXELS;
  const targetY = (state.player.position.y / UNITS_PER_TILE) * TILE_PIXELS;
  return buildRenderManifest(state, {
    x: Math.max(
      VIEW_WIDTH / 2,
      Math.min(state.map.width * TILE_PIXELS - VIEW_WIDTH / 2, targetX),
    ),
    y: Math.max(
      VIEW_HEIGHT / 2,
      Math.min(state.map.height * TILE_PIXELS - VIEW_HEIGHT / 2, targetY),
    ),
    zoom: 1,
  });
}

function northWallManifest(): RenderManifestV1 {
  for (let index = 0; index < 100; index += 1) {
    const state = worldFromScenario(
      createRunScenario(`opening-wall-manifest-${index}`, "vanguard"),
    );
    if (!openingNorthWallFeature(state.map)) continue;
    const targetX = (state.player.position.x / UNITS_PER_TILE) * TILE_PIXELS;
    const targetY = (state.player.position.y / UNITS_PER_TILE) * TILE_PIXELS;
    return buildRenderManifest(state, {
      x: Math.max(
        VIEW_WIDTH / 2,
        Math.min(state.map.width * TILE_PIXELS - VIEW_WIDTH / 2, targetX),
      ),
      y: Math.max(
        VIEW_HEIGHT / 2,
        Math.min(state.map.height * TILE_PIXELS - VIEW_HEIGHT / 2, targetY),
      ),
      zoom: 1,
    });
  }
  throw new Error("No generated north-wall feature seed found");
}

describe("opening-room composition gate", () => {
  it("accepts the generated opening-room composition", () => {
    const manifest = openingManifest();
    const assessment = assessOpeningComposition(manifest);
    expect(assessment.violations, JSON.stringify(assessment.evidence)).toEqual(
      [],
    );
    expect(assessment.pass).toBe(true);
    expect(
      Object.fromEntries(
        [
          "structure:0:forge",
          "architecture:opening:lantern:0",
          "architecture:opening:lantern:1",
          "prop:0:barricade-v2",
          "prop:0:raised-clutter-bench",
        ].map((objectId) => {
          const sprite = manifest.sceneSprites.find(
            (candidate) => candidate.objectId === objectId,
          )!;
          return [
            objectId,
            {
              spriteId: sprite.spriteId,
              width: sprite.destinationRect.width,
              height: sprite.destinationRect.height,
            },
          ];
        }),
      ),
    ).toEqual({
      "structure:0:forge": {
        spriteId: "scenery:structure:forge-workshop",
        width: 220,
        height: 195,
      },
      "architecture:opening:lantern:0": {
        spriteId: "scenery:prop:lantern-a",
        width: 53,
        height: 118,
      },
      "architecture:opening:lantern:1": {
        spriteId: "scenery:prop:lantern-b",
        width: 53,
        height: 118,
      },
      "prop:0:barricade-v2": {
        spriteId: "scenery:prop:barricade-v2",
        width: 107,
        height: 88,
      },
      "prop:0:raised-clutter-bench": {
        spriteId: "scenery:prop:raised-clutter-bench",
        width: 124,
        height: 103,
      },
    });
  });

  it("builds a deterministic, varied ruin silhouette only on deep blocked terrain", () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const state = worldFromScenario(
        createRunScenario(`opening-backdrop-${seed}`, "vanguard"),
      );
      const first = buildSceneryLayout(state.map).filter(({ id }) =>
        id.startsWith("architecture:opening:backdrop:"),
      );
      const second = buildSceneryLayout(state.map).filter(({ id }) =>
        id.startsWith("architecture:opening:backdrop:"),
      );
      expect(first, `missing silhouette for seed ${seed}`).toHaveLength(3);
      expect(second).toEqual(first);
      expect(new Set(first.map(({ name }) => name)).size).toBe(3);
      for (const placement of first) {
        expect(placement.collisionMode).toBe("solid");
        expect(placement.collision).not.toBeNull();
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1)
            expect(
              isFloor(
                state.map,
                placement.tile.x + offsetX,
                placement.tile.y + offsetY,
              ),
              `${placement.id} approaches a walkable route for seed ${seed}`,
            ).toBe(false);
        }
      }
    }
  });

  it.each([
    {
      name: "erased boundary",
      expected: "opening:insufficient-visible-collision-boundary",
      mutate(manifest: RenderManifestV1) {
        manifest.sceneSprites = manifest.sceneSprites.map((sprite) =>
          sprite.objectId.startsWith("boundary:")
            ? { ...sprite, visible: false }
            : sprite,
        );
      },
    },
    {
      name: "missing route cue",
      expected: "opening:threshold-cue-not-visible",
      mutate(manifest: RenderManifestV1) {
        manifest.sceneSprites = manifest.sceneSprites.map((sprite) =>
          sprite.objectId.startsWith("architecture:opening:threshold:")
            ? { ...sprite, visible: false }
            : sprite,
        );
      },
    },
    {
      name: "empty focal field",
      expected: "opening:authored-focal-occupancy-too-sparse",
      mutate(manifest: RenderManifestV1) {
        manifest.sceneSprites = manifest.sceneSprites.map((sprite) =>
          /^(?:structure|prop):0:/.test(sprite.objectId)
            ? { ...sprite, visible: false }
            : sprite,
        );
      },
    },
    {
      name: "empty wide backdrop",
      expected: "opening:wide-backdrop-too-sparse",
      mutate(manifest: RenderManifestV1) {
        manifest.sceneSprites = manifest.sceneSprites.map((sprite) =>
          sprite.objectId.startsWith("architecture:opening:backdrop:")
            ? { ...sprite, visible: false }
            : sprite,
        );
      },
    },
    {
      name: "repeated wide backdrop",
      expected: "opening:wide-backdrop-obviously-repeated",
      mutate(manifest: RenderManifestV1) {
        const backdrops = manifest.sceneSprites.filter(({ objectId }) =>
          objectId.startsWith("architecture:opening:backdrop:"),
        );
        backdrops[1]!.spriteId = backdrops[0]!.spriteId;
      },
    },
    {
      name: "overwhelming focal field",
      expected: "opening:authored-focal-area-out-of-range",
      mutate(manifest: RenderManifestV1) {
        const focal = manifest.sceneSprites.find(({ objectId }) =>
          objectId.startsWith("prop:0:"),
        )!;
        focal.destinationRect = { x: 0, y: 0, width: 960, height: 540 };
      },
    },
    {
      name: "adjacent room edge fragment",
      expected: "opening:adjacent-room-fragment-visible",
      mutate(manifest: RenderManifestV1) {
        const fragment = manifest.sceneSprites.find(({ objectId }) =>
          /^(?:structure|prop|decal):[1-9]\d*:/.test(objectId),
        )!;
        fragment.visible = true;
        fragment.destinationRect.x = 100;
        fragment.destinationRect.y = 100;
      },
    },
    {
      name: "cropped focal forge",
      expected: "opening:focal-forge-cropped",
      mutate(manifest: RenderManifestV1) {
        const forge = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "structure:0:forge",
        )!;
        forge.destinationRect.x = -forge.destinationRect.width / 2;
      },
    },
    {
      name: "raised pass-through scenery",
      expected: "opening:raised-scenery-missing-solid-collision",
      mutate(manifest: RenderManifestV1) {
        const lantern = manifest.sceneSprites.find(({ objectId }) =>
          objectId.startsWith("architecture:opening:lantern:"),
        )!;
        lantern.collision = {
          ...lantern.collision!,
          mode: "passable",
        };
      },
    },
    {
      name: "missing environment-kit role",
      expected: "opening:environment-kit-role-missing-or-mismatched",
      mutate(manifest: RenderManifestV1) {
        manifest.sceneSprites = manifest.sceneSprites.map((sprite) =>
          sprite.objectId === "prop:0:barricade-v2"
            ? { ...sprite, visible: false }
            : sprite,
        );
      },
    },
    {
      name: "detached warm floor light",
      expected: "opening:warm-floor-light-missing-or-detached",
      mutate(manifest: RenderManifestV1) {
        const light = manifest.sceneSprites.find(({ objectId }) =>
          objectId.startsWith("architecture:opening:lantern-light:"),
        )!;
        light.worldAnchor.x += UNITS_PER_TILE;
      },
    },
  ])("rejects paired negative control: $name", ({ expected, mutate }) => {
    const manifest = structuredClone(openingManifest());
    mutate(manifest);
    expect(assessOpeningComposition(manifest).violations).toContain(expected);
  });

  it("keeps one calibrated north wall, removes legacy facades, and caps every blocked shell tile", () => {
    const assessment = assessOpeningComposition(northWallManifest());
    expect(assessment.evidence.northWallFeatureCount).toBe(1);
    expect(assessment.evidence.northWallStretchedCount).toBe(0);
    expect(assessment.evidence.northWallLegacyFacadeCount).toBe(0);
    expect(assessment.evidence.northWallShellTileCount).toBeGreaterThanOrEqual(
      3,
    );
    expect(assessment.evidence.northWallVisibleCapCount).toBe(
      assessment.evidence.northWallShellTileCount,
    );
    expect(assessment.evidence.northWallMissingCapCount).toBe(0);
    expect(assessment.evidence.northWallMismatchedCapCount).toBe(0);
  });

  it.each([
    {
      name: "repeated wall",
      expected: "opening:north-wall-repeated",
      mutate(manifest: RenderManifestV1) {
        const wall = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "architecture:opening:north-wall",
        )!;
        manifest.sceneSprites.push({ ...structuredClone(wall) });
      },
    },
    {
      name: "stretched wall",
      expected: "opening:north-wall-stretched",
      mutate(manifest: RenderManifestV1) {
        const wall = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "architecture:opening:north-wall",
        )!;
        wall.destinationRect.width += 64;
      },
    },
    {
      name: "legacy wall bay reinserted",
      expected: "opening:north-wall-legacy-facade-present",
      mutate(manifest: RenderManifestV1) {
        const wall = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "architecture:opening:north-wall",
        )!;
        const cap = manifest.sceneSprites.find(
          ({ objectId }) =>
            objectId === `boundary:south:${wall.tile.x}:${wall.tile.y}`,
        )!;
        manifest.sceneSprites.push({
          ...structuredClone(cap),
          objectId: "wall-front:negative-control:reinserted-bay",
          spriteId: "scenery:boundary:wall-front",
          sourceRect: { x: 0, y: 512, width: 256, height: 256 },
          tile: { ...wall.tile },
        });
      },
    },
    {
      name: "missing blocked-shell cap",
      expected: "opening:north-wall-shell-cap-missing",
      mutate(manifest: RenderManifestV1) {
        const wall = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "architecture:opening:north-wall",
        )!;
        const cap = manifest.sceneSprites.find(
          ({ objectId }) =>
            objectId === `boundary:south:${wall.tile.x}:${wall.tile.y}`,
        )!;
        cap.visible = false;
      },
    },
    {
      name: "wrong blocked-shell cap sprite",
      expected: "opening:north-wall-shell-cap-mismatched",
      mutate(manifest: RenderManifestV1) {
        const wall = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "architecture:opening:north-wall",
        )!;
        const cap = manifest.sceneSprites.find(
          ({ objectId }) =>
            objectId === `boundary:south:${wall.tile.x}:${wall.tile.y}`,
        )!;
        cap.spriteId = "scenery:boundary:wall-front";
        cap.sourceRect = { x: 0, y: 512, width: 256, height: 256 };
      },
    },
  ])("rejects north-wall negative control: $name", ({ expected, mutate }) => {
    const manifest = structuredClone(northWallManifest());
    mutate(manifest);
    expect(assessOpeningComposition(manifest).violations).toContain(expected);
  });
});
