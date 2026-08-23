import { UNITS_PER_TILE } from "./constants";
import { isFloor, tileCenter } from "./dungeon";
import {
  overlapsScenery,
  sceneryCollisions,
  type SceneryCollisionFootprint,
} from "./sceneryLayout";
import type { DungeonMap, GameState, Vec2 } from "./types";

const CARDINAL_DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const;
const SEGMENT_SAMPLE_UNITS = 128;

interface SearchCell {
  x: number;
  y: number;
  steps: number;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function squaredDistance(first: Vec2, second: Vec2): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

export function navigationPointWalkable(
  map: DungeonMap,
  scenery: readonly SceneryCollisionFootprint[],
  point: Vec2,
  radius: number,
): boolean {
  const corners = [
    [-radius, -radius],
    [radius, -radius],
    [-radius, radius],
    [radius, radius],
  ] as const;
  return (
    corners.every(([dx, dy]) =>
      isFloor(
        map,
        Math.floor((point.x + dx) / UNITS_PER_TILE),
        Math.floor((point.y + dy) / UNITS_PER_TILE),
      ),
    ) &&
    scenery.every((collision) => !overlapsScenery(point, radius, collision))
  );
}

function segmentWalkable(
  map: DungeonMap,
  scenery: readonly SceneryCollisionFootprint[],
  from: Vec2,
  to: Vec2,
  radius: number,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(length / SEGMENT_SAMPLE_UNITS));
  for (let index = 1; index <= samples; index += 1) {
    const progress = index / samples;
    if (
      !navigationPointWalkable(
        map,
        scenery,
        {
          x: Math.round(from.x + (to.x - from.x) * progress),
          y: Math.round(from.y + (to.y - from.y) * progress),
        },
        radius,
      )
    )
      return false;
  }
  return true;
}

function reconstructRoute(
  chosen: SearchCell,
  parents: ReadonlyMap<string, string | null>,
): Vec2[] {
  const reversed: Vec2[] = [];
  let key: string | null = cellKey(chosen.x, chosen.y);
  while (key) {
    const [x, y] = key.split(",").map(Number);
    reversed.push(tileCenter({ x: x!, y: y! }));
    key = parents.get(key) ?? null;
  }
  reversed.reverse();
  // The first cell contains the actor already. The first meaningful waypoint
  // is the next safely connected cell center.
  return reversed.slice(1);
}

/**
 * Finds a stable cardinal route over authoritative floor and scenery data.
 * When the requested point is blocked or disconnected, the result ends at the
 * reachable cell center nearest to it. An empty result means the actor is
 * already at the best reachable point and input should deterministically stop.
 */
export function findNavigationRoute(
  map: DungeonMap,
  scenery: readonly SceneryCollisionFootprint[],
  from: Vec2,
  requestedTarget: Vec2,
  radius: number,
): Vec2[] {
  const start = {
    x: Math.floor(from.x / UNITS_PER_TILE),
    y: Math.floor(from.y / UNITS_PER_TILE),
  };
  if (!isFloor(map, start.x, start.y)) return [];
  const requestedCell = {
    x: Math.floor(requestedTarget.x / UNITS_PER_TILE),
    y: Math.floor(requestedTarget.y / UNITS_PER_TILE),
  };
  const requestedWalkable = navigationPointWalkable(
    map,
    scenery,
    requestedTarget,
    radius,
  );

  const queue: SearchCell[] = [{ ...start, steps: 0 }];
  const parents = new Map<string, string | null>([
    [cellKey(start.x, start.y), null],
  ]);
  const visited: SearchCell[] = [];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex++]!;
    visited.push(current);
    const currentPoint =
      current.x === start.x && current.y === start.y
        ? from
        : tileCenter(current);
    if (
      requestedWalkable &&
      current.x === requestedCell.x &&
      current.y === requestedCell.y &&
      segmentWalkable(map, scenery, currentPoint, requestedTarget, radius)
    ) {
      const route = reconstructRoute(current, parents);
      if (
        route.length === 0 ||
        squaredDistance(route.at(-1)!, requestedTarget) > 1
      )
        route.push({ ...requestedTarget });
      else route[route.length - 1] = { ...requestedTarget };
      return route;
    }
    for (const direction of CARDINAL_DIRECTIONS) {
      const next = {
        x: current.x + direction.x,
        y: current.y + direction.y,
        steps: current.steps + 1,
      };
      const nextKey = cellKey(next.x, next.y);
      if (parents.has(nextKey)) continue;
      const nextPoint = tileCenter(next);
      if (
        !navigationPointWalkable(map, scenery, nextPoint, radius) ||
        !segmentWalkable(map, scenery, currentPoint, nextPoint, radius)
      )
        continue;
      parents.set(nextKey, cellKey(current.x, current.y));
      queue.push(next);
    }
  }

  if (visited.length === 0) return [];
  const chosen = [...visited].sort((first, second) => {
    const distanceDelta =
      squaredDistance(tileCenter(first), requestedTarget) -
      squaredDistance(tileCenter(second), requestedTarget);
    return (
      distanceDelta ||
      first.steps - second.steps ||
      first.y - second.y ||
      first.x - second.x
    );
  })[0]!;
  return reconstructRoute(chosen, parents);
}

export function findStateNavigationRoute(
  state: Pick<GameState, "map">,
  from: Vec2,
  requestedTarget: Vec2,
  radius: number,
): Vec2[] {
  return findNavigationRoute(
    state.map,
    sceneryCollisions(state.map),
    from,
    requestedTarget,
    radius,
  );
}

export function navigationDirection(
  map: DungeonMap,
  scenery: readonly SceneryCollisionFootprint[],
  from: Vec2,
  requestedTarget: Vec2,
  radius: number,
): Vec2 | null {
  const waypoint = findNavigationRoute(
    map,
    scenery,
    from,
    requestedTarget,
    radius,
  )[0];
  if (!waypoint) return null;
  const dx = waypoint.x - from.x;
  const dy = waypoint.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  return {
    x: Math.round((dx / length) * 1024),
    y: Math.round((dy / length) * 1024),
  };
}
