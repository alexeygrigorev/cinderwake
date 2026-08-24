import { describe, expect, it } from "vitest";
import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../../src/game/constants";
import {
  GROUND_DECAL_NAMES,
  PASSABLE_GROUND_DECAL_NAMES,
  buildSceneryLayout,
  openingRoomThreshold,
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { tileCenter } from "../../src/game/dungeon";
import { findStateNavigationRoute } from "../../src/game/navigation";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";

function openingCamera(state: ReturnType<typeof worldFromScenario>) {
  const targetX = (state.player.position.x / UNITS_PER_TILE) * TILE_PIXELS;
  const targetY = (state.player.position.y / UNITS_PER_TILE) * TILE_PIXELS;
  const mapWidth = state.map.width * TILE_PIXELS;
  const mapHeight = state.map.height * TILE_PIXELS;
  return {
    x:
      mapWidth <= VIEW_WIDTH
        ? mapWidth / 2
        : Math.max(
            VIEW_WIDTH / 2,
            Math.min(mapWidth - VIEW_WIDTH / 2, targetX),
          ),
    y:
      mapHeight <= VIEW_HEIGHT
        ? mapHeight / 2
        : Math.max(
            VIEW_HEIGHT / 2,
            Math.min(mapHeight - VIEW_HEIGHT / 2, targetY),
          ),
    zoom: 1,
  };
}

describe("generated opening encounter", () => {
  it("starts every sampled seed with three visible, reachable threats", () => {
    for (let index = 0; index < 80; index += 1) {
      const state = worldFromScenario(
        createRunScenario(`opening-encounter-${index}`, "vanguard"),
      );
      const collisions = sceneryCollisions(state.map);
      const openingGroup = state.monsters.slice(0, 3);

      expect(state.monsters, `monster count for seed ${index}`).toHaveLength(
        14,
      );
      expect(openingGroup.map(({ id }) => id)).toEqual([
        "monster:00",
        "monster:01",
        "monster:02",
      ]);
      expect(openingGroup.map(({ kind }) => kind)).toEqual([
        "stonekin",
        "ashfang",
        "hexer",
      ]);
      expect(
        new Set(
          state.monsters.map(({ position }) => `${position.x}:${position.y}`),
        ).size,
      ).toBe(14);

      for (const monster of state.monsters) {
        expect(
          collisions.every(
            (collision) =>
              !overlapsScenery(monster.position, monster.radius, collision),
          ),
          `${monster.id} overlaps scenery for seed ${index}`,
        ).toBe(true);
      }

      for (const monster of openingGroup) {
        const tile = {
          x: Math.floor(monster.position.x / UNITS_PER_TILE),
          y: Math.floor(monster.position.y / UNITS_PER_TILE),
        };
        const distance =
          Math.abs(tile.x - state.map.spawn.x) +
          Math.abs(tile.y - state.map.spawn.y);
        expect(distance).toBeGreaterThanOrEqual(2);
        expect(distance).toBeLessThanOrEqual(3);
        expect(Math.abs(tile.x - state.map.spawn.x)).toBeLessThanOrEqual(1);
      }

      const manifest = buildRenderManifest(state, openingCamera(state));
      const visibleOpeningIds = new Set(
        manifest.drawCalls
          .filter(({ type, visible }) => type === "monster" && visible)
          .map(({ entityId }) => entityId),
      );
      for (const monster of openingGroup)
        expect(
          visibleOpeningIds.has(monster.id),
          `${monster.id} offscreen for seed ${index}`,
        ).toBe(true);
      expect(
        [...visibleOpeningIds].sort(),
        `only the authored opening trio intersects the camera for seed ${index}`,
      ).toEqual(openingGroup.map(({ id }) => id));
    }
  });

  it("grounds generated rooms with deterministic passable sprite decals", () => {
    const first = worldFromScenario(
      createRunScenario("opening-decal-contract", "ranger"),
    );
    const second = worldFromScenario(
      createRunScenario("opening-decal-contract", "ranger"),
    );
    const layout = buildSceneryLayout(first.map);
    const decals = layout.filter(({ id }) => id.startsWith("decal:"));
    const repeatedDecals = buildSceneryLayout(second.map).filter(({ id }) =>
      id.startsWith("decal:"),
    );
    const expectedCount = 6 + Math.max(0, first.map.rooms.length - 1) * 3;

    expect(decals).toHaveLength(expectedCount);
    expect(decals).toEqual(repeatedDecals);
    const decalNames = new Set<string>(GROUND_DECAL_NAMES);
    expect(decals.every(({ name }) => decalNames.has(name))).toBe(true);
    const passableNames = new Set<string>(PASSABLE_GROUND_DECAL_NAMES);
    expect(decals.every(({ name }) => passableNames.has(name))).toBe(true);
    expect(passableNames.has("cracked-embers")).toBe(false);
    expect(
      decals.every(
        ({ collisionMode, collision }) =>
          collisionMode === "passable" && collision === null,
      ),
    ).toBe(true);

    const forge = layout.find(
      ({ kind, name }) => kind === "structure" && name === "forge",
    );
    expect(forge).toBeDefined();
    expect(decals[0]?.name).toBe("scorch-ring");
    expect(decals[0]?.worldAnchor).toEqual(forge?.worldAnchor);

    const manifest = buildRenderManifest(first, openingCamera(first));
    for (const decal of decals) {
      const sprite = manifest.sceneSprites.find(
        ({ objectId }) => objectId === decal.id,
      );
      expect(sprite, decal.id).toBeDefined();
      expect(sprite?.spriteId).toBe(`scenery:decal:${decal.name}`);
      expect(sprite?.layer).toBe("terrain");
      expect(sprite?.collision).toMatchObject({
        mode: "passable",
        halfWidth: 0,
        halfHeight: 0,
      });
    }
  });

  it("builds a visible, navigable opening threshold from authoritative room tiles", () => {
    for (let index = 0; index < 100; index += 1) {
      const state = worldFromScenario(
        createRunScenario(`opening-architecture-${index}`, "vanguard"),
      );
      const threshold = openingRoomThreshold(state.map);
      expect(threshold, `threshold for seed ${index}`).not.toBeNull();
      const layout = buildSceneryLayout(state.map);
      const marker = layout.find(({ id }) =>
        id.startsWith("architecture:opening:threshold:"),
      );
      const lanterns = layout.filter(({ id }) =>
        id.startsWith("architecture:opening:lantern:"),
      );
      expect(marker).toMatchObject({
        kind: "decal",
        name: "banner-scrap",
        collisionMode: "passable",
        collision: null,
      });
      expect(lanterns).toHaveLength(2);
      for (const lantern of lanterns) {
        expect(lantern.collisionMode).toBe("solid");
        expect(lantern.collision).not.toBeNull();
      }

      const target = tileCenter(threshold!.floorTiles[0]!);
      const route = findStateNavigationRoute(
        state,
        state.player.position,
        target,
        state.player.radius,
      );
      expect(route.length, `route for seed ${index}`).toBeGreaterThan(0);
      expect(route.at(-1), `route destination for seed ${index}`).toEqual(
        target,
      );

      const manifest = buildRenderManifest(state, openingCamera(state));
      const visibleBoundaries = manifest.sceneSprites.filter(
        ({ objectId, visible }) => objectId.startsWith("boundary:") && visible,
      );
      expect(
        visibleBoundaries.length,
        `boundary count for seed ${index}`,
      ).toBeGreaterThanOrEqual(12);
      for (const wall of visibleBoundaries)
        expect(
          state.map.tiles[wall.tile.y * state.map.width + wall.tile.x],
          `${wall.objectId} backed by blocked map tile for seed ${index}`,
        ).toBe(1);
      expect(
        manifest.sceneSprites.find(({ objectId }) => objectId === marker?.id)
          ?.visible,
        `threshold marker visible for seed ${index}`,
      ).toBe(true);
      expect(
        lanterns.every(
          (lantern) =>
            manifest.sceneSprites.find(
              ({ objectId }) => objectId === lantern.id,
            )?.visible,
        ),
        `threshold lanterns visible for seed ${index}`,
      ).toBe(true);
      expect(
        manifest.sceneSprites
          .filter(({ objectId }) =>
            /^(?:structure|prop|decal):[1-9]\d*:/.test(objectId),
          )
          .every(({ visible }) => !visible),
        `distant room dressing hidden while seed ${index} opens`,
      ).toBe(true);
    }
  });

  it("does not inject generated decoration into explicit motion fixtures", () => {
    const explicit = worldFromScenario({
      schemaVersion: 1,
      id: "explicit-floor-control",
      seed: "explicit-floor-control",
      classId: "arcanist",
      map: {
        mode: "explicit",
        rows: ["########", "#P.....#", "#......#", "#....E.#", "########"],
      },
    });
    expect(
      buildSceneryLayout(explicit.map).filter(({ kind }) => kind === "decal"),
    ).toEqual([]);
  });
});
