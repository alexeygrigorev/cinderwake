import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import {
  chooseSlamEscape,
  SLAM_ESCAPE_MARGIN,
} from "./lib/campaign-hazard-policy.mjs";

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});
const [scenarioApi, simulation, navigation, sceneryApi] = await Promise.all([
  server.ssrLoadModule("/src/testkit/scenarios.ts"),
  server.ssrLoadModule("/src/game/simulation.ts"),
  server.ssrLoadModule("/src/game/navigation.ts"),
  server.ssrLoadModule("/src/game/sceneryLayout.ts"),
]);

test.after(async () => {
  await server.close();
});

function rows(withNorthWall = false) {
  return Array.from({ length: 10 }, (_, y) => {
    if (y === 0 || y === 9) return "####################";
    const row = Array.from({ length: 20 }, (_, x) =>
      x === 0 || x === 19 ? "#" : ".",
    );
    if (withNorthWall && y === 2) row[6] = "#";
    if (y === 4) {
      row[4] = "P";
      row[18] = "E";
    }
    return row.join("");
  });
}

function stateWithSlam({ withNorthWall = false, playerTile = [4, 4] } = {}) {
  return scenarioApi.worldFromScenario({
    schemaVersion: 1,
    id: "campaign-hazard-policy",
    seed: "campaign-hazard-policy",
    classId: "vanguard",
    map: { mode: "explicit", rows: rows(withNorthWall) },
    player: {
      tile: playerTile,
      health: 1_000,
      maxHealth: 1_000,
      armor: 0,
    },
    monsters: [
      {
        id: "monster:bell-keeper",
        kind: "stonekin",
        tile: [6, 4],
        health: 1_000,
        maxHealth: 1_000,
        armor: 0,
        attackDamage: 20,
        attackReadyTick: 10_000,
        elite: true,
      },
    ],
    pendingAttacks: [
      {
        id: "attack:bell-keeper:ability",
        ownerId: "monster:bell-keeper",
        kind: "ability",
        impactTick: 40,
        originTile: [6, 4],
        direction: [-1024, 0],
        range: 2 * 1024,
        damage: 20,
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: false },
  });
}

function mockNavigation({ rejectNorth = false, disabled = false } = {}) {
  return {
    navigationPointWalkable(_map, _scenery, target) {
      if (disabled) return false;
      return !(rejectNorth && target.y < 4.5 * 1024);
    },
    findNavigationRoute(_map, _scenery, _from, target) {
      if (disabled) return [];
      return [{ ...target }];
    },
  };
}

test("chooses a stable reachable point beyond the stored radius", () => {
  const state = stateWithSlam();
  const selected = chooseSlamEscape(
    state,
    mockNavigation({ rejectNorth: true }),
    [],
  );
  assert.ok(selected);
  assert.equal(selected.direction, "west");
  assert.equal(selected.route.length, 1);
  assert.ok(
    Math.hypot(
      selected.target.x - selected.origin.x,
      selected.target.y - selected.origin.y,
    ) > selected.range,
  );
  assert.ok(
    Math.abs(
      Math.hypot(
        selected.target.x - selected.origin.x,
        selected.target.y - selected.origin.y,
      ) -
        (selected.range + SLAM_ESCAPE_MARGIN),
    ) < 2,
  );
  assert.deepEqual(
    selected,
    chooseSlamEscape(state, mockNavigation({ rejectNorth: true }), []),
  );
});

test("does not claim an escape when movement is disabled or every candidate is blocked", () => {
  const state = stateWithSlam();
  assert.equal(
    chooseSlamEscape(state, mockNavigation({ disabled: true }), []),
    null,
  );
  assert.equal(
    state.player.position.x,
    4.5 * 1024,
    "policy must not teleport the player",
  );
});

test("ignores a pending slam that does not contain the player", () => {
  const state = stateWithSlam({ playerTile: [2, 4] });
  assert.equal(chooseSlamEscape(state, mockNavigation(), []), null);
});

test("rejects a legal-looking candidate that authoritative navigation cannot reach", () => {
  const state = stateWithSlam();
  const navigationWithDeadEnd = {
    navigationPointWalkable: () => true,
    findNavigationRoute: () => [],
  };
  assert.equal(chooseSlamEscape(state, navigationWithDeadEnd, []), null);
});

test("a selected escape changes position through legal simulation input and avoids impact", () => {
  const state = stateWithSlam();
  const scenery = sceneryApi.sceneryCollisions(state.map);
  const selected = chooseSlamEscape(state, navigation, scenery);
  assert.ok(selected);
  let movedTicks = 0;
  while (
    movedTicks < 20 &&
    Math.hypot(
      state.player.position.x - selected.origin.x,
      state.player.position.y - selected.origin.y,
    ) <= selected.range
  ) {
    const before = { ...state.player.position };
    simulation.stepGame(state, {
      moveX: Math.sign(selected.target.x - before.x),
      moveY: Math.sign(selected.target.y - before.y),
      aim: null,
      attack: false,
      ability: false,
      useTonic: false,
    });
    assert.equal(
      navigation.navigationSegmentWalkable(
        state.map,
        scenery,
        before,
        state.player.position,
        state.player.radius,
      ),
      true,
    );
    movedTicks += 1;
  }
  assert.ok(movedTicks > 0);
  assert.ok(
    Math.hypot(
      state.player.position.x - selected.origin.x,
      state.player.position.y - selected.origin.y,
    ) > selected.range,
  );
  while (state.tick < 40)
    simulation.stepGame(state, {
      moveX: 0,
      moveY: 0,
      aim: null,
      attack: false,
      ability: false,
      useTonic: false,
    });
  simulation.stepGame(state, {
    moveX: 0,
    moveY: 0,
    aim: null,
    attack: false,
    ability: false,
    useTonic: false,
  });
  assert.equal(state.player.health, 1_000);
  assert.equal(
    state.eventLog.some(({ type }) => type === "player_damaged"),
    false,
  );
});
