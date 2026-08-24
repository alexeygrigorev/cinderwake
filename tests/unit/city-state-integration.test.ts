import { describe, expect, it } from "vitest";
import { createInitialCityState } from "../../src/game/city";
import { canonicalJson, stateHash } from "../../src/testkit/canonical";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";
import { stateFromSnapshot } from "../../src/testkit/stateSnapshots";

describe("versioned city state integration", () => {
  it("starts every generated or built-in world with deterministic city state", () => {
    const scenario = BUILTIN_SCENARIOS["animation-idle"]!;
    const first = worldFromScenario(scenario);
    const second = worldFromScenario(structuredClone(scenario));

    expect(first.schemaVersion).toBe(2);
    expect(first.city).toEqual(createInitialCityState({ tick: first.tick }));
    expect(first.city.locationPhase).toBe("undiscovered");
    expect(second.city).toEqual(first.city);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
  });

  it("accepts and clones one exact scenario city override", () => {
    const city = createInitialCityState({
      tick: 91,
      worldMinute: 3 * 24 * 60 + 7 * 60,
      traveler: {
        gold: 73,
        health: 44,
        maxHealth: 125,
        inventory: [{ itemId: "ashfang-pelt", quantity: 2 }],
      },
      merchant: { gold: 127, tonicStock: 3 },
    });
    const scenario: ScenarioV1 = {
      ...structuredClone(BUILTIN_SCENARIOS["animation-idle"]!),
      id: "exact-city-override",
      tick: 100,
      city,
    };
    const state = worldFromScenario(scenario);

    expect(state.city).toEqual(city);
    expect(state.city).not.toBe(city);
    expect(state.city.traveler).not.toBe(city.traveler);

    const defaultState = worldFromScenario({ ...scenario, city: undefined });
    expect(stateHash(state)).not.toBe(stateHash(defaultState));
  });

  it("captures and restores city fields as part of the authoritative hash", () => {
    const original = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    const restored = stateFromSnapshot(JSON.parse(canonicalJson(original)));

    expect(restored).toEqual(original);
    expect(restored.city).not.toBe(original.city);
    expect(stateHash(restored)).toBe(stateHash(original));

    const changed = structuredClone(restored);
    changed.city.worldMinute += 1;
    expect(stateHash(changed)).not.toBe(stateHash(restored));
  });

  it("rejects missing or malformed city data in a GameState v2 snapshot", () => {
    const valid = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    const missing = structuredClone(valid) as unknown as Record<
      string,
      unknown
    >;
    delete missing.city;
    expect(() => stateFromSnapshot(missing)).toThrow(
      "cityState must be an object",
    );

    const malformed = structuredClone(valid);
    malformed.city.traveler.health = malformed.city.traveler.maxHealth + 1;
    expect(() => stateFromSnapshot(malformed)).toThrow(
      "cityState.traveler.health must not exceed maxHealth",
    );

    const futureCity = structuredClone(valid);
    futureCity.city.tick = futureCity.tick + 1;
    expect(() => stateFromSnapshot(futureCity)).toThrow(
      "state.city.tick must not exceed state.tick",
    );
  });

  it("rejects a malformed exact scenario city override", () => {
    const scenario = structuredClone(
      BUILTIN_SCENARIOS["animation-idle"]!,
    ) as ScenarioV1;
    scenario.city = createInitialCityState();
    scenario.city.serviceVisits["healer:restore-health"] = -1;

    expect(() => worldFromScenario(scenario)).toThrow(
      "cityState.serviceVisits.healer:restore-health",
    );
  });

  it("migrates a legacy v1 snapshot with one documented deterministic default", () => {
    const current = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    current.tick = 137;
    const legacy = structuredClone(current) as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 1;
    delete legacy.city;

    const migrated = stateFromSnapshot(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.city).toEqual(createInitialCityState({ tick: 137 }));

    const ambiguousLegacy = { ...legacy, city: createInitialCityState() };
    expect(() => stateFromSnapshot(ambiguousLegacy)).toThrow(
      "Legacy GameState schemaVersion 1 must not contain city",
    );
  });
});
