import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../../src/app/saveGame";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import {
  evaluateStateReplayEvidence,
  hashJson,
  stateHash,
  stableJson,
} from "../../scripts/lib/state-replay-evidence.mjs";
import { worldFromScenario } from "../../src/testkit/scenarios";
import { playReplay, type ReplayTapeV1 } from "../../src/testkit/replay";

function bellKeeperState() {
  const state = worldFromScenario({
    schemaVersion: 1,
    id: "bell-keeper-replay",
    seed: "bell-keeper-replay",
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
  });
  stepGame(state, EMPTY_INPUT);
  while (state.tick < 20) stepGame(state, EMPTY_INPUT);
  return state;
}

function evidenceFixture() {
  const initialState = { tick: 0, player: { position: { x: 12, y: 24 } } };
  const ticks = [0, 5, 10];
  const capture = (tick: number) => {
    const snapshot = {
      tick,
      player: { position: { ...initialState.player.position } },
    };
    const manifest = { tick, drawCalls: [{ entityId: "player" }] };
    return {
      tick,
      stateTick: tick,
      manifestTick: tick,
      snapshot,
      stateHash: stateHash(snapshot),
      manifest,
      manifestHash: hashJson(manifest),
      frameHash: `frame-${tick}`,
    };
  };
  return {
    initialState,
    initialStateHash: stateHash(initialState),
    loaded: {
      ...capture(0),
    },
    reset: {
      ...capture(0),
    },
    replayA: {
      declaredTicks: ticks,
      timeline: ticks.map(capture),
    },
    replayB: {
      declaredTicks: ticks,
      timeline: ticks.map(capture),
    },
  };
}

describe("state replay evidence evaluator", () => {
  it("replays a saved Bell Keeper wind-up exactly from the retained state", () => {
    const original = bellKeeperState();
    const restored = decodeSave(encodeSave(original, [], 20)).state;
    const tape: ReplayTapeV1 = {
      version: 1,
      scenarioId: original.scenarioId,
      entries: [
        { tick: 20, input: {} },
        { tick: 28, input: { moveX: -1 } },
        { tick: 36, input: { moveX: 0 } },
      ],
    };

    const originalReplay = playReplay(original, tape, 120);
    const restoredReplay = playReplay(restored, tape, 120);

    expect(restoredReplay.hashes).toEqual(originalReplay.hashes);
    expect(stateHash(restoredReplay.state)).toBe(
      stateHash(originalReplay.state),
    );
    expect(
      restoredReplay.state.eventLog.some(
        ({ type, sourceId }) =>
          type === "attack_started" && sourceId === "monster:bell-keeper",
      ),
    ).toBe(true);
  });

  it("canonicalizes object order before hashing", () => {
    expect(stableJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
  });

  it("accepts loaded, reset, state, manifest, frame, and tick evidence", () => {
    const result = evaluateStateReplayEvidence(evidenceFixture());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
    expect(result.timeline.synchronized).toBe(true);
  });

  it("requires replay declarations and recorded hashes to agree with evidence", () => {
    const value = evidenceFixture();
    value.replayB.declaredTicks[1] += 1;
    value.replayB.timeline[1].snapshot.player.position.x += 1;
    value.replayB.timeline[1].manifest.tick += 1;

    const result = evaluateStateReplayEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "evidence-timeline-desynchronized",
        "state-hash-integrity-failed",
        "manifest-hash-integrity-failed",
      ]),
    );
  });

  it.each([
    [
      "reset isolation",
      "reset-isolation-failed",
      (value: any) => {
        value.reset.snapshot.player.position.x += 1;
      },
    ],
    [
      "state hashes",
      "replay-state-hash-mismatch",
      (value: any) => {
        value.replayB.timeline[1].stateHash = "different-state";
      },
    ],
    [
      "frame hashes",
      "replay-frame-hash-mismatch",
      (value: any) => {
        value.replayB.timeline[1].frameHash = "different-frame";
      },
    ],
    [
      "timeline ticks",
      "evidence-timeline-desynchronized",
      (value: any) => {
        value.replayB.timeline[1].manifestTick += 1;
      },
    ],
  ])("detects %s as %s", (_name, expectedFailure, mutate) => {
    const value = evidenceFixture();
    mutate(value);

    const result = evaluateStateReplayEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });
});
