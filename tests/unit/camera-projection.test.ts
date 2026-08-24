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

    expect(playerZoomed.destinationRect.width).toBe(
      Math.round(playerAtOne.destinationRect.width * 0.9),
    );
    expect(playerZoomed.destinationRect.height).toBe(
      Math.round(playerAtOne.destinationRect.height * 0.9),
    );
    expect(tileZoomed.destinationRect.width).toBe(
      Math.round(tileAtOne.destinationRect.width * 0.9),
    );
    expect(tileZoomed.destinationRect.height).toBe(
      Math.round(tileAtOne.destinationRect.height * 0.9),
    );
    expect(
      playerZoomed.destinationRect.width / playerZoomed.destinationRect.height,
    ).toBeCloseTo(
      playerAtOne.destinationRect.width / playerAtOne.destinationRect.height,
      8,
    );
  });
});
