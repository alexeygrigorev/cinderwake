import { describe, expect, it } from "vitest";
import {
  CITY_SERVICE_EXPECTATIONS,
  evaluateCityJourneyEvidence,
} from "../../scripts/lib/city-journey-evidence.mjs";

function state(phase: "undiscovered" | "discovered" | "inside", tick: number) {
  return {
    tick,
    map: { digest: phase === "inside" ? "city-map" : "wilderness-map" },
    city: {
      locationPhase: phase,
      worldMinute: 1_080,
      traveler: {
        gold: 100,
        health: 50,
        tonics: 0,
        hunger: 60,
        fatigue: 55,
        inventory: [],
      },
      merchant: { gold: 200, tonicStock: 8 },
      events: [],
      receipts: [],
    },
  };
}

function capture(tick: number, snapshot: unknown) {
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}`,
    manifestHash: `manifest-${tick}`,
    frameHash: `frame-${tick}`,
    snapshot,
  };
}

function fixture() {
  const services = CITY_SERVICE_EXPECTATIONS.map(
    ({ npcId, actionId }, index) => {
      const before = state("inside", 10 + index * 2);
      const after = structuredClone(before) as any;
      after.tick += 1;
      after.city.worldMinute += 1;
      after.city.traveler.gold -= 1;
      const deltas = {
        gold: -1,
        health: 0,
        tonics: 0,
        hunger: 0,
        fatigue: 0,
        worldMinute: 1,
        merchantGold: 0,
        merchantTonicStock: 0,
        inventory: [],
      };
      const receipt = { npcId, actionId, deltas };
      after.city.receipts = [receipt];
      return {
        npcId,
        actionId,
        button: { visible: true, intent: actionId },
        gesture: { type: "touch", targetWidth: 64, targetHeight: 64 },
        previewDeltas: deltas,
        before: capture(before.tick, before),
        after: capture(after.tick, after),
        receipt,
        feedback: { visible: true, label: `${actionId} complete` },
      };
    },
  );
  const initial = state("undiscovered", 0);
  const discovered = state("discovered", 4);
  const entered = state("inside", 8);
  return {
    profiles: [
      {
        profileId: "phone-portrait",
        initial: {
          injectionUsed: false,
          bridgeExposed: false,
          signVisible: true,
          snapshot: initial,
        },
        discovered: {
          snapshot: discovered,
          eventTypes: ["city_discovered"],
        },
        entered: {
          snapshot: entered,
          eventTypes: ["city_entered"],
          mapChanged: true,
          gateVisible: true,
          residentIds: ["mara", "oren", "tess", "ileya"],
        },
        timeline: [
          capture(0, initial),
          capture(4, discovered),
          capture(8, entered),
        ],
        services,
      },
    ],
  };
}

describe("city journey evidence evaluator", () => {
  it("accepts a complete physical journey and service delta bundle", () => {
    const result = evaluateCityJourneyEvidence({
      ...fixture(),
      requiredProfiles: ["phone-portrait"],
    });

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
  });

  it.each([
    [
      "missing sign",
      "city-route-undiscoverable",
      (value: any) => {
        value.profiles[0].initial.signVisible = false;
      },
    ],
    [
      "disabled gate",
      "gate-transition-inert",
      (value: any) => {
        value.profiles[0].entered.snapshot.city.locationPhase = "at_gate";
      },
    ],
    [
      "missing service intent",
      "service-control-inert",
      (value: any) => {
        value.profiles[0].services[0].receipt = null;
      },
    ],
    [
      "suppressed service outcome",
      "service-state-or-feedback-missing",
      (value: any) => {
        value.profiles[0].services[0].feedback.visible = false;
      },
    ],
    [
      "desynchronized evidence",
      "journey-evidence-desynchronized",
      (value: any) => {
        value.profiles[0].timeline[1].manifestTick += 1;
      },
    ],
  ])("detects %s as %s", (_name, expectedFailure, mutate) => {
    const value = fixture();
    mutate(value);

    const result = evaluateCityJourneyEvidence({
      ...value,
      requiredProfiles: ["phone-portrait"],
    });

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });
});
