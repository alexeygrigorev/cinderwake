import { describe, expect, it } from "vitest";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  CITY_GATE_ID,
  EMBERCROSS_CITY,
  createInitialCityState,
  executeCityService,
  restoreCityState,
  transitionCityProgression,
  updateCityInteractionContext,
  type CityNpcId,
  type CityStateV1,
} from "../../src/game/city";

function enterCity(initial = createInitialCityState()): CityStateV1 {
  const discovered = transitionCityProgression(initial, {
    type: "discover_city",
    tick: initial.tick + 10,
    landmarkId: CITY_DISCOVERY_LANDMARK_ID,
  });
  expect(discovered.ok).toBe(true);
  if (!discovered.ok) throw new Error(discovered.message);
  const arrived = transitionCityProgression(discovered.state, {
    type: "arrive_at_gate",
    tick: initial.tick + 20,
    gateId: CITY_GATE_ID,
  });
  expect(arrived.ok).toBe(true);
  if (!arrived.ok) throw new Error(arrived.message);
  const entered = transitionCityProgression(arrived.state, {
    type: "enter_city",
    tick: initial.tick + 21,
    gateId: CITY_GATE_ID,
  });
  expect(entered.ok).toBe(true);
  if (!entered.ok) throw new Error(entered.message);
  return entered.state;
}

function approachNpc(
  state: CityStateV1,
  nearbyNpcId: CityNpcId,
  tick = state.tick + 1,
): CityStateV1 {
  const result = updateCityInteractionContext(state, {
    tick,
    nearbyNpcId,
    threatened: false,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe("Embercross city domain", () => {
  it("starts hidden in the wilderness and requires landmark, gate, then entry", () => {
    const initial = createInitialCityState();
    expect(initial.locationPhase).toBe("undiscovered");
    expect(initial.discoveredAtTick).toBeNull();
    expect(initial.events).toEqual([]);

    const skippedGate = transitionCityProgression(initial, {
      type: "enter_city",
      tick: 1,
      gateId: CITY_GATE_ID,
    });
    expect(skippedGate).toMatchObject({
      ok: false,
      code: "invalid_progression",
    });
    expect(skippedGate.state).toBe(initial);

    const inside = enterCity(initial);
    expect(inside).toMatchObject({
      locationPhase: "inside",
      discoveredAtTick: 10,
      arrivedAtGateTick: 20,
      enteredAtTick: 21,
      nextEventNumber: 4,
    });
    expect(inside.events.map(({ type }) => type)).toEqual([
      "city_discovered",
      "city_gate_arrived",
      "city_entered",
    ]);
    expect(initial.locationPhase).toBe("undiscovered");
  });

  it("publishes stable NPC, building, and mobile interaction contracts", () => {
    expect(EMBERCROSS_CITY.npcs.map(({ role }) => role)).toEqual([
      "merchant",
      "tavern_keeper",
      "innkeeper",
      "healer",
    ]);
    expect(EMBERCROSS_CITY.buildings).toHaveLength(3);
    for (const npc of EMBERCROSS_CITY.npcs) {
      expect(npc.affordance).toMatchObject({
        trigger: "tap-npc-or-context-button",
        minTapTargetCssPx: 48,
        mobilePresentation: "bottom-sheet",
        requiresExplicitConfirmation: true,
      });
      expect(npc.affordance.interactionRadiusUnits).toBeGreaterThan(
        npc.affordance.approachStopDistanceUnits,
      );
    }
  });

  it("buys and sells atomically with explicit stock, cash, and receipts", () => {
    const initial = createInitialCityState({
      traveler: {
        gold: 60,
        inventory: [{ itemId: "ashfang-pelt", quantity: 3 }],
      },
    });
    const nearMara = approachNpc(enterCity(initial), "npc:embercross:mara");
    const bought = executeCityService(nearMara, {
      tick: nearMara.tick + 1,
      npcId: "npc:embercross:mara",
      actionId: "merchant:buy-tonic",
      quantity: 2,
    });
    expect(bought.ok).toBe(true);
    if (!bought.ok) throw new Error(bought.message);
    expect(bought.state.traveler).toMatchObject({ gold: 24, tonics: 2 });
    expect(bought.state.merchant).toEqual({ gold: 236, tonicStock: 6 });
    expect(bought.receipt).toMatchObject({
      id: "city-receipt:000001",
      unitPrice: 18,
      quantity: 2,
      totalPrice: 36,
    });

    const sold = executeCityService(bought.state, {
      tick: bought.state.tick + 1,
      npcId: "npc:embercross:mara",
      actionId: "merchant:sell-ashfang-pelt",
      quantity: 2,
    });
    expect(sold.ok).toBe(true);
    if (!sold.ok) throw new Error(sold.message);
    expect(sold.state.traveler.gold).toBe(42);
    expect(sold.state.traveler.inventory).toEqual([
      { itemId: "ashfang-pelt", quantity: 1 },
    ]);
    expect(sold.state.merchant.gold).toBe(218);
    expect(sold.state.serviceVisits).toMatchObject({
      "merchant:buy-tonic": 1,
      "merchant:sell-ashfang-pelt": 1,
    });
    expect(nearMara.traveler).toMatchObject({ gold: 60, tonics: 0 });
  });

  it("supports tavern food, an overnight room, and healer treatment", () => {
    const inside = enterCity(
      createInitialCityState({
        worldMinute: 18 * 60,
        traveler: { gold: 100, health: 40, hunger: 80, fatigue: 70 },
      }),
    );
    const nearOren = approachNpc(inside, "npc:embercross:oren");
    const ate = executeCityService(nearOren, {
      tick: nearOren.tick + 1,
      npcId: "npc:embercross:oren",
      actionId: "tavern:eat-stew",
    });
    expect(ate.ok).toBe(true);
    if (!ate.ok) throw new Error(ate.message);
    expect(ate.state.traveler).toMatchObject({
      gold: 94,
      health: 55,
      hunger: 35,
    });

    const nearIleya = approachNpc(
      ate.state,
      "npc:embercross:ileya",
      ate.state.tick + 1,
    );
    const healed = executeCityService(nearIleya, {
      tick: nearIleya.tick + 1,
      npcId: "npc:embercross:ileya",
      actionId: "healer:restore-health",
    });
    expect(healed.ok).toBe(true);
    if (!healed.ok) throw new Error(healed.message);
    expect(healed.receipt.totalPrice).toBe(15);
    expect(healed.state.traveler).toMatchObject({ gold: 79, health: 100 });

    const tiredAgain = structuredClone(healed.state);
    tiredAgain.traveler.health = 75;
    const nearTess = approachNpc(
      tiredAgain,
      "npc:embercross:tess",
      tiredAgain.tick + 1,
    );
    const slept = executeCityService(nearTess, {
      tick: nearTess.tick + 1,
      npcId: "npc:embercross:tess",
      actionId: "inn:sleep-until-dawn",
    });
    expect(slept.ok).toBe(true);
    if (!slept.ok) throw new Error(slept.message);
    expect(slept.state.traveler).toMatchObject({
      gold: 59,
      health: 100,
      fatigue: 0,
      hunger: 60,
    });
    expect(slept.state.worldMinute).toBe(31 * 60);
    expect(slept.receipt.deltas.worldMinute).toBe(13 * 60);
  });

  it("rejects remote, unsafe, unaffordable, and invalid transactions without mutation", () => {
    const inside = enterCity(
      createInitialCityState({
        traveler: { gold: 0, inventory: [] },
      }),
    );
    const remote = executeCityService(inside, {
      tick: inside.tick,
      npcId: "npc:embercross:mara",
      actionId: "merchant:buy-tonic",
    });
    expect(remote).toMatchObject({ ok: false, code: "not_near_provider" });
    expect(remote.state).toBe(inside);

    const nearMara = approachNpc(inside, "npc:embercross:mara");
    const unaffordable = executeCityService(nearMara, {
      tick: nearMara.tick,
      npcId: "npc:embercross:mara",
      actionId: "merchant:buy-tonic",
    });
    expect(unaffordable).toMatchObject({
      ok: false,
      code: "insufficient_gold",
    });
    expect(unaffordable.state).toBe(nearMara);

    const threatenedResult = updateCityInteractionContext(nearMara, {
      tick: nearMara.tick + 1,
      nearbyNpcId: "npc:embercross:mara",
      threatened: true,
    });
    expect(threatenedResult.ok).toBe(true);
    if (!threatenedResult.ok) throw new Error(threatenedResult.message);
    const unsafe = executeCityService(threatenedResult.state, {
      tick: threatenedResult.state.tick,
      npcId: "npc:embercross:mara",
      actionId: "merchant:sell-ashfang-pelt",
    });
    expect(unsafe).toMatchObject({ ok: false, code: "city_unsafe" });
    expect(unsafe.state).toBe(threatenedResult.state);
  });

  it("replays the same command from an arbitrary JSON state byte-for-byte", () => {
    const source = approachNpc(
      enterCity(
        createInitialCityState({
          tick: 240,
          worldMinute: 2 * 24 * 60 + 12 * 60,
          traveler: {
            gold: 71,
            health: 53,
            maxHealth: 120,
            hunger: 37,
            fatigue: 91,
            inventory: [{ itemId: "ashfang-pelt", quantity: 4 }],
          },
          merchant: { gold: 83, tonicStock: 2 },
        }),
      ),
      "npc:embercross:mara",
    );
    const snapshot = JSON.stringify(source);
    const restored = restoreCityState(JSON.parse(snapshot));
    expect(restored).toEqual(source);
    expect(restored).not.toBe(source);

    const command = {
      tick: source.tick + 3,
      npcId: "npc:embercross:mara" as const,
      actionId: "merchant:sell-ashfang-pelt" as const,
      quantity: 3,
    };
    const first = executeCityService(source, command);
    const second = executeCityService(restored, command);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("rejects malformed arbitrary state rather than silently defaulting it", () => {
    const malformed = structuredClone(enterCity());
    malformed.traveler.health = malformed.traveler.maxHealth + 1;
    expect(() => restoreCityState(malformed)).toThrow(
      "cityState.traveler.health must not exceed maxHealth",
    );

    const missingVisits = structuredClone(enterCity()) as unknown as {
      serviceVisits: Record<string, number>;
    };
    delete missingVisits.serviceVisits["healer:restore-health"];
    expect(() => restoreCityState(missingVisits)).toThrow(
      "cityState.serviceVisits.healer:restore-health",
    );
  });
});
