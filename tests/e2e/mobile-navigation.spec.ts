import { expect, test } from "@playwright/test";
import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../../src/game/constants";
import { tileCenter } from "../../src/game/dungeon";
import {
  findStateNavigationRoute,
  navigationPointWalkable,
} from "../../src/game/navigation";
import {
  buildSceneryLayout,
  openingRoomThreshold,
  overlapsScenery,
  sceneryCollisions,
  type SceneryCollisionFootprint,
} from "../../src/game/sceneryLayout";
import {
  createRunScenario,
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

function generatedOpeningState(
  seedPrefix: string,
  acceptSide: (
    side: NonNullable<ReturnType<typeof openingRoomThreshold>>["side"],
  ) => boolean = () => true,
) {
  for (let index = 0; index < 100; index += 1) {
    const state = worldFromScenario(
      createRunScenario(`${seedPrefix}-${index}`, "vanguard"),
    );
    const threshold = openingRoomThreshold(state.map);
    if (threshold && acceptSide(threshold.side)) return state;
  }
  throw new Error("No matching generated opening seed found");
}

function segmentHitsEllipse(
  from: { x: number; y: number },
  to: { x: number; y: number },
  collision: SceneryCollisionFootprint,
  radius: number,
): boolean {
  const horizontalRadius = collision.halfWidth + radius;
  const verticalRadius = collision.halfHeight + radius;
  const startX = (from.x - collision.center.x) / horizontalRadius;
  const startY = (from.y - collision.center.y) / verticalRadius;
  const deltaX = (to.x - from.x) / horizontalRadius;
  const deltaY = (to.y - from.y) / verticalRadius;
  const a = deltaX * deltaX + deltaY * deltaY;
  const b = 2 * (startX * deltaX + startY * deltaY);
  const c = startX * startX + startY * startY - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || a < Number.EPSILON) return c <= 0;
  const enter = (-b - Math.sqrt(discriminant)) / (2 * a);
  return enter >= 0 && enter <= 1;
}

test("touch navigation routes around the compact v2 workshop and settles", async ({
  page,
}) => {
  const state = generatedOpeningState(
    "mobile-workshop-route",
    (side) => side !== "north",
  );
  // Isolate touch pathfinding from combat reactions. Monster pursuit has its
  // own browser test below; this contract must end in idle because navigation
  // settled, not fail intermittently when a generated enemy lands a hit.
  state.monsters = [];
  state.pendingAttacks = [];
  state.settings.ai = false;
  const layout = buildSceneryLayout(state.map);
  const collisions = sceneryCollisions(state.map);
  const workshopIds = new Set([
    "structure:0:forge",
    "prop:0:barricade-v2",
    "prop:0:raised-clutter-bench",
  ]);
  const workshop = layout.flatMap((placement) =>
    workshopIds.has(placement.id) && placement.collision
      ? [{ id: placement.id, collision: placement.collision }]
      : [],
  );
  expect(workshop.map(({ id }) => id).sort()).toEqual([...workshopIds].sort());
  const candidateTargets: Array<{
    world: { x: number; y: number };
    routeLength: number;
    blockedObjectIds: string[];
  }> = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      if (state.map.tiles[y * state.map.width + x] !== 0) continue;
      const world = tileCenter({ x, y });
      if (
        Math.hypot(
          world.x - state.player.position.x,
          world.y - state.player.position.y,
        ) <=
          3 * UNITS_PER_TILE ||
        !navigationPointWalkable(
          state.map,
          collisions,
          world,
          state.player.radius,
        )
      )
        continue;
      const blockedObjectIds = workshop
        .filter(({ collision }) =>
          segmentHitsEllipse(
            state.player.position,
            world,
            collision,
            state.player.radius,
          ),
        )
        .map(({ id }) => id);
      if (blockedObjectIds.length === 0) continue;
      const route = findStateNavigationRoute(
        state,
        state.player.position,
        world,
        state.player.radius,
      );
      if (route.at(-1)?.x === world.x && route.at(-1)?.y === world.y)
        candidateTargets.push({
          world,
          routeLength: route.length,
          blockedObjectIds,
        });
    }
  }
  candidateTargets.sort(
    (first, second) =>
      first.routeLength - second.routeLength ||
      first.world.y - second.world.y ||
      first.world.x - second.world.x,
  );
  expect(candidateTargets.length).toBeGreaterThan(0);
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const target = await page.evaluate(
    ({ injectedState, candidates, geometry }) => {
      window.__GAME_TEST__!.loadState(injectedState);
      const manifest = window.__GAME_TEST__!.renderManifest();
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      const controlsTop = document
        .querySelector(".mobile-controls")!
        .getBoundingClientRect().top;
      const projected = candidates.map(
        ({ world, routeLength, blockedObjectIds }) => {
          const screen = {
            x:
              geometry.viewWidth / 2 +
              ((world.x / geometry.unitsPerTile) * geometry.tilePixels -
                manifest.camera.x) *
                manifest.camera.zoom,
            y:
              geometry.viewHeight / 2 +
              ((world.y / geometry.unitsPerTile) * geometry.tilePixels -
                manifest.camera.y) *
                manifest.camera.zoom,
          };
          return {
            world,
            routeLength,
            blockedObjectIds,
            client: {
              x: canvas.left + (screen.x / geometry.viewWidth) * canvas.width,
              y: canvas.top + (screen.y / geometry.viewHeight) * canvas.height,
            },
          };
        },
      );
      const chosen = projected.find(
        ({ client }) =>
          client.x >= 24 &&
          client.x <= innerWidth - 24 &&
          client.y >= 48 &&
          client.y <= controlsTop - 24,
      );
      if (!chosen)
        throw new Error("No routed workshop-crossing target is tappable");
      return {
        ...chosen,
        client: {
          x: chosen.client.x,
          y: chosen.client.y,
        },
      };
    },
    {
      injectedState: state,
      candidates: candidateTargets,
      geometry: {
        unitsPerTile: UNITS_PER_TILE,
        tilePixels: TILE_PIXELS,
        viewWidth: VIEW_WIDTH,
        viewHeight: VIEW_HEIGHT,
      },
    },
  );
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
    Math.hypot(
      end.position.x - target.world.x,
      end.position.y - target.world.y,
    ),
  ).toBeLessThan(UNITS_PER_TILE);
  expect(
    collisions.every(
      (collision) =>
        !overlapsScenery(end.position, state.player.radius, collision),
    ),
  ).toBe(true);
  expect(target.blockedObjectIds.length).toBeGreaterThan(0);
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

test("mobile joystick reaches the real opening threshold without entering v2 scenery", async ({
  page,
}) => {
  const state = generatedOpeningState("mobile-threshold-route");
  const threshold = openingRoomThreshold(state.map)!;
  const target = tileCenter(threshold.floorTiles[0]!);
  const collisions = buildSceneryLayout(state.map).flatMap(({ collision }) =>
    collision ? [collision] : [],
  );
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  await page.evaluate((injectedState) => {
    window.__GAME_TEST__!.loadState(injectedState);
  }, state);
  const pad = page.locator(".move-pad");
  const box = await pad.boundingBox();
  if (!box) throw new Error("Movement pad has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const controlTarget =
    threshold.side === "north"
      ? { x: 0.5, y: 0.08 }
      : threshold.side === "east"
        ? { x: 0.92, y: 0.5 }
        : threshold.side === "south"
          ? { x: 0.5, y: 0.92 }
          : { x: 0.08, y: 0.5 };
  await page.mouse.move(
    box.x + box.width * controlTarget.x,
    box.y + box.height * controlTarget.y,
  );
  const movementTicks = Math.ceil(
    Math.hypot(
      target.x - state.player.position.x,
      target.y - state.player.position.y,
    ) / state.player.moveSpeed,
  );
  const samples = await page.evaluate((ticks) => {
    const values = [];
    for (let tick = 0; tick < ticks; tick += 1) {
      const current = window.__GAME_TEST__!.step(1, {
        render: true,
        useBrowserInput: true,
      });
      values.push(current.player.position);
    }
    return values;
  }, movementTicks);
  await page.mouse.up();
  await page.evaluate(() =>
    window.__GAME_TEST__!.step(20, {
      render: true,
      useBrowserInput: true,
    }),
  );
  const end = samples.at(-1)!;
  expect(Math.hypot(end.x - target.x, end.y - target.y)).toBeLessThan(
    state.player.moveSpeed + 2,
  );
  expect(
    samples.every((position) =>
      collisions.every(
        (collision) =>
          !overlapsScenery(position, state.player.radius, collision),
      ),
    ),
  ).toBe(true);
  const settled = await page.evaluate(
    () => window.__GAME_TEST__!.snapshot().player,
  );
  expect(settled.velocity).toEqual({ x: 0, y: 0 });
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
