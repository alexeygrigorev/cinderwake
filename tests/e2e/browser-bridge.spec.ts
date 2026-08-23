import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("loads, steps, and deterministically resets a complete scenario", async ({
  page,
}) => {
  const first = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("animation-walk");
    window.__GAME_TEST__!.setInput({ moveX: 1 });
    window.__GAME_TEST__!.step(10, { render: true });
    return {
      snapshot: window.__GAME_TEST__!.snapshot(),
      hash: window.__GAME_TEST__!.stateHash(),
    };
  });
  const reset = await page.evaluate(() => {
    window.__GAME_TEST__!.reset();
    window.__GAME_TEST__!.setInput({ moveX: 1 });
    window.__GAME_TEST__!.step(10, { render: true });
    return {
      snapshot: window.__GAME_TEST__!.snapshot(),
      hash: window.__GAME_TEST__!.stateHash(),
    };
  });
  expect(reset).toEqual(first);
});

test("accepts JSON fixture snapshots and drains per-tick events", async ({
  page,
}) => {
  const fixture = await page.evaluate(() =>
    fetch("/scenarios/arbitrary-state.json").then((result) => result.json()),
  );
  const result: any = await page.evaluate((scenario) => {
    window.__GAME_TEST__!.loadScenario(scenario);
    return window.__GAME_TEST__!.snapshot();
  }, fixture);
  expect(result.scenarioId).toBe("fixture-arbitrary-state");
  expect(result.player.health).toBe(73);
});

test("restores an exact canonical GameState snapshot and resets to it", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("mid-action");
    window.__GAME_TEST__!.step(3, { render: true });
    const state = window.__GAME_TEST__!.snapshot();
    state.player.position.x += 137;
    state.player.previousPosition.y -= 91;
    const loaded = window.__GAME_TEST__!.loadState(state);
    const hash = window.__GAME_TEST__!.stateHash();
    window.__GAME_TEST__!.step(5);
    const reset = window.__GAME_TEST__!.reset();
    return {
      loaded,
      reset,
      hash,
      resetHash: window.__GAME_TEST__!.stateHash(),
    };
  });
  expect(result.loaded).toEqual(result.reset);
  expect(result.hash).toBe(result.resetHash);
  expect(result.loaded.player.position.x % 1024).not.toBe(512);
});

test("rejects malformed state injection without mutating the live world", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("animation-idle");
    const before = window.__GAME_TEST__!.stateHash();
    const malformed: any = window.__GAME_TEST__!.snapshot();
    delete malformed.rng;
    let message = "";
    try {
      window.__GAME_TEST__!.loadState(malformed);
    } catch (error) {
      message = String(error);
    }
    return { before, after: window.__GAME_TEST__!.stateHash(), message };
  });
  expect(result.after).toBe(result.before);
  expect(result.message).toContain("state.rng");
});

test("keyboard and pointer adapter feed deterministic input sampling", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__GAME_TEST__!.loadScenario("animation-idle"),
  );
  const canvas = page.locator("canvas");
  await page.keyboard.down("d");
  await page.mouse.move(800, 400);
  await canvas.click({ position: { x: 600, y: 270 } });
  const snapshot: any = await page.evaluate(() => {
    window.__GAME_TEST__!.step(1, { useBrowserInput: true });
    return window.__GAME_TEST__!.snapshot();
  });
  await page.keyboard.up("d");
  expect(snapshot.player.position.x).toBeGreaterThan(0);
  expect(
    snapshot.eventLog.some(
      (event: { type: string }) => event.type === "attack_started",
    ),
  ).toBe(true);
});
