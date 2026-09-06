import { describe, expect, it } from "vitest";
import { CITY_GATE_ID } from "../../src/game/city";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  cityNpcWorldAnchor,
  createEmbercrossMap,
  wildernessCityLandmarkAnchor,
} from "../../src/game/cityWorld";
import { tileCenter } from "../../src/game/dungeon";
import {
  MISSION_VOICE_LINES,
  missionArchive,
  missionJournal,
  missionLandmarks,
  missionNpcDialogue,
} from "../../src/game/missions";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type GameState } from "../../src/game/types";
import { canonicalJson } from "../../src/testkit/canonical";
import { worldFromScenario } from "../../src/testkit/scenarios";
import { stateFromSnapshot } from "../../src/testkit/stateSnapshots";

function road(): GameState {
  return worldFromScenario({
    schemaVersion: 1,
    id: "mission-road",
    seed: "last-bell",
    classId: "vanguard",
    map: {
      mode: "explicit",
      rows: [
        "##############",
        "#............#",
        "#............#",
        "#.P........E.#",
        "#............#",
        "#............#",
        "##############",
      ],
    },
    monsters: [
      { id: "monster:00", kind: "stonekin", tile: [4, 3] },
      { id: "monster:01", kind: "ashfang", tile: [6, 3] },
      { id: "monster:11", kind: "stonekin", tile: [9, 3], elite: true },
    ],
    settings: { ai: false },
  });
}

function kill(state: GameState, id: string): void {
  state.monsters.find((monster) => monster.id === id)!.health = 0;
  stepGame(state, EMPTY_INPUT);
}

describe("The Last Bell mission progression", () => {
  it("gives an immediate objective and points to a live threat in world units", () => {
    const state = road();
    const journal = missionJournal(state);
    expect(journal.chapter).toBe("The Last Bell");
    expect(journal.activeId).toBe("break-ambush");
    expect(journal.objectives[0]).toMatchObject({
      current: 0,
      total: 2,
      complete: false,
    });
    expect(journal.cue).toMatchObject({
      id: "monster:00",
      kind: "enemy",
      position: tileCenter({ x: 4, y: 3 }),
    });
  });

  it("requires actual opening deaths and does not infer kills from missing IDs", () => {
    const state = road();
    kill(state, "monster:11");
    expect(missionJournal(state).objectives[0]!.current).toBe(0);
    state.monsters = state.monsters.filter(
      (monster) => monster.id !== "monster:00",
    );
    expect(missionJournal(state).objectives[0]!.current).toBe(0);
    kill(state, "monster:01");
    // Explicit complete-world state advances the arc even in a reduced fixture.
    expect(state.exitUnlocked).toBe(true);
    expect(missionJournal(state).activeId).toBe("carry-warning");
  });

  it("retains progress after corpse despawn and exact snapshot restore", () => {
    const state = road();
    kill(state, "monster:00");
    kill(state, "monster:01");
    for (let tick = 0; tick < 60; tick += 1) stepGame(state, EMPTY_INPUT);
    expect(state.monsters.map((monster) => monster.id)).toEqual(["monster:11"]);
    const journal = missionJournal(state);
    expect(journal.activeId).toBe("silence-bell");
    expect(journal.objectives[1]).toMatchObject({
      current: 2,
      total: 3,
      complete: false,
    });
    expect(journal.cue).toMatchObject({
      id: "monster:11",
      title: "The Bell Keeper",
    });
    expect(
      missionJournal(stateFromSnapshot(JSON.parse(canonicalJson(state)))),
    ).toEqual(journal);
  });

  it("changes from the road sign to the gate after discovery", () => {
    const state = road();
    for (const id of ["monster:00", "monster:01", "monster:11"])
      kill(state, id);
    expect(missionJournal(state)).toMatchObject({
      activeId: "carry-warning",
      cue: {
        id: CITY_DISCOVERY_LANDMARK_ID,
        kind: "sign",
        position: wildernessCityLandmarkAnchor(state.map),
      },
    });
    state.city.locationPhase = "discovered";
    expect(missionJournal(state).cue).toMatchObject({
      id: "exit:rift-gate",
      kind: "gate",
      position: tileCenter(state.map.exit),
    });
  });

  it("offers optional town services without blocking the reachable ending", () => {
    const state = road();
    state.map = createEmbercrossMap();
    state.monsters = [];
    state.exitUnlocked = true;
    state.city.locationPhase = "inside";
    state.player.gold = 0;
    const journal = missionJournal(state);
    expect(journal.activeId).toBe("seal-night");
    expect(journal.cue.id).toBe(CITY_GATE_ID);
    expect(
      journal.objectives.slice(0, 3).every(({ complete }) => complete),
    ).toBe(true);
    expect(journal.objectives[3]!.complete).toBe(false);
    state.player.position = tileCenter(state.map.exit);
    stepGame(state, EMPTY_INPUT);
    expect(state.phase).toBe("won");
    expect(
      missionJournal(state).objectives.every(({ complete }) => complete),
    ).toBe(true);
    expect(missionJournal(state).ending).toBe(
      MISSION_VOICE_LINES["quest:complete"],
    );
  });

  it("keeps an unfinished mission on defeat and explains recovery", () => {
    const state = road();
    state.phase = "lost";
    expect(
      missionJournal(state).objectives.some(({ complete }) => !complete),
    ).toBe(true);
    expect(missionJournal(state).ending).toContain("saved journey");
  });
});

describe("mission directions and dialogue", () => {
  it("retains read wilderness entries in town and excludes positions from the archive", () => {
    const state = road();
    const readIds = ["scroll:ileya:warning", CITY_DISCOVERY_LANDMARK_ID];
    const before = missionArchive(state, readIds);
    state.map = createEmbercrossMap();
    const after = missionArchive(state, [...readIds, readIds[0]!, "unknown"]);
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
    expect(after.every((reading) => !("position" in reading))).toBe(true);
    state.phase = "won";
    const withResident = missionArchive(
      state,
      new Set([...readIds, "npc:embercross:ileya"]),
    );
    expect(withResident).toHaveLength(3);
    expect(withResident[2]!.text).toContain("ward holds");
    expect(missionArchive(state, [])).toEqual([]);
  });
  it("places the arrival letter and sign on existing authoritative anchors", () => {
    const state = road();
    const cues = missionLandmarks(state);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      id: "scroll:ileya:warning",
      kind: "scroll",
      position: tileCenter(state.map.spawn),
      voiceId: "quest:arrival",
    });
    expect(cues[1]!.position).toEqual(wildernessCityLandmarkAnchor(state.map));
    expect(cues[0]!.text).toContain("Click clear ground");
  });

  it("ties every town clue to a resident and includes concrete exit and save cues", () => {
    const state = road();
    state.map = createEmbercrossMap();
    const cues = missionLandmarks(state);
    expect(cues).toHaveLength(4);
    expect(cues.every(({ kind }) => kind === "npc")).toBe(true);
    const ileya = missionNpcDialogue("npc:embercross:ileya", state);
    expect(ileya.position).toEqual(cityNpcWorldAnchor("npc:embercross:ileya"));
    expect(ileya.text).toContain("south gate");
    expect(missionNpcDialogue("npc:embercross:tess", state).text).toContain(
      "save your journey",
    );
    expect(
      cues
        .filter(({ voiceId }) => voiceId)
        .every(({ voiceId }) => voiceId! in MISSION_VOICE_LINES),
    ).toBe(true);
  });

  it("is pure, deterministic, and does not expose mutable actor positions", () => {
    const state = road();
    const before = canonicalJson(state);
    const journal = missionJournal(state);
    expect(missionJournal(state)).toEqual(journal);
    missionLandmarks(state);
    journal.cue.position.x += 100;
    expect(canonicalJson(state)).toBe(before);
  });

  it("breaks equal-distance threat ties by stable ID regardless of array order", () => {
    const state = road();
    state.monsters[1]!.position = { ...state.monsters[0]!.position };
    state.monsters.reverse();
    expect(missionJournal(state).cue.id).toBe("monster:00");
  });
});
