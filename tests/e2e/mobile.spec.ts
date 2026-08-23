import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

test("mobile character selection is scrollable, readable, and has no horizontal overflow", async ({
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
  expect(layout.scrollHeight).toBeGreaterThan(layout.viewportHeight);
  await page.locator("#begin").scrollIntoViewIfNeeded();
  await expect(page.locator("#begin")).toBeInViewport();
  await expect(page).toHaveScreenshot("mobile-character-selection.png", {
    fullPage: true,
  });
});

test("touch movement, canvas aim, and action buttons feed the real input adapter", async ({
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

  await page.touchscreen.tap(330, 100);
  const attack = await page.evaluate(() => {
    window.__GAME_TEST__!.step(1, { useBrowserInput: true });
    return window.__GAME_TEST__!.snapshot();
  });
  expect(attack.player.facing.x).toBeGreaterThan(0);
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
  expect(
    Math.abs(layout.controlBox.top - layout.stageBox.bottom),
  ).toBeLessThanOrEqual(1);
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
  expect(layout.stage.width / layout.stage.height).toBeCloseTo(16 / 9, 2);
  expect(layout.controls.bottom).toBeLessThanOrEqual(layout.viewport.height);
  await expect(page.locator(".game")).toHaveScreenshot(
    "mobile-game-landscape.png",
  );
});
