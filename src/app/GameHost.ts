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
import { CanvasRenderer } from "../render/CanvasRenderer";
import type { RenderManifestV1 } from "../render/manifest";

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
  readonly testMode: boolean;
  onRender?: (state: GameState, manifest: RenderManifestV1) => void;
  constructor(
    canvas: HTMLCanvasElement,
    testMode = new URLSearchParams(location.search).get("testMode") === "1",
  ) {
    this.renderer = new CanvasRenderer(canvas);
    this.testMode = testMode;
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
    this.renderer.camera = {
      x: (this.state.player.position.x / UNITS_PER_TILE) * TILE_PIXELS,
      y: (this.state.player.position.y / UNITS_PER_TILE) * TILE_PIXELS,
      zoom: 1,
    };
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
  setPaused(value: boolean): void {
    this.paused = value;
  }
  togglePaused(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }
  step(ticks = 1, input?: InputState): GameState {
    for (let i = 0; i < ticks; i++)
      stepGame(this.state, input ?? this.inputProvider?.() ?? this.input);
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
  render(): RenderManifestV1 {
    const m = this.renderer.render(this.state, this.testMode);
    this.manifest = m;
    this.onRender?.(this.state, m);
    return m;
  }
  worldAt(screenX: number, screenY: number): Vec2 {
    return {
      x: Math.round(
        ((screenX - VIEW_WIDTH / 2 + this.renderer.camera.x) / TILE_PIXELS) *
          UNITS_PER_TILE,
      ),
      y: Math.round(
        ((screenY - VIEW_HEIGHT / 2 + this.renderer.camera.y) / TILE_PIXELS) *
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
        this.accumulator -= TICK_MS;
      }
    }
    this.render();
    requestAnimationFrame(this.loop);
  };
}
