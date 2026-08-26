export const CITY_JOURNEY_SIGNAL_IDS = [
  "city-route-discoverable",
  "gate-transition-completes",
  "all-service-intents-live",
  "all-service-outcomes-visible",
];

export const CITY_JOURNEY_FAILURE_IDS = [
  "city-route-undiscoverable",
  "gate-transition-inert",
  "service-control-inert",
  "service-state-or-feedback-missing",
  "journey-evidence-desynchronized",
];

export const CITY_SERVICE_EXPECTATIONS = [
  { npcId: "npc:embercross:mara", actionId: "merchant:buy-tonic" },
  { npcId: "npc:embercross:mara", actionId: "merchant:sell-ashfang-pelt" },
  { npcId: "npc:embercross:oren", actionId: "tavern:eat-stew" },
  { npcId: "npc:embercross:ileya", actionId: "healer:restore-health" },
  { npcId: "npc:embercross:tess", actionId: "inn:sleep-until-dawn" },
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function inventoryMap(inventory) {
  return new Map(
    (inventory ?? []).map(({ itemId, quantity }) => [itemId, quantity]),
  );
}

function inventoryDelta(before, after) {
  const first = inventoryMap(before);
  const second = inventoryMap(after);
  return [...new Set([...first.keys(), ...second.keys()])]
    .sort()
    .map((itemId) => ({
      itemId,
      quantity: (second.get(itemId) ?? 0) - (first.get(itemId) ?? 0),
    }))
    .filter(({ quantity }) => quantity !== 0);
}

function serviceDelta(before, after) {
  const firstTraveler = before?.city?.traveler;
  const secondTraveler = after?.city?.traveler;
  return {
    gold: secondTraveler.gold - firstTraveler.gold,
    health: secondTraveler.health - firstTraveler.health,
    tonics: secondTraveler.tonics - firstTraveler.tonics,
    hunger: secondTraveler.hunger - firstTraveler.hunger,
    fatigue: secondTraveler.fatigue - firstTraveler.fatigue,
    worldMinute: after.city.worldMinute - before.city.worldMinute,
    merchantGold: after.city.merchant.gold - before.city.merchant.gold,
    merchantTonicStock:
      after.city.merchant.tonicStock - before.city.merchant.tonicStock,
    inventory: inventoryDelta(
      firstTraveler.inventory,
      secondTraveler.inventory,
    ),
  };
}

function timelineSynchronized(timeline) {
  return (
    Array.isArray(timeline) &&
    timeline.length > 0 &&
    timeline.every(
      (capture) =>
        Number.isInteger(capture.tick) &&
        capture.tick === capture.stateTick &&
        capture.tick === capture.manifestTick &&
        typeof capture.stateHash === "string" &&
        capture.stateHash.length > 0 &&
        typeof capture.manifestHash === "string" &&
        capture.manifestHash.length > 0 &&
        typeof capture.frameHash === "string" &&
        capture.frameHash.length > 0,
    )
  );
}

function serviceIntentLive(service) {
  return Boolean(
    service?.button?.visible &&
    service.button.intent === service.actionId &&
    service.gesture?.type &&
    service.gesture.targetWidth >= 48 &&
    service.gesture.targetHeight >= 48 &&
    service.receipt?.actionId === service.actionId &&
    service.receipt?.npcId === service.npcId,
  );
}

function serviceOutcomeVisible(service) {
  if (!serviceIntentLive(service)) return false;
  if (!service.feedback?.visible || !service.feedback.label) return false;
  if (!sameJson(service.previewDeltas, service.receipt.deltas)) return false;
  return sameJson(
    serviceDelta(service.before.snapshot, service.after.snapshot),
    service.receipt.deltas,
  );
}

function expectedServiceRecord(profile, expectation) {
  return profile?.services?.find(
    (service) =>
      service.npcId === expectation.npcId &&
      service.actionId === expectation.actionId,
  );
}

function profileTimeline(profile) {
  return [
    ...(profile?.timeline ?? []),
    ...(profile?.services ?? []).flatMap((service) => [
      service.before,
      service.after,
    ]),
  ].filter(Boolean);
}

/**
 * Evaluate a retained, production-input city journey. The browser recorder
 * supplies snapshots, manifests, frame hashes, and gesture metadata; this
 * module owns the machine verdict and its deliberately named mutations.
 */
export function evaluateCityJourneyEvidence({
  profiles,
  requiredProfiles = [],
  serviceExpectations = CITY_SERVICE_EXPECTATIONS,
}) {
  const failures = [];
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const hasAllProfiles = selectedProfiles.every(Boolean);
  const timelinesSynchronized = selectedProfiles.every((profile) =>
    timelineSynchronized(profileTimeline(profile)),
  );
  if (!timelinesSynchronized) failures.push("journey-evidence-desynchronized");

  const routeDiscoverable =
    hasAllProfiles &&
    selectedProfiles.every(
      (profile) =>
        profile.initial?.injectionUsed === false &&
        profile.initial?.bridgeExposed === false &&
        profile.initial?.signVisible === true &&
        profile.initial?.snapshot?.city?.locationPhase === "undiscovered" &&
        profile.discovered?.snapshot?.city?.locationPhase === "discovered" &&
        Array.isArray(profile.discovered?.eventTypes) &&
        profile.discovered.eventTypes.includes("city_discovered"),
    );
  if (!routeDiscoverable) failures.push("city-route-undiscoverable");

  const gateCompleted =
    hasAllProfiles &&
    selectedProfiles.every(
      (profile) =>
        profile.entered?.snapshot?.city?.locationPhase === "inside" &&
        Array.isArray(profile.entered?.eventTypes) &&
        profile.entered.eventTypes.includes("city_entered") &&
        profile.entered?.mapChanged === true &&
        profile.entered?.gateVisible === true &&
        profile.entered?.residentIds?.length === 4,
    );
  if (!gateCompleted) failures.push("gate-transition-inert");

  const serviceIntentsLive =
    hasAllProfiles &&
    selectedProfiles.every((profile) =>
      serviceExpectations.every((expectation) =>
        serviceIntentLive(expectedServiceRecord(profile, expectation)),
      ),
    );
  if (!serviceIntentsLive) failures.push("service-control-inert");

  const serviceOutcomesVisible =
    serviceIntentsLive &&
    selectedProfiles.every((profile) =>
      serviceExpectations.every((expectation) =>
        serviceOutcomeVisible(expectedServiceRecord(profile, expectation)),
      ),
    );
  if (!serviceOutcomesVisible)
    failures.push("service-state-or-feedback-missing");

  const signals = [
    {
      id: "city-route-discoverable",
      pass: routeDiscoverable,
      detail: {
        profiles: selectedProfiles
          .filter(Boolean)
          .map((profile) => profile.profileId),
      },
    },
    {
      id: "gate-transition-completes",
      pass: gateCompleted,
      detail: {
        enteredProfiles: selectedProfiles.filter(
          (profile) =>
            profile?.entered?.snapshot?.city?.locationPhase === "inside",
        ).length,
      },
    },
    {
      id: "all-service-intents-live",
      pass: serviceIntentsLive,
      detail: {
        expectedActions: serviceExpectations.map(({ actionId }) => actionId),
      },
    },
    {
      id: "all-service-outcomes-visible",
      pass: serviceOutcomesVisible,
      detail: {
        expectedActions: serviceExpectations.map(({ actionId }) => actionId),
      },
    },
  ];

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals,
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    timelineSynchronized: timelinesSynchronized,
  };
}
