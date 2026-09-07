import type { InputState, Vec2 } from "../game/types";
import { EMPTY_INPUT } from "../game/types";

export type TouchRouteResolver = (
  from: Vec2,
  requestedTarget: Vec2,
) => readonly Vec2[];

export interface PointerAttackTarget {
  id: string;
  position: Vec2;
  range: number;
  lineOfSight?: boolean;
}

export interface PointerLootTarget {
  id: string;
  position: Vec2;
}

/** A target id refreshes an existing selection; no id hit-tests a new click. */
export type PointerTargetResolver = (
  point: Vec2,
  targetId?: string,
) => PointerAttackTarget | null;

export type PointerLootTargetResolver = (
  point: Vec2,
  targetId?: string,
) => PointerLootTarget | null;

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
  private mouseAim: { x: number; y: number } | null = null;
  private heldAttacks = new Set<number>();
  private attackTarget: PointerAttackTarget | null = null;
  private pickupTarget: PointerLootTarget | null = null;
  private routedTarget: Vec2 | null = null;
  private attack = false;
  private ability = false;
  private tonic = false;
  private resetMovePad: (() => void) | undefined;
  private readonly listeners = new AbortController();
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly toWorld: (x: number, y: number) => Vec2,
    private readonly getPlayerPosition: () => Vec2,
    private readonly resolveTouchRoute?: TouchRouteResolver,
    private readonly resolvePointerTarget?: PointerTargetResolver,
    private readonly resolvePointerLoot?: PointerLootTargetResolver,
  ) {
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest(
            "input, textarea, select, [contenteditable='true']",
          )
        )
          return;
        if (
          [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            " ",
            "q",
            "Q",
            "e",
            "E",
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
        if (!event.repeat) {
          if (event.key === " ") this.attack = true;
          if (event.key.toLowerCase() === "e") this.ability = true;
          if (event.key.toLowerCase() === "q") this.tonic = true;
        }
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
        if (event.pointerType === "mouse")
          this.mouseAim = { x: event.clientX, y: event.clientY };
      },
      { signal: this.listeners.signal },
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        this.aim = this.point(event);
        if (event.pointerType === "mouse") {
          this.mouseAim = { x: event.clientX, y: event.clientY };
          this.attackTarget = null;
          this.pickupTarget = null;
          this.cancelTouchNavigation(false);
          if (event.button === 0) {
            if (event.shiftKey || !this.resolvePointerTarget) {
              this.attack = true;
              this.heldAttacks.add(event.pointerId);
              canvas.setPointerCapture(event.pointerId);
            } else {
              this.attackTarget = this.resolvePointerTarget(this.aim);
              this.mouseAim = null;
              if (this.attackTarget)
                this.navigateTo(this.attackTarget.position);
              else {
                this.pickupTarget = this.resolvePointerLoot?.(this.aim) ?? null;
                this.navigateTo(this.pickupTarget?.position ?? this.aim);
              }
            }
          }
          if (event.button === 2) this.ability = true;
        } else if (event.isPrimary) {
          this.mouseAim = null;
          this.attackTarget = null;
          this.pickupTarget = this.resolvePointerLoot?.(this.aim) ?? null;
          this.navigateTo(this.pickupTarget?.position ?? this.aim);
        }
      },
      { signal: this.listeners.signal },
    );
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal: this.listeners.signal,
    });
    canvas.addEventListener(
      "lostpointercapture",
      (event) => this.heldAttacks.delete(event.pointerId),
      { signal: this.listeners.signal },
    );
    for (const type of ["pointerup", "pointercancel"] as const)
      window.addEventListener(
        type,
        (event) => this.heldAttacks.delete(event.pointerId),
        { signal: this.listeners.signal },
      );
    window.addEventListener("blur", () => this.resetInput(), {
      signal: this.listeners.signal,
    });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.resetInput();
      },
      { signal: this.listeners.signal },
    );
  }
  private point(e: Pick<PointerEvent, "clientX" | "clientY">): Vec2 {
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
  /** Primary actions repeat while held; secondary actions activate once. */
  attachActionButton(
    element: HTMLElement,
    kind: "attack" | "ability" | "tonic",
  ): void {
    element.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (event.pointerType !== "mouse") {
          this.mouseAim = null;
          if (kind !== "tonic") {
            this.attackTarget = null;
            this.pickupTarget = null;
            this.cancelTouchNavigation();
          }
        }
        this.press(kind);
        if (kind === "attack") this.heldAttacks.add(event.pointerId);
        element.setPointerCapture(event.pointerId);
      },
      { signal: this.listeners.signal },
    );
    element.addEventListener(
      "lostpointercapture",
      (event) => this.heldAttacks.delete(event.pointerId),
      { signal: this.listeners.signal },
    );
    element.addEventListener(
      "click",
      (event) => {
        // Keyboard and assistive-technology activation has no pointerdown.
        if (event.detail === 0) this.press(kind);
      },
      { signal: this.listeners.signal },
    );
  }
  /** Clear a world-space touch route after the map it was resolved against changes. */
  cancelNavigation(): void {
    this.attackTarget = null;
    this.pickupTarget = null;
    this.cancelTouchNavigation();
    this.touchMove = { x: 0, y: 0 };
    this.resetMovePad?.();
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
    this.resetMovePad = reset;
    const update = (event: PointerEvent): void => {
      const bounds = element.getBoundingClientRect();
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.32);
      const length = Math.hypot(dx, dy);
      const scale = length > radius ? radius / length : 1;
      const x = dx * scale;
      const y = dy * scale;
      // Keep the dead zone below the smallest diagonal component produced by
      // a routed waypoint. Otherwise a nearly horizontal joystick gesture can
      // quantize to pure horizontal movement and stop against a tangent prop
      // even though the full routed segment is walkable.
      const deadZone = radius * 0.2;
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
        this.mouseAim = null;
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
    element.addEventListener("lostpointercapture", reset, {
      signal: this.listeners.signal,
    });
    reset();
  }
  destroy(): void {
    this.listeners.abort();
    this.resetInput();
    this.resetMovePad = undefined;
  }
  resetInput(): void {
    this.keys.clear();
    this.heldAttacks.clear();
    this.mouseAim = null;
    this.attack = false;
    this.ability = false;
    this.tonic = false;
    this.cancelNavigation();
  }
  private cancelTouchNavigation(clearAim = true): void {
    this.touchRoute = [];
    this.lastTouchPosition = null;
    this.lastTouchCommand = { x: 0, y: 0 };
    this.blockedTouchTicks = 0;
    if (clearAim) this.aim = null;
  }
  private navigateTo(target: Vec2): void {
    const route = this.resolveTouchRoute?.(
      this.getPlayerPosition(),
      target,
    ) ?? [target];
    this.touchRoute = route.map((point) => ({ ...point }));
    this.routedTarget = { ...target };
    this.lastTouchPosition = null;
    this.lastTouchCommand = { x: 0, y: 0 };
    this.blockedTouchTicks = 0;
    if (this.touchRoute.length === 0) this.cancelTouchNavigation();
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
    if (moveX !== 0 || moveY !== 0 || this.touchMove.x || this.touchMove.y) {
      this.attackTarget = null;
      this.pickupTarget = null;
      this.cancelTouchNavigation();
    }
    let targetInRange = false;
    if (this.attackTarget && this.resolvePointerTarget) {
      this.attackTarget = this.resolvePointerTarget(
        this.attackTarget.position,
        this.attackTarget.id,
      );
      if (!this.attackTarget) this.cancelTouchNavigation();
      else {
        const target = this.attackTarget;
        if (
          !this.routedTarget ||
          Math.hypot(
            target.position.x - this.routedTarget.x,
            target.position.y - this.routedTarget.y,
          ) > 256 ||
          this.touchRoute.length === 0
        )
          this.navigateTo(target.position);
        // Grid routes contain intermediate cell centers even on a clear shot.
        // The game supplies the attack's actual collision-width sight test so
        // ranged classes can fire across those cells without closing to melee.
        targetInRange =
          (target.lineOfSight ?? this.touchRoute.length <= 1) &&
          Math.hypot(
            target.position.x - this.getPlayerPosition().x,
            target.position.y - this.getPlayerPosition().y,
          ) <=
            target.range * 0.9;
        if (targetInRange) this.cancelTouchNavigation(false);
      }
    }
    let pickupTargetId: string | null = null;
    if (this.pickupTarget && this.resolvePointerLoot) {
      this.pickupTarget = this.resolvePointerLoot(
        this.pickupTarget.position,
        this.pickupTarget.id,
      );
      if (!this.pickupTarget) {
        this.cancelTouchNavigation();
      } else {
        const target = this.pickupTarget;
        if (
          !this.routedTarget ||
          Math.hypot(
            target.position.x - this.routedTarget.x,
            target.position.y - this.routedTarget.y,
          ) > 256 ||
          this.touchRoute.length === 0
        )
          this.navigateTo(target.position);
        pickupTargetId = target.id;
      }
    }
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
      // Reproject the cursor every tick: the camera may move while the mouse
      // remains still. Touch navigation owns its separate world-space aim.
      aim: this.attackTarget
        ? { ...this.attackTarget.position }
        : this.touchRoute.length > 0
          ? this.aim
          : this.mouseAim
            ? this.point({ clientX: this.mouseAim.x, clientY: this.mouseAim.y })
            : this.aim,
      pickupTargetId,
      attack:
        targetInRange ||
        this.attack ||
        this.heldAttacks.size > 0 ||
        this.keys.has(" "),
      ability: this.ability,
      useTonic: this.tonic,
    };
    this.attack = false;
    this.ability = false;
    this.tonic = false;
    return input;
  }
}
