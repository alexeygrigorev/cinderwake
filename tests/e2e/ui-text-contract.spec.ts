import { expect, test, type Page } from "@playwright/test";
import { SPRITE_CATALOG } from "../../src/render/sprites";

const SPRITE_ASSET_COUNT = Object.keys(SPRITE_CATALOG.assets).length;

const ALLOWED_TITLES = new Set([
  "Atlas failed.",
  "Arcanist",
  "Cinderwake",
  "CINDERWAKE",
  "Cinders quieted.",
  "Ranger",
  "Run ended.",
  "Test lab",
  "Vanguard",
]);

async function inspectVisibleText(page: Page): Promise<{
  offenders: string[];
  titles: string[];
}> {
  return page.evaluate(() => {
    const visible = (element: Element): boolean => {
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        )
          return false;
        current = current.parentElement;
      }
      return element.getClientRects().length > 0;
    };
    const offenders: string[] = [],
      titles: string[] = [],
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const value = textNode.textContent?.trim() ?? "";
      const parent = textNode.parentElement;
      if (value && parent && visible(parent)) {
        const title = parent.closest<HTMLElement>("[data-ui-title]");
        if (title) titles.push(value);
        else
          offenders.push(
            `${parent.tagName.toLowerCase()}${parent.id ? `#${parent.id}` : ""}${parent.className ? `.${String(parent.className).replaceAll(" ", ".")}` : ""}: ${value}`,
          );
      }
      textNode = walker.nextNode();
    }
    return { offenders, titles };
  });
}

async function expectTitleOnlyText(page: Page): Promise<void> {
  const audit = await inspectVisibleText(page);
  expect(audit.offenders).toEqual([]);
  expect(audit.titles.every((title) => ALLOWED_TITLES.has(title))).toBe(true);
}

async function expectSpriteBacked(
  page: Page,
  selectors: string[],
): Promise<void> {
  const missing = await page.evaluate((items) => {
    return items.filter((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      return (
        !element || !getComputedStyle(element).backgroundImage.includes("url(")
      );
    });
  }, selectors);
  expect(missing).toEqual([]);
}

test("selection exposes only approved title text and renders the editable seed with glyph sprites", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?testMode=1&selection=1");
  await expect(page.locator(".selection")).toBeVisible();
  await expectTitleOnlyText(page);
  await expectSpriteBacked(page, [
    ".class-portrait",
    ".seed-control",
    ".begin",
    ".selection-lab-toggle",
  ]);

  const seed = page.locator("#seed");
  await seed.fill("ash-123");
  await expect(seed).toHaveValue("ash-123");
  await expect(page.locator(".seed-display .sprite-glyph")).toHaveCount(7);
  const seedPresentation = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#seed")!,
      arcanist = document
        .querySelector<HTMLElement>("[data-class='arcanist']")!
        .getBoundingClientRect(),
      labToggle = document
        .querySelector<HTMLElement>(".selection-lab-toggle")!
        .getBoundingClientRect();
    const overlap = !(
      labToggle.left >= arcanist.right ||
      labToggle.right <= arcanist.left ||
      labToggle.top >= arcanist.bottom ||
      labToggle.bottom <= arcanist.top
    );
    return {
      inputFill: getComputedStyle(input).webkitTextFillColor,
      labPosition: getComputedStyle(
        document.querySelector<HTMLElement>(".selection-lab-toggle")!,
      ).position,
      overlap,
    };
  });
  expect(seedPresentation.inputFill).toBe("rgba(0, 0, 0, 0)");
  expect(seedPresentation.labPosition).toBe("fixed");
  expect(seedPresentation.overlap).toBe(false);
});

test("ordinary selection and gameplay do not expose developer controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".selection-lab-toggle")).toHaveCount(0);
  await page.locator("#seed").fill("qa-enter-0042");
  await page.locator("#seed").press("Enter");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".brand small")).toHaveAttribute(
    "aria-label",
    "qa-enter-0042",
  );
  await expect(page.locator(".game > .lab-toggle")).toHaveCount(0);
});

test("loading, gameplay, outcomes, and Test Lab keep non-title UI on the glyph atlas", async ({
  page,
}) => {
  let releaseEffects: (() => void) | undefined;
  const effectsHeld = new Promise<void>((resolve) => {
    releaseEffects = resolve;
  });
  await page.route("**/assets/sprites/effects.png", async (route) => {
    await effectsHeld;
    await route.continue();
  });
  await page.goto("/?testMode=1&scenario=animation-idle", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".loading")).toBeVisible();
  await expectTitleOnlyText(page);
  await expect(page.locator(".loading-status")).toHaveAttribute(
    "aria-label",
    new RegExp(`Waking the atlas \\d+ / ${SPRITE_ASSET_COUNT}`),
  );

  releaseEffects!();
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  await expectTitleOnlyText(page);
  await expectSpriteBacked(page, [
    ".health b",
    ".skills [data-action='attack']",
    ".mobile-controls",
    ".mobile-actions [data-action='ability']",
    ".loot-log",
    ".game > .lab-toggle",
  ]);

  await page.locator(".game > .lab-toggle").click();
  await expect(page.locator(".lab")).toBeVisible();
  await expectTitleOnlyText(page);
  await expectSpriteBacked(page, [
    ".lab",
    ".scenario-value",
    ".lab [data-lab='scenario-next']",
    ".lab [data-lab='load']",
    ".lab [data-lab='capture']",
  ]);
  const firstScenario = await page
    .locator(".scenario-value")
    .getAttribute("aria-label");
  await page.locator("[data-lab='scenario-next']").click();
  await expect(page.locator(".scenario-value")).not.toHaveAttribute(
    "aria-label",
    firstScenario!,
  );
  const pause = page.locator("[data-lab='pause']");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-label", "Resume");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-label", "Pause");
  await expectTitleOnlyText(page);

  await page.locator(".lab .close").click();
  await page.evaluate(() => {
    window.__GAME_TEST__!.loadScenario("temporal-run-loss");
    window.__GAME_TEST__!.step(48, { render: true });
  });
  await expect(page.locator("#outcome")).toBeVisible();
  await expect(page.locator("#outcome h2")).toHaveText("Run ended.");
  await expectTitleOnlyText(page);
  await expect(page.locator("#outcome button .sprite-glyph")).toHaveCount(8);
});

test("an atlas failure becomes a retryable error instead of an endless loading screen", async ({
  page,
}) => {
  await page.route("**/assets/sprites/actor-vanguard.png", (route) =>
    route.abort("failed"),
  );
  await page.goto("/?testMode=1&selection=1");
  await page.locator("#begin").click();
  await expect(page.locator(".loading-failed")).toBeVisible();
  await expect(page.locator("[data-loading='retry']")).toBeVisible();
  await expect(page.locator("[data-loading='back']")).toBeVisible();
  await page.unroute("**/assets/sprites/actor-vanguard.png");
  await page.locator("[data-loading='retry']").click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("a stalled atlas request reaches a recoverable error deadline", async ({
  page,
}) => {
  let releaseRequest: (() => void) | undefined;
  let finishHandler: (() => void) | undefined;
  const handlerFinished = new Promise<void>((resolve) => {
    finishHandler = resolve;
  });
  await page.route("**/assets/sprites/actor-ranger.png", async (route) => {
    await new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await route.abort("failed");
    finishHandler?.();
  });
  await page.goto("/?testMode=1&selection=1&assetTimeoutMs=150");
  await page.locator("#begin").click();
  await expect(page.locator(".loading-failed")).toBeVisible({
    timeout: 2_000,
  });
  await expect(page.locator(".sprite-loading-error")).toHaveAttribute(
    "aria-label",
    /Timed out loading sprite atlas/,
  );
  await expect(page.locator("[data-loading='retry']")).toBeVisible();
  await expect(page.locator("[data-loading='back']")).toBeVisible();
  releaseRequest?.();
  await handlerFinished;
  await page.unroute("**/assets/sprites/actor-ranger.png");
  await page.locator("[data-loading='back']").click();
  await expect(page.locator(".selection")).toBeVisible();
});
