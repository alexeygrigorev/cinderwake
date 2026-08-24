import { describe, expect, it } from "vitest";
import { UNITS_PER_TILE } from "../../src/game/constants";
import { generateDungeon, tileCenter } from "../../src/game/dungeon";
import {
  buildSceneryLayout,
  overlapsScenery,
  sceneryCollisionContractViolations,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import { canonicalState } from "../../src/testkit/canonical";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { stateFromSnapshot } from "../../src/testkit/stateSnapshots";

describe("deterministic scenery collision", () => {
  it("keeps generated spawn and exit centers clear across varied seeds", () => {
    for (let index = 0; index < 40; index += 1) {
      const map = generateDungeon(`scenery-collision-${index}`);
      const solids = buildSceneryLayout(map).flatMap(({ collision }) =>
        collision ? [collision] : [],
      );
      for (const [label, point] of [
        ["spawn", tileCenter(map.spawn)],
        ["exit", tileCenter(map.exit)],
      ] as const)
        expect(
          solids.every((collision) => !overlapsScenery(point, 300, collision)),
          `${label} blocked for seed ${index}`,
        ).toBe(true);
    }
  });

  it("rebuilds the same semantic layout from an arbitrary restored state", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const restored = stateFromSnapshot(canonicalState(state));

    expect(buildSceneryLayout(restored.map)).toEqual(
      buildSceneryLayout(state.map),
    );
  });

  it("keeps collision placements aligned with visible scenery", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const layout = buildSceneryLayout(state.map);
    const manifest = buildRenderManifest(state, { x: 0, y: 0, zoom: 1 });

    for (const placement of layout) {
      const visible = manifest.sceneSprites.find(
        ({ objectId }) => objectId === placement.id,
      );
      expect(visible, placement.id).toBeDefined();
      expect(visible?.worldAnchor).toEqual(placement.worldAnchor);
      expect(visible?.tile).toEqual(placement.tile);
    }
  });

  it("blocks the player at a building base but permits adjacent sliding", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const building = buildSceneryLayout(state.map).find(
      ({ kind, collision }) => kind === "structure" && collision,
    )!;
    const collision = building.collision!;
    const safeGap = 16;
    state.player.position = {
      x: collision.center.x,
      y:
        collision.center.y +
        collision.halfHeight +
        state.player.radius +
        safeGap,
    };
    state.player.previousPosition = { ...state.player.position };

    for (let tick = 0; tick < 60; tick += 1)
      stepGame(state, { ...EMPTY_INPUT, moveY: -1 });

    const blocked = { ...state.player.position };
    expect(overlapsScenery(blocked, state.player.radius, collision)).toBe(
      false,
    );
    expect(blocked.y).toBeGreaterThan(collision.center.y);

    for (let tick = 0; tick < 10; tick += 1)
      stepGame(state, { ...EMPTY_INPUT, moveX: 1 });
    expect(state.player.position.x).toBeGreaterThan(
      blocked.x + state.player.moveSpeed * 8,
    );
  });

  it("blocks monsters at raised props and keeps every raised object solid", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const prop = buildSceneryLayout(state.map).find(
      ({ kind }) => kind === "prop",
    )!;
    const collision = prop.collision!;
    const monster = {
      id: "monster:collision-probe",
      kind: "ashfang" as const,
      position: {
        x: collision.center.x,
        y: collision.center.y + collision.halfHeight + 300 + 8,
      },
      previousPosition: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      facing: { x: 0, y: -1024 },
      radius: 300,
      health: 100,
      maxHealth: 100,
      armor: 0,
      moveSpeed: 44,
      attackDamage: 1,
      attackRange: 100,
      attackReadyTick: 10_000,
      elite: false,
      guaranteedLoot: false,
      deathTick: null,
      removeAtTick: null,
      animation: {
        clip: "idle" as const,
        startedAtTick: 0,
        lockedUntilTick: 0,
      },
    };
    monster.previousPosition = { ...monster.position };
    state.monsters = [monster];
    state.player.position = {
      x: collision.center.x,
      y: collision.center.y - 3 * UNITS_PER_TILE,
    };
    state.player.previousPosition = { ...state.player.position };
    state.settings.ai = true;
    const start = { ...monster.position };
    const startDistance = Math.hypot(
      monster.position.x - state.player.position.x,
      monster.position.y - state.player.position.y,
    );

    for (let tick = 0; tick < 100; tick += 1) stepGame(state, EMPTY_INPUT);
    expect(overlapsScenery(monster.position, monster.radius, collision)).toBe(
      false,
    );
    expect(
      Math.hypot(monster.position.x - start.x, monster.position.y - start.y),
    ).toBeGreaterThan(1_000);
    expect(
      Math.hypot(
        monster.position.x - state.player.position.x,
        monster.position.y - state.player.position.y,
      ),
    ).toBeLessThan(startDistance);

    const rubbleMap = structuredClone(state.map);
    rubbleMap.rooms = [
      { x: 1, y: 1, width: 6, height: 6 },
      { x: 8, y: 1, width: 6, height: 6 },
    ];
    let rubble = buildSceneryLayout(rubbleMap).find(
      ({ name }) => name === "rubble",
    );
    for (let suffix = 0; !rubble && suffix < 10_000; suffix += 1) {
      rubbleMap.digest = suffix.toString(16).padStart(8, "0");
      rubble = buildSceneryLayout(rubbleMap).find(
        ({ name }) => name === "rubble",
      );
    }
    expect(rubble).toBeDefined();
    expect(rubble?.collisionMode).toBe("solid");
    expect(rubble?.collision).not.toBeNull();
    expect(
      sceneryCollisionContractViolations(buildSceneryLayout(state.map)),
    ).toEqual([]);
  });

  it("rejects a raised-object pass-through mutation while preserving flat decals", () => {
    const state = worldFromScenario(
      createRunScenario("collision-contract", "vanguard"),
    );
    const layout = buildSceneryLayout(state.map);
    const raisedIndex = layout.findIndex(({ kind }) => kind !== "decal");
    const broken = structuredClone(layout);
    broken[raisedIndex] = {
      ...broken[raisedIndex]!,
      collisionMode: "passable",
      collision: null,
    };

    expect(sceneryCollisionContractViolations(layout)).toEqual([]);
    expect(sceneryCollisionContractViolations(broken)).toEqual([
      `${broken[raisedIndex]!.id}:raised-object-must-be-solid`,
    ]);

    for (const raisedName of ["chain-coil", "cracked-embers"]) {
      const raisedDecal = structuredClone(layout);
      const decalIndex = raisedDecal.findIndex(({ kind }) => kind === "decal");
      raisedDecal[decalIndex] = {
        ...raisedDecal[decalIndex]!,
        name: raisedName,
      };
      expect(sceneryCollisionContractViolations(raisedDecal)).toEqual([
        `${raisedDecal[decalIndex]!.id}:raised-decal-must-be-solid`,
      ]);
    }
  });
});
