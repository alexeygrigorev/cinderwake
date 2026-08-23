import { ARCHETYPES, MONSTERS } from "../game/content";
import { isFloor } from "../game/dungeon";
import type {
  AnimationClip,
  GameEventType,
  GameState,
  LootKind,
  Rarity,
  Vec2,
} from "../game/types";

const ANIMATION_CLIPS = new Set<AnimationClip>([
  "idle",
  "walk",
  "attack",
  "ability",
  "hurt",
  "death",
]);
const EVENT_TYPES = new Set<GameEventType>([
  "attack_started",
  "ability_started",
  "damage",
  "monster_died",
  "loot_dropped",
  "loot_picked",
  "player_damaged",
  "player_died",
  "exit_unlocked",
  "run_won",
]);
const LOOT_KINDS = new Set<LootKind>(["gold", "tonic", "weapon"]);
const RARITIES = new Set<Rarity>(["common", "tempered", "relic"]);
const RNG_STREAMS = ["map", "combat", "loot", "ai", "cosmetic"] as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path} must be a non-empty string`);
  return value;
}

function number(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  )
    throw new Error(`${path} must be a safe integer`);
  return value;
}

function nonNegative(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (parsed < 0) throw new Error(`${path} must be non-negative`);
  return parsed;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

function vector(value: unknown, path: string): Vec2 {
  const item = record(value, path);
  return {
    x: number(item.x, `${path}.x`),
    y: number(item.y, `${path}.y`),
  };
}

function animation(value: unknown, path: string): void {
  const item = record(value, path);
  if (!ANIMATION_CLIPS.has(item.clip as AnimationClip))
    throw new Error(`${path}.clip is invalid`);
  nonNegative(item.startedAtTick, `${path}.startedAtTick`);
  nonNegative(item.lockedUntilTick, `${path}.lockedUntilTick`);
}

function actor(value: unknown, path: string): Record<string, unknown> {
  const item = record(value, path);
  vector(item.position, `${path}.position`);
  vector(item.previousPosition, `${path}.previousPosition`);
  vector(item.velocity, `${path}.velocity`);
  vector(item.facing, `${path}.facing`);
  nonNegative(item.radius, `${path}.radius`);
  number(item.health, `${path}.health`);
  nonNegative(item.maxHealth, `${path}.maxHealth`);
  nonNegative(item.armor, `${path}.armor`);
  nonNegative(item.moveSpeed, `${path}.moveSpeed`);
  animation(item.animation, `${path}.animation`);
  return item;
}

function validateEvents(value: unknown, path: string): void {
  for (const [index, eventValue] of array(value, path).entries()) {
    const item = record(eventValue, `${path}[${index}]`);
    nonNegative(item.tick, `${path}[${index}].tick`);
    if (!EVENT_TYPES.has(item.type as GameEventType))
      throw new Error(`${path}[${index}].type is invalid`);
  }
}

function assertActorOnFloor(
  state: GameState,
  position: Vec2,
  path: string,
): void {
  if (
    !isFloor(
      state.map,
      Math.floor(position.x / 1024),
      Math.floor(position.y / 1024),
    )
  )
    throw new Error(`${path} must be on a walkable tile`);
}

/**
 * Validates and clones an exact authoritative snapshot. This is intentionally
 * separate from ScenarioV1: scenarios are ergonomic fixtures, while snapshots
 * restore every internal field without lossy tile conversion.
 */
export function stateFromSnapshot(input: unknown): GameState {
  const root = record(input, "state");
  if (root.schemaVersion !== 1)
    throw new Error("Only GameState schemaVersion 1 is supported");
  string(root.scenarioId, "state.scenarioId");
  string(root.seed, "state.seed");
  nonNegative(root.tick, "state.tick");
  if (root.tickRate !== 60) throw new Error("state.tickRate must be 60");
  if (!new Set(["playing", "won", "lost"]).has(root.phase as string))
    throw new Error("state.phase is invalid");
  nonNegative(root.nextEntityId, "state.nextEntityId");

  const map = record(root.map, "state.map");
  const width = nonNegative(map.width, "state.map.width");
  const height = nonNegative(map.height, "state.map.height");
  if (width < 1 || height < 1)
    throw new Error("state.map dimensions must be positive");
  const tiles = array(map.tiles, "state.map.tiles");
  if (tiles.length !== width * height)
    throw new Error("state.map.tiles length does not match dimensions");
  tiles.forEach((tile, index) => {
    if (tile !== 0 && tile !== 1)
      throw new Error(`state.map.tiles[${index}] must be 0 or 1`);
  });
  vector(map.spawn, "state.map.spawn");
  vector(map.exit, "state.map.exit");
  array(map.rooms, "state.map.rooms");
  string(map.digest, "state.map.digest");

  const rng = record(root.rng, "state.rng");
  for (const name of RNG_STREAMS) {
    const stream = record(rng[name], `state.rng.${name}`);
    nonNegative(stream.state, `state.rng.${name}.state`);
    nonNegative(stream.draws, `state.rng.${name}.draws`);
  }

  const player = actor(root.player, "state.player");
  if (player.id !== "player") throw new Error("state.player.id must be player");
  if (!(String(player.classId) in ARCHETYPES))
    throw new Error("state.player.classId is invalid");
  for (const field of [
    "attackDamage",
    "abilityDamage",
    "attackReadyTick",
    "abilityReadyTick",
    "invulnerableUntilTick",
    "level",
    "xp",
    "gold",
    "tonics",
    "power",
  ])
    nonNegative(player[field], `state.player.${field}`);

  const ids = new Set<string>(["player"]);
  const entityId = (value: unknown, path: string): string => {
    const id = string(value, path);
    if (ids.has(id)) throw new Error(`Duplicate entity id: ${id}`);
    ids.add(id);
    return id;
  };

  for (const [index, monsterValue] of array(
    root.monsters,
    "state.monsters",
  ).entries()) {
    const path = `state.monsters[${index}]`;
    const item = actor(monsterValue, path);
    entityId(item.id, `${path}.id`);
    if (!(String(item.kind) in MONSTERS))
      throw new Error(`${path}.kind is invalid`);
    for (const field of ["attackDamage", "attackRange", "attackReadyTick"])
      nonNegative(item[field], `${path}.${field}`);
    boolean(item.elite, `${path}.elite`);
    boolean(item.guaranteedLoot, `${path}.guaranteedLoot`);
  }

  for (const [index, attackValue] of array(
    root.pendingAttacks,
    "state.pendingAttacks",
  ).entries()) {
    const path = `state.pendingAttacks[${index}]`;
    const item = record(attackValue, path);
    entityId(item.id, `${path}.id`);
    string(item.ownerId, `${path}.ownerId`);
    if (item.kind !== "primary" && item.kind !== "ability")
      throw new Error(`${path}.kind is invalid`);
    nonNegative(item.impactTick, `${path}.impactTick`);
    vector(item.origin, `${path}.origin`);
    vector(item.direction, `${path}.direction`);
    nonNegative(item.range, `${path}.range`);
    nonNegative(item.damage, `${path}.damage`);
  }

  for (const [index, projectileValue] of array(
    root.projectiles,
    "state.projectiles",
  ).entries()) {
    const path = `state.projectiles[${index}]`;
    const item = record(projectileValue, path);
    entityId(item.id, `${path}.id`);
    string(item.owner, `${path}.owner`);
    boolean(item.hostile, `${path}.hostile`);
    vector(item.position, `${path}.position`);
    vector(item.previousPosition, `${path}.previousPosition`);
    vector(item.velocity, `${path}.velocity`);
    nonNegative(item.radius, `${path}.radius`);
    nonNegative(item.damage, `${path}.damage`);
    nonNegative(item.expiresAtTick, `${path}.expiresAtTick`);
    string(item.color, `${path}.color`);
    number(item.pierce, `${path}.pierce`);
  }

  for (const [index, lootValue] of array(root.loot, "state.loot").entries()) {
    const path = `state.loot[${index}]`;
    const item = record(lootValue, path);
    entityId(item.id, `${path}.id`);
    if (!LOOT_KINDS.has(item.kind as LootKind))
      throw new Error(`${path}.kind is invalid`);
    if (!RARITIES.has(item.rarity as Rarity))
      throw new Error(`${path}.rarity is invalid`);
    vector(item.position, `${path}.position`);
    nonNegative(item.amount, `${path}.amount`);
    string(item.sourceId, `${path}.sourceId`);
    number(item.bobOffset, `${path}.bobOffset`);
  }

  for (const [index, effectValue] of array(
    root.effects,
    "state.effects",
  ).entries()) {
    const path = `state.effects[${index}]`;
    const item = record(effectValue, path);
    entityId(item.id, `${path}.id`);
    if (!new Set(["slash", "nova", "impact"]).has(item.kind as string))
      throw new Error(`${path}.kind is invalid`);
    vector(item.position, `${path}.position`);
    string(item.color, `${path}.color`);
    nonNegative(item.startedAtTick, `${path}.startedAtTick`);
    nonNegative(item.expiresAtTick, `${path}.expiresAtTick`);
    nonNegative(item.radius, `${path}.radius`);
  }

  validateEvents(root.events, "state.events");
  validateEvents(root.eventLog, "state.eventLog");
  const metrics = record(root.metrics, "state.metrics");
  for (const field of [
    "kills",
    "damageDealt",
    "damageTaken",
    "lootCollected",
    "distanceUnits",
  ])
    nonNegative(metrics[field], `state.metrics.${field}`);
  const settings = record(root.settings, "state.settings");
  boolean(settings.ai, "state.settings.ai");
  boolean(settings.autoPickup, "state.settings.autoPickup");
  boolean(settings.cameraFollow, "state.settings.cameraFollow");
  boolean(root.exitUnlocked, "state.exitUnlocked");

  const clone = structuredClone(input) as GameState;
  assertActorOnFloor(clone, clone.player.position, "state.player.position");
  clone.monsters.forEach((monster, index) =>
    assertActorOnFloor(
      clone,
      monster.position,
      `state.monsters[${index}].position`,
    ),
  );
  clone.loot.forEach((loot, index) =>
    assertActorOnFloor(clone, loot.position, `state.loot[${index}].position`),
  );
  return clone;
}
