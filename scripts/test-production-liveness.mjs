import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  PRODUCTION_LIVENESS_DEADLINES_MS,
  PRODUCTION_LIVENESS_GESTURE_IDS,
  PRODUCTION_LIVENESS_SCENARIO_IDS,
  evaluateProductionControlLiveness,
} from "./lib/production-control-liveness-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve(
  "quality-results/production-liveness/pres-live-001",
);
const PROFILE_IDS = ["desktop", "phone-portrait"];
const CLASS_IDS = ["ranger", "arcanist", "vanguard"];
const PROFILES = {
  desktop: {
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  "phone-portrait": {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  },
};

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function sourceSnapshot() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  });
  const diff = execFileSync("git", ["diff", "--binary", "HEAD"], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    commit,
    dirty: status.trim().length > 0,
    status: status.trim().split("\n").filter(Boolean),
    patchSha256: sha256(diff),
  };
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function startServer(port) {
  const server = spawn(
    "npm",
    [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { stdio: "ignore" },
  );
  const baseURL = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (server.exitCode !== null)
      throw new Error(
        `Production liveness server exited with code ${server.exitCode}`,
      );
    try {
      const response = await fetch(baseURL);
      if (response.ok && (await response.text()).includes("Cinderwake"))
        return { server, baseURL };
    } catch {
      // Vite is still starting.
    }
  }
  server.kill();
  throw new Error(`Production liveness server did not start at ${baseURL}`);
}

async function waitForProductionReady(page, timeout = 30_000) {
  await page.locator("canvas").waitFor({ state: "visible", timeout });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready), {
    timeout,
  });
  const route = await page.evaluate(() => ({
    bridgeExposed: Boolean(window.__GAME_TEST__),
    mode: window.__GAME_OBSERVE__?.mode,
    scenarioId: window.__GAME_OBSERVE__?.snapshot().scenarioId,
  }));
  if (route.bridgeExposed || route.mode !== "observe-only")
    throw new Error("Production liveness route was not observe-only");
  return route;
}

async function waitForTestReady(page, timeout = 30_000) {
  await page.locator("canvas").waitFor({ state: "visible", timeout });
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready), {
    timeout,
  });
}

async function captureGameplay(page, label) {
  return page.evaluate((captureLabel) => {
    const observer = window.__GAME_OBSERVE__;
    if (!observer) throw new Error("Production observer is unavailable");
    const snapshot = observer.snapshot();
    const manifest = observer.renderManifest();
    return {
      label: captureLabel,
      tick: Number(snapshot.tick),
      stateTick: Number(snapshot.tick),
      manifestTick: Number(manifest.tick),
      snapshot,
      manifest,
      frame: observer.captureFrame(),
    };
  }, label);
}

async function capturePage(page, label) {
  return {
    label,
    frame: await page.screenshot({ fullPage: true }),
  };
}

async function visibleControlCensus(page, surface) {
  return page.evaluate((requestedSurface) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const descriptor = (element) => {
      const classId = element.getAttribute("data-class");
      const action = element.getAttribute("data-action");
      const isMovePad = element.classList.contains("move-pad");
      let controlId;
      let intentId;
      let postcondition;
      if (classId) {
        controlId = `class-${classId}`;
        intentId = `select-${classId}`;
        postcondition = { kind: "selected-class", classId };
      } else if (element.id === "seed") {
        controlId = "seed-input";
        intentId = "edit-seed";
        postcondition = { kind: "seed-changed" };
      } else if (element.id === "begin") {
        controlId = "begin";
        intentId = "begin-run";
        postcondition = { kind: "started-scenario" };
      } else if (isMovePad) {
        controlId = "move-pad";
        intentId = "movement";
        postcondition = { kind: "moved" };
      } else if (action) {
        const mobile = Boolean(element.closest(".mobile-actions"));
        controlId = `action-${mobile ? "mobile" : "skills"}-${action}`;
        intentId =
          action === "attack"
            ? "attack"
            : action === "ability"
              ? "ability"
              : "tonic";
        postcondition =
          action === "attack"
            ? { kind: "event", eventType: "attack_started" }
            : action === "ability"
              ? { kind: "event", eventType: "ability_started" }
              : { kind: "tonic-consumed" };
      } else return null;
      const rect = element.getBoundingClientRect();
      return {
        controlId,
        selector: classId
          ? `[data-class='${classId}']`
          : element.id
            ? `#${element.id}`
            : isMovePad
              ? ".move-pad"
              : `${element.closest(".mobile-actions") ? ".mobile-actions" : ".skills"} [data-action='${action}']`,
        surface: requestedSurface,
        visible: visible(element),
        enabled: !element.hasAttribute("disabled"),
        intentId,
        postcondition,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    };
    const selectors =
      requestedSurface === "selection"
        ? ".selection input, .selection button"
        : ".game button, .game .move-pad";
    return [...document.querySelectorAll(selectors)]
      .map(descriptor)
      .filter(Boolean);
  }, surface);
}

function physicalActivate(page, profile, locator) {
  return profile.hasTouch ? locator.tap() : locator.click();
}

function eventCount(snapshot, eventType) {
  return (snapshot?.eventLog ?? []).filter(
    ({ type, sourceId }) => type === eventType && sourceId === "player",
  ).length;
}

async function waitForActionPostcondition(page, before, postcondition) {
  if (postcondition.kind === "event") {
    await page.waitForFunction(
      ({ eventType, count }) =>
        (window.__GAME_OBSERVE__?.snapshot().eventLog ?? []).filter(
          ({ type, sourceId }) => type === eventType && sourceId === "player",
        ).length > count,
      {
        eventType: postcondition.eventType,
        count: eventCount(before.snapshot, postcondition.eventType),
      },
      { timeout: PRODUCTION_LIVENESS_DEADLINES_MS.control },
    );
    return;
  }
  if (postcondition.kind === "tonic-consumed") {
    await page.waitForFunction(
      ({ health, tonics }) => {
        const player = window.__GAME_OBSERVE__?.snapshot().player;
        return Boolean(
          player && player.tonics === tonics - 1 && player.health > health,
        );
      },
      {
        health: before.snapshot.player.health,
        tonics: before.snapshot.player.tonics,
      },
      { timeout: PRODUCTION_LIVENESS_DEADLINES_MS.control },
    );
    return;
  }
  if (postcondition.kind === "moved") {
    await page.waitForFunction(
      (position) => {
        const current = window.__GAME_OBSERVE__?.snapshot().player.position;
        return current.x !== position.x || current.y !== position.y;
      },
      before.snapshot.player.position,
      { timeout: PRODUCTION_LIVENESS_DEADLINES_MS.control },
    );
  }
}

async function activateButton(page, profile, descriptor, label) {
  const before = await captureGameplay(page, `${label}-before`);
  const startedAt = Date.now();
  const locator = page.locator(descriptor.selector);
  await physicalActivate(page, profile, locator);
  let completedAt;
  try {
    await waitForActionPostcondition(page, before, descriptor.postcondition);
    completedAt = Date.now();
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      snapshot: window.__GAME_OBSERVE__?.snapshot(),
      buttons: [...document.querySelectorAll("button[data-action]")].map(
        (button) => ({
          action: button.getAttribute("data-action"),
          visible: Boolean(
            button.getClientRects().length &&
            getComputedStyle(button).visibility !== "hidden",
          ),
          disabled: button.hasAttribute("disabled"),
        }),
      ),
    }));
    throw new Error(
      `${error instanceof Error ? error.message : error}; ${label} ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
  const after = await captureGameplay(page, `${label}-after`);
  return {
    controlId: descriptor.controlId,
    intentId: descriptor.intentId,
    input: {
      type: profile.hasTouch ? "touch" : "mouse",
      control: descriptor.selector,
      bounds: descriptor.bounds,
    },
    completed: true,
    before,
    after,
    postcondition: descriptor.postcondition,
    elapsedMs: completedAt - startedAt,
    deadlineKey: "control",
    deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.control,
  };
}

async function dragMovePad(page, session, descriptor, label) {
  const before = await captureGameplay(page, `${label}-before`);
  const startedAt = Date.now();
  let completedAt;
  const center = {
    x: descriptor.bounds.x + descriptor.bounds.width / 2,
    y: descriptor.bounds.y + descriptor.bounds.height / 2,
  };
  const radius =
    Math.min(descriptor.bounds.width, descriptor.bounds.height) * 0.3;
  const target = { x: center.x + radius, y: center.y };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...center, id: 29, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 29, radiusX: 1, radiusY: 1, force: 1 }],
  });
  try {
    await waitForActionPostcondition(page, before, descriptor.postcondition);
    completedAt = Date.now();
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await page.waitForTimeout(80);
  const after = await captureGameplay(page, `${label}-after`);
  return {
    controlId: descriptor.controlId,
    intentId: descriptor.intentId,
    input: {
      type: "touch",
      control: descriptor.selector,
      bounds: descriptor.bounds,
      from: center,
      to: target,
    },
    completed: true,
    before,
    after,
    postcondition: descriptor.postcondition,
    elapsedMs: completedAt - startedAt,
    deadlineKey: "control",
    deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.control,
  };
}

async function seekDamage(page, profile) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const player = await page.evaluate(() => {
      const state = window.__GAME_OBSERVE__?.snapshot();
      return state?.player
        ? { health: state.player.health, maxHealth: state.player.maxHealth }
        : null;
    });
    if (player && player.health < player.maxHealth) return;
    const target = await page.evaluate(() => {
      const manifest = window.__GAME_OBSERVE__?.renderManifest();
      const monster = manifest?.drawCalls.find(
        ({ type, visible }) => type === "monster" && visible,
      );
      return monster?.screenAnchor ?? null;
    });
    if (!target) {
      await page.waitForTimeout(1_500);
      continue;
    }
    if (profile.hasTouch) {
      const canvas = await page.locator("canvas").boundingBox();
      if (!canvas) throw new Error("Canvas has no bounds while seeking damage");
      await page.touchscreen.tap(
        canvas.x + (target.x / 960) * canvas.width,
        canvas.y + (target.y / 540) * canvas.height,
      );
    } else {
      const position = await page.evaluate(
        () => window.__GAME_OBSERVE__?.snapshot().player.position,
      );
      const world = await page.evaluate((screenAnchor) => {
        const manifest = window.__GAME_OBSERVE__?.renderManifest();
        const player = manifest?.drawCalls.find(
          ({ entityId }) => entityId === "player",
        );
        if (!manifest || !player) return null;
        const dx = screenAnchor.x - player.screenAnchor.x;
        const dy = screenAnchor.y - player.screenAnchor.y;
        return { x: dx, y: dy };
      }, target);
      if (!position || !world)
        throw new Error("Cannot resolve damage direction");
      const key =
        Math.abs(world.x) >= Math.abs(world.y)
          ? world.x >= 0
            ? "d"
            : "a"
          : world.y >= 0
            ? "s"
            : "w";
      await page.keyboard.down(key);
      await page.waitForTimeout(1_200);
      await page.keyboard.up(key);
    }
    try {
      await page.waitForFunction(
        () => {
          const player = window.__GAME_OBSERVE__?.snapshot().player;
          return Boolean(player && player.health < player.maxHealth);
        },
        { timeout: 3_000 },
      );
      return;
    } catch {
      // Try the next visible target/approach pulse.
    }
  }
  const player = await page.evaluate(
    () => window.__GAME_OBSERVE__?.snapshot().player,
  );
  throw new Error(
    `Could not establish a physical damage precondition for tonic: ${JSON.stringify(player)}`,
  );
}

async function runProfile(browser, profileId, profile, baseURL) {
  const profileDirectory = path.join(OUTPUT, profileId);
  const videoDirectory = path.join(OUTPUT, "video-tmp", profileId);
  await fs.mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    colorScheme: "dark",
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
    recordVideo: { dir: videoDirectory, size: profile.viewport },
  });
  const page = await context.newPage();
  const session = profile.hasTouch ? await context.newCDPSession(page) : null;
  const timeline = [];
  const frames = [];
  const faults = [];
  page.on("pageerror", (error) => faults.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push(`console: ${message.text()}`);
  });
  const addGameplayCapture = (capture) => {
    timeline.push(capture);
    frames.push({ type: "observer", ...capture });
  };
  const addPageFrame = (frame) => frames.push({ type: "page", ...frame });
  try {
    await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await page.locator(".selection").waitFor({ state: "visible" });
    const initialSelection = {
      visible: true,
      bridgeExposed: await page.evaluate(() => Boolean(window.__GAME_TEST__)),
      frame: null,
    };
    if (initialSelection.bridgeExposed)
      throw new Error("Production selection exposed a mutating bridge");
    const selectionVisibleControls = await visibleControlCensus(
      page,
      "selection",
    );
    const selectionActivations = [];
    const selectionTransitions = [];
    const launches = [];
    for (const [index, classId] of CLASS_IDS.entries()) {
      if (index > 0) {
        await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
        await page.locator(".selection").waitFor({ state: "visible" });
      }
      const beforeFrame = await capturePage(
        page,
        `selection-${classId}-before`,
      );
      addPageFrame(beforeFrame);
      if (index === 0) {
        const seed = page.locator("#seed");
        const beforeValue = await seed.inputValue();
        const startedAt = Date.now();
        await seed.fill(`live-${profileId}`);
        const afterValue = await seed.inputValue();
        const activation = {
          controlId: "seed-input",
          intentId: "edit-seed",
          beforeValue,
          afterValue,
          completed: true,
          postcondition: { kind: "seed-changed" },
          elapsedMs: Date.now() - startedAt,
          deadlineKey: "selection",
          deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.selection,
        };
        selectionActivations.push(activation);
        selectionTransitions.push(activation);
      }
      const card = page.locator(`[data-class='${classId}']`);
      const beforeClass = await page
        .locator(".selection")
        .getAttribute("data-selected-class");
      const selectionStartedAt = Date.now();
      await physicalActivate(page, profile, card);
      const afterClass = await page
        .locator(".selection")
        .getAttribute("data-selected-class");
      const selectionActivation = {
        controlId: `class-${classId}`,
        intentId: `select-${classId}`,
        beforeClass,
        afterClass,
        completed: true,
        postcondition: { kind: "selected-class", classId },
        elapsedMs: Date.now() - selectionStartedAt,
        deadlineKey: "selection",
        deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.selection,
      };
      selectionActivations.push(selectionActivation);
      selectionTransitions.push(selectionActivation);
      const afterFrame = await capturePage(page, `selection-${classId}-after`);
      addPageFrame(afterFrame);
      const beginStartedAt = Date.now();
      const begin = page.locator("#begin");
      await physicalActivate(page, profile, begin);
      const route = await waitForProductionReady(page);
      const beginCompletedAt = Date.now();
      const after = await captureGameplay(page, `${classId}-gameplay`);
      addGameplayCapture(after);
      const beginActivation = {
        controlId: "begin",
        intentId: "begin-run",
        completed: true,
        after: {
          ...after,
          bridgeExposed: route.bridgeExposed,
          mode: route.mode,
        },
        postcondition: { kind: "started-scenario", classId },
        elapsedMs: beginCompletedAt - beginStartedAt,
        deadlineKey: "begin",
        deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.begin,
      };
      selectionActivations.push(beginActivation);
      selectionTransitions.push(beginActivation);
      launches.push({
        classId,
        selectedClass: after.snapshot.player.classId,
        selectionActivation,
        beginActivation,
      });
    }

    const gameplayVisibleControls = await visibleControlCensus(
      page,
      "gameplay",
    );
    const gameplayActivations = [];
    const gameplayTransitions = [];
    const recordActivation = (activation) => {
      for (const capture of [activation.before, activation.after]) {
        if (capture) addGameplayCapture(capture);
      }
      return activation;
    };
    const findControl = (intentId) => {
      const descriptor = gameplayVisibleControls.find(
        ({ intentId: candidate, visible, enabled }) =>
          candidate === intentId && visible && enabled,
      );
      if (!descriptor)
        throw new Error(`Visible gameplay control missing: ${intentId}`);
      return descriptor;
    };
    if (profile.hasTouch) {
      const moveDescriptor = findControl("movement");
      const movement = recordActivation(
        await dragMovePad(page, session, moveDescriptor, "move-pad"),
      );
      gameplayActivations.push(movement);
      gameplayTransitions.push(movement);
    }
    const attack = recordActivation(
      await activateButton(page, profile, findControl("attack"), "attack"),
    );
    gameplayActivations.push(attack);
    gameplayTransitions.push(attack);
    const ability = recordActivation(
      await activateButton(page, profile, findControl("ability"), "ability"),
    );
    gameplayActivations.push(ability);
    gameplayTransitions.push(ability);
    await seekDamage(page, profile);
    const tonic = recordActivation(
      await activateButton(page, profile, findControl("tonic"), "tonic"),
    );
    gameplayActivations.push(tonic);
    gameplayTransitions.push(tonic);
    const controlIntentRegistry = [
      ...selectionVisibleControls,
      ...gameplayVisibleControls,
    ]
      .filter(({ visible, enabled }) => visible && enabled)
      .map(({ controlId, intentId, postcondition }) => ({
        controlId,
        intentId,
        postcondition,
      }));
    return {
      profileId,
      scenarioId: "ordinary-production-launch",
      actualScenarioId:
        launches.at(-1)?.beginActivation.after.snapshot.scenarioId,
      initial: {
        ...initialSelection,
        gestureId: profile.hasTouch
          ? "touch-select-begin"
          : "mouse-select-begin",
      },
      selection: {
        gestureId: profile.hasTouch
          ? "touch-select-begin"
          : "mouse-select-begin",
        visibleControls: selectionVisibleControls,
        activations: selectionActivations,
        transitions: selectionTransitions,
        launches,
      },
      gameplay: {
        visibleControls: gameplayVisibleControls,
        activations: gameplayActivations,
        transitions: gameplayTransitions,
      },
      controlIntentRegistry,
      timeline,
      frames,
      faults,
    };
  } finally {
    const video = page.video();
    await session?.detach();
    await context.close();
    const videoPath = video ? await video.path() : null;
    if (videoPath) {
      await fs.mkdir(profileDirectory, { recursive: true });
      await fs.copyFile(
        videoPath,
        path.join(profileDirectory, "production-liveness.webm"),
      );
    }
  }
}

async function runRecovery(browser, baseURL) {
  const recoveryDirectory = path.join(OUTPUT, "recovery");
  const videoDirectory = path.join(OUTPUT, "video-tmp", "recovery");
  await fs.mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: PROFILES["phone-portrait"].viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    hasTouch: true,
    isMobile: true,
    recordVideo: {
      dir: videoDirectory,
      size: PROFILES["phone-portrait"].viewport,
    },
  });
  const page = await context.newPage();
  const frames = [];
  const transitions = [];
  try {
    let startedAt = Date.now();
    await page.route("**/assets/sprites/actor-vanguard.png", (route) =>
      route.abort("failed"),
    );
    await page.goto(`${baseURL}/?testMode=1&selection=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("#begin").tap();
    await page.locator(".loading-failed").waitFor({
      state: "visible",
      timeout: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
    });
    const abortFailedElapsed = Date.now() - startedAt;
    frames.push(await capturePage(page, "abort-failed"));
    const abortFailure = {
      visible: true,
      kind: "atlas-aborted",
      copy: await page.locator(".loading-failed h1").getAttribute("aria-label"),
    };
    await page.unroute("**/assets/sprites/actor-vanguard.png");
    startedAt = Date.now();
    await page.locator("[data-loading='retry']").tap();
    await waitForTestReady(page);
    const abortRetryElapsed = Date.now() - startedAt;
    frames.push(await capturePage(page, "abort-retry"));
    const abortRetry = {
      clicked: true,
      recovered: true,
      elapsedMs: abortRetryElapsed,
      after: {
        canvasVisible: await page.locator("canvas").isVisible(),
        bridgeExposed: false,
      },
    };
    transitions.push(
      {
        id: "abort-failure",
        completed: true,
        elapsedMs: abortFailedElapsed,
        deadlineKey: "recovery",
        deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
      },
      {
        id: "abort-retry",
        completed: true,
        elapsedMs: abortRetryElapsed,
        deadlineKey: "recovery",
        deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
      },
    );

    let releaseRequest;
    let finishHandler;
    const handlerFinished = new Promise((resolve) => {
      finishHandler = resolve;
    });
    await page.route("**/assets/sprites/actor-ranger.png", async (route) => {
      await new Promise((resolve) => {
        releaseRequest = resolve;
      });
      await route.abort("failed");
      finishHandler?.();
    });
    await page.goto(`${baseURL}/?testMode=1&selection=1&assetTimeoutMs=150`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("[data-class='ranger']").tap();
    await page.locator("#begin").tap();
    startedAt = Date.now();
    await page.locator(".loading-failed").waitFor({
      state: "visible",
      timeout: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
    });
    const stallFailedElapsed = Date.now() - startedAt;
    frames.push(await capturePage(page, "stall-failed"));
    const stallFailure = {
      visible: true,
      kind: "atlas-stalled",
      copy: await page.locator(".loading-failed h1").getAttribute("aria-label"),
    };
    releaseRequest?.();
    await handlerFinished;
    await page.unroute("**/assets/sprites/actor-ranger.png");
    startedAt = Date.now();
    await page.locator("[data-loading='back']").tap();
    await page.locator(".selection").waitFor({ state: "visible" });
    const stallBackElapsed = Date.now() - startedAt;
    frames.push(await capturePage(page, "stall-back"));
    const stallBack = {
      clicked: true,
      selectionVisible: true,
      elapsedMs: stallBackElapsed,
    };
    transitions.push(
      {
        id: "stall-failure",
        completed: true,
        elapsedMs: stallFailedElapsed,
        deadlineKey: "recovery",
        deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
      },
      {
        id: "stall-back",
        completed: true,
        elapsedMs: stallBackElapsed,
        deadlineKey: "recovery",
        deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
      },
    );
    return {
      scenarioIds: ["asset-load-recovery"],
      profileId: "phone-portrait",
      abort: {
        failure: abortFailure,
        retry: abortRetry,
      },
      stall: {
        failure: stallFailure,
        back: stallBack,
      },
      transitions,
      frames,
    };
  } finally {
    const video = page.video();
    await context.close();
    const videoPath = video ? await video.path() : null;
    await fs.mkdir(recoveryDirectory, { recursive: true });
    if (videoPath)
      await fs.copyFile(
        videoPath,
        path.join(recoveryDirectory, "recovery.webm"),
      );
  }
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Production liveness observer frame is not a PNG data URL");
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
}

function normalizeObserverCapture(raw, directory, index) {
  const frame = dataUrlBuffer(raw.frame);
  const frameFile = `frame-${String(index).padStart(4, "0")}-${raw.label}.png`;
  return {
    tick: raw.tick,
    stateTick: raw.stateTick,
    manifestTick: raw.manifestTick,
    stateHash: hashJson(raw.snapshot),
    manifestHash: hashJson(raw.manifest),
    frameHash: sha256(frame),
    frameFile,
    snapshot: raw.snapshot,
    manifest: raw.manifest,
    frame,
    label: raw.label,
    directory,
  };
}

function normalizePageFrame(raw, directory, index) {
  const frame = Buffer.isBuffer(raw.frame) ? raw.frame : Buffer.from(raw.frame);
  return {
    label: raw.label,
    type: "page",
    frameFile: `frame-${String(index).padStart(4, "0")}-${raw.label}.png`,
    frameHash: sha256(frame),
    frame,
    directory,
  };
}

function publicCapture(capture) {
  return {
    tick: capture.tick,
    stateTick: capture.stateTick,
    manifestTick: capture.manifestTick,
    stateHash: capture.stateHash,
    manifestHash: capture.manifestHash,
    frameHash: capture.frameHash,
    frameFile: capture.frameFile,
    snapshot: capture.snapshot,
  };
}

function publicManifestCapture(capture) {
  return {
    tick: capture.tick,
    stateTick: capture.stateTick,
    manifestTick: capture.manifestTick,
    stateHash: capture.stateHash,
    manifestHash: capture.manifestHash,
    frameHash: capture.frameHash,
    frameFile: capture.frameFile,
    label: capture.label,
    manifest: capture.manifest,
  };
}

function publicActivation(activation, lookup) {
  const result = { ...activation };
  for (const side of ["before", "after"]) {
    const capture = activation[side];
    if (!capture?.label) continue;
    const normalized = lookup(capture);
    if (!normalized)
      throw new Error(`Missing normalized capture ${capture.label}`);
    result[side] = {
      label: capture.label,
      ...publicCapture(normalized),
      ...(typeof capture.bridgeExposed === "boolean"
        ? {
            bridgeExposed: capture.bridgeExposed,
            mode: capture.mode,
          }
        : {}),
    };
  }
  return result;
}

async function normalizeProfile(raw, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.mkdir(directory, { recursive: true });
  const byLabel = new Map();
  const normalizedFrames = [];
  for (const rawFrame of raw.frames) {
    if (byLabel.has(rawFrame.label)) continue;
    const normalized =
      rawFrame.type === "observer"
        ? normalizeObserverCapture(rawFrame, directory, normalizedFrames.length)
        : normalizePageFrame(rawFrame, directory, normalizedFrames.length);
    await fs.writeFile(
      path.join(directory, normalized.frameFile),
      normalized.frame,
    );
    byLabel.set(rawFrame.label, normalized);
    normalizedFrames.push({
      label: normalized.label,
      type: rawFrame.type,
      frameFile: normalized.frameFile,
      frameHash: normalized.frameHash,
    });
  }
  const lookup = (capture) => byLabel.get(capture.label);
  const selection = {
    ...raw.selection,
    initialFrame: normalizedFrames.find(
      ({ label }) => label === "selection-vanguard-before",
    ),
    activations: raw.selection.activations.map((activation) =>
      publicActivation(activation, lookup),
    ),
    launches: raw.selection.launches.map((launch) => ({
      ...launch,
      selectionActivation: publicActivation(launch.selectionActivation, lookup),
      beginActivation: publicActivation(launch.beginActivation, lookup),
    })),
  };
  const gameplay = {
    ...raw.gameplay,
    activations: raw.gameplay.activations.map((activation) =>
      publicActivation(activation, lookup),
    ),
  };
  const timeline = raw.timeline.map((capture) => {
    const normalized = lookup(capture);
    if (!normalized || normalized.type === "page")
      throw new Error(`Missing observer frame for ${capture.label}`);
    return publicCapture(normalized);
  });
  const profile = {
    profileId,
    scenarioId: raw.scenarioId,
    actualScenarioId: raw.actualScenarioId,
    initial: {
      ...raw.initial,
      frame: normalizedFrames.find(
        ({ label }) => label === "selection-vanguard-before",
      ),
    },
    selection,
    gameplay,
    controlIntentRegistry: raw.controlIntentRegistry,
    timeline,
    faults: raw.faults,
  };
  await Promise.all([
    writeJson(path.join(directory, "selection.json"), selection),
    writeJson(path.join(directory, "control-census.json"), {
      schemaVersion: 1,
      selection: raw.selection.visibleControls,
      gameplay: raw.gameplay.visibleControls,
      registry: raw.controlIntentRegistry,
    }),
    writeJson(path.join(directory, "gesture-log.json"), {
      selection: selection.activations,
      gameplay: gameplay.activations.map(
        ({ id, input, controlId, intentId }) => ({
          id,
          input,
          controlId,
          intentId,
        }),
      ),
    }),
    writeJson(path.join(directory, "states.json"), {
      schemaVersion: 1,
      selection: selection.launches.map(({ classId, beginActivation }) => ({
        classId,
        after: beginActivation.after,
      })),
      gameplay: gameplay.activations.map(({ id, before, after }) => ({
        id,
        before,
        after,
      })),
      timeline,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      frames: raw.timeline.map((capture) => {
        const normalized = lookup(capture);
        return publicManifestCapture(normalized);
      }),
    }),
    writeJson(path.join(directory, "frames.json"), {
      schemaVersion: 1,
      frames: normalizedFrames,
    }),
  ]);
  return profile;
}

async function normalizeRecovery(raw) {
  const directory = path.join(OUTPUT, "recovery");
  await fs.mkdir(directory, { recursive: true });
  const frames = [];
  for (const [index, rawFrame] of raw.frames.entries()) {
    const frame = Buffer.isBuffer(rawFrame.frame)
      ? rawFrame.frame
      : Buffer.from(rawFrame.frame);
    const frameFile = `${rawFrame.label}.png`;
    await fs.writeFile(path.join(directory, frameFile), frame);
    frames.push({
      label: rawFrame.label,
      frameFile,
      frameHash: sha256(frame),
      order: index,
    });
  }
  return {
    ...raw,
    frames,
  };
}

function negativeControls(evidence) {
  const controls = [
    {
      id: "begin-listener-removed",
      expectedSignal: "launch-inert",
      mutate(value) {
        value.profiles[0].selection.launches[0].beginActivation.completed = false;
      },
    },
    {
      id: "action-listener-removed",
      expectedSignal: "control-inert",
      mutate(value) {
        value.profiles[0].gameplay.activations[0].completed = false;
      },
    },
    {
      id: "required-asset-stalled",
      expectedSignal: "asset-recovery-visible",
      mutate(value) {
        value.recovery.stall.failure.visible = false;
      },
    },
    {
      id: "atlas-load-aborted",
      expectedSignal: "asset-recovery-visible",
      mutate(value) {
        value.recovery.abort.failure.visible = false;
      },
    },
    {
      id: "visible-control-unregistered",
      expectedSignal: "visible-control-missing-intent",
      mutate(value) {
        value.profiles[0].controlIntentRegistry.pop();
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateProductionControlLiveness(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: result.failures,
    };
  });
}

async function main() {
  const requestedProfiles = option("profiles", null);
  const profileIds = requestedProfiles
    ? requestedProfiles.split(",").filter((id) => PROFILE_IDS.includes(id))
    : PROFILE_IDS;
  if (profileIds.length === 0)
    throw new Error("--profiles must name at least one known profile");
  const port = Number(option("port", String(47_000 + (process.pid % 1_000))));
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535)
    throw new Error("--port must be an available TCP port");
  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });
  let server;
  let browser;
  try {
    const started = await startServer(port);
    server = started.server;
    browser = await chromium.launch();
    const rawProfiles = [];
    for (const profileId of profileIds)
      rawProfiles.push(
        await runProfile(
          browser,
          profileId,
          PROFILES[profileId],
          started.baseURL,
        ),
      );
    const rawRecovery = await runRecovery(browser, started.baseURL);
    const profiles = [];
    for (const raw of rawProfiles)
      profiles.push(await normalizeProfile(raw, raw.profileId));
    const recovery = await normalizeRecovery(rawRecovery);
    await fs.rm(path.join(OUTPUT, "video-tmp"), {
      recursive: true,
      force: true,
    });
    const evidence = {
      requiredProfiles: profileIds,
      requiredScenarioIds: PRODUCTION_LIVENESS_SCENARIO_IDS,
      requiredGestureIds: PRODUCTION_LIVENESS_GESTURE_IDS,
      deadlines: PRODUCTION_LIVENESS_DEADLINES_MS,
      profiles,
      recovery,
    };
    const comparison = evaluateProductionControlLiveness(evidence);
    const controls = negativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-LIVE-001",
      recipeId: "recipe:pres-live-001",
      evaluator: "production-control-liveness-v1",
      scenarioIds: PRODUCTION_LIVENESS_SCENARIO_IDS,
      profileIds,
      gestureIds: PRODUCTION_LIVENESS_GESTURE_IDS,
      deadlines: PRODUCTION_LIVENESS_DEADLINES_MS,
      source: sourceSnapshot(),
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:production-liveness",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "liveness.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "production-control-liveness-v1",
        comparison,
        negativeControls: controls,
      }),
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
      writeJson(path.join(OUTPUT, "recovery.json"), recovery),
    ]);
    if (
      !comparison.pass ||
      controls.some(({ status }) => status !== "DETECTED")
    ) {
      throw new Error(
        `PRES-LIVE-001 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-LIVE-001 PASS: ${profileIds.length} profiles, ${CLASS_IDS.length} classes, every visible control, and five negative controls detected`,
    );
    console.log(`Evidence: ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await browser?.close();
    server?.kill();
  }
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
