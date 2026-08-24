import { describe, expect, it } from "vitest";
import { EMBERCROSS_CITY } from "../../src/game/city";
import {
  buildEmbercrossScenery,
  CITY_NPC_ACTOR_GEOMETRY,
  CITY_DISCOVERY_INTERACTION_RADIUS,
  cityNpcWorldAnchor,
  createEmbercrossMap,
  isEmbercrossMap,
  nearbyEmbercrossNpcId,
  wildernessCityLandmarkAnchor,
  wildernessCityLandmarkTile,
} from "../../src/game/cityWorld";
import { TILE_PIXELS, UNITS_PER_TILE } from "../../src/game/constants";
import { generateDungeon, isFloor, tileCenter } from "../../src/game/dungeon";
import { findStateNavigationRoute } from "../../src/game/navigation";
import {
  buildSceneryLayout,
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";

describe("deterministic Embercross world", () => {
  it("builds a stable safe map with a three-cell south gate", () => {
    const first = createEmbercrossMap();
    const second = createEmbercrossMap();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(isEmbercrossMap(first)).toBe(true);
    expect(isFloor(first, first.spawn.x, first.spawn.y)).toBe(true);
    expect(isFloor(first, first.exit.x, first.exit.y)).toBe(true);
    for (let x = 14; x <= 16; x += 1)
      expect(isFloor(first, x, first.height - 1)).toBe(true);
  });

  it("places every service building and resident on stable distinct anchors", () => {
    const scenery = buildEmbercrossScenery();
    const expectedBuildingSprites = new Map([
      ["building:embercross:market", "embercross-market"],
      ["building:embercross:tavern", "embercross-tavern"],
      ["building:embercross:infirmary", "embercross-infirmary"],
    ]);
    for (const building of EMBERCROSS_CITY.buildings) {
      const placement = scenery.find(({ id }) => id === building.id);
      expect(placement, building.id).toMatchObject({
        kind: "structure",
        collisionMode: "solid",
        name: expectedBuildingSprites.get(building.id),
      });
      expect(placement?.collision).not.toBeNull();
    }
    const anchors = EMBERCROSS_CITY.npcs.map(({ id }) =>
      JSON.stringify(cityNpcWorldAnchor(id)),
    );
    expect(new Set(anchors).size).toBe(EMBERCROSS_CITY.npcs.length);
  });

  it("binds the denser service districts to exact sprite and footprint roles", () => {
    const placements = new Map(
      buildEmbercrossScenery().map((placement) => [placement.id, placement]),
    );
    const expected = [
      {
        id: "building:embercross:smithy",
        kind: "structure",
        name: "forge-workshop",
        tile: { x: 11, y: 20 },
        collision: { halfWidth: 856, halfHeight: 320 },
      },
      {
        id: "building:embercross:north-rowhouse",
        kind: "structure",
        name: "ruined-house",
        tile: { x: 13, y: 9 },
      },
      {
        id: "building:embercross:chapel",
        kind: "structure",
        name: "chapel",
        tile: { x: 6, y: 13 },
        collision: { halfWidth: 1520, halfHeight: 620 },
      },
      {
        id: "building:embercross:watchtower",
        kind: "structure",
        name: "watchtower",
        tile: { x: 28, y: 12 },
        collision: { halfWidth: 1430, halfHeight: 620 },
      },
      {
        id: "prop:embercross:smithy-weapon-rack",
        kind: "prop",
        name: "weapon-rack",
        tile: { x: 9, y: 22 },
      },
      {
        id: "prop:embercross:smithy-brazier",
        kind: "prop",
        name: "ember-brazier",
        tile: { x: 12, y: 23 },
      },
      {
        id: "prop:embercross:square-bench",
        kind: "prop",
        name: "raised-clutter-bench",
        tile: { x: 18, y: 23 },
      },
      {
        id: "decal:embercross:square-scorch",
        kind: "decal",
        name: "scorch-ring",
        tile: { x: 12, y: 23 },
      },
    ];
    for (const contract of expected)
      expect(placements.get(contract.id), contract.id).toMatchObject(contract);
  });

  it("keeps both gate piers solid while its visible center stays walkable", () => {
    const map = createEmbercrossMap();
    const gate = buildSceneryLayout(map).find(
      ({ id }) => id === "gate:embercross:south",
    )!;
    expect(gate).toMatchObject({
      name: "embercross-city-gate",
      collisionMode: "solid",
      collisionParts: [expect.objectContaining({ shape: "ellipse" })],
    });
    const collisions = sceneryCollisions(map);
    const passage = { x: gate.worldAnchor.x, y: gate.worldAnchor.y - 650 };
    const leftPier = {
      x: gate.worldAnchor.x - 1_750,
      y: gate.worldAnchor.y - 650,
    };
    const rightPier = {
      x: gate.worldAnchor.x + 1_750,
      y: gate.worldAnchor.y - 650,
    };
    expect(
      collisions.some((collision) => overlapsScenery(passage, 300, collision)),
    ).toBe(false);
    expect(
      collisions.some((collision) => overlapsScenery(leftPier, 300, collision)),
    ).toBe(true);
    expect(
      collisions.some((collision) =>
        overlapsScenery(rightPier, 300, collision),
      ),
    ).toBe(true);
  });

  it("derives the nearest resident only inside its configured interaction radius", () => {
    const mara = cityNpcWorldAnchor("npc:embercross:mara");
    const radius = EMBERCROSS_CITY.npcs.find(
      ({ id }) => id === "npc:embercross:mara",
    )!.affordance.interactionRadiusUnits;
    expect(nearbyEmbercrossNpcId(mara)).toBe("npc:embercross:mara");
    expect(
      nearbyEmbercrossNpcId({ x: mara.x + radius + 1, y: mara.y }),
    ).toBeNull();
  });

  it("keeps a collision-aware route from the gate to every service district", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["temporal-city-entry"]!);
    stepGame(state, EMPTY_INPUT);
    expect(state.city.locationPhase).toBe("inside");
    const spawn = { ...state.player.position };
    const destinations = [
      ...EMBERCROSS_CITY.npcs.map(({ id }) => ({
        id,
        point: cityNpcWorldAnchor(id),
      })),
      { id: "city-square-east", point: tileCenter({ x: 17, y: 20 }) },
      { id: "south-gate", point: tileCenter(state.map.exit) },
    ];

    for (const destination of destinations) {
      const outward = findStateNavigationRoute(
        state,
        spawn,
        destination.point,
        state.player.radius,
      );
      expect(outward.length, `${destination.id} outward route`).toBeGreaterThan(
        0,
      );
      expect(outward.at(-1), `${destination.id} outward target`).toEqual(
        destination.point,
      );
      const returning = findStateNavigationRoute(
        state,
        destination.point,
        spawn,
        state.player.radius,
      );
      expect(
        returning.length,
        `${destination.id} return route`,
      ).toBeGreaterThan(0);
      expect(returning.at(-1), `${destination.id} return target`).toEqual(
        spawn,
      );
    }
  });

  it("derives a visible discovery cell on the guaranteed route before the gate", () => {
    for (let index = 0; index < 24; index += 1) {
      const map = generateDungeon(`city-landmark-route-${index}`);
      const landmark = wildernessCityLandmarkTile(map);
      expect(isFloor(map, landmark.x, landmark.y), `seed ${index}`).toBe(true);
      expect(landmark).not.toEqual(map.exit);
      expect(landmark).not.toEqual(map.spawn);
    }
  });

  it("discovers the city from the click route's nearest safe sign approach", () => {
    const state = worldFromScenario(
      BUILTIN_SCENARIOS["production-city-route"]!,
    );
    const landmark = wildernessCityLandmarkAnchor(state.map);
    const route = findStateNavigationRoute(
      state,
      state.player.position,
      landmark,
      state.player.radius,
    );
    const approach = route.at(-1)!;
    const distance = Math.hypot(
      landmark.x - approach.x,
      landmark.y - approach.y,
    );
    expect(distance).toBeLessThanOrEqual(CITY_DISCOVERY_INTERACTION_RADIUS);

    state.player.position = { ...approach };
    state.player.previousPosition = { ...approach };
    stepGame(state, EMPTY_INPUT);

    expect(state.city.locationPhase).toBe("discovered");
  });

  it("requires discovery before the gate and enters the city without ending the run", () => {
    const state = worldFromScenario(
      createRunScenario("city-route-transition", "vanguard"),
    );
    state.monsters = [];
    state.exitUnlocked = true;
    const wildernessDigest = state.map.digest;
    const gate = tileCenter(state.map.exit);

    state.player.position = { ...gate };
    state.player.previousPosition = { ...gate };
    stepGame(state, EMPTY_INPUT);
    expect(state.city.locationPhase).toBe("undiscovered");
    expect(state.map.digest).toBe(wildernessDigest);
    expect(state.phase).toBe("playing");

    const landmark = wildernessCityLandmarkAnchor(state.map);
    state.player.position = { x: landmark.x + 600, y: landmark.y };
    state.player.previousPosition = { ...state.player.position };
    stepGame(state, EMPTY_INPUT);
    expect(state.city.locationPhase).toBe("discovered");
    expect(state.eventLog.some(({ type }) => type === "city_discovered")).toBe(
      true,
    );

    state.player.position = { ...gate };
    state.player.previousPosition = { ...gate };
    stepGame(state, EMPTY_INPUT);
    expect(state.city.locationPhase).toBe("inside");
    expect(isEmbercrossMap(state.map)).toBe(true);
    expect(state.player.position).toEqual(tileCenter(state.map.spawn));
    expect(state.phase).toBe("playing");
    expect(state.eventLog.some(({ type }) => type === "run_won")).toBe(false);
    expect(state.eventLog.some(({ type }) => type === "city_entered")).toBe(
      true,
    );

    const manifest = buildRenderManifest(state, {
      x: (state.player.position.x / 1024) * 48,
      y: (state.player.position.y / 1024) * 48,
      zoom: 0.9,
    });
    for (const building of EMBERCROSS_CITY.buildings)
      expect(
        manifest.sceneSprites.find(({ objectId }) => objectId === building.id),
        building.id,
      ).toMatchObject({ renderMode: "sprite", collision: { mode: "solid" } });
    for (const npc of EMBERCROSS_CITY.npcs)
      expect(
        manifest.drawCalls.find(({ entityId }) => entityId === npc.id),
        npc.id,
      ).toMatchObject({
        type: "npc",
        renderMode: "sprite",
        geometryId: CITY_NPC_ACTOR_GEOMETRY[npc.id],
        spriteId: CITY_NPC_ACTOR_GEOMETRY[npc.id],
        assetId: "atlas:embercross-residents-idle-v1",
        clip: "resident-idle",
        frameCount: 4,
        facingBucket: "south",
      });

    const cityPlacements = buildSceneryLayout(state.map);
    for (const placement of cityPlacements) {
      const scene = manifest.sceneSprites.find(
        ({ objectId }) => objectId === placement.id,
      )!;
      expect(scene.spriteId, placement.id).toBe(
        `scenery:${placement.kind}:${placement.name}`,
      );
      const footprints = [
        ...(placement.collision ? [placement.collision] : []),
        ...(placement.collisionParts ?? []),
      ];
      const projectedUnit = (TILE_PIXELS / UNITS_PER_TILE) * 0.9;
      for (const footprint of footprints) {
        const centerX =
          scene.screenAnchor.x +
          (footprint.center.x - placement.worldAnchor.x) * projectedUnit;
        const centerY =
          scene.screenAnchor.y +
          (footprint.center.y - placement.worldAnchor.y) * projectedUnit;
        expect(
          centerX - footprint.halfWidth * projectedUnit,
          `${placement.id} collision left`,
        ).toBeGreaterThanOrEqual(scene.destinationRect.x - 0.51);
        expect(
          centerX + footprint.halfWidth * projectedUnit,
          `${placement.id} collision right`,
        ).toBeLessThanOrEqual(
          scene.destinationRect.x + scene.destinationRect.width + 0.51,
        );
        expect(
          centerY - footprint.halfHeight * projectedUnit,
          `${placement.id} collision top`,
        ).toBeGreaterThanOrEqual(scene.destinationRect.y - 0.51);
        expect(
          centerY + footprint.halfHeight * projectedUnit,
          `${placement.id} collision bottom`,
        ).toBeLessThanOrEqual(
          scene.destinationRect.y + scene.destinationRect.height + 0.51,
        );
      }
    }
    const gateScene = manifest.sceneSprites.find(
      ({ objectId }) => objectId === "gate:embercross:south",
    );
    expect(gateScene?.collisionParts).toHaveLength(1);
    expect(
      manifest.sceneSprites.some(
        ({ objectId }) => objectId === "exit:rift-gate",
      ),
    ).toBe(false);
  });
});
