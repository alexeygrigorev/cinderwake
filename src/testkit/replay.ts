import { EMPTY_INPUT, type GameState, type InputState } from "../game/types";
import { stepGame } from "../game/simulation";
import { stateHash } from "./canonical";

export interface ReplayEntryV1 {
  tick: number;
  input: Partial<InputState>;
}

export interface ReplayTapeV1 {
  version: 1;
  scenarioId?: string;
  entries: ReplayEntryV1[];
  checkpoints?: Array<{ tick: number; hash: string }>;
}

export interface ReplayResult {
  state: GameState;
  hashes: Array<{ tick: number; hash: string }>;
}

export function inputAtTick(tape: ReplayTapeV1, tick: number): InputState {
  const patch = tape.entries
    .filter((entry) => entry.tick <= tick)
    .reduce<Partial<InputState>>(
      (current, entry) => ({ ...current, ...entry.input }),
      {},
    );
  return {
    ...EMPTY_INPUT,
    ...patch,
    aim: patch.aim === undefined ? null : patch.aim ? { ...patch.aim } : null,
  };
}

/** Plays exact engine ticks; entry tick 0 applies to the first call to stepGame. */
export function playReplay(
  initial: GameState,
  tape: ReplayTapeV1,
  ticks?: number,
): ReplayResult {
  if (tape.version !== 1)
    throw new Error(`Unsupported replay version: ${String(tape.version)}`);
  const lastEntry = tape.entries.reduce(
    (max, entry) => Math.max(max, entry.tick),
    -1,
  );
  const lastCheckpoint =
    tape.checkpoints?.reduce((max, entry) => Math.max(max, entry.tick), -1) ??
    -1;
  const count = ticks ?? Math.max(lastEntry, lastCheckpoint) + 1;
  const hashes: ReplayResult["hashes"] = [];
  for (let index = 0; index < count; index += 1) {
    stepGame(initial, inputAtTick(tape, initial.tick));
    hashes.push({ tick: initial.tick, hash: stateHash(initial) });
  }
  for (const checkpoint of tape.checkpoints ?? []) {
    const actual = hashes.find((entry) => entry.tick === checkpoint.tick)?.hash;
    if (actual !== checkpoint.hash)
      throw new Error(
        `Replay checkpoint mismatch at tick ${checkpoint.tick}: expected ${checkpoint.hash}, got ${actual ?? "missing"}`,
      );
  }
  return { state: initial, hashes };
}
