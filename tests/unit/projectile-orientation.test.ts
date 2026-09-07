import { describe, expect, it } from "vitest";
import { projectileRotation, SPRITE_CATALOG } from "../../src/render/sprites";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

describe("painted projectile orientation", () => {
  it("never reflects rotated projectile artwork for eastward travel", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    state.projectiles.push({
      id: "arrow-test",
      owner: "player",
      hostile: false,
      color: "#ffffff",
      pierce: 0,
      hitTargets: [],
      position: { ...state.player.position },
      previousPosition: { ...state.player.position },
      velocity: { x: 100, y: 0 },
      damage: 1,
      radius: 10,
      spawnedAtTick: 0,
      expiresAtTick: 30,
    });
    const call = buildRenderManifest(state, {
      x: 480,
      y: 270,
      zoom: 1,
    }).drawCalls.find(({ entityId }) => entityId === "arrow-test");
    expect(call).toMatchObject({
      flipX: false,
      spriteId: "projectile:friendly",
    });
  });
  for (const spriteId of ["projectile:friendly", "projectile:hostile"]) {
    for (const travel of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: -1 },
    ]) {
      it(`${spriteId} points its painted tip along ${JSON.stringify(travel)}`, () => {
        const source = SPRITE_CATALOG.sprites[spriteId]!.sourceDirection!;
        const angle = projectileRotation(spriteId, travel);
        const tip = {
          x: source.x * Math.cos(angle) - source.y * Math.sin(angle),
          y: source.x * Math.sin(angle) + source.y * Math.cos(angle),
        };
        expect(tip.x * travel.y - tip.y * travel.x).toBeCloseTo(0, 6);
        expect(tip.x * travel.x + tip.y * travel.y).toBeGreaterThan(0);
        // The old zero-origin transform must fail on the real authored cell.
        expect(Math.abs(Math.atan2(source.y, source.x))).toBeGreaterThan(1);
      });
    }
  }
});
