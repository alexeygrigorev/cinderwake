import {
  EMPTY_INPUT,
  type GameEvent,
  type GameState,
  type InputState,
} from "../game/types";
import type { RenderManifestV1 } from "../render/manifest";
import { canonicalState, stateHash } from "./canonical";
import {
  BUILTIN_SCENARIOS,
  validateScenario,
  worldFromScenario,
  type ScenarioV1,
} from "./scenarios";
import { stateFromSnapshot } from "./stateSnapshots";

export interface TestHost {
  getState(): GameState;
  startScenario(scenario: ScenarioV1): void;
  startState(state: GameState): void;
  setInput(input: InputState): void;
  step(ticks?: number, input?: InputState): void;
  sampleInput?(): InputState;
  render(): void;
  getManifest(): RenderManifestV1;
  getCanvas(): HTMLCanvasElement | null;
}

export interface GameTestBridge {
  ready: true;
  loadScenario(
    scenario: ScenarioV1 | string,
  ): ReturnType<typeof canonicalState>;
  loadState(state: GameState | string): ReturnType<typeof canonicalState>;
  reset(): ReturnType<typeof canonicalState>;
  setInput(input: Partial<InputState>): void;
  queueInputs(
    entries: Array<{ tick: number; input: Partial<InputState> }>,
  ): void;
  clearInput(): void;
  step(
    ticks?: number,
    options?: { render?: boolean; useBrowserInput?: boolean },
  ): ReturnType<typeof canonicalState>;
  render(): RenderManifestV1;
  snapshot(): ReturnType<typeof canonicalState>;
  stateHash(): string;
  renderManifest(): RenderManifestV1;
  drainEvents(): GameEvent[];
  captureFrame(): string;
  captureSequence(
    ticks: number[],
    options?: { render?: boolean },
  ): Array<{
    tick: number;
    snapshot: ReturnType<typeof canonicalState>;
    manifest: RenderManifestV1;
    frame: string;
  }>;
}

declare global {
  interface Window {
    __GAME_TEST__?: GameTestBridge;
  }
}

function cloneScenario(scenario: ScenarioV1): ScenarioV1 {
  return JSON.parse(JSON.stringify(scenario)) as ScenarioV1;
}

function resolveScenario(value: ScenarioV1 | string): ScenarioV1 {
  if (typeof value === "string") {
    const builtin = BUILTIN_SCENARIOS[value];
    if (builtin) return cloneScenario(builtin);
    const parsed: unknown = JSON.parse(value);
    validateScenario(parsed);
    return cloneScenario(parsed);
  }
  validateScenario(value);
  return cloneScenario(value);
}

function resolveState(value: GameState | string): GameState {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return stateFromSnapshot(parsed);
}

export function installGameTestBridge(
  host: TestHost,
  target: Window = window,
): GameTestBridge {
  let initial:
    | { kind: "scenario"; value: ScenarioV1 }
    | { kind: "state"; value: GameState }
    | undefined;
  let input: InputState = { ...EMPTY_INPUT };
  const queued = new Map<number, Partial<InputState>[]>();
  const applyInput = (): void =>
    host.setInput({ ...input, aim: input.aim ? { ...input.aim } : null });
  const bridge: GameTestBridge = {
    ready: true,
    loadScenario(value) {
      const scenario = resolveScenario(value);
      input = { ...EMPTY_INPUT };
      queued.clear();
      // Validation/construction happens before host mutation: never patch a live world.
      worldFromScenario(scenario);
      initial = { kind: "scenario", value: cloneScenario(scenario) };
      host.startScenario(cloneScenario(scenario));
      applyInput();
      return canonicalState(host.getState());
    },
    loadState(value) {
      const state = resolveState(value);
      input = { ...EMPTY_INPUT };
      queued.clear();
      initial = { kind: "state", value: structuredClone(state) };
      host.startState(state);
      applyInput();
      return canonicalState(host.getState());
    },
    reset() {
      if (!initial) throw new Error("No scenario loaded");
      return initial.kind === "scenario"
        ? bridge.loadScenario(initial.value)
        : bridge.loadState(initial.value);
    },
    setInput(patch) {
      input = {
        ...input,
        ...patch,
        aim:
          patch.aim === undefined
            ? input.aim
            : patch.aim
              ? { ...patch.aim }
              : null,
      };
      applyInput();
    },
    queueInputs(entries) {
      for (const entry of entries) {
        const list = queued.get(entry.tick) ?? [];
        list.push(entry.input);
        queued.set(entry.tick, list);
      }
    },
    clearInput() {
      input = { ...EMPTY_INPUT };
      queued.clear();
      applyInput();
    },
    step(ticks = 1, options = {}) {
      for (let index = 0; index < ticks; index += 1) {
        for (const patch of queued.get(host.getState().tick) ?? [])
          input = {
            ...input,
            ...patch,
            aim:
              patch.aim === undefined
                ? input.aim
                : patch.aim
                  ? { ...patch.aim }
                  : null,
          };
        queued.delete(host.getState().tick);
        applyInput();
        host.step(1, options.useBrowserInput ? host.sampleInput?.() : input);
      }
      if (options.render) host.render();
      return canonicalState(host.getState());
    },
    render() {
      host.render();
      return host.getManifest();
    },
    snapshot: () => canonicalState(host.getState()),
    stateHash: () => stateHash(host.getState()),
    renderManifest: () => host.getManifest(),
    drainEvents: () => host.getState().events.map((event) => ({ ...event })),
    captureFrame() {
      host.render();
      const canvas = host.getCanvas();
      if (!canvas) throw new Error("Game canvas is unavailable");
      return canvas.toDataURL("image/png");
    },
    captureSequence(ticks, options = {}) {
      return ticks.map((targetTick) => {
        const remaining = targetTick - host.getState().tick;
        if (remaining < 0)
          throw new Error(`Cannot capture past tick ${targetTick}`);
        bridge.step(remaining, { render: options.render ?? true });
        return {
          tick: host.getState().tick,
          snapshot: bridge.snapshot(),
          manifest: bridge.renderManifest(),
          frame: bridge.captureFrame(),
        };
      });
    },
  };
  target.__GAME_TEST__ = bridge;
  return bridge;
}
