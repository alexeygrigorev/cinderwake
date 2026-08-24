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
  collisionParts?: Array<{
    shape: "ellipse";
    center: Vec2;
    halfWidth: number;
    halfHeight: number;
  }>;
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

function passablePlacement(
  id: string,
  name: string,
  tile: Vec2,
): CityWorldPlacement {
  return {
    id,
    kind: "decal",
    name,
    collisionMode: "passable",
    tile: { ...tile },
    worldAnchor: tileCenter(tile),
    collision: null,
  };
}

/**
 * Stable semantic city composition using the reviewed Embercross atlas for
 * landmarks and service buildings plus compatible existing environment props.
 */
export function buildEmbercrossScenery(): CityWorldPlacement[] {
  const [market, tavern, infirmary] = EMBERCROSS_CITY.buildings;
  const gateTile = { x: EMBERCROSS_CITY.gateTile[0], y: 29 };
  const gateAnchor = tileCenter(gateTile);
  return [
    solidPlacement(
      market.id,
      "structure",
      "embercross-market",
      { x: market.entranceTile[0], y: market.entranceTile[1] - 2 },
      1_200,
      460,
      -460,
    ),
    solidPlacement(
      tavern.id,
      "structure",
      "embercross-tavern",
      { x: tavern.entranceTile[0], y: tavern.entranceTile[1] - 2 },
      1_920,
      650,
      -650,
    ),
    solidPlacement(
      infirmary.id,
      "structure",
      "embercross-infirmary",
      { x: infirmary.entranceTile[0], y: infirmary.entranceTile[1] - 2 },
      1_380,
      590,
      -590,
    ),
    {
      id: CITY_GATE_ID,
      kind: "structure",
      name: "embercross-city-gate",
      collisionMode: "solid",
      tile: gateTile,
      worldAnchor: gateAnchor,
      collision: {
        shape: "ellipse",
        center: { x: gateAnchor.x - 1_750, y: gateAnchor.y - 650 },
        halfWidth: 700,
        halfHeight: 650,
      },
      collisionParts: [
        {
          shape: "ellipse",
          center: { x: gateAnchor.x + 1_750, y: gateAnchor.y - 650 },
          halfWidth: 700,
          halfHeight: 650,
        },
      ],
    },
    solidPlacement(
      "prop:embercross:gate-lantern-west",
      "prop",
      "lantern-a",
      { x: 13, y: 27 },
      180,
      500,
      -500,
    ),
    solidPlacement(
      "prop:embercross:gate-lantern-east",
      "prop",
      "lantern-b",
      { x: 17, y: 27 },
      180,
      500,
      -500,
    ),
    solidPlacement(
      "prop:embercross:market-lantern-west",
      "prop",
      "lantern-a",
      { x: 9, y: 15 },
      180,
      500,
      -500,
    ),
    solidPlacement(
      "prop:embercross:market-lantern-east",
      "prop",
      "lantern-b",
      { x: 13, y: 15 },
      180,
      500,
      -500,
    ),
    solidPlacement(
      "prop:embercross:market-crates",
      "prop",
      "merchant-crates",
      { x: 8, y: 16 },
      560,
      300,
      -300,
    ),
    solidPlacement(
      "structure:embercross:market-wagon",
      "structure",
      "wagon",
      { x: 7, y: 19 },
      1_100,
      440,
      -440,
    ),
    solidPlacement(
      "structure:embercross:square-well",
      "structure",
      "well",
      { x: 15, y: 20 },
      1_000,
      420,
      -420,
    ),
    solidPlacement(
      "prop:embercross:square-bench",
      "prop",
      "raised-clutter-bench",
      { x: 15, y: 23 },
      700,
      300,
      -300,
    ),
    solidPlacement(
      "prop:embercross:tavern-table",
      "prop",
      "barrels",
      { x: 18, y: 15 },
      500,
      300,
      -300,
    ),
    solidPlacement(
      "prop:embercross:tavern-lantern",
      "prop",
      "lantern-b",
      { x: 18, y: 14 },
      180,
      500,
      -500,
    ),
    solidPlacement(
      "prop:embercross:inn-bed",
      "prop",
      "embercross-bed-service",
      { x: 23, y: 15 },
      1_080,
      390,
      -390,
    ),
    solidPlacement(
      "prop:embercross:healer-shrine",
      "prop",
      "saint-statue",
      { x: 27, y: 20 },
      420,
      300,
      -300,
    ),
    solidPlacement(
      "prop:embercross:infirmary-lantern",
      "prop",
      "lantern-a",
      { x: 23, y: 19 },
      180,
      500,
      -500,
    ),
    solidPlacement(
      "prop:embercross:east-barricade",
      "prop",
      "barricade-v2",
      { x: 28, y: 24 },
      600,
      300,
      -300,
    ),
    passablePlacement("decal:embercross:market-banner", "banner-scrap", {
      x: 11,
      y: 17,
    }),
    passablePlacement("decal:embercross:west-tracks", "claw-tracks", {
      x: 8,
      y: 22,
    }),
    passablePlacement("decal:embercross:square-scorch", "scorch-ring", {
      x: 17,
      y: 20,
    }),
    passablePlacement("decal:embercross:tavern-boards", "banner-scrap", {
      x: 20,
      y: 16,
    }),
    passablePlacement("decal:embercross:infirmary-flowers", "blood-smear", {
      x: 25,
      y: 21,
    }),
    passablePlacement("decal:embercross:south-tracks", "claw-tracks", {
      x: 15,
      y: 25,
    }),
    passablePlacement("decal:embercross:east-banner", "banner-scrap", {
      x: 27,
      y: 23,
    }),
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
