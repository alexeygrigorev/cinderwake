import { describe, expect, it } from "vitest";
import { monsterHealthFrameSize } from "../../src/render/CanvasRenderer";

describe("monster health frame camera scaling", () => {
  it.each([0.32, 0.4, 0.5776093083961622, 0.9, 1.25])(
    "preserves actor prominence at zoom %f",
    (zoom) => {
      for (const worldWidth of [112, 128, 128 * 1.16]) {
        const actorWidth = worldWidth * zoom;
        const frame = monsterHealthFrameSize(actorWidth, zoom);
        expect(frame.width / actorWidth).toBeLessThanOrEqual(0.37);
        expect(frame.height / actorWidth).toBeLessThanOrEqual(0.18);
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
      }
    },
  );
  it("preserves accepted default-camera sizes", () => {
    expect(monsterHealthFrameSize(112 * 0.9, 0.9)).toEqual({
      width: 36,
      height: 15,
    });
    expect(monsterHealthFrameSize(128 * 0.9, 0.9)).toEqual({
      width: 40,
      height: 17,
    });
    expect(monsterHealthFrameSize(128 * 1.16 * 0.9, 0.9)).toEqual({
      width: 47,
      height: 20,
    });
  });
  it("corrects the recorded portrait health bar that dominated Ashfang", () => {
    const zoom = 0.5776093083961622;
    const actorWidth = 73.93399147470876;
    expect(36 / actorWidth).toBeGreaterThan(0.37);
    expect(monsterHealthFrameSize(actorWidth, zoom)).toEqual({
      width: 26,
      height: 11,
    });
  });
});
