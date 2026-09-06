import {
  EMPTY_INPUT,
  type GameEvent,
  type GameState,
  type InputState,
} from "../game/types";
import type {
  CameraMode,
  CameraV1,
  EntityMaskV1,
  PaintMaskV1,
  RenderManifestV1,
} from "../render/manifest";
import { canonicalState, stateHash } from "./canonical";
import {
  BUILTIN_SCENARIOS,
  validateScenario,
  worldFromScenario,
  type ScenarioV1,
} from "./scenarios";
import { stateFromSnapshot } from "./stateSnapshots";
import {
  cloneInputPatch,
  validateAdvance,
  validateTick,
} from "./inputValidation";

export interface TestHost {
  getState(): GameState;
  startScenario(scenario: ScenarioV1): void;
  startState(state: GameState): void;
  setInput(input: InputState): void;
  step(
    ticks?: number,
    input?: InputState,
    options?: { render?: boolean },
  ): void;
  sampleInput?(): InputState;
  render(interpolationAlpha?: number): void;
  getManifest(): RenderManifestV1;
  getCanvas(): HTMLCanvasElement | null;
  captureLogicalFrame?(): string;
  captureEntityMask(entityId: string): EntityMaskV1;
  capturePaintMask(paintId: string): PaintMaskV1;
  setCamera(camera: CameraV1, mode?: CameraMode): void;
  setCameraMode(mode: CameraMode): void;
  getCamera(): CameraV1;
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
  render(options?: { interpolationAlpha?: number }): RenderManifestV1;
  setCamera(camera: CameraV1, mode?: CameraMode): RenderManifestV1;
  setCameraMode(mode: CameraMode): void;
  camera(): CameraV1;
  snapshot(): ReturnType<typeof canonicalState>;
  stateHash(): string;
  renderManifest(): RenderManifestV1;
  drainEvents(): GameEvent[];
  captureFrame(): string;
  captureEntityMask(entityId: string): EntityMaskV1;
  capturePaintMask(paintId: string): PaintMaskV1;
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
      // Validation/construction happens before host mutation: never patch a live world.
      worldFromScenario(scenario);
      input = { ...EMPTY_INPUT };
      queued.clear();
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
      patch = cloneInputPatch(patch);
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
      if (!Array.isArray(entries)) throw new Error("entries must be an array");
      const owned = entries.map((entry) => {
        if (!entry || typeof entry !== "object")
          throw new Error("Each input entry must be an object");
        validateTick(entry.tick);
        if (entry.tick < host.getState().tick)
          throw new Error(`Cannot queue input for past tick ${entry.tick}`);
        return { tick: entry.tick, input: cloneInputPatch(entry.input) };
      });
      for (const entry of owned) {
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
      validateAdvance(ticks, host.getState().tick);
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
        host.step(1, options.useBrowserInput ? host.sampleInput?.() : input, {
          render: options.render ?? true,
        });
      }
      return canonicalState(host.getState());
    },
    render(options = {}) {
      host.render(options.interpolationAlpha ?? 1);
      return host.getManifest();
    },
    setCamera(camera, mode = "fixed") {
      host.setCamera(camera, mode);
      return host.getManifest();
    },
    setCameraMode(mode) {
      host.setCameraMode(mode);
    },
    camera: () => host.getCamera(),
    snapshot: () => canonicalState(host.getState()),
    stateHash: () => stateHash(host.getState()),
    renderManifest: () => host.getManifest(),
    drainEvents: () => host.getState().events.map((event) => ({ ...event })),
    captureFrame() {
      if (host.captureLogicalFrame) return host.captureLogicalFrame();
      const canvas = host.getCanvas();
      if (!canvas) throw new Error("Game canvas is unavailable");
      return canvas.toDataURL("image/png");
    },
    captureEntityMask: (entityId) => host.captureEntityMask(entityId),
    capturePaintMask: (paintId) => host.capturePaintMask(paintId),
    captureSequence(ticks, options = {}) {
      if (!Array.isArray(ticks)) throw new Error("ticks must be an array");
      let previousTick = host.getState().tick;
      for (const targetTick of ticks) {
        validateTick(targetTick);
        if (targetTick < previousTick)
          throw new Error(`Cannot capture past tick ${targetTick}`);
        previousTick = targetTick;
      }
      validateAdvance(
        previousTick - host.getState().tick,
        host.getState().tick,
      );
      return ticks.map((targetTick) => {
        const remaining = targetTick - host.getState().tick;
        if (remaining < 0)
          throw new Error(`Cannot capture past tick ${targetTick}`);
        bridge.step(remaining, { render: options.render ?? true });
        // A capture always synchronizes pixels, including zero-tick captures.
        if (remaining === 0 || options.render === false) bridge.render();
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
