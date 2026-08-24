import { expect, test } from "@playwright/test";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  CITY_GATE_ID,
  transitionCityProgression,
} from "../../src/game/city";
import {
  cityNpcWorldAnchor,
  createEmbercrossMap,
} from "../../src/game/cityWorld";
import type { GameState } from "../../src/game/types";

test("an Ashfang pelt travels from a real kill and pickup into Mara's sale", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=combat-loot");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));

  // Use the shipped action button and browser input adapter, not direct combat
  // state mutation, to kill the scenario's real Ashfang.
  await page.getByRole("button", { name: "Strike", exact: true }).click();
  const killed = await page.evaluate(() =>
    window.__GAME_TEST__!.step(9, { useBrowserInput: true, render: true }),
  );
  expect(killed.metrics.kills).toBe(1);
  expect(killed.loot).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "loot:monster:target:ashfang-pelt",
        kind: "ashfang-pelt",
        amount: 1,
      }),
    ]),
  );
  const peltDraw = await page.evaluate(() =>
    window
      .__GAME_TEST__!.renderManifest()
      .drawCalls.find(
        (call) => call.entityId === "loot:monster:target:ashfang-pelt",
      ),
  );
  expect(peltDraw).toMatchObject({
    type: "loot",
    renderMode: "sprite",
    spriteId: "loot:ashfang-pelt:common",
    assetId: "atlas:loot",
  });

  // Walk the real player body into the deterministic pickup radius.
  await page.keyboard.down("d");
  const picked = await page.evaluate(() =>
    window.__GAME_TEST__!.step(16, { useBrowserInput: true, render: true }),
  );
  await page.keyboard.up("d");
  expect(picked.loot).toHaveLength(0);
  expect(picked.city.traveler.inventory).toEqual([
    { itemId: "ashfang-pelt", quantity: 1 },
  ]);
  expect(
    picked.eventLog.some(
      (event) =>
        event.type === "loot_picked" &&
        event.targetId === "loot:monster:target:ashfang-pelt",
    ),
  ).toBe(true);

  // Boundary: city traversal already has separate production-route coverage.
  // Move this exact captured state through the pure progression commands and
  // relocate only the player/map, preserving the pickup-created inventory.
  const discovered = transitionCityProgression(picked.city, {
    type: "discover_city",
    tick: picked.tick + 1,
    landmarkId: CITY_DISCOVERY_LANDMARK_ID,
  });
  if (!discovered.ok) throw new Error(discovered.message);
  const arrived = transitionCityProgression(discovered.state, {
    type: "arrive_at_gate",
    tick: picked.tick + 2,
    gateId: CITY_GATE_ID,
  });
  if (!arrived.ok) throw new Error(arrived.message);
  const entered = transitionCityProgression(arrived.state, {
    type: "enter_city",
    tick: picked.tick + 3,
    gateId: CITY_GATE_ID,
  });
  if (!entered.ok) throw new Error(entered.message);
  const mara = cityNpcWorldAnchor("npc:embercross:mara");
  const cityState: GameState = {
    ...picked,
    tick: picked.tick + 3,
    map: createEmbercrossMap(),
    player: {
      ...picked.player,
      position: mara,
      previousPosition: mara,
      velocity: { x: 0, y: 0 },
    },
    monsters: [],
    pendingAttacks: [],
    projectiles: [],
    loot: [],
    effects: [],
    city: entered.state,
  };
  const goldBeforeSale = cityState.player.gold;
  await page.evaluate(
    (state) => window.__GAME_TEST__!.loadState(state),
    cityState,
  );

  const sell = page.locator("[data-city-action='merchant:sell-ashfang-pelt']");
  await expect(sell).toBeVisible();
  await sell.click();
  const sold = await page.evaluate(() => window.__GAME_TEST__!.snapshot());
  expect(sold.city.traveler.inventory).toEqual([]);
  expect(sold.player.gold).toBe(goldBeforeSale + 9);
  expect(sold.city.traveler.gold).toBe(goldBeforeSale + 9);
  expect(sold.city.receipts.at(-1)).toMatchObject({
    npcId: "npc:embercross:mara",
    actionId: "merchant:sell-ashfang-pelt",
    quantity: 1,
    totalPrice: 9,
  });
});
