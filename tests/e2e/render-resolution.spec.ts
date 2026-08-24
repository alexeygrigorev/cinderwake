import { expect, test } from "@playwright/test";

async function openScenario(page: import("@playwright/test").Page) {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
}

test.describe("DPR-aware canvas backing store", () => {
  test.use({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });

  test("renders two physical pixels per CSS pixel without changing aspect", async ({
    page,
  }) => {
    await openScenario(page);
    const geometry = await page.locator("canvas").evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return {
        backing: { width: canvas.width, height: canvas.height },
        css: { width: rect.width, height: rect.height },
        dpr: window.__GAME_TEST__!.renderManifest().viewport.dpr,
      };
    });

    expect(geometry.backing).toEqual({ width: 1920, height: 1080 });
    expect(geometry.dpr).toBe(2);
    expect(geometry.css.width / geometry.css.height).toBeCloseTo(16 / 9, 4);
    expect(geometry.backing.width / geometry.backing.height).toBeCloseTo(
      16 / 9,
      6,
    );
  });
});

test.describe("portrait mobile crispness", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  test("cover-fit remains uniform and receives a high-resolution backing store", async ({
    page,
  }) => {
    await openScenario(page);
    const geometry = await page.locator("canvas").evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return {
        backing: { width: canvas.width, height: canvas.height },
        css: { width: rect.width, height: rect.height },
        renderScale: window.__GAME_TEST__!.renderManifest().viewport.dpr,
      };
    });

    expect(geometry.css.width / geometry.css.height).toBeCloseTo(16 / 9, 4);
    expect(geometry.backing.width / geometry.backing.height).toBeCloseTo(
      16 / 9,
      6,
    );
    expect(geometry.backing.width).toBeGreaterThanOrEqual(
      geometry.css.width * 1.8,
    );
    expect(geometry.backing.height).toBeGreaterThanOrEqual(
      geometry.css.height * 1.8,
    );
    expect(geometry.renderScale).toBeGreaterThanOrEqual(2.9);
  });
});
