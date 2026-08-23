import { expect, test } from "@playwright/test";
import { overlapsScenery } from "../../src/game/sceneryLayout";
import type { ScenarioV1 } from "../../src/testkit/scenarios";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

test("touch navigation routes to a reachable point around the spawn forge and settles", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const target = await page.evaluate(() => {
    const forge = window
      .__GAME_TEST__!.renderManifest()
      .sceneSprites.find(({ objectId }) => objectId.startsWith("structure:0:"));
    if (!forge?.collision) throw new Error("Spawn structure is not solid");
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    return {
      client: {
        x: canvas.left + (forge.screenAnchor.x / 960) * canvas.width,
        // The requested point is on the floor behind the forge. Direct input
        // deadlocks at its base; a valid route must visibly travel around it.
        y: canvas.top + ((forge.screenAnchor.y - 60) / 540) * canvas.height,
      },
      collision: forge.collision,
    };
  });
  await page.touchscreen.tap(target.client.x, target.client.y);
  const evidence = await page.evaluate(() => {
    const start = window.__GAME_TEST__!.snapshot().player.position;
    const samples = [];
    for (let tick = 0; tick < 360; tick += 1) {
      const state = window.__GAME_TEST__!.step(1, {
        render: true,
        useBrowserInput: true,
      });
      samples.push({
        position: state.player.position,
        velocity: state.player.velocity,
        clip: state.player.animation.clip,
      });
    }
    return { start, samples };
  });
  const end = evidence.samples.at(-1)!;
  const finalWindow = evidence.samples.slice(-20);
  expect(
    Math.hypot(
      end.position.x - evidence.start.x,
      end.position.y - evidence.start.y,
    ),
  ).toBeGreaterThan(3 * 1024);
  expect(
    overlapsScenery(end.position, 320, {
      shape: "ellipse",
      center: target.collision.worldCenter,
      halfWidth: target.collision.halfWidth,
      halfHeight: target.collision.halfHeight,
    }),
  ).toBe(false);
  expect(
    finalWindow.every(
      ({ position }) =>
        position.x === end.position.x && position.y === end.position.y,
    ),
  ).toBe(true);
  expect(end.velocity).toEqual({ x: 0, y: 0 });
  expect(end.clip).toBe("idle");

  let longestWalkInPlace = 0;
  let currentWalkInPlace = 0;
  for (let index = 1; index < evidence.samples.length; index += 1) {
    const previous = evidence.samples[index - 1]!;
    const current = evidence.samples[index]!;
    if (
      current.clip === "walk" &&
      current.position.x === previous.position.x &&
      current.position.y === previous.position.y
    )
      currentWalkInPlace += 1;
    else currentWalkInPlace = 0;
    longestWalkInPlace = Math.max(longestWalkInPlace, currentWalkInPlace);
  }
  expect(longestWalkInPlace).toBeLessThanOrEqual(12);
});

test("joystick movement clears stale tap aim before Strike", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const east = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    const player = window
      .__GAME_TEST__!.renderManifest()
      .drawCalls.find(({ entityId }) => entityId === "player")!;
    return {
      x: canvas.left + ((player.screenAnchor.x + 70) / 960) * canvas.width,
      y: canvas.top + (player.screenAnchor.y / 540) * canvas.height,
    };
  });
  await page.touchscreen.tap(east.x, east.y);
  await page.evaluate(() =>
    window.__GAME_TEST__!.step(1, { useBrowserInput: true }),
  );

  const pad = page.locator(".move-pad");
  const box = await pad.boundingBox();
  if (!box) throw new Error("Movement pad has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height / 2);
  const moved = await page.evaluate(() =>
    window.__GAME_TEST__!.step(1, { useBrowserInput: true }),
  );
  await page.mouse.up();
  expect(moved.player.velocity.x).toBeLessThan(0);
  expect(moved.player.facing.x).toBeLessThan(0);

  await page.locator(".mobile-actions [data-action='attack']").tap();
  const attacked = await page.evaluate(() =>
    window.__GAME_TEST__!.step(1, { useBrowserInput: true }),
  );
  const attack = attacked.pendingAttacks.at(-1);
  expect(attack?.direction.x).toBeLessThan(0);
  expect(attacked.events.some(({ type }) => type === "attack_started")).toBe(
    true,
  );
});

test("monster pursuit routes around a forge instead of walking in place", async ({
  page,
}) => {
  const width = 30;
  const rows = Array.from({ length: 15 }, (_, y) => {
    if (y === 0 || y === 14) return "#".repeat(width);
    const row: string[] = Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 ? "#" : ".",
    );
    if (y === 7) row[15] = "P";
    if (y === 2) row[width - 3] = "E";
    return row.join("");
  });
  const scenario: ScenarioV1 = {
    schemaVersion: 1,
    id: "browser-navigation-monster-forge",
    seed: "browser-navigation-monster-forge",
    classId: "vanguard",
    map: { mode: "explicit", rows },
    monsters: [
      {
        id: "monster:pathfinder",
        kind: "ashfang",
        tile: [15, 2],
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: true },
  };
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const result = await page.evaluate((injected) => {
    window.__GAME_TEST__!.loadScenario(injected);
    const start = window.__GAME_TEST__!.snapshot().monsters[0]!.position;
    const positions = [];
    for (let tick = 0; tick < 600; tick += 1) {
      const state = window.__GAME_TEST__!.step(1);
      positions.push(state.monsters[0]!.position);
      if (
        state.eventLog.some(
          ({ type, sourceId }) =>
            type === "attack_started" && sourceId === "monster:pathfinder",
        )
      )
        break;
    }
    const state = window.__GAME_TEST__!.snapshot();
    return { start, positions, state };
  }, scenario);

  expect(result.positions.at(-1)).not.toEqual(result.start);
  expect(
    result.state.eventLog.some(
      ({ type, sourceId }) =>
        type === "attack_started" && sourceId === "monster:pathfinder",
    ),
  ).toBe(true);
  let longestStall = 0;
  let currentStall = 0;
  for (let index = 1; index < result.positions.length; index += 1) {
    if (
      result.positions[index]!.x === result.positions[index - 1]!.x &&
      result.positions[index]!.y === result.positions[index - 1]!.y
    )
      currentStall += 1;
    else currentStall = 0;
    longestStall = Math.max(longestStall, currentStall);
  }
  expect(longestStall).toBeLessThanOrEqual(12);
});
