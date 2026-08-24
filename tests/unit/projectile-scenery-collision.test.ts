import { describe, expect, it } from "vitest";
import { UNITS_PER_TILE } from "../../src/game/constants";
import { isFloor } from "../../src/game/dungeon";
import {
  buildSceneryLayout,
  openingRoomThreshold,
  type SceneryCollisionFootprint,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import {
  EMPTY_INPUT,
  type GameState,
  type ProjectileState,
  type Vec2,
} from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import { canonicalState } from "../../src/testkit/canonical";
import {
  createRunScenario,
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

function projectile(
  id: string,
  from: Vec2,
  velocity: Vec2,
  hostile = false,
  radius = 120,
): ProjectileState {
  return {
    id,
    owner: hostile ? "monster:offscreen" : "player",
    hostile,
    position: { ...from },
    previousPosition: { ...from },
    velocity: { ...velocity },
    radius,
    damage: 99,
    expiresAtTick: 100,
    color: hostile ? "#d36de7" : "#f0a24b",
    pierce: 4,
    spawnedAtTick: 0,
    hitTargets: [],
  };
}

function configureSceneryCrossing(hostile: boolean): {
  state: GameState;
  collision: SceneryCollisionFootprint;
  from: Vec2;
  to: Vec2;
  expectedImpact: Vec2;
} {
  const state = worldFromScenario(
    createRunScenario("projectile-v2-forge", "vanguard"),
  );
  expect(openingRoomThreshold(state.map)).not.toBeNull();
  const forge = buildSceneryLayout(state.map).find(
    ({ id }) => id === "structure:0:forge",
  )!;
  expect(forge.name).toBe("forge-workshop");
  const collision = forge.collision!;
  const radius = 120;
  const candidates = [
    {
      from: {
        x: collision.center.x - collision.halfWidth - radius - 480,
        y: collision.center.y,
      },
      to: {
        x: collision.center.x + collision.halfWidth + radius + 480,
        y: collision.center.y,
      },
      expectedImpact: {
        x: collision.center.x - collision.halfWidth - radius,
        y: collision.center.y,
      },
    },
    {
      from: {
        x: collision.center.x,
        y: collision.center.y - collision.halfHeight - radius - 480,
      },
      to: {
        x: collision.center.x,
        y: collision.center.y + collision.halfHeight + radius + 480,
      },
      expectedImpact: {
        x: collision.center.x,
        y: collision.center.y - collision.halfHeight - radius,
      },
    },
  ];
  const crossing = candidates.find(({ from, to }) =>
    [from, to].every((point) =>
      isFloor(
        state.map,
        Math.floor(point.x / UNITS_PER_TILE),
        Math.floor(point.y / UNITS_PER_TILE),
      ),
    ),
  );
  if (!crossing) throw new Error("V2 forge has no floor-backed crossing axis");
  const { from, to, expectedImpact } = crossing;
  expect(
    isFloor(
      state.map,
      Math.floor(from.x / UNITS_PER_TILE),
      Math.floor(from.y / UNITS_PER_TILE),
    ),
    "scenery probe must start on floor",
  ).toBe(true);
  expect(
    isFloor(
      state.map,
      Math.floor(to.x / UNITS_PER_TILE),
      Math.floor(to.y / UNITS_PER_TILE),
    ),
    "scenery probe must end on floor so endpoint-only collision would miss",
  ).toBe(true);
  state.monsters = [];
  state.effects = [];
  state.projectiles = [
    projectile(
      `projectile:${hostile ? "hostile" : "friendly"}:scenery-probe`,
      from,
      { x: to.x - from.x, y: to.y - from.y },
      hostile,
      radius,
    ),
  ];
  return { state, collision, from, to, expectedImpact };
}

function stepPastSpawn(state: GameState): void {
  stepGame(state, EMPTY_INPUT);
  expect(state.projectiles).toHaveLength(1);
  stepGame(state, EMPTY_INPUT);
}

describe("swept projectile collision with solid world geometry", () => {
  it.each([false, true])(
    "stops a %s projectile at solid scenery and records its impact",
    (hostile) => {
      const configured = configureSceneryCrossing(hostile);
      const first = configured.state;
      const second = structuredClone(first);
      const playerHealth = first.player.health;

      stepPastSpawn(first);
      stepPastSpawn(second);

      expect(canonicalState(first)).toEqual(canonicalState(second));
      expect(first.projectiles).toHaveLength(0);
      expect(first.player.health).toBe(playerHealth);
      expect(first.effects).toHaveLength(1);
      const impact = first.effects[0]!;
      expect(impact).toMatchObject({
        kind: "impact",
        color: hostile ? "#d36de7" : "#f0a24b",
        startedAtTick: 1,
        expiresAtTick: 9,
      });
      expect(impact.position.x).toBeCloseTo(configured.expectedImpact.x, 0);
      expect(impact.position.y).toBeCloseTo(configured.expectedImpact.y, 0);
      expect(
        Math.hypot(
          impact.position.x - configured.from.x,
          impact.position.y - configured.from.y,
        ),
      ).toBeGreaterThan(0);
      expect(
        Math.hypot(
          impact.position.x - configured.from.x,
          impact.position.y - configured.from.y,
        ),
      ).toBeLessThan(
        Math.hypot(
          configured.to.x - configured.from.x,
          configured.to.y - configured.from.y,
        ),
      );

      const call = buildRenderManifest(first, {
        x: first.player.position.x,
        y: first.player.position.y,
        zoom: 1,
      }).drawCalls.find(({ entityId }) => entityId === impact.id);
      expect(call).toMatchObject({
        type: "effect",
        geometryId: "effect:impact",
        worldAnchor: impact.position,
      });
    },
  );

  it("blocks a high-speed hostile shot on an intervening wall tile", () => {
    const width = 18;
    const rows = Array.from({ length: 11 }, (_, y) => {
      if (y === 0 || y === 10) return "#".repeat(width);
      const row: string[] = Array.from({ length: width }, (_, x) =>
        x === 0 || x === width - 1 ? "#" : ".",
      );
      if (y === 2) row[16] = "E";
      if (y === 5) {
        row[9] = "#";
        row[14] = "P";
      }
      return row.join("");
    });
    const scenario: ScenarioV1 = {
      schemaVersion: 1,
      id: "projectile-wall-sweep",
      seed: "projectile-wall-sweep",
      classId: "vanguard",
      map: { mode: "explicit", rows },
      monsters: [],
      settings: { ai: false, autoPickup: false, cameraFollow: true },
    };
    const state = worldFromScenario(scenario);
    const from = { x: 6.5 * UNITS_PER_TILE, y: 5.5 * UNITS_PER_TILE };
    const to = { x: 14.5 * UNITS_PER_TILE, y: 5.5 * UNITS_PER_TILE };
    state.projectiles = [
      projectile(
        "projectile:hostile:wall-probe",
        from,
        { x: to.x - from.x, y: 0 },
        true,
      ),
    ];
    const health = state.player.health;

    stepPastSpawn(state);

    expect(state.projectiles).toHaveLength(0);
    expect(state.player.health).toBe(health);
    expect(state.effects).toHaveLength(1);
    expect(state.effects[0]!.position).toEqual({
      x: 9 * UNITS_PER_TILE - 120,
      y: from.y,
    });
    expect(to).toEqual(state.player.position);
  });
});
