export type CharacterClass = 'vanguard' | 'ranger' | 'arcanist';
export type MonsterKind = 'ashfang' | 'hexer' | 'stonekin';
export type LootKind = 'gold' | 'tonic' | 'weapon';
export type Rarity = 'common' | 'tempered' | 'relic';
export type GamePhase = 'playing' | 'won' | 'lost';
export type AnimationClip = 'idle' | 'walk' | 'attack' | 'ability' | 'hurt' | 'death';

export interface Vec2 {
  x: number;
  y: number;
}

export interface RngStream {
  state: number;
  draws: number;
}

export interface RngStreams {
  map: RngStream;
  combat: RngStream;
  loot: RngStream;
  ai: RngStream;
  cosmetic: RngStream;
}

export interface AnimationState {
  clip: AnimationClip;
  startedAtTick: number;
  lockedUntilTick: number;
}

export interface DungeonMap {
  width: number;
  height: number;
  tiles: number[];
  spawn: Vec2;
  exit: Vec2;
  rooms: Array<{ x: number; y: number; width: number; height: number }>;
  digest: string;
}

export interface PlayerState {
  id: 'player';
  classId: CharacterClass;
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  facing: Vec2;
  radius: number;
  health: number;
  maxHealth: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  abilityDamage: number;
  attackReadyTick: number;
  abilityReadyTick: number;
  invulnerableUntilTick: number;
  level: number;
  xp: number;
  gold: number;
  tonics: number;
  power: number;
  animation: AnimationState;
}

export interface MonsterState {
  id: string;
  kind: MonsterKind;
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  facing: Vec2;
  radius: number;
  health: number;
  maxHealth: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  attackRange: number;
  attackReadyTick: number;
  elite: boolean;
  guaranteedLoot: boolean;
  animation: AnimationState;
}

export interface PendingAttack {
  id: string;
  ownerId: string;
  kind: 'primary' | 'ability';
  impactTick: number;
  origin: Vec2;
  direction: Vec2;
  range: number;
  damage: number;
}

export interface ProjectileState {
  id: string;
  owner: 'player' | string;
  hostile: boolean;
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  radius: number;
  damage: number;
  expiresAtTick: number;
  color: string;
  pierce: number;
}

export interface LootState {
  id: string;
  kind: LootKind;
  rarity: Rarity;
  position: Vec2;
  amount: number;
  sourceId: string;
  bobOffset: number;
}

export interface EffectState {
  id: string;
  kind: 'slash' | 'nova' | 'impact';
  position: Vec2;
  color: string;
  startedAtTick: number;
  expiresAtTick: number;
  radius: number;
}

export type GameEventType =
  | 'attack_started'
  | 'ability_started'
  | 'damage'
  | 'monster_died'
  | 'loot_dropped'
  | 'loot_picked'
  | 'player_damaged'
  | 'player_died'
  | 'exit_unlocked'
  | 'run_won';

export interface GameEvent {
  tick: number;
  type: GameEventType;
  sourceId?: string;
  targetId?: string;
  amount?: number;
  detail?: string;
}

export interface GameMetrics {
  kills: number;
  damageDealt: number;
  damageTaken: number;
  lootCollected: number;
  distanceUnits: number;
}

export interface WorldSettings {
  ai: boolean;
  autoPickup: boolean;
  cameraFollow: boolean;
}

export interface GameState {
  schemaVersion: 1;
  scenarioId: string;
  seed: string;
  tick: number;
  tickRate: 60;
  phase: GamePhase;
  nextEntityId: number;
  rng: RngStreams;
  map: DungeonMap;
  player: PlayerState;
  monsters: MonsterState[];
  pendingAttacks: PendingAttack[];
  projectiles: ProjectileState[];
  loot: LootState[];
  effects: EffectState[];
  exitUnlocked: boolean;
  events: GameEvent[];
  eventLog: GameEvent[];
  metrics: GameMetrics;
  settings: WorldSettings;
}

export interface InputState {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aim: Vec2 | null;
  attack: boolean;
  ability: boolean;
  useTonic: boolean;
}

export interface ArchetypeDefinition {
  id: CharacterClass;
  name: string;
  role: string;
  description: string;
  health: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  abilityDamage: number;
  attackCooldown: number;
  abilityCooldown: number;
  attackRange: number;
  accent: string;
  dark: string;
}

export interface MonsterDefinition {
  id: MonsterKind;
  name: string;
  health: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  xp: number;
  color: string;
}

export const EMPTY_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aim: null,
  attack: false,
  ability: false,
  useTonic: false,
};
