import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  cityNpcWorldAnchor,
  wildernessCityLandmarkAnchor,
} from "../../src/game/cityWorld";
import { tileCenter } from "../../src/game/dungeon";
import {
  CampaignBrowserDriver,
  type CampaignBrowserProfile,
} from "../framework/campaign-browser-driver";

const DESKTOP: CampaignBrowserProfile = {
  id: "desktop",
  viewport: { width: 1_440, height: 900 },
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
};

const PHONE: CampaignBrowserProfile = {
  id: "phone-portrait",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};

async function runJourney(
  page: Page,
  testInfo: TestInfo,
  profile: CampaignBrowserProfile,
): Promise<void> {
  test.setTimeout(330_000);
  const driver = new CampaignBrowserDriver(page, profile);
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push(`console: ${message.text()}`);
  });

  try {
    await driver.start();
    await driver.chooseVanguard("cinder-041");
    let state = await driver.checkpoint(testInfo, "01-opening");
    expect(state).toMatchObject({
      scenarioId: "run:cinder-041",
      phase: "playing",
      city: { locationPhase: "undiscovered" },
    });

    const arrivalLetter = page.getByRole("button", {
      name: /Read: Ileya's sealed letter/,
    });
    await expect(arrivalLetter).toBeVisible({ timeout: 10_000 });
    await arrivalLetter.click();
    await expect(page.getByRole("dialog")).toContainText(
      "bell keeper has called the dead",
    );
    await driver.checkpoint(testInfo, "02-arrival-letter");
    await page
      .getByRole("button", { name: "Back to game", exact: true })
      .click();

    const openingMonsterCount = state.monsters.length;
    state = await driver.defeatAllMonsters();
    expect(
      state.phase,
      JSON.stringify({
        position: state.player.position,
        health: state.player.health,
        tonics: state.player.tonics,
        kills: state.metrics.kills,
        living: state.monsters
          .filter(({ health }) => health > 0)
          .map(({ id, kind, health, position }) => ({
            id,
            kind,
            health,
            position,
          })),
        lastEvents: state.eventLog.slice(-8),
      }),
    ).toBe("playing");
    expect(state.metrics.kills).toBe(openingMonsterCount);
    expect(state.exitUnlocked).toBe(true);
    await driver.checkpoint(testInfo, "03-road-cleared");

    const sign = wildernessCityLandmarkAnchor(state.map);
    state = await driver.moveTo(
      sign,
      "discover Embercross road sign",
      (current) =>
        current.city.locationPhase !== "undiscovered" &&
        Math.hypot(
          current.player.position.x - sign.x,
          current.player.position.y - sign.y,
        ) < 1_600,
    );
    expect(state.city.locationPhase).toBe("discovered");
    await expect(
      page.getByRole("button", { name: /Read: Embercross road sign/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Read: Embercross road sign/ })
      .click();
    await expect(page.getByRole("dialog")).toContainText("EMBERCROSS");
    await driver.checkpoint(testInfo, "04-road-sign");
    await page
      .getByRole("button", { name: "Back to game", exact: true })
      .click();

    state = await driver.moveTo(
      tileCenter(state.map.exit),
      "enter Embercross",
      (current) => current.city.locationPhase === "inside",
    );
    expect(state.city.locationPhase).toBe("inside");
    await driver.checkpoint(testInfo, "05-city-entry");

    const maraAnchor = cityNpcWorldAnchor("npc:embercross:mara");
    state = await driver.moveTo(
      maraAnchor,
      "visit Mara Vale",
      (current) =>
        current.city.nearbyNpcId === "npc:embercross:mara" &&
        Math.hypot(
          current.player.position.x - maraAnchor.x,
          current.player.position.y - maraAnchor.y,
        ) < 1_600,
    );
    expect(state.city.nearbyNpcId).toBe("npc:embercross:mara");
    const maraButton = page.getByRole("button", { name: /Speak:.*Mara/ });
    await expect(maraButton).toBeVisible({ timeout: 10_000 });
    await maraButton.click();
    await expect(page.getByRole("dialog")).toContainText("Mara Vale");
    await expect(page.getByRole("dialog")).toContainText("south gate");
    await driver.checkpoint(testInfo, "06-npc-reading");
    await page
      .getByRole("button", { name: "Back to game", exact: true })
      .click();

    state = await driver.saveAndReload(testInfo);
    expect(state.city.locationPhase).toBe("inside");
    await driver.checkpoint(testInfo, "07-after-reload");
    await page
      .getByRole("button", { name: "Journal and save", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Discovered writings");
    await page.getByText(/Discovered writings and conversations/).click();
    await expect(page.getByRole("dialog")).toContainText("Mara Vale");
    await expect(page.getByRole("dialog")).toContainText("south gate");
    await page
      .getByRole("button", { name: "Back to game", exact: true })
      .click();

    state = await driver.moveTo(
      tileCenter(state.map.exit),
      "seal the rift at the south gate",
      (current) => current.phase === "won",
    );
    expect(state.phase).toBe("won");
    await expect(page.locator("#outcome")).toBeVisible();
    await expect(page.locator("#outcome h2")).toHaveText("Cinders quieted.");
    await driver.checkpoint(testInfo, "08-victory");
    expect(faults).toEqual([]);
  } finally {
    await driver.attachEvidence(testInfo);
    if (faults.length)
      await testInfo.attach(`${profile.id}-faults.json`, {
        body: JSON.stringify(faults, null, 2),
        contentType: "application/json",
      });
  }
}

test.describe("desktop production journey", () => {
  test.use({
    viewport: DESKTOP.viewport,
    deviceScaleFactor: DESKTOP.deviceScaleFactor,
    hasTouch: DESKTOP.hasTouch,
    isMobile: DESKTOP.isMobile,
  });

  test("Vanguard cinder-041 reaches Embercross and seals the rift", async ({
    page,
  }, testInfo) => runJourney(page, testInfo, DESKTOP));
});

test.describe("phone production journey", () => {
  test.use({
    viewport: PHONE.viewport,
    deviceScaleFactor: PHONE.deviceScaleFactor,
    hasTouch: PHONE.hasTouch,
    isMobile: PHONE.isMobile,
  });

  test("Vanguard cinder-041 reaches Embercross and seals the rift", async ({
    page,
  }, testInfo) => runJourney(page, testInfo, PHONE));
});
