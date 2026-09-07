import { expect, it } from "vitest";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

const cases = [
  { direction: "north", velocity: { x: 0, y: -220 }, hand: [196, 85] },
  { direction: "east", velocity: { x: 220, y: 0 }, hand: [174, 118] },
  { direction: "south", velocity: { x: 0, y: 220 }, hand: [179, 102] },
  { direction: "west", velocity: { x: -220, y: 0 }, hand: [82, 118] },
] as const;

for (const { direction, velocity, hand } of cases) {
  for (const zoom of [0.75, 1.5]) {
    it(`releases ${direction} arrows at the painted bow hand at zoom ${zoom}`, () => {
      const state = worldFromScenario(
        BUILTIN_SCENARIOS["temporal-friendly-projectile"]!,
      );
      state.player.classId = "ranger";
      state.player.facing = { ...velocity };
      const projectile = state.projectiles[0]!;
      projectile.hostile = false;
      projectile.velocity = { ...velocity };
      projectile.position = { ...state.player.position };
      projectile.previousPosition = { ...projectile.position };
      const camera = { x: 480, y: 360, zoom };
      const manifest = buildRenderManifest(state, camera);
      const player = manifest.drawCalls.find(({ type }) => type === "player")!;
      const arrow = manifest.drawCalls.find(
        ({ type }) => type === "projectile",
      )!;
      const expected = {
        x:
          player.destinationRect.x +
          (player.destinationRect.width * hand[0]) / 256,
        y:
          player.destinationRect.y +
          (player.destinationRect.height * hand[1]) / 256,
      };
      const releaseError = (rect: typeof arrow.destinationRect) =>
        Math.hypot(
          rect.x + rect.width / 2 - expected.x,
          rect.y + rect.height / 2 - expected.y,
        );
      expect(releaseError(arrow.destinationRect)).toBeLessThan(0.001);
      expect(arrow.worldAnchor).toEqual(projectile.position);
      // Mutation reproduces the rejected feet-level release, independently of
      // the socket metadata used by the renderer.
      expect(
        releaseError({
          ...arrow.destinationRect,
          x: player.screenAnchor.x - arrow.destinationRect.width / 2,
          y: player.screenAnchor.y - arrow.destinationRect.height / 2,
        }),
      ).toBeGreaterThan(30 * zoom);
      state.player.facing = { x: -velocity.x, y: -velocity.y };
      const turned = buildRenderManifest(state, camera).drawCalls.find(
        ({ type }) => type === "projectile",
      )!;
      expect(turned.destinationRect).toEqual(arrow.destinationRect);
    });
  }
}
