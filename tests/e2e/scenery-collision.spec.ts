import { expect, test } from "@playwright/test";
import {
  buildSceneryLayout,
  overlapsScenery,
} from "../../src/game/sceneryLayout";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

test("real keyboard movement stops at the manifested building footprint and slides beside it", async ({
  page,
}) => {
  const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
  const building = buildSceneryLayout(state.map).find(
    ({ kind, collision }) => kind === "structure" && collision,
  )!;
  const collision = building.collision!;
  state.player.position = {
    x: collision.center.x,
    y: collision.center.y + collision.halfHeight + state.player.radius + 16,
  };
  state.player.previousPosition = { ...state.player.position };

  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const manifested = await page.evaluate(
    ({ injectedState, objectId }) => {
      window.__GAME_TEST__!.loadState(injectedState);
      return window
        .__GAME_TEST__!.renderManifest()
        .sceneSprites.find((sprite) => sprite.objectId === objectId);
    },
    { injectedState: state, objectId: building.id },
  );
  expect(manifested?.collision).toEqual({
    mode: "solid",
    shape: "ellipse",
    worldCenter: collision.center,
    halfWidth: collision.halfWidth,
    halfHeight: collision.halfHeight,
  });

  await page.keyboard.down("w");
  const approach = await page.evaluate(() => {
    const points = [];
    for (let tick = 0; tick < 60; tick += 1) {
      window.__GAME_TEST__!.step(1, {
        render: true,
        useBrowserInput: true,
      });
      points.push(window.__GAME_TEST__!.snapshot().player.position);
    }
    return points;
  });
  await page.keyboard.up("w");
  expect(
    approach.every(
      (point) => !overlapsScenery(point, state.player.radius, collision),
    ),
  ).toBe(true);
  const blocked = approach.at(-1)!;
  expect(blocked.y).toBeGreaterThan(collision.center.y);

  await page.keyboard.down("d");
  const slid = await page.evaluate(() => {
    window.__GAME_TEST__!.step(10, {
      render: true,
      useBrowserInput: true,
    });
    return window.__GAME_TEST__!.snapshot().player.position;
  });
  await page.keyboard.up("d");
  expect(slid.x).toBeGreaterThan(blocked.x + state.player.moveSpeed * 8);
  expect(overlapsScenery(slid, state.player.radius, collision)).toBe(false);
});
