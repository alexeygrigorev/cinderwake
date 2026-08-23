import type { InputState, Vec2 } from "../game/types";
import { EMPTY_INPUT } from "../game/types";

export type TouchRouteResolver = (
  from: Vec2,
  requestedTarget: Vec2,
) => readonly Vec2[];

export class InputController {
  private static readonly TAP_ARRIVAL_DISTANCE = 96;
  private static readonly TAP_AXIS_DEAD_ZONE = 32;
  private keys = new Set<string>();
  private touchMove: { x: -1 | 0 | 1; y: -1 | 0 | 1 } = { x: 0, y: 0 };
  private touchRoute: Vec2[] = [];
  private lastTouchPosition: Vec2 | null = null;
  private lastTouchCommand: { x: -1 | 0 | 1; y: -1 | 0 | 1 } = {
    x: 0,
    y: 0,
  };
  private blockedTouchTicks = 0;
  private aim: Vec2 | null = null;
  private attack = false;
  private ability = false;
  private tonic = false;
  private readonly listeners = new AbortController();
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly toWorld: (x: number, y: number) => Vec2,
    private readonly getPlayerPosition: () => Vec2,
    private readonly resolveTouchRoute?: TouchRouteResolver,
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
        if (
          [
            "arrowup",
            "arrowdown",
            "arrowleft",
            "arrowright",
            "w",
            "a",
            "s",
            "d",
          ].includes(event.key.toLowerCase())
        )
          this.cancelTouchNavigation();
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
        if (event.pointerType === "mouse") {
          this.cancelTouchNavigation(false);
          if (event.button === 0) this.attack = true;
          if (event.button === 2) this.ability = true;
        } else if (event.isPrimary) {
          const player = this.getPlayerPosition();
          const route = this.resolveTouchRoute?.(player, this.aim) ?? [
            this.aim,
          ];
          this.touchRoute = route.map((point) => ({ ...point }));
          this.lastTouchPosition = null;
          this.lastTouchCommand = { x: 0, y: 0 };
          this.blockedTouchTicks = 0;
          if (this.touchRoute.length === 0) this.cancelTouchNavigation();
        }
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
        this.cancelTouchNavigation();
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
    this.cancelTouchNavigation();
  }
  private cancelTouchNavigation(clearAim = true): void {
    this.touchRoute = [];
    this.lastTouchPosition = null;
    this.lastTouchCommand = { x: 0, y: 0 };
    this.blockedTouchTicks = 0;
    if (clearAim) this.aim = null;
  }
  private tapMove(): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
    if (this.touchRoute.length === 0) return { x: 0, y: 0 };
    const player = this.getPlayerPosition();
    if (
      this.lastTouchPosition &&
      (this.lastTouchCommand.x !== 0 || this.lastTouchCommand.y !== 0) &&
      player.x === this.lastTouchPosition.x &&
      player.y === this.lastTouchPosition.y
    )
      this.blockedTouchTicks += 1;
    else this.blockedTouchTicks = 0;
    if (this.blockedTouchTicks >= 12) {
      this.cancelTouchNavigation();
      return { x: 0, y: 0 };
    }
    while (this.touchRoute.length > 0) {
      const waypoint = this.touchRoute[0]!;
      if (
        Math.hypot(waypoint.x - player.x, waypoint.y - player.y) >
        InputController.TAP_ARRIVAL_DISTANCE
      )
        break;
      this.touchRoute.shift();
    }
    const waypoint = this.touchRoute[0];
    if (!waypoint) {
      this.cancelTouchNavigation();
      return { x: 0, y: 0 };
    }
    this.aim = { ...waypoint };
    const dx = waypoint.x - player.x;
    const dy = waypoint.y - player.y;
    const axis = (delta: number): -1 | 0 | 1 =>
      Math.abs(delta) <= InputController.TAP_AXIS_DEAD_ZONE
        ? 0
        : delta < 0
          ? -1
          : 1;
    const command = { x: axis(dx), y: axis(dy) };
    this.lastTouchPosition = { ...player };
    this.lastTouchCommand = command;
    return command;
  }
  sample(): InputState {
    const moveX =
      (this.keys.has("a") || this.keys.has("arrowleft") ? -1 : 0) +
      (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0);
    const moveY =
      (this.keys.has("w") || this.keys.has("arrowup") ? -1 : 0) +
      (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
    if (moveX !== 0 || moveY !== 0 || this.touchMove.x || this.touchMove.y)
      this.cancelTouchNavigation();
    const tapMove = this.tapMove();
    const input = {
      ...EMPTY_INPUT,
      moveX: Math.max(
        -1,
        Math.min(1, moveX || this.touchMove.x || tapMove.x),
      ) as -1 | 0 | 1,
      moveY: Math.max(
        -1,
        Math.min(1, moveY || this.touchMove.y || tapMove.y),
      ) as -1 | 0 | 1,
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
