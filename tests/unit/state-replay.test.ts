import { describe, expect, it } from "vitest";
import {
  evaluateStateReplayEvidence,
  hashJson,
  stableJson,
} from "../../scripts/lib/state-replay-evidence.mjs";

function evidenceFixture() {
  const initialState = { tick: 0, player: { position: { x: 12, y: 24 } } };
  const ticks = [0, 5, 10];
  const capture = (tick: number) => ({
    tick,
    stateTick: tick,
    manifestTick: tick,
    snapshot: {
      tick,
      player: { position: { ...initialState.player.position } },
    },
    stateHash: `state-${tick}`,
    manifestHash: `manifest-${tick}`,
    frameHash: `frame-${tick}`,
  });
  return {
    initialState,
    initialStateHash: "state-0",
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
