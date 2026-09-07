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

test("held Shift-click strike repeats while strafing and keeps aiming at the cursor", async ({
  page,
}) => {
  await openArena(page);
  const start = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(
    canvas.x + canvas.width * 0.7,
    canvas.y + canvas.height * 0.5,
  );
  await page.keyboard.down("Shift");
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
  await page.keyboard.up("Shift");
  await page.keyboard.up("a");
  const released = await advance(page, 60);
  expect(released.player.position).toEqual(strafing.player.position);
  expect(released.player.attackReadyTick).toBe(strafing.player.attackReadyTick);
});

test("a ground click walks to its destination without starting an attack", async ({
  page,
}) => {
  await openArena(page);
  const before = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    return {
      state: bridge.snapshot(),
      player: bridge
        .renderManifest()
        .drawCalls.find(({ type }) => type === "player")!,
    };
  });
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(
    canvas.x + ((before.player.footAnchor.x + 96) * canvas.width) / 960,
    canvas.y + (before.player.footAnchor.y * canvas.height) / 540,
  );
  const arrived = await advance(page, 90);
  expect(arrived.player.position.x).toBeGreaterThan(
    before.state.player.position.x + 1500,
  );
  expect(arrived.player.velocity).toEqual({ x: 0, y: 0 });
  expect(
    arrived.eventLog.filter(({ type }) => type === "attack_started"),
  ).toHaveLength(0);
});

test("clicking loot walks to it and picks that item up", async ({ page }) => {
  await openArena(page);
  const before = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadScenario({
      schemaVersion: 1,
      id: "pointer-loot-pickup",
      seed: "pointer-loot-pickup",
      classId: "vanguard",
      map: {
        mode: "explicit",
        rows: [
          "#####################",
          "#...................#",
          "#...................#",
          "#........P........E.#",
          "#...................#",
          "#...................#",
          "#####################",
        ],
      },
      loot: [
        {
          id: "loot:clicked",
          kind: "gold",
          rarity: "common",
          tile: [13, 3],
          amount: 7,
        },
      ],
      settings: { ai: false, autoPickup: false, cameraFollow: true },
    });
    return {
      state: bridge.snapshot(),
      loot: bridge
        .renderManifest()
        .drawCalls.find(({ entityId }) => entityId === "loot:clicked")!,
    };
  });
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(
    canvas.x +
      ((before.loot.destinationRect.x + before.loot.destinationRect.width / 2) *
        canvas.width) /
        960,
    canvas.y +
      ((before.loot.destinationRect.y +
        before.loot.destinationRect.height / 2) *
        canvas.height) /
        540,
  );
  const arrived = await advance(page, 90);
  expect(arrived.player.position.x).toBeGreaterThan(
    before.state.player.position.x + 2000,
  );
  expect(arrived.player.gold).toBe(7);
  expect(arrived.loot).toHaveLength(0);
  expect(arrived.metrics.lootCollected).toBe(1);
  expect(
    arrived.eventLog.some(
      ({ type, targetId }) =>
        type === "loot_picked" && targetId === "loot:clicked",
    ),
  ).toBe(true);
  expect(
    arrived.eventLog.filter(({ type }) => type === "attack_started"),
  ).toHaveLength(0);
});

test("clicking a distant enemy approaches, attacks, and stops after the kill", async ({
  page,
}) => {
  await openArena(page);
  const before = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadScenario({
      schemaVersion: 1,
      id: "pointer-pursuit",
      seed: "pointer-pursuit",
      classId: "vanguard",
      map: {
        mode: "explicit",
        rows: [
          "#####################",
          "#...................#",
          "#...................#",
          "#........P........E.#",
          "#...................#",
          "#...................#",
          "#####################",
        ],
      },
      monsters: [{ id: "pursued-target", kind: "ashfang", tile: [13, 3] }],
      settings: { ai: false, autoPickup: false, cameraFollow: true },
    });
    return {
      state: bridge.snapshot(),
      target: bridge
        .renderManifest()
        .drawCalls.find(({ entityId }) => entityId === "pursued-target")!,
    };
  });
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(
    canvas.x +
      ((before.target.destinationRect.x +
        before.target.destinationRect.width / 2) *
        canvas.width) /
        960,
    canvas.y +
      ((before.target.destinationRect.y +
        before.target.destinationRect.height * 0.7) *
        canvas.height) /
        540,
  );
  const approached = await advance(page, 15);
  expect(approached.player.position.x).toBeGreaterThan(
    before.state.player.position.x,
  );
  expect(
    approached.eventLog.filter(({ type }) => type === "attack_started"),
  ).toHaveLength(0);
  const killed = await advance(page, 150);
  expect(killed.metrics.kills).toBe(1);
  expect(killed.metrics.damageDealt).toBe(36);
  const stopped = await advance(page, 60);
  expect(stopped.player.position).toEqual(killed.player.position);
  expect(stopped.player.attackReadyTick).toBe(killed.player.attackReadyTick);
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

for (const classId of ["ranger", "arcanist"] as const) {
  test(`${classId} attacks a selected foe from range without walking into melee`, async ({
    page,
  }) => {
    await openArena(page);
    const before = await page.evaluate((classId) => {
      const bridge = window.__GAME_TEST__!;
      bridge.loadScenario({
        schemaVersion: 1,
        id: `ranged-click-${classId}`,
        seed: "ranged-click",
        classId,
        map: {
          mode: "explicit",
          rows: [
            "#####################",
            "#...................#",
            "#...................#",
            "#........P........E.#",
            "#...................#",
            "#...................#",
            "#####################",
          ],
        },
        monsters: [
          {
            id: "ranged-target",
            kind: "ashfang",
            tile: [13, 3],
            health: 1000,
            maxHealth: 1000,
          },
        ],
        settings: { ai: false, autoPickup: false, cameraFollow: true },
      });
      return {
        state: bridge.snapshot(),
        target: bridge
          .renderManifest()
          .drawCalls.find(({ entityId }) => entityId === "ranged-target")!,
      };
    }, classId);
    const canvas = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(
      canvas.x +
        ((before.target.destinationRect.x +
          before.target.destinationRect.width / 2) *
          canvas.width) /
          960,
      canvas.y +
        ((before.target.destinationRect.y +
          before.target.destinationRect.height * 0.7) *
          canvas.height) /
          540,
    );
    const hit = await advance(page, 60);
    expect(hit.player.position).toEqual(before.state.player.position);
    expect(hit.metrics.damageDealt).toBeGreaterThan(0);
    expect(
      hit.eventLog.find(({ type }) => type === "attack_started")?.tick,
    ).toBe(0);
  });
}

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

  test("touch strike cancels a retreat route and aims at the nearby enemy", async ({
    page,
  }) => {
    await openArena(page);
    const player = await page.evaluate(() => {
      const bridge = window.__GAME_TEST__!;
      bridge.loadScenario("combat-loot");
      return bridge
        .renderManifest()
        .drawCalls.find(({ type }) => type === "player")!;
    });
    const canvas = (await page.locator("canvas").boundingBox())!;
    await page.touchscreen.tap(
      canvas.x + (player.footAnchor.x * canvas.width) / 960,
      canvas.y + ((player.footAnchor.y + 48) * canvas.height) / 540,
    );
    const retreat = await advance(page, 1);
    expect(retreat.player.velocity.y).toBeGreaterThan(0);
    const strike = (await page
      .locator(".mobile-actions [data-action='attack']")
      .boundingBox())!;
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: strike.x + strike.width / 2, y: strike.y + strike.height / 2 },
      ],
    });
    const hit = await advance(page, 12);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(hit.player.position).toEqual(retreat.player.position);
    expect(hit.metrics.kills).toBe(1);
    expect(hit.metrics.damageDealt).toBeGreaterThan(0);
    await session.detach();
  });
});
