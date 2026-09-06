import { describe, expect, it } from "vitest";
import { UNITS_PER_TILE } from "../../src/game/constants";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type GameState } from "../../src/game/types";
import {
  worldFromScenario,
  type ScenarioMonsterV1,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

function arenaRows(withWall = false): string[] {
  return Array.from({ length: 10 }, (_, y) => {
    if (y === 0 || y === 9) return "####################";
    const row: string[] = Array.from({ length: 20 }, (_, x) =>
      x === 0 || x === 19 ? "#" : ".",
    );
    if (y === 4) {
      row[4] = "P";
      row[18] = "E";
      if (withWall) row[5] = "#";
    }
    return row.join("");
  });
}

function boss(tile: [number, number] = [6, 4]): ScenarioMonsterV1 {
  return {
    id: "monster:bell-keeper",
    kind: "stonekin",
    tile,
    health: 1_000,
    maxHealth: 1_000,
    armor: 0,
    attackDamage: 20,
    attackReadyTick: 0,
    elite: true,
  };
}

function scenario(id: string, patch: Partial<ScenarioV1> = {}): ScenarioV1 {
  return {
    schemaVersion: 1,
    id,
    seed: `bell-keeper:${id}`,
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows() },
    player: { tile: [4, 4], health: 1_000, maxHealth: 1_000, armor: 0 },
    monsters: [boss()],
    settings: { ai: true, autoPickup: false, cameraFollow: false },
    ...patch,
  };
}

function scheduledBoss(patch: Partial<ScenarioV1> = {}): {
  state: GameState;
  attack: GameState["pendingAttacks"][number];
} {
  const state = worldFromScenario(scenario("scheduled", patch));
  stepGame(state, EMPTY_INPUT);
  const attack = state.pendingAttacks.find(
    ({ ownerId }) => ownerId === "monster:bell-keeper",
  );
  if (!attack) throw new Error("Bell Keeper did not schedule an attack");
  return { state, attack };
}

function stepAt(
  state: GameState,
  tick: number,
  input: typeof EMPTY_INPUT = EMPTY_INPUT,
): void {
  while (state.tick < tick) stepGame(state, EMPTY_INPUT);
  expect(state.tick).toBe(tick);
  stepGame(state, input);
}

function distance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pendingAbilityScenario(
  withWall = false,
  ownerHealth = 1_000,
): GameState {
  return worldFromScenario(
    scenario("pending-ability", {
      map: { mode: "explicit", rows: arenaRows(withWall) },
      settings: { ai: false, autoPickup: false, cameraFollow: false },
      monsters: [
        {
          ...boss(),
          health: ownerHealth,
          attackReadyTick: 10_000,
        },
      ],
      pendingAttacks: [
        {
          id: "attack:bell-keeper:ability",
          ownerId: "monster:bell-keeper",
          kind: "ability",
          impactTick: 0,
          originTile: [6, 4],
          direction: [-1024, 0],
          range: 2 * UNITS_PER_TILE,
          damage: 20,
        },
      ],
    }),
  );
}

describe("Bell Keeper committed radial slam", () => {
  it("commits an ability attack with a fixed origin and 72-tick lock", () => {
    const { state, attack } = scheduledBoss();
    const monster = state.monsters[0]!;

    expect(attack).toMatchObject({
      kind: "ability",
      impactTick: 48,
      range: 2 * UNITS_PER_TILE,
      damage: 20,
      origin: monster.position,
    });
    expect(monster.animation).toEqual({
      clip: "ability",
      startedAtTick: 0,
      lockedUntilTick: 72,
    });
    expect(monster.attackReadyTick).toBe(132);
  });

  it("does not damage one tick early, then damages an in-radius player once", () => {
    const { state, attack } = scheduledBoss();
    const startingHealth = state.player.health;

    while (state.tick < attack.impactTick!) stepGame(state, EMPTY_INPUT);
    expect(state.player.health).toBe(startingHealth);
    expect(state.pendingAttacks).toHaveLength(1);

    stepGame(state, EMPTY_INPUT);
    expect(state.player.health).toBe(startingHealth - attack.damage);
    expect(state.pendingAttacks).toHaveLength(0);
    for (let index = 0; index < 8; index += 1) stepGame(state, EMPTY_INPUT);
    expect(
      state.eventLog.filter(
        ({ type, targetId }) =>
          type === "player_damaged" && targetId === "player",
      ),
    ).toHaveLength(1);
  });

  it("lets normal movement escape beyond the stored radius", () => {
    const { state, attack } = scheduledBoss();
    const startingHealth = state.player.health;

    while (state.tick < attack.impactTick!)
      stepGame(state, { ...EMPTY_INPUT, moveX: -1 });
    expect(distance(state.player.position, attack.origin)).toBeGreaterThan(
      attack.range,
    );
    stepGame(state, EMPTY_INPUT);

    expect(state.player.health).toBe(startingHealth);
  });

  it("blocks a radial slam through a solid wall", () => {
    const state = pendingAbilityScenario(true);
    const startingHealth = state.player.health;

    stepGame(state, EMPTY_INPUT);

    expect(state.player.health).toBe(startingHealth);
    expect(state.eventLog.some(({ type }) => type === "player_damaged")).toBe(
      false,
    );
  });

  it("cancels a committed impact when its owner dies", () => {
    const state = pendingAbilityScenario(false, 0);
    const startingHealth = state.player.health;

    stepGame(state, EMPTY_INPUT);

    expect(state.player.health).toBe(startingHealth);
    expect(state.pendingAttacks).toHaveLength(0);
  });

  it("keeps the committed lock after a player hit during recovery", () => {
    const { state } = scheduledBoss({
      monsters: [{ ...boss([5.25, 4]), health: 1_000, maxHealth: 1_000 }],
    });
    const monster = state.monsters[0]!;

    stepAt(state, 50, { ...EMPTY_INPUT, attack: true });
    while (state.tick <= 58) stepGame(state, EMPTY_INPUT);

    expect(monster.animation).toEqual({
      clip: "ability",
      startedAtTick: 0,
      lockedUntilTick: 72,
    });
    expect(monster.position).toEqual(monster.previousPosition);
    expect(state.pendingAttacks.some(({ kind }) => kind === "ability")).toBe(
      false,
    );
  });

  it("does not move or attack again during recovery, then resumes afterward", () => {
    const { state, attack } = scheduledBoss();
    const monster = state.monsters[0]!;
    const committedPosition = { ...monster.position };

    while (state.tick < attack.impactTick! + 24) stepGame(state, EMPTY_INPUT);
    expect(state.tick).toBe(72);
    expect(monster.position).toEqual(committedPosition);
    expect(state.pendingAttacks).toHaveLength(0);
    expect(monster.animation.clip).toBe("ability");

    stepGame(state, EMPTY_INPUT);
    expect(state.pendingAttacks).toHaveLength(0);

    while (state.tick < 132) stepGame(state, EMPTY_INPUT);
    stepGame(state, EMPTY_INPUT);
    expect(
      state.pendingAttacks.some(
        ({ ownerId, kind }) =>
          ownerId === "monster:bell-keeper" && kind === "ability",
      ),
    ).toBe(true);
  });

  it("keeps the scheduled cooldown after health crosses half", () => {
    const { state } = scheduledBoss();
    const monster = state.monsters[0]!;
    monster.health = 400;

    while (state.tick < 96) stepGame(state, EMPTY_INPUT);
    expect(monster.attackReadyTick).toBe(132);
    expect(state.pendingAttacks).toHaveLength(0);

    stepAt(state, 132);
    expect(monster.attackReadyTick).toBe(228);
    expect(state.pendingAttacks[0]).toMatchObject({
      kind: "ability",
      impactTick: 180,
    });
  });

  it("keeps ordinary Stonekin attacks primary and unchanged", () => {
    const state = worldFromScenario(
      scenario("ordinary-stonekin", {
        monsters: [
          {
            id: "monster:ordinary-stonekin",
            kind: "stonekin",
            tile: [5, 4],
            health: 1_000,
            maxHealth: 1_000,
            armor: 0,
            attackDamage: 11,
            attackReadyTick: 0,
          },
        ],
      }),
    );

    stepGame(state, EMPTY_INPUT);

    expect(state.pendingAttacks[0]).toMatchObject({
      kind: "primary",
      impactTick: 10,
      range: 1050,
      damage: 11,
    });
    expect(state.monsters[0]!.animation).toMatchObject({
      clip: "attack",
      lockedUntilTick: 26,
    });
  });

  it("uses a separation-displaced owner without moving the damage origin", () => {
    const state = worldFromScenario(
      scenario("separation-origin", {
        monsters: [
          boss([5.5, 4]),
          {
            id: "monster:blocker",
            kind: "ashfang",
            tile: [5.5, 4],
            moveSpeed: 0,
            attackRange: 100_000,
            attackReadyTick: 10_000,
          },
        ],
      }),
    );
    stepGame(state, EMPTY_INPUT);
    const attack = state.pendingAttacks.find(
      ({ ownerId }) => ownerId === "monster:bell-keeper",
    )!;
    const monster = state.monsters.find(
      ({ id }) => id === "monster:bell-keeper",
    )!;
    expect(monster.position).not.toEqual(attack.origin);

    while (state.tick < attack.impactTick) stepGame(state, EMPTY_INPUT);
    stepGame(state, EMPTY_INPUT);

    expect(state.player.health).toBe(980);
    expect(attack.origin).not.toEqual(monster.position);
  });
});
