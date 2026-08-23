import type { InputState, Vec2 } from "../game/types";
import { EMPTY_INPUT } from "../game/types";

export class InputController {
  private keys = new Set<string>();
  private aim: Vec2 | null = null;
  private attack = false;
  private ability = false;
  private tonic = false;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly toWorld: (x: number, y: number) => Vec2,
  ) {
    window.addEventListener("keydown", (e) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          " ",
          "q",
          "Q",
        ].includes(e.key)
      )
        e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === "q") this.tonic = true;
    });
    window.addEventListener("keyup", (e) =>
      this.keys.delete(e.key.toLowerCase()),
    );
    canvas.addEventListener("pointermove", (e) => {
      this.aim = this.point(e);
    });
    canvas.addEventListener("pointerdown", (e) => {
      this.aim = this.point(e);
      if (e.button === 0) this.attack = true;
      if (e.button === 2) this.ability = true;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
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
  sample(): InputState {
    const moveX =
      (this.keys.has("a") || this.keys.has("arrowleft") ? -1 : 0) +
      (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0);
    const moveY =
      (this.keys.has("w") || this.keys.has("arrowup") ? -1 : 0) +
      (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
    const input = {
      ...EMPTY_INPUT,
      moveX: Math.max(-1, Math.min(1, moveX)) as -1 | 0 | 1,
      moveY: Math.max(-1, Math.min(1, moveY)) as -1 | 0 | 1,
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
