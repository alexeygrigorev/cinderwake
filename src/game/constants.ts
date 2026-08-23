export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const UNITS_PER_TILE = 1024;
export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 540;
export const TILE_PIXELS = 48;
export const DIAGONAL_SCALE = 724;
export const DIRECTION_SCALE = 1024;

export const PLAYER_RADIUS = 320;
export const MONSTER_RADIUS = 300;

export const CLIP_DURATIONS = {
  idle: 60,
  walk: 40,
  attack: 26,
  ability: 36,
  hurt: 12,
  death: 48,
} as const;

export const CLIP_FRAMES = {
  idle: 6,
  walk: 8,
  attack: 6,
  ability: 8,
  hurt: 4,
  death: 8,
} as const;
