import { ARCHETYPES, MONSTERS } from "../game/content";
import {
  explicitDungeon,
  generateDungeon,
  isFloor,
  tileCenter,
} from "../game/dungeon";
import { createRngStreams, randomInt } from "../game/rng";
import { overlapsScenery, sceneryCollisions } from "../game/sceneryLayout";
import type {
  AnimationClip,
  AnimationState,
  CharacterClass,
  EffectState,
  GameEvent,
  GameMetrics,
  GamePhase,
  GameState,
  LootKind,
  LootState,
  MonsterKind,
  MonsterState,
  PendingAttack,
  ProjectileState,
  Rarity,
  RngStreams,
  Vec2,
} from "../game/types";
import type { CameraMode } from "../render/manifest";

type VecTuple = [number, number];

export interface ScenarioAnimationV1 {
  clip: AnimationClip;
  startedAtTick?: number;
  lockedUntilTick?: number;
}

export interface ScenarioMonsterV1 {
  id?: string;
  kind: MonsterKind;
  tile: VecTuple;
  previousTile?: VecTuple;
  velocity?: VecTuple;
  facing?: VecTuple;
  radius?: number;
  health?: number;
  maxHealth?: number;
  armor?: number;
  moveSpeed?: number;
  attackDamage?: number;
  attackRange?: number;
  attackReadyTick?: number;
  elite?: boolean;
  guaranteedLoot?: boolean;
  deathTick?: number | null;
  removeAtTick?: number | null;
  animation?: ScenarioAnimationV1;
}

export interface ScenarioLootV1 {
  id?: string;
  kind: LootKind;
  rarity?: Rarity;
  tile: VecTuple;
  amount?: number;
  sourceId?: string;
  bobOffset?: number;
}

export interface ScenarioProjectileV1 {
  id?: string;
  owner: string;
  hostile: boolean;
  tile: VecTuple;
  previousTile?: VecTuple;
  velocity: VecTuple;
  radius?: number;
  damage: number;
  expiresAtTick: number;
  color?: string;
  pierce?: number;
  spawnedAtTick?: number;
  hitTargets?: string[];
}

export interface ScenarioPendingAttackV1 {
  id?: string;
  ownerId?: string;
  kind: "primary" | "ability";
  impactTick: number;
  originTile: VecTuple;
  direction: VecTuple;
  range: number;
  damage: number;
}

export interface ScenarioEffectV1 {
  id?: string;
  kind: EffectState["kind"];
  tile: VecTuple;
  color: string;
  startedAtTick: number;
  expiresAtTick: number;
  radius: number;
}

export interface ScenarioV1 {
  schemaVersion: 1;
  id: string;
  seed: string;
  classId: CharacterClass;
  tick?: number;
  phase?: GamePhase;
  nextEntityId?: number;
  camera?: { mode?: CameraMode; centerTile?: VecTuple };
  map:
    | { mode: "generated"; width?: number; height?: number }
    | { mode: "explicit"; rows: string[] };
  player?: {
    tile?: VecTuple;
    previousTile?: VecTuple;
    velocity?: VecTuple;
    facing?: VecTuple;
    radius?: number;
    health?: number;
    maxHealth?: number;
    armor?: number;
    moveSpeed?: number;
    attackDamage?: number;
    abilityDamage?: number;
    attackReadyTick?: number;
    abilityReadyTick?: number;
    invulnerableUntilTick?: number;
    level?: number;
    xp?: number;
    gold?: number;
    tonics?: number;
    power?: number;
    animation?: ScenarioAnimationV1;
  };
  monsters?: ScenarioMonsterV1[];
  pendingAttacks?: ScenarioPendingAttackV1[];
  projectiles?: ScenarioProjectileV1[];
  loot?: ScenarioLootV1[];
  effects?: ScenarioEffectV1[];
  exitUnlocked?: boolean;
  rng?: Partial<Record<keyof RngStreams, { state: number; draws: number }>>;
  events?: GameEvent[];
  eventLog?: GameEvent[];
  metrics?: Partial<GameMetrics>;
  settings?: { ai?: boolean; autoPickup?: boolean; cameraFollow?: boolean };
}

function positionFromTile(tile: VecTuple): Vec2 {
  return {
    x: Math.round((tile[0] + 0.5) * 1024),
    y: Math.round((tile[1] + 0.5) * 1024),
  };
}

function vectorFromTuple(tuple: VecTuple | undefined, fallback: Vec2): Vec2 {
  return tuple
    ? { x: Math.round(tuple[0]), y: Math.round(tuple[1]) }
    : { ...fallback };
}

function animationFromSpec(
  spec: ScenarioAnimationV1 | undefined,
  tick: number,
): AnimationState {
  return {
    clip: spec?.clip ?? "idle",
    startedAtTick: spec?.startedAtTick ?? tick,
    lockedUntilTick: spec?.lockedUntilTick ?? tick,
  };
}

function createMonster(
  spec: ScenarioMonsterV1,
  index: number,
  tick: number,
): MonsterState {
  const definition = MONSTERS[spec.kind];
  const eliteMultiplier = spec.elite ? 2 : 1;
  const position = positionFromTile(spec.tile);
  const maxHealth = spec.maxHealth ?? definition.health * eliteMultiplier;
  return {
    id: spec.id ?? `monster:${index.toString().padStart(2, "0")}`,
    kind: spec.kind,
    position,
    previousPosition: spec.previousTile
      ? positionFromTile(spec.previousTile)
      : { ...position },
    velocity: vectorFromTuple(spec.velocity, { x: 0, y: 0 }),
    facing: vectorFromTuple(spec.facing, { x: -1024, y: 0 }),
    radius: spec.radius ?? (spec.kind === "stonekin" ? 420 : 300),
    health: spec.health ?? maxHealth,
    maxHealth,
    armor: spec.armor ?? definition.armor,
    moveSpeed: spec.moveSpeed ?? definition.moveSpeed,
    attackDamage:
      spec.attackDamage ??
      (spec.elite
        ? Math.floor(definition.attackDamage * 1.25)
        : definition.attackDamage),
    attackRange: spec.attackRange ?? definition.attackRange,
    attackReadyTick: spec.attackReadyTick ?? tick,
    elite: spec.elite ?? false,
    guaranteedLoot: spec.guaranteedLoot ?? spec.elite ?? false,
    deathTick: spec.deathTick ?? null,
    removeAtTick: spec.removeAtTick ?? null,
    animation: animationFromSpec(spec.animation, tick),
  };
}

function generatedMonsterSpecs(state: GameState): ScenarioMonsterV1[] {
  const nearCandidates: Vec2[] = [];
  const distantCandidates: Vec2[] = [];
  const solidScenery = sceneryCollisions(state.map);
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      const distance =
        Math.abs(x - state.map.spawn.x) + Math.abs(y - state.map.spawn.y);
      const position = tileCenter({ x, y });
      if (
        !isFloor(state.map, x, y) ||
        solidScenery.some((collision) =>
          overlapsScenery(position, 420, collision),
        )
      )
        continue;
      // Keep the authored opening group inside the narrow center slice that a
      // portrait phone retains after cover-fitting the 16:9 canvas. Manhattan
      // distance alone made enemies technically render-visible while their
      // bodies were cropped beyond the device viewport.
      if (
        distance >= 2 &&
        distance <= 3 &&
        Math.abs(x - state.map.spawn.x) <= 1
      )
        nearCandidates.push({ x, y });
      else if (distance > 8 && (x + y) % 3 === 0)
        distantCandidates.push({ x, y });
    }
  }
  const specs: ScenarioMonsterV1[] = [];
  const openingKinds: MonsterKind[] = ["stonekin", "ashfang", "hexer"];
  const distantKinds: MonsterKind[] = [
    "ashfang",
    "hexer",
    "stonekin",
    "ashfang",
  ];
  const drawCandidate = (candidates: Vec2[]) => {
    const selected = randomInt(state.rng.map, 0, candidates.length);
    return candidates.splice(selected, 1)[0];
  };
  const mirror = randomInt(state.rng.map, 0, 2) === 0 ? -1 : 1;
  const openingSlots = [
    { x: state.map.spawn.x - mirror, y: state.map.spawn.y + 1 },
    { x: state.map.spawn.x + mirror, y: state.map.spawn.y + 2 },
    { x: state.map.spawn.x + mirror, y: state.map.spawn.y - 2 },
  ];
  for (const slot of openingSlots) {
    if (nearCandidates.length === 0) break;
    const selectedIndex = nearCandidates.reduce((best, candidate, index) => {
      const score = (candidate.x - slot.x) ** 2 + (candidate.y - slot.y) ** 2;
      const incumbent = nearCandidates[best]!;
      const incumbentScore =
        (incumbent.x - slot.x) ** 2 + (incumbent.y - slot.y) ** 2;
      return score < incumbentScore ||
        (score === incumbentScore &&
          (candidate.y < incumbent.y ||
            (candidate.y === incumbent.y && candidate.x < incumbent.x)))
        ? index
        : best;
    }, 0);
    const tile = nearCandidates.splice(selectedIndex, 1)[0];
    if (!tile) break;
    specs.push({
      id: `monster:${specs.length.toString().padStart(2, "0")}`,
      kind: openingKinds[specs.length]!,
      tile: [tile.x, tile.y],
      guaranteedLoot: specs.length === 0,
    });
  }
  while (distantCandidates.length > 0 && specs.length < 14) {
    const tile = drawCandidate(distantCandidates);
    if (!tile) break;
    specs.push({
      id: `monster:${specs.length.toString().padStart(2, "0")}`,
      kind: distantKinds[specs.length % distantKinds.length]!,
      tile: [tile.x, tile.y],
      elite: specs.length === 11,
      guaranteedLoot: specs.length === 0 || specs.length === 11,
    });
  }
  return specs;
}

function assertSafeNumbers(value: unknown, path = "scenario"): void {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(`${path} contains an unsafe number`);
  }
  if (Array.isArray(value))
    value.forEach((entry, index) =>
      assertSafeNumbers(entry, `${path}[${index}]`),
    );
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value))
      assertSafeNumbers(entry, `${path}.${key}`);
  }
}

function assertTuple(value: unknown, name: string): asserts value is VecTuple {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new Error(`${name} must be a finite [x, y] tuple`);
  }
}

function assertKnownKeys(
  value: unknown,
  allowed: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(`${path} contains unknown field ${unknown[0]}`);
}

function assertOptionalInteger(
  value: unknown,
  path: string,
  minimum = 0,
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`${path} must be a safe integer >= ${minimum}`);
}

function assertOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean")
    throw new Error(`${path} must be boolean`);
}

function assertInteger(value: unknown, path: string, minimum = 0): void {
  if (value === undefined) throw new Error(`${path} is required`);
  assertOptionalInteger(value, path, minimum);
}

function assertBoolean(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`${path} is required`);
  assertOptionalBoolean(value, path);
}

function assertString(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`${path} is required`);
  assertOptionalString(value, path);
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0))
    throw new Error(`${path} must be a non-empty string`);
}

function assertAnimation(value: unknown, path: string): void {
  assertKnownKeys(value, ["clip", "startedAtTick", "lockedUntilTick"], path);
  if (!ANIMATION_CLIPS.includes(value.clip as AnimationClip))
    throw new Error(`${path}.clip is invalid`);
  assertOptionalInteger(value.startedAtTick, `${path}.startedAtTick`);
  assertOptionalInteger(value.lockedUntilTick, `${path}.lockedUntilTick`);
}

const ANIMATION_CLIPS: AnimationClip[] = [
  "idle",
  "walk",
  "attack",
  "ability",
  "hurt",
  "death",
];
const EVENT_TYPES = [
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
];

export function validateScenario(input: unknown): asserts input is ScenarioV1 {
  assertKnownKeys(
    input,
    [
      "schemaVersion",
      "id",
      "seed",
      "classId",
      "tick",
      "phase",
      "nextEntityId",
      "camera",
      "map",
      "player",
      "monsters",
      "pendingAttacks",
      "projectiles",
      "loot",
      "effects",
      "exitUnlocked",
      "rng",
      "events",
      "eventLog",
      "metrics",
      "settings",
    ],
    "Scenario",
  );
  const scenario = input as Partial<ScenarioV1>;
  if (scenario.schemaVersion !== 1)
    throw new Error("Only ScenarioV1 is supported");
  if (!scenario.id || typeof scenario.id !== "string")
    throw new Error("Scenario id is required");
  if (!scenario.seed || typeof scenario.seed !== "string")
    throw new Error("Scenario seed is required");
  if (!scenario.classId || !(scenario.classId in ARCHETYPES))
    throw new Error("Scenario classId is invalid");
  if (!scenario.map || !["generated", "explicit"].includes(scenario.map.mode))
    throw new Error("Scenario map mode is invalid");
  if (scenario.map.mode === "generated") {
    assertKnownKeys(scenario.map, ["mode", "width", "height"], "Scenario.map");
    assertOptionalInteger(scenario.map.width, "Scenario.map.width", 20);
    assertOptionalInteger(scenario.map.height, "Scenario.map.height", 16);
    if ((scenario.map.width ?? 44) > 128 || (scenario.map.height ?? 32) > 96)
      throw new Error("Generated scenario map dimensions are too large");
  } else {
    assertKnownKeys(scenario.map, ["mode", "rows"], "Scenario.map");
    if (!Array.isArray(scenario.map.rows))
      throw new Error("Explicit scenario rows are required");
    if (scenario.map.rows.some((row) => typeof row !== "string"))
      throw new Error("Explicit scenario rows must be strings");
    explicitDungeon(scenario.map.rows);
  }
  assertOptionalInteger(scenario.tick, "Scenario.tick");
  assertOptionalInteger(scenario.nextEntityId, "Scenario.nextEntityId", 1);
  if (scenario.phase && !["playing", "won", "lost"].includes(scenario.phase))
    throw new Error("Scenario phase is invalid");
  if (scenario.camera) {
    assertKnownKeys(scenario.camera, ["mode", "centerTile"], "Scenario.camera");
    if (
      scenario.camera.mode &&
      !["snap", "smooth", "fixed"].includes(scenario.camera.mode)
    )
      throw new Error("Scenario camera mode is invalid");
    if (scenario.camera.centerTile)
      assertTuple(scenario.camera.centerTile, "Camera center tile");
  }
  assertSafeNumbers(scenario);

  const ids = new Set<string>(["player"]);
  const registerId = (id: string | undefined): void => {
    if (!id) return;
    if (ids.has(id)) throw new Error(`Duplicate entity id: ${id}`);
    ids.add(id);
  };
  if (scenario.player) {
    assertKnownKeys(
      scenario.player,
      [
        "tile",
        "previousTile",
        "velocity",
        "facing",
        "radius",
        "health",
        "maxHealth",
        "armor",
        "moveSpeed",
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
        "animation",
      ],
      "Scenario.player",
    );
    for (const field of ["tile", "previousTile", "velocity", "facing"] as const)
      if (scenario.player[field])
        assertTuple(scenario.player[field], `Scenario.player.${field}`);
    for (const field of [
      "radius",
      "health",
      "maxHealth",
      "armor",
      "moveSpeed",
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
    ] as const)
      assertOptionalInteger(scenario.player[field], `Scenario.player.${field}`);
    if (scenario.player.animation)
      assertAnimation(scenario.player.animation, "Scenario.player.animation");
  }
  if (scenario.monsters !== undefined && !Array.isArray(scenario.monsters))
    throw new Error("Scenario.monsters must be an array");
  for (const [index, monster] of (scenario.monsters ?? []).entries()) {
    const path = `Scenario.monsters[${index}]`;
    assertKnownKeys(
      monster,
      [
        "id",
        "kind",
        "tile",
        "previousTile",
        "velocity",
        "facing",
        "radius",
        "health",
        "maxHealth",
        "armor",
        "moveSpeed",
        "attackDamage",
        "attackRange",
        "attackReadyTick",
        "elite",
        "guaranteedLoot",
        "deathTick",
        "removeAtTick",
        "animation",
      ],
      path,
    );
    if (!(monster.kind in MONSTERS))
      throw new Error(`Unknown monster kind: ${monster.kind}`);
    assertTuple(monster.tile, `${path}.tile`);
    for (const field of ["previousTile", "velocity", "facing"] as const)
      if (monster[field]) assertTuple(monster[field], `${path}.${field}`);
    for (const field of [
      "radius",
      "health",
      "maxHealth",
      "armor",
      "moveSpeed",
      "attackDamage",
      "attackRange",
      "attackReadyTick",
    ] as const)
      assertOptionalInteger(monster[field], `${path}.${field}`);
    if (monster.deathTick !== null)
      assertOptionalInteger(monster.deathTick, `${path}.deathTick`);
    if (monster.removeAtTick !== null)
      assertOptionalInteger(monster.removeAtTick, `${path}.removeAtTick`);
    assertOptionalBoolean(monster.elite, `${path}.elite`);
    assertOptionalBoolean(monster.guaranteedLoot, `${path}.guaranteedLoot`);
    assertOptionalString(monster.id, `${path}.id`);
    if (monster.animation)
      assertAnimation(monster.animation, `${path}.animation`);
    registerId(monster.id);
  }
  if (scenario.loot !== undefined && !Array.isArray(scenario.loot))
    throw new Error("Scenario.loot must be an array");
  for (const [index, loot] of (scenario.loot ?? []).entries()) {
    const path = `Scenario.loot[${index}]`;
    assertKnownKeys(
      loot,
      ["id", "kind", "rarity", "tile", "amount", "sourceId", "bobOffset"],
      path,
    );
    if (!(["gold", "tonic", "weapon"] as unknown[]).includes(loot.kind))
      throw new Error(`${path}.kind is invalid`);
    if (
      loot.rarity !== undefined &&
      !(["common", "tempered", "relic"] as unknown[]).includes(loot.rarity)
    )
      throw new Error(`${path}.rarity is invalid`);
    assertTuple(loot.tile, `${path}.tile`);
    assertOptionalInteger(loot.amount, `${path}.amount`);
    assertOptionalInteger(
      loot.bobOffset,
      `${path}.bobOffset`,
      -Number.MAX_SAFE_INTEGER,
    );
    assertOptionalString(loot.id, `${path}.id`);
    assertOptionalString(loot.sourceId, `${path}.sourceId`);
    registerId(loot.id);
  }
  if (
    scenario.projectiles !== undefined &&
    !Array.isArray(scenario.projectiles)
  )
    throw new Error("Scenario.projectiles must be an array");
  for (const [index, projectile] of (scenario.projectiles ?? []).entries()) {
    const path = `Scenario.projectiles[${index}]`;
    assertKnownKeys(
      projectile,
      [
        "id",
        "owner",
        "hostile",
        "tile",
        "previousTile",
        "velocity",
        "radius",
        "damage",
        "expiresAtTick",
        "color",
        "pierce",
        "spawnedAtTick",
        "hitTargets",
      ],
      path,
    );
    assertOptionalString(projectile.id, `${path}.id`);
    assertString(projectile.owner, `${path}.owner`);
    assertBoolean(projectile.hostile, `${path}.hostile`);
    assertTuple(projectile.tile, `${path}.tile`);
    if (projectile.previousTile)
      assertTuple(projectile.previousTile, `${path}.previousTile`);
    assertTuple(projectile.velocity, `${path}.velocity`);
    assertOptionalInteger(projectile.radius, `${path}.radius`);
    assertInteger(projectile.damage, `${path}.damage`);
    assertInteger(projectile.expiresAtTick, `${path}.expiresAtTick`);
    assertOptionalInteger(projectile.pierce, `${path}.pierce`, -1);
    assertOptionalInteger(
      projectile.spawnedAtTick,
      `${path}.spawnedAtTick`,
      -1,
    );
    assertOptionalString(projectile.color, `${path}.color`);
    if (projectile.hitTargets !== undefined) {
      if (!Array.isArray(projectile.hitTargets))
        throw new Error(`${path}.hitTargets must be an array`);
      projectile.hitTargets.forEach((target, targetIndex) =>
        assertOptionalString(target, `${path}.hitTargets[${targetIndex}]`),
      );
    }
    registerId(projectile.id);
  }
  if (
    scenario.pendingAttacks !== undefined &&
    !Array.isArray(scenario.pendingAttacks)
  )
    throw new Error("Scenario.pendingAttacks must be an array");
  for (const [index, attack] of (scenario.pendingAttacks ?? []).entries()) {
    const path = `Scenario.pendingAttacks[${index}]`;
    assertKnownKeys(
      attack,
      [
        "id",
        "ownerId",
        "kind",
        "impactTick",
        "originTile",
        "direction",
        "range",
        "damage",
      ],
      path,
    );
    if (!(["primary", "ability"] as unknown[]).includes(attack.kind))
      throw new Error(`${path}.kind is invalid`);
    assertOptionalString(attack.id, `${path}.id`);
    assertOptionalString(attack.ownerId, `${path}.ownerId`);
    assertTuple(attack.originTile, `${path}.originTile`);
    assertTuple(attack.direction, `${path}.direction`);
    for (const field of ["impactTick", "range", "damage"] as const)
      assertInteger(attack[field], `${path}.${field}`);
    registerId(attack.id);
  }
  if (scenario.effects !== undefined && !Array.isArray(scenario.effects))
    throw new Error("Scenario.effects must be an array");
  for (const [index, effect] of (scenario.effects ?? []).entries()) {
    const path = `Scenario.effects[${index}]`;
    assertKnownKeys(
      effect,
      [
        "id",
        "kind",
        "tile",
        "color",
        "startedAtTick",
        "expiresAtTick",
        "radius",
      ],
      path,
    );
    if (!(["slash", "nova", "impact"] as unknown[]).includes(effect.kind))
      throw new Error(`${path}.kind is invalid`);
    assertOptionalString(effect.id, `${path}.id`);
    assertTuple(effect.tile, `${path}.tile`);
    assertString(effect.color, `${path}.color`);
    for (const field of ["startedAtTick", "expiresAtTick", "radius"] as const)
      assertInteger(effect[field], `${path}.${field}`);
    registerId(effect.id);
  }
  assertOptionalBoolean(scenario.exitUnlocked, "Scenario.exitUnlocked");

  if (scenario.rng) {
    assertKnownKeys(
      scenario.rng,
      ["map", "combat", "loot", "ai", "cosmetic"],
      "Scenario.rng",
    );
    for (const [name, stream] of Object.entries(scenario.rng)) {
      assertKnownKeys(stream, ["state", "draws"], `Scenario.rng.${name}`);
      assertInteger(stream.state, `Scenario.rng.${name}.state`);
      assertInteger(stream.draws, `Scenario.rng.${name}.draws`);
    }
  }
  const validateEvents = (
    events: GameEvent[] | undefined,
    path: string,
  ): void => {
    if (events === undefined) return;
    if (!Array.isArray(events)) throw new Error(`${path} must be an array`);
    events.forEach((event, index) => {
      const eventPath = `${path}[${index}]`;
      assertKnownKeys(
        event,
        ["tick", "type", "sourceId", "targetId", "amount", "detail"],
        eventPath,
      );
      assertInteger(event.tick, `${eventPath}.tick`);
      if (!EVENT_TYPES.includes(event.type))
        throw new Error(`${eventPath}.type is invalid`);
      assertOptionalString(event.sourceId, `${eventPath}.sourceId`);
      assertOptionalString(event.targetId, `${eventPath}.targetId`);
      assertOptionalInteger(event.amount, `${eventPath}.amount`);
      assertOptionalString(event.detail, `${eventPath}.detail`);
    });
  };
  validateEvents(scenario.events, "Scenario.events");
  validateEvents(scenario.eventLog, "Scenario.eventLog");
  if (scenario.metrics) {
    assertKnownKeys(
      scenario.metrics,
      ["kills", "damageDealt", "damageTaken", "lootCollected", "distanceUnits"],
      "Scenario.metrics",
    );
    for (const [name, value] of Object.entries(scenario.metrics))
      assertOptionalInteger(value, `Scenario.metrics.${name}`);
  }
  if (scenario.settings) {
    assertKnownKeys(
      scenario.settings,
      ["ai", "autoPickup", "cameraFollow"],
      "Scenario.settings",
    );
    assertOptionalBoolean(scenario.settings.ai, "Scenario.settings.ai");
    assertOptionalBoolean(
      scenario.settings.autoPickup,
      "Scenario.settings.autoPickup",
    );
    assertOptionalBoolean(
      scenario.settings.cameraFollow,
      "Scenario.settings.cameraFollow",
    );
  }
}

function assertOnFloor(state: GameState, position: Vec2, name: string): void {
  if (
    !isFloor(
      state.map,
      Math.floor(position.x / 1024),
      Math.floor(position.y / 1024),
    )
  ) {
    throw new Error(`${name} must start on a walkable tile`);
  }
}

export function worldFromScenario(input: ScenarioV1): GameState {
  validateScenario(input);
  const map =
    input.map.mode === "generated"
      ? generateDungeon(
          input.seed,
          input.map.width ?? 44,
          input.map.height ?? 32,
        )
      : explicitDungeon(input.map.rows);
  const archetype = ARCHETYPES[input.classId];
  const tick = input.tick ?? 0;
  const position = input.player?.tile
    ? positionFromTile(input.player.tile)
    : tileCenter(map.spawn);
  const maxHealth = input.player?.maxHealth ?? archetype.health;
  const rng = createRngStreams(input.seed);
  for (const name of Object.keys(input.rng ?? {}) as Array<keyof RngStreams>) {
    const override = input.rng?.[name];
    if (override) rng[name] = { ...override };
  }

  const state: GameState = {
    schemaVersion: 1,
    scenarioId: input.id,
    seed: input.seed,
    tick,
    tickRate: 60,
    phase: input.phase ?? "playing",
    nextEntityId: input.nextEntityId ?? 1,
    rng,
    map,
    player: {
      id: "player",
      classId: input.classId,
      position,
      previousPosition: input.player?.previousTile
        ? positionFromTile(input.player.previousTile)
        : { ...position },
      velocity: vectorFromTuple(input.player?.velocity, { x: 0, y: 0 }),
      facing: vectorFromTuple(input.player?.facing, { x: 1024, y: 0 }),
      radius: input.player?.radius ?? 320,
      health: input.player?.health ?? maxHealth,
      maxHealth,
      armor: input.player?.armor ?? archetype.armor,
      moveSpeed: input.player?.moveSpeed ?? archetype.moveSpeed,
      attackDamage: input.player?.attackDamage ?? archetype.attackDamage,
      abilityDamage: input.player?.abilityDamage ?? archetype.abilityDamage,
      attackReadyTick: input.player?.attackReadyTick ?? tick,
      abilityReadyTick: input.player?.abilityReadyTick ?? tick,
      invulnerableUntilTick: input.player?.invulnerableUntilTick ?? tick,
      level: input.player?.level ?? 1,
      xp: input.player?.xp ?? 0,
      gold: input.player?.gold ?? 0,
      tonics: input.player?.tonics ?? 2,
      power: input.player?.power ?? 0,
      animation: animationFromSpec(input.player?.animation, tick),
    },
    monsters: [],
    pendingAttacks: [],
    projectiles: [],
    loot: [],
    effects: [],
    exitUnlocked: false,
    events: (input.events ?? []).map((event) => ({ ...event })),
    eventLog: (input.eventLog ?? []).map((event) => ({ ...event })),
    metrics: {
      kills: input.metrics?.kills ?? 0,
      damageDealt: input.metrics?.damageDealt ?? 0,
      damageTaken: input.metrics?.damageTaken ?? 0,
      lootCollected: input.metrics?.lootCollected ?? 0,
      distanceUnits: input.metrics?.distanceUnits ?? 0,
    },
    settings: {
      ai: input.settings?.ai ?? true,
      autoPickup: input.settings?.autoPickup ?? true,
      cameraFollow: input.settings?.cameraFollow ?? true,
    },
  };

  const monsterSpecs =
    input.monsters ??
    (input.map.mode === "generated" ? generatedMonsterSpecs(state) : []);
  state.monsters = monsterSpecs
    .map((spec, index) => createMonster(spec, index, tick))
    .sort((a, b) => a.id.localeCompare(b.id));
  state.pendingAttacks = (input.pendingAttacks ?? []).map(
    (attack, index): PendingAttack => ({
      id: attack.id ?? `attack:fixture:${index}`,
      ownerId: attack.ownerId ?? "player",
      kind: attack.kind,
      impactTick: attack.impactTick,
      origin: positionFromTile(attack.originTile),
      direction: vectorFromTuple(attack.direction, { x: 1024, y: 0 }),
      range: attack.range,
      damage: attack.damage,
    }),
  );
  state.projectiles = (input.projectiles ?? []).map(
    (projectile, index): ProjectileState => {
      const projectilePosition = positionFromTile(projectile.tile);
      return {
        id: projectile.id ?? `projectile:fixture:${index}`,
        owner: projectile.owner,
        hostile: projectile.hostile,
        position: projectilePosition,
        previousPosition: projectile.previousTile
          ? positionFromTile(projectile.previousTile)
          : { ...projectilePosition },
        velocity: vectorFromTuple(projectile.velocity, { x: 0, y: 0 }),
        radius: projectile.radius ?? 130,
        damage: projectile.damage,
        expiresAtTick: projectile.expiresAtTick,
        color:
          projectile.color ??
          (projectile.hostile ? "#d36de7" : archetype.accent),
        pierce: projectile.pierce ?? 0,
        spawnedAtTick: projectile.spawnedAtTick ?? tick - 1,
        hitTargets: [...(projectile.hitTargets ?? [])],
      };
    },
  );
  state.loot = (input.loot ?? []).map((loot, index): LootState => ({
    id: loot.id ?? `loot:fixture:${index}`,
    kind: loot.kind,
    rarity: loot.rarity ?? "common",
    position: positionFromTile(loot.tile),
    amount: loot.amount ?? 1,
    sourceId: loot.sourceId ?? "fixture",
    bobOffset: loot.bobOffset ?? index * 9,
  }));
  state.effects = (input.effects ?? []).map((effect, index): EffectState => ({
    id: effect.id ?? `effect:fixture:${index}`,
    kind: effect.kind,
    position: positionFromTile(effect.tile),
    color: effect.color,
    startedAtTick: effect.startedAtTick,
    expiresAtTick: effect.expiresAtTick,
    radius: effect.radius,
  }));
  const constructedIds = new Set(["player"]);
  for (const entity of [
    ...state.monsters,
    ...state.pendingAttacks,
    ...state.projectiles,
    ...state.loot,
    ...state.effects,
  ]) {
    if (constructedIds.has(entity.id))
      throw new Error(`Duplicate entity id: ${entity.id}`);
    constructedIds.add(entity.id);
  }
  assertOnFloor(state, state.player.position, "Player");
  state.monsters.forEach((monster) =>
    assertOnFloor(state, monster.position, monster.id),
  );
  state.loot.forEach((loot) => assertOnFloor(state, loot.position, loot.id));
  state.nextEntityId =
    input.nextEntityId ??
    1 +
      state.monsters.length +
      state.pendingAttacks.length +
      state.projectiles.length +
      state.loot.length +
      state.effects.length;
  state.exitUnlocked = input.exitUnlocked ?? state.monsters.length === 0;
  return state;
}

function arenaRows(width = 22, height = 15): string[] {
  return Array.from({ length: height }, (_, y) => {
    if (y === 0 || y === height - 1) return "#".repeat(width);
    const cells: string[] = Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 ? "#" : ".",
    );
    if (y === Math.floor(height / 2)) cells[Math.floor(width / 2)] = "P";
    if (y === 2) cells[width - 3] = "E";
    return cells.join("");
  });
}

export const TEMPORAL_ENTITY_IDS = {
  heroTarget: "monster:temporal-target",
  ashfangAttacker: "monster:temporal-ashfang",
  hexerAttacker: "monster:temporal-hexer",
  stonekinAttacker: "monster:temporal-stonekin",
  deathSubject: "monster:temporal-death",
  deathContact: "attack:temporal-death-contact",
  friendlyProjectile: "projectile:temporal-friendly",
  friendlyImpactProjectile: "projectile:temporal-friendly-impact",
  friendlyImpactTarget: "monster:temporal-projectile-target",
  goldLoot: "loot:temporal-gold",
  tonicLoot: "loot:temporal-tonic",
  weaponLoot: "loot:temporal-weapon",
  lossAttacker: "monster:temporal-loss",
  lossContact: "attack:temporal-loss-contact",
} as const;

export type TemporalInputAction = "attack" | "ability" | "move-right" | null;

export interface TemporalScenarioContract {
  scenarioId: string;
  subjectId: string;
  targetId?: string;
  inputAction: TemporalInputAction;
  /** Simulation event tick, before stepGame increments the state tick. */
  contactEventTick?: number;
  /** First captured state tick where an intentionally consumed subject is absent. */
  despawnStateTick?: number;
  /** Exact state ticks recommended for synchronized state/manifest/PNG capture. */
  captureTicks: readonly number[];
}

/**
 * Public temporal-quality catalog. These names and entity IDs are stable test API:
 * capture/report tooling may refer to them without inspecting scenario internals.
 */
export const TEMPORAL_SCENARIO_CONTRACTS = {
  "temporal-vanguard-primary": {
    scenarioId: "temporal-vanguard-primary",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "attack",
    contactEventTick: 8,
    captureTicks: [0, 4, 8, 9, 16, 26, 27],
  },
  "temporal-vanguard-ability": {
    scenarioId: "temporal-vanguard-ability",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "ability",
    contactEventTick: 12,
    captureTicks: [0, 6, 12, 13, 24, 36, 37],
  },
  "temporal-ranger-primary": {
    scenarioId: "temporal-ranger-primary",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "attack",
    contactEventTick: 23,
    captureTicks: [0, 3, 6, 7, 16, 24, 26, 27],
  },
  "temporal-ranger-primary-north": {
    scenarioId: "temporal-ranger-primary-north",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "attack",
    contactEventTick: 23,
    captureTicks: [0, 3, 6, 7, 16, 24, 26, 27],
  },
  "temporal-ranger-ability": {
    scenarioId: "temporal-ranger-ability",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "ability",
    contactEventTick: 27,
    captureTicks: [0, 5, 10, 11, 20, 28, 36, 37],
  },
  "temporal-arcanist-primary": {
    scenarioId: "temporal-arcanist-primary",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "attack",
    contactEventTick: 29,
    captureTicks: [0, 4, 8, 9, 20, 27, 30, 36, 37],
  },
  "temporal-arcanist-ability": {
    scenarioId: "temporal-arcanist-ability",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "ability",
    contactEventTick: 12,
    captureTicks: [0, 6, 12, 13, 24, 36, 37],
  },
  "temporal-arcanist-ability-south": {
    scenarioId: "temporal-arcanist-ability-south",
    subjectId: "player",
    targetId: TEMPORAL_ENTITY_IDS.heroTarget,
    inputAction: "ability",
    contactEventTick: 12,
    captureTicks: [0, 6, 12, 13, 24, 36, 37],
  },
  "temporal-ashfang-attack": {
    scenarioId: "temporal-ashfang-attack",
    subjectId: TEMPORAL_ENTITY_IDS.ashfangAttacker,
    targetId: "player",
    inputAction: null,
    contactEventTick: 7,
    captureTicks: [0, 1, 4, 7, 8, 18, 26, 27],
  },
  "temporal-hexer-attack": {
    scenarioId: "temporal-hexer-attack",
    subjectId: TEMPORAL_ENTITY_IDS.hexerAttacker,
    targetId: "player",
    inputAction: null,
    contactEventTick: 43,
    captureTicks: [0, 1, 6, 12, 13, 24, 27, 36, 44],
  },
  "temporal-stonekin-attack": {
    scenarioId: "temporal-stonekin-attack",
    subjectId: TEMPORAL_ENTITY_IDS.stonekinAttacker,
    targetId: "player",
    inputAction: null,
    contactEventTick: 10,
    captureTicks: [0, 1, 5, 10, 11, 20, 26, 27],
  },
  "temporal-enemy-death": {
    scenarioId: "temporal-enemy-death",
    subjectId: TEMPORAL_ENTITY_IDS.deathSubject,
    targetId: TEMPORAL_ENTITY_IDS.deathSubject,
    inputAction: null,
    contactEventTick: 0,
    captureTicks: [0, 1, 8, 16, 24, 32, 40, 48, 49],
  },
  "temporal-friendly-projectile": {
    scenarioId: "temporal-friendly-projectile",
    subjectId: TEMPORAL_ENTITY_IDS.friendlyProjectile,
    inputAction: null,
    captureTicks: [0, 1, 12, 24, 36, 48, 60],
  },
  "temporal-friendly-projectile-impact": {
    scenarioId: "temporal-friendly-projectile-impact",
    subjectId: TEMPORAL_ENTITY_IDS.friendlyImpactProjectile,
    targetId: TEMPORAL_ENTITY_IDS.friendlyImpactTarget,
    inputAction: null,
    contactEventTick: 18,
    despawnStateTick: 19,
    captureTicks: [0, 3, 6, 9, 12, 15, 17, 18, 19, 21, 24, 27, 30, 31],
  },
  "temporal-loot-bob": {
    scenarioId: "temporal-loot-bob",
    subjectId: TEMPORAL_ENTITY_IDS.goldLoot,
    inputAction: null,
    captureTicks: [0, 6, 12, 18, 24, 36, 48],
  },
  "temporal-camera-track": {
    scenarioId: "temporal-camera-track",
    subjectId: "player",
    inputAction: null,
    captureTicks: [0, 1, 4, 8, 12, 20, 30, 45, 60],
  },
  "temporal-run-win": {
    scenarioId: "temporal-run-win",
    subjectId: "player",
    inputAction: null,
    contactEventTick: 0,
    captureTicks: [0, 1, 12, 24, 36, 48],
  },
  "temporal-run-loss": {
    scenarioId: "temporal-run-loss",
    subjectId: "player",
    targetId: "player",
    inputAction: null,
    contactEventTick: 0,
    captureTicks: [0, 1, 8, 16, 24, 32, 40, 48, 49],
  },
} as const satisfies Record<string, TemporalScenarioContract>;

function temporalHeroAction(
  classId: CharacterClass,
  action: "primary" | "ability",
  direction: {
    suffix?: "north" | "south";
    facing?: VecTuple;
    targetTile?: VecTuple;
  } = {},
): ScenarioV1 {
  const scenarioId = `temporal-${classId}-${action}${
    direction.suffix ? `-${direction.suffix}` : ""
  }`;
  const isMelee =
    classId === "vanguard" || (classId === "arcanist" && action === "ability");
  // Keep melee subjects inside the 1.6-tile hit range while leaving enough
  // screen-space separation for both authored silhouettes and the contact VFX
  // to remain inspectable in temporal evidence.
  const targetTile: VecTuple =
    direction.targetTile ?? (isMelee ? [10.55, 7] : [13, 7]);
  return {
    schemaVersion: 1,
    id: scenarioId,
    seed: `quality-${classId}-${action}${
      direction.suffix ? `-${direction.suffix}` : ""
    }-01`,
    classId,
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    player: {
      tile: [9, 7],
      facing: direction.facing ?? [1024, 0],
      power: 0,
    },
    monsters: [
      {
        id: TEMPORAL_ENTITY_IDS.heroTarget,
        kind: "ashfang",
        tile: targetTile,
        health: 120,
        maxHealth: 120,
        armor: 0,
        attackReadyTick: 10_000,
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  };
}

function temporalEnemyAttack(kind: MonsterKind): ScenarioV1 {
  const entityId =
    kind === "ashfang"
      ? TEMPORAL_ENTITY_IDS.ashfangAttacker
      : kind === "hexer"
        ? TEMPORAL_ENTITY_IDS.hexerAttacker
        : TEMPORAL_ENTITY_IDS.stonekinAttacker;
  const monsterTile: VecTuple =
    kind === "hexer" ? [13, 7] : kind === "ashfang" ? [9.6, 7] : [9.8, 7];
  return {
    schemaVersion: 1,
    id: `temporal-${kind}-attack`,
    seed: `quality-${kind}-attack-01`,
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    player: { tile: [9, 7], health: 100, maxHealth: 100, armor: 0 },
    monsters: [
      {
        id: entityId,
        kind,
        tile: monsterTile,
        attackReadyTick: 0,
        guaranteedLoot: false,
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: true },
  };
}

export const BUILTIN_SCENARIOS: Record<string, ScenarioV1> = {
  "animation-idle": {
    schemaVersion: 1,
    id: "animation-idle",
    seed: "vis-idle-01",
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows() },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "animation-walk": {
    schemaVersion: 1,
    id: "animation-walk",
    seed: "vis-run-02",
    classId: "ranger",
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "combat-loot": {
    schemaVersion: 1,
    id: "combat-loot",
    seed: "scn-loot-0301",
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows() },
    player: { tile: [9, 7], facing: [1024, 0], power: 8 },
    monsters: [
      {
        id: "monster:target",
        kind: "ashfang",
        tile: [10.55, 7],
        health: 20,
        elite: true,
        guaranteedLoot: true,
      },
    ],
    settings: { ai: false, autoPickup: true, cameraFollow: true },
  },
  "camera-track": {
    schemaVersion: 1,
    id: "camera-track",
    seed: "vis-camera-01",
    classId: "arcanist",
    map: { mode: "explicit", rows: arenaRows(38, 12) },
    player: { tile: [26, 6] },
    monsters: [],
    camera: { mode: "smooth", centerTile: [4, 6] },
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "mid-action": {
    schemaVersion: 1,
    id: "mid-action",
    seed: "fixture-mid-action",
    classId: "arcanist",
    tick: 240,
    map: { mode: "explicit", rows: arenaRows() },
    player: {
      tile: [9, 7],
      facing: [1024, 0],
      health: 37,
      attackReadyTick: 255,
      abilityReadyTick: 420,
      animation: { clip: "ability", startedAtTick: 234, lockedUntilTick: 270 },
    },
    monsters: [
      {
        id: "monster:winding-up",
        kind: "stonekin",
        tile: [11, 7],
        attackReadyTick: 300,
        animation: { clip: "attack", startedAtTick: 237, lockedUntilTick: 257 },
      },
    ],
    pendingAttacks: [
      {
        id: "attack:due",
        kind: "ability",
        impactTick: 246,
        originTile: [9, 7],
        direction: [1024, 0],
        range: 2816,
        damage: 28,
      },
    ],
    projectiles: [
      {
        id: "projectile:incoming",
        owner: "monster:winding-up",
        hostile: true,
        tile: [10, 6.5],
        velocity: [-100, 40],
        damage: 7,
        expiresAtTick: 280,
      },
    ],
    effects: [
      {
        id: "effect:telegraph",
        kind: "nova",
        tile: [11, 7],
        color: "#d36de7",
        startedAtTick: 232,
        expiresAtTick: 252,
        radius: 2048,
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "temporal-vanguard-primary": temporalHeroAction("vanguard", "primary"),
  "temporal-vanguard-ability": temporalHeroAction("vanguard", "ability"),
  "temporal-ranger-primary": temporalHeroAction("ranger", "primary"),
  "temporal-ranger-primary-north": temporalHeroAction("ranger", "primary", {
    suffix: "north",
    facing: [0, -1024],
    targetTile: [9, 3],
  }),
  "temporal-ranger-ability": temporalHeroAction("ranger", "ability"),
  "temporal-arcanist-primary": temporalHeroAction("arcanist", "primary"),
  "temporal-arcanist-ability": temporalHeroAction("arcanist", "ability"),
  "temporal-arcanist-ability-south": temporalHeroAction("arcanist", "ability", {
    suffix: "south",
    facing: [0, 1024],
    targetTile: [9, 8.55],
  }),
  "temporal-ashfang-attack": temporalEnemyAttack("ashfang"),
  "temporal-hexer-attack": temporalEnemyAttack("hexer"),
  "temporal-stonekin-attack": temporalEnemyAttack("stonekin"),
  "temporal-enemy-death": {
    schemaVersion: 1,
    id: "temporal-enemy-death",
    seed: "quality-enemy-death-01",
    classId: "vanguard",
    tick: 0,
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    player: {
      tile: [9, 7],
      facing: [1024, 0],
      animation: { clip: "attack", startedAtTick: 0, lockedUntilTick: 26 },
    },
    monsters: [
      {
        id: TEMPORAL_ENTITY_IDS.deathSubject,
        kind: "ashfang",
        tile: [10.2, 7],
        health: 1,
        maxHealth: 36,
        guaranteedLoot: true,
      },
    ],
    pendingAttacks: [
      {
        id: TEMPORAL_ENTITY_IDS.deathContact,
        ownerId: "player",
        kind: "primary",
        impactTick: 0,
        originTile: [9, 7],
        direction: [1024, 0],
        range: 1638,
        damage: 18,
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "temporal-friendly-projectile": {
    schemaVersion: 1,
    id: "temporal-friendly-projectile",
    seed: "quality-friendly-projectile-01",
    classId: "arcanist",
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    player: { tile: [9, 7], facing: [1024, 0] },
    monsters: [],
    projectiles: [
      {
        id: TEMPORAL_ENTITY_IDS.friendlyProjectile,
        owner: "player",
        hostile: false,
        tile: [5, 7],
        previousTile: [4.90625, 7],
        velocity: [96, 0],
        radius: 155,
        damage: 15,
        expiresAtTick: 120,
        color: ARCHETYPES.arcanist.accent,
        pierce: 2,
        spawnedAtTick: -1,
        hitTargets: [],
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "temporal-friendly-projectile-impact": {
    schemaVersion: 1,
    id: "temporal-friendly-projectile-impact",
    seed: "quality-friendly-projectile-impact-01",
    classId: "arcanist",
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    player: { tile: [8, 7], facing: [1024, 0] },
    monsters: [
      {
        id: TEMPORAL_ENTITY_IDS.friendlyImpactTarget,
        kind: "ashfang",
        tile: [10, 7],
        health: 60,
        maxHealth: 60,
        armor: 0,
        moveSpeed: 0,
        attackReadyTick: 10_000,
      },
    ],
    projectiles: [
      {
        id: TEMPORAL_ENTITY_IDS.friendlyImpactProjectile,
        owner: "player",
        hostile: false,
        tile: [6, 7],
        previousTile: [5.8125, 7],
        velocity: [192, 0],
        radius: 155,
        damage: 15,
        expiresAtTick: 60,
        color: ARCHETYPES.arcanist.accent,
        pierce: 0,
        spawnedAtTick: -1,
        hitTargets: [],
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: true },
  },
  "temporal-loot-bob": {
    schemaVersion: 1,
    id: "temporal-loot-bob",
    seed: "quality-loot-bob-01",
    classId: "ranger",
    map: { mode: "explicit", rows: arenaRows(30, 15) },
    player: { tile: [9, 7] },
    monsters: [],
    loot: [
      {
        id: TEMPORAL_ENTITY_IDS.goldLoot,
        kind: "gold",
        rarity: "common",
        tile: [7, 6],
        amount: 6,
        sourceId: "temporal-fixture",
        bobOffset: 0,
      },
      {
        id: TEMPORAL_ENTITY_IDS.tonicLoot,
        kind: "tonic",
        rarity: "tempered",
        tile: [8, 6],
        amount: 1,
        sourceId: "temporal-fixture",
        bobOffset: 8,
      },
      {
        id: TEMPORAL_ENTITY_IDS.weaponLoot,
        kind: "weapon",
        rarity: "relic",
        tile: [9, 6],
        amount: 6,
        sourceId: "temporal-fixture",
        bobOffset: 16,
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "temporal-camera-track": {
    schemaVersion: 1,
    id: "temporal-camera-track",
    seed: "quality-camera-track-01",
    classId: "arcanist",
    map: { mode: "explicit", rows: arenaRows(38, 12) },
    player: { tile: [26, 6] },
    monsters: [],
    camera: { mode: "smooth", centerTile: [4, 6] },
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "temporal-run-win": {
    schemaVersion: 1,
    id: "temporal-run-win",
    seed: "quality-run-win-01",
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows(22, 15) },
    player: { tile: [19, 2] },
    monsters: [],
    exitUnlocked: true,
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  "temporal-run-loss": {
    schemaVersion: 1,
    id: "temporal-run-loss",
    seed: "quality-run-loss-01",
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows(22, 15) },
    player: { tile: [9, 7], health: 1, maxHealth: 160, armor: 0 },
    monsters: [
      {
        id: TEMPORAL_ENTITY_IDS.lossAttacker,
        kind: "stonekin",
        tile: [9.8, 7],
        attackReadyTick: 10_000,
        animation: { clip: "attack", startedAtTick: 0, lockedUntilTick: 26 },
      },
    ],
    pendingAttacks: [
      {
        id: TEMPORAL_ENTITY_IDS.lossContact,
        ownerId: TEMPORAL_ENTITY_IDS.lossAttacker,
        kind: "primary",
        impactTick: 0,
        originTile: [9.8, 7],
        direction: [-1024, 0],
        range: 1050,
        damage: 10,
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: true },
  },
  "generated-run": {
    schemaVersion: 1,
    id: "generated-run",
    seed: "cinder-041",
    classId: "vanguard",
    map: { mode: "generated" },
  },
};

export function createRunScenario(
  seed: string,
  classId: CharacterClass,
): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: `run:${seed}`,
    seed,
    classId,
    map: { mode: "generated" },
  };
}
