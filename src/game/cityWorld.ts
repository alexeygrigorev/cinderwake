import {
  CITY_DISCOVERY_LANDMARK_ID,
  CITY_GATE_ID,
  EMBERCROSS_CITY,
  type CityNpcId,
} from "./city";
import { UNITS_PER_TILE } from "./constants";
import { explicitDungeon, tileCenter } from "./dungeon";
import type { DungeonMap, Vec2 } from "./types";

export const EMBERCROSS_MAP_WIDTH = 32;
export const EMBERCROSS_MAP_HEIGHT = 30;

function embercrossRows(): string[] {
  return Array.from({ length: EMBERCROSS_MAP_HEIGHT }, (_, y) => {
    const cells: string[] = Array.from(
      { length: EMBERCROSS_MAP_WIDTH },
      (_, x) =>
        x === 0 ||
        y === 0 ||
        x === EMBERCROSS_MAP_WIDTH - 1 ||
        y === EMBERCROSS_MAP_HEIGHT - 1
          ? "#"
          : ".",
    );
    // The authored city opens through a three-tile south gate. P is the safe
    // interior arrival and E is the visible return-gate anchor.
    if (y === EMBERCROSS_MAP_HEIGHT - 1)
      for (let x = 14; x <= 16; x += 1) cells[x] = ".";
    if (y === 26) cells[15] = "P";
    if (y === 28) cells[15] = "E";
    return cells.join("");
  });
}

const EMBERCROSS_MAP_TEMPLATE = explicitDungeon(embercrossRows());
export const EMBERCROSS_MAP_DIGEST = EMBERCROSS_MAP_TEMPLATE.digest;

export function createEmbercrossMap(): DungeonMap {
  return structuredClone(EMBERCROSS_MAP_TEMPLATE);
}

export function isEmbercrossMap(map: DungeonMap): boolean {
  return (
    map.digest === EMBERCROSS_MAP_DIGEST &&
    map.width === EMBERCROSS_MAP_WIDTH &&
    map.height === EMBERCROSS_MAP_HEIGHT
  );
}

function shortestFloorRoute(map: DungeonMap): Vec2[] {
  const start = map.spawn;
  const goal = map.exit;
  const key = (point: Vec2) => `${point.x},${point.y}`;
  const queue: Vec2[] = [{ ...start }];
  const previous = new Map<string, string | null>([[key(start), null]]);
  let cursor = 0;
  while (cursor < queue.length && !previous.has(key(goal))) {
    const current = queue[cursor++]!;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= map.width ||
        next.y >= map.height ||
        map.tiles[next.y * map.width + next.x] !== 0 ||
        previous.has(key(next))
      )
        continue;
      previous.set(key(next), key(current));
      queue.push(next);
    }
  }
  if (!previous.has(key(goal))) return [{ ...goal }];
  const route: Vec2[] = [];
  let active: string | null = key(goal);
  while (active) {
    const [x, y] = active.split(",").map(Number);
    route.push({ x: x!, y: y! });
    active = previous.get(active) ?? null;
  }
  return route.reverse();
}

/** A guaranteed floor cell two route steps before the generated exit. */
export function wildernessCityLandmarkTile(map: DungeonMap): Vec2 {
  const route = shortestFloorRoute(map);
  return { ...route[Math.max(0, route.length - 3)]! };
}

export function wildernessCityLandmarkAnchor(map: DungeonMap): Vec2 {
  return tileCenter(wildernessCityLandmarkTile(map));
}

export interface CityWorldPlacement {
  id: string;
  kind: "structure" | "prop" | "decal";
  name: string;
  collisionMode: "solid" | "passable";
  tile: Vec2;
  worldAnchor: Vec2;
  collision: {
    shape: "ellipse";
    center: Vec2;
    halfWidth: number;
    halfHeight: number;
  } | null;
}

function solidPlacement(
  id: string,
  kind: "structure" | "prop",
  name: string,
  tile: Vec2,
  halfWidth: number,
  halfHeight: number,
  offsetY: number,
): CityWorldPlacement {
  const worldAnchor = tileCenter(tile);
  return {
    id,
    kind,
    name,
    collisionMode: "solid",
    tile: { ...tile },
    worldAnchor,
    collision: {
      shape: "ellipse",
      center: { x: worldAnchor.x, y: worldAnchor.y + offsetY },
      halfWidth,
      halfHeight,
    },
  };
}

/**
 * Stable semantic city composition. Existing same-style sprites are temporary
 * role mappings; object IDs and ground-contact geometry survive art swaps.
 */
export function buildEmbercrossScenery(): CityWorldPlacement[] {
  const [market, tavern, infirmary] = EMBERCROSS_CITY.buildings;
  return [
    solidPlacement(
      market.id,
      "structure",
      "forge-workshop",
      { x: market.entranceTile[0], y: market.entranceTile[1] - 2 },
      856,
      320,
      -200,
    ),
    solidPlacement(
      tavern.id,
      "structure",
      "ruined-house",
      { x: tavern.entranceTile[0], y: tavern.entranceTile[1] - 2 },
      1_300,
      520,
      -100,
    ),
    solidPlacement(
      infirmary.id,
      "structure",
      "mausoleum",
      { x: infirmary.entranceTile[0], y: infirmary.entranceTile[1] - 2 },
      1_180,
      500,
      -100,
    ),
    solidPlacement(
      "prop:embercross:market-crates",
      "prop",
      "merchant-crates",
      { x: 8, y: 16 },
      560,
      300,
      -40,
    ),
    solidPlacement(
      "prop:embercross:tavern-table",
      "prop",
      "barrels",
      { x: 18, y: 15 },
      500,
      300,
      -40,
    ),
    solidPlacement(
      "prop:embercross:inn-bed",
      "prop",
      "sarcophagus",
      { x: 23, y: 15 },
      620,
      330,
      -40,
    ),
    solidPlacement(
      "prop:embercross:healer-shrine",
      "prop",
      "saint-statue",
      { x: 27, y: 20 },
      420,
      300,
      -40,
    ),
  ];
}

export const CITY_NPC_ACTOR_GEOMETRY: Record<CityNpcId, string> = {
  "npc:embercross:mara": "hero:ranger",
  "npc:embercross:oren": "hero:vanguard",
  "npc:embercross:tess": "hero:ranger",
  "npc:embercross:ileya": "hero:arcanist",
};

export function cityNpcWorldAnchor(npcId: CityNpcId): Vec2 {
  const npc = EMBERCROSS_CITY.npcs.find(({ id }) => id === npcId)!;
  return {
    x: npc.anchorTile[0] * UNITS_PER_TILE + UNITS_PER_TILE / 2,
    y: npc.anchorTile[1] * UNITS_PER_TILE + UNITS_PER_TILE / 2,
  };
}

/**
 * Finds the one service resident the player can address from a world position.
 * Distance and ID tie-breaking make the context stable for replays and saves.
 */
export function nearbyEmbercrossNpcId(position: Vec2): CityNpcId | null {
  const nearby = EMBERCROSS_CITY.npcs
    .map((npc) => {
      const anchor = cityNpcWorldAnchor(npc.id);
      const dx = position.x - anchor.x;
      const dy = position.y - anchor.y;
      return { npc, distanceSquared: dx * dx + dy * dy };
    })
    .filter(
      ({ npc, distanceSquared }) =>
        distanceSquared <= npc.affordance.interactionRadiusUnits ** 2,
    )
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.npc.id.localeCompare(right.npc.id),
    );
  return nearby[0]?.npc.id ?? null;
}

export { CITY_DISCOVERY_LANDMARK_ID, CITY_GATE_ID };
