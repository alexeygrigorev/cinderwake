import {
  TICK_MS,
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../game/constants";
import { stepGame } from "../game/simulation";
import type { GameState, InputState, Vec2 } from "../game/types";
import { EMPTY_INPUT } from "../game/types";
import type { ScenarioV1 } from "../testkit/scenarios";
import { worldFromScenario } from "../testkit/scenarios";
import { stateFromSnapshot } from "../testkit/stateSnapshots";
import { CanvasRenderer } from "../render/CanvasRenderer";
import type {
  CameraMode,
  CameraV1,
  EntityMaskV1,
  RenderManifestV1,
} from "../render/manifest";

export class GameHost {
  state: GameState;
  readonly renderer: CanvasRenderer;
  private input: InputState = EMPTY_INPUT;
  private manifest?: RenderManifestV1;
  inputProvider?: () => InputState;
  private last = 0;
  private accumulator = 0;
  private running = false;
  private paused = false;
  private cameraMode: CameraMode;
  readonly testMode: boolean;
  onRender?: (state: GameState, manifest: RenderManifestV1) => void;
  constructor(
    canvas: HTMLCanvasElement,
    testMode = new URLSearchParams(location.search).get("testMode") === "1",
  ) {
    this.renderer = new CanvasRenderer(canvas, testMode);
    this.testMode = testMode;
    this.cameraMode = testMode ? "snap" : "smooth";
    this.state = worldFromScenario({
      schemaVersion: 1,
      id: "boot",
      seed: "cinderwake",
      classId: "vanguard",
      map: { mode: "generated" },
    });
  }
  startScenario(scenario: ScenarioV1): GameState {
    this.state = worldFromScenario(scenario);
    this.cameraMode =
      scenario.camera?.mode ?? (this.testMode ? "snap" : "smooth");
    const center = scenario.camera?.centerTile;
    this.renderer.resetCamera(
      this.state,
      center
        ? {
            x: (center[0] + 0.5) * TILE_PIXELS,
            y: (center[1] + 0.5) * TILE_PIXELS,
            zoom: 1,
          }
        : undefined,
    );
    this.render();
    return this.state;
  }
  startState(snapshot: GameState): GameState {
    this.state = stateFromSnapshot(snapshot);
    this.cameraMode = this.testMode ? "snap" : "smooth";
    this.renderer.resetCamera(this.state);
    this.render();
    return this.state;
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }
  stop(): void {
    this.running = false;
  }
  setInput(input: InputState): void {
    this.input = input;
  }
  setCamera(camera: CameraV1, mode: CameraMode = "fixed"): void {
    this.cameraMode = mode;
    this.renderer.setCamera(camera);
    this.render();
  }
  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }
  getCamera(): CameraV1 {
    return { ...this.renderer.camera };
  }
  setPaused(value: boolean): void {
    this.paused = value;
  }
  togglePaused(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }
  step(ticks = 1, input?: InputState): GameState {
    for (let i = 0; i < ticks; i++) {
      stepGame(this.state, input ?? this.inputProvider?.() ?? this.input);
      this.renderer.advanceCamera(this.state, this.cameraMode);
    }
    this.render();
    return this.state;
  }
  sampleInput(): InputState {
    return this.inputProvider?.() ?? this.input;
  }
  captureState(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState;
  }
  currentState(): GameState {
    return this.state;
  }
  getState(): GameState {
    return this.state;
  }
  getCanvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }
  getManifest(): RenderManifestV1 {
    return this.manifest ?? this.render();
  }
  captureEntityMask(entityId: string): EntityMaskV1 {
    return this.renderer.captureEntityMask(this.state, entityId);
  }
  render(interpolationAlpha = 1): RenderManifestV1 {
    const m = this.renderer.render(
      this.state,
      interpolationAlpha,
      this.cameraMode,
    );
    this.manifest = m;
    this.onRender?.(this.state, m);
    return m;
  }
  worldAt(screenX: number, screenY: number): Vec2 {
    return {
      x: Math.round(
        ((screenX - VIEW_WIDTH / 2 + this.renderer.displayCamera.x) /
          TILE_PIXELS) *
          UNITS_PER_TILE,
      ),
      y: Math.round(
        ((screenY - VIEW_HEIGHT / 2 + this.renderer.displayCamera.y) /
          TILE_PIXELS) *
          UNITS_PER_TILE,
      ),
    };
  }
  private loop = (now: number): void => {
    if (!this.running) return;
    const elapsed = Math.min(250, now - this.last);
    this.last = now;
    if (!this.testMode && !this.paused) {
      this.accumulator += elapsed;
      while (this.accumulator >= TICK_MS) {
        stepGame(this.state, this.inputProvider?.() ?? this.input);
        this.renderer.advanceCamera(this.state, this.cameraMode);
        this.accumulator -= TICK_MS;
      }
    }
    this.render(this.testMode ? 1 : this.accumulator / TICK_MS);
    requestAnimationFrame(this.loop);
  };
}
