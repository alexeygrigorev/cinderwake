import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

test("ordinary production route advances in real time and opens on a visible encounter", async ({
  page,
}) => {
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push(`console: ${message.text()}`);
  });

  await page.goto("/");
  await page.locator("[data-class='ranger']").tap();
  await page.locator("#begin").tap();
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));

  expect(await page.evaluate(() => Boolean(window.__GAME_TEST__))).toBe(false);
  expect(await page.evaluate(() => window.__GAME_OBSERVE__?.mode)).toBe(
    "observe-only",
  );
  const initial = await page.evaluate(() => {
    const observer = window.__GAME_OBSERVE__!;
    const state = observer.snapshot();
    const openingSample = observer
      .presentationSamples()
      .sort(
        (first, second) =>
          first.tick - second.tick || first.observedAtMs - second.observedAtMs,
      )[0]!;
    observer.clearPresentationSamples();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    const controls = document.querySelector<HTMLElement>(".mobile-controls")!;
    const canvasRect = canvas.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const openingRects = openingSample.visibleMonsters
      .filter(({ entityId }) => ["monster:00", "monster:01"].includes(entityId))
      .map(({ entityId, destinationRect }) => ({
        id: entityId,
        left:
          canvasRect.left +
          (destinationRect.x / canvas.width) * canvasRect.width,
        top:
          canvasRect.top +
          (destinationRect.y / canvas.height) * canvasRect.height,
        right:
          canvasRect.left +
          ((destinationRect.x + destinationRect.width) / canvas.width) *
            canvasRect.width,
        bottom:
          canvasRect.top +
          ((destinationRect.y + destinationRect.height) / canvas.height) *
            canvasRect.height,
      }));
    const deviceSpaceViolations = openingRects.flatMap((rect) =>
      rect.left < 0 ||
      rect.right > innerWidth ||
      rect.top < 0 ||
      rect.bottom > controlsRect.top
        ? [`${rect.id}:outside-unobstructed-device-space`]
        : [],
    );
    const openingHealth = openingSample.monsterHealth.filter(({ ownerId }) =>
      ["monster:00", "monster:01"].includes(ownerId),
    );
    const healthAnchorViolations = openingHealth.flatMap((health) => {
      const actor = openingSample.visibleMonsters.find(
        ({ entityId }) => entityId === health.ownerId,
      );
      if (!actor) return [`${health.ownerId}:missing-actor`];
      const gap =
        health.actorInkTop -
        (health.destinationRect.y + health.destinationRect.height);
      const centerDelta = Math.abs(
        health.destinationRect.x +
          health.destinationRect.width / 2 -
          (actor.destinationRect.x + actor.destinationRect.width / 2),
      );
      return gap < 2 || gap > 4 || centerDelta > 1
        ? [`${health.ownerId}:detached-health-bar`]
        : [];
    });
    const firstAshfang = openingHealth.find(
      ({ ownerId }) => ownerId === "monster:01",
    );
    const firstAshfangCall = openingSample.visibleMonsters.find(
      ({ entityId }) => entityId === "monster:01",
    );
    const rejectedCellTopGap =
      firstAshfang && firstAshfangCall
        ? firstAshfang.actorInkTop - (firstAshfangCall.destinationRect.y + 2)
        : 0;
    for (let first = 0; first < openingRects.length; first += 1) {
      for (let second = first + 1; second < openingRects.length; second += 1) {
        const one = openingRects[first]!;
        const two = openingRects[second]!;
        const intersectionWidth = Math.max(
          0,
          Math.min(one.right, two.right) - Math.max(one.left, two.left),
        );
        const intersectionHeight = Math.max(
          0,
          Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top),
        );
        const oneArea = (one.right - one.left) * (one.bottom - one.top);
        const twoArea = (two.right - two.left) * (two.bottom - two.top);
        if (
          (intersectionWidth * intersectionHeight) /
            Math.min(oneArea, twoArea) >
          0.2
        )
          deviceSpaceViolations.push(`${one.id}:${two.id}:visually-stacked`);
      }
    }
    return {
      tick: state.tick,
      visibleMonsters: openingSample.visibleMonsterIds.length,
      objectiveTarget:
        document.querySelector<HTMLElement>("#objective")?.dataset.targetId,
      objectiveState:
        document.querySelector<HTMLElement>("#objective")?.dataset.state,
      openingCount: openingRects.length,
      deviceSpaceViolations,
      openingHealthCount: openingHealth.length,
      healthAnchorViolations,
      rejectedCellTopGap,
    };
  });
  expect(initial.visibleMonsters).toBe(2);
  expect(initial.objectiveTarget).toMatch(/^monster:/);
  expect(initial.objectiveState).toBe("hunt");
  expect(initial.openingCount).toBe(2);
  expect(initial.deviceSpaceViolations).toEqual([]);
  expect(initial.openingHealthCount).toBe(2);
  expect(initial.healthAnchorViolations).toEqual([]);
  expect(initial.rejectedCellTopGap).toBeGreaterThanOrEqual(15);

  await page.waitForTimeout(1_250);
  const live = await page.evaluate(() => {
    const observer = window.__GAME_OBSERVE__!;
    const samples = observer.presentationSamples();
    const state = observer.snapshot();
    const longestRealGap = samples
      .slice(1)
      .reduce(
        (maximum, sample, index) =>
          Math.max(maximum, sample.observedAtMs - samples[index]!.observedAtMs),
        0,
      );
    return {
      tick: state.tick,
      samples: samples.length,
      longestRealGap,
      distinctPresentationTicks: new Set(
        samples.map(
          ({ presentationTick }) => Math.floor(presentationTick * 100) / 100,
        ),
      ).size,
      everVisibleThreat: samples.some(
        ({ visibleMonsterIds }) => visibleMonsterIds.length > 0,
      ),
    };
  });
  expect(live.tick - initial.tick).toBeGreaterThanOrEqual(45);
  expect(live.samples).toBeGreaterThan(20);
  expect(live.longestRealGap).toBeLessThan(500);
  expect(live.distinctPresentationTicks).toBeGreaterThan(20);
  expect(live.everVisibleThreat).toBe(true);
  expect(faults).toEqual([]);
});

test("ordinary touch movement and Strike produce different live outcomes", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#begin").tap();
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  const destination = await page.evaluate(() => {
    const observer = window.__GAME_OBSERVE__!;
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    const player = observer
      .renderManifest()
      .drawCalls.find(({ entityId }) => entityId === "player")!;
    return {
      x: canvas.left + ((player.screenAnchor.x + 72) / 960) * canvas.width,
      y: canvas.top + (player.screenAnchor.y / 540) * canvas.height,
      before: observer.snapshot(),
    };
  });
  await page.touchscreen.tap(destination.x, destination.y);
  await page.waitForTimeout(350);
  const moved = await page.evaluate(() => window.__GAME_OBSERVE__!.snapshot());
  expect(moved.player.position.x).toBeGreaterThan(
    destination.before.player.position.x,
  );
  expect(
    moved.eventLog.some(
      ({ type, sourceId }) =>
        type === "attack_started" && sourceId === "player",
    ),
  ).toBe(false);

  await page.locator(".mobile-actions [data-action='attack']").tap();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window
            .__GAME_OBSERVE__!.snapshot()
            .eventLog.some(
              ({ type, sourceId }) =>
                type === "attack_started" && sourceId === "player",
            ),
        ),
      { timeout: 1_000 },
    )
    .toBe(true);
});
