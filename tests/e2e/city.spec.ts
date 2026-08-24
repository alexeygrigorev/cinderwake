import { expect, test, type Page } from "@playwright/test";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  CITY_GATE_ID,
  createInitialCityState,
  transitionCityProgression,
  type CityNpcId,
  type CityServiceActionId,
  type CityTravelerStateV1,
} from "../../src/game/city";
import {
  cityNpcWorldAnchor,
  createEmbercrossMap,
} from "../../src/game/cityWorld";

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

function enteredCity(traveler: Partial<CityTravelerStateV1> = {}) {
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

async function loadCityAt(
  page: Page,
  npcId: CityNpcId,
  traveler: Partial<CityTravelerStateV1> = {},
  playerOffset = { x: 0, y: 0 },
): Promise<void> {
  const city = enteredCity(traveler);
  const anchor = cityNpcWorldAnchor(npcId);
  const playerPosition = {
    x: anchor.x + playerOffset.x,
    y: anchor.y + playerOffset.y,
  };
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

async function bootCity(page: Page): Promise<void> {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
}

const SERVICE_CASES: Array<{
  npcId: CityNpcId;
  actionId: CityServiceActionId;
  traveler: Partial<CityTravelerStateV1>;
  expected: Partial<CityTravelerStateV1>;
}> = [
  {
    npcId: "npc:embercross:mara",
    actionId: "merchant:buy-tonic",
    traveler: { gold: 60, tonics: 1 },
    expected: { gold: 42, tonics: 2 },
  },
  {
    npcId: "npc:embercross:mara",
    actionId: "merchant:sell-ashfang-pelt",
    traveler: {
      gold: 40,
      inventory: [{ itemId: "ashfang-pelt", quantity: 2 }],
    },
    expected: {
      gold: 49,
      inventory: [{ itemId: "ashfang-pelt", quantity: 1 }],
    },
  },
  {
    npcId: "npc:embercross:oren",
    actionId: "tavern:eat-stew",
    traveler: { gold: 60, health: 50, maxHealth: 100, hunger: 80 },
    expected: { gold: 54, health: 65, hunger: 35 },
  },
  {
    npcId: "npc:embercross:tess",
    actionId: "inn:sleep-until-dawn",
    traveler: {
      gold: 60,
      health: 70,
      maxHealth: 100,
      hunger: 35,
      fatigue: 75,
    },
    expected: { gold: 40, health: 100, hunger: 60, fatigue: 0 },
  },
  {
    npcId: "npc:embercross:ileya",
    actionId: "healer:restore-health",
    traveler: { gold: 60, health: 50, maxHealth: 100 },
    expected: { gold: 45, health: 100 },
  },
];

test("every restored city service is reachable through a real mobile button", async ({
  page,
}) => {
  await bootCity(page);
  for (const service of SERVICE_CASES) {
    await loadCityAt(page, service.npcId, service.traveler);
    const button = page.locator(`[data-city-action='${service.actionId}']`);
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds?.height, service.actionId).toBeGreaterThanOrEqual(48);
    await button.tap();
    const state = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
    expect(state.city.receipts.at(-1), service.actionId).toMatchObject({
      npcId: service.npcId,
      actionId: service.actionId,
    });
    expect(state.city.traveler, service.actionId).toMatchObject(
      service.expected,
    );
    expect(state.player, service.actionId).toMatchObject({
      gold: state.city.traveler.gold,
      health: state.city.traveler.health,
      maxHealth: state.city.traveler.maxHealth,
      tonics: state.city.traveler.tonics,
    });
  }
});

test("portrait city composition uses reviewed sprites and stable idle frames", async ({
  page,
}) => {
  await bootCity(page);
  await loadCityAt(
    page,
    "npc:embercross:mara",
    {
      gold: 60,
      health: 70,
      maxHealth: 100,
      tonics: 1,
    },
    { x: -1_500, y: 1_300 },
  );
  const evidence = await page.evaluate(() => {
    const manifest = window.__GAME_TEST__!.renderManifest();
    const cityIds = [
      "building:embercross:market",
      "building:embercross:tavern",
      "building:embercross:infirmary",
      "gate:embercross:south",
      "prop:embercross:inn-bed",
    ];
    const sequences = window.__GAME_TEST__!.captureSequence([
      3, 18, 33, 48, 63,
    ]);
    const residentIds = [
      "npc:embercross:mara",
      "npc:embercross:oren",
      "npc:embercross:tess",
      "npc:embercross:ileya",
    ];
    return {
      scenes: cityIds.map((id) => {
        const scene = manifest.sceneSprites.find(
          ({ objectId }) => objectId === id,
        );
        return {
          id,
          spriteId: scene?.spriteId,
          assetId: scene?.assetId,
          destinationRect: scene?.destinationRect,
          collisionParts: scene?.collisionParts?.length ?? 0,
        };
      }),
      hasLegacyExit: manifest.sceneSprites.some(
        ({ objectId }) => objectId === "exit:rift-gate",
      ),
      residents: sequences.map(({ manifest: frame }) =>
        frame.drawCalls
          .filter(({ type }) => type === "npc")
          .map(
            ({
              entityId,
              spriteId,
              assetId,
              clip,
              frameIndex,
              frameCount,
              frameIdentity,
              sourceRect,
              destinationRect,
              footAnchor,
            }) => ({
              entityId,
              spriteId,
              assetId,
              clip,
              frameIndex,
              frameCount,
              frameIdentity,
              sourceRect,
              destinationRect,
              footAnchor,
            }),
          ),
      ),
      residentMasks: residentIds.map((entityId) => {
        const mask = window.__GAME_TEST__!.captureEntityMask(entityId);
        return {
          entityId,
          pixelHash: mask.pixelHash,
          bottomOffset: mask.bottomOffset,
          inkBounds: mask.inkBounds,
        };
      }),
    };
  });
  expect(evidence.hasLegacyExit).toBe(false);
  expect(evidence.scenes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "building:embercross:market",
        spriteId: "scenery:structure:embercross-market",
        assetId: "atlas:embercross-city-kit-v1",
      }),
      expect.objectContaining({
        id: "building:embercross:tavern",
        spriteId: "scenery:structure:embercross-tavern",
        assetId: "atlas:embercross-city-kit-v1",
      }),
      expect.objectContaining({
        id: "building:embercross:infirmary",
        spriteId: "scenery:structure:embercross-infirmary",
        assetId: "atlas:embercross-city-kit-v1",
      }),
      expect.objectContaining({
        id: "gate:embercross:south",
        spriteId: "scenery:structure:embercross-city-gate",
        assetId: "atlas:embercross-city-kit-v1",
        collisionParts: 1,
      }),
      expect.objectContaining({
        id: "prop:embercross:inn-bed",
        spriteId: "scenery:prop:embercross-bed-service",
        assetId: "atlas:embercross-city-kit-v1",
      }),
    ]),
  );
  expect(evidence.residents).toHaveLength(5);
  for (const residents of evidence.residents) expect(residents).toHaveLength(4);
  const initialRects = new Map(
    evidence.residents[0]!.map(({ entityId, destinationRect }) => [
      entityId,
      destinationRect,
    ]),
  );
  for (const residents of evidence.residents.slice(1))
    for (const resident of residents)
      expect(resident.destinationRect).toEqual(
        initialRects.get(resident.entityId),
      );
  const expectedResidentRows = new Map([
    ["npc:embercross:mara", 0],
    ["npc:embercross:oren", 1],
    ["npc:embercross:tess", 2],
    ["npc:embercross:ileya", 3],
  ]);
  for (const [entityId, row] of expectedResidentRows) {
    const residentFrames = evidence.residents.map((residents) =>
      residents.find(({ entityId: candidate }) => candidate === entityId)!,
    );
    expect(residentFrames.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1, 2, 3, 0,
    ]);
    for (const [index, resident] of residentFrames.entries()) {
      expect(resident).toMatchObject({
        spriteId: `resident:embercross:${entityId.split(":").at(-1)}`,
        assetId: "atlas:embercross-residents-idle-v1",
        clip: "resident-idle",
        frameCount: 4,
        sourceRect: {
          x: (index % 4) * 256,
          y: row * 256,
          width: 256,
          height: 256,
        },
      });
    }
  }
  expect(
    new Set(evidence.residentMasks.map(({ pixelHash }) => pixelHash)).size,
  ).toBe(4);
  for (const mask of evidence.residentMasks) {
    expect(Math.abs(mask.bottomOffset), mask.entityId).toBeLessThanOrEqual(1);
    expect(mask.inkBounds.height, mask.entityId).toBeGreaterThanOrEqual(90);
  }
  await expect(page.locator(".game")).toHaveScreenshot(
    "embercross-market-mobile.png",
  );
  await loadCityAt(
    page,
    "npc:embercross:mara",
    { gold: 60, health: 70, maxHealth: 100, tonics: 1 },
    { x: -2_600, y: 1_500 },
  );
  await expect(page.locator("#city-services")).toBeHidden();
  await expect(page.locator(".game")).toHaveScreenshot(
    "embercross-market-mobile-closed.png",
  );
});

test("landscape tavern composition remains readable and contained", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await bootCity(page);
  await loadCityAt(
    page,
    "npc:embercross:oren",
    {
      gold: 60,
      health: 60,
      maxHealth: 100,
      hunger: 80,
    },
    { x: 0, y: 1_900 },
  );
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    sheet: (() => {
      const bounds = document
        .querySelector<HTMLElement>("#city-services")!
        .getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      };
    })(),
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.sheet.left).toBeGreaterThanOrEqual(0);
  expect(layout.sheet.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.sheet.top).toBeGreaterThanOrEqual(0);
  expect(layout.sheet.bottom).toBeLessThanOrEqual(390);
  await expect(page.locator(".game")).toHaveScreenshot(
    "embercross-tavern-landscape.png",
  );
  await loadCityAt(
    page,
    "npc:embercross:oren",
    { gold: 60, health: 60, maxHealth: 100, hunger: 80 },
    { x: 0, y: 2_500 },
  );
  await expect(page.locator("#city-services")).toBeHidden();
  await expect(page.locator(".game")).toHaveScreenshot(
    "embercross-tavern-landscape-closed.png",
  );
});
