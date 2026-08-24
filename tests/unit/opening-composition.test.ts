import { describe, expect, it } from "vitest";
import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../../src/game/constants";
import type { RenderManifestV1 } from "../../src/render/manifest";
import { buildRenderManifest } from "../../src/render/manifest";
import { openingNorthWallFeature } from "../../src/game/sceneryLayout";
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

  it("keeps one calibrated north wall, suppresses its center facades, and retains the outer facades", () => {
    const assessment = assessOpeningComposition(northWallManifest());
    expect(assessment.evidence.northWallFeatureCount).toBe(1);
    expect(assessment.evidence.northWallStretchedCount).toBe(0);
    expect(assessment.evidence.centralLegacyFacadeCount).toBe(0);
    expect(assessment.evidence.outerLegacyFacadeCount).toBeGreaterThanOrEqual(
      2,
    );
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
      name: "central legacy facade",
      expected: "opening:north-wall-central-facade-not-suppressed",
      mutate(manifest: RenderManifestV1) {
        const wall = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "architecture:opening:north-wall",
        )!;
        const facade = manifest.sceneSprites.find(({ objectId }) =>
          objectId.startsWith("wall-front:"),
        )!;
        manifest.sceneSprites.push({
          ...structuredClone(facade),
          objectId: "wall-front:negative-control:center",
          tile: { ...wall.tile },
        });
      },
    },
  ])("rejects north-wall negative control: $name", ({ expected, mutate }) => {
    const manifest = structuredClone(northWallManifest());
    mutate(manifest);
    expect(assessOpeningComposition(manifest).violations).toContain(expected);
  });
});
