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

test("projects bridge-loaded scenario identity into the visible HUD", async ({
  page,
}) => {
  await page.evaluate(() => window.__GAME_TEST__!.loadScenario("combat-loot"));
  await expect(page.locator(".brand small")).toHaveText("scn-loot-0301");
  await expect(page.locator("#monsters")).toHaveText("1 foe");
});

test("lets the complete death animation play before showing the loss modal", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("temporal-run-loss");
    window.__GAME_TEST__!.step(47, { render: true });
  });
  await expect(page.locator("#outcome")).toBeHidden();
  const terminal = await page.evaluate(() => {
    const manifest = window.__GAME_TEST__!.step(1, { render: true });
    return {
      tick: manifest.tick,
      frame: window
        .__GAME_TEST__!.renderManifest()
        .drawCalls.find((call) => call.entityId === "player")?.frameIndex,
    };
  });
  expect(terminal).toEqual({ tick: 48, frame: 7 });
  await expect(page.locator("#outcome")).toBeVisible();
  await expect(page.locator("#outcome h2")).toHaveText("Run ended.");
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

test("exposes deterministic sub-tick presentation frames for high-refresh displays", async ({
  page,
}) => {
  const samples = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("animation-walk");
    const startX = window.__GAME_TEST__!.snapshot().player.position.x;
    window.__GAME_TEST__!.setInput({ moveX: 1 });
    window.__GAME_TEST__!.step(1);
    const frames = [0, 0.25, 0.5, 0.75, 1].map((interpolationAlpha) => {
      const manifest = window.__GAME_TEST__!.render({ interpolationAlpha });
      const player = manifest.drawCalls.find(
        (call) => call.entityId === "player",
      )!;
      return {
        interpolationAlpha: manifest.interpolationAlpha,
        presentationTick: manifest.presentationTick,
        worldX: player.worldAnchor.x,
        screenX: player.screenAnchor.x,
      };
    });
    const beforeCapture = window.__GAME_TEST__!.render({
      interpolationAlpha: 0.25,
    });
    const png = window.__GAME_TEST__!.captureFrame();
    const afterCapture = window.__GAME_TEST__!.renderManifest();
    return {
      startX,
      frames,
      capturePreservedPresentation:
        beforeCapture.presentationTick === afterCapture.presentationTick &&
        beforeCapture.interpolationAlpha === afterCapture.interpolationAlpha,
      capturedPng: png.startsWith("data:image/png;base64,"),
    };
  });
  expect(samples.frames.map((frame) => frame.worldX)).toEqual(
    [0, 18, 36, 54, 72].map((offset) => samples.startX + offset),
  );
  expect(samples.frames.map((frame) => frame.presentationTick)).toEqual([
    0, 0.25, 0.5, 0.75, 1,
  ]);
  expect(new Set(samples.frames.map((frame) => frame.screenX)).size).toBe(1);
  expect(samples.capturePreservedPresentation).toBe(true);
  expect(samples.capturedPng).toBe(true);
});

test("advances smooth camera once per simulation tick regardless of render count", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("camera-track");
    const initial = window.__GAME_TEST__!.camera();
    for (let index = 0; index < 25; index += 1)
      window.__GAME_TEST__!.render({ interpolationAlpha: index / 24 });
    const afterRenders = window.__GAME_TEST__!.camera();
    const first = window.__GAME_TEST__!.step(1, { render: true });
    const afterTick = window.__GAME_TEST__!.camera();
    const firstManifest = window.__GAME_TEST__!.renderManifest();
    window.__GAME_TEST__!.reset();
    window.__GAME_TEST__!.step(1, { render: true });
    const repeated = window.__GAME_TEST__!.camera();
    return {
      initial,
      afterRenders,
      afterTick,
      repeated,
      stateTick: first.tick,
      cameraMode: firstManifest.cameraMode,
      target: firstManifest.cameraTarget,
    };
  });
  expect(result.afterRenders).toEqual(result.initial);
  expect(result.afterTick).toEqual(result.repeated);
  expect(result.afterTick.x).toBeGreaterThan(result.initial.x);
  expect(result.afterTick.x).toBeLessThan(result.target.x);
  expect(result.stateTick).toBe(1);
  expect(result.cameraMode).toBe("smooth");
});

test("honors cameraFollow false even when smooth mode is selected", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario({
      schemaVersion: 1,
      id: "camera-fixed-by-setting",
      seed: "camera-fixed",
      classId: "ranger",
      map: {
        mode: "explicit",
        rows: [
          "######################",
          "#....................#",
          "#..................E.#",
          "#....................#",
          "#....................#",
          "#....................#",
          "#....................#",
          "#..........P.........#",
          "#....................#",
          "#....................#",
          "#....................#",
          "#....................#",
          "#....................#",
          "#....................#",
          "######################",
        ],
      },
      monsters: [],
      camera: { mode: "smooth", centerTile: [3, 7] },
      settings: { ai: false, autoPickup: false, cameraFollow: false },
    });
    const before = window.__GAME_TEST__!.camera();
    window.__GAME_TEST__!.setInput({ moveX: 1 });
    window.__GAME_TEST__!.step(20, { render: true });
    return { before, after: window.__GAME_TEST__!.camera() };
  });
  expect(result.after).toEqual(result.before);
});

test("measures actual transparent entity ink instead of declared bounds", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("animation-walk");
    window.__GAME_TEST__!.setInput({ moveX: 1 });
    const walk = [0, 5, 10, 15, 20, 25, 30, 35].map((targetTick) => {
      const current = Number(window.__GAME_TEST__!.snapshot().tick);
      window.__GAME_TEST__!.step(targetTick - current, { render: true });
      return window.__GAME_TEST__!.captureEntityMask("player");
    });
    const directionMasks = [
      { moveX: 1 as const },
      { moveX: -1 as const },
      { moveY: -1 as const },
      { moveY: 1 as const },
    ].map((input) => {
      window.__GAME_TEST__!.loadScenario("animation-walk");
      window.__GAME_TEST__!.setInput(input);
      window.__GAME_TEST__!.step(6, { render: true });
      return window.__GAME_TEST__!.captureEntityMask("player");
    });
    window.__GAME_TEST__!.loadScenario("combat-loot");
    window.__GAME_TEST__!.setInput({ attack: true });
    window.__GAME_TEST__!.step(1, { render: true });
    window.__GAME_TEST__!.setInput({ attack: false });
    window.__GAME_TEST__!.step(25, { render: true });
    const terminal = window.__GAME_TEST__!.captureEntityMask("player");
    window.__GAME_TEST__!.step(1, { render: true });
    const idle = window.__GAME_TEST__!.captureEntityMask("player");
    return { walk, directionMasks, terminal, idle };
  });
  expect(
    new Set(result.walk.map((mask) => mask.pixelHash)).size,
  ).toBeGreaterThan(3);
  expect(new Set(result.walk.map((mask) => mask.bottomOffset)).size).toBe(1);
  expect(result.walk.every((mask) => mask.alphaPixels > 100)).toBe(true);
  expect(
    new Set(result.directionMasks.map((mask) => mask.pixelHash)).size,
  ).toBe(4);
  expect(result.terminal.pixelHash).toBe(result.idle.pixelHash);
  expect(result.terminal.inkBounds).toEqual(result.idle.inkBounds);
});
