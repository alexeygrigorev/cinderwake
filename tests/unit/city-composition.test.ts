import { describe, expect, it } from "vitest";
import { TILE_PIXELS, UNITS_PER_TILE } from "../../src/game/constants";
import { createEmbercrossMap } from "../../src/game/cityWorld";
import { tileCenter } from "../../src/game/dungeon";
import type { RenderManifestV1 } from "../../src/render/manifest";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { assessCityComposition } from "../framework/city-composition";

function cityOverviewManifest(): RenderManifestV1 {
  const state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
  state.map = createEmbercrossMap();
  state.city.locationPhase = "inside";
  state.monsters = [];
  state.loot = [];
  state.projectiles = [];
  state.effects = [];
  state.player.position = tileCenter({ x: 15, y: 22 });
  state.player.previousPosition = { ...state.player.position };
  return buildRenderManifest(state, {
    x: 15.5 * TILE_PIXELS,
    y: 20.5 * TILE_PIXELS,
    zoom: 0.42,
  });
}

describe("Embercross composition prerequisites", () => {
  it("accepts the current overview manifest without claiming visual quality", () => {
    const assessment = assessCityComposition(cityOverviewManifest());
    expect(assessment.violations, JSON.stringify(assessment.evidence)).toEqual(
      [],
    );
    expect(assessment.pass).toBe(true);
    expect(assessment.mandatoryVisualReview).toBe(true);
    expect(assessment.limitation).toContain("cannot approve beauty");
    expect(
      Object.fromEntries(
        Object.entries(assessment.evidence.roles).map(([role, evidence]) => [
          role,
          {
            declared: evidence.declaredCount,
            visible: evidence.visibleCount,
            diversity: evidence.distinctVisibleSpriteCount,
          },
        ]),
      ),
    ).toEqual({
      structures: { declared: 10, visible: 10, diversity: 10 },
      props: { declared: 15, visible: 15, diversity: 11 },
      decals: { declared: 9, visible: 9, diversity: 7 },
      actors: { declared: 5, visible: 5, diversity: 5 },
    });
    expect(assessment.evidence.visibleSecondarySceneryCount).toBe(30);
    expect(assessment.evidence.visibleSecondarySpriteDiversity).toBe(24);
  });

  it.each([
    {
      name: "secondary scenery removed",
      expected: "city:secondary-scenery-too-sparse",
      mutate(manifest: RenderManifestV1) {
        const primary = new Set([
          "building:embercross:market",
          "building:embercross:tavern",
          "building:embercross:infirmary",
          "gate:embercross:south",
        ]);
        manifest.sceneSprites = manifest.sceneSprites.map((sprite) =>
          sprite.objectId.includes(":embercross:") &&
          !primary.has(sprite.objectId)
            ? { ...sprite, visible: false }
            : sprite,
        );
      },
    },
    {
      name: "one prop cloned into repetitive clutter",
      expected: "city:duplicate-prop-concentration-too-high",
      mutate(manifest: RenderManifestV1) {
        const source = manifest.sceneSprites.find(
          ({ objectId, visible, layer }) =>
            visible && layer === "props" && objectId.includes(":embercross:"),
        )!;
        for (let index = 0; index < 24; index += 1) {
          const clone = structuredClone(source);
          clone.objectId = `prop:embercross:clutter-mutation-${index}`;
          clone.destinationRect.x = 40 + (index % 12) * 72;
          clone.destinationRect.y = 60 + Math.floor(index / 12) * 190;
          manifest.sceneSprites.push(clone);
        }
      },
    },
    {
      name: "focal actors overlapped",
      expected: "city:focal-actors-overlapped",
      mutate(manifest: RenderManifestV1) {
        const player = manifest.drawCalls.find(
          ({ entityId }) => entityId === "player",
        )!;
        const resident = manifest.drawCalls.find(({ entityId }) =>
          entityId.startsWith("npc:embercross:"),
        )!;
        resident.destinationRect = { ...player.destinationRect };
        resident.bounds = { ...player.bounds };
        resident.screenAnchor = { ...player.screenAnchor };
      },
    },
    {
      name: "player hidden under a structure",
      expected: "city:actor-covered-by-structure",
      mutate(manifest: RenderManifestV1) {
        const player = manifest.drawCalls.find(
          ({ entityId }) => entityId === "player",
        )!;
        const building = manifest.sceneSprites.find(
          ({ objectId }) => objectId === "building:embercross:market",
        )!;
        building.destinationRect = {
          x: player.destinationRect.x - 20,
          y: player.destinationRect.y - 20,
          width: player.destinationRect.width + 40,
          height: player.destinationRect.height + 40,
        };
      },
    },
    {
      name: "large empty ground field",
      expected: "city:large-empty-ground-band",
      mutate(manifest: RenderManifestV1) {
        for (const sprite of manifest.sceneSprites) {
          if (!sprite.objectId.includes(":embercross:")) continue;
          sprite.destinationRect.x = 20 + (sprite.destinationRect.x % 260);
          sprite.screenAnchor.x =
            sprite.destinationRect.x + sprite.destinationRect.width / 2;
        }
        for (const actor of manifest.drawCalls) {
          if (
            actor.entityId !== "player" &&
            !actor.entityId.startsWith("npc:embercross:")
          )
            continue;
          actor.destinationRect.x = 40 + (actor.destinationRect.x % 220);
          actor.bounds.x = actor.destinationRect.x;
          actor.screenAnchor.x =
            actor.destinationRect.x + actor.destinationRect.width / 2;
        }
      },
    },
  ])("rejects production-assessor mutation: $name", ({ expected, mutate }) => {
    const manifest = structuredClone(cityOverviewManifest());
    mutate(manifest);
    const assessment = assessCityComposition(manifest);
    expect(assessment.pass).toBe(false);
    expect(assessment.violations).toContain(expected);
  });

  it("uses projected rectangles rather than world-unit guesses", () => {
    const manifest = cityOverviewManifest();
    const assessment = assessCityComposition(manifest);
    const player = manifest.drawCalls.find(
      ({ entityId }) => entityId === "player",
    )!;
    expect(player.destinationRect.width).toBeCloseTo(118 * 0.42);
    expect(player.worldAnchor).toEqual({
      x: 15 * UNITS_PER_TILE + UNITS_PER_TILE / 2,
      y: 22 * UNITS_PER_TILE + UNITS_PER_TILE / 2,
    });
    expect(assessment.evidence.sceneryUnionOccupancyRatio).toBeGreaterThan(0);
    expect(assessment.evidence.horizontalCoverageRatio).toBeLessThanOrEqual(1);
    expect(assessment.evidence.verticalCoverageRatio).toBeLessThanOrEqual(1);
  });
});
