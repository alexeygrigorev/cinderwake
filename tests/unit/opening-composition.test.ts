import { describe, expect, it } from "vitest";
import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../../src/game/constants";
import type { RenderManifestV1 } from "../../src/render/manifest";
import { buildRenderManifest } from "../../src/render/manifest";
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

describe("opening-room composition gate", () => {
  it("accepts the generated opening-room composition", () => {
    const manifest = openingManifest();
    const assessment = assessOpeningComposition(manifest);
    expect(assessment.violations, JSON.stringify(assessment.evidence)).toEqual(
      [],
    );
    expect(assessment.pass).toBe(true);
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
  ])("rejects paired negative control: $name", ({ expected, mutate }) => {
    const manifest = structuredClone(openingManifest());
    mutate(manifest);
    expect(assessOpeningComposition(manifest).violations).toContain(expected);
  });
});
