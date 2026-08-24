import { UNITS_PER_TILE } from "./constants";
import { createRng, hashString, randomInt } from "./rng";
import type { DungeonMap, Vec2 } from "./types";

interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

function carveRoom(tiles: number[], mapWidth: number, room: Room): void {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1)
      tiles[y * mapWidth + x] = 0;
  }
}

function carveCorridor(
  tiles: number[],
  mapWidth: number,
  from: Vec2,
  to: Vec2,
  horizontalFirst: boolean,
): void {
  const carveHorizontal = (startX: number, endX: number, y: number): void => {
    for (let x = Math.min(startX, endX); x <= Math.max(startX, endX); x += 1) {
      tiles[y * mapWidth + x] = 0;
      tiles[(y + 1) * mapWidth + x] = 0;
    }
  };
  const carveVertical = (x: number, startY: number, endY: number): void => {
    for (let y = Math.min(startY, endY); y <= Math.max(startY, endY); y += 1) {
      tiles[y * mapWidth + x] = 0;
      tiles[y * mapWidth + x + 1] = 0;
    }
  };

  if (horizontalFirst) {
    carveHorizontal(from.x, to.x, from.y);
    carveVertical(to.x, from.y, to.y);
  } else {
    carveVertical(from.x, from.y, to.y);
    carveHorizontal(from.x, to.x, to.y);
  }
}

function carveCorridorOutsideOpening(
  tiles: number[],
  mapWidth: number,
  mapHeight: number,
  from: Vec2,
  to: Vec2,
  openingRoom: Room,
): void {
  const exclusion = {
    left: openingRoom.x - 1,
    right: openingRoom.x + openingRoom.width,
    top: openingRoom.y - 1,
    bottom: openingRoom.y + openingRoom.height,
  };
  const key = ({ x, y }: Vec2) => `${x},${y}`;
  const pointFor = (value: string): Vec2 => {
    const [x, y] = value.split(",").map(Number);
    return { x: x!, y: y! };
  };
  const valid = ({ x, y }: Vec2): boolean => {
    if (x < 1 || y < 1 || x + 1 >= mapWidth - 1 || y + 1 >= mapHeight - 1)
      return false;
    return (
      x + 1 < exclusion.left ||
      x > exclusion.right ||
      y + 1 < exclusion.top ||
      y > exclusion.bottom
    );
  };
  const queue: Vec2[] = [from];
  const previous = new Map<string, string | null>([[key(from), null]]);
  let cursor = 0;
  while (cursor < queue.length && !previous.has(key(to))) {
    const current = queue[cursor++]!;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = key(next);
      if (!valid(next) || previous.has(nextKey)) continue;
      previous.set(nextKey, key(current));
      queue.push(next);
    }
  }
  if (!previous.has(key(to)))
    throw new Error("Unable to route a corridor around the opening room");

  let currentKey: string | null = key(to);
  while (currentKey) {
    const point = pointFor(currentKey);
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1)
        tiles[(point.y + dy) * mapWidth + point.x + dx] = 0;
    }
    currentKey = previous.get(currentKey) ?? null;
  }
}

/**
 * Later room-to-room corridors are allowed to cross previously carved space,
 * which can otherwise erase most of the opening room perimeter. Rebuilding a
 * one-tile shell and then carving one deliberate two-tile route keeps the
 * first encounter legible without inventing render-only walls: the visible
 * boundary and collision map continue to describe the same topology.
 */
function frameOpeningRoom(
  tiles: number[],
  mapWidth: number,
  room: Room,
  nextRoom: Room | undefined,
): void {
  if (!nextRoom) return;
  for (let x = room.x - 1; x <= room.x + room.width; x += 1) {
    tiles[(room.y - 1) * mapWidth + x] = 1;
    tiles[(room.y + room.height) * mapWidth + x] = 1;
  }
  for (let y = room.y - 1; y <= room.y + room.height; y += 1) {
    tiles[y * mapWidth + room.x - 1] = 1;
    tiles[y * mapWidth + room.x + room.width] = 1;
  }

  const from = center(room);
  const to = center(nextRoom);
  carveCorridor(
    tiles,
    mapWidth,
    from,
    to,
    Math.abs(to.x - from.x) >= Math.abs(to.y - from.y),
  );
}

function center(room: Room): Vec2 {
  return {
    x: Math.floor(room.x + room.width / 2),
    y: Math.floor(room.y + room.height / 2),
  };
}

function overlaps(a: Room, b: Room): boolean {
  return !(
    a.x + a.width + 1 < b.x ||
    b.x + b.width + 1 < a.x ||
    a.y + a.height + 1 < b.y ||
    b.y + b.height + 1 < a.y
  );
}

export function mapDigest(
  map: Pick<DungeonMap, "width" | "height" | "tiles" | "spawn" | "exit">,
): string {
  const raw = `${map.width}x${map.height}|${map.tiles.join("")}|${map.spawn.x},${map.spawn.y}|${map.exit.x},${map.exit.y}`;
  return hashString(raw).toString(16).padStart(8, "0");
}

export function generateDungeon(
  seed: string,
  width = 44,
  height = 32,
): DungeonMap {
  const rng = createRng(`${seed}:dungeon-v1`);
  const tiles = new Array<number>(width * height).fill(1);
  const rooms: Room[] = [];
  const first: Room = {
    x: Math.floor(width / 2) - 4,
    y: Math.floor(height / 2) - 3,
    width: 9,
    height: 7,
  };
  rooms.push(first);

  for (let attempt = 0; attempt < 320 && rooms.length < 11; attempt += 1) {
    const roomWidth = randomInt(rng, 6, 11);
    const roomHeight = randomInt(rng, 5, 9);
    const candidate: Room = {
      x: randomInt(rng, 2, width - roomWidth - 2),
      y: randomInt(rng, 2, height - roomHeight - 2),
      width: roomWidth,
      height: roomHeight,
    };
    if (!rooms.some((room) => overlaps(room, candidate))) rooms.push(candidate);
  }

  for (const room of rooms) carveRoom(tiles, width, room);
  for (let index = 1; index < rooms.length; index += 1) {
    const horizontalFirst = randomInt(rng, 0, 2) === 0;
    if (index === 1)
      carveCorridor(
        tiles,
        width,
        center(rooms[index - 1]!),
        center(rooms[index]!),
        horizontalFirst,
      );
    else
      carveCorridorOutsideOpening(
        tiles,
        width,
        height,
        center(rooms[index - 1]!),
        center(rooms[index]!),
        first,
      );
  }
  frameOpeningRoom(tiles, width, first, rooms[1]);

  const spawn = center(first);
  const exit =
    rooms
      .map(center)
      .sort(
        (a, b) =>
          Math.abs(b.x - spawn.x) +
          Math.abs(b.y - spawn.y) -
          (Math.abs(a.x - spawn.x) + Math.abs(a.y - spawn.y)),
      )[0] ?? spawn;
  const map: DungeonMap = {
    width,
    height,
    tiles,
    spawn,
    exit,
    rooms,
    digest: "",
  };
  map.digest = mapDigest(map);
  return map;
}

export function explicitDungeon(rows: string[]): DungeonMap {
  if (rows.length < 3 || !rows[0])
    throw new Error("Explicit maps need at least three non-empty rows");
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width))
    throw new Error("Every explicit map row must have equal width");
  let spawn: Vec2 | undefined;
  let exit: Vec2 | undefined;
  let spawnCount = 0;
  let exitCount = 0;
  const tiles: number[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((value, x) => {
      if (!["#", ".", "P", "E"].includes(value))
        throw new Error(`Unknown explicit map tile ${JSON.stringify(value)}`);
      tiles.push(value === "#" ? 1 : 0);
      if (value === "P") {
        spawn = { x, y };
        spawnCount += 1;
      }
      if (value === "E") {
        exit = { x, y };
        exitCount += 1;
      }
    });
  });
  if (!spawn || !exit || spawnCount !== 1 || exitCount !== 1)
    throw new Error("Explicit maps require exactly one P spawn and one E exit");
  const map: DungeonMap = {
    width,
    height: rows.length,
    tiles,
    spawn,
    exit,
    rooms: [],
    digest: "",
  };
  map.digest = mapDigest(map);
  return map;
}

export function tileCenter(tile: Vec2): Vec2 {
  return {
    x: tile.x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
    y: tile.y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
  };
}

export function isFloor(
  map: DungeonMap,
  tileX: number,
  tileY: number,
): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height)
    return false;
  return map.tiles[tileY * map.width + tileX] === 0;
}

export function reachableFloorCount(map: DungeonMap): number {
  const queue: Vec2[] = [map.spawn];
  const seen = new Set([`${map.spawn.x},${map.spawn.y}`]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (isFloor(map, next.x, next.y) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

export function totalFloorCount(map: DungeonMap): number {
  return map.tiles.filter((tile) => tile === 0).length;
}
