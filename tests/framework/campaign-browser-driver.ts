import {
  expect,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { DIAGONAL_SCALE } from "../../src/game/constants";
import { ARCHETYPES } from "../../src/game/content";
import { navigationSegmentWalkable } from "../../src/game/navigation";
import { screenFor } from "../../src/render/manifest";
import { sceneryCollisions } from "../../src/game/sceneryLayout";
import type { GameState, PendingAttack, Vec2 } from "../../src/game/types";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const UNITS_PER_TILE = 1024;
const BELL_KEEPER_RANGE = 2 * UNITS_PER_TILE;
// Match the production pointer controller's stop distance so a click-to-pursue
// target and this driver agree on when the real held strike can take over.
const ROUTE_TARGET_DISTANCE = ARCHETYPES.vanguard.attackRange * 0.9;

export interface CampaignBrowserProfile {
  id: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  hasTouch: boolean;
  isMobile: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Geometry {
  canvas: Rect;
  controls: Rect | null;
  movePad: Rect | null;
}

interface GestureRecord {
  atMs: number;
  action: string;
  details?: Record<string, unknown>;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function canVanguardStrike(
  state: GameState,
  monster: GameState["monsters"][number],
): boolean {
  return (
    distance(state.player.position, monster.position) <=
      ROUTE_TARGET_DISTANCE &&
    navigationSegmentWalkable(
      state.map,
      sceneryCollisions(state.map),
      state.player.position,
      monster.position,
      0,
    )
  );
}

function hasVanguardAbilityTarget(state: GameState): boolean {
  const abilityRange = 2355;
  return state.monsters.some(
    (monster) =>
      monster.health > 0 &&
      distance(state.player.position, monster.position) <= abilityRange,
  );
}

/**
 * Pick the closest legal eight-direction input for one routed waypoint.
 *
 * A route is made of walkable line segments, but a physical keyboard gesture
 * is quantized to one of eight fixed movement vectors. Checking the actual
 * one-tick displacement keeps a diagonal key pulse from clipping a prop at a
 * route corner and leaving the browser driver circling forever.
 */
function physicalDirection(state: GameState, target: Vec2): Vec2 {
  const current = state.player.position;
  const scenery = sceneryCollisions(state.map);
  const candidates: Array<{ direction: Vec2; position: Vec2 }> = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      if (x === 0 && y === 0) continue;
      const speed =
        x !== 0 && y !== 0
          ? Math.round((state.player.moveSpeed * DIAGONAL_SCALE) / 1024)
          : state.player.moveSpeed;
      const position = {
        x: current.x + x * speed,
        y: current.y + y * speed,
      };
      if (
        navigationSegmentWalkable(
          state.map,
          scenery,
          current,
          position,
          state.player.radius,
        )
      )
        candidates.push({ direction: { x, y }, position });
    }
  }
  const currentDistance = distance(current, target);
  const improving = candidates.filter(
    ({ position }) => distance(position, target) < currentDistance,
  );
  const pool = improving.length ? improving : candidates;
  return (
    pool.sort(
      (first, second) =>
        distance(first.position, target) - distance(second.position, target) ||
        Math.abs(second.direction.x) +
          Math.abs(second.direction.y) -
          (Math.abs(first.direction.x) + Math.abs(first.direction.y)),
    )[0]?.direction ?? {
      x: Math.sign(target.x - current.x),
      y: Math.sign(target.y - current.y),
    }
  );
}

function progressSignature(state: GameState): string {
  return JSON.stringify({
    phase: state.phase,
    map: state.map.digest,
    city: state.city.locationPhase,
    player: {
      x: Math.round(state.player.position.x / 64),
      y: Math.round(state.player.position.y / 64),
      health: state.player.health,
    },
    kills: state.metrics.kills,
    monsters: state.monsters.map(({ id, health, deathTick }) => ({
      id,
      health,
      deathTick,
    })),
  });
}

function bellKeeperSlam(state: GameState, attack: PendingAttack): boolean {
  const owner = state.monsters.find(({ id }) => id === attack.ownerId);
  if (!owner) return false;
  return (
    attack.kind === "ability" &&
    owner.health > 0 &&
    owner.elite &&
    owner.kind === "stonekin" &&
    attack.range === BELL_KEEPER_RANGE
  );
}

function imminentProjectile(state: GameState) {
  const player = state.player.position;
  return state.projectiles
    .filter((projectile) => projectile.hostile)
    .map((projectile) => {
      const velocitySquared =
        projectile.velocity.x * projectile.velocity.x +
        projectile.velocity.y * projectile.velocity.y;
      if (velocitySquared < 1) return { projectile, time: Infinity };
      const toPlayer = {
        x: player.x - projectile.position.x,
        y: player.y - projectile.position.y,
      };
      const projectedTime = Math.max(
        0,
        Math.min(
          45,
          (toPlayer.x * projectile.velocity.x +
            toPlayer.y * projectile.velocity.y) /
            velocitySquared,
        ),
      );
      const closest = {
        x: projectile.position.x + projectile.velocity.x * projectedTime,
        y: projectile.position.y + projectile.velocity.y * projectedTime,
      };
      return {
        projectile,
        time:
          Math.hypot(closest.x - player.x, closest.y - player.y) <=
          projectile.radius + state.player.radius + 240
            ? projectedTime
            : Infinity,
      };
    })
    .sort((first, second) => first.time - second.time)[0];
}

export class CampaignBrowserDriver {
  private startedAt = Date.now();
  private static readonly JOURNEY_BUDGET_MS = 300_000;
  private readonly gestures: GestureRecord[] = [];
  private readonly checkpoints: Array<{
    name: string;
    tick: number;
    phase: string;
    city: string;
  }> = [];
  private session?: CDPSession;
  private strikeActive = false;
  private readonly dodgedProjectiles = new Set<string>();

  constructor(
    private readonly page: Page,
    readonly profile: CampaignBrowserProfile,
  ) {}

  async start(): Promise<void> {
    if (this.profile.hasTouch)
      this.session = await this.page.context().newCDPSession(this.page);
    await this.page.goto("/?selection=1", { waitUntil: "networkidle" });
    await this.page
      .getByRole("button", { name: "Enter the wake", exact: true })
      .waitFor({
        state: "visible",
        timeout: 30_000,
      });
  }

  async chooseVanguard(seed = "cinder-041"): Promise<void> {
    await this.page.locator("[data-class='vanguard']").click();
    await this.page.locator("#seed").fill(seed);
    const begin = this.page.locator("#begin");
    if (this.profile.hasTouch) await begin.tap();
    else await begin.click();
    await this.page.locator("canvas").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await this.page.waitForFunction(() =>
      Boolean(window.__GAME_OBSERVE__?.ready),
    );
    await this.assertProductionBoundary();
    this.startedAt = Date.now();
    this.record("enter-wake", { seed, classId: "vanguard" });
  }

  async assertProductionBoundary(): Promise<void> {
    expect(await this.page.evaluate(() => Boolean(window.__GAME_TEST__))).toBe(
      false,
    );
    expect(await this.page.evaluate(() => window.__GAME_OBSERVE__?.mode)).toBe(
      "observe-only",
    );
  }

  async state(): Promise<GameState> {
    return this.page.evaluate(() => {
      if (!window.__GAME_OBSERVE__)
        throw new Error("Production observer is unavailable");
      return window.__GAME_OBSERVE__.snapshot();
    });
  }

  async manifest() {
    return this.page.evaluate(() => {
      if (!window.__GAME_OBSERVE__)
        throw new Error("Production observer is unavailable");
      return window.__GAME_OBSERVE__.renderManifest();
    });
  }

  async geometry(): Promise<Geometry> {
    const [canvas, controls, movePad] = await Promise.all([
      this.page.locator("canvas:not(.mini)").boundingBox(),
      this.page.locator(".mobile-controls").boundingBox(),
      this.page.locator(".move-pad").boundingBox(),
    ]);
    if (!canvas) throw new Error("Production canvas has no device bounds");
    return { canvas, controls, movePad };
  }

  async checkpoint(testInfo: TestInfo, name: string): Promise<GameState> {
    const state = await this.state();
    const frame = await this.page.evaluate(() => {
      const observer = window.__GAME_OBSERVE__;
      if (!observer) throw new Error("Production observer is unavailable");
      return observer.captureFrame();
    });
    await testInfo.attach(`${this.profile.id}-${name}-page.png`, {
      body: await this.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach(`${this.profile.id}-${name}-canvas.png`, {
      body: Buffer.from(frame.slice(frame.indexOf(",") + 1), "base64"),
      contentType: "image/png",
    });
    this.checkpoints.push({
      name,
      tick: state.tick,
      phase: state.phase,
      city: state.city.locationPhase,
    });
    return state;
  }

  async attachEvidence(testInfo: TestInfo): Promise<void> {
    await testInfo.attach(`${this.profile.id}-journey.json`, {
      body: JSON.stringify(
        {
          profile: this.profile,
          checkpoints: this.checkpoints,
          gestures: this.gestures,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }

  async waitFor(
    label: string,
    predicate: (state: GameState) => boolean,
    timeoutMs = 10_000,
  ): Promise<GameState> {
    const started = Date.now();
    let latest = await this.state();
    let signature = progressSignature(latest);
    let changedAt = started;
    while (Date.now() - started < timeoutMs) {
      this.assertBudget(label);
      if (predicate(latest)) return latest;
      await this.maybeUseTonic(latest);
      await this.evadeProjectile(latest);
      await this.escapeIfNeeded(latest);
      await this.page.waitForTimeout(75);
      latest = await this.state();
      const nextSignature = progressSignature(latest);
      if (nextSignature !== signature) {
        signature = nextSignature;
        changedAt = Date.now();
      } else if (Date.now() - changedAt >= 10_000) {
        throw new Error(`${label} made no meaningful progress for 10 seconds`);
      }
    }
    throw new Error(
      `${label} exceeded ${timeoutMs}ms; last state ${JSON.stringify(
        stateSummary(latest),
      )}`,
    );
  }

  async moveTo(
    target: Vec2,
    label: string,
    complete: (state: GameState) => boolean = () => false,
    attackWhileMoving = false,
    pursuitMonsterId?: string,
  ): Promise<GameState> {
    for (let attempt = 0; attempt < 256; attempt += 1) {
      this.assertBudget(label);
      let before = await this.state();
      if (complete(before)) {
        await this.stopNavigation();
        return before;
      }
      await this.maybeUseTonic(before);
      await this.escapeIfNeeded(before);
      if (attackWhileMoving && !this.strikeActive) await this.startStrike();
      if (
        attackWhileMoving &&
        before.player.abilityReadyTick <= before.tick &&
        hasVanguardAbilityTarget(before)
      )
        await this.useAbility();
      const route = await this.page.evaluate((requestedTarget) => {
        const observer = window.__GAME_OBSERVE__;
        if (!observer) throw new Error("Production observer is unavailable");
        return observer.navigationRoute(requestedTarget);
      }, target);
      if (route.length === 0)
        throw new Error(
          `${label} has no route from ${JSON.stringify({
            player: before.player.position,
            target,
            map: before.map.digest,
          })}`,
        );
      const waypoint =
        route[Math.min(route.length - 1, this.profile.hasTouch ? 4 : 6)]!;
      const gesture = await this.navigateToPoint(
        waypoint,
        attackWhileMoving ? pursuitMonsterId : undefined,
        target,
        route[0],
      );
      this.record(gesture.action, {
        label,
        attempt,
        waypoint,
        routeLength: route.length,
      });
      const start = { ...before.player.position };
      const waypointReached = (state: GameState): boolean =>
        complete(state) ||
        distance(state.player.position, waypoint) < 176 ||
        distance(state.player.position, start) > 64;
      let latest: GameState;
      try {
        latest = await this.waitFor(
          `${label} waypoint ${attempt}`,
          waypointReached,
          gesture.action.includes("route") || gesture.action.includes("pursuit")
            ? this.profile.hasTouch
              ? 3_500
              : 1_500
            : 10_000,
        );
      } catch (error) {
        if (
          !gesture.action.includes("route") &&
          !gesture.action.includes("pursuit")
        )
          throw error;
        const fallback = await this.state();
        const fallbackStart = { ...fallback.player.position };
        await this.pulse(
          physicalDirection(fallback, waypoint),
          this.profile.hasTouch ? 800 : 220,
        );
        latest = await this.waitFor(
          `${label} keyboard fallback ${attempt}`,
          (state) =>
            complete(state) ||
            distance(state.player.position, fallbackStart) > 64,
          2_000,
        );
      }
      if (complete(latest)) {
        await this.stopNavigation();
        return latest;
      }
    }
    throw new Error(`${label} exceeded 256 physical route waypoints`);
  }

  async defeatAllMonsters(): Promise<GameState> {
    for (;;) {
      const state = await this.state();
      if (state.phase !== "playing") return state;
      const target = state.monsters
        .filter(({ health }) => health > 0)
        .sort(
          (first, second) =>
            distance(state.player.position, first.position) -
              distance(state.player.position, second.position) ||
            first.id.localeCompare(second.id),
        )[0];
      if (!target) return state;
      await this.defeatMonster(target.id);
    }
  }

  async defeatMonster(monsterId: string): Promise<GameState> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      let state = await this.state();
      const monster = state.monsters.find(({ id }) => id === monsterId);
      if (!monster || monster.health <= 0) return state;
      if (state.phase !== "playing") return state;
      if (!canVanguardStrike(state, monster)) {
        state = await this.moveTo(
          monster.position,
          `approach ${monsterId}`,
          (current) => {
            const currentMonster = current.monsters.find(
              ({ id }) => id === monsterId,
            );
            const alternateInRange = current.monsters.some(
              (candidate) =>
                candidate.id !== monsterId &&
                candidate.health > 0 &&
                canVanguardStrike(current, candidate),
            );
            return (
              current.phase !== "playing" ||
              !currentMonster ||
              currentMonster.health <= 0 ||
              canVanguardStrike(current, currentMonster) ||
              alternateInRange
            );
          },
          true,
          monsterId,
        );
        if (state.phase !== "playing") {
          await this.stopStrike();
          return state;
        }
        if (
          state.monsters.some(
            (candidate) =>
              candidate.id !== monsterId &&
              candidate.health > 0 &&
              canVanguardStrike(state, candidate),
          )
        )
          return state;
        continue;
      }
      await this.holdStrike(monsterId, monster.elite ? 4_500 : 3_200);
      state = await this.state();
      if (state.phase !== "playing") return state;
      const remaining = state.monsters.find(({ id }) => id === monsterId);
      if (!remaining || remaining.health <= 0) return state;
    }
    throw new Error(
      `Could not defeat ${monsterId} after 32 physical attack cycles`,
    );
  }

  async saveAndReload(testInfo: TestInfo): Promise<GameState> {
    await this.page
      .getByRole("button", { name: "Journal and save", exact: true })
      .click();
    await expect(this.page.getByRole("dialog")).toBeVisible();
    await testInfo.attach(`${this.profile.id}-journal-before-save.png`, {
      body: await this.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await this.page
      .getByRole("button", { name: "Save checkpoint", exact: true })
      .click();
    await expect(this.page.locator("[data-save-status]")).toContainText(
      "Checkpoint saved",
    );
    const saved = await this.state();
    this.record("journal-save", {
      tick: saved.tick,
      city: saved.city.locationPhase,
    });
    await this.page
      .getByRole("button", { name: "Back to game", exact: true })
      .click();
    await this.page.reload({ waitUntil: "networkidle" });
    await this.page
      .getByRole("button", { name: "Continue journey", exact: true })
      .click();
    await this.page
      .locator("canvas")
      .waitFor({ state: "visible", timeout: 30_000 });
    await this.page.waitForFunction(() =>
      Boolean(window.__GAME_OBSERVE__?.ready),
    );
    await this.assertProductionBoundary();
    const restored = await this.waitFor(
      "save reload",
      (state) =>
        state.map.digest === saved.map.digest &&
        state.city.locationPhase === saved.city.locationPhase,
    );
    return restored;
  }

  private async navigateToPoint(
    point: Vec2,
    pursuitMonsterId?: string,
    navigationTarget?: Vec2,
    routeFirstPoint?: Vec2,
  ): Promise<{ action: string }> {
    const live = await this.state();
    if (live.phase !== "playing") return { action: "terminal" };
    const geometry = await this.geometry();
    const manifest = await this.manifest();
    const serviceOpen = await this.page.locator("#city-services").isVisible();
    const project = (world: Vec2) => {
      const projected = screenFor(world, manifest.camera);
      return {
        x:
          geometry.canvas.x +
          (projected.x / VIEW_WIDTH) * geometry.canvas.width,
        y:
          geometry.canvas.y +
          (projected.y / VIEW_HEIGHT) * geometry.canvas.height,
      };
    };
    const waypointPoint = project(point);
    const navigationPoint = navigationTarget ? project(navigationTarget) : null;
    const pursuitCall = pursuitMonsterId
      ? manifest.drawCalls.find(
          ({ entityId, type, visible }) =>
            entityId === pursuitMonsterId && type === "monster" && visible,
        )
      : undefined;
    const pursuitPoint = pursuitCall
      ? {
          x:
            geometry.canvas.x +
            ((pursuitCall.destinationRect.x +
              pursuitCall.destinationRect.width / 2) /
              VIEW_WIDTH) *
              geometry.canvas.width,
          y:
            geometry.canvas.y +
            ((pursuitCall.destinationRect.y +
              pursuitCall.destinationRect.height * 0.45) /
              VIEW_HEIGHT) *
              geometry.canvas.height,
        }
      : undefined;
    const inViewport = (devicePoint: { x: number; y: number }) =>
      !serviceOpen &&
      devicePoint.x >= 8 &&
      devicePoint.x <= this.profile.viewport.width - 8 &&
      devicePoint.y >= 56 &&
      devicePoint.y <=
        (geometry.controls?.y ?? this.profile.viewport.height) - 8;
    if ((await this.state()).phase !== "playing") return { action: "terminal" };
    let devicePoint: { x: number; y: number } | null = null;
    const navigationCandidates = this.profile.hasTouch
      ? [pursuitPoint, waypointPoint, navigationPoint]
      : [pursuitPoint, navigationPoint, waypointPoint];
    for (const candidate of navigationCandidates) {
      if (!candidate || !inViewport(candidate)) continue;
      const candidateHitTarget = await this.page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return {
          tagName: element?.tagName ?? null,
          className: element instanceof HTMLElement ? element.className : null,
        };
      }, candidate);
      if (candidateHitTarget.tagName === "CANVAS") {
        devicePoint = candidate;
        break;
      }
    }
    if (!devicePoint) {
      const fallback = await this.state();
      const fallbackTarget = this.profile.hasTouch
        ? point
        : (routeFirstPoint ?? point);
      await this.pulse(
        physicalDirection(fallback, fallbackTarget),
        this.profile.hasTouch ? 800 : 220,
      );
      return {
        action: this.profile.hasTouch ? "joystick-pulse" : "keyboard-pulse",
      };
    }
    const pursuing = pursuitPoint === devicePoint;
    if (!this.profile.hasTouch || pursuing) {
      await this.page.mouse.click(devicePoint.x, devicePoint.y);
      return { action: pursuing ? "mouse-pursuit" : "mouse-route" };
    }
    await this.page.touchscreen.tap(devicePoint.x, devicePoint.y);
    return { action: "touch-route" };
  }

  private async pulse(direction: Vec2, durationMs = 220): Promise<void> {
    const x = Math.sign(direction.x);
    const y = Math.sign(direction.y);
    if (x === 0 && y === 0) return;
    if (!this.profile.hasTouch) {
      const keys = [
        x < 0 ? "a" : x > 0 ? "d" : null,
        y < 0 ? "w" : y > 0 ? "s" : null,
      ].filter((key): key is string => key !== null);
      const pressed: string[] = [];
      try {
        this.assertBudget("keyboard pulse");
        for (const key of keys) {
          await this.page.keyboard.down(key);
          pressed.push(key);
        }
        await this.page.waitForTimeout(durationMs);
      } finally {
        for (const key of pressed.reverse()) await this.page.keyboard.up(key);
      }
      return;
    }
    const bounds = (await this.geometry()).movePad;
    if (!bounds || !this.session)
      throw new Error("Touch movement controls unavailable");
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const length = Math.max(1, Math.hypot(x, y));
    const radius = Math.min(bounds.width, bounds.height) * 0.3;
    const target = {
      x: center.x + (x / length) * radius,
      y: center.y + (y / length) * radius,
    };
    await this.session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...center, id: 31, radiusX: 1, radiusY: 1, force: 1 }],
    });
    try {
      await this.session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...target, id: 31, radiusX: 1, radiusY: 1, force: 1 }],
      });
      await this.page.waitForTimeout(durationMs);
    } finally {
      await this.session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
  }

  private async stopNavigation(): Promise<void> {
    if (!this.profile.hasTouch) {
      try {
        await this.page.keyboard.down("a");
        await this.page.waitForTimeout(25);
      } finally {
        await this.page.keyboard.up("a");
      }
      this.record("stop-navigation", { input: "keyboard" });
      return;
    }
    const bounds = (await this.geometry()).movePad;
    if (!bounds || !this.session)
      throw new Error("Touch movement controls unavailable");
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    await this.session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...center, id: 32, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await this.session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    this.record("stop-navigation", { input: "touch-center" });
  }

  private async holdStrike(
    monsterId: string,
    durationMs: number,
  ): Promise<void> {
    await this.startStrike();
    const started = Date.now();
    let nextCombatStepAt = started;
    try {
      while (Date.now() - started < durationMs) {
        this.assertBudget(`attack ${monsterId}`);
        const state = await this.state();
        const target = state.monsters.find(({ id }) => id === monsterId);
        if (state.phase !== "playing" || !target || target.health <= 0) return;
        await this.maybeUseTonic(state);
        await this.evadeProjectile(state);
        if (await this.escapeIfNeeded(state)) return;
        if (
          state.player.abilityReadyTick <= state.tick &&
          hasVanguardAbilityTarget(state)
        )
          await this.useAbility();
        if (Date.now() >= nextCombatStepAt) {
          await this.pulse(
            physicalDirection(state, target.position),
            this.profile.hasTouch ? 220 : 180,
          );
          nextCombatStepAt = Date.now() + 450;
        }
        await this.page.waitForTimeout(75);
      }
    } finally {
      await this.stopStrike();
    }
  }

  private async startStrike(): Promise<void> {
    if (this.strikeActive) return;
    this.strikeActive = true;
    try {
      this.assertBudget("start strike");
      await this.page.keyboard.down(" ");
    } catch (error) {
      this.strikeActive = false;
      throw error;
    }
    this.record("hold-strike-start");
  }

  private async stopStrike(): Promise<void> {
    if (!this.strikeActive) return;
    this.strikeActive = false;
    await this.page.keyboard.up(" ");
    this.record("hold-strike-end");
  }

  private async useTonic(): Promise<void> {
    if (this.profile.hasTouch) {
      const button = this.page.locator(".mobile-actions [data-action='tonic']");
      await button.tap();
    } else await this.page.keyboard.press("q");
    this.record("use-tonic");
  }

  private async maybeUseTonic(state: GameState): Promise<void> {
    if (
      state.player.tonics > 0 &&
      state.player.health <= state.player.maxHealth - 40
    )
      await this.useTonic();
  }

  private async useAbility(): Promise<void> {
    await this.page.keyboard.press("e");
    this.record("use-ability");
  }

  private async evadeProjectile(state: GameState): Promise<boolean> {
    const pending = state.pendingAttacks
      .filter((attack) => {
        const owner = state.monsters.find(({ id }) => id === attack.ownerId);
        return (
          owner?.kind === "hexer" &&
          attack.kind === "primary" &&
          attack.impactTick >= state.tick &&
          attack.impactTick - state.tick <= 30
        );
      })
      .sort((first, second) => first.impactTick - second.impactTick)[0];
    const projectileThreat = imminentProjectile(state);
    if (
      !pending &&
      (!projectileThreat || !Number.isFinite(projectileThreat.time))
    )
      return false;
    const threatId = pending?.id ?? projectileThreat!.projectile.id;
    if (this.dodgedProjectiles.has(threatId)) return false;
    this.dodgedProjectiles.add(threatId);
    const velocity = pending
      ? {
          x: pending.direction.x,
          y: pending.direction.y,
        }
      : projectileThreat!.projectile.velocity;
    const sideways = {
      x: -velocity.y,
      y: velocity.x,
    };
    const length = Math.max(1, Math.hypot(sideways.x, sideways.y));
    await this.pulse(
      physicalDirection(state, {
        x: state.player.position.x + (sideways.x / length) * UNITS_PER_TILE,
        y: state.player.position.y + (sideways.y / length) * UNITS_PER_TILE,
      }),
      this.profile.hasTouch ? 300 : 220,
    );
    this.record("hexer-projectile-dodge", {
      projectileId: threatId,
      remainingTicks: pending
        ? pending.impactTick - state.tick
        : Math.round(projectileThreat!.time),
    });
    return true;
  }

  private async escapeIfNeeded(currentState?: GameState): Promise<boolean> {
    const state = currentState ?? (await this.state());
    const attack = state.pendingAttacks.find(
      (candidate) =>
        candidate.impactTick >= state.tick &&
        bellKeeperSlam(state, candidate) &&
        distance(state.player.position, candidate.origin) <= candidate.range,
    );
    if (!attack) return false;
    await this.stopStrike();
    const away = {
      x: state.player.position.x - attack.origin.x,
      y: state.player.position.y - attack.origin.y,
    };
    const direction =
      Math.hypot(away.x, away.y) > 1 ? away : { x: -UNITS_PER_TILE, y: 0 };
    await this.pulse(direction, 380);
    this.record("bell-keeper-dodge", {
      attackId: attack.id,
      remainingTicks: attack.impactTick - state.tick,
    });
    return true;
  }

  private record(action: string, details?: Record<string, unknown>): void {
    this.gestures.push({
      atMs: Date.now() - this.startedAt,
      action,
      ...(details ? { details } : {}),
    });
  }

  private assertBudget(label: string): void {
    const elapsed = Date.now() - this.startedAt;
    if (elapsed >= CampaignBrowserDriver.JOURNEY_BUDGET_MS)
      throw new Error(
        `${label} exceeded the ${CampaignBrowserDriver.JOURNEY_BUDGET_MS}ms physical journey budget`,
      );
  }
}

function stateSummary(state: GameState): Record<string, unknown> {
  return {
    tick: state.tick,
    phase: state.phase,
    position: state.player.position,
    health: state.player.health,
    tonics: state.player.tonics,
    kills: state.metrics.kills,
    livingMonsters: state.monsters
      .filter(({ health }) => health > 0)
      .map(({ id, kind, health, position }) => ({
        id,
        kind,
        health,
        position,
      })),
    lastEvents: state.eventLog.slice(-6),
  };
}
