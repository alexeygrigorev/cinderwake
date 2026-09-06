import { expect, test, type Page } from "@playwright/test";

async function openArena(page: Page): Promise<void> {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
}

async function advance(page: Page, ticks: number) {
  return page.evaluate(
    (count) =>
      window.__GAME_TEST__!.step(count, {
        useBrowserInput: true,
        render: true,
      }),
    ticks,
  );
}

test("held mouse strike repeats while strafing and keeps aiming at the cursor", async ({
  page,
}) => {
  await openArena(page);
  const start = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(
    canvas.x + canvas.width * 0.7,
    canvas.y + canvas.height * 0.5,
  );
  await page.mouse.down();
  await page.keyboard.down("a");
  const strafing = await advance(page, 65);
  expect(strafing.player.position.x).toBeLessThan(start.player.position.x);
  expect(strafing.player.facing.x).toBeGreaterThan(0);
  expect(
    strafing.eventLog
      .filter(
        ({ type, sourceId }) =>
          type === "attack_started" && sourceId === "player",
      )
      .map(({ tick }) => tick),
  ).toEqual([0, 30, 60]);

  // Releasing outside the canvas must stop the held action too.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.keyboard.up("a");
  const released = await advance(page, 60);
  expect(released.player.position).toEqual(strafing.player.position);
  expect(released.player.attackReadyTick).toBe(strafing.player.attackReadyTick);
});

test("stationary mouse aim follows the screen point as the camera moves", async ({
  page,
}) => {
  await openArena(page);
  await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario({
      schemaVersion: 1,
      id: "wide-camera-combat-controls",
      seed: "wide-camera-combat-controls",
      classId: "vanguard",
      map: {
        mode: "explicit",
        rows: Array.from({ length: 40 }, (_, y) =>
          Array.from({ length: 64 }, (_, x) =>
            x === 0 || x === 63 || y === 0 || y === 39
              ? "#"
              : x === 32 && y === 20
                ? "P"
                : x === 60 && y === 36
                  ? "E"
                  : ".",
          ).join(""),
        ),
      },
      monsters: [],
      settings: { ai: false, autoPickup: false, cameraFollow: true },
    });
  });
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(
    canvas.x + canvas.width * 0.58,
    canvas.y + canvas.height * 0.5,
  );
  await page.keyboard.down("d");
  // Walk past the original world coordinate beneath the cursor. A stored
  // world-space target would make the player turn backwards after passing it.
  const walked = await advance(page, 80);
  await page.keyboard.up("d");
  expect(walked.metrics.distanceUnits).toBeGreaterThan(2500);
  expect(walked.player.facing.x).toBeGreaterThan(0);
});

test("Space holds strike and E takes priority when both actions are ready", async ({
  page,
}) => {
  await openArena(page);
  await page.keyboard.down("Space");
  await page.keyboard.press("e");
  const first = await advance(page, 1);
  expect(first.events.some(({ type }) => type === "ability_started")).toBe(
    true,
  );
  const held = await advance(page, 65);
  expect(
    held.eventLog.filter(
      ({ type, sourceId }) =>
        type === "attack_started" && sourceId === "player",
    ),
  ).toHaveLength(3);
  expect(
    held.eventLog.filter(({ type }) => type === "ability_started"),
  ).toHaveLength(1);
  await page.keyboard.up("Space");
  const released = await advance(page, 60);
  expect(released.player.attackReadyTick).toBe(held.player.attackReadyTick);
});

test("losing focus clears movement and held strike", async ({ page }) => {
  await openArena(page);
  await page.keyboard.down("a");
  await page.keyboard.down("Space");
  const held = await advance(page, 2);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const blurred = await advance(page, 65);
  expect(blurred.player.position).toEqual(held.player.position);
  expect(blurred.player.attackReadyTick).toBe(held.player.attackReadyTick);
  expect(blurred.player.velocity).toEqual({ x: 0, y: 0 });
});

test.describe("touch combat", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("holding the touch strike button repeats attacks and release stops them", async ({
    page,
  }) => {
    await openArena(page);
    const strike = page.locator(".mobile-actions [data-action='attack']");
    const box = (await strike.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    const held = await advance(page, 65);
    expect(
      held.eventLog.filter(({ type }) => type === "attack_started"),
    ).toHaveLength(3);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const released = await advance(page, 60);
    expect(released.player.attackReadyTick).toBe(held.player.attackReadyTick);
    await session.detach();
  });
});
