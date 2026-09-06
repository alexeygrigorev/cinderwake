import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_ZOOM,
  CanvasRenderer,
  portraitCameraFrame,
} from "../../src/render/CanvasRenderer";
import { TILE_PIXELS, VIEW_HEIGHT, VIEW_WIDTH } from "../../src/game/constants";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

describe("portrait camera framing", () => {
  it("centers the arena player and follows before a nearby threat leaves the phone", () => {
    const canvas = {
      getContext: () => ({ imageSmoothingEnabled: true }),
      getBoundingClientRect: () => ({ width: (844 * 16) / 9, height: 844 }),
      parentElement: {
        getBoundingClientRect: () => ({ width: 390, height: 844 }),
      },
    } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(canvas);
    const state = worldFromScenario(BUILTIN_SCENARIOS["combat-loot"]);
    renderer.resetCamera(state);
    expect(renderer.camera.x).toBe(9.5 * TILE_PIXELS);
    state.player.position.x += 1024;
    const previousX = renderer.camera.x;
    renderer.advanceCamera(state, "smooth");
    expect(renderer.camera.x).toBeGreaterThan(previousX);
  });
  it.each([
    [390, 844],
    [320, 740],
    [430, 932],
  ])(
    "exposes nine world tiles across a %ipx cover-cropped phone",
    (width, height) => {
      const canvas = { width: (height * VIEW_WIDTH) / VIEW_HEIGHT, height };
      const frame = portraitCameraFrame(canvas, { width, height });
      expect(frame.width / frame.zoom / TILE_PIXELS).toBeCloseTo(9);
      const cssPixelsPerTile =
        (TILE_PIXELS * frame.zoom * canvas.width) / VIEW_WIDTH;
      expect(cssPixelsPerTile).toBeCloseTo(width / 9);
      expect(frame.height).toBe(VIEW_HEIGHT);
      // Three-tile threats fit on both sides of a centered player.
      expect(3 * cssPixelsPerTile).toBeLessThan(width / 2);
    },
  );

  it.each([
    [
      { width: 1600, height: 900 },
      { width: 1440, height: 900 },
    ],
    [
      { width: 844, height: 474.75 },
      { width: 844, height: 390 },
    ],
    [
      { width: 390, height: 219.375 },
      { width: 390, height: 844 },
    ],
    [
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    ],
  ])(
    "preserves normal framing without portrait side cropping",
    (canvas, viewport) => {
      expect(portraitCameraFrame(canvas, viewport)).toEqual({
        zoom: DEFAULT_CAMERA_ZOOM,
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
      });
    },
  );
});
