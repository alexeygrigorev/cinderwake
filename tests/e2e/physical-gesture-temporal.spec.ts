import {
  expect,
  test,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";

type ObserverSnapshot = ReturnType<
  NonNullable<Window["__GAME_OBSERVE__"]>["snapshot"]
>;

type GestureEvidence = {
  initial: ObserverSnapshot;
  afterMovement: ObserverSnapshot;
  afterStrike: ObserverSnapshot;
  presentationTicks: number[];
};

async function startProductionRun(page: Page, classId: string): Promise<void> {
  await page.goto("/");
  await page.locator(`[data-class='${classId}']`).click();
  await page.locator("#begin").click();
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));

  expect(await page.evaluate(() => "__GAME_TEST__" in window)).toBe(false);
  expect(await page.evaluate(() => window.__GAME_OBSERVE__?.mode)).toBe(
    "observe-only",
  );
}

async function attachCanvasFrame(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<string> {
  const dataUrl = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.captureFrame(),
  );
  await testInfo.attach(`${name}.png`, {
    body: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
    contentType: "image/png",
  });
  return dataUrl;
}

function playerAttackCount(snapshot: ObserverSnapshot): number {
  return snapshot.eventLog.filter(
    ({ type, sourceId }) => type === "attack_started" && sourceId === "player",
  ).length;
}

async function attachEvidence(
  page: Page,
  testInfo: TestInfo,
  evidence: GestureEvidence,
): Promise<void> {
  const presentationTicks = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.presentationSamples().map(({ tick }) => tick),
  );
  evidence.presentationTicks = presentationTicks;
  await testInfo.attach("physical-gesture-evidence.json", {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: "application/json",
  });
}

async function beginTouchDrag(
  session: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...to, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
}

async function endTouchDrag(session: CDPSession): Promise<void> {
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("desktop keyboard movement, canvas strike, and Strike button advance the production route", async ({
  page,
}, testInfo) => {
  await startProductionRun(page, "vanguard");
  const initial = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.snapshot(),
  );
  const openingFrame = await attachCanvasFrame(
    page,
    testInfo,
    "desktop-01-opening",
  );

  await page.evaluate(() =>
    window.__GAME_OBSERVE__!.clearPresentationSamples(),
  );
  await page.keyboard.down("d");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__GAME_OBSERVE__!.snapshot().player.position.x,
        ),
      { timeout: 1_500 },
    )
    .toBeGreaterThan(initial.player.position.x);
  await page.waitForTimeout(450);
  await page.keyboard.up("d");
  const movementSamples = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.presentationSamples(),
  );
  const walkingEast = movementSamples.filter(
    ({ playerClip, playerFacingBucket }) =>
      playerClip === "walk" && playerFacingBucket === "east",
  );
  expect(walkingEast.length).toBeGreaterThan(4);
  expect(
    new Set(walkingEast.map(({ playerFrameIdentity }) => playerFrameIdentity))
      .size,
  ).toBeGreaterThanOrEqual(2);
  const playerScreenXs = walkingEast.flatMap(({ playerScreenAnchor }) =>
    playerScreenAnchor ? [playerScreenAnchor.x] : [],
  );
  expect(
    Math.max(...playerScreenXs) - Math.min(...playerScreenXs),
  ).toBeGreaterThan(12);
  const forgeSamples = walkingEast.flatMap(({ referenceScene }) =>
    referenceScene ? [referenceScene.screenAnchor.x] : [],
  );
  expect(forgeSamples.at(-1)!).toBeLessThan(forgeSamples[0]!);
  const afterMovement = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.snapshot(),
  );
  expect(playerAttackCount(afterMovement)).toBe(playerAttackCount(initial));
  const movementFrame = await attachCanvasFrame(
    page,
    testInfo,
    "desktop-02-after-keyboard-movement",
  );
  expect(movementFrame).not.toBe(openingFrame);

  // This is a physical mouse gesture on the desktop game canvas. It should be
  // interpreted as an attack, rather than a touch-route command.
  const canvas = page.locator("canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas has no bounds");
  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.7,
    canvasBox.y + canvasBox.height * 0.5,
  );
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
      { timeout: 1_500 },
    )
    .toBe(true);
  const afterMouseStrike = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.snapshot(),
  );
  expect(afterMouseStrike.player.position).toEqual(
    afterMovement.player.position,
  );
  expect(playerAttackCount(afterMouseStrike)).toBeGreaterThan(
    playerAttackCount(afterMovement),
  );

  await page.waitForTimeout(600);
  await page.locator(".skills [data-action='attack']").click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window
              .__GAME_OBSERVE__!.snapshot()
              .eventLog.filter(
                ({ type, sourceId }) =>
                  type === "attack_started" && sourceId === "player",
              ).length,
        ),
      { timeout: 1_500 },
    )
    .toBeGreaterThan(playerAttackCount(afterMouseStrike));
  await page.waitForTimeout(120);
  const afterStrike = await page.evaluate(() =>
    window.__GAME_OBSERVE__!.snapshot(),
  );
  expect(afterStrike.tick).toBeGreaterThan(afterMouseStrike.tick);
  expect(afterStrike.player.position).toEqual(afterMouseStrike.player.position);
  const strikeFrame = await attachCanvasFrame(
    page,
    testInfo,
    "desktop-03-after-strike-button",
  );
  expect(strikeFrame).not.toBe(movementFrame);
  await attachEvidence(page, testInfo, {
    initial,
    afterMovement,
    afterStrike,
    presentationTicks: [],
  });
});

test.describe("mobile physical gestures", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  test("touch ground route and joystick move, while the Strike button only attacks", async ({
    page,
  }, testInfo) => {
    await startProductionRun(page, "ranger");
    const initial = await page.evaluate(() =>
      window.__GAME_OBSERVE__!.snapshot(),
    );
    const openingFrame = await attachCanvasFrame(
      page,
      testInfo,
      "mobile-01-opening",
    );

    const targets = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
      const rect = canvas.getBoundingClientRect();
      const player = window
        .__GAME_OBSERVE__!.renderManifest()
        .drawCalls.find(({ entityId }) => entityId === "player")!;
      const playerClient = {
        x: rect.left + (player.screenAnchor.x / 960) * rect.width,
        y: rect.top + (player.screenAnchor.y / 540) * rect.height,
      };
      const offset = 128;
      return [
        { x: playerClient.x + offset, y: playerClient.y },
        { x: playerClient.x - offset, y: playerClient.y },
        { x: playerClient.x, y: playerClient.y + offset },
        { x: playerClient.x, y: playerClient.y - offset },
      ].filter(
        ({ x, y }) =>
          x >= rect.left + 20 &&
          x <= rect.right - 20 &&
          y >= rect.top + 20 &&
          y <= rect.bottom - 20,
      );
    });
    let afterGroundRoute: typeof initial | undefined;
    for (const target of targets) {
      await page.touchscreen.tap(target.x, target.y);
      try {
        await page.waitForFunction(
          (before) => {
            const position =
              window.__GAME_OBSERVE__!.snapshot().player.position;
            return position.x !== before.x || position.y !== before.y;
          },
          initial.player.position,
          { timeout: 700 },
        );
        afterGroundRoute = await page.evaluate(() =>
          window.__GAME_OBSERVE__!.snapshot(),
        );
        break;
      } catch {
        // The generated opening may put one cardinal target behind scenery.
      }
    }
    expect(
      afterGroundRoute,
      "a physical ground touch should find a live route",
    ).toBeDefined();
    if (!afterGroundRoute)
      throw new Error("No reachable on-canvas ground target");
    expect(playerAttackCount(afterGroundRoute)).toBe(
      playerAttackCount(initial),
    );
    const routeFrame = await attachCanvasFrame(
      page,
      testInfo,
      "mobile-02-after-ground-route",
    );
    expect(routeFrame).not.toBe(openingFrame);

    const pad = page.locator(".move-pad");
    const padBox = await pad.boundingBox();
    if (!padBox) throw new Error("Movement pad has no bounds");
    const touchSession = await page.context().newCDPSession(page);
    await beginTouchDrag(
      touchSession,
      {
        x: padBox.x + padBox.width / 2,
        y: padBox.y + padBox.height / 2,
      },
      {
        x: padBox.x + padBox.width * 0.88,
        y: padBox.y + padBox.height / 2,
      },
    );
    try {
      await expect(pad).toHaveAttribute("data-direction", "1,0");
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__GAME_OBSERVE__!.snapshot().player.position.x,
            ),
          { timeout: 1_500 },
        )
        .toBeGreaterThan(afterGroundRoute.player.position.x);
    } finally {
      await endTouchDrag(touchSession);
      await touchSession.detach();
    }
    const afterMovement = await page.evaluate(() =>
      window.__GAME_OBSERVE__!.snapshot(),
    );
    expect(playerAttackCount(afterMovement)).toBe(playerAttackCount(initial));

    await page.locator(".mobile-actions [data-action='attack']").tap();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window
                .__GAME_OBSERVE__!.snapshot()
                .eventLog.filter(
                  ({ type, sourceId }) =>
                    type === "attack_started" && sourceId === "player",
                ).length,
          ),
        { timeout: 1_500 },
      )
      .toBeGreaterThan(playerAttackCount(afterMovement));
    await page.waitForTimeout(120);
    const afterStrike = await page.evaluate(() =>
      window.__GAME_OBSERVE__!.snapshot(),
    );
    expect(afterStrike.player.position).toEqual(afterMovement.player.position);
    expect(afterStrike.tick).toBeGreaterThan(afterMovement.tick);
    await attachCanvasFrame(page, testInfo, "mobile-03-after-strike");
    await attachEvidence(page, testInfo, {
      initial,
      afterMovement,
      afterStrike,
      presentationTicks: [],
    });
  });
});
