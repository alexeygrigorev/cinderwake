import { TICK_MS, TILE_PIXELS } from "../game/constants";
import {
  executeCityService,
  updateCityInteractionContext,
  type CityCommandResultV1,
  type CityServiceActionId,
  type CityServiceReceiptV1,
} from "../game/city";
import { isEmbercrossMap, nearbyEmbercrossNpcId } from "../game/cityWorld";
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
import { worldForScreen } from "../render/manifest";

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
    this.refreshCityNpcContext();
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
    this.refreshCityNpcContext();
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
  /** Execute an action for the NPC currently within the player's service radius. */
  executeNearbyCityAction(
    actionId: CityServiceActionId,
    quantity = 1,
  ): CityCommandResultV1<{ receipt: CityServiceReceiptV1 }> {
    this.refreshCityNpcContext();
    const npcId = this.state.city.nearbyNpcId;
    if (!npcId) {
      return {
        ok: false,
        state: this.state.city,
        code: "not_near_provider",
        message: "Move into a resident's service radius first.",
      };
    }
    // Player combat state is authoritative between city visits. Keep the
    // service traveler aligned immediately before and after the transaction.
    const traveler = this.state.city.traveler;
    this.state.city = {
      ...this.state.city,
      traveler: {
        ...traveler,
        gold: this.state.player.gold,
        health: this.state.player.health,
        maxHealth: this.state.player.maxHealth,
        tonics: this.state.player.tonics,
      },
    };
    const result = executeCityService(this.state.city, {
      tick: this.state.tick,
      npcId,
      actionId,
      quantity,
    });
    if (result.ok) {
      this.state.city = result.state;
      this.state.player.gold = result.state.traveler.gold;
      this.state.player.health = result.state.traveler.health;
      this.state.player.maxHealth = result.state.traveler.maxHealth;
      this.state.player.tonics = result.state.traveler.tonics;
    }
    this.render();
    return result;
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
    return worldForScreen(
      { x: screenX, y: screenY },
      this.renderer.displayCamera,
    );
  }
  private refreshCityNpcContext(): void {
    if (
      !isEmbercrossMap(this.state.map) ||
      this.state.city.locationPhase !== "inside"
    )
      return;
    const context = updateCityInteractionContext(this.state.city, {
      tick: this.state.tick,
      nearbyNpcId: nearbyEmbercrossNpcId(this.state.player.position),
      threatened: this.state.monsters.some((monster) => monster.health > 0),
    });
    if (context.ok) this.state.city = context.state;
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
