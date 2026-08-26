import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  GESTURE_INTENT_GESTURE_IDS,
  GESTURE_INTENT_SCENARIO_IDS,
  evaluateGestureIntentEvidence,
} from "./lib/gesture-intent-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/input-intents/pres-input-002");
const ACTUAL_SCENARIO_ID = "animation-idle";
const SCENARIO_ID = GESTURE_INTENT_SCENARIO_IDS.openFloor;
const PROFILES = {
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

const DIRECTION_GESTURES = [
  { id: "joystick-north", x: 0, y: -1, axis: "y", sign: -1 },
  { id: "joystick-east", x: 1, y: 0, axis: "x", sign: 1 },
  { id: "joystick-south", x: 0, y: 1, axis: "y", sign: 1 },
  { id: "joystick-west", x: -1, y: 0, axis: "x", sign: -1 },
];

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
    throw new Error("Gesture intent evidence must contain a PNG data URL");
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
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
        `Input intent server exited with code ${server.exitCode}`,
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
  throw new Error(`Input intent server did not start at ${baseURL}`);
}

async function prepareProductionPage(page, baseURL) {
  await page.goto(`${baseURL}/?scenario=${ACTUAL_SCENARIO_ID}`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  const evidence = await page.evaluate(() => ({
    bridgeExposed: Boolean(window.__GAME_TEST__),
    mode: window.__GAME_OBSERVE__?.mode,
    scenarioId: window.__GAME_OBSERVE__?.snapshot().scenarioId,
  }));
  if (evidence.bridgeExposed)
    throw new Error("Physical input route exposed a mutating test bridge");
  if (evidence.mode !== "observe-only")
    throw new Error(
      `Physical input route is not observe-only: ${evidence.mode}`,
    );
  if (evidence.scenarioId !== ACTUAL_SCENARIO_ID)
    throw new Error(`Physical input route loaded ${evidence.scenarioId}`);
  return evidence;
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

function playerAttackCount(snapshot) {
  return (snapshot?.eventLog ?? []).filter(
    ({ type, sourceId }) => type === "attack_started" && sourceId === "player",
  ).length;
}

function playerPosition(snapshot) {
  return snapshot?.player?.position ?? { x: 0, y: 0 };
}

async function groundTargets(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const controls = document.querySelector(".mobile-controls");
    const player = window.__GAME_OBSERVE__
      ?.renderManifest()
      .drawCalls.find(({ entityId }) => entityId === "player");
    if (!canvas || !player)
      throw new Error("Cannot locate the player canvas anchor");
    const rect = canvas.getBoundingClientRect();
    const controlsRect = controls?.getBoundingClientRect();
    const playerClient = {
      x: rect.left + (player.screenAnchor.x / 960) * rect.width,
      y: rect.top + (player.screenAnchor.y / 540) * rect.height,
    };
    return [
      { x: playerClient.x + 112, y: playerClient.y },
      { x: playerClient.x - 112, y: playerClient.y },
      { x: playerClient.x, y: playerClient.y + 96 },
      { x: playerClient.x, y: playerClient.y - 96 },
    ].filter(
      ({ x, y }) =>
        x >= rect.left + 20 &&
        x <= rect.right - 20 &&
        y >= rect.top + 20 &&
        y <= rect.bottom - 20 &&
        (!controlsRect || y < controlsRect.top - 8),
    );
  });
}

async function waitForMovement(page, before, expectation = null) {
  await page.waitForFunction(
    ({ initial, axis, sign }) => {
      const position = window.__GAME_OBSERVE__?.snapshot().player.position;
      if (!position) return false;
      const dx = position.x - initial.x;
      const dy = position.y - initial.y;
      if (axis) return sign * (axis === "x" ? dx : dy) > 0;
      return dx !== 0 || dy !== 0;
    },
    {
      initial: playerPosition(before.snapshot),
      axis: expectation?.axis ?? null,
      sign: expectation?.sign ?? 1,
    },
    { timeout: 1_500 },
  );
}

async function movePadBounds(page) {
  const bounds = await page.locator(".move-pad").boundingBox();
  if (!bounds) throw new Error("Movement pad has no bounds");
  return bounds;
}

async function dragJoystick(page, session, direction, bounds) {
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const radius = Math.min(bounds.width, bounds.height) * 0.3;
  const target = {
    x: center.x + direction.x * radius,
    y: center.y + direction.y * radius,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...center, id: 23, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 23, radiusX: 1, radiusY: 1, force: 1 }],
  });
  return { center, target };
}

async function endJoystick(session) {
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function tapOpenGround(page) {
  const targets = await groundTargets(page);
  if (targets.length === 0)
    throw new Error("No visible open-floor ground target was found");
  const attempts = [];
  for (const target of targets) {
    const before = await capture(page, "tap-open-ground-before");
    await page.touchscreen.tap(target.x, target.y);
    try {
      await waitForMovement(page, before);
      const after = await capture(page, "tap-open-ground-after");
      return {
        id: "tap-open-ground",
        input: { type: "touch", control: "canvas", target },
        attempts,
        before,
        after,
      };
    } catch {
      attempts.push({ target, moved: false });
    }
  }
  throw new Error(
    `Ground touch did not move the player: ${JSON.stringify(attempts)}`,
  );
}

async function joystickGesture(page, session, direction) {
  const before = await capture(page, `${direction.id}-before`);
  const bounds = await movePadBounds(page);
  const physical = await dragJoystick(page, session, direction, bounds);
  try {
    await waitForMovement(page, before, direction);
  } finally {
    await endJoystick(session);
  }
  await page.waitForTimeout(80);
  const after = await capture(page, `${direction.id}-after`);
  return {
    id: direction.id,
    input: {
      type: "touch",
      control: "move-pad",
      direction: { x: direction.x, y: direction.y },
      bounds,
      physical,
    },
    before,
    after,
  };
}

async function strikeGesture(page) {
  const button = page.locator(".mobile-actions [data-action='attack']");
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error("Strike control has no bounds");
  const before = await capture(page, "tap-strike-before");
  await button.tap();
  await page.waitForFunction(
    (initial) => {
      const events = window.__GAME_OBSERVE__?.snapshot().eventLog ?? [];
      return (
        events.filter(
          ({ type, sourceId }) =>
            type === "attack_started" && sourceId === "player",
        ).length > initial
      );
    },
    playerAttackCount(before.snapshot),
    { timeout: 1_500 },
  );
  await page.waitForTimeout(80);
  const after = await capture(page, "tap-strike-after");
  return {
    id: "tap-strike",
    input: {
      type: "touch",
      control: "mobile-actions",
      action: "attack",
      bounds,
    },
    before,
    after,
  };
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
  const session = await context.newCDPSession(page);
  try {
    const route = await prepareProductionPage(page, baseURL);
    const initialCapture = await capture(page, "initial");
    const gestures = [];

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
    gestures.push(await tapOpenGround(page));

    for (const direction of DIRECTION_GESTURES) {
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
      gestures.push(await joystickGesture(page, session, direction));
    }

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
    gestures.push(await strikeGesture(page));

    return {
      profileId,
      scenarioId: SCENARIO_ID,
      actualScenarioId: route.scenarioId,
      initial: {
        injectionUsed: false,
        bridgeExposed: route.bridgeExposed,
        mode: route.mode,
        snapshot: initialCapture.snapshot,
        capture: initialCapture,
      },
      gestures,
      timeline: [
        initialCapture,
        ...gestures.flatMap(({ before, after }) => [before, after]),
      ],
    };
  } finally {
    const video = page.video();
    await context.close();
    const videoPath = video ? await video.path() : null;
    if (videoPath) {
      await fs.mkdir(profileDirectory, { recursive: true });
      await fs.copyFile(
        videoPath,
        path.join(profileDirectory, "input-intents.webm"),
      );
    }
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
  const byLabel = new Map();
  const captures = [];
  for (const current of raw.timeline) {
    if (byLabel.has(current.label)) continue;
    const normalized = normalizeCapture(current, directory, captures.length);
    await fs.writeFile(
      path.join(directory, normalized.frameFile),
      normalized.frame,
    );
    byLabel.set(current.label, normalized);
    captures.push(normalized);
  }
  const lookup = (capture) => byLabel.get(capture.label);
  const gestures = raw.gestures.map((gesture) => ({
    ...gesture,
    before: publicCapture(lookup(gesture.before)),
    after: publicCapture(lookup(gesture.after)),
  }));
  const initial = {
    ...raw.initial,
    capture: publicCapture(lookup(raw.initial.capture)),
  };
  const timeline = captures.map(publicCapture);
  await Promise.all([
    writeJson(path.join(directory, "gesture-log.json"), gestures),
    writeJson(path.join(directory, "states.json"), {
      schemaVersion: 1,
      initial,
      gestures: gestures.map(({ id, before, after }) => ({
        id,
        before,
        after,
      })),
      timeline,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      frames: captures.map(publicManifestCapture),
    }),
  ]);
  return {
    profileId,
    scenarioId: raw.scenarioId,
    actualScenarioId: raw.actualScenarioId,
    initial: { ...initial, snapshot: initial.capture.snapshot },
    gestures,
    timeline,
  };
}

function negativeControls(evidence) {
  const control = {
    id: "ground-and-strike-bindings-swapped",
    expectedSignal: "gesture-intent-mismatch",
  };
  const mutated = structuredClone(evidence);
  const strike = mutated.profiles[0].gestures.find(
    ({ id }) => id === "tap-strike",
  );
  strike.after.snapshot.player.position.x += 1;
  const result = evaluateGestureIntentEvidence(mutated);
  const detected = result.failures.includes(control.expectedSignal);
  return [
    {
      ...control,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? control.expectedSignal : "",
      failures: result.failures,
    },
  ];
}

async function main() {
  const requestedProfiles = option("profiles", null);
  const profileIds = requestedProfiles
    ? requestedProfiles.split(",").filter((id) => id in PROFILES)
    : Object.keys(PROFILES);
  if (profileIds.length === 0)
    throw new Error("--profiles must name at least one known device profile");
  const port = Number(option("port", String(46_000 + (process.pid % 1_000))));
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
    const profiles = [];
    for (const raw of rawProfiles)
      profiles.push(await normalizeProfile(raw, raw.profileId));
    await fs.rm(path.join(OUTPUT, "video-tmp"), {
      recursive: true,
      force: true,
    });
    const evidence = {
      requiredProfiles: profileIds,
      requiredScenarioIds: [SCENARIO_ID],
      requiredGestureIds: GESTURE_INTENT_GESTURE_IDS,
      profiles,
    };
    const comparison = evaluateGestureIntentEvidence(evidence);
    const controls = negativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-INPUT-002",
      recipeId: "recipe:pres-input-002",
      evaluator: "gesture-intent-separation-v1",
      scenarioId: SCENARIO_ID,
      actualScenarioId: ACTUAL_SCENARIO_ID,
      scenarioIds: [SCENARIO_ID],
      profileIds,
      gestureIds: GESTURE_INTENT_GESTURE_IDS,
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:input-intents",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "input-intents.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "gesture-intent-separation-v1",
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
        `PRES-INPUT-002 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-INPUT-002 PASS: ${profileIds.length} mobile profiles, six gestures, one negative control detected`,
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
