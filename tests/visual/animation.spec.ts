import { expect, test, type Page } from "@playwright/test";

async function expectRawCanvasSnapshot(
  page: Page,
  name: string,
): Promise<void> {
  const dataUrl = await page.evaluate(() =>
    window.__GAME_TEST__!.captureFrame(),
  );
  expect(Buffer.from(dataUrl.split(",")[1]!, "base64")).toMatchSnapshot(name);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("character selection is stable with decoded local key art", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".selection-art").waitFor();
  const spriteUrls = await page
    .locator(
      ".selection-art, .class-portrait, .seed-control, .begin, .selection-lab-toggle, .sprite-glyph",
    )
    .evaluateAll((elements) => [
      ...new Set(
        elements
          .map((element) => {
            const match = getComputedStyle(element).backgroundImage.match(
              /url\(["']?(.*?)["']?\)/,
            );
            return match?.[1] ?? "";
          })
          .filter(Boolean),
      ),
    ]);
  expect(spriteUrls.length).toBeGreaterThanOrEqual(5);
  await page.evaluate(async (urls) => {
    await Promise.all(
      urls.map(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (image.naturalWidth === 0) throw new Error(`Empty sprite: ${url}`);
      }),
    );
  }, spriteUrls);
  const layout = await page.evaluate(() => {
    const selection = document.querySelector<HTMLElement>(".selection")!;
    const choose = document.querySelector<HTMLElement>(".choose")!;
    const title = document
      .querySelector<HTMLElement>(".selection-header h1")!
      .getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>(".class-card")];
    const chooseBox = choose.getBoundingClientRect();
    return {
      selectionHeight: selection.getBoundingClientRect().height,
      viewportHeight: innerHeight,
      titleContained: title.left >= 0 && title.right <= innerWidth,
      controlsContained:
        chooseBox.left >= 0 &&
        chooseBox.right <= innerWidth &&
        chooseBox.bottom <= innerHeight,
      portraitsFillCards: cards.every((card) => {
        const cardBox = card.getBoundingClientRect();
        const portraitBox = card
          .querySelector<HTMLElement>(".class-portrait")!
          .getBoundingClientRect();
        return (
          Math.abs(portraitBox.width - cardBox.width) <= 2 &&
          Math.abs(portraitBox.height - cardBox.height) <= 2
        );
      }),
      wordsStayWhole: [...document.querySelectorAll(".sprite-word")].every(
        (word) =>
          new Set(
            [...word.querySelectorAll(".sprite-glyph")].map(
              (glyph) => glyph.getBoundingClientRect().top,
            ),
          ).size <= 1,
      ),
    };
  });
  expect(layout.selectionHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.titleContained).toBe(true);
  expect(layout.controlsContained).toBe(true);
  expect(layout.portraitsFillCards).toBe(true);
  expect(layout.wordsStayWhole).toBe(true);
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

test("walk is monotonic and the glyph advances in the movement direction", async ({
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
  const screenDeltas = calls
    .slice(1)
    .map((call, index) => call.footAnchor.x - calls[index]!.footAnchor.x);
  expect(screenDeltas.every((delta) => delta >= 0)).toBe(true);
  expect(Math.max(...screenDeltas)).toBeLessThanOrEqual(3.1);
  expect(calls.at(-1).footAnchor.x - calls[0].footAnchor.x).toBeGreaterThan(30);
  expect(new Set(calls.map((call) => call.footAnchor.y)).size).toBe(1);
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
  await expectRawCanvasSnapshot(page, "animation-walk-tick-60.png");
});

test("combat impact and injected mid-action states render stable screenshots", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("combat-loot");
    window.__GAME_TEST__!.render();
  });
  await expectRawCanvasSnapshot(page, "combat-loot-initial.png");
  await page.evaluate(() => {
    window.__GAME_TEST__!.setInput({ attack: true });
    window.__GAME_TEST__!.step(9, { render: true });
  });
  await expectRawCanvasSnapshot(page, "combat-loot-impact.png");
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
  await expectRawCanvasSnapshot(page, "mid-action-injected.png");
});
