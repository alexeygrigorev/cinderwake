import { describe, expect, it } from "vitest";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  createInitialCityState,
  transitionCityProgression,
} from "../../src/game/city";
import { isEmbercrossMap } from "../../src/game/cityWorld";
import { CLIP_DURATIONS } from "../../src/game/constants";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type CharacterClass } from "../../src/game/types";
import { actorFrame, buildRenderManifest } from "../../src/render/manifest";
import { playReplay } from "../../src/testkit/replay";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

const arena = (
  BUILTIN_SCENARIOS["animation-idle"]!.map as {
    mode: "explicit";
    rows: string[];
  }
).rows;

function scenario(
  id: string,
  classId: CharacterClass = "vanguard",
  patch: Partial<ScenarioV1> = {},
): ScenarioV1 {
  return {
    schemaVersion: 1,
    id,
    seed: `seed:${id}`,
    classId,
    map: { mode: "explicit", rows: arena },
    player: { tile: [9, 7], facing: [1024, 0] },
    monsters: [],
    settings: { ai: false, autoPickup: false, cameraFollow: true },
    ...patch,
  };
}

function processThroughTick(
  state: ReturnType<typeof worldFromScenario>,
  tick: number,
): void {
  while (state.tick <= tick) stepGame(state, EMPTY_INPUT);
}

describe("combat and lifecycle contracts", () => {
  it.each([
    ["vanguard", "primary", 8, 18, 2, "effect"],
    ["vanguard", "ability", 12, 32, 2, "effect"],
    ["ranger", "primary", 6, 13, 1, "projectile"],
    ["ranger", "ability", 10, 21, 3, "projectile"],
    ["arcanist", "primary", 8, 15, 1, "projectile"],
    ["arcanist", "ability", 12, 28, 2, "effect"],
  ] as const)(
    "%s %s resolves on its declared contact tick",
    (classId, kind, delay, damage, spawnedCount, output) => {
      const state = worldFromScenario(
        scenario(`${classId}-${kind}`, classId, {
          player: { tile: [9, 7], facing: [1024, 0] },
          monsters: [
            {
              id: "monster:target",
              kind: "stonekin",
              tile: [10.2, 7],
              health: 1000,
              maxHealth: 1000,
              armor: 0,
            },
          ],
        }),
      );
      stepGame(state, {
        ...EMPTY_INPUT,
        attack: kind === "primary",
        ability: kind === "ability",
      });
      expect(state.pendingAttacks).toHaveLength(1);
      expect(state.pendingAttacks[0]?.impactTick).toBe(delay);
      const startingHealth = state.monsters[0]!.health;
      while (state.tick < delay) stepGame(state, EMPTY_INPUT);
      expect(state.monsters[0]!.health).toBe(startingHealth);
      processThroughTick(state, delay);

      if (output === "projectile") {
        expect(state.projectiles).toHaveLength(spawnedCount);
        expect(
          state.projectiles.every((item) => item.spawnedAtTick === delay),
        ).toBe(true);
        expect(
          state.projectiles.every(
            (item) =>
              item.position.x === item.previousPosition.x &&
              item.position.y === item.previousPosition.y,
          ),
        ).toBe(true);
      } else {
        expect(state.effects).toHaveLength(spawnedCount);
        expect(state.monsters[0]!.health).toBe(startingHealth - damage);
      }
    },
  );

  it.each([
    ["ashfang", 7],
    ["stonekin", 10],
    ["hexer", 12],
  ] as const)("%s separates wind-up from contact", (kind, impactDelay) => {
    const state = worldFromScenario(
      scenario(`enemy-windup-${kind}`, "vanguard", {
        monsters: [
          {
            id: "monster:attacker",
            kind,
            tile: kind === "hexer" ? [13, 7] : [9.7, 7],
          },
        ],
        settings: { ai: true, autoPickup: false, cameraFollow: true },
      }),
    );
    const startHealth = state.player.health;
    stepGame(state, EMPTY_INPUT);
    expect(state.monsters[0]!.animation).toMatchObject({
      clip: "attack",
      startedAtTick: 0,
      lockedUntilTick: CLIP_DURATIONS.attack,
    });
    expect(state.pendingAttacks[0]?.impactTick).toBe(impactDelay);
    expect(state.player.health).toBe(startHealth);
    while (state.tick < impactDelay) stepGame(state, EMPTY_INPUT);
    expect(state.player.health).toBe(startHealth);
    processThroughTick(state, impactDelay);
    if (kind === "hexer") {
      expect(state.player.health).toBe(startHealth);
      expect(state.projectiles).toHaveLength(1);
      expect(state.projectiles[0]).toMatchObject({
        hostile: true,
        spawnedAtTick: impactDelay,
      });
    } else {
      expect(state.player.health).toBeLessThan(startHealth);
    }
  });

  it("retains a dying monster through its terminal frame and resolves rewards once", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["combat-loot"]!);
    stepGame(state, { ...EMPTY_INPUT, attack: true });
    processThroughTick(state, 8);
    expect(state.monsters).toHaveLength(1);
    expect(state.monsters[0]).toMatchObject({
      health: expect.any(Number),
      deathTick: 8,
      removeAtTick: 8 + CLIP_DURATIONS.death,
      animation: { clip: "death", startedAtTick: 8 },
    });
    expect(state.monsters[0]!.health).toBeLessThanOrEqual(0);
    expect(state.metrics.kills).toBe(1);
    expect(state.loot).toHaveLength(1);

    while (state.tick < 8 + CLIP_DURATIONS.death) stepGame(state, EMPTY_INPUT);
    const terminal = buildRenderManifest(state, {
      x: (state.player.position.x / 1024) * 48,
      y: (state.player.position.y / 1024) * 48,
      zoom: 1,
    }).drawCalls.find((call) => call.entityId === "monster:target");
    expect(terminal).toMatchObject({
      clip: "death",
      frameIndex: 7,
    });
    stepGame(state, EMPTY_INPUT);
    expect(state.monsters).toHaveLength(0);
    expect(state.metrics.kills).toBe(1);
    expect(state.loot).toHaveLength(1);
    expect(
      state.eventLog.filter((event) => event.type === "monster_died"),
    ).toHaveLength(1);
  });

  it("a piercing projectile damages each target at most once", () => {
    const state = worldFromScenario(
      scenario("pierce-unique-target", "ranger", {
        monsters: [
          {
            id: "monster:durable",
            kind: "stonekin",
            tile: [10, 7],
            health: 100,
            maxHealth: 100,
            armor: 0,
          },
        ],
        projectiles: [
          {
            id: "projectile:piercing",
            owner: "player",
            hostile: false,
            tile: [10, 7],
            velocity: [10, 0],
            radius: 155,
            damage: 10,
            expiresAtTick: 100,
            pierce: 2,
          },
        ],
      }),
    );
    for (let index = 0; index < 4; index += 1) stepGame(state, EMPTY_INPUT);
    expect(state.monsters[0]!.health).toBe(90);
    expect(state.projectiles[0]!.hitTargets).toEqual(["monster:durable"]);
    expect(
      state.eventLog.filter(
        (event) =>
          event.type === "damage" && event.targetId === "monster:durable",
      ),
    ).toHaveLength(1);
  });

  it("later same-tick projectiles skip an already lethal target", () => {
    const state = worldFromScenario(
      scenario("simultaneous-lethal-projectiles", "ranger", {
        monsters: [
          {
            id: "monster:fragile",
            kind: "ashfang",
            tile: [10, 7],
            health: 5,
            maxHealth: 5,
          },
        ],
        projectiles: [
          {
            id: "projectile:01",
            owner: "player",
            hostile: false,
            tile: [10, 7],
            velocity: [0, 0],
            damage: 10,
            expiresAtTick: 100,
          },
          {
            id: "projectile:02",
            owner: "player",
            hostile: false,
            tile: [10, 7],
            velocity: [0, 0],
            damage: 10,
            expiresAtTick: 100,
          },
        ],
      }),
    );
    stepGame(state, EMPTY_INPUT);
    expect(state.metrics.damageDealt).toBe(10);
    expect(
      state.eventLog.filter(
        (event) =>
          event.type === "damage" && event.targetId === "monster:fragile",
      ),
    ).toHaveLength(1);
    expect(state.projectiles.map((item) => item.id)).toEqual(["projectile:02"]);
  });

  it("handles pickup, loss, and terminal freeze deterministically", () => {
    const pickup = worldFromScenario(
      scenario("pickup-all-kinds", "arcanist", {
        player: { tile: [9, 7], health: 40, tonics: 0 },
        loot: [
          { id: "loot:gold", kind: "gold", tile: [9, 7], amount: 6 },
          { id: "loot:tonic", kind: "tonic", tile: [9, 7], amount: 1 },
          {
            id: "loot:weapon",
            kind: "weapon",
            tile: [9, 7],
            amount: 3,
          },
        ],
        settings: { ai: false, autoPickup: true, cameraFollow: true },
      }),
    );
    stepGame(pickup, EMPTY_INPUT);
    expect(pickup.loot).toHaveLength(0);
    expect(pickup.player).toMatchObject({ gold: 6, tonics: 1, power: 3 });
    expect(pickup.metrics.lootCollected).toBe(3);

    const loss = worldFromScenario(
      scenario("hostile-lethal", "arcanist", {
        player: { tile: [9, 7], health: 1 },
        projectiles: [
          {
            id: "projectile:hostile",
            owner: "monster:gone",
            hostile: true,
            tile: [9, 7],
            velocity: [0, 0],
            damage: 99,
            expiresAtTick: 20,
          },
        ],
      }),
    );
    stepGame(loss, EMPTY_INPUT);
    expect(loss).toMatchObject({ phase: "lost", tick: 1 });
    expect(loss.player.animation.clip).toBe("death");
    const deathEvents = loss.eventLog.length;
    const frozenPosition = { ...loss.player.position };
    stepGame(loss, { ...EMPTY_INPUT, moveX: 1, attack: true });
    expect(loss.player.position).toEqual(frozenPosition);
    expect(loss.eventLog).toHaveLength(deathEvents);
  });

  it("enters a discovered city once when its unlocked gate is reached", () => {
    const discovered = transitionCityProgression(createInitialCityState(), {
      type: "discover_city",
      tick: 0,
      landmarkId: CITY_DISCOVERY_LANDMARK_ID,
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) throw new Error(discovered.message);
    const entered = worldFromScenario(
      scenario("exit-win", "vanguard", {
        player: { tile: [19, 2] },
        monsters: [],
        exitUnlocked: true,
        city: discovered.state,
      }),
    );
    stepGame(entered, EMPTY_INPUT);
    expect(entered.phase).toBe("playing");
    expect(entered.city.locationPhase).toBe("inside");
    expect(isEmbercrossMap(entered.map)).toBe(true);
    expect(
      entered.eventLog.filter((event) => event.type === "city_entered"),
    ).toHaveLength(1);
    stepGame(entered, EMPTY_INPUT);
    expect(
      entered.eventLog.filter((event) => event.type === "city_entered"),
    ).toHaveLength(1);
  });

  it("uses absolute replay ticks correctly from a mid-action snapshot", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["mid-action"]!);
    const result = playReplay(state, {
      version: 1,
      scenarioId: "mid-action",
      entries: [
        { tick: 240, input: { moveX: 1 } },
        { tick: 246, input: { moveX: 0 } },
      ],
    });
    expect(result.state.tick).toBe(247);
    expect(() =>
      playReplay(worldFromScenario(BUILTIN_SCENARIOS["mid-action"]!), {
        version: 1,
        scenarioId: "wrong-scenario",
        entries: [],
      }),
    ).toThrow("Replay scenario mismatch");
  });

  it("clamps every one-shot animation at its terminal frame", () => {
    for (const clip of ["attack", "ability", "hurt", "death"] as const) {
      expect(actorFrame(clip, CLIP_DURATIONS[clip], 0)).toBe(
        clip === "hurt" ? 3 : clip === "attack" ? 5 : 7,
      );
      expect(actorFrame(clip, CLIP_DURATIONS[clip] + 1000, 0)).toBe(
        clip === "hurt" ? 3 : clip === "attack" ? 5 : 7,
      );
    }
  });
});
