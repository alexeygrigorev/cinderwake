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
  worldFromScenario,
  createRunScenario,
} from "../../src/testkit/scenarios";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { stateHash } from "../../src/testkit/canonical";

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
describe("portable campaign checkpoints", () => {
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
