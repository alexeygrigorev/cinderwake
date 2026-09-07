import { expect, test, type Page } from "@playwright/test";

async function begin(page: Page) {
  await page.goto("/?testMode=1&selection=1");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
}

test("a discovered letter, complete game state and journal survive reload", async ({
  page,
}) => {
  await begin(page);
  await expect(page.locator("#objective")).toHaveAttribute(
    "data-mission",
    "break-ambush",
  );
  await page.getByRole("button", { name: /Read.*sealed letter/ }).click();
  await expect(page.getByRole("dialog")).toContainText("bell keeper");
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await page.evaluate(() => {
    window.__GAME_TEST__!.setInput({ attack: true });
    window.__GAME_TEST__!.step(37, { render: true });
  });
  const before = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("The Last Bell");
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(page.locator("[data-save-status]")).toContainText(
    "Checkpoint saved",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Continue journey", exact: true })
    .click();
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  expect(await page.evaluate(() => window.__GAME_TEST__!.snapshot())).toEqual(
    before,
  );
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Ileya's sealed letter");
  await expect(page.getByRole("dialog")).toContainText(
    "bell keeper has called the dead",
  );
});

test("journal shows real progression and loot feedback only after pickup", async ({
  page,
}) => {
  await begin(page);
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await expect(page.locator(".hero-progress")).toHaveText(
    /Level \d+ · XP \d+\/\d+ · Power \d+ · Supplies \d+ tonics · Gold \d+/,
  );
  await page.getByRole("button", { name: "Back to game", exact: true }).click();

  const beforePickup = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadScenario("temporal-loot-bob");
    return bridge.snapshot();
  });
  expect(beforePickup.eventLog.some(({ type }) => type === "loot_picked")).toBe(
    false,
  );
  await expect(page.locator("#log")).toHaveAttribute(
    "aria-label",
    "The cinders stir.",
  );

  const picked = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadScenario("combat-loot");
    bridge.setInput({ attack: true });
    bridge.step(45, { render: true });
    bridge.setInput({ attack: false, moveX: 1 });
    bridge.step(20, { render: true });
    bridge.clearInput();
    return bridge.snapshot();
  });
  const pickup = picked.eventLog.find(({ type }) => type === "loot_picked");
  expect(pickup).toBeDefined();
  if (!pickup || !pickup.detail || pickup.amount === undefined)
    throw new Error("Expected a real loot pickup event");
  const label =
    pickup.detail === "weapon"
      ? "Power"
      : pickup.detail === "gold"
        ? "Gold"
        : pickup.detail === "tonic"
          ? "Tonic"
          : "Pelt";
  await expect(page.locator("#log")).toHaveAttribute(
    "aria-label",
    new RegExp(`${label} \\+${pickup.amount}(?: /|$)`),
  );
});

test("invalid imported saves leave a good checkpoint intact", async ({
  page,
}) => {
  await begin(page);
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  const saved = await page.evaluate(() =>
    localStorage.getItem("cinderwake.save.v1"),
  );
  await page.locator("input[data-import-save]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.locator("[data-save-status]")).toContainText(
    "Could not import",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("cinderwake.save.v1")),
  ).toBe(saved);
});

test("letter voice actually plays and mute survives a reload", async ({
  page,
}) => {
  await begin(page);
  await page.getByRole("button", { name: /Read.*sealed letter/ }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        window.__GAME_TEST__!.render();
        return JSON.parse(
          document.querySelector<HTMLElement>(".campaign-tools")!.dataset
            .audio!,
        ).played;
      }),
    )
    .toBeGreaterThan(0);
  const audio = await page.evaluate(() =>
    JSON.parse(
      document.querySelector<HTMLElement>(".campaign-tools")!.dataset.audio!,
    ),
  );
  expect(audio.failed).toBe(0);
  expect(audio.lastCue).toBe("quest:arrival");
  await page.getByText("Controls and sound", { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mute sound", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Continue journey", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page.getByText("Controls and sound", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unmute sound", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("exported files restore a checkpoint and menu closure releases movement", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => window.__GAME_TEST__!.step(21));
  await page.keyboard.down("d");
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page.keyboard.up("d");
  const checkpoint = await page.evaluate(() =>
    window.__GAME_TEST__!.snapshot(),
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export save", exact: true }).click();
  const downloaded = await downloading;
  const file = (await downloaded.path())!;
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  const released = await page.evaluate(() =>
    window.__GAME_TEST__!.step(3, { useBrowserInput: true }),
  );
  expect(released.player.position).toEqual(checkpoint.player.position);
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page.locator("input[data-import-save]").setInputFiles(file);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => window.__GAME_TEST__!.snapshot())).toEqual(
    checkpoint,
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cinderwake.autosave.v1")!).state.tick,
    ),
  ).toBe(checkpoint.tick);
  await page.reload();
  await page
    .getByRole("button", { name: "Continue journey", exact: true })
    .click();
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  expect(await page.evaluate(() => window.__GAME_TEST__!.snapshot())).toEqual(
    checkpoint,
  );
});

test("denied browser storage still permits exporting and leaving", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage denied");
    };
  });
  await begin(page);
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(page.locator("[data-save-status]")).toContainText(
    "storage unavailable",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export save", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.json$/);
  await page
    .getByRole("button", { name: "Leave without saving", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start game", exact: true }),
  ).toBeVisible();
});

test("journal pauses the real game, clears held movement, and fits a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?selection=1");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  const toolbar = (await page.locator(".campaign-tools").boundingBox())!;
  for (const selector of [".health", ".mobile-actions", ".move-pad"]) {
    const control = (await page.locator(selector).boundingBox())!;
    const overlap =
      Math.max(
        0,
        Math.min(toolbar.x + toolbar.width, control.x + control.width) -
          Math.max(toolbar.x, control.x),
      ) *
      Math.max(
        0,
        Math.min(toolbar.y + toolbar.height, control.y + control.height) -
          Math.max(toolbar.y, control.y),
      );
    expect(overlap, `journal must not cover ${selector}`).toBe(0);
  }
  await page.screenshot({ path: "quality-results/campaign-play-phone.png" });
  await page.keyboard.down("d");
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page.keyboard.up("d");
  const tick = await page.locator(".campaign-tools").getAttribute("data-tick");
  await page.waitForTimeout(250);
  await expect(page.locator(".campaign-tools")).toHaveAttribute(
    "data-tick",
    tick!,
  );
  const bounds = (await page.getByRole("dialog").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
  await page.screenshot({ path: "quality-results/campaign-journal-phone.png" });
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
