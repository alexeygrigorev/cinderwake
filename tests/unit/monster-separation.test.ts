import { describe, expect, it } from "vitest";
import { navigationDirection } from "../../src/game/navigation";
import {
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import {
  EMPTY_INPUT,
  type GameState,
  type MonsterState,
} from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

function openArena(): string[] {
  const width = 30;
  return Array.from({ length: 15 }, (_, y) => {
    if (y === 0 || y === 14) return "#".repeat(width);
    const row: string[] = Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 ? "#" : ".",
    );
    if (y === 7) row[15] = "P";
    if (y === 2) row[width - 3] = "E";
    return row.join("");
  });
}

function pursuitScenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: "monster-separation-pursuit",
    seed: "monster-separation-pursuit",
    classId: "vanguard",
    map: { mode: "explicit", rows: openArena() },
    monsters: [
      {
        id: "monster:alpha",
        kind: "ashfang",
        tile: [9, 7],
        attackReadyTick: 10_000,
      },
      {
        id: "monster:beta",
        kind: "ashfang",
        tile: [9, 7],
        attackReadyTick: 10_000,
      },
      {
        id: "monster:gamma",
        kind: "ashfang",
        tile: [9, 7],
        attackReadyTick: 10_000,
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: true },
  };
}

function distance(first: MonsterState, second: MonsterState): number {
  return Math.hypot(
    first.position.x - second.position.x,
    first.position.y - second.position.y,
  );
}

function maximumPenetration(state: GameState): number {
  let penetration = 0;
  for (let firstIndex = 0; firstIndex < state.monsters.length; firstIndex += 1)
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < state.monsters.length;
      secondIndex += 1
    ) {
      const first = state.monsters[firstIndex]!;
      const second = state.monsters[secondIndex]!;
      if (first.health <= 0 || second.health <= 0) continue;
      penetration = Math.max(
        penetration,
        first.radius + second.radius - distance(first, second),
      );
    }
  return penetration;
}

describe("deterministic monster separation", () => {
  it("proves same-target pursuit would overlap without the crowd resolver", () => {
    const state = worldFromScenario(pursuitScenario());
    const scenery = sceneryCollisions(state.map);
    const [first, second] = state.monsters;
    const firstDirection = navigationDirection(
      state.map,
      scenery,
      first!.position,
      state.player.position,
      first!.radius,
    );
    const secondDirection = navigationDirection(
      state.map,
      scenery,
      second!.position,
      state.player.position,
      second!.radius,
    );
    expect(firstDirection).toEqual(secondDirection);
    const unresolvedFirst = {
      x:
        first!.position.x +
        Math.round((firstDirection!.x * first!.moveSpeed) / 1024),
      y:
        first!.position.y +
        Math.round((firstDirection!.y * first!.moveSpeed) / 1024),
    };
    const unresolvedSecond = {
      x:
        second!.position.x +
        Math.round((secondDirection!.x * second!.moveSpeed) / 1024),
      y:
        second!.position.y +
        Math.round((secondDirection!.y * second!.moveSpeed) / 1024),
    };

    expect(unresolvedSecond).toEqual(unresolvedFirst);
    expect(
      Math.hypot(
        unresolvedFirst.x - unresolvedSecond.x,
        unresolvedFirst.y - unresolvedSecond.y,
      ),
    ).toBeLessThan(first!.radius + second!.radius);
  });

  it("separates a pursuing pack reproducibly without entering scenery", () => {
    const first = worldFromScenario(pursuitScenario());
    const second = worldFromScenario(pursuitScenario());
    const firstTrajectory = [];
    const secondTrajectory = [];
    const scenery = sceneryCollisions(first.map);

    for (let tick = 0; tick < 180; tick += 1) {
      stepGame(first, EMPTY_INPUT);
      stepGame(second, EMPTY_INPUT);
      firstTrajectory.push(
        first.monsters.map(({ id, position }) => ({ id, ...position })),
      );
      secondTrajectory.push(
        second.monsters.map(({ id, position }) => ({ id, ...position })),
      );
      expect(
        maximumPenetration(first),
        `penetration at tick ${tick}`,
      ).toBeLessThanOrEqual(2);
      for (const monster of first.monsters)
        expect(
          scenery.every(
            (collision) =>
              !overlapsScenery(monster.position, monster.radius, collision),
          ),
          `${monster.id} entered scenery at tick ${tick}`,
        ).toBe(true);
    }

    expect(firstTrajectory).toEqual(secondTrajectory);
    expect(
      first.monsters.every(({ animation }) => animation.clip === "walk"),
    ).toBe(true);
    expect(
      first.monsters.some(
        (monster) =>
          Math.hypot(
            monster.position.x - first.player.position.x,
            monster.position.y - first.player.position.y,
          ) <= monster.attackRange,
      ),
    ).toBe(true);

    const manifest = buildRenderManifest(first, {
      x: first.player.position.x,
      y: first.player.position.y,
      zoom: 1,
    });
    const anchors = new Map(
      manifest.drawCalls
        .filter(({ type }) => type === "monster")
        .map(({ entityId, worldAnchor }) => [entityId, worldAnchor]),
    );
    for (const monster of first.monsters)
      expect(anchors.get(monster.id)).toEqual(monster.position);
  });

  it("keeps separated melee pursuers capable of reaching and attacking", () => {
    const state = worldFromScenario(pursuitScenario());
    for (const monster of state.monsters) monster.attackReadyTick = 0;

    for (let tick = 0; tick < 240; tick += 1) stepGame(state, EMPTY_INPUT);

    const attackers = new Set(
      state.eventLog
        .filter(({ type }) => type === "attack_started")
        .map(({ sourceId }) => sourceId),
    );
    for (const monster of state.monsters)
      expect(attackers, `${monster.id} never reached attack range`).toContain(
        monster.id,
      );
  });
});
