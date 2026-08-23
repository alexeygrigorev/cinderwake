import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("character selection is stable with decoded local key art", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".hero img");
    return Boolean(image?.complete && image.naturalWidth > 0);
  });
  await expect(page.locator(".selection")).toHaveScreenshot(
    "character-selection.png",
  );
});

test("idle loop keeps an exact foot anchor, bounds, and frame cadence", async ({
  page,
}) => {
  const manifests: any[] = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("animation-idle");
    return [0, 10, 20, 30, 40, 50, 60].map((targetTick) => {
      const currentTick = Number(window.__GAME_TEST__!.snapshot().tick);
      window.__GAME_TEST__!.step(targetTick - currentTick, { render: true });
      return window.__GAME_TEST__!.renderManifest();
    });
  });
  const calls = manifests.map((manifest) =>
    manifest.drawCalls.find((call: any) => call.entityId === "player"),
  );
  expect(calls.map((call) => call.frameIndex)).toEqual([0, 1, 2, 3, 4, 5, 0]);
  expect(
    new Set(calls.map((call) => `${call.worldAnchor.x},${call.worldAnchor.y}`))
      .size,
  ).toBe(1);
  expect(
    new Set(calls.map((call) => `${call.footAnchor.x},${call.footAnchor.y}`))
      .size,
  ).toBe(1);
  expect(
    new Set(calls.map((call) => `${call.bounds.width}x${call.bounds.height}`))
      .size,
  ).toBe(1);
  expect(
    calls.every((call) => call.visible && call.geometryId === "hero:vanguard"),
  ).toBe(true);
});

test("walk is monotonic at constant velocity with stable tracked camera", async ({
  page,
}) => {
  const calls: any[] = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("animation-walk");
    window.__GAME_TEST__!.setInput({ moveX: 1 });
    return Array.from({ length: 60 }, () => {
      window.__GAME_TEST__!.step(1, { render: true });
      return window
        .__GAME_TEST__!.renderManifest()
        .drawCalls.find((call: any) => call.entityId === "player");
    });
  });
  const deltas = calls
    .slice(1)
    .map((call, index) => call.worldAnchor.x - calls[index]!.worldAnchor.x);
  expect(deltas.every((delta) => delta === 72)).toBe(true);
  expect(calls.at(-1).worldAnchor.x - calls[0].worldAnchor.x).toBe(72 * 59);
  expect(calls.map((call) => call.frameIndex)).toEqual(
    calls.map((_call, index) => Math.floor((((index + 1) % 40) * 8) / 40)),
  );
  expect(
    new Set(calls.map((call) => `${call.footAnchor.x},${call.footAnchor.y}`))
      .size,
  ).toBe(1);
  expect(
    new Set(calls.map((call) => `${call.bounds.width}x${call.bounds.height}`))
      .size,
  ).toBe(1);
  expect(
    calls.every(
      (call) =>
        call.bounds.x >= 0 &&
        call.bounds.y >= 0 &&
        call.bounds.x + call.bounds.width <= 960 &&
        call.bounds.y + call.bounds.height <= 540,
    ),
  ).toBe(true);
  await expect(page.locator("canvas").first()).toHaveScreenshot(
    "animation-walk-tick-60.png",
  );
});

test("combat impact and injected mid-action states render stable screenshots", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("combat-loot");
    window.__GAME_TEST__!.render();
  });
  await expect(page.locator("canvas").first()).toHaveScreenshot(
    "combat-loot-initial.png",
  );
  await page.evaluate(() => {
    window.__GAME_TEST__!.setInput({ attack: true });
    window.__GAME_TEST__!.step(9, { render: true });
  });
  await expect(page.locator("canvas").first()).toHaveScreenshot(
    "combat-loot-impact.png",
  );
  const transition = await page.evaluate(() => {
    window.__GAME_TEST__!.reset();
    window.__GAME_TEST__!.setInput({ attack: true });
    window.__GAME_TEST__!.step(1, { render: true });
    window.__GAME_TEST__!.setInput({ attack: false });
    window.__GAME_TEST__!.step(25, { render: true });
    const terminal = window
      .__GAME_TEST__!.renderManifest()
      .drawCalls.find((call) => call.entityId === "player");
    window.__GAME_TEST__!.step(1, { render: true });
    const recovered = window
      .__GAME_TEST__!.renderManifest()
      .drawCalls.find((call) => call.entityId === "player");
    return { terminal, recovered };
  });
  expect(transition.terminal).toMatchObject({ clip: "attack", frameIndex: 5 });
  expect(transition.recovered).toMatchObject({ clip: "idle", frameIndex: 0 });
  await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("mid-action");
    window.__GAME_TEST__!.render();
  });
  await expect(page.locator("canvas").first()).toHaveScreenshot(
    "mid-action-injected.png",
  );
});
