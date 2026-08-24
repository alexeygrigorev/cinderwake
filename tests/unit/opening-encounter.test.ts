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
  openingNorthWallFeature,
  openingRoomThreshold,
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { tileCenter } from "../../src/game/dungeon";
import {
  findNavigationRoute,
  findStateNavigationRoute,
} from "../../src/game/navigation";
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

function destinationOverlapRatio(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );
  return (
    (width * height) /
    Math.min(first.width * first.height, second.width * second.height)
  );
}

describe("generated opening encounter", () => {
  it("starts every sampled seed with two readable, reachable threats", () => {
    for (let index = 0; index < 80; index += 1) {
      const state = worldFromScenario(
        createRunScenario(`opening-encounter-${index}`, "vanguard"),
      );
      const repeated = worldFromScenario(
        createRunScenario(`opening-encounter-${index}`, "vanguard"),
      );
      const collisions = sceneryCollisions(state.map);
      const openingGroup = state.monsters.slice(0, 2);

      expect(state.monsters, `monster count for seed ${index}`).toHaveLength(
        14,
      );
      expect(openingGroup.map(({ id }) => id)).toEqual([
        "monster:00",
        "monster:01",
      ]);
      expect(openingGroup.map(({ kind }) => kind)).toEqual([
        "stonekin",
        "ashfang",
      ]);
      expect(
        openingGroup.map(({ id, kind, position }) => ({ id, kind, position })),
        `repeatable opening pair for seed ${index}`,
      ).toEqual(
        repeated.monsters
          .slice(0, 2)
          .map(({ id, kind, position }) => ({ id, kind, position })),
      );
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
        expect(distance).toBeLessThanOrEqual(4);
        expect(Math.abs(tile.x - state.map.spawn.x)).toBeLessThanOrEqual(1);
        const route = findStateNavigationRoute(
          state,
          state.player.position,
          monster.position,
          state.player.radius,
        );
        expect(
          route.length,
          `${monster.id} route for seed ${index}`,
        ).toBeGreaterThan(0);
        expect(
          route.at(-1),
          `${monster.id} route destination for seed ${index}`,
        ).toEqual(monster.position);
      }

      const manifest = buildRenderManifest(state, openingCamera(state));
      const openingCalls = manifest.drawCalls.filter(
        ({ entityId }) =>
          entityId === "monster:00" || entityId === "monster:01",
      );
      const playerCall = manifest.drawCalls.find(
        ({ entityId }) => entityId === "player",
      )!;
      const compactProps = manifest.sceneSprites.filter(
        ({ objectId }) =>
          objectId === "prop:0:barricade-v2" ||
          objectId === "prop:0:raised-clutter-bench",
      );
      for (const monsterCall of openingCalls)
        expect(
          destinationOverlapRatio(
            playerCall.destinationRect,
            monsterCall.destinationRect,
          ),
          `${monsterCall.entityId} visually covers the player for seed ${index}`,
        ).toBeLessThanOrEqual(
          monsterCall.entityId === "monster:00" ? 0.25 : 0.1,
        );
      for (const monsterCall of openingCalls)
        for (const prop of compactProps)
          expect(
            destinationOverlapRatio(
              monsterCall.destinationRect,
              prop.destinationRect,
            ),
            `${monsterCall.entityId} visually overlaps ${prop.objectId} for seed ${index}`,
          ).toBeLessThanOrEqual(0.2);
      for (let first = 0; first < openingCalls.length; first += 1) {
        for (let second = first + 1; second < openingCalls.length; second += 1)
          expect(
            destinationOverlapRatio(
              openingCalls[first]!.destinationRect,
              openingCalls[second]!.destinationRect,
            ),
            `${openingCalls[first]!.entityId} and ${openingCalls[second]!.entityId} visually stack for seed ${index}`,
          ).toBeLessThanOrEqual(0.2);
      }
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
        `only the authored opening pair intersects the camera for seed ${index}`,
      ).toEqual(openingGroup.map(({ id }) => id));
    }
  });

  it("rejects the former same-row stonekin and ashfang placement", () => {
    const state = worldFromScenario(
      createRunScenario("opening-overlap-negative-control", "ranger"),
    );
    const [stonekin, ashfang] = state.monsters;
    const y = state.map.spawn.y + 1;
    stonekin!.position = tileCenter({ x: state.map.spawn.x - 1, y });
    stonekin!.previousPosition = { ...stonekin!.position };
    ashfang!.position = tileCenter({ x: state.map.spawn.x + 1, y });
    ashfang!.previousPosition = { ...ashfang!.position };

    const calls = buildRenderManifest(state, openingCamera(state)).drawCalls;
    const stonekinRect = calls.find(
      ({ entityId }) => entityId === stonekin!.id,
    )!.destinationRect;
    const ashfangRect = calls.find(
      ({ entityId }) => entityId === ashfang!.id,
    )!.destinationRect;

    expect(destinationOverlapRatio(stonekinRect, ashfangRect)).toBe(0.25);
    expect(destinationOverlapRatio(stonekinRect, ashfangRect)).toBeGreaterThan(
      0.2,
    );
  });

  it("detects an opening monster placed over the player silhouette", () => {
    const state = worldFromScenario(
      createRunScenario("opening-player-overlap-negative-control", "vanguard"),
    );
    const monster = state.monsters[1]!;
    monster.position = { ...state.player.position };
    monster.previousPosition = { ...state.player.position };

    const calls = buildRenderManifest(state, openingCamera(state)).drawCalls;
    const playerRect = calls.find(
      ({ entityId }) => entityId === "player",
    )!.destinationRect;
    const monsterRect = calls.find(
      ({ entityId }) => entityId === monster.id,
    )!.destinationRect;

    expect(destinationOverlapRatio(playerRect, monsterRect)).toBeGreaterThan(
      0.1,
    );
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

    const forge = layout.find(({ id }) => id === "structure:0:forge");
    expect(forge).toMatchObject({
      kind: "structure",
      name: "forge-workshop",
      collisionMode: "solid",
    });
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
      expect(lanterns.map(({ name }) => name)).toEqual([
        "lantern-a",
        "lantern-b",
      ]);
      for (const lantern of lanterns) {
        expect(lantern.collisionMode).toBe("solid");
        expect(lantern.collision).not.toBeNull();
      }
      const lanternLights = layout.filter(({ id }) =>
        id.startsWith("architecture:opening:lantern-light:"),
      );
      expect(lanternLights).toHaveLength(2);
      lanternLights.forEach((light, lightIndex) => {
        expect(light).toMatchObject({
          kind: "decal",
          name: "scorch-ring",
          collisionMode: "passable",
          collision: null,
          worldAnchor: lanterns[lightIndex]!.worldAnchor,
        });
      });

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
    expect(openingNorthWallFeature(explicit.map)).toBeNull();
    expect(
      buildSceneryLayout(explicit.map).filter(({ name }) =>
        [
          "forge-workshop",
          "lantern-a",
          "lantern-b",
          "barricade-v2",
          "raised-clutter-bench",
        ].includes(name),
      ),
    ).toEqual([]);
  });

  it("composes environment-kit v2 once in generated room zero without changing the real route", () => {
    let sawNorthWall = false;
    let sawNorthThreshold = false;
    for (let index = 0; index < 100; index += 1) {
      const state = worldFromScenario(
        createRunScenario(`environment-kit-topology-${index}`, "vanguard"),
      );
      const threshold = openingRoomThreshold(state.map)!;
      const layout = buildSceneryLayout(state.map);
      const kitRoles = layout.filter(({ name }) =>
        [
          "forge-workshop",
          "lantern-a",
          "lantern-b",
          "barricade-v2",
          "raised-clutter-bench",
        ].includes(name),
      );
      expect(
        kitRoles.map(({ id }) => id).sort(),
        `complete kit roles for seed ${index} (${threshold.side})`,
      ).toEqual([
        "architecture:opening:lantern:0",
        "architecture:opening:lantern:1",
        "prop:0:barricade-v2",
        "prop:0:raised-clutter-bench",
        "structure:0:forge",
      ]);
      expect(
        kitRoles.every(
          ({ collisionMode, collision }) =>
            collisionMode === "solid" && collision !== null,
        ),
      ).toBe(true);

      for (let first = 0; first < kitRoles.length; first += 1) {
        const firstCollision = kitRoles[first]!.collision!;
        for (let second = first + 1; second < kitRoles.length; second += 1) {
          const secondCollision = kitRoles[second]!.collision!;
          const normalizedX =
            (firstCollision.center.x - secondCollision.center.x) /
            (firstCollision.halfWidth + secondCollision.halfWidth);
          const normalizedY =
            (firstCollision.center.y - secondCollision.center.y) /
            (firstCollision.halfHeight + secondCollision.halfHeight);
          expect(
            normalizedX * normalizedX + normalizedY * normalizedY,
            `${kitRoles[first]!.id} overlaps ${kitRoles[second]!.id} for seed ${index} (${threshold.side}); first=${JSON.stringify(firstCollision)} second=${JSON.stringify(secondCollision)}`,
          ).toBeGreaterThanOrEqual(1);
        }
      }

      const target = tileCenter(threshold.floorTiles[0]!);
      expect(
        findStateNavigationRoute(
          state,
          state.player.position,
          target,
          state.player.radius,
        ).at(-1),
        `environment-kit threshold route for seed ${index}`,
      ).toEqual(target);

      const northWall = openingNorthWallFeature(state.map);
      if (threshold.side === "north") {
        sawNorthThreshold = true;
        expect(northWall).toBeNull();
      } else {
        sawNorthWall = true;
        expect(northWall).not.toBeNull();
        expect(northWall?.suppressedFacadeTiles).toHaveLength(3);
        for (const tile of northWall!.suppressedFacadeTiles)
          expect(state.map.tiles[tile.y * state.map.width + tile.x]).toBe(1);
      }
    }
    expect(sawNorthWall).toBe(true);
    expect(sawNorthThreshold).toBe(true);
  });

  it("rejects a north-wall feature when one central shell tile is opened", () => {
    let state = worldFromScenario(
      createRunScenario("environment-wall-negative-control", "vanguard"),
    );
    for (let suffix = 0; !openingNorthWallFeature(state.map); suffix += 1)
      state = worldFromScenario(
        createRunScenario(
          `environment-wall-negative-control-${suffix}`,
          "vanguard",
        ),
      );
    const broken = structuredClone(state.map);
    const feature = openingNorthWallFeature(broken)!;
    broken.tiles[feature.tile.y * broken.width + feature.tile.x] = 0;
    expect(openingNorthWallFeature(broken)).toBeNull();
  });

  it("rejects a solid negative control placed across the real threshold", () => {
    const state = worldFromScenario(
      createRunScenario("environment-threshold-blocker", "vanguard"),
    );
    const threshold = openingRoomThreshold(state.map)!;
    const target = tileCenter(threshold.floorTiles[0]!);
    const collisions = sceneryCollisions(state.map);
    expect(
      findNavigationRoute(
        state.map,
        collisions,
        state.player.position,
        target,
        state.player.radius,
      ).at(-1),
    ).toEqual(target);

    const blockedRoute = findNavigationRoute(
      state.map,
      [
        ...collisions,
        {
          shape: "ellipse",
          center: target,
          halfWidth: UNITS_PER_TILE / 2,
          halfHeight: UNITS_PER_TILE / 2,
        },
      ],
      state.player.position,
      target,
      state.player.radius,
    );
    expect(blockedRoute.at(-1)).not.toEqual(target);
  });
});
