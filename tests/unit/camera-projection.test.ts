import { describe, expect, it } from "vitest";
import { TILE_PIXELS, UNITS_PER_TILE } from "../../src/game/constants";
import {
  buildRenderManifest,
  screenFor,
  worldForScreen,
} from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

describe("uniform camera zoom projection", () => {
  it("projects both axes by one zoom and round-trips screen input", () => {
    const camera = { x: 720, y: 420, zoom: 0.9 };
    const world = {
      x: (camera.x / TILE_PIXELS) * UNITS_PER_TILE + 3_200,
      y: (camera.y / TILE_PIXELS) * UNITS_PER_TILE - 1_700,
    };
    const screen = screenFor(world, camera);

    expect(screen.x - 480).toBeCloseTo(
      (3_200 / UNITS_PER_TILE) * TILE_PIXELS * 0.9,
      8,
    );
    expect(screen.y - 270).toBeCloseTo(
      (-1_700 / UNITS_PER_TILE) * TILE_PIXELS * 0.9,
      8,
    );
    const restored = worldForScreen(screen, camera);
    expect(Math.abs(restored.x - world.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - world.y)).toBeLessThanOrEqual(1);
  });

  it("scales positions and sprite rectangles together without aspect drift", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const center = { x: 720, y: 420 };
    const atOne = buildRenderManifest(state, { ...center, zoom: 1 });
    const zoomed = buildRenderManifest(state, { ...center, zoom: 0.9 });
    const playerAtOne = atOne.drawCalls.find(
      ({ entityId }) => entityId === "player",
    )!;
    const playerZoomed = zoomed.drawCalls.find(
      ({ entityId }) => entityId === "player",
    )!;
    const tileAtOne = atOne.sceneSprites.find(
      ({ objectId }) => objectId === "tile:12:10",
    )!;
    const tileZoomed = zoomed.sceneSprites.find(
      ({ objectId }) => objectId === "tile:12:10",
    )!;

    expect(playerZoomed.destinationRect.width).toBeCloseTo(
      playerAtOne.destinationRect.width * 0.9,
      8,
    );
    expect(playerZoomed.destinationRect.height).toBeCloseTo(
      playerAtOne.destinationRect.height * 0.9,
      8,
    );
    expect(tileZoomed.destinationRect.width).toBeCloseTo(
      tileAtOne.destinationRect.width * 0.9,
      8,
    );
    expect(tileZoomed.destinationRect.height).toBeCloseTo(
      tileAtOne.destinationRect.height * 0.9,
      8,
    );
    expect(
      playerZoomed.destinationRect.width / playerZoomed.destinationRect.height,
    ).toBeCloseTo(
      playerAtOne.destinationRect.width / playerAtOne.destinationRect.height,
      8,
    );
  });

  it("keeps zoomed terrain cells edge-contiguous without raster gaps", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    const manifest = buildRenderManifest(state, {
      x: 720,
      y: 420,
      zoom: 0.9,
    });
    const tiles = new Map(
      manifest.sceneSprites
        .filter(({ objectId }) => /^tile:\d+:\d+$/.test(objectId))
        .map((tile) => [tile.objectId, tile]),
    );

    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        const tile = tiles.get(`tile:${x}:${y}`)!;
        const east = tiles.get(`tile:${x + 1}:${y}`);
        const south = tiles.get(`tile:${x}:${y + 1}`);
        if (east)
          expect(
            east.destinationRect.x -
              (tile.destinationRect.x + tile.destinationRect.width),
            `${tile.objectId} east edge`,
          ).toBeCloseTo(0, 8);
        if (south)
          expect(
            south.destinationRect.y -
              (tile.destinationRect.y + tile.destinationRect.height),
            `${tile.objectId} south edge`,
          ).toBeCloseTo(0, 8);
      }
    }
  });
});
