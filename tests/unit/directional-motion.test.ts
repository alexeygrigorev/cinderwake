import { describe, expect, it } from "vitest";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

const CAMERA = { x: 720, y: 420, zoom: 0.9 };

describe("input-to-glyph directional motion", () => {
  it.each([
    ["east", 1, 0, "x", 1],
    ["west", -1, 0, "x", -1],
    ["south", 0, 1, "y", 1],
    ["north", 0, -1, "y", -1],
  ] as const)(
    "%s input moves world and rendered glyph in the same direction",
    (facing, moveX, moveY, axis, sign) => {
      const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
      state.monsters = [];
      state.settings.ai = false;
      const initial = buildRenderManifest(state, CAMERA).drawCalls.find(
        ({ entityId }) => entityId === "player",
      )!;
      const initialPosition = { ...state.player.position };
      const frameIdentities = new Set<string>();

      for (let tick = 0; tick < 18; tick += 1) {
        stepGame(state, { ...EMPTY_INPUT, moveX, moveY });
        const player = buildRenderManifest(state, CAMERA).drawCalls.find(
          ({ entityId }) => entityId === "player",
        )!;
        frameIdentities.add(player.frameIdentity);
      }
      const moved = buildRenderManifest(state, CAMERA).drawCalls.find(
        ({ entityId }) => entityId === "player",
      )!;
      const worldDelta = state.player.position[axis] - initialPosition[axis];
      const screenDelta = moved.screenAnchor[axis] - initial.screenAnchor[axis];

      expect(Math.sign(worldDelta)).toBe(sign);
      expect(Math.sign(screenDelta)).toBe(sign);
      expect(moved.clip).toBe("walk");
      expect(moved.facingBucket).toBe(facing);
      expect(frameIdentities.size).toBeGreaterThanOrEqual(2);
    },
  );
});
