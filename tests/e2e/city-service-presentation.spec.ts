import { expect, test, type Page } from "@playwright/test";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  CITY_GATE_ID,
  createInitialCityState,
  transitionCityProgression,
  type CityNpcId,
  type CityServiceActionId,
  type CityServiceDeltasV1,
  type CityTravelerStateV1,
} from "../../src/game/city";
import {
  cityNpcWorldAnchor,
  createEmbercrossMap,
} from "../../src/game/cityWorld";

interface ServicePresentationCase {
  slug: string;
  npcId: CityNpcId;
  actionId: CityServiceActionId;
  validTraveler: Partial<CityTravelerStateV1>;
  rejectedTraveler: Partial<CityTravelerStateV1>;
  rejectionCode: string;
  rejectionMessage: string;
}

const SERVICE_CASES: ServicePresentationCase[] = [
  {
    slug: "mara",
    npcId: "npc:embercross:mara",
    actionId: "merchant:buy-tonic",
    validTraveler: {
      gold: 60,
      health: 70,
      maxHealth: 100,
      tonics: 1,
      hunger: 42,
      fatigue: 31,
      inventory: [{ itemId: "ashfang-pelt", quantity: 2 }],
    },
    rejectedTraveler: { gold: 0 },
    rejectionCode: "insufficient_gold",
    rejectionMessage: "The traveler cannot afford those tonics.",
  },
  {
    slug: "oren",
    npcId: "npc:embercross:oren",
    actionId: "tavern:eat-stew",
    validTraveler: {
      gold: 60,
      health: 95,
      maxHealth: 100,
      hunger: 20,
      fatigue: 35,
    },
    rejectedTraveler: { gold: 60, hunger: 0 },
    rejectionCode: "already_sated",
    rejectionMessage: "The traveler is already fully fed.",
  },
  {
    slug: "tess",
    npcId: "npc:embercross:tess",
    actionId: "inn:sleep-until-dawn",
    validTraveler: {
      gold: 60,
      health: 70,
      maxHealth: 100,
      hunger: 85,
      fatigue: 75,
    },
    rejectedTraveler: {
      gold: 60,
      health: 100,
      maxHealth: 100,
      fatigue: 0,
    },
    rejectionCode: "already_rested",
    rejectionMessage: "The traveler does not need to sleep yet.",
  },
  {
    slug: "ileya",
    npcId: "npc:embercross:ileya",
    actionId: "healer:restore-health",
    validTraveler: { gold: 60, health: 53, maxHealth: 100 },
    rejectedTraveler: { gold: 60, health: 100, maxHealth: 100 },
    rejectionCode: "full_health",
    rejectionMessage: "The traveler is already at full health.",
  },
];

function enteredCity(traveler: Partial<CityTravelerStateV1>) {
  const initial = createInitialCityState({ traveler });
  const discovered = transitionCityProgression(initial, {
    type: "discover_city",
    tick: 1,
    landmarkId: CITY_DISCOVERY_LANDMARK_ID,
  });
  if (!discovered.ok) throw new Error(discovered.message);
  const arrived = transitionCityProgression(discovered.state, {
    type: "arrive_at_gate",
    tick: 2,
    gateId: CITY_GATE_ID,
  });
  if (!arrived.ok) throw new Error(arrived.message);
  const entered = transitionCityProgression(arrived.state, {
    type: "enter_city",
    tick: 3,
    gateId: CITY_GATE_ID,
  });
  if (!entered.ok) throw new Error(entered.message);
  return entered.state;
}

async function bootCity(page: Page): Promise<void> {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
}

async function loadCityAt(
  page: Page,
  npcId: CityNpcId,
  traveler: Partial<CityTravelerStateV1>,
): Promise<void> {
  const city = enteredCity(traveler);
  const playerPosition = cityNpcWorldAnchor(npcId);
  await page.evaluate(
    ({ city, map, playerPosition }) => {
      const state = window.__GAME_TEST__!.snapshot();
      state.tick = city.tick;
      state.map = map;
      state.monsters = [];
      state.pendingAttacks = [];
      state.projectiles = [];
      state.effects = [];
      state.player.position = playerPosition;
      state.player.previousPosition = playerPosition;
      state.player.velocity = { x: 0, y: 0 };
      state.player.gold = city.traveler.gold;
      state.player.health = city.traveler.health;
      state.player.maxHealth = city.traveler.maxHealth;
      state.player.tonics = city.traveler.tonics;
      state.city = city;
      window.__GAME_TEST__!.loadState(state);
    },
    { city, map: createEmbercrossMap(), playerPosition },
  );
}

async function captureServiceCase(
  page: Page,
  profile: "portrait" | "landscape",
  service: ServicePresentationCase,
): Promise<void> {
  await loadCityAt(page, service.npcId, service.validTraveler);
  const sheet = page.locator("#city-services");
  const button = sheet.locator(`[data-city-action='${service.actionId}']`);
  await expect(sheet).toBeVisible();
  await expect(button).toHaveAttribute("data-preview-status", "ok");
  await expect(page.locator(".hud.bottom")).toHaveCSS("display", "none");

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#city-services")!;
    const panelBounds = panel.getBoundingClientRect();
    const text = [...panel.querySelectorAll<HTMLElement>(".sprite-text")];
    const targets = [...panel.querySelectorAll<HTMLElement>("button")];
    const lineEvidence = [
      ...panel.querySelectorAll<HTMLElement>(
        ".sprite-city-detail, .sprite-city-stock, .sprite-city-feedback",
      ),
    ].map((element) => {
      const words = [...element.querySelectorAll<HTMLElement>(".sprite-word")];
      const lines: Array<{ top: number; words: number }> = [];
      for (const word of words) {
        const top = word.getBoundingClientRect().top;
        const line = lines.find(
          (candidate) => Math.abs(candidate.top - top) < 2,
        );
        if (line) line.words += 1;
        else lines.push({ top, words: 1 });
      }
      return {
        className: element.className,
        lineCount: lines.length,
        lastLineWords: lines.at(-1)?.words ?? 0,
        totalWords: words.length,
      };
    });
    const quietFields = targets.map((target) => {
      const field = target.querySelector<HTMLElement>(
        ".city-service-button-copy",
      )!;
      const targetBounds = target.getBoundingClientRect();
      const fieldBounds = field.getBoundingClientRect();
      const textBounds = [
        ...field.querySelectorAll<HTMLElement>(".sprite-text"),
      ].map((text) => text.getBoundingClientRect());
      return {
        backgroundImage: getComputedStyle(field).backgroundImage,
        coversOrnamentCenter:
          fieldBounds.left <= targetBounds.left + targetBounds.width / 2 &&
          fieldBounds.right >= targetBounds.left + targetBounds.width / 2 &&
          fieldBounds.top <= targetBounds.top + targetBounds.height / 2 &&
          fieldBounds.bottom >= targetBounds.top + targetBounds.height / 2,
        containsText: textBounds.every(
          (text) =>
            text.left >= fieldBounds.left - 1 &&
            text.right <= fieldBounds.right + 1 &&
            text.top >= fieldBounds.top - 1 &&
            text.bottom <= fieldBounds.bottom + 1,
        ),
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: {
        left: panelBounds.left,
        top: panelBounds.top,
        right: panelBounds.right,
        bottom: panelBounds.bottom,
      },
      minimumFontSize: Math.min(
        ...text.map((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ),
      targets: targets.map((target) => {
        const bounds = target.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
      lineEvidence,
      quietFields,
    };
  });
  expect(geometry.panel.left).toBeGreaterThanOrEqual(0);
  expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
  expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.minimumFontSize).toBeGreaterThanOrEqual(13);
  expect(
    geometry.targets.every(({ width, height }) => width >= 48 && height >= 48),
  ).toBe(true);
  expect(
    geometry.quietFields.every(
      ({ backgroundImage, coversOrnamentCenter, containsText }) =>
        backgroundImage.includes("ui-service-field.png") &&
        coversOrnamentCenter &&
        containsText,
    ),
  ).toBe(true);
  for (const lines of geometry.lineEvidence) {
    expect(lines.lineCount, lines.className).toBeLessThanOrEqual(2);
    if (lines.totalWords > 1)
      expect(lines.lastLineWords, lines.className).toBeGreaterThanOrEqual(2);
  }

  const previewDeltas = JSON.parse(
    (await button.getAttribute("data-preview-deltas"))!,
  ) as CityServiceDeltasV1;
  const actionLabel = await button
    .locator(".sprite-city-action")
    .getAttribute("aria-label");
  await expect(sheet).toHaveScreenshot(
    `city-service-${service.slug}-${profile}-before.png`,
  );

  const bounds = await button.boundingBox();
  if (!bounds) throw new Error(`${service.actionId} has no pointer bounds`);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const idleFilter = await button.evaluate(
    (element) => getComputedStyle(element).filter,
  );
  await page.mouse.down();
  const pressedFilter = await button.evaluate(
    (element) => getComputedStyle(element).filter,
  );
  expect(pressedFilter).not.toBe(idleFilter);
  await expect(sheet).toHaveScreenshot(
    `city-service-${service.slug}-${profile}-pointer-down.png`,
  );
  await page.mouse.up();
  await expect(page.locator(".city-service-feedback")).toHaveAttribute(
    "aria-label",
    `${actionLabel} complete`,
  );
  const after = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
  expect(after.city.receipts.at(-1)?.deltas).toEqual(previewDeltas);
  await expect(sheet).toHaveScreenshot(
    `city-service-${service.slug}-${profile}-success.png`,
  );

  await loadCityAt(page, service.npcId, service.rejectedTraveler);
  const rejectedButton = sheet.locator(
    `[data-city-action='${service.actionId}']`,
  );
  await expect(rejectedButton).toHaveAttribute(
    "data-preview-status",
    "rejected",
  );
  await expect(rejectedButton).toHaveAttribute(
    "data-preview-rejection",
    service.rejectionCode,
  );
  await rejectedButton.tap();
  await expect(page.locator(".city-service-feedback")).toHaveAttribute(
    "aria-label",
    service.rejectionMessage,
  );
  const rejectedState = await page.evaluate(() =>
    window.__GAME_TEST__!.snapshot(),
  );
  expect(rejectedState.city.receipts).toHaveLength(0);
  await expect(sheet).toHaveScreenshot(
    `city-service-${service.slug}-${profile}-rejection.png`,
  );
}

for (const profile of [
  { id: "portrait" as const, viewport: { width: 390, height: 844 } },
  { id: "landscape" as const, viewport: { width: 844, height: 390 } },
]) {
  test.describe(`city service presentation ${profile.id}`, () => {
    test.use({
      viewport: profile.viewport,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });

    test(`captures truthful ordered ${profile.id} service feedback for every resident`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await bootCity(page);
      for (const service of SERVICE_CASES)
        await captureServiceCase(page, profile.id, service);
    });
  });
}
