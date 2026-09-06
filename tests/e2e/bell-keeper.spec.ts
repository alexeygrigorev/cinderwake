import { expect, test, type Page } from "@playwright/test";
import type { ScenarioV1 } from "../../src/testkit/scenarios";

const BELL_KEEPER_SCENARIO: ScenarioV1 = {
  schemaVersion: 1,
  id: "e2e-bell-keeper",
  seed: "e2e-bell-keeper",
  classId: "vanguard",
  map: {
    mode: "explicit",
    rows: [
      "####################",
      "#..................#",
      "#..................#",
      "#..................#",
      "#...P.............E#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "####################",
    ],
  },
  player: { tile: [4, 4], health: 1_000, maxHealth: 1_000, armor: 0 },
  monsters: [
    {
      id: "monster:bell-keeper",
      kind: "stonekin",
      tile: [6, 4],
      health: 1_000,
      maxHealth: 1_000,
      armor: 0,
      attackDamage: 20,
      attackReadyTick: 0,
      elite: true,
    },
  ],
  settings: { ai: true, autoPickup: false, cameraFollow: false },
};

async function openBellKeeper(page: Page): Promise<void> {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  await page.evaluate((scenario) => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadScenario(scenario);
    bridge.setCamera({ x: 6 * 48, y: 4 * 48, zoom: 0.9 }, "fixed");
  }, BELL_KEEPER_SCENARIO);
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

async function attachFullPage(page: Page, name: string): Promise<void> {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("desktop warning survives save/load, marks the boundary, and permits recovery counterplay", async ({
  page,
}) => {
  await openBellKeeper(page);
  await advance(page, 1);

  const scheduled = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    return {
      state: bridge.snapshot(),
      manifest: bridge.renderManifest(),
    };
  });
  const attack = scheduled.state.pendingAttacks[0]!;
  expect(attack.kind).toBe("ability");
  expect(attack.impactTick).toBe(48);
  expect(scheduled.manifest.combatTelegraphs).toHaveLength(1);

  // A real keyboard dodge moves only two ticks, just beyond the exact player
  // center boundary; the remaining windup is advanced deterministically.
  await page.keyboard.down("a");
  await advance(page, 2);
  await page.keyboard.up("a");
  await advance(page, attack.impactTick - 3);
  const beforeImpact = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    return { state: bridge.snapshot(), manifest: bridge.renderManifest() };
  });
  expect(beforeImpact.state.tick).toBe(48);
  expect(beforeImpact.state.player.health).toBe(1_000);
  expect(beforeImpact.manifest.combatTelegraphs).toHaveLength(1);
  expect(
    beforeImpact.manifest.drawCalls.find(
      ({ entityId }) => entityId === "monster:bell-keeper",
    ),
  ).toMatchObject({ clip: "ability" });
  expect(
    Math.hypot(
      beforeImpact.state.player.position.x - attack.origin.x,
      beforeImpact.state.player.position.y - attack.origin.y,
    ),
  ).toBeGreaterThan(attack.range);
  await attachFullPage(page, "desktop-warning-before-impact");

  const savedWarning = beforeImpact.state;
  const reloaded = await page.evaluate((state) => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadState(state);
    bridge.setCamera({ x: 6 * 48, y: 4 * 48, zoom: 0.9 }, "fixed");
    bridge.render();
    return {
      snapshot: bridge.snapshot(),
      manifest: bridge.renderManifest(),
    };
  }, savedWarning);
  expect(reloaded.snapshot.tick).toBe(savedWarning.tick);
  expect(reloaded.manifest.combatTelegraphs).toEqual(
    beforeImpact.manifest.combatTelegraphs,
  );

  const afterImpact = await advance(page, 1);
  expect(afterImpact.pendingAttacks).toHaveLength(0);
  expect(afterImpact.player.health).toBe(1_000);
  expect(
    (await page.evaluate(() => window.__GAME_TEST__!.renderManifest()))
      .combatTelegraphs,
  ).toEqual([]);
  await attachFullPage(page, "desktop-warning-after-dodge");

  // Return during the committed recovery window and use a real keyboard
  // strike. The boss cannot move or schedule a second slam until recovery and
  // cooldown are over, so this hit proves the physical counterplay window.
  await page.keyboard.down("d");
  await advance(page, 23);
  await page.keyboard.up("d");
  const recoveryStart = await page.evaluate(() =>
    window.__GAME_TEST__!.snapshot(),
  );
  expect(recoveryStart.tick).toBe(72);
  expect(recoveryStart.monsters[0]!.animation.clip).toBe("ability");
  await page.keyboard.down(" ");
  const attackStarted = await advance(page, 1);
  await page.keyboard.up(" ");
  expect(
    attackStarted.eventLog.some(
      ({ type, sourceId }: { type: string; sourceId?: string }) =>
        type === "attack_started" && sourceId === "player",
    ),
  ).toBe(true);
  const afterCounter = await advance(page, 8);
  expect(afterCounter.monsters[0]!.health).toBeLessThan(1_000);
  expect(afterCounter.pendingAttacks).toHaveLength(0);
});

test.describe("phone touch evasion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  test("touch navigation leaves the live ring before impact", async ({
    page,
  }) => {
    await openBellKeeper(page);
    await page.evaluate(() => {
      window.__GAME_TEST__!.setCamera(
        { x: 6 * 48, y: 4 * 48, zoom: 0.5 },
        "fixed",
      );
    });
    await advance(page, 1);
    const scheduled = await page.evaluate(() => {
      const bridge = window.__GAME_TEST__!;
      const state = bridge.snapshot();
      const manifest = bridge.renderManifest();
      const player = manifest.drawCalls.find(
        ({ entityId }) => entityId === "player",
      )!;
      const attack = state.pendingAttacks[0]!;
      const target = {
        x: attack.origin.x - attack.range - 512,
        y: state.player.position.y,
      };
      return {
        state,
        targetPoint: {
          x:
            player.screenAnchor.x +
            ((target.x - state.player.position.x) / 1024) *
              48 *
              manifest.camera.zoom,
          y: player.screenAnchor.y,
        },
      };
    });
    const canvas = await page.locator("canvas:not(.mini)").boundingBox();
    if (!canvas) throw new Error("Game canvas has no bounds");
    await page.touchscreen.tap(
      canvas.x + (scheduled.targetPoint.x / 960) * canvas.width,
      canvas.y + (scheduled.targetPoint.y / 540) * canvas.height,
    );
    await advance(page, 47);

    const beforeImpact = await page.evaluate(() => {
      const bridge = window.__GAME_TEST__!;
      return { state: bridge.snapshot(), manifest: bridge.renderManifest() };
    });
    const telegraph = beforeImpact.manifest.combatTelegraphs?.[0];
    expect(beforeImpact.state.tick).toBe(48);
    expect(beforeImpact.manifest.combatTelegraphs).toHaveLength(1);
    expect(telegraph).toBeDefined();
    if (!telegraph) throw new Error("Bell Keeper warning was not rendered");
    expect(
      Math.hypot(
        beforeImpact.state.player.position.x - telegraph.worldCenter.x,
        beforeImpact.state.player.position.y - telegraph.worldCenter.y,
      ),
    ).toBeGreaterThan(telegraph.radius);
    await attachFullPage(page, "phone-warning-before-impact");

    const afterImpact = await advance(page, 1);
    expect(afterImpact.player.health).toBe(1_000);
    expect(
      (await page.evaluate(() => window.__GAME_TEST__!.renderManifest()))
        .combatTelegraphs,
    ).toEqual([]);
  });
});
