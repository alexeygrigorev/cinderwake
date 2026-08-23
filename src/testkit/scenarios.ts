import { ARCHETYPES, MONSTERS } from "../game/content";
import {
  explicitDungeon,
  generateDungeon,
  isFloor,
  tileCenter,
} from "../game/dungeon";
import { createRngStreams, randomInt } from "../game/rng";
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
    animation: animationFromSpec(spec.animation, tick),
  };
}

function generatedMonsterSpecs(state: GameState): ScenarioMonsterV1[] {
  const candidates: Vec2[] = [];
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      const distance =
        Math.abs(x - state.map.spawn.x) + Math.abs(y - state.map.spawn.y);
      if (isFloor(state.map, x, y) && distance > 8 && (x + y) % 3 === 0)
        candidates.push({ x, y });
    }
  }
  const specs: ScenarioMonsterV1[] = [];
  const kinds: MonsterKind[] = ["ashfang", "ashfang", "hexer", "stonekin"];
  while (candidates.length > 0 && specs.length < 14) {
    const selected = randomInt(state.rng.map, 0, candidates.length);
    const [tile] = candidates.splice(selected, 1);
    if (!tile) break;
    specs.push({
      id: `monster:${specs.length.toString().padStart(2, "0")}`,
      kind: kinds[specs.length % kinds.length]!,
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

export function validateScenario(input: unknown): asserts input is ScenarioV1 {
  if (!input || typeof input !== "object")
    throw new Error("Scenario must be an object");
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
  if (scenario.map.mode === "explicit" && !Array.isArray(scenario.map.rows))
    throw new Error("Explicit scenario rows are required");
  if (
    scenario.tick !== undefined &&
    (!Number.isInteger(scenario.tick) || scenario.tick < 0)
  )
    throw new Error("Scenario tick must be a non-negative integer");
  if (scenario.phase && !["playing", "won", "lost"].includes(scenario.phase))
    throw new Error("Scenario phase is invalid");
  assertSafeNumbers(scenario);

  const ids = new Set<string>();
  const registerId = (id: string | undefined): void => {
    if (!id) return;
    if (ids.has(id)) throw new Error(`Duplicate entity id: ${id}`);
    ids.add(id);
  };
  if (scenario.player?.tile) assertTuple(scenario.player.tile, "Player tile");
  if (
    scenario.player?.animation &&
    !["idle", "walk", "attack", "ability", "hurt", "death"].includes(
      scenario.player.animation.clip,
    )
  ) {
    throw new Error("Player animation clip is invalid");
  }
  for (const monster of scenario.monsters ?? []) {
    if (!(monster.kind in MONSTERS))
      throw new Error(`Unknown monster kind: ${monster.kind}`);
    assertTuple(monster.tile, "Monster tile");
    registerId(monster.id);
  }
  for (const loot of scenario.loot ?? []) {
    assertTuple(loot.tile, "Loot tile");
    registerId(loot.id);
  }
  for (const projectile of scenario.projectiles ?? []) {
    assertTuple(projectile.tile, "Projectile tile");
    assertTuple(projectile.velocity, "Projectile velocity");
    registerId(projectile.id);
  }
  for (const attack of scenario.pendingAttacks ?? []) {
    assertTuple(attack.originTile, "Pending attack origin");
    assertTuple(attack.direction, "Pending attack direction");
    registerId(attack.id);
  }
  for (const effect of scenario.effects ?? []) {
    assertTuple(effect.tile, "Effect tile");
    registerId(effect.id);
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
        tile: [10.2, 7],
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
    player: { tile: [7, 6] },
    monsters: [],
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
