import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  CITY_SERVICE_EXPECTATIONS,
  evaluateCityJourneyEvidence,
} from "./lib/city-journey-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/city-journey/pres-city-027");
const ORDINARY_SCENARIO_ID = "production-city-route";
const SERVICE_SCENARIO_ID = "production-city-services-route";
const REQUIRED_SCENARIO_IDS = [ORDINARY_SCENARIO_ID, SERVICE_SCENARIO_ID];
const VIEWPORT_LOGICAL = { width: 960, height: 540 };
const UNITS_PER_TILE = 1_024;
const TILE_PIXELS = 48;
const DEBUG = process.argv.includes("--debug");
const PHYSICAL_PULSE_MS = 70;
const KEYBOARD_PULSE_MS = 60;

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
  "phone-landscape": {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 1,
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

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("City journey evidence must contain a PNG data URL");
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
}

function tileCenter(tile) {
  return {
    x: (tile.x + 0.5) * UNITS_PER_TILE,
    y: (tile.y + 0.5) * UNITS_PER_TILE,
  };
}

function wildernessCityFloorRoute(map) {
  const key = (point) => `${point.x},${point.y}`;
  const queue = [{ ...map.spawn }];
  const previous = new Map([[key(map.spawn), null]]);
  let cursor = 0;
  while (cursor < queue.length && !previous.has(key(map.exit))) {
    const current = queue[cursor++];
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = key(next);
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= map.width ||
        next.y >= map.height ||
        map.tiles[next.y * map.width + next.x] !== 0 ||
        previous.has(nextKey)
      )
        continue;
      previous.set(nextKey, key(current));
      queue.push(next);
    }
  }
  const route = [];
  let active = key(map.exit);
  while (active && previous.has(active)) {
    const [x, y] = active.split(",").map(Number);
    route.push({ x, y });
    active = previous.get(active) ?? null;
  }
  route.reverse();
  return route;
}

function wildernessCityLandmarkApproach(map) {
  const route = wildernessCityFloorRoute(map);
  // The sign is solid. The adjacent floor cell is the authoritative physical
  // discovery point and remains within the simulation's interaction radius.
  return tileCenter(route[Math.max(0, route.length - 4)] ?? map.exit);
}

function eventTypes(snapshot) {
  return [...(snapshot.eventLog ?? []), ...(snapshot.city?.events ?? [])].map(
    ({ type }) => type,
  );
}

function sceneVisible(manifest, objectId) {
  return manifest.sceneSprites.some(
    ({ objectId: candidate, visible }) => candidate === objectId && visible,
  );
}

async function prepareProductionPage(page, baseURL, scenarioId) {
  await page.goto(`${baseURL}/?scenario=${scenarioId}`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  const bridgeExposed = await page.evaluate(() =>
    Boolean(window.__GAME_TEST__),
  );
  if (bridgeExposed)
    throw new Error(
      `Production scenario ${scenarioId} exposed mutating bridge`,
    );
  return { bridgeExposed, bounds: await geometry(page) };
}

async function waitForVisibleGate(page) {
  await page.waitForFunction(
    () =>
      window.__GAME_OBSERVE__
        ?.renderManifest()
        .sceneSprites.some(
          ({ objectId, visible }) =>
            objectId === "gate:embercross:south" && visible,
        ),
    undefined,
    { timeout: 3_000 },
  );
}

async function closeRecordedContext(
  context,
  page,
  profileDirectory,
  videoName,
) {
  const video = page.video();
  await context.close();
  const videoPath = video ? await video.path() : null;
  if (videoPath) {
    await fs.mkdir(profileDirectory, { recursive: true });
    await fs.copyFile(videoPath, path.join(profileDirectory, videoName));
  }
}

async function capture(page, label) {
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

async function geometry(page) {
  const [canvas, controls, movePad] = await Promise.all([
    page.locator("canvas").boundingBox(),
    page.locator(".mobile-controls").boundingBox(),
    page.locator(".move-pad").boundingBox(),
  ]);
  if (!canvas) throw new Error("Production canvas has no device bounds");
  return { canvas, controls, movePad };
}

function projectedDevicePoint(point, manifest, canvas) {
  const logical = {
    x:
      VIEWPORT_LOGICAL.width / 2 +
      ((point.x / UNITS_PER_TILE) * TILE_PIXELS - manifest.camera.x) *
        manifest.camera.zoom,
    y:
      VIEWPORT_LOGICAL.height / 2 +
      ((point.y / UNITS_PER_TILE) * TILE_PIXELS - manifest.camera.y) *
        manifest.camera.zoom,
  };
  return {
    x: canvas.x + (logical.x / manifest.viewport.width) * canvas.width,
    y: canvas.y + (logical.y / manifest.viewport.height) * canvas.height,
    logical,
  };
}

function pointIsVisible(projected, controls, viewport) {
  return (
    projected.x >= 8 &&
    projected.x <= viewport.width - 8 &&
    projected.y >= 56 &&
    projected.y <= (controls?.y ?? viewport.height) - 8
  );
}

async function dragJoystick(page, session, direction, movePad) {
  if (!movePad) throw new Error("Touch route has no move pad");
  const center = {
    x: movePad.x + movePad.width / 2,
    y: movePad.y + movePad.height / 2,
  };
  const length = Math.max(1, Math.hypot(direction.x, direction.y));
  const radius = Math.min(movePad.width, movePad.height) * 0.3;
  const target = {
    x: center.x + (direction.x / length) * radius,
    y: center.y + (direction.y / length) * radius,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...center, id: 17, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 17, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForTimeout(PHYSICAL_PULSE_MS);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function keyboardPulse(page, direction) {
  const keys = [];
  if (direction.x !== 0) keys.push(direction.x >= 0 ? "d" : "a");
  if (direction.y !== 0) keys.push(direction.y >= 0 ? "s" : "w");
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(KEYBOARD_PULSE_MS);
  for (const key of keys.reverse()) await page.keyboard.up(key);
}

async function performWaypoint(
  page,
  session,
  target,
  profile,
  bounds,
  avoidCanvasTap = false,
) {
  const manifest = await page.evaluate(() =>
    window.__GAME_OBSERVE__.renderManifest(),
  );
  const projected = projectedDevicePoint(target, manifest, bounds.canvas);
  const visible = pointIsVisible(projected, bounds.controls, profile.viewport);
  const serviceSheetOpen =
    profile.hasTouch && (await page.locator("#city-services").isVisible());
  if (DEBUG)
    console.log(
      `[gesture] target=${Math.round(target.x)},${Math.round(target.y)} logical=${Math.round(projected.logical.x)},${Math.round(projected.logical.y)} device=${Math.round(projected.x)},${Math.round(projected.y)} canvas=${Math.round(bounds.canvas.width)}x${Math.round(bounds.canvas.height)} controls=${bounds.controls ? Math.round(bounds.controls.y) : "none"} visible=${visible}`,
    );
  if (visible && profile.hasTouch && !serviceSheetOpen && !avoidCanvasTap) {
    await page.touchscreen.tap(projected.x, projected.y);
    return {
      type: "touch",
      x: projected.x,
      y: projected.y,
    };
  }
  const current = await page.evaluate(
    () => window.__GAME_OBSERVE__.snapshot().player.position,
  );
  const direction = { x: target.x - current.x, y: target.y - current.y };
  if (profile.hasTouch)
    await dragJoystick(page, session, direction, bounds.movePad);
  else await keyboardPulse(page, direction);
  return {
    type: profile.hasTouch ? "joystick" : "keyboard",
    x: direction.x,
    y: direction.y,
  };
}

async function waitForWaypointProgress(page, start, waypoint, complete) {
  let latest = start;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await page.waitForTimeout(100);
    latest = await page.evaluate(() => window.__GAME_OBSERVE__.snapshot());
    if (complete(latest)) return latest;
    const moved = Math.hypot(
      latest.player.position.x - start.player.position.x,
      latest.player.position.y - start.player.position.y,
    );
    const reached = Math.hypot(
      latest.player.position.x - waypoint.x,
      latest.player.position.y - waypoint.y,
    );
    if (moved > 64 || reached < 176) return latest;
  }
  return latest;
}

async function driveTo(
  page,
  session,
  profile,
  bounds,
  target,
  complete,
  label,
  avoidCanvasTap = false,
) {
  const gestures = [];
  const history = [];
  const maxAttempts = DEBUG ? 10 : 128;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await page.evaluate(() =>
      window.__GAME_OBSERVE__.snapshot(),
    );
    if (complete(before)) return { state: before, gestures, history };
    const route = await page.evaluate((requestedTarget) => {
      const observer = window.__GAME_OBSERVE__;
      if (!observer) throw new Error("Production observer is unavailable");
      return observer.navigationRoute(requestedTarget);
    }, target);
    if (route.length === 0)
      throw new Error(
        `${label} has no route: ${JSON.stringify({
          attempt,
          phase: before.city.locationPhase,
          player: before.player.position,
          target,
          map: before.map.digest,
        })}`,
      );
    const waypoint = route[0];
    if (DEBUG)
      console.log(
        `[${label}] attempt ${attempt} route=${route.length} player=${Math.round(before.player.position.x)},${Math.round(before.player.position.y)} waypoint=${Math.round(waypoint.x)},${Math.round(waypoint.y)}`,
      );
    history.push({
      attempt,
      position: { ...before.player.position },
      waypoint,
      routeLength: route.length,
    });
    const gesture = await performWaypoint(
      page,
      session,
      waypoint,
      profile,
      bounds,
      avoidCanvasTap,
    );
    gestures.push(gesture);
    let latest = await waitForWaypointProgress(
      page,
      before,
      waypoint,
      complete,
    );
    if (
      gesture.type === "touch" &&
      session &&
      Math.hypot(
        latest.player.position.x - before.player.position.x,
        latest.player.position.y - before.player.position.y,
      ) < 64 &&
      !complete(latest)
    ) {
      const dx = waypoint.x - latest.player.position.x;
      const dy = waypoint.y - latest.player.position.y;
      const fallbackDirection =
        Math.abs(dx) >= Math.abs(dy)
          ? { x: Math.sign(dx), y: 0 }
          : { x: 0, y: Math.sign(dy) };
      await dragJoystick(page, session, fallbackDirection, bounds.movePad);
      gestures.push({
        type: "joystick-fallback",
        x: fallbackDirection.x,
        y: fallbackDirection.y,
      });
      latest = await waitForWaypointProgress(page, before, waypoint, complete);
    }
    if (DEBUG)
      console.log(
        `[${label}] after ${Math.round(latest.player.position.x)},${Math.round(latest.player.position.y)} phase=${latest.city.locationPhase}`,
      );
    if (complete(latest)) return { state: latest, gestures, history };
  }
  throw new Error(
    `${label} exceeded ${maxAttempts} physical waypoints: ${JSON.stringify(history)}`,
  );
}

async function npcTarget(page, npcId) {
  return page.evaluate((requestedNpcId) => {
    const call = window.__GAME_OBSERVE__
      .renderManifest()
      .drawCalls.find(({ entityId }) => entityId === requestedNpcId);
    if (!call) throw new Error(`Missing manifested NPC ${requestedNpcId}`);
    return call.worldAnchor;
  }, npcId);
}

async function captureService(
  page,
  action,
  profile,
  bounds,
  session,
  gestures,
) {
  const target = await npcTarget(page, action.npcId);
  const route = await driveTo(
    page,
    session,
    profile,
    bounds,
    target,
    (snapshot) => snapshot.city.nearbyNpcId === action.npcId,
    `approach ${action.npcId}`,
    true,
  );
  gestures.push(...route.gestures);
  const sheet = page.locator("#city-services");
  const button = sheet.locator(`[data-city-action='${action.actionId}']`);
  await sheet.waitFor({ state: "visible", timeout: 5_000 });
  await button.waitFor({ state: "visible", timeout: 5_000 });
  const buttonEvidence = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      visible: rect.width > 0 && rect.height > 0,
      intent: element.getAttribute("data-city-action"),
      previewStatus: element.getAttribute("data-preview-status"),
      previewDeltas: element.getAttribute("data-preview-deltas"),
      targetWidth: rect.width,
      targetHeight: rect.height,
    };
  });
  const before = await capture(page, `${action.actionId}-before`);
  const beforeReceiptCount = before.snapshot.city.receipts.length;
  let gesture;
  const buttonBounds = await button.boundingBox();
  if (!buttonBounds) throw new Error(`${action.actionId} has no button bounds`);
  if (profile.hasTouch) {
    await button.tap();
    gesture = {
      type: "touch",
      x: buttonBounds.x + buttonBounds.width / 2,
      y: buttonBounds.y + buttonBounds.height / 2,
    };
  } else {
    await button.click();
    gesture = {
      type: "mouse",
      x: buttonBounds.x + buttonBounds.width / 2,
      y: buttonBounds.y + buttonBounds.height / 2,
    };
  }
  gestures.push({ actionId: action.actionId, ...gesture });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => window.__GAME_OBSERVE__.snapshot());
    if (state.city.receipts.length > beforeReceiptCount) break;
  }
  const after = await capture(page, `${action.actionId}-after`);
  const feedback = await page
    .locator(".city-service-feedback")
    .evaluate((element) => ({
      visible: Boolean(element.getAttribute("aria-label")),
      label: element.getAttribute("aria-label") ?? "",
    }));
  const previewDeltas = buttonEvidence.previewDeltas
    ? JSON.parse(buttonEvidence.previewDeltas)
    : null;
  return {
    npcId: action.npcId,
    actionId: action.actionId,
    button: {
      visible: buttonEvidence.visible,
      intent: buttonEvidence.intent,
      previewStatus: buttonEvidence.previewStatus,
    },
    gesture: {
      ...gesture,
      targetWidth: buttonEvidence.targetWidth,
      targetHeight: buttonEvidence.targetHeight,
    },
    previewDeltas,
    before,
    after,
    receipt: after.snapshot.city.receipts.at(-1) ?? null,
    feedback,
    routeHistory: route.history,
  };
}

async function runOrdinaryProfile(browser, profileId, profile, baseURL) {
  const profileDirectory = path.join(OUTPUT, profileId);
  const videoDirectory = path.join(OUTPUT, "video-tmp", profileId, "ordinary");
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
  try {
    const { bridgeExposed, bounds } = await prepareProductionPage(
      page,
      baseURL,
      ORDINARY_SCENARIO_ID,
    );
    const initialCapture = await capture(page, "ordinary-wilderness");
    if (initialCapture.snapshot.scenarioId !== ORDINARY_SCENARIO_ID)
      throw new Error("Ordinary city route loaded the wrong scenario");
    const initialSign = initialCapture.manifest.sceneSprites.find(
      ({ objectId }) => objectId === "landmark:embercross:road-sign",
    );
    if (!initialSign)
      throw new Error("Ordinary city route has no visible sign");
    const initial = {
      injectionUsed: false,
      bridgeExposed,
      signVisible: Boolean(initialSign.visible),
      snapshot: initialCapture.snapshot,
      capture: initialCapture,
    };
    const gestures = [];
    const landmarkTarget = wildernessCityLandmarkApproach(
      initialCapture.snapshot.map,
    );
    const discoveredRoute = await driveTo(
      page,
      session,
      profile,
      bounds,
      landmarkTarget,
      (snapshot) => snapshot.city.locationPhase !== "undiscovered",
      "ordinary discover city",
    );
    gestures.push(...discoveredRoute.gestures);
    const discoveredCapture = await capture(page, "ordinary-city-discovered");
    const discovered = {
      snapshot: discoveredCapture.snapshot,
      eventTypes: eventTypes(discoveredCapture.snapshot),
      capture: discoveredCapture,
      history: discoveredRoute.history,
    };
    const mapBeforeCity = discoveredCapture.snapshot.map.digest;
    const gateTarget = tileCenter(discoveredCapture.snapshot.map.exit);
    const enteredRoute = await driveTo(
      page,
      session,
      profile,
      bounds,
      gateTarget,
      (snapshot) => snapshot.city.locationPhase === "inside",
      "ordinary enter Embercross",
    );
    gestures.push(...enteredRoute.gestures);
    await waitForVisibleGate(page);
    const enteredCapture = await capture(page, "ordinary-city-entered");
    const entered = {
      snapshot: enteredCapture.snapshot,
      eventTypes: eventTypes(enteredCapture.snapshot),
      mapChanged: enteredCapture.snapshot.map.digest !== mapBeforeCity,
      gateVisible: sceneVisible(
        enteredCapture.manifest,
        "gate:embercross:south",
      ),
      residentIds: enteredCapture.manifest.drawCalls
        .filter(({ type }) => type === "npc")
        .map(({ entityId }) => entityId)
        .sort(),
      capture: enteredCapture,
      history: enteredRoute.history,
    };
    return {
      scenarioId: ORDINARY_SCENARIO_ID,
      initial,
      discovered,
      entered,
      timeline: [initialCapture, discoveredCapture, enteredCapture],
      gestures,
    };
  } finally {
    await closeRecordedContext(
      context,
      page,
      profileDirectory,
      "ordinary-city-route.webm",
    );
  }
}

async function runProfile(browser, profileId, profile, baseURL) {
  const profileDirectory = path.join(OUTPUT, profileId);
  const videoDirectory = path.join(OUTPUT, "video-tmp", profileId, "services");
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
  try {
    const { bridgeExposed, bounds } = await prepareProductionPage(
      page,
      baseURL,
      SERVICE_SCENARIO_ID,
    );
    const initialCapture = await capture(page, "wilderness");
    if (initialCapture.snapshot.scenarioId !== SERVICE_SCENARIO_ID)
      throw new Error("Service city route loaded the wrong scenario");
    const initialSign = initialCapture.manifest.sceneSprites.find(
      ({ objectId }) => objectId === "landmark:embercross:road-sign",
    );
    if (!initialSign)
      throw new Error("Production city route has no visible sign");
    const initial = {
      injectionUsed: false,
      bridgeExposed,
      signVisible: Boolean(initialSign.visible),
      snapshot: initialCapture.snapshot,
      capture: initialCapture,
    };
    const gestures = [];
    const landmarkTarget = wildernessCityLandmarkApproach(
      initialCapture.snapshot.map,
    );
    const discoveredRoute = await driveTo(
      page,
      session,
      profile,
      bounds,
      landmarkTarget,
      (snapshot) => snapshot.city.locationPhase !== "undiscovered",
      "discover city",
    );
    gestures.push(...discoveredRoute.gestures);
    const discoveredCapture = await capture(page, "city-discovered");
    const discovered = {
      snapshot: discoveredCapture.snapshot,
      eventTypes: eventTypes(discoveredCapture.snapshot),
      capture: discoveredCapture,
      history: discoveredRoute.history,
    };
    const mapBeforeCity = discoveredCapture.snapshot.map.digest;
    const gateTarget = tileCenter(discoveredCapture.snapshot.map.exit);
    const enteredRoute = await driveTo(
      page,
      session,
      profile,
      bounds,
      gateTarget,
      (snapshot) => snapshot.city.locationPhase === "inside",
      "enter Embercross",
    );
    gestures.push(...enteredRoute.gestures);
    await waitForVisibleGate(page);
    const enteredCapture = await capture(page, "city-entered");
    const entered = {
      snapshot: enteredCapture.snapshot,
      eventTypes: eventTypes(enteredCapture.snapshot),
      mapChanged: enteredCapture.snapshot.map.digest !== mapBeforeCity,
      gateVisible: sceneVisible(
        enteredCapture.manifest,
        "gate:embercross:south",
      ),
      residentIds: enteredCapture.manifest.drawCalls
        .filter(({ type }) => type === "npc")
        .map(({ entityId }) => entityId)
        .sort(),
      capture: enteredCapture,
      history: enteredRoute.history,
    };
    const services = [];
    for (const action of CITY_SERVICE_EXPECTATIONS)
      services.push(
        await captureService(page, action, profile, bounds, session, gestures),
      );
    return {
      scenarioId: SERVICE_SCENARIO_ID,
      profileId,
      initial,
      discovered,
      entered,
      timeline: [initialCapture, discoveredCapture, enteredCapture],
      services,
      gestures,
    };
  } finally {
    await closeRecordedContext(
      context,
      page,
      profileDirectory,
      "city-journey.webm",
    );
  }
}

function normalizeCapture(raw, directory, index) {
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

async function normalizeProfile(raw, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.mkdir(directory, { recursive: true });
  const rawCaptures = [
    raw.ordinaryRoute.initial.capture,
    raw.ordinaryRoute.discovered.capture,
    raw.ordinaryRoute.entered.capture,
    raw.initial.capture,
    raw.discovered.capture,
    raw.entered.capture,
    ...raw.services.flatMap((service) => [service.before, service.after]),
  ];
  const byLabel = new Map();
  const captures = [];
  for (const capture of rawCaptures) {
    if (byLabel.has(capture.label)) continue;
    const normalized = normalizeCapture(capture, directory, captures.length);
    await fs.writeFile(
      path.join(directory, normalized.frameFile),
      normalized.frame,
    );
    byLabel.set(capture.label, normalized);
    captures.push(normalized);
  }
  const lookup = (capture) => byLabel.get(capture.label);
  const ordinaryRoute = {
    ...raw.ordinaryRoute,
    initial: {
      ...raw.ordinaryRoute.initial,
      capture: publicCapture(lookup(raw.ordinaryRoute.initial.capture)),
    },
    discovered: {
      ...raw.ordinaryRoute.discovered,
      capture: publicCapture(lookup(raw.ordinaryRoute.discovered.capture)),
    },
    entered: {
      ...raw.ordinaryRoute.entered,
      capture: publicCapture(lookup(raw.ordinaryRoute.entered.capture)),
    },
    timeline: [
      publicCapture(lookup(raw.ordinaryRoute.initial.capture)),
      publicCapture(lookup(raw.ordinaryRoute.discovered.capture)),
      publicCapture(lookup(raw.ordinaryRoute.entered.capture)),
    ],
  };
  const initial = {
    ...raw.initial,
    capture: publicCapture(lookup(raw.initial.capture)),
  };
  const discovered = {
    ...raw.discovered,
    capture: publicCapture(lookup(raw.discovered.capture)),
  };
  const entered = {
    ...raw.entered,
    capture: publicCapture(lookup(raw.entered.capture)),
  };
  const services = raw.services.map((service) => ({
    ...service,
    before: publicCapture(lookup(service.before)),
    after: publicCapture(lookup(service.after)),
  }));
  await Promise.all([
    writeJson(path.join(directory, "ordinary-route.json"), ordinaryRoute),
    writeJson(path.join(directory, "states.json"), {
      schemaVersion: 1,
      ordinaryRoute: {
        scenarioId: ordinaryRoute.scenarioId,
        milestones: [
          ordinaryRoute.initial.capture,
          ordinaryRoute.discovered.capture,
          ordinaryRoute.entered.capture,
        ],
      },
      milestones: [initial.capture, discovered.capture, entered.capture],
      services: services.map(({ actionId, npcId, before, after, receipt }) => ({
        actionId,
        npcId,
        before,
        after,
        receipt,
      })),
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      frames: captures.map(publicManifestCapture),
    }),
    writeJson(path.join(directory, "gesture-log.json"), raw.gestures),
    writeJson(
      path.join(directory, "service-deltas.json"),
      services.map(
        ({
          actionId,
          npcId,
          previewDeltas,
          receipt,
          before,
          after,
          feedback,
        }) => ({
          actionId,
          npcId,
          previewDeltas,
          receipt,
          before: before.snapshot,
          after: after.snapshot,
          feedback,
        }),
      ),
    ),
  ]);
  return {
    profileId,
    ordinaryRoute,
    scenarioId: raw.scenarioId,
    initial,
    discovered,
    entered,
    timeline: [initial.capture, discovered.capture, entered.capture],
    services,
    gestures: raw.gestures,
  };
}

function negativeControls(evidence) {
  const controls = [
    {
      id: "city-sign-removed",
      expectedSignal: "city-route-undiscoverable",
      mutate(value) {
        value.profiles[0].initial.signVisible = false;
      },
    },
    {
      id: "gate-entry-disabled",
      expectedSignal: "gate-transition-inert",
      mutate(value) {
        value.profiles[0].entered.snapshot.city.locationPhase = "at_gate";
      },
    },
    {
      id: "service-listener-removed",
      expectedSignal: "service-control-inert",
      mutate(value) {
        value.profiles[0].services[0].receipt = null;
      },
    },
    {
      id: "service-outcome-suppressed",
      expectedSignal: "service-state-or-feedback-missing",
      mutate(value) {
        value.profiles[0].services[0].feedback.visible = false;
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateCityJourneyEvidence(mutated);
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
        `City journey server exited with code ${server.exitCode}`,
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
  throw new Error(`City journey server did not start at ${baseURL}`);
}

async function main() {
  const requestedProfiles = option("profiles", null);
  const profileIds = requestedProfiles
    ? requestedProfiles.split(",").filter((id) => id in PROFILES)
    : Object.keys(PROFILES);
  if (profileIds.length === 0)
    throw new Error("--profiles must name at least one known device profile");
  const port = Number(option("port", String(45_000 + (process.pid % 1_000))));
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
    for (const profileId of profileIds) {
      const profile = PROFILES[profileId];
      const ordinaryRoute = await runOrdinaryProfile(
        browser,
        profileId,
        profile,
        started.baseURL,
      );
      const serviceRoute = await runProfile(
        browser,
        profileId,
        profile,
        started.baseURL,
      );
      rawProfiles.push({ ...serviceRoute, ordinaryRoute });
    }
    const profiles = [];
    for (const raw of rawProfiles)
      profiles.push(await normalizeProfile(raw, raw.profileId));
    await fs.rm(path.join(OUTPUT, "video-tmp"), {
      recursive: true,
      force: true,
    });
    const evidence = {
      requiredProfiles: profileIds,
      requiredScenarioIds: REQUIRED_SCENARIO_IDS,
      profiles,
    };
    const comparison = evaluateCityJourneyEvidence(evidence);
    const controls = negativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-CITY-027",
      recipeId: "recipe:pres-city-027",
      evaluator: "production-city-journey-v1",
      scenarioId: SERVICE_SCENARIO_ID,
      scenarioIds: REQUIRED_SCENARIO_IDS,
      profileIds,
      source: sourceSnapshot(),
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: `npm run test:city-journey -- --profiles ${profileIds.join(",")}`,
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "journey.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "production-city-journey-v1",
        comparison,
        negativeControls: controls,
      }),
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
    ]);
    if (
      !comparison.pass ||
      controls.some(({ status }) => status !== "DETECTED")
    ) {
      throw new Error(
        `PRES-CITY-027 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-CITY-027 PASS: ${profileIds.length} profiles, ${CITY_SERVICE_EXPECTATIONS.length} service actions, four negative controls detected`,
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
