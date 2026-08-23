import type { InputState, Vec2 } from "../game/types";
import { EMPTY_INPUT } from "../game/types";

export class InputController {
  private keys = new Set<string>();
  private touchMove: { x: -1 | 0 | 1; y: -1 | 0 | 1 } = { x: 0, y: 0 };
  private aim: Vec2 | null = null;
  private attack = false;
  private ability = false;
  private tonic = false;
  private readonly listeners = new AbortController();
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly toWorld: (x: number, y: number) => Vec2,
  ) {
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            " ",
            "q",
            "Q",
          ].includes(event.key)
        )
          event.preventDefault();
        this.keys.add(event.key.toLowerCase());
        if (event.key.toLowerCase() === "q") this.tonic = true;
      },
      { signal: this.listeners.signal },
    );
    window.addEventListener(
      "keyup",
      (event) => this.keys.delete(event.key.toLowerCase()),
      { signal: this.listeners.signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        this.aim = this.point(event);
      },
      { signal: this.listeners.signal },
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        this.aim = this.point(event);
        if (event.button === 0) this.attack = true;
        if (event.button === 2) this.ability = true;
      },
      { signal: this.listeners.signal },
    );
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal: this.listeners.signal,
    });
  }
  private point(e: PointerEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return this.toWorld(
      ((e.clientX - r.left) * 960) / r.width,
      ((e.clientY - r.top) * 540) / r.height,
    );
  }
  press(kind: "attack" | "ability" | "tonic"): void {
    if (kind === "attack") this.attack = true;
    else if (kind === "ability") this.ability = true;
    else this.tonic = true;
  }
  attachMovePad(element: HTMLElement): void {
    const knob = element.querySelector<HTMLElement>(".move-knob");
    let activePointer: number | undefined;
    const reset = (): void => {
      activePointer = undefined;
      this.touchMove = { x: 0, y: 0 };
      if (knob) knob.style.transform = "translate(0px, 0px)";
      element.dataset.direction = "0,0";
    };
    const update = (event: PointerEvent): void => {
      const bounds = element.getBoundingClientRect();
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.32);
      const length = Math.hypot(dx, dy);
      const scale = length > radius ? radius / length : 1;
      const x = dx * scale;
      const y = dy * scale;
      const deadZone = radius * 0.28;
      this.touchMove = {
        x: Math.abs(dx) < deadZone ? 0 : dx < 0 ? -1 : 1,
        y: Math.abs(dy) < deadZone ? 0 : dy < 0 ? -1 : 1,
      };
      if (knob) knob.style.transform = `translate(${x}px, ${y}px)`;
      element.dataset.direction = `${this.touchMove.x},${this.touchMove.y}`;
    };
    element.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        activePointer = event.pointerId;
        element.setPointerCapture(event.pointerId);
        update(event);
      },
      { signal: this.listeners.signal },
    );
    element.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerId === activePointer) update(event);
      },
      { signal: this.listeners.signal },
    );
    element.addEventListener(
      "pointerup",
      (event) => {
        if (event.pointerId === activePointer) reset();
      },
      { signal: this.listeners.signal },
    );
    element.addEventListener(
      "pointercancel",
      (event) => {
        if (event.pointerId === activePointer) reset();
      },
      { signal: this.listeners.signal },
    );
    reset();
  }
  destroy(): void {
    this.listeners.abort();
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
  }
  sample(): InputState {
    const moveX =
      (this.keys.has("a") || this.keys.has("arrowleft") ? -1 : 0) +
      (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0);
    const moveY =
      (this.keys.has("w") || this.keys.has("arrowup") ? -1 : 0) +
      (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
    const input = {
      ...EMPTY_INPUT,
      moveX: Math.max(-1, Math.min(1, moveX || this.touchMove.x)) as -1 | 0 | 1,
      moveY: Math.max(-1, Math.min(1, moveY || this.touchMove.y)) as -1 | 0 | 1,
      aim: this.aim,
      attack: this.attack,
      ability: this.ability,
      useTonic: this.tonic,
    };
    this.attack = false;
    this.ability = false;
    this.tonic = false;
    return input;
  }
}
