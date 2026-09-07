import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  loadSave,
  storeSave,
  SAVE_KEY,
  AUTO_SAVE_KEY,
  safeToAutosave,
} from "../../src/app/saveGame";
import {
  createRunScenario,
  type ScenarioV1,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type GameState } from "../../src/game/types";
import { stateHash } from "../../src/testkit/canonical";
import historicalSave from "../fixtures/saves/pre-bell-keeper-profile.v1.json";

const state = () =>
  worldFromScenario(createRunScenario("cinder-041", "vanguard"));
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function bellKeeperScenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: "bell-keeper-save-replay",
    seed: "bell-keeper-save-replay",
    classId: "vanguard",
    map: {
      mode: "explicit",
      rows: [
        "####################",
        "#..................#",
        "#..................#",
        "#...P.............E#",
        "#..................#",
        "####################",
      ],
    },
    player: { tile: [4, 3], health: 1_000, maxHealth: 1_000, armor: 0 },
    monsters: [
      {
        id: "monster:bell-keeper",
        kind: "stonekin",
        tile: [6, 3],
        health: 1_000,
        maxHealth: 1_000,
        armor: 0,
        attackDamage: 20,
        attackReadyTick: 0,
        elite: true,
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: false },
  };
}

function bellKeeperState(): GameState {
  const state = worldFromScenario(bellKeeperScenario());
  stepGame(state, EMPTY_INPUT);
  return state;
}

function advanceToTick(state: GameState, tick: number): void {
  while (state.tick < tick) stepGame(state, EMPTY_INPUT);
}

describe("portable campaign checkpoints", () => {
  it("loads the baseline v1 save and preserves its elite primary attack", () => {
    const loaded = decodeSave(JSON.stringify(historicalSave));

    expect(loaded.version).toBe(1);
    expect(loaded.state.schemaVersion).toBe(2);
    expect(loaded.discoveries).toEqual(["scroll:ileya:warning"]);
    expect(loaded.state.player.id).toBe("player");
    expect(loaded.state.pendingAttacks[0]).toMatchObject({
      ownerId: "monster:bell-keeper",
      kind: "primary",
      impactTick: 10,
    });
    expect(loaded.state.monsters[0]?.elite).toBe(true);

    const healthBeforeImpact = loaded.state.player.health;
    advanceToTick(loaded.state, 10);
    expect(loaded.state.player.health).toBe(healthBeforeImpact);
    stepGame(loaded.state, EMPTY_INPUT);
    expect(loaded.state.player.health).toBe(healthBeforeImpact - 12);
    expect(loaded.state.pendingAttacks).toEqual([]);
    expect(loaded.state.monsters[0]?.animation.clip).toBe("attack");
  });

  it.each([20, 48, 60])(
    "continues an exact same-version save at tick %i",
    (checkpointTick) => {
      const original = bellKeeperState();
      advanceToTick(original, checkpointTick);
      const restored = decodeSave(
        encodeSave(original, ["scroll:ileya:warning"], checkpointTick),
      );

      expect(restored.version).toBe(1);
      expect(restored.state.schemaVersion).toBe(2);
      expect(restored.state.tick).toBe(checkpointTick);
      expect(stateHash(restored.state)).toBe(stateHash(original));
      for (let tick = 0; tick < 90; tick += 1) {
        stepGame(original, EMPTY_INPUT);
        stepGame(restored.state, EMPTY_INPUT);
      }
      expect(stateHash(restored.state)).toBe(stateHash(original));
    },
  );

  it("restores exact simulation and discoveries, then produces the same future", () => {
    const original = state();
    for (let tick = 0; tick < 40; tick++)
      stepGame(original, { ...EMPTY_INPUT, attack: true });
    const restored = decodeSave(
      encodeSave(original, ["scroll:ileya:warning"], 123),
    );
    expect(restored.savedAt).toBe(123);
    expect(restored.discoveries).toEqual(["scroll:ileya:warning"]);
    expect(stateHash(restored.state)).toBe(stateHash(original));
    for (let tick = 0; tick < 100; tick++) {
      stepGame(original, { ...EMPTY_INPUT, attack: true, ability: true });
      stepGame(restored.state, { ...EMPTY_INPUT, attack: true, ability: true });
    }
    expect(stateHash(restored.state)).toBe(stateHash(original));
  });
  it("rejects corruption, invalid state, future schemas, and oversized imports", () => {
    const valid = encodeSave(state(), [], 123);
    const corrupted = JSON.parse(valid);
    corrupted.state.player.gold += 1;
    expect(() => decodeSave(JSON.stringify(corrupted))).toThrow(/checksum/i);
    expect(() =>
      decodeSave(valid.replace('"version":1', '"version":99')),
    ).toThrow(/version/i);
    expect(() => decodeSave("{")).toThrow();
    expect(() => decodeSave(" ".repeat(4_194_305))).toThrow(/large/i);
    expect(() => encodeSave({ ...state(), tick: -1 }, [])).toThrow();
  });
  it("keeps the manual checkpoint independent of autosave and reports denied storage", () => {
    const disk = storage();
    const original = state();
    storeSave(disk, original, [], "manual", 1);
    const manual = disk.getItem(SAVE_KEY);
    stepGame(original, EMPTY_INPUT);
    storeSave(disk, original, [], "auto", 2);
    expect(disk.getItem(SAVE_KEY)).toBe(manual);
    expect(disk.getItem(AUTO_SAVE_KEY)).not.toBeNull();
    expect(loadSave(disk)?.savedAt).toBe(2);
    expect(() =>
      storeSave(
        {
          ...disk,
          setItem: () => {
            throw new Error("quota");
          },
        },
        original,
        [],
      ),
    ).toThrow("quota");
  });
  it("falls back to a good checkpoint without silently accepting corruption", () => {
    const disk = storage();
    storeSave(disk, state(), [], "manual", 1);
    disk.setItem(AUTO_SAVE_KEY, "broken");
    expect(loadSave(disk)?.savedAt).toBe(1);
  });
  it("preserves the previous checkpoint if its replacement cannot be written", () => {
    const disk = storage();
    storeSave(disk, state(), [], "manual", 1);
    const previous = disk.getItem(SAVE_KEY);
    expect(() =>
      storeSave(
        {
          ...disk,
          setItem: () => {
            throw new Error("Storage full");
          },
        },
        state(),
        ["scroll:ileya:warning"],
        "manual",
        2,
      ),
    ).toThrow("Storage full");
    expect(disk.getItem(SAVE_KEY)).toBe(previous);
    expect(loadSave(disk, "manual")?.savedAt).toBe(1);
  });
  it("preserves victory even when the final fight ended at low health", () => {
    const completed = state();
    completed.phase = "won";
    completed.player.health = 1;
    expect(safeToAutosave(completed)).toBe(true);
    const disk = storage();
    storeSave(disk, completed, [], "auto", 3);
    expect(loadSave(disk)?.state.phase).toBe("won");
  });
  it("never autosaves dead, endangered or low-health characters", () => {
    const world = state();
    world.monsters = [];
    expect(safeToAutosave(world)).toBe(true);
    world.player.health = 1;
    expect(safeToAutosave(world)).toBe(false);
    world.player.health = world.player.maxHealth;
    world.phase = "lost";
    expect(safeToAutosave(world)).toBe(false);
    const threatened = state();
    threatened.monsters[0]!.position = { ...threatened.player.position };
    expect(safeToAutosave(threatened)).toBe(false);
  });
});
