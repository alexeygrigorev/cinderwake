import { describe, expect, it } from "vitest";
import {
  DIAGONAL_SCALE,
  DIRECTION_SCALE,
  UNITS_PER_TILE,
} from "../../src/game/constants";
import { generateDungeon, tileCenter } from "../../src/game/dungeon";
import {
  findNavigationRoute,
  navigationPointWalkable,
  navigationSegmentWalkable,
} from "../../src/game/navigation";
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

  it("rebuilds the environment-kit opening from a restored generated state", () => {
    const state = worldFromScenario(
      createRunScenario("environment-kit-restoration", "vanguard"),
    );
    const restored = stateFromSnapshot(canonicalState(state));
    const names = new Set([
      "forge-workshop",
      "lantern-a",
      "lantern-b",
      "barricade-v2",
      "raised-clutter-bench",
    ]);

    expect(
      buildSceneryLayout(restored.map).filter(({ name }) => names.has(name)),
    ).toEqual(
      buildSceneryLayout(state.map).filter(({ name }) => names.has(name)),
    );
  });

  it("keeps environment-kit roles independent of digest modulus selection", () => {
    const map = generateDungeon("environment-kit-modulus-control");
    const changedDigest = structuredClone(map);
    changedDigest.digest = "ffffffff";
    const names = new Set([
      "forge-workshop",
      "lantern-a",
      "lantern-b",
      "barricade-v2",
      "raised-clutter-bench",
    ]);
    const roles = (candidate: typeof map) =>
      buildSceneryLayout(candidate).filter(({ name }) => names.has(name));

    expect(roles(changedDigest)).toEqual(roles(map));
  });

  it("matches each environment-kit footprint to its visible contact mass", () => {
    const state = worldFromScenario(
      createRunScenario("environment-kit-footprints", "vanguard"),
    );
    const layout = buildSceneryLayout(state.map);
    const forge = layout.find(({ id }) => id === "structure:0:forge")!;
    const lanterns = layout.filter(({ id }) =>
      id.startsWith("architecture:opening:lantern:"),
    );
    const barricade = layout.find(({ id }) => id === "prop:0:barricade-v2")!;
    const bench = layout.find(
      ({ id }) => id === "prop:0:raised-clutter-bench",
    )!;

    expect(forge).toMatchObject({
      name: "forge-workshop",
      collision: { halfWidth: 856, halfHeight: 320 },
    });
    expect(forge.collision!.center.y).toBe(forge.worldAnchor.y - 200);
    expect(lanterns.map(({ collision }) => collision)).toEqual(
      lanterns.map(({ worldAnchor }) => ({
        shape: "ellipse",
        center: { x: worldAnchor.x, y: worldAnchor.y - 30 },
        halfWidth: 180,
        halfHeight: 110,
      })),
    );
    expect(barricade.collision).toMatchObject({
      halfWidth: 296,
      halfHeight: 180,
    });
    expect(bench.collision).toMatchObject({
      halfWidth: 350,
      halfHeight: 380,
    });
  });

  it("keeps opening collision contact within the visible alpha supports", () => {
    const state = worldFromScenario(
      createRunScenario("environment-kit-contact-clarity", "vanguard"),
    );
    const layout = buildSceneryLayout(state.map);
    const logicalPixelsPerWorldUnit = 48 / UNITS_PER_TILE;
    const supportWidths = new Map([
      ["structure:0:forge", 91.19],
      ["prop:0:barricade-v2", 31.55],
      ["prop:0:raised-clutter-bench", 37.25],
    ]);

    for (const [objectId, visibleSupportWidth] of supportWidths) {
      const placement = layout.find(({ id }) => id === objectId)!;
      const collision = placement.collision!;
      const blockedPlayerCenterDistance =
        (collision.halfWidth + state.player.radius) * logicalPixelsPerWorldUnit;
      const excessBeyondVisibleSupport =
        blockedPlayerCenterDistance - visibleSupportWidth / 2;

      // The player disc is itself 15 logical pixels from center to foot edge.
      // A larger excess means the prop, rather than visible actor contact, is
      // creating an invisible barrier.
      expect(excessBeyondVisibleSupport, objectId).toBeLessThanOrEqual(15);
    }

    const forge = layout.find(({ id }) => id === "structure:0:forge")!;
    const forgeBottomBeyondAnchor =
      (forge.collision!.center.y +
        forge.collision!.halfHeight -
        forge.worldAnchor.y) *
      logicalPixelsPerWorldUnit;
    expect(forgeBottomBeyondAnchor).toBeLessThanOrEqual(8);
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

  it("names a blocked object and renders one rate-limited impact marker", () => {
    const state = worldFromScenario(
      createRunScenario("blocked-movement-feedback", "vanguard"),
    );
    state.monsters = [];
    state.settings.ai = false;
    const forge = buildSceneryLayout(state.map).find(
      ({ id }) => id === "structure:0:forge",
    )!;
    const collision = forge.collision!;
    state.player.position = {
      x: collision.center.x,
      y: collision.center.y + collision.halfHeight + state.player.radius + 1,
    };
    state.player.previousPosition = { ...state.player.position };

    stepGame(state, { ...EMPTY_INPUT, moveY: -1 });
    const event = state.eventLog.find(
      ({ type }) => type === "movement_blocked",
    )!;
    expect(event).toMatchObject({
      type: "movement_blocked",
      sourceId: "player",
      targetId: forge.id,
      detail: "forge workshop",
    });
    expect(state.effects).toHaveLength(1);
    expect(state.effects[0]).toMatchObject({
      kind: "impact",
      color: "#f2a65a",
    });
    const marker = buildRenderManifest(state, {
      x: (state.player.position.x / UNITS_PER_TILE) * 48,
      y: (state.player.position.y / UNITS_PER_TILE) * 48,
      zoom: 0.9,
    }).drawCalls.find(({ entityId }) => entityId === state.effects[0]!.id);
    expect(marker).toMatchObject({
      spriteId: "effect:impact",
      visible: true,
    });

    for (let tick = 0; tick < 10; tick += 1)
      stepGame(state, { ...EMPTY_INPUT, moveY: -1 });
    expect(
      state.eventLog.filter(({ type }) => type === "movement_blocked"),
    ).toHaveLength(1);
  });

  it.each(["vanguard", "ranger", "arcanist"] as const)(
    "cannot tunnel a high-speed restored %s through a solid object",
    (classId) => {
      const state = worldFromScenario(
        createRunScenario("collision-high-speed-player", classId),
      );
      state.monsters = [];
      state.settings.ai = false;
      const collision = buildSceneryLayout(state.map).find(
        ({ kind, collision }) => kind === "structure" && collision,
      )!.collision!;
      const safeGap = 32;
      state.player.position = {
        x: collision.center.x,
        y:
          collision.center.y +
          collision.halfHeight +
          state.player.radius +
          safeGap,
      };
      state.player.previousPosition = { ...state.player.position };
      state.player.moveSpeed =
        collision.halfHeight * 2 + state.player.radius * 2 + safeGap * 2;

      const startingSide = Math.sign(
        state.player.position.y - collision.center.y,
      );
      stepGame(state, { ...EMPTY_INPUT, moveY: -1 });

      expect(
        overlapsScenery(state.player.position, state.player.radius, collision),
      ).toBe(false);
      expect(Math.sign(state.player.position.y - collision.center.y)).toBe(
        startingSide,
      );
      expect(state.player.position.y).toBeGreaterThan(
        collision.center.y + collision.halfHeight + state.player.radius,
      );
    },
  );

  it("blocks a short near-tangent chord through a small solid prop", () => {
    const state = worldFromScenario(
      createRunScenario("collision-tangent-lantern", "vanguard"),
    );
    state.monsters = [];
    state.settings.ai = false;
    const collision = buildSceneryLayout(state.map).find(
      ({ id }) => id === "architecture:opening:lantern:0",
    )!.collision!;
    state.player.moveSpeed = 128;
    state.player.position = {
      x: collision.center.x - 64,
      y: collision.center.y + collision.halfHeight + state.player.radius - 1,
    };
    state.player.previousPosition = { ...state.player.position };
    const attemptedEnd = {
      x: state.player.position.x + state.player.moveSpeed,
      y: state.player.position.y,
    };

    expect(
      overlapsScenery(state.player.position, state.player.radius, collision),
    ).toBe(false);
    expect(overlapsScenery(attemptedEnd, state.player.radius, collision)).toBe(
      false,
    );
    stepGame(state, { ...EMPTY_INPUT, moveX: 1 });

    expect(state.player.position).toEqual(state.player.previousPosition);
    expect(state.player.velocity).toEqual({ x: 0, y: 0 });
  });

  it.each(["vanguard", "ranger", "arcanist"] as const)(
    "keeps the rendered %s diagonal tick chord outside solid scenery",
    (classId) => {
      const state = worldFromScenario(
        createRunScenario("collision-diagonal-player", classId),
      );
      state.monsters = [];
      state.settings.ai = false;
      const collisions = buildSceneryLayout(state.map).flatMap(
        ({ collision }) => (collision ? [collision] : []),
      );
      const collision = buildSceneryLayout(state.map).find(
        ({ kind, collision }) => kind === "structure" && collision,
      )!.collision!;
      const offset =
        Math.max(collision.halfWidth, collision.halfHeight) +
        state.player.radius +
        200;
      const desiredComponent = offset * 2;
      state.player.moveSpeed = Math.round(
        (desiredComponent * DIRECTION_SCALE) / DIAGONAL_SCALE,
      );
      const component = Math.round(
        (state.player.moveSpeed * DIAGONAL_SCALE) / DIRECTION_SCALE,
      );
      state.player.position = {
        x: collision.center.x - Math.floor(component / 2),
        y: collision.center.y + Math.floor(component / 2),
      };
      state.player.previousPosition = { ...state.player.position };
      const start = { ...state.player.position };
      const naiveDiagonalEnd = {
        x: start.x + component,
        y: start.y - component,
      };

      expect(
        navigationSegmentWalkable(
          state.map,
          collisions,
          start,
          naiveDiagonalEnd,
          state.player.radius,
        ),
      ).toBe(false);
      stepGame(state, { ...EMPTY_INPUT, moveX: 1, moveY: -1 });

      expect(state.player.position).not.toEqual(naiveDiagonalEnd);
      expect(
        navigationSegmentWalkable(
          state.map,
          collisions,
          state.player.previousPosition,
          state.player.position,
          state.player.radius,
        ),
      ).toBe(true);
      expect(
        Number(state.player.position.x !== start.x) +
          Number(state.player.position.y !== start.y),
      ).toBe(1);
    },
  );

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

  it.each(["ashfang", "hexer", "stonekin"] as const)(
    "keeps every %s pursuit segment outside solid scenery",
    (kind) => {
      const state = worldFromScenario(
        createRunScenario("collision-all-monster-kinds", "vanguard"),
      );
      const monster = state.monsters.find(
        (candidate) => candidate.kind === kind,
      )!;
      state.monsters = [monster];
      state.player.health = 10_000;
      state.player.maxHealth = 10_000;
      state.settings.ai = true;
      const collisions = buildSceneryLayout(state.map).flatMap(
        ({ collision }) => (collision ? [collision] : []),
      );
      const collision = buildSceneryLayout(state.map).find(
        ({ id }) => id === "structure:0:forge",
      )!.collision!;
      const nearbyWalkableStart = Array.from(
        { length: state.map.width * state.map.height },
        (_, index) =>
          tileCenter({
            x: index % state.map.width,
            y: Math.floor(index / state.map.width),
          }),
      )
        .filter((point) =>
          navigationPointWalkable(state.map, collisions, point, monster.radius),
        )
        .sort(
          (first, second) =>
            Math.hypot(
              first.x - collision.center.x,
              first.y - collision.center.y,
            ) -
            Math.hypot(
              second.x - collision.center.x,
              second.y - collision.center.y,
            ),
        )[0]!;
      monster.position = { ...nearbyWalkableStart };
      monster.previousPosition = { ...monster.position };
      monster.attackReadyTick = 10_000;
      const target = Array.from(
        { length: state.map.width * state.map.height },
        (_, index) =>
          tileCenter({
            x: index % state.map.width,
            y: Math.floor(index / state.map.width),
          }),
      )
        .filter((point) => {
          const distance = Math.hypot(
            point.x - monster.position.x,
            point.y - monster.position.y,
          );
          if (
            distance <= monster.attackRange + UNITS_PER_TILE ||
            distance >= 8 * UNITS_PER_TILE ||
            !navigationPointWalkable(
              state.map,
              collisions,
              point,
              state.player.radius,
            )
          )
            return false;
          const route = findNavigationRoute(
            state.map,
            collisions,
            monster.position,
            point,
            monster.radius,
          );
          return route.at(-1)?.x === point.x && route.at(-1)?.y === point.y;
        })
        .sort(
          (first, second) =>
            first.y - second.y ||
            Math.abs(first.x - collision.center.x) -
              Math.abs(second.x - collision.center.x),
        )[0];
      expect(target).toBeDefined();
      state.player.position = { ...target! };
      state.player.previousPosition = { ...state.player.position };
      const start = { ...monster.position };
      const startDistance = Math.hypot(
        start.x - state.player.position.x,
        start.y - state.player.position.y,
      );
      let minimumDistance = startDistance;

      for (let tick = 0; tick < 120; tick += 1) {
        stepGame(state, EMPTY_INPUT);
        expect(
          navigationSegmentWalkable(
            state.map,
            collisions,
            monster.previousPosition,
            monster.position,
            monster.radius,
          ),
          `${kind} crossed solid scenery at tick ${tick}`,
        ).toBe(true);
        minimumDistance = Math.min(
          minimumDistance,
          Math.hypot(
            monster.position.x - state.player.position.x,
            monster.position.y - state.player.position.y,
          ),
        );
      }

      expect(
        Math.hypot(monster.position.x - start.x, monster.position.y - start.y),
      ).toBeGreaterThan(500);
      expect(minimumDistance).toBeLessThan(startDistance - 500);
    },
  );

  it("keeps the Hexer retreat branch outside solid scenery", () => {
    const state = worldFromScenario(
      createRunScenario("collision-hexer-retreat", "vanguard"),
    );
    const monster = state.monsters.find(({ kind }) => kind === "hexer")!;
    state.monsters = [monster];
    state.player.health = 10_000;
    state.player.maxHealth = 10_000;
    state.settings.ai = true;
    const collisions = buildSceneryLayout(state.map).flatMap(({ collision }) =>
      collision ? [collision] : [],
    );
    const collision = buildSceneryLayout(state.map).find(
      ({ id }) => id === "structure:0:forge",
    )!.collision!;
    monster.position = {
      x: collision.center.x,
      y: collision.center.y + collision.halfHeight + monster.radius + 32,
    };
    monster.previousPosition = { ...monster.position };
    monster.attackReadyTick = 10_000;
    state.player.position = {
      x: monster.position.x,
      y: monster.position.y + 2 * UNITS_PER_TILE,
    };
    state.player.previousPosition = { ...state.player.position };
    const start = { ...monster.position };

    for (let tick = 0; tick < 90; tick += 1) {
      stepGame(state, EMPTY_INPUT);
      expect(
        navigationSegmentWalkable(
          state.map,
          collisions,
          monster.previousPosition,
          monster.position,
          monster.radius,
        ),
        `Hexer retreat crossed solid scenery at tick ${tick}`,
      ).toBe(true);
    }
    expect(
      Math.hypot(monster.position.x - start.x, monster.position.y - start.y),
    ).toBeGreaterThan(500);
    expect(monster.position.x).not.toBe(start.x);
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

  it("rejects zero-sized and non-finite solid footprint mutations", () => {
    const state = worldFromScenario(
      createRunScenario("collision-footprint-mutations", "vanguard"),
    );
    const layout = buildSceneryLayout(state.map);
    const raisedIndex = layout.findIndex(
      ({ kind, collision }) => kind !== "decal" && collision,
    );
    const raised = layout[raisedIndex]!;

    for (const collision of [
      { ...raised.collision!, halfWidth: 0 },
      { ...raised.collision!, halfHeight: 0 },
      {
        ...raised.collision!,
        center: { ...raised.collision!.center, x: Number.NaN },
      },
    ]) {
      const broken = structuredClone(layout);
      broken[raisedIndex] = { ...raised, collision };
      expect(sceneryCollisionContractViolations(broken)).toEqual([
        `${raised.id}:solid-collision-footprint-invalid`,
      ]);
    }
  });
});
