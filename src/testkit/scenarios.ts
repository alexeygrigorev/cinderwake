import { ARCHETYPES, MONSTERS } from '../game/content';
import { explicitDungeon, generateDungeon, isFloor, tileCenter } from '../game/dungeon';
import { createRngStreams, randomInt } from '../game/rng';
import type {
  CharacterClass,
  GameState,
  LootKind,
  LootState,
  MonsterKind,
  MonsterState,
  Rarity,
  Vec2,
} from '../game/types';

export interface ScenarioMonsterV1 {
  id?: string;
  kind: MonsterKind;
  tile: [number, number];
  health?: number;
  elite?: boolean;
  guaranteedLoot?: boolean;
}

export interface ScenarioLootV1 {
  id?: string;
  kind: LootKind;
  rarity?: Rarity;
  tile: [number, number];
  amount?: number;
}

export interface ScenarioV1 {
  schemaVersion: 1;
  id: string;
  seed: string;
  classId: CharacterClass;
  map: { mode: 'generated'; width?: number; height?: number } | { mode: 'explicit'; rows: string[] };
  player?: { tile?: [number, number]; health?: number; facing?: [number, number]; power?: number };
  monsters?: ScenarioMonsterV1[];
  loot?: ScenarioLootV1[];
  settings?: { ai?: boolean; autoPickup?: boolean; cameraFollow?: boolean };
}

function positionFromTile(tile: [number, number]): Vec2 {
  return { x: Math.round((tile[0] + 0.5) * 1024), y: Math.round((tile[1] + 0.5) * 1024) };
}

function createMonster(spec: ScenarioMonsterV1, index: number): MonsterState {
  const definition = MONSTERS[spec.kind];
  const eliteMultiplier = spec.elite ? 2 : 1;
  const position = positionFromTile(spec.tile);
  const maxHealth = definition.health * eliteMultiplier;
  return {
    id: spec.id ?? `monster:${index.toString().padStart(2, '0')}`,
    kind: spec.kind,
    position,
    previousPosition: { ...position },
    velocity: { x: 0, y: 0 },
    facing: { x: -1024, y: 0 },
    radius: spec.kind === 'stonekin' ? 420 : 300,
    health: spec.health ?? maxHealth,
    maxHealth,
    armor: definition.armor,
    moveSpeed: definition.moveSpeed,
    attackDamage: spec.elite ? Math.floor(definition.attackDamage * 1.25) : definition.attackDamage,
    attackRange: definition.attackRange,
    attackReadyTick: 0,
    elite: spec.elite ?? false,
    guaranteedLoot: spec.guaranteedLoot ?? spec.elite ?? false,
    animation: { clip: 'idle', startedAtTick: 0, lockedUntilTick: 0 },
  };
}

function generatedMonsterSpecs(state: GameState): ScenarioMonsterV1[] {
  const candidates: Vec2[] = [];
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      const distance = Math.abs(x - state.map.spawn.x) + Math.abs(y - state.map.spawn.y);
      if (isFloor(state.map, x, y) && distance > 8 && (x + y) % 3 === 0) candidates.push({ x, y });
    }
  }
  const specs: ScenarioMonsterV1[] = [];
  const kinds: MonsterKind[] = ['ashfang', 'ashfang', 'hexer', 'stonekin'];
  while (candidates.length > 0 && specs.length < 14) {
    const selected = randomInt(state.rng.map, 0, candidates.length);
    const [tile] = candidates.splice(selected, 1);
    if (!tile) break;
    specs.push({
      id: `monster:${specs.length.toString().padStart(2, '0')}`,
      kind: kinds[specs.length % kinds.length]!,
      tile: [tile.x, tile.y],
      elite: specs.length === 11,
      guaranteedLoot: specs.length === 0 || specs.length === 11,
    });
  }
  return specs;
}

export function validateScenario(input: unknown): asserts input is ScenarioV1 {
  if (!input || typeof input !== 'object') throw new Error('Scenario must be an object');
  const scenario = input as Partial<ScenarioV1>;
  if (scenario.schemaVersion !== 1) throw new Error('Only ScenarioV1 is supported');
  if (!scenario.id || typeof scenario.id !== 'string') throw new Error('Scenario id is required');
  if (!scenario.seed || typeof scenario.seed !== 'string') throw new Error('Scenario seed is required');
  if (!scenario.classId || !(scenario.classId in ARCHETYPES)) throw new Error('Scenario classId is invalid');
  if (!scenario.map || !['generated', 'explicit'].includes(scenario.map.mode)) throw new Error('Scenario map mode is invalid');
  if (scenario.map.mode === 'explicit' && !Array.isArray(scenario.map.rows)) throw new Error('Explicit scenario rows are required');
  const ids = new Set<string>();
  for (const monster of scenario.monsters ?? []) {
    if (!(monster.kind in MONSTERS)) throw new Error(`Unknown monster kind: ${monster.kind}`);
    if (!Array.isArray(monster.tile) || monster.tile.length !== 2) throw new Error('Monster tile must be [x, y]');
    if (monster.id && ids.has(monster.id)) throw new Error(`Duplicate entity id: ${monster.id}`);
    if (monster.id) ids.add(monster.id);
  }
}

export function worldFromScenario(input: ScenarioV1): GameState {
  validateScenario(input);
  const map = input.map.mode === 'generated'
    ? generateDungeon(input.seed, input.map.width ?? 44, input.map.height ?? 32)
    : explicitDungeon(input.map.rows);
  const archetype = ARCHETYPES[input.classId];
  const position = input.player?.tile ? positionFromTile(input.player.tile) : tileCenter(map.spawn);
  const state: GameState = {
    schemaVersion: 1,
    scenarioId: input.id,
    seed: input.seed,
    tick: 0,
    tickRate: 60,
    phase: 'playing',
    nextEntityId: 1,
    rng: createRngStreams(input.seed),
    map,
    player: {
      id: 'player',
      classId: input.classId,
      position,
      previousPosition: { ...position },
      velocity: { x: 0, y: 0 },
      facing: input.player?.facing ? { x: input.player.facing[0], y: input.player.facing[1] } : { x: 1024, y: 0 },
      radius: 320,
      health: input.player?.health ?? archetype.health,
      maxHealth: archetype.health,
      armor: archetype.armor,
      moveSpeed: archetype.moveSpeed,
      attackDamage: archetype.attackDamage,
      abilityDamage: archetype.abilityDamage,
      attackReadyTick: 0,
      abilityReadyTick: 0,
      invulnerableUntilTick: 0,
      level: 1,
      xp: 0,
      gold: 0,
      tonics: 2,
      power: input.player?.power ?? 0,
      animation: { clip: 'idle', startedAtTick: 0, lockedUntilTick: 0 },
    },
    monsters: [],
    pendingAttacks: [],
    projectiles: [],
    loot: [],
    effects: [],
    exitUnlocked: false,
    events: [],
    eventLog: [],
    metrics: { kills: 0, damageDealt: 0, damageTaken: 0, lootCollected: 0, distanceUnits: 0 },
    settings: {
      ai: input.settings?.ai ?? true,
      autoPickup: input.settings?.autoPickup ?? true,
      cameraFollow: input.settings?.cameraFollow ?? true,
    },
  };
  const monsterSpecs = input.monsters ?? (input.map.mode === 'generated' ? generatedMonsterSpecs(state) : []);
  state.monsters = monsterSpecs.map(createMonster).sort((a, b) => a.id.localeCompare(b.id));
  state.loot = (input.loot ?? []).map((loot, index): LootState => ({
    id: loot.id ?? `loot:fixture:${index}`,
    kind: loot.kind,
    rarity: loot.rarity ?? 'common',
    position: positionFromTile(loot.tile),
    amount: loot.amount ?? 1,
    sourceId: 'fixture',
    bobOffset: index * 9,
  }));
  state.exitUnlocked = state.monsters.length === 0;
  return state;
}

function arenaRows(width = 22, height = 15): string[] {
  return Array.from({ length: height }, (_, y) => {
    if (y === 0 || y === height - 1) return '#'.repeat(width);
    const cells: string[] = Array.from({ length: width }, (_, x) => (x === 0 || x === width - 1 ? '#' : '.'));
    if (y === Math.floor(height / 2)) cells[Math.floor(width / 2)] = 'P';
    if (y === 2) cells[width - 3] = 'E';
    return cells.join('');
  });
}

export const BUILTIN_SCENARIOS: Record<string, ScenarioV1> = {
  'animation-idle': {
    schemaVersion: 1,
    id: 'animation-idle',
    seed: 'vis-idle-01',
    classId: 'vanguard',
    map: { mode: 'explicit', rows: arenaRows() },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  'animation-walk': {
    schemaVersion: 1,
    id: 'animation-walk',
    seed: 'vis-run-02',
    classId: 'ranger',
    map: { mode: 'explicit', rows: arenaRows(30, 15) },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  'combat-loot': {
    schemaVersion: 1,
    id: 'combat-loot',
    seed: 'scn-loot-0301',
    classId: 'vanguard',
    map: { mode: 'explicit', rows: arenaRows() },
    player: { tile: [9, 7], facing: [1024, 0], power: 8 },
    monsters: [{ id: 'monster:target', kind: 'ashfang', tile: [10.2, 7], health: 20, elite: true, guaranteedLoot: true }],
    settings: { ai: false, autoPickup: true, cameraFollow: true },
  },
  'camera-track': {
    schemaVersion: 1,
    id: 'camera-track',
    seed: 'vis-camera-01',
    classId: 'arcanist',
    map: { mode: 'explicit', rows: arenaRows(38, 12) },
    player: { tile: [7, 6] },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
  },
  'generated-run': {
    schemaVersion: 1,
    id: 'generated-run',
    seed: 'cinder-041',
    classId: 'vanguard',
    map: { mode: 'generated' },
  },
};

export function createRunScenario(seed: string, classId: CharacterClass): ScenarioV1 {
  return { schemaVersion: 1, id: `run:${seed}`, seed, classId, map: { mode: 'generated' } };
}
