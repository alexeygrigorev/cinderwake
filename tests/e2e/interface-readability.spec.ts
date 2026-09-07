import { expect, test, type Page } from "@playwright/test";
import { CampaignBrowserDriver } from "../framework/campaign-browser-driver";

test("shared production driver launches through Start and optional world settings", async ({
  page,
}) => {
  const driver = new CampaignBrowserDriver(page, {
    id: "desktop",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  });
  await driver.start();
  await driver.chooseVanguard("driver-ui-smoke");
  await expect(page.locator(".brand small")).toHaveAttribute(
    "aria-label",
    "driver-ui-smoke",
  );
});

const profiles = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "narrow-desktop", width: 800, height: 600, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "small-phone", width: 320, height: 568, touch: true },
  { name: "phone-landscape", width: 844, height: 390, touch: true },
];

async function overlapArea(
  page: Page,
  firstSelector: string,
  secondSelector: string,
) {
  const first = (await page.locator(firstSelector).boundingBox())!;
  const second = (await page.locator(secondSelector).boundingBox())!;
  return (
    Math.max(
      0,
      Math.min(first.x + first.width, second.x + second.width) -
        Math.max(first.x, second.x),
    ) *
    Math.max(
      0,
      Math.min(first.y + first.height, second.y + second.height) -
        Math.max(first.y, second.y),
    )
  );
}

for (const width of [780, 800, 900]) {
  test(`${width}px desktop separates save status, objective, helper and Strike`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/?captureMode=1");
    await page.locator("#begin").click();
    await expect(page.locator("[data-checkpoint-indicator]")).toHaveText(
      "Saved here",
    );
    expect(
      await overlapArea(page, "[data-checkpoint-indicator]", "#objective"),
    ).toBe(0);
    expect(
      await overlapArea(
        page,
        ".quick-controls",
        ".skills [data-action='attack']",
      ),
    ).toBe(0);

    if (width !== 800) return;
    // Recreate each reviewed regression independently; an oversized toolbar
    // must expose its status/objective collision, and the old hint offset must
    // expose its collision with Strike rather than silently passing.
    await page.locator(".campaign-tools").evaluate((element) => {
      (element as HTMLElement).style.maxWidth = "calc(100vw - 32px)";
    });
    expect(
      await overlapArea(page, "[data-checkpoint-indicator]", "#objective"),
    ).toBeGreaterThan(0);
    await page.locator(".quick-controls").evaluate((element) => {
      (element as HTMLElement).style.bottom = "94px";
    });
    expect(
      await overlapArea(
        page,
        ".quick-controls",
        ".skills [data-action='attack']",
      ),
    ).toBeGreaterThan(0);
  });
}

for (const profile of profiles) {
  test(`${profile.name}: a new player can find Start and read controls`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await page.goto(testInfo.project.use.baseURL!);
    const start = page.getByRole("button", { name: "Start game", exact: true });
    const bounds = (await start.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(profile.height);
    const appearance = await start.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        color: style.color,
        fontSize: parseFloat(style.fontSize),
        text: button.textContent,
      };
    });
    expect(appearance.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(appearance.color).not.toBe(appearance.background);
    expect(appearance.fontSize).toBeGreaterThanOrEqual(18);
    expect(appearance.text).toContain("Start game");
    await page.locator('[data-class="ranger"]').click();
    await expect(page.locator('[data-class="ranger"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.locator('[data-class="ranger"] .class-choice'),
    ).toHaveText("✓ Selected");
    await expect(page.locator('[data-class="vanguard"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.screenshot({ path: testInfo.outputPath("selection.png") });
    await start.click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "How to play" }),
    ).toBeVisible();
    await expect(page.locator("[data-sound-toggle]")).toBeVisible();
    const toolbar = (await page.locator(".campaign-tools").boundingBox())!;
    const objective = (await page.locator("#objective").boundingBox())!;
    const overlap =
      Math.max(
        0,
        Math.min(toolbar.x + toolbar.width, objective.x + objective.width) -
          Math.max(toolbar.x, objective.x),
      ) *
      Math.max(
        0,
        Math.min(toolbar.y + toolbar.height, objective.y + objective.height) -
          Math.max(toolbar.y, objective.y),
      );
    expect(overlap).toBe(0);
    const glyphProblems = await page
      .locator(".sprite-word")
      .evaluateAll((words) =>
        words.flatMap((word) => {
          if (!(word as HTMLElement).checkVisibility()) return [];
          const glyphs = [
            ...word.querySelectorAll<HTMLElement>(".sprite-glyph"),
          ];
          return glyphs.flatMap((glyph, index) => {
            const box = glyph.getBoundingClientRect();
            const previous = glyphs[index - 1]?.getBoundingClientRect();
            const style = getComputedStyle(glyph);
            return parseFloat(style.fontSize) < 14 ||
              (previous && box.x < previous.right - 0.5)
              ? [word.textContent]
              : [];
          });
        }),
      );
    expect(glyphProblems).toEqual([]);
    const attack = page.locator(
      profile.touch
        ? ".mobile-actions .primary-action"
        : ".skills [data-action='attack']",
    );
    const attackBounds = (await attack.boundingBox())!;
    expect(attackBounds.width).toBeGreaterThanOrEqual(44);
    expect(attackBounds.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath("gameplay.png") });
    await context.close();
  });
}
