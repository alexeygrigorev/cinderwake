import { expect, test } from "@playwright/test";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  CITY_GATE_ID,
  createInitialCityState,
  transitionCityProgression,
} from "../../src/game/city";
import {
  cityNpcWorldAnchor,
  createEmbercrossMap,
} from "../../src/game/cityWorld";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

function insideEmbercrossCity() {
  const initial = createInitialCityState();
  const discovered = transitionCityProgression(initial, {
    type: "discover_city",
    tick: 1,
    landmarkId: CITY_DISCOVERY_LANDMARK_ID,
  });
  if (!discovered.ok) throw new Error(discovered.message);
  const arrived = transitionCityProgression(discovered.state, {
    type: "arrive_at_gate",
    tick: 2,
    gateId: CITY_GATE_ID,
  });
  if (!arrived.ok) throw new Error(arrived.message);
  const entered = transitionCityProgression(arrived.state, {
    type: "enter_city",
    tick: 3,
    gateId: CITY_GATE_ID,
  });
  if (!entered.ok) throw new Error(entered.message);
  return entered.state;
}

test("mobile city service actions synchronize loaded player state and report rejection", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const city = insideEmbercrossCity();
  const mara = cityNpcWorldAnchor("npc:embercross:mara");
  await page.evaluate(
    ({ city, map, mara }) => {
      const state = window.__GAME_TEST__!.snapshot();
      state.tick = 3;
      state.map = map;
      state.monsters = [];
      state.player.position = mara;
      state.player.previousPosition = mara;
      state.player.gold = 40;
      state.player.health = 52;
      state.player.tonics = 1;
      city.traveler = {
        ...city.traveler,
        gold: state.player.gold,
        health: state.player.health,
        maxHealth: state.player.maxHealth,
        tonics: state.player.tonics,
      };
      state.city = city;
      window.__GAME_TEST__!.loadState(state);
    },
    { city, map: createEmbercrossMap(), mara },
  );

  const buy = page.locator("[data-city-action='merchant:buy-tonic']");
  await expect(buy).toBeVisible();
  expect((await buy.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  await buy.tap();
  const afterBuy = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
  expect(afterBuy.player).toMatchObject({ gold: 22, health: 52, tonics: 2 });
  expect(afterBuy.city.traveler).toMatchObject({
    gold: 22,
    health: 52,
    tonics: 2,
  });
  await expect(page.locator(".city-service-feedback")).toHaveAttribute(
    "aria-label",
    "Buy tonic complete",
  );

  await page.locator("[data-city-action='merchant:sell-ashfang-pelt']").tap();
  await expect(page.locator(".city-service-feedback")).toHaveAttribute(
    "aria-label",
    "The traveler does not have enough Ashfang pelts.",
  );
});

test("mobile character selection fills the viewport and has no horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".selection")).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.viewportHeight);
  await expect(page.locator("#begin")).toBeInViewport();
  await expect(page).toHaveScreenshot("mobile-character-selection.png", {
    fullPage: true,
  });
});

test("the real mobile selection path starts the chosen hero and every action control changes state", async ({
  page,
}) => {
  await page.goto("/?testMode=1&selection=1");
  const ranger = page.locator("[data-class='ranger']");
  await ranger.tap();
  await expect(page.locator(".selection")).toHaveAttribute(
    "data-selected-class",
    "ranger",
  );
  await expect(ranger).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".selection-art")).toHaveCSS(
    "background-image",
    /ranger-v2\.webp/,
  );

  await page.locator("#begin").tap();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  expect(
    await page.evaluate(() => window.__GAME_TEST__!.snapshot().player.classId),
  ).toBe("ranger");

  const pad = page.locator(".move-pad");
  const box = await pad.boundingBox();
  if (!box) throw new Error("Movement pad has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  const movement = await page.evaluate(() => {
    const before = window.__GAME_TEST__!.snapshot().player.position.x;
    const after = window.__GAME_TEST__!.step(1, {
      useBrowserInput: true,
    }).player.position.x;
    return { before, after };
  });
  await page.mouse.up();
  expect(movement.after).toBeGreaterThan(movement.before);

  await page.locator(".mobile-actions [data-action='ability']").tap();
  const ability = await page.evaluate(() =>
    window.__GAME_TEST__!.step(1, { useBrowserInput: true }),
  );
  expect(
    ability.eventLog.some(
      (event: { type: string }) => event.type === "ability_started",
    ),
  ).toBe(true);

  await page.evaluate(() => window.__GAME_TEST__!.step(120));
  await page.locator(".mobile-actions [data-action='attack']").tap();
  const attack = await page.evaluate(() =>
    window.__GAME_TEST__!.step(1, { useBrowserInput: true }),
  );
  expect(
    attack.eventLog.some(
      (event: { type: string }) => event.type === "attack_started",
    ),
  ).toBe(true);

  await page.evaluate(() => {
    const state = window.__GAME_TEST__!.snapshot();
    state.player.health = state.player.maxHealth - 30;
    state.player.tonics = 1;
    window.__GAME_TEST__!.loadState(state);
  });
  const beforeTonic = await page.evaluate(
    () => window.__GAME_TEST__!.snapshot().player,
  );
  await page.locator(".mobile-actions [data-action='tonic']").tap();
  const afterTonic = await page.evaluate(
    () => window.__GAME_TEST__!.step(1, { useBrowserInput: true }).player,
  );
  expect(afterTonic.health).toBeGreaterThan(beforeTonic.health);
  expect(afterTonic.tonics).toBe(beforeTonic.tonics - 1);
});

test("touch landscape selection keeps every interactive surface inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await expect(page.locator(".selection")).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    surfaces: [
      ...document.querySelectorAll<HTMLElement>(
        ".class-card, #begin, .selection-lab-toggle",
      ),
    ].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    }),
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(
    layout.surfaces.every(
      ({ left, right, width, height }) =>
        left >= 0 &&
        right <= layout.viewportWidth &&
        width >= 44 &&
        height >= 44,
    ),
  ).toBe(true);
});

test("joystick movement and action buttons feed the real input adapter", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const pad = page.locator(".move-pad");
  await expect(pad).toBeVisible();
  const box = await pad.boundingBox();
  if (!box) throw new Error("Movement pad has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height / 2);
  const moved = await page.evaluate(() => {
    const before = window.__GAME_TEST__!.snapshot().player.position.x;
    const state = window.__GAME_TEST__!.step(1, { useBrowserInput: true });
    return { before, after: state.player.position.x };
  });
  await page.mouse.up();
  expect(moved.after).toBeGreaterThan(moved.before);
  await expect(pad).toHaveAttribute("data-direction", "0,0");

  await page.locator(".mobile-actions [data-action='ability']").tap();
  const ability = await page.evaluate(() => {
    window.__GAME_TEST__!.step(1, { useBrowserInput: true });
    return window.__GAME_TEST__!.snapshot();
  });
  expect(
    ability.eventLog.some(
      (event: { type: string }) => event.type === "ability_started",
    ),
  ).toBe(true);
});

test("tapping the ground persistently moves without striking; Strike attacks", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));

  const tapPoint = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const bounds = canvas.getBoundingClientRect();
    const player = window
      .__GAME_TEST__!.renderManifest()
      .drawCalls.find((call) => call.entityId === "player")!;
    return {
      x: bounds.left + ((player.screenAnchor.x + 96) / 960) * bounds.width,
      y: bounds.top + (player.screenAnchor.y / 540) * bounds.height,
    };
  });
  const before = await page.evaluate(
    () => window.__GAME_TEST__!.snapshot().player.position,
  );
  await page.touchscreen.tap(tapPoint.x, tapPoint.y);
  const movement = await page.evaluate(() => {
    const first = window.__GAME_TEST__!.step(1, {
      useBrowserInput: true,
    });
    const later = window.__GAME_TEST__!.step(3, {
      useBrowserInput: true,
    });
    return {
      first: first.player.position,
      later: later.player.position,
      eventLog: later.eventLog,
    };
  });
  expect(movement.first.x).toBeGreaterThan(before.x);
  expect(movement.later.x).toBeGreaterThan(movement.first.x);
  expect(
    movement.eventLog.some(
      (event: { type: string }) => event.type === "attack_started",
    ),
  ).toBe(false);

  await page.locator(".mobile-actions [data-action='attack']").tap();
  const strike = await page.evaluate(() =>
    window.__GAME_TEST__!.step(1, { useBrowserInput: true }),
  );
  expect(
    strike.eventLog.some(
      (event: { type: string }) => event.type === "attack_started",
    ),
  ).toBe(true);
});

test("portrait game UI respects touch target and viewport bounds", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=mid-action");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const layout = await page.evaluate(() => {
    const controls = document.querySelector<HTMLElement>(".mobile-controls")!;
    const stage = document.querySelector<HTMLElement>(".stage")!;
    const buttons = [
      ...document.querySelectorAll<HTMLElement>(".mobile-actions button"),
    ];
    const controlBox = controls.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      controlBox: {
        left: controlBox.left,
        right: controlBox.right,
        top: controlBox.top,
        bottom: controlBox.bottom,
      },
      stageBox: {
        left: stageBox.left,
        right: stageBox.right,
        top: stageBox.top,
        bottom: stageBox.bottom,
      },
      targets: buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.controlBox.left).toBeGreaterThanOrEqual(0);
  expect(layout.controlBox.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.controlBox.bottom).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.stageBox.left).toBeGreaterThanOrEqual(0);
  expect(layout.stageBox.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.controlBox.top).toBeGreaterThanOrEqual(layout.stageBox.top);
  expect(layout.controlBox.bottom).toBeLessThanOrEqual(
    layout.stageBox.bottom + 1,
  );
  expect(layout.targets.every((target) => target.height >= 44)).toBe(true);
  await expect(page.locator(".game")).toHaveScreenshot("mobile-game.png");
});

test("landscape game canvas fits without scrolling and keeps controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?testMode=1&scenario=camera-track");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const layout = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage")!;
    const controls = document.querySelector<HTMLElement>(".mobile-controls")!;
    const stageBox = stage.getBoundingClientRect();
    const controlsBox = controls.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      stage: {
        top: stageBox.top,
        bottom: stageBox.bottom,
        width: stageBox.width,
        height: stageBox.height,
      },
      controls: {
        top: controlsBox.top,
        bottom: controlsBox.bottom,
      },
    };
  });
  expect(layout.document.width).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.document.height).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.stage.top).toBeGreaterThanOrEqual(0);
  expect(layout.stage.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
  expect(layout.stage.width).toBeCloseTo(layout.viewport.width, 0);
  expect(layout.stage.height).toBeCloseTo(layout.viewport.height, 0);
  expect(layout.controls.bottom).toBeLessThanOrEqual(layout.viewport.height);
  await expect(page.locator(".game")).toHaveScreenshot(
    "mobile-game-landscape.png",
  );
});
