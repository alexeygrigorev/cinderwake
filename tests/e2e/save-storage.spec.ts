import { expect, test, type Page } from "@playwright/test";

async function begin(page: Page) {
  await page.goto("/?testMode=1&selection=1");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
}

test("save controls explain storage and update the manual checkpoint details", async ({
  page,
}) => {
  await begin(page);
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await expect(page.locator(".save-location")).toContainText(
    "this browser on this device",
  );
  await expect(page.locator(".save-location")).toContainText("another device");
  await expect(page.locator('[data-save-slot="manual"]')).toHaveText(
    "No checkpoint yet",
  );
  await expect(page.locator('[data-save-slot="auto"]')).toContainText(
    "Level 1",
  );
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(page.locator('[data-save-slot="manual"]')).toContainText(
    "Level 1",
  );
  await expect(page.locator('[data-load="manual"]')).toBeEnabled();
  await expect(page.locator("[data-checkpoint-indicator]")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
});

test("storage denial is announced in play before the player opens the journal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage denied");
    };
  });
  await begin(page);
  await expect(page.locator("[data-checkpoint-indicator]")).toHaveText(
    "Save unavailable",
  );
  await expect(page.locator("[data-checkpoint-indicator]")).toBeVisible();
  await expect(page.locator("[data-checkpoint-indicator]")).toHaveAttribute(
    "data-save-state",
    "unavailable",
  );
});

test("victory immediately autosaves and survives a reload without replacing the manual slot", async ({
  page,
}) => {
  await begin(page);
  await page
    .getByRole("button", { name: "Journal and save", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  const manual = await page.evaluate(() =>
    localStorage.getItem("cinderwake.save.v1"),
  );
  const won = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    const state = bridge.snapshot();
    state.phase = "won";
    state.player.health = 1;
    bridge.loadState(state);
    bridge.render();
    return state;
  });
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("cinderwake.autosave.v1")!).state,
    ),
  ).toEqual(won);
  expect(
    await page.evaluate(() => localStorage.getItem("cinderwake.save.v1")),
  ).toBe(manual);
  await page.reload();
  await page
    .getByRole("button", { name: "Continue journey", exact: true })
    .click();
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  expect(await page.evaluate(() => window.__GAME_TEST__!.snapshot())).toEqual(
    won,
  );
});
