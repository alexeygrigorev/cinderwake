import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../../src/game/content";
import { stepGame } from "../../src/game/simulation";
import {
  EMPTY_INPUT,
  type CharacterClass,
  type GameState,
} from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  TEMPORAL_ENTITY_IDS,
  TEMPORAL_SCENARIO_CONTRACTS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

function advanceUntilStateTick(state: GameState, targetTick: number): void {
  while (state.tick < targetTick) stepGame(state, EMPTY_INPUT);
}

function advanceThroughEventTick(state: GameState, eventTick: number): void {
  advanceUntilStateTick(state, eventTick);
  stepGame(state, EMPTY_INPUT);
}

function entityIds(state: GameState): string[] {
  return [
    state.player.id,
    ...state.monsters.map(({ id }) => id),
    ...state.pendingAttacks.map(({ id }) => id),
    ...state.projectiles.map(({ id }) => id),
    ...state.loot.map(({ id }) => id),
    ...state.effects.map(({ id }) => id),
  ];
}

describe("public temporal scenario catalog", () => {
  it("constructs every stable contract with unique entity IDs", () => {
    for (const [key, contract] of Object.entries(TEMPORAL_SCENARIO_CONTRACTS)) {
      const scenario = BUILTIN_SCENARIOS[key];
      expect(scenario, key).toBeDefined();
      expect(scenario!.id).toBe(contract.scenarioId);
      const first = worldFromScenario(scenario!);
      const second = worldFromScenario(structuredClone(scenario!));
      expect(second).toEqual(first);
      expect(new Set(entityIds(first)).size).toBe(entityIds(first).length);
      expect(contract.captureTicks[0]).toBe(0);
      expect(
        contract.captureTicks.every(
          (tick, index, ticks) => index === 0 || tick > ticks[index - 1]!,
        ),
      ).toBe(true);
    }
  });

  const heroCases: Array<{
    scenarioId: string;
    classId: CharacterClass;
    action: "attack" | "ability";
    impactTick: number;
    contactTick: number;
    damage: number;
    projectileCountAtImpact: number;
    recoveryTick: number;
  }> = [
    {
      scenarioId: "temporal-vanguard-primary",
      classId: "vanguard",
      action: "attack",
      impactTick: 8,
      contactTick: 8,
      damage: 18,
      projectileCountAtImpact: 0,
      recoveryTick: 26,
    },
    {
      scenarioId: "temporal-vanguard-ability",
      classId: "vanguard",
      action: "ability",
      impactTick: 12,
      contactTick: 12,
      damage: 32,
      projectileCountAtImpact: 0,
      recoveryTick: 36,
    },
    {
      scenarioId: "temporal-ranger-primary",
      classId: "ranger",
      action: "attack",
      impactTick: 6,
      contactTick: 23,
      damage: 13,
      projectileCountAtImpact: 1,
      recoveryTick: 26,
    },
    {
      scenarioId: "temporal-ranger-ability",
      classId: "ranger",
      action: "ability",
      impactTick: 10,
      contactTick: 27,
      damage: 21,
      projectileCountAtImpact: 3,
      recoveryTick: 36,
    },
    {
      scenarioId: "temporal-arcanist-primary",
      classId: "arcanist",
      action: "attack",
      impactTick: 8,
      contactTick: 29,
      damage: 15,
      projectileCountAtImpact: 1,
      recoveryTick: 26,
    },
    {
      scenarioId: "temporal-arcanist-ability",
      classId: "arcanist",
      action: "ability",
      impactTick: 12,
      contactTick: 12,
      damage: 28,
      projectileCountAtImpact: 0,
      recoveryTick: 36,
    },
  ];

  it.each(heroCases)(
    "$scenarioId progresses from input through contact and recovery",
    ({
      scenarioId,
      classId,
      action,
      impactTick,
      contactTick,
      damage,
      projectileCountAtImpact,
      recoveryTick,
    }) => {
      const state = worldFromScenario(BUILTIN_SCENARIOS[scenarioId]!);
      const target = state.monsters.find(
        ({ id }) => id === TEMPORAL_ENTITY_IDS.heroTarget,
      )!;
      const initialHealth = target.health;
      stepGame(state, {
        ...EMPTY_INPUT,
        attack: action === "attack",
        ability: action === "ability",
      });

      expect(state.player.classId).toBe(classId);
      expect(state.player.animation.clip).toBe(
        action === "attack" ? "attack" : "ability",
      );
      expect(state.pendingAttacks).toHaveLength(1);
      expect(state.pendingAttacks[0]?.impactTick).toBe(impactTick);
      expect(
        state.eventLog.some(
          (event) =>
            event.tick === 0 &&
            event.type ===
              (action === "attack" ? "attack_started" : "ability_started"),
        ),
      ).toBe(true);
      const definition = ARCHETYPES[classId];
      expect(
        action === "attack"
          ? state.player.attackReadyTick
          : state.player.abilityReadyTick,
      ).toBe(
        action === "attack"
          ? definition.attackCooldown
          : definition.abilityCooldown,
      );

      advanceUntilStateTick(state, impactTick);
      expect(target.health).toBe(initialHealth);
      stepGame(state, EMPTY_INPUT);
      expect(state.pendingAttacks).toHaveLength(0);
      expect(state.projectiles).toHaveLength(projectileCountAtImpact);

      if (contactTick > impactTick) {
        advanceUntilStateTick(state, contactTick);
        expect(target.health).toBe(initialHealth);
        stepGame(state, EMPTY_INPUT);
      }
      const targetDamage = state.eventLog.filter(
        (event) =>
          event.type === "damage" &&
          event.targetId === TEMPORAL_ENTITY_IDS.heroTarget,
      );
      expect(targetDamage).toEqual([
        expect.objectContaining({ tick: contactTick, amount: damage }),
      ]);
      expect(target.health).toBe(initialHealth - damage);

      advanceThroughEventTick(state, recoveryTick);
      expect(state.player.animation.clip).toBe("idle");
    },
  );

  const enemyCases = [
    {
      scenarioId: "temporal-ashfang-attack",
      entityId: TEMPORAL_ENTITY_IDS.ashfangAttacker,
      pendingImpactTick: 7,
      damageEventTick: 7,
      damage: 8,
    },
    {
      scenarioId: "temporal-hexer-attack",
      entityId: TEMPORAL_ENTITY_IDS.hexerAttacker,
      pendingImpactTick: 12,
      damageEventTick: 43,
      damage: 7,
    },
    {
      scenarioId: "temporal-stonekin-attack",
      entityId: TEMPORAL_ENTITY_IDS.stonekinAttacker,
      pendingImpactTick: 10,
      damageEventTick: 10,
      damage: 10,
    },
  ];

  it.each(enemyCases)(
    "$scenarioId schedules wind-up, contact, and recovery",
    ({ scenarioId, entityId, pendingImpactTick, damageEventTick, damage }) => {
      const state = worldFromScenario(BUILTIN_SCENARIOS[scenarioId]!);
      const monster = state.monsters.find(({ id }) => id === entityId)!;
      const initialHealth = state.player.health;

      stepGame(state, EMPTY_INPUT);
      expect(monster.animation).toMatchObject({
        clip: "attack",
        startedAtTick: 0,
        lockedUntilTick: 26,
      });
      expect(state.pendingAttacks).toEqual([
        expect.objectContaining({
          ownerId: entityId,
          impactTick: pendingImpactTick,
        }),
      ]);
      expect(
        state.eventLog.filter(
          (event) =>
            event.type === "attack_started" && event.sourceId === entityId,
        ),
      ).toEqual([expect.objectContaining({ tick: 0 })]);

      advanceUntilStateTick(state, damageEventTick);
      expect(state.player.health).toBe(initialHealth);
      stepGame(state, EMPTY_INPUT);
      expect(state.player.health).toBe(initialHealth - damage);
      expect(
        state.eventLog.filter(
          (event) =>
            event.type === "player_damaged" && event.sourceId === entityId,
        ),
      ).toEqual([
        expect.objectContaining({ tick: damageEventTick, amount: damage }),
      ]);

      advanceThroughEventTick(state, 26);
      expect(monster.animation.clip).toBe("idle");
    },
  );

  it("retains a killed enemy for its complete death clip, then removes it", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["temporal-enemy-death"]!);
    stepGame(state, EMPTY_INPUT);
    const dead = state.monsters.find(
      ({ id }) => id === TEMPORAL_ENTITY_IDS.deathSubject,
    )!;
    expect(dead).toMatchObject({
      health: expect.any(Number),
      deathTick: 0,
      removeAtTick: 48,
      animation: { clip: "death", startedAtTick: 0, lockedUntilTick: 48 },
    });
    expect(dead.health).toBeLessThanOrEqual(0);
    expect(state.exitUnlocked).toBe(true);
    expect(state.loot.map(({ sourceId }) => sourceId)).toContain(dead.id);

    advanceUntilStateTick(state, 48);
    expect(state.monsters.some(({ id }) => id === dead.id)).toBe(true);
    stepGame(state, EMPTY_INPUT);
    expect(state.monsters.some(({ id }) => id === dead.id)).toBe(false);
    expect(
      state.eventLog.filter(
        (event) => event.type === "monster_died" && event.targetId === dead.id,
      ),
    ).toHaveLength(1);
    expect(
      state.eventLog.filter(
        (event) => event.type === "loot_dropped" && event.sourceId === dead.id,
      ),
    ).toHaveLength(1);
  });

  it("keeps the friendly projectile observable over a long motion interval", () => {
    const state = worldFromScenario(
      BUILTIN_SCENARIOS["temporal-friendly-projectile"]!,
    );
    const start = state.projectiles[0]!.position.x;
    for (let tick = 0; tick < 60; tick += 1) stepGame(state, EMPTY_INPUT);
    expect(state.projectiles).toEqual([
      expect.objectContaining({
        id: TEMPORAL_ENTITY_IDS.friendlyProjectile,
        position: expect.objectContaining({ x: start + 60 * 96 }),
        velocity: { x: 96, y: 0 },
        hitTargets: [],
      }),
    ]);
  });

  it("tracks a friendly projectile through approach, contact, hurt, and despawn", () => {
    const contract =
      TEMPORAL_SCENARIO_CONTRACTS["temporal-friendly-projectile-impact"];
    expect(contract).toMatchObject({
      subjectId: TEMPORAL_ENTITY_IDS.friendlyImpactProjectile,
      targetId: TEMPORAL_ENTITY_IDS.friendlyImpactTarget,
      contactEventTick: 18,
      despawnStateTick: 19,
    });
    const state = worldFromScenario(
      BUILTIN_SCENARIOS["temporal-friendly-projectile-impact"]!,
    );
    const projectileId = TEMPORAL_ENTITY_IDS.friendlyImpactProjectile;
    const targetId = TEMPORAL_ENTITY_IDS.friendlyImpactTarget;
    const target = state.monsters.find(({ id }) => id === targetId)!;
    const initialHealth = target.health;

    advanceUntilStateTick(state, 18);
    const approaching = state.projectiles.find(
      ({ id }) => id === projectileId,
    )!;
    expect(approaching).toBeDefined();
    expect(target).toMatchObject({
      health: initialHealth,
      animation: { clip: "idle" },
    });
    expect(target.position.x - approaching.position.x).toBe(640);
    expect(
      state.eventLog.some(
        (event) => event.type === "damage" && event.targetId === targetId,
      ),
    ).toBe(false);

    stepGame(state, EMPTY_INPUT);
    expect(state.tick).toBe(19);
    expect(state.projectiles.some(({ id }) => id === projectileId)).toBe(false);
    expect(target).toMatchObject({
      health: initialHealth - 15,
      animation: { clip: "hurt", startedAtTick: 18, lockedUntilTick: 30 },
    });
    expect(state.effects).toEqual([
      expect.objectContaining({
        kind: "impact",
        position: target.position,
        startedAtTick: 18,
        expiresAtTick: 26,
      }),
    ]);
    expect(
      state.eventLog.filter(
        (event) => event.type === "damage" && event.targetId === targetId,
      ),
    ).toEqual([
      expect.objectContaining({
        tick: 18,
        sourceId: "player",
        amount: 15,
      }),
    ]);
    expect(
      buildRenderManifest(state, {
        x: (state.player.position.x / 1024) * 48,
        y: (state.player.position.y / 1024) * 48,
        zoom: 1,
      }).drawCalls.find(({ entityId }) => entityId === targetId),
    ).toMatchObject({ clip: "hurt" });

    advanceThroughEventTick(state, 30);
    expect(state.projectiles.some(({ id }) => id === projectileId)).toBe(false);
    expect(target.animation.clip).toBe("idle");
    expect(
      state.eventLog.filter(
        (event) => event.type === "damage" && event.targetId === targetId,
      ),
    ).toHaveLength(1);
  });

  it("advances loot animation frames without moving or collecting the loot", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["temporal-loot-bob"]!);
    const camera = {
      x: (state.player.position.x / 1024) * 48,
      y: (state.player.position.y / 1024) * 48,
      zoom: 1,
    };
    const initialPositions = state.loot.map(({ position }) => ({
      ...position,
    }));
    const frameAtZero = buildRenderManifest(state, camera).drawCalls.find(
      ({ entityId }) => entityId === TEMPORAL_ENTITY_IDS.goldLoot,
    )!.frameIndex;
    advanceUntilStateTick(state, 12);
    const frameAtTwelve = buildRenderManifest(state, camera).drawCalls.find(
      ({ entityId }) => entityId === TEMPORAL_ENTITY_IDS.goldLoot,
    )!.frameIndex;
    expect(frameAtTwelve).toBe((frameAtZero + 1) % 4);
    expect(state.loot.map(({ position }) => position)).toEqual(
      initialPositions,
    );
    expect(state.loot).toHaveLength(3);
    advanceUntilStateTick(state, 48);
    const looped = buildRenderManifest(state, camera).drawCalls.find(
      ({ entityId }) => entityId === TEMPORAL_ENTITY_IDS.goldLoot,
    )!;
    expect(looped).toMatchObject({
      frameIndex: frameAtZero,
      frameCount: 4,
      clipDurationTicks: 48,
      visualPhase: 0,
    });
  });

  it("declares a projectile as continuous motion rather than fake sprite frames", () => {
    const state = worldFromScenario(
      BUILTIN_SCENARIOS["temporal-friendly-projectile"]!,
    );
    const projectile = buildRenderManifest(state, {
      x: 0,
      y: 0,
      zoom: 1,
    }).drawCalls.find(
      ({ entityId }) => entityId === TEMPORAL_ENTITY_IDS.friendlyProjectile,
    );
    expect(projectile).toMatchObject({
      clip: "projectile",
      frameIndex: 0,
      frameCount: 1,
      visualPhase: 0,
    });
  });

  it("provides a distant smooth-camera target with a declared initial center", () => {
    const scenario = BUILTIN_SCENARIOS["temporal-camera-track"]!;
    expect(scenario.camera).toEqual({ mode: "smooth", centerTile: [4, 6] });
    expect(scenario.settings?.cameraFollow).toBe(true);
    expect(scenario.player?.tile?.[0]).toBeGreaterThan(20);
    expect(worldFromScenario(scenario).scenarioId).toBe(
      "temporal-camera-track",
    );
  });

  it("wins at the unlocked exit and loses at an injected lethal contact", () => {
    const won = worldFromScenario(BUILTIN_SCENARIOS["temporal-run-win"]!);
    stepGame(won, EMPTY_INPUT);
    expect(won.phase).toBe("won");
    expect(won.eventLog.filter(({ type }) => type === "run_won")).toEqual([
      expect.objectContaining({ tick: 0, sourceId: "player" }),
    ]);

    const lost = worldFromScenario(BUILTIN_SCENARIOS["temporal-run-loss"]!);
    stepGame(lost, EMPTY_INPUT);
    expect(lost.phase).toBe("lost");
    expect(lost.player).toMatchObject({
      health: 0,
      animation: { clip: "death", startedAtTick: 0, lockedUntilTick: 48 },
    });
    expect(lost.eventLog.filter(({ type }) => type === "player_died")).toEqual([
      expect.objectContaining({
        tick: 0,
        sourceId: TEMPORAL_ENTITY_IDS.lossAttacker,
      }),
    ]);
    const frozenMonsterPosition = { ...lost.monsters[0]!.position };
    for (let tick = 0; tick < 12; tick += 1) stepGame(lost, EMPTY_INPUT);
    expect(lost.monsters[0]!.position).toEqual(frozenMonsterPosition);
    expect(
      lost.eventLog.filter(({ type }) => type === "player_died"),
    ).toHaveLength(1);
  });
});
