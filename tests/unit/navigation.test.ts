import { describe, expect, it } from "vitest";
import { UNITS_PER_TILE } from "../../src/game/constants";
import { explicitDungeon, tileCenter } from "../../src/game/dungeon";
import {
  findNavigationRoute,
  findStateNavigationRoute,
  navigationPointWalkable,
  navigationSegmentWalkable,
} from "../../src/game/navigation";
import {
  buildSceneryLayout,
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

function openArena(width = 30, height = 15): string[] {
  return Array.from({ length: height }, (_, y) => {
    if (y === 0 || y === height - 1) return "#".repeat(width);
    const row: string[] = Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 ? "#" : ".",
    );
    if (y === 7) row[15] = "P";
    if (y === 2) row[width - 3] = "E";
    return row.join("");
  });
}

describe("deterministic navigation", () => {
  it("returns the same safe route around a solid building from the same state", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const building = buildSceneryLayout(state.map).find(
      ({ kind, collision }) => kind === "structure" && collision,
    )!;
    const collision = building.collision!;
    const from = {
      x: collision.center.x,
      y:
        collision.center.y +
        collision.halfHeight +
        state.player.radius +
        UNITS_PER_TILE,
    };
    const target = {
      x: collision.center.x,
      y:
        collision.center.y -
        collision.halfHeight -
        state.player.radius -
        UNITS_PER_TILE,
    };
    const first = findStateNavigationRoute(
      state,
      from,
      target,
      state.player.radius,
    );
    const second = findStateNavigationRoute(
      structuredClone(state),
      from,
      target,
      state.player.radius,
    );

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(2);
    expect(first.at(-1)).toEqual(target);
    expect(
      first.every((point) =>
        sceneryCollisions(state.map).every(
          (solid) => !overlapsScenery(point, state.player.radius, solid),
        ),
      ),
    ).toBe(true);
  });

  it("ends at the nearest reachable point when the requested point is solid", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const collision = buildSceneryLayout(state.map).find(
      ({ kind, collision }) => kind === "structure" && collision,
    )!.collision!;
    const from = tileCenter(state.map.spawn);
    const route = findStateNavigationRoute(
      state,
      from,
      collision.center,
      state.player.radius,
    );
    const end = route.at(-1);

    expect(end).toBeDefined();
    expect(
      navigationPointWalkable(
        state.map,
        sceneryCollisions(state.map),
        end!,
        state.player.radius,
      ),
    ).toBe(true);
    expect(overlapsScenery(end!, state.player.radius, collision)).toBe(false);
    expect(
      Math.hypot(end!.x - collision.center.x, end!.y - collision.center.y),
    ).toBeLessThan(
      Math.hypot(from.x - collision.center.x, from.y - collision.center.y),
    );
  });

  it("rejects a near-tangent segment even when both endpoints are clear", () => {
    const state = worldFromScenario(
      createRunScenario("navigation-tangent-lantern", "vanguard"),
    );
    const collision = buildSceneryLayout(state.map).find(
      ({ id }) => id === "architecture:opening:lantern:0",
    )!.collision!;
    const from = {
      x: collision.center.x - 64,
      y: collision.center.y + collision.halfHeight + state.player.radius - 1,
    };
    const to = { x: collision.center.x + 64, y: from.y };
    const scenery = sceneryCollisions(state.map);

    expect(
      navigationPointWalkable(state.map, scenery, from, state.player.radius),
    ).toBe(true);
    expect(
      navigationPointWalkable(state.map, scenery, to, state.player.radius),
    ).toBe(true);
    expect(
      navigationSegmentWalkable(
        state.map,
        scenery,
        from,
        to,
        state.player.radius,
      ),
    ).toBe(false);
    expect(
      findStateNavigationRoute(state, from, to, state.player.radius),
    ).not.toEqual([to]);
  });

  it("routes around walls without cutting an actor-radius corner", () => {
    const map = explicitDungeon([
      "#############",
      "#.....#.....#",
      "#.....#...E.#",
      "#P....#.....#",
      "#.....#.....#",
      "#...........#",
      "#############",
    ]);
    const from = tileCenter(map.spawn);
    const target = tileCenter(map.exit);
    const route = findNavigationRoute(map, [], from, target, 320);

    expect(route.at(-1)).toEqual(target);
    expect(route.some((point) => point.y >= 5 * UNITS_PER_TILE)).toBe(true);
    expect(
      route.every((point) => navigationPointWalkable(map, [], point, 320)),
    ).toBe(true);
  });

  it("lets a monster route around the spawn forge to an attack position", () => {
    const scenario: ScenarioV1 = {
      schemaVersion: 1,
      id: "navigation-monster-forge",
      seed: "navigation-monster-forge",
      classId: "vanguard",
      map: { mode: "explicit", rows: openArena() },
      monsters: [
        {
          id: "monster:pathfinder",
          kind: "ashfang",
          tile: [15, 2],
          attackReadyTick: 10_000,
        },
      ],
      settings: { ai: true, autoPickup: false, cameraFollow: true },
    };
    const first = worldFromScenario(scenario);
    const second = worldFromScenario(structuredClone(scenario));
    const firstPositions = [];
    const secondPositions = [];
    let longestStall = 0;
    let currentStall = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      const before = { ...first.monsters[0]!.position };
      stepGame(first, EMPTY_INPUT);
      stepGame(second, EMPTY_INPUT);
      firstPositions.push({ ...first.monsters[0]!.position });
      secondPositions.push({ ...second.monsters[0]!.position });
      const after = first.monsters[0]!.position;
      if (after.x === before.x && after.y === before.y) currentStall += 1;
      else currentStall = 0;
      longestStall = Math.max(longestStall, currentStall);
      if (
        Math.hypot(
          after.x - first.player.position.x,
          after.y - first.player.position.y,
        ) <= first.monsters[0]!.attackRange
      )
        break;
    }

    expect(firstPositions).toEqual(secondPositions);
    expect(longestStall).toBeLessThanOrEqual(12);
    expect(
      Math.hypot(
        first.monsters[0]!.position.x - first.player.position.x,
        first.monsters[0]!.position.y - first.player.position.y,
      ),
    ).toBeLessThanOrEqual(first.monsters[0]!.attackRange);
  });
});
