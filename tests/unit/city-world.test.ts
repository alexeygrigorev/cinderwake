import { describe, expect, it } from "vitest";
import { EMBERCROSS_CITY } from "../../src/game/city";
import {
  buildEmbercrossScenery,
  cityNpcWorldAnchor,
  createEmbercrossMap,
  isEmbercrossMap,
  nearbyEmbercrossNpcId,
  wildernessCityLandmarkAnchor,
  wildernessCityLandmarkTile,
} from "../../src/game/cityWorld";
import { TILE_PIXELS, UNITS_PER_TILE } from "../../src/game/constants";
import { generateDungeon, isFloor, tileCenter } from "../../src/game/dungeon";
import {
  buildSceneryLayout,
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
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

  it("derives a visible discovery cell on the guaranteed route before the gate", () => {
    for (let index = 0; index < 24; index += 1) {
      const map = generateDungeon(`city-landmark-route-${index}`);
      const landmark = wildernessCityLandmarkTile(map);
      expect(isFloor(map, landmark.x, landmark.y), `seed ${index}`).toBe(true);
      expect(landmark).not.toEqual(map.exit);
      expect(landmark).not.toEqual(map.spawn);
    }
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
        clip: "idle",
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
