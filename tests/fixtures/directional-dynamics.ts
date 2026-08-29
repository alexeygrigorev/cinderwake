import type { ReplayTapeV1 } from "../../src/testkit/replay";
import type { ScenarioV1 } from "../../src/testkit/scenarios";

export const CARDINAL_DIRECTIONS = [
  {
    id: "north",
    axis: "y" as const,
    sign: -1,
    moveX: 0 as const,
    moveY: -1 as const,
    monsterTile: [15, 7] as [number, number],
    monsterFacing: "south" as const,
  },
  {
    id: "east",
    axis: "x" as const,
    sign: 1,
    moveX: 1 as const,
    moveY: 0 as const,
    monsterTile: [23, 10] as [number, number],
    monsterFacing: "west" as const,
  },
  {
    id: "south",
    axis: "y" as const,
    sign: 1,
    moveX: 0 as const,
    moveY: 1 as const,
    monsterTile: [15, 13] as [number, number],
    monsterFacing: "north" as const,
  },
  {
    id: "west",
    axis: "x" as const,
    sign: -1,
    moveX: -1 as const,
    moveY: 0 as const,
    monsterTile: [7, 10] as [number, number],
    monsterFacing: "east" as const,
  },
] as const;

export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

function openArena(): string[] {
  const width = 30;
  const height = 15;
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

export function playerMovementScenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: "directional-player-dynamics",
    seed: "directional-player-dynamics-01",
    classId: "vanguard",
    map: { mode: "explicit", rows: openArena() },
    player: { tile: [15, 7], moveSpeed: 64 },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: false },
    camera: { mode: "fixed", centerTile: [15, 7] },
  };
}

export function monsterMovementScenario(
  direction: CardinalDirection,
): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: `directional-monster-dynamics-${direction.id}`,
    seed: `directional-monster-dynamics-${direction.id}-01`,
    classId: "vanguard",
    map: { mode: "explicit", rows: openArena() },
    player: { tile: [15, 10] },
    monsters: [
      {
        id: "monster:directional-pursuer",
        kind: "ashfang",
        tile: [...direction.monsterTile] as [number, number],
        attackRange: 128,
        attackReadyTick: 10_000,
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: false },
    camera: { mode: "fixed", centerTile: [15, 10] },
  };
}

export function cardinalMovementTape(
  direction: CardinalDirection,
): ReplayTapeV1 {
  return {
    version: 1,
    entries: [
      {
        tick: 0,
        input: { moveX: direction.moveX, moveY: direction.moveY },
      },
      { tick: 8, input: { moveX: 0, moveY: 0 } },
    ],
  };
}

export const stationaryTape: ReplayTapeV1 = {
  version: 1,
  entries: [],
};
