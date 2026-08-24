import {
  expect,
  test,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  wildernessCityLandmarkAnchor,
  isEmbercrossMap,
} from "../../src/game/cityWorld";
import { tileCenter } from "../../src/game/dungeon";
import { findStateNavigationRoute } from "../../src/game/navigation";
import { screenFor } from "../../src/render/manifest";
import type { GameState, Vec2 } from "../../src/game/types";

interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProductionInputGeometry {
  canvas: DeviceRect;
  controls: DeviceRect;
  movePad: DeviceRect;
}

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

async function attachObserverFrame(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const dataUrl = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.captureFrame(),
  );
  await testInfo.attach(`${name}.png`, {
    body: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
    contentType: "image/png",
  });
}

async function observerState(page: Page): Promise<GameState> {
  return page.evaluate(() => window.__GAME_OBSERVE__!.snapshot());
}

async function productionInputGeometry(
  page: Page,
): Promise<ProductionInputGeometry> {
  const [canvas, controls, movePad] = await Promise.all([
    page.locator("canvas").boundingBox(),
    page.locator(".mobile-controls").boundingBox(),
    page.locator(".move-pad").boundingBox(),
  ]);
  if (!canvas) throw new Error("Production canvas has no device bounds");
  if (!controls) throw new Error("Production controls have no device bounds");
  if (!movePad) throw new Error("Production move pad has no device bounds");
  return { canvas, controls, movePad };
}

async function tapWorldPoint(
  page: Page,
  point: Vec2,
  geometry: ProductionInputGeometry,
): Promise<boolean> {
  const manifest = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.renderManifest(),
  );
  const projected = screenFor(point, manifest.camera);
  const { canvas, controls } = geometry;
  const projectedDevicePoint = {
    x: canvas.x + (projected.x / manifest.viewport.width) * canvas.width,
    y: canvas.y + (projected.y / manifest.viewport.height) * canvas.height,
  };
  const visible =
    projectedDevicePoint.x >= 8 &&
    projectedDevicePoint.x <= 382 &&
    projectedDevicePoint.y >= 56 &&
    projectedDevicePoint.y <= controls.y - 8;
  if (!visible) return false;
  await page.touchscreen.tap(projectedDevicePoint.x, projectedDevicePoint.y);
  return true;
}

async function dragProductionJoystick(
  page: Page,
  session: CDPSession,
  direction: Vec2,
  geometry: ProductionInputGeometry,
): Promise<void> {
  const bounds = geometry.movePad;
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const length = Math.max(1, Math.hypot(direction.x, direction.y));
  const radius = Math.min(bounds.width, bounds.height) * 0.3;
  const target = {
    x: center.x + (direction.x / length) * radius,
    y: center.y + (direction.y / length) * radius,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...center, id: 7, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 7, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForTimeout(220);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function driveProductionRoute(
  page: Page,
  session: CDPSession,
  geometry: ProductionInputGeometry,
  target: Vec2,
  complete: (state: GameState) => boolean,
): Promise<GameState> {
  const history: Array<{
    attempt: number;
    position: Vec2;
    distance: number;
    routeLength: number;
    input?: "tap" | "joystick";
  }> = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const before = await observerState(page);
    if (complete(before)) return before;
    const route = findStateNavigationRoute(
      before,
      before.player.position,
      target,
      before.player.radius,
    );
    if (route.length === 0)
      throw new Error(
        `No production navigation route: ${JSON.stringify({
          attempt,
          phase: before.city.locationPhase,
          player: before.player.position,
          target,
          distance: Math.round(
            Math.hypot(
              target.x - before.player.position.x,
              target.y - before.player.position.y,
            ),
          ),
          playerTile: {
            x: Math.floor(before.player.position.x / 1024),
            y: Math.floor(before.player.position.y / 1024),
          },
          exit: before.map.exit,
        })}`,
      );
    const evidence = {
      attempt,
      position: { ...before.player.position },
      distance: Math.round(
        Math.hypot(
          target.x - before.player.position.x,
          target.y - before.player.position.y,
        ),
      ),
      routeLength: route.length,
    };
    history.push(evidence);
    // One safe cell avoids test-induced overshoot around solid scenery. The
    // production pointer route still persists until this destination settles;
    // off-crop cells fall back to a short physical joystick pulse.
    const waypoint = route[0]!;
    const start = { ...before.player.position };
    const tapped = await tapWorldPoint(page, waypoint, geometry);
    history[history.length - 1]!.input = tapped ? "tap" : "joystick";
    if (!tapped) {
      const next = route[0]!;
      await dragProductionJoystick(
        page,
        session,
        { x: next.x - start.x, y: next.y - start.y },
        geometry,
      );
    }
    await expect
      .poll(
        async () => {
          const state = await observerState(page);
          if (complete(state)) return true;
          if (tapped)
            return (
              Math.hypot(
                state.player.position.x - waypoint.x,
                state.player.position.y - waypoint.y,
              ) < 160
            );
          return (
            Math.hypot(
              state.player.position.x - start.x,
              state.player.position.y - start.y,
            ) > 64
          );
        },
        { timeout: 3_000, intervals: [50, 100, 150] },
      )
      .toBe(true);
  }
  throw new Error(
    `Production touch route exceeded 16 physical waypoints: ${JSON.stringify(history)}`,
  );
}

test("physical touch discovers the sign and enters Embercross through the production observer", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push(`console: ${message.text()}`);
  });

  await page.goto("/?scenario=production-city-route");
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  const session = await page.context().newCDPSession(page);
  const inputGeometry = await productionInputGeometry(page);
  expect(await page.evaluate(() => Boolean(window.__GAME_TEST__))).toBe(false);
  expect(await page.evaluate(() => window.__GAME_OBSERVE__?.mode)).toBe(
    "observe-only",
  );

  const initial = await observerState(page);
  expect(initial).toMatchObject({
    scenarioId: "production-city-route",
    phase: "playing",
    exitUnlocked: true,
    monsters: [],
    city: { locationPhase: "undiscovered" },
  });
  const initialManifest = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.renderManifest(),
  );
  expect(
    initialManifest.sceneSprites.find(
      ({ objectId }) => objectId === "landmark:embercross:road-sign",
    ),
  ).toMatchObject({
    spriteId: "scenery:prop:embercross-road-sign",
    assetId: "atlas:embercross-city-kit-v1",
    collision: { mode: "solid" },
  });
  await attachObserverFrame(page, testInfo, "city-route-01-wilderness");

  const landmark = wildernessCityLandmarkAnchor(initial.map);
  const discovered = await driveProductionRoute(
    page,
    session,
    inputGeometry,
    landmark,
    (state) => state.city.locationPhase !== "undiscovered",
  );
  expect(discovered.city.locationPhase).toBe("discovered");
  expect(
    discovered.eventLog.some(({ type }) => type === "city_discovered"),
  ).toBe(true);
  expect(await page.locator("#objective").getAttribute("data-state")).toBe(
    "enter-city",
  );
  await attachObserverFrame(page, testInfo, "city-route-02-discovered");

  const wildernessDigest = discovered.map.digest;
  const gate = tileCenter(discovered.map.exit);
  const entered = await driveProductionRoute(
    page,
    session,
    inputGeometry,
    gate,
    (state) => state.city.locationPhase === "inside",
  );
  expect(entered.city.locationPhase).toBe("inside");
  expect(entered.map.digest).not.toBe(wildernessDigest);
  expect(isEmbercrossMap(entered.map)).toBe(true);
  expect(entered.phase).toBe("playing");
  expect(entered.eventLog.some(({ type }) => type === "city_entered")).toBe(
    true,
  );
  const cityManifest = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.renderManifest(),
  );
  expect(
    cityManifest.sceneSprites.find(
      ({ objectId }) => objectId === "gate:embercross:south",
    ),
  ).toMatchObject({
    spriteId: "scenery:structure:embercross-city-gate",
    collision: { mode: "solid" },
    collisionParts: [expect.objectContaining({ mode: "solid" })],
  });
  expect(
    cityManifest.drawCalls.filter(({ type }) => type === "npc"),
  ).toHaveLength(4);
  await attachObserverFrame(page, testInfo, "city-route-03-entered");
  expect(faults).toEqual([]);
});
