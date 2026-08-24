import { describe, expect, it } from "vitest";
import { EMBERCROSS_CITY } from "../../src/game/city";
import {
  buildEmbercrossScenery,
  cityNpcWorldAnchor,
  createEmbercrossMap,
  isEmbercrossMap,
  wildernessCityLandmarkAnchor,
  wildernessCityLandmarkTile,
} from "../../src/game/cityWorld";
import { generateDungeon, isFloor, tileCenter } from "../../src/game/dungeon";
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
    for (const building of EMBERCROSS_CITY.buildings) {
      const placement = scenery.find(({ id }) => id === building.id);
      expect(placement, building.id).toMatchObject({
        kind: "structure",
        collisionMode: "solid",
      });
      expect(placement?.collision).not.toBeNull();
    }
    const anchors = EMBERCROSS_CITY.npcs.map(({ id }) =>
      JSON.stringify(cityNpcWorldAnchor(id)),
    );
    expect(new Set(anchors).size).toBe(EMBERCROSS_CITY.npcs.length);
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
  });
});
