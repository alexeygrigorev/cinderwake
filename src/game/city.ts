/**
 * Deterministic city progression and service transactions.
 *
 * This module deliberately has no renderer, DOM, clock, or random-number
 * dependencies. Callers can restore a CityStateV1 from JSON, apply one command,
 * and compare the complete result in a unit test or replay.
 */

export const CITY_ID = "city:embercross" as const;
export const CITY_DISCOVERY_LANDMARK_ID =
  "landmark:embercross:road-sign" as const;
export const CITY_GATE_ID = "gate:embercross:south" as const;

export type CityId = typeof CITY_ID;
export type CityDiscoveryLandmarkId = typeof CITY_DISCOVERY_LANDMARK_ID;
export type CityGateId = typeof CITY_GATE_ID;
export type CityLocationPhase =
  "undiscovered" | "discovered" | "at_gate" | "inside";

export type CityNpcId =
  | "npc:embercross:mara"
  | "npc:embercross:oren"
  | "npc:embercross:tess"
  | "npc:embercross:ileya";
export type CityNpcRole = "merchant" | "tavern_keeper" | "innkeeper" | "healer";
export type CityBuildingId =
  | "building:embercross:market"
  | "building:embercross:tavern"
  | "building:embercross:infirmary";
export type CityItemId = "tonic" | "ashfang-pelt";
export type CityServiceActionId =
  | "merchant:buy-tonic"
  | "merchant:sell-ashfang-pelt"
  | "tavern:eat-stew"
  | "inn:sleep-until-dawn"
  | "healer:restore-health";

export interface CityInteractionAffordanceV1 {
  trigger: "tap-npc-or-context-button";
  minTapTargetCssPx: 48;
  interactionRadiusUnits: number;
  approachStopDistanceUnits: number;
  mobilePresentation: "bottom-sheet";
  requiresExplicitConfirmation: boolean;
}

export interface CityNpcDefinitionV1 {
  id: CityNpcId;
  name: string;
  role: CityNpcRole;
  buildingId: CityBuildingId;
  anchorTile: readonly [number, number];
  actions: readonly CityServiceActionId[];
  affordance: CityInteractionAffordanceV1;
}

export interface CityBuildingDefinitionV1 {
  id: CityBuildingId;
  name: string;
  entranceTile: readonly [number, number];
  npcIds: readonly CityNpcId[];
}

const STANDARD_AFFORDANCE: CityInteractionAffordanceV1 = {
  trigger: "tap-npc-or-context-button",
  minTapTargetCssPx: 48,
  interactionRadiusUnits: 2048,
  approachStopDistanceUnits: 1536,
  mobilePresentation: "bottom-sheet",
  requiresExplicitConfirmation: true,
};

/** Stable content IDs and coarse placement data for the first city map. */
export const EMBERCROSS_CITY = {
  id: CITY_ID,
  name: "Embercross",
  discoveryLandmarkId: CITY_DISCOVERY_LANDMARK_ID,
  gateId: CITY_GATE_ID,
  gateTile: [15, 28] as const,
  buildings: [
    {
      id: "building:embercross:market",
      name: "Cinder Market",
      entranceTile: [11, 15] as const,
      npcIds: ["npc:embercross:mara"] as const,
    },
    {
      id: "building:embercross:tavern",
      name: "The Lantern and Ladle",
      entranceTile: [20, 14] as const,
      npcIds: ["npc:embercross:oren", "npc:embercross:tess"] as const,
    },
    {
      id: "building:embercross:infirmary",
      name: "House of Mending",
      entranceTile: [25, 19] as const,
      npcIds: ["npc:embercross:ileya"] as const,
    },
  ] satisfies readonly CityBuildingDefinitionV1[],
  npcs: [
    {
      id: "npc:embercross:mara",
      name: "Mara Vale",
      role: "merchant",
      buildingId: "building:embercross:market",
      anchorTile: [12, 14] as const,
      actions: ["merchant:buy-tonic", "merchant:sell-ashfang-pelt"] as const,
      affordance: STANDARD_AFFORDANCE,
    },
    {
      id: "npc:embercross:oren",
      name: "Oren",
      role: "tavern_keeper",
      buildingId: "building:embercross:tavern",
      anchorTile: [19, 13] as const,
      actions: ["tavern:eat-stew"] as const,
      affordance: STANDARD_AFFORDANCE,
    },
    {
      id: "npc:embercross:tess",
      name: "Tess",
      role: "innkeeper",
      buildingId: "building:embercross:tavern",
      anchorTile: [22, 13] as const,
      actions: ["inn:sleep-until-dawn"] as const,
      affordance: STANDARD_AFFORDANCE,
    },
    {
      id: "npc:embercross:ileya",
      name: "Sister Ileya",
      role: "healer",
      buildingId: "building:embercross:infirmary",
      anchorTile: [25, 18] as const,
      actions: ["healer:restore-health"] as const,
      affordance: STANDARD_AFFORDANCE,
    },
  ] satisfies readonly CityNpcDefinitionV1[],
} as const;

export interface CityInventoryEntryV1 {
  itemId: CityItemId;
  quantity: number;
}

export interface CityTravelerStateV1 {
  gold: number;
  health: number;
  maxHealth: number;
  tonics: number;
  /** 0 is fed; 100 is famished. */
  hunger: number;
  /** 0 is rested; 100 is exhausted. */
  fatigue: number;
  inventory: CityInventoryEntryV1[];
}

export interface CityMerchantStateV1 {
  gold: number;
  tonicStock: number;
}

export interface CityServiceDeltasV1 {
  gold: number;
  health: number;
  tonics: number;
  hunger: number;
  fatigue: number;
  worldMinute: number;
  merchantGold: number;
  merchantTonicStock: number;
  inventory: CityInventoryEntryV1[];
}

export interface CityServiceReceiptV1 {
  id: string;
  tick: number;
  npcId: CityNpcId;
  actionId: CityServiceActionId;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  deltas: CityServiceDeltasV1;
}

export type CityEventType =
  | "city_discovered"
  | "city_gate_arrived"
  | "city_entered"
  | "city_service_completed";

export interface CityEventV1 {
  id: string;
  tick: number;
  type: CityEventType;
  detailId: string;
}

export interface CityStateV1 {
  schemaVersion: 1;
  cityId: CityId;
  tick: number;
  worldMinute: number;
  locationPhase: CityLocationPhase;
  discoveredAtTick: number | null;
  arrivedAtGateTick: number | null;
  enteredAtTick: number | null;
  nearbyNpcId: CityNpcId | null;
  threatened: boolean;
  nextEventNumber: number;
  nextReceiptNumber: number;
  traveler: CityTravelerStateV1;
  merchant: CityMerchantStateV1;
  serviceVisits: Record<CityServiceActionId, number>;
  events: CityEventV1[];
  receipts: CityServiceReceiptV1[];
}

export interface InitialCityOverridesV1 {
  tick?: number;
  worldMinute?: number;
  traveler?: Partial<Omit<CityTravelerStateV1, "inventory">> & {
    inventory?: CityInventoryEntryV1[];
  };
  merchant?: Partial<CityMerchantStateV1>;
}

export type CityRejectionCode =
  | "clock_regression"
  | "invalid_progression"
  | "wrong_landmark"
  | "wrong_gate"
  | "outside_city"
  | "city_unsafe"
  | "unknown_npc"
  | "wrong_provider"
  | "not_near_provider"
  | "invalid_quantity"
  | "insufficient_gold"
  | "insufficient_stock"
  | "missing_item"
  | "merchant_cannot_pay"
  | "already_sated"
  | "already_rested"
  | "full_health";

export interface CityRejectionV1 {
  ok: false;
  state: CityStateV1;
  code: CityRejectionCode;
  message: string;
}

export type CityCommandResultV1<
  TSuccess extends object = Record<never, never>,
> = ({ ok: true; state: CityStateV1 } & TSuccess) | CityRejectionV1;

export type CityProgressionSignalV1 =
  | {
      type: "discover_city";
      tick: number;
      landmarkId: CityDiscoveryLandmarkId | string;
    }
  | {
      type: "arrive_at_gate";
      tick: number;
      gateId: CityGateId | string;
    }
  | {
      type: "enter_city";
      tick: number;
      gateId: CityGateId | string;
    };

export interface CityInteractionContextV1 {
  tick: number;
  nearbyNpcId: CityNpcId | null;
  threatened: boolean;
}

export interface CityServiceCommandV1 {
  tick: number;
  npcId: CityNpcId;
  actionId: CityServiceActionId;
  quantity?: number;
}

const ACTION_PROVIDER: Record<CityServiceActionId, CityNpcId> = {
  "merchant:buy-tonic": "npc:embercross:mara",
  "merchant:sell-ashfang-pelt": "npc:embercross:mara",
  "tavern:eat-stew": "npc:embercross:oren",
  "inn:sleep-until-dawn": "npc:embercross:tess",
  "healer:restore-health": "npc:embercross:ileya",
};

const INITIAL_VISITS: Record<CityServiceActionId, number> = {
  "merchant:buy-tonic": 0,
  "merchant:sell-ashfang-pelt": 0,
  "tavern:eat-stew": 0,
  "inn:sleep-until-dawn": 0,
  "healer:restore-health": 0,
};

function cloneState(state: CityStateV1): CityStateV1 {
  return structuredClone(state);
}

function reject(
  state: CityStateV1,
  code: CityRejectionCode,
  message: string,
): CityRejectionV1 {
  return { ok: false, state, code, message };
}

function isKnownNpc(value: string): value is CityNpcId {
  return EMBERCROSS_CITY.npcs.some((npc) => npc.id === value);
}

function isKnownAction(value: string): value is CityServiceActionId {
  return Object.hasOwn(ACTION_PROVIDER, value);
}

function inventoryQuantity(
  inventory: readonly CityInventoryEntryV1[],
  itemId: CityItemId,
): number {
  return inventory.find((entry) => entry.itemId === itemId)?.quantity ?? 0;
}

/**
 * Return the canonical, stable-order inventory after applying one item delta.
 * Runtime pickups and city services share this function so wilderness rewards
 * cannot drift from the inventory Mara reads.
 */
export function withCityInventoryDelta(
  inventory: readonly CityInventoryEntryV1[],
  itemId: CityItemId,
  delta: number,
): CityInventoryEntryV1[] {
  const quantities = new Map<CityItemId, number>(
    inventory.map((entry) => [entry.itemId, entry.quantity]),
  );
  const next = (quantities.get(itemId) ?? 0) + delta;
  if (next <= 0) quantities.delete(itemId);
  else quantities.set(itemId, next);
  return [...quantities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entryItemId, quantity]) => ({ itemId: entryItemId, quantity }));
}

function appendEvent(
  state: CityStateV1,
  tick: number,
  type: CityEventType,
  detailId: string,
): void {
  state.events.push({
    id: `city-event:${state.nextEventNumber.toString().padStart(6, "0")}`,
    tick,
    type,
    detailId,
  });
  state.nextEventNumber += 1;
}

function progressionPrecondition(
  state: CityStateV1,
  tick: number,
): CityRejectionV1 | null {
  if (!Number.isSafeInteger(tick) || tick < state.tick) {
    return reject(
      state,
      "clock_regression",
      "City commands must use a safe tick at or after the current city tick.",
    );
  }
  return null;
}

export function createInitialCityState(
  overrides: InitialCityOverridesV1 = {},
): CityStateV1 {
  const state: CityStateV1 = {
    schemaVersion: 1,
    cityId: CITY_ID,
    tick: overrides.tick ?? 0,
    worldMinute: overrides.worldMinute ?? 18 * 60,
    locationPhase: "undiscovered",
    discoveredAtTick: null,
    arrivedAtGateTick: null,
    enteredAtTick: null,
    nearbyNpcId: null,
    threatened: false,
    nextEventNumber: 1,
    nextReceiptNumber: 1,
    traveler: {
      gold: overrides.traveler?.gold ?? 40,
      health: overrides.traveler?.health ?? 70,
      maxHealth: overrides.traveler?.maxHealth ?? 100,
      tonics: overrides.traveler?.tonics ?? 0,
      hunger: overrides.traveler?.hunger ?? 60,
      fatigue: overrides.traveler?.fatigue ?? 55,
      inventory: structuredClone(overrides.traveler?.inventory ?? []),
    },
    merchant: {
      gold: overrides.merchant?.gold ?? 200,
      tonicStock: overrides.merchant?.tonicStock ?? 8,
    },
    serviceVisits: { ...INITIAL_VISITS },
    events: [],
    receipts: [],
  };
  validateCityState(state);
  return state;
}

/**
 * Restore and validate an exact arbitrary city state supplied by a scenario,
 * snapshot, or test. No defaults are applied during restoration.
 */
export function restoreCityState(value: unknown): CityStateV1 {
  const restored = structuredClone(value) as CityStateV1;
  validateCityState(restored);
  return restored;
}

export function transitionCityProgression(
  state: CityStateV1,
  signal: CityProgressionSignalV1,
): CityCommandResultV1 {
  const clockFailure = progressionPrecondition(state, signal.tick);
  if (clockFailure) return clockFailure;

  if (signal.type === "discover_city") {
    if (signal.landmarkId !== CITY_DISCOVERY_LANDMARK_ID) {
      return reject(
        state,
        "wrong_landmark",
        "That landmark does not reveal Embercross.",
      );
    }
    if (state.locationPhase !== "undiscovered") {
      return reject(
        state,
        "invalid_progression",
        "Embercross is already discovered.",
      );
    }
    const next = cloneState(state);
    next.tick = signal.tick;
    next.locationPhase = "discovered";
    next.discoveredAtTick = signal.tick;
    appendEvent(next, signal.tick, "city_discovered", signal.landmarkId);
    return { ok: true, state: next };
  }

  if (signal.gateId !== CITY_GATE_ID) {
    return reject(
      state,
      "wrong_gate",
      "That gate does not lead to Embercross.",
    );
  }

  if (signal.type === "arrive_at_gate") {
    if (state.locationPhase !== "discovered") {
      return reject(
        state,
        "invalid_progression",
        "The city must be discovered before its gate can be reached.",
      );
    }
    const next = cloneState(state);
    next.tick = signal.tick;
    next.locationPhase = "at_gate";
    next.arrivedAtGateTick = signal.tick;
    appendEvent(next, signal.tick, "city_gate_arrived", signal.gateId);
    return { ok: true, state: next };
  }

  if (state.locationPhase !== "at_gate") {
    return reject(
      state,
      "invalid_progression",
      "The traveler must arrive at Embercross's gate before entering.",
    );
  }
  const next = cloneState(state);
  next.tick = signal.tick;
  next.locationPhase = "inside";
  next.enteredAtTick = signal.tick;
  appendEvent(next, signal.tick, "city_entered", signal.gateId);
  return { ok: true, state: next };
}

/** Update the deterministic interaction facts supplied by movement/combat. */
export function updateCityInteractionContext(
  state: CityStateV1,
  context: CityInteractionContextV1,
): CityCommandResultV1 {
  const clockFailure = progressionPrecondition(state, context.tick);
  if (clockFailure) return clockFailure;
  if (context.nearbyNpcId !== null && !isKnownNpc(context.nearbyNpcId)) {
    return reject(
      state,
      "unknown_npc",
      "The nearby NPC ID is not part of Embercross.",
    );
  }
  if (context.nearbyNpcId !== null && state.locationPhase !== "inside") {
    return reject(
      state,
      "outside_city",
      "City NPCs are only available inside Embercross.",
    );
  }
  const next = cloneState(state);
  next.tick = context.tick;
  next.nearbyNpcId = context.nearbyNpcId;
  next.threatened = context.threatened;
  return { ok: true, state: next };
}

function servicePrecondition(
  state: CityStateV1,
  command: CityServiceCommandV1,
): CityRejectionV1 | null {
  const clockFailure = progressionPrecondition(state, command.tick);
  if (clockFailure) return clockFailure;
  if (state.locationPhase !== "inside") {
    return reject(
      state,
      "outside_city",
      "Enter Embercross before using city services.",
    );
  }
  if (state.threatened) {
    return reject(
      state,
      "city_unsafe",
      "Services pause while the traveler is threatened.",
    );
  }
  if (!isKnownNpc(command.npcId)) {
    return reject(
      state,
      "unknown_npc",
      "The service provider is not part of Embercross.",
    );
  }
  if (ACTION_PROVIDER[command.actionId] !== command.npcId) {
    return reject(
      state,
      "wrong_provider",
      "That NPC does not provide this service.",
    );
  }
  if (state.nearbyNpcId !== command.npcId) {
    return reject(
      state,
      "not_near_provider",
      "Move into the provider's interaction radius before using the service.",
    );
  }
  const quantity = command.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
    return reject(
      state,
      "invalid_quantity",
      "Service quantity must be an integer from 1 to 20.",
    );
  }
  if (
    command.actionId !== "merchant:buy-tonic" &&
    command.actionId !== "merchant:sell-ashfang-pelt" &&
    quantity !== 1
  ) {
    return reject(
      state,
      "invalid_quantity",
      "This service can only be used once per command.",
    );
  }
  return null;
}

function emptyDeltas(): CityServiceDeltasV1 {
  return {
    gold: 0,
    health: 0,
    tonics: 0,
    hunger: 0,
    fatigue: 0,
    worldMinute: 0,
    merchantGold: 0,
    merchantTonicStock: 0,
    inventory: [],
  };
}

function completeService(
  state: CityStateV1,
  command: CityServiceCommandV1,
  quantity: number,
  unitPrice: number,
  deltas: CityServiceDeltasV1,
): CityCommandResultV1<{ receipt: CityServiceReceiptV1 }> {
  const next = cloneState(state);
  next.tick = command.tick;
  next.traveler.gold += deltas.gold;
  next.traveler.health += deltas.health;
  next.traveler.tonics += deltas.tonics;
  next.traveler.hunger += deltas.hunger;
  next.traveler.fatigue += deltas.fatigue;
  next.worldMinute += deltas.worldMinute;
  next.merchant.gold += deltas.merchantGold;
  next.merchant.tonicStock += deltas.merchantTonicStock;
  for (const entry of deltas.inventory) {
    next.traveler.inventory = withCityInventoryDelta(
      next.traveler.inventory,
      entry.itemId,
      entry.quantity,
    );
  }
  next.serviceVisits[command.actionId] += 1;
  const receipt: CityServiceReceiptV1 = {
    id: `city-receipt:${next.nextReceiptNumber.toString().padStart(6, "0")}`,
    tick: command.tick,
    npcId: command.npcId,
    actionId: command.actionId,
    quantity,
    unitPrice,
    totalPrice: unitPrice * quantity,
    deltas: structuredClone(deltas),
  };
  next.nextReceiptNumber += 1;
  next.receipts.push(receipt);
  appendEvent(next, command.tick, "city_service_completed", receipt.id);
  validateCityState(next);
  return { ok: true, state: next, receipt };
}

/** Execute one atomic service command without mutating the supplied state. */
export function executeCityService(
  state: CityStateV1,
  command: CityServiceCommandV1,
): CityCommandResultV1<{ receipt: CityServiceReceiptV1 }> {
  const commonFailure = servicePrecondition(state, command);
  if (commonFailure) return commonFailure;
  const quantity = command.quantity ?? 1;

  if (command.actionId === "merchant:buy-tonic") {
    const unitPrice = 18;
    const totalPrice = unitPrice * quantity;
    if (state.merchant.tonicStock < quantity) {
      return reject(
        state,
        "insufficient_stock",
        "Mara does not have enough tonics in stock.",
      );
    }
    if (state.traveler.gold < totalPrice) {
      return reject(
        state,
        "insufficient_gold",
        "The traveler cannot afford those tonics.",
      );
    }
    const deltas = emptyDeltas();
    deltas.gold = -totalPrice;
    deltas.tonics = quantity;
    deltas.merchantGold = totalPrice;
    deltas.merchantTonicStock = -quantity;
    return completeService(state, command, quantity, unitPrice, deltas);
  }

  if (command.actionId === "merchant:sell-ashfang-pelt") {
    const unitPrice = 9;
    const totalPrice = unitPrice * quantity;
    if (
      inventoryQuantity(state.traveler.inventory, "ashfang-pelt") < quantity
    ) {
      return reject(
        state,
        "missing_item",
        "The traveler does not have enough Ashfang pelts.",
      );
    }
    if (state.merchant.gold < totalPrice) {
      return reject(
        state,
        "merchant_cannot_pay",
        "Mara cannot afford the whole lot.",
      );
    }
    const deltas = emptyDeltas();
    deltas.gold = totalPrice;
    deltas.merchantGold = -totalPrice;
    deltas.inventory = [{ itemId: "ashfang-pelt", quantity: -quantity }];
    return completeService(state, command, quantity, unitPrice, deltas);
  }

  if (command.actionId === "tavern:eat-stew") {
    const price = 6;
    if (state.traveler.hunger === 0) {
      return reject(
        state,
        "already_sated",
        "The traveler is already fully fed.",
      );
    }
    if (state.traveler.gold < price) {
      return reject(
        state,
        "insufficient_gold",
        "The traveler cannot afford a bowl of stew.",
      );
    }
    const deltas = emptyDeltas();
    deltas.gold = -price;
    deltas.hunger = -Math.min(45, state.traveler.hunger);
    deltas.health = Math.min(
      15,
      state.traveler.maxHealth - state.traveler.health,
    );
    return completeService(state, command, 1, price, deltas);
  }

  if (command.actionId === "inn:sleep-until-dawn") {
    const price = 20;
    if (
      state.traveler.fatigue === 0 &&
      state.traveler.health === state.traveler.maxHealth
    ) {
      return reject(
        state,
        "already_rested",
        "The traveler does not need to sleep yet.",
      );
    }
    if (state.traveler.gold < price) {
      return reject(
        state,
        "insufficient_gold",
        "The traveler cannot afford a room.",
      );
    }
    const minuteOfDay = state.worldMinute % (24 * 60);
    const dawnMinute = 7 * 60;
    const minutesToDawn =
      minuteOfDay < dawnMinute
        ? dawnMinute - minuteOfDay
        : 24 * 60 - minuteOfDay + dawnMinute;
    const deltas = emptyDeltas();
    deltas.gold = -price;
    deltas.health = state.traveler.maxHealth - state.traveler.health;
    deltas.fatigue = -state.traveler.fatigue;
    deltas.hunger = Math.min(25, 100 - state.traveler.hunger);
    deltas.worldMinute = minutesToDawn;
    return completeService(state, command, 1, price, deltas);
  }

  const missingHealth = state.traveler.maxHealth - state.traveler.health;
  if (missingHealth === 0) {
    return reject(
      state,
      "full_health",
      "The traveler is already at full health.",
    );
  }
  const price = Math.max(6, Math.ceil(missingHealth / 10) * 3);
  if (state.traveler.gold < price) {
    return reject(
      state,
      "insufficient_gold",
      "The traveler cannot afford the treatment.",
    );
  }
  const deltas = emptyDeltas();
  deltas.gold = -price;
  deltas.health = missingHealth;
  return completeService(state, command, 1, price, deltas);
}

function assertRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertSafeInteger(
  value: unknown,
  path: string,
  minimum = 0,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be a safe integer >= ${minimum}`);
  }
}

function assertBoundedInteger(
  value: unknown,
  path: string,
): asserts value is number {
  assertSafeInteger(value, path);
  if ((value as number) > 100) throw new Error(`${path} must be <= 100`);
}

function validateTimestamp(value: unknown, path: string, tick: number): void {
  if (value === null) return;
  assertSafeInteger(value, path);
  if ((value as number) > tick)
    throw new Error(`${path} must not exceed state.tick`);
}

/** Validate the serializable invariants required for deterministic replay. */
export function validateCityState(
  value: unknown,
): asserts value is CityStateV1 {
  assertRecord(value, "cityState");
  if (value.schemaVersion !== 1)
    throw new Error("cityState.schemaVersion must be 1");
  if (value.cityId !== CITY_ID)
    throw new Error(`cityState.cityId must be ${CITY_ID}`);
  assertSafeInteger(value.tick, "cityState.tick");
  assertSafeInteger(value.worldMinute, "cityState.worldMinute");
  const phases: CityLocationPhase[] = [
    "undiscovered",
    "discovered",
    "at_gate",
    "inside",
  ];
  if (!phases.includes(value.locationPhase as CityLocationPhase)) {
    throw new Error("cityState.locationPhase is invalid");
  }
  validateTimestamp(
    value.discoveredAtTick,
    "cityState.discoveredAtTick",
    value.tick,
  );
  validateTimestamp(
    value.arrivedAtGateTick,
    "cityState.arrivedAtGateTick",
    value.tick,
  );
  validateTimestamp(value.enteredAtTick, "cityState.enteredAtTick", value.tick);
  const phase = value.locationPhase as CityLocationPhase;
  if (phase === "undiscovered" && value.discoveredAtTick !== null) {
    throw new Error("undiscovered cityState cannot have discoveredAtTick");
  }
  if (phase !== "undiscovered" && value.discoveredAtTick === null) {
    throw new Error("discovered cityState requires discoveredAtTick");
  }
  if (
    (phase === "at_gate" || phase === "inside") &&
    value.arrivedAtGateTick === null
  ) {
    throw new Error("gate-reached cityState requires arrivedAtGateTick");
  }
  if (phase === "inside" && value.enteredAtTick === null) {
    throw new Error("inside cityState requires enteredAtTick");
  }
  if (value.nearbyNpcId !== null && !isKnownNpc(String(value.nearbyNpcId))) {
    throw new Error("cityState.nearbyNpcId is invalid");
  }
  if (value.nearbyNpcId !== null && phase !== "inside") {
    throw new Error("cityState.nearbyNpcId requires locationPhase inside");
  }
  if (typeof value.threatened !== "boolean")
    throw new Error("cityState.threatened must be boolean");
  assertSafeInteger(value.nextEventNumber, "cityState.nextEventNumber", 1);
  assertSafeInteger(value.nextReceiptNumber, "cityState.nextReceiptNumber", 1);

  assertRecord(value.traveler, "cityState.traveler");
  assertSafeInteger(value.traveler.gold, "cityState.traveler.gold");
  assertSafeInteger(value.traveler.health, "cityState.traveler.health");
  assertSafeInteger(
    value.traveler.maxHealth,
    "cityState.traveler.maxHealth",
    1,
  );
  if (value.traveler.health > value.traveler.maxHealth) {
    throw new Error("cityState.traveler.health must not exceed maxHealth");
  }
  assertSafeInteger(value.traveler.tonics, "cityState.traveler.tonics");
  assertBoundedInteger(value.traveler.hunger, "cityState.traveler.hunger");
  assertBoundedInteger(value.traveler.fatigue, "cityState.traveler.fatigue");
  if (!Array.isArray(value.traveler.inventory)) {
    throw new Error("cityState.traveler.inventory must be an array");
  }
  const seenItems = new Set<CityItemId>();
  for (const [index, entry] of value.traveler.inventory.entries()) {
    assertRecord(entry, `cityState.traveler.inventory[${index}]`);
    if (entry.itemId !== "tonic" && entry.itemId !== "ashfang-pelt") {
      throw new Error(
        `cityState.traveler.inventory[${index}].itemId is invalid`,
      );
    }
    if (seenItems.has(entry.itemId))
      throw new Error("cityState inventory item IDs must be unique");
    seenItems.add(entry.itemId);
    assertSafeInteger(
      entry.quantity,
      `cityState.traveler.inventory[${index}].quantity`,
      1,
    );
  }

  assertRecord(value.merchant, "cityState.merchant");
  assertSafeInteger(value.merchant.gold, "cityState.merchant.gold");
  assertSafeInteger(value.merchant.tonicStock, "cityState.merchant.tonicStock");
  assertRecord(value.serviceVisits, "cityState.serviceVisits");
  for (const actionId of Object.keys(ACTION_PROVIDER)) {
    assertSafeInteger(
      value.serviceVisits[actionId],
      `cityState.serviceVisits.${actionId}`,
    );
  }
  if (!Array.isArray(value.events))
    throw new Error("cityState.events must be an array");
  if (!Array.isArray(value.receipts))
    throw new Error("cityState.receipts must be an array");
  for (const [index, event] of value.events.entries()) {
    assertRecord(event, `cityState.events[${index}]`);
    if (typeof event.id !== "string" || typeof event.detailId !== "string") {
      throw new Error(`cityState.events[${index}] IDs must be strings`);
    }
    assertSafeInteger(event.tick, `cityState.events[${index}].tick`);
    if (event.tick > value.tick)
      throw new Error(`cityState.events[${index}].tick exceeds state.tick`);
  }
  for (const [index, receipt] of value.receipts.entries()) {
    assertRecord(receipt, `cityState.receipts[${index}]`);
    if (typeof receipt.id !== "string")
      throw new Error(`cityState.receipts[${index}].id must be a string`);
    assertSafeInteger(receipt.tick, `cityState.receipts[${index}].tick`);
    if (!isKnownNpc(String(receipt.npcId))) {
      throw new Error(`cityState.receipts[${index}].npcId is invalid`);
    }
    if (!isKnownAction(String(receipt.actionId))) {
      throw new Error(`cityState.receipts[${index}].actionId is invalid`);
    }
    assertSafeInteger(
      receipt.quantity,
      `cityState.receipts[${index}].quantity`,
      1,
    );
    assertSafeInteger(
      receipt.unitPrice,
      `cityState.receipts[${index}].unitPrice`,
    );
    assertSafeInteger(
      receipt.totalPrice,
      `cityState.receipts[${index}].totalPrice`,
    );
    assertRecord(receipt.deltas, `cityState.receipts[${index}].deltas`);
  }
}
