import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { availablePort } from "./lib/available-port.mjs";
import {
  CAMERA_MOTION_GESTURE_IDS,
  CAMERA_MOTION_PROFILE_IDS,
  CAMERA_MOTION_RUN_SPECS,
  evaluateCameraMotionEvidence,
  runCameraMotionNegativeControls,
} from "./lib/camera-motion-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/camera-motion/pres-camera-016");
const REFERENCE_SCENE_ID = "tile:14:4";
const TILE_PIXELS = 48;
const LOGICAL_VIEWPORT = { width: 960, height: 540 };
const APPROACH_MS = 1_000;
const EDGE_HOLD_MS = 2_500;
// Crossing the camera's right clamp requires leaving the one-tile wall margin
// before the target can move left. Keep the reversal long enough to show that
// transition instead of recording a stationary clamped target.
const HOLD_MS = 1_300;
const DIAGONAL_HOLD_MS = 2_000;
const STOP_HOLD_MS = 650;
const FIXED_HOLD_MS = 1_000;
const SETTLE_MS = 700;
const PROFILES = {
  desktop: {
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    input: "keyboard",
  },
  "phone-portrait": {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    input: "touch",
  },
};
const DIRECTIONS = {
  "reverse-west": {
    keys: ["a"],
    x: -1,
    y: 0,
    axes: [["x", -1]],
    holdMs: HOLD_MS,
  },
  "reverse-east": {
    keys: ["d"],
    x: 1,
    y: 0,
    axes: [["x", 1]],
    holdMs: HOLD_MS,
  },
  "edge-west": {
    keys: ["a"],
    x: -1,
    y: 0,
    axes: [["x", -1]],
    holdMs: EDGE_HOLD_MS,
  },
  "edge-south": {
    keys: ["s"],
    x: 0,
    y: 1,
    axes: [["y", 1]],
    holdMs: EDGE_HOLD_MS,
  },
  "diagonal-north-west": {
    keys: ["a", "w"],
    x: -1,
    y: -1,
    axes: [
      ["x", -1],
      ["y", -1],
    ],
    holdMs: DIAGONAL_HOLD_MS,
  },
  "stop-after-diagonal": {
    keys: ["a", "s"],
    x: -1,
    y: 1,
    axes: [
      ["x", -1],
      ["y", 1],
    ],
    holdMs: STOP_HOLD_MS,
  },
  "stop-center": {
    keys: ["d"],
    x: 1,
    y: 0,
    axes: [["x", 1]],
    holdMs: STOP_HOLD_MS,
  },
  "fixed-travel": {
    keys: ["d", "s"],
    x: 1,
    y: 1,
    axes: [
      ["x", 1],
      ["y", 1],
    ],
    holdMs: FIXED_HOLD_MS,
  },
  "snap-travel": {
    keys: ["d", "s"],
    x: 1,
    y: 1,
    axes: [
      ["x", 1],
      ["y", 1],
    ],
    holdMs: HOLD_MS,
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
    throw new Error("Camera-motion evidence must contain a PNG data URL");
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
}

function cameraSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    scenarioId: snapshot.scenarioId,
    tick: snapshot.tick,
    map: {
      width: snapshot.map?.width,
      height: snapshot.map?.height,
    },
    player: {
      position: snapshot.player?.position,
      previousPosition: snapshot.player?.previousPosition,
      velocity: snapshot.player?.velocity,
    },
  };
}

function cameraDrawCall(call) {
  if (!call) return null;
  return {
    entityId: call.entityId,
    type: call.type,
    geometryId: call.geometryId,
    clip: call.clip,
    frameIdentity: call.frameIdentity,
    facingBucket: call.facingBucket,
    worldAnchor: call.worldAnchor,
    screenAnchor: call.screenAnchor,
    footAnchor: call.footAnchor,
    destinationRect: call.destinationRect,
    visible: call.visible,
  };
}

function cameraManifest(manifest) {
  const reference = manifest.sceneSprites?.find(
    ({ objectId }) => objectId === REFERENCE_SCENE_ID,
  );
  return {
    schemaVersion: manifest.schemaVersion,
    tick: manifest.tick,
    simTick: manifest.simTick,
    presentationTick: manifest.presentationTick,
    interpolationAlpha: manifest.interpolationAlpha,
    camera: manifest.camera,
    cameraTarget: manifest.cameraTarget,
    cameraMode: manifest.cameraMode,
    viewport: manifest.viewport,
    drawCalls: [
      cameraDrawCall(
        manifest.drawCalls?.find(({ entityId }) => entityId === "player"),
      ),
    ].filter(Boolean),
    sceneSprites: reference
      ? [
          {
            objectId: reference.objectId,
            visible: reference.visible,
            worldAnchor: reference.worldAnchor,
            screenAnchor: reference.screenAnchor,
            destinationRect: reference.destinationRect,
          },
        ]
      : [],
  };
}

function cameraBounds(snapshot, zoom) {
  const mapWidth = snapshot.map.width * TILE_PIXELS;
  const mapHeight = snapshot.map.height * TILE_PIXELS;
  const visibleHalfWidth = LOGICAL_VIEWPORT.width / (2 * zoom);
  const visibleHalfHeight = LOGICAL_VIEWPORT.height / (2 * zoom);
  return {
    minX:
      mapWidth <= LOGICAL_VIEWPORT.width / zoom
        ? mapWidth / 2
        : visibleHalfWidth,
    maxX:
      mapWidth <= LOGICAL_VIEWPORT.width / zoom
        ? mapWidth / 2
        : mapWidth - visibleHalfWidth,
    minY:
      mapHeight <= LOGICAL_VIEWPORT.height / zoom
        ? mapHeight / 2
        : visibleHalfHeight,
    maxY:
      mapHeight <= LOGICAL_VIEWPORT.height / zoom
        ? mapHeight / 2
        : mapHeight - visibleHalfHeight,
  };
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
        `Camera-motion server exited with code ${server.exitCode}`,
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
  throw new Error(`Camera-motion server did not start at ${baseURL}`);
}

async function prepareProductionPage(page, baseURL, runSpec) {
  await page.goto(`${baseURL}/?scenario=${runSpec.scenarioId}`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  const route = await page.evaluate(() => {
    const observer = window.__GAME_OBSERVE__;
    const snapshot = observer?.snapshot();
    const manifest = observer?.renderManifest();
    return {
      bridgeExposed: Boolean(window.__GAME_TEST__),
      mode: observer?.mode,
      scenarioId: snapshot?.scenarioId,
      cameraMode: manifest?.cameraMode,
      map: { width: snapshot?.map?.width, height: snapshot?.map?.height },
      camera: manifest?.camera,
      cameraTarget: manifest?.cameraTarget,
    };
  });
  if (route.bridgeExposed)
    throw new Error("Camera-motion route exposed a mutating test bridge");
  if (route.mode !== "observe-only")
    throw new Error(`Camera-motion route is not observe-only: ${route.mode}`);
  if (route.scenarioId !== runSpec.scenarioId)
    throw new Error(`Camera-motion route loaded ${route.scenarioId}`);
  if (route.cameraMode !== runSpec.cameraMode)
    throw new Error(`Camera-motion route used camera mode ${route.cameraMode}`);
  if (!route.cameraTarget?.zoom || !route.map.width || !route.map.height)
    throw new Error("Camera-motion route omitted map or camera telemetry");
  return {
    map: route.map,
    cameraBounds: cameraBounds(route, route.cameraTarget.zoom),
  };
}

async function capture(page, label) {
  return page.evaluate((captureLabel) => {
    const observer = window.__GAME_OBSERVE__;
    if (!observer) throw new Error("Production observer is unavailable");
    const snapshot = observer.snapshot();
    const manifest = observer.renderManifest();
    return {
      label: captureLabel,
      snapshot,
      manifest,
      frame: observer.captureFrame(),
    };
  }, label);
}

async function clearSamples(page) {
  await page.evaluate(() =>
    window.__GAME_OBSERVE__?.clearPresentationSamples(),
  );
}

async function waitForMovement(page, before, direction) {
  await page.waitForFunction(
    ({ initial, axes }) => {
      const position = window.__GAME_OBSERVE__?.snapshot().player.position;
      if (!position) return false;
      return axes.every(
        ([axis, sign]) => sign * (position[axis] - initial[axis]) > 0,
      );
    },
    {
      initial: before.snapshot.player.position,
      axes: direction.axes,
    },
    { timeout: 3_000 },
  );
}

async function movePadBounds(page) {
  const bounds = await page.locator(".move-pad").boundingBox();
  if (!bounds) throw new Error("Camera-motion movement pad has no bounds");
  return bounds;
}

async function touchGesture(page, session, before, direction) {
  const bounds = await movePadBounds(page);
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
    touchPoints: [{ ...center, id: 41, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 41, radiusX: 1, radiusY: 1, force: 1 }],
  });
  try {
    await waitForMovement(page, before, direction);
    await page.waitForTimeout(direction.holdMs);
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  return {
    type: "touch",
    control: "move-pad",
    direction: { x: direction.x, y: direction.y },
    bounds,
    physical: { center, target },
  };
}

async function keyboardGesture(page, before, direction) {
  for (const key of direction.keys) await page.keyboard.down(key);
  try {
    await waitForMovement(page, before, direction);
    await page.waitForTimeout(direction.holdMs);
  } finally {
    for (const key of [...direction.keys].reverse())
      await page.keyboard.up(key);
  }
  return {
    type: "keyboard",
    keys: [...direction.keys],
    vector: { x: direction.x, y: direction.y },
  };
}

async function runApproach(page, artifactPrefix) {
  await clearSamples(page);
  const before = await capture(
    page,
    `${artifactPrefix}-approach-map-edge-before`,
  );
  await page.waitForTimeout(APPROACH_MS);
  const samples = await page.evaluate(() =>
    window.__GAME_OBSERVE__?.presentationSamples(),
  );
  const after = await capture(
    page,
    `${artifactPrefix}-approach-map-edge-after`,
  );
  return {
    id: "approach-map-edge",
    input: { type: "idle", purpose: "smooth-follow-to-east-map-clamp" },
    before,
    after,
    samples,
  };
}

async function runHeldGesture(page, session, profile, artifactPrefix, id) {
  const direction = DIRECTIONS[id];
  if (!direction) throw new Error(`Unknown camera gesture ${id}`);
  await clearSamples(page);
  const before = await capture(page, `${artifactPrefix}-${id}-before`);
  const input =
    profile.input === "touch"
      ? await touchGesture(page, session, before, direction)
      : await keyboardGesture(page, before, direction);
  await page.waitForTimeout(SETTLE_MS);
  const samples = await page.evaluate(() =>
    window.__GAME_OBSERVE__?.presentationSamples(),
  );
  const after = await capture(page, `${id}-after`);
  return { id, input, before, after, samples };
}

function normalizeCapture(raw, profileId, index) {
  const frame = dataUrlBuffer(raw.frame);
  const frameFile = `frame-${String(index).padStart(4, "0")}-${raw.label}.png`;
  const snapshot = cameraSnapshot(raw.snapshot);
  const manifest = cameraManifest(raw.manifest);
  return {
    tick: raw.snapshot.tick,
    stateTick: raw.snapshot.tick,
    manifestTick: raw.manifest.tick,
    stateHash: hashJson(snapshot),
    manifestHash: hashJson(manifest),
    frameHash: sha256(frame),
    frameFile,
    snapshot,
    manifest,
    label: raw.label,
    profileId,
    frame,
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
    manifest: capture.manifest,
    label: capture.label,
  };
}

function publicSample(sample) {
  return {
    observedAtMs: sample.observedAtMs,
    tick: sample.tick,
    presentationTick: sample.presentationTick,
    camera: sample.camera,
    cameraTarget: sample.cameraTarget,
    cameraMode: sample.cameraMode,
    playerWorldAnchor: sample.playerWorldAnchor,
    playerScreenAnchor: sample.playerScreenAnchor,
    referenceScene: sample.referenceScene,
  };
}

async function writeContactSheet(directory, captures) {
  const selected = captures.filter(({ label }) => label.endsWith("-after"));
  const cellWidth = 320;
  const cellHeight = 180;
  const columns = 3;
  const rows = Math.max(1, Math.ceil(selected.length / columns));
  const layers = [];
  for (const [index, capture] of selected.entries())
    layers.push({
      input: await sharp(capture.frame)
        .resize(cellWidth, cellHeight, { fit: "fill" })
        .png()
        .toBuffer(),
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    });
  await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 4,
      background: "#120f16",
    },
  })
    .composite(layers)
    .png()
    .toFile(path.join(directory, "contact-sheet.png"));
}

async function normalizeProfile(raw, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.mkdir(directory, { recursive: true });
  let frameIndex = 0;
  const normalizedRuns = [];
  const normalizedCaptures = [];
  for (const rawRun of raw.runs) {
    const captures = [
      rawRun.initial.capture,
      ...rawRun.gestures.flatMap(({ before, after }) => [before, after]),
    ];
    const capturesForRun = captures.map((capture) =>
      normalizeCapture(capture, profileId, frameIndex++),
    );
    normalizedCaptures.push(...capturesForRun);
    const lookup = new Map(
      capturesForRun.map((capture) => [capture.label, capture]),
    );
    const gestures = rawRun.gestures.map((gesture) => ({
      id: gesture.id,
      input: gesture.input,
      before: publicCapture(lookup.get(gesture.before.label)),
      after: publicCapture(lookup.get(gesture.after.label)),
      samples: gesture.samples.map(publicSample),
    }));
    normalizedRuns.push({
      scenarioId: rawRun.scenarioId,
      cameraMode: rawRun.cameraMode,
      cameraBounds: rawRun.cameraBounds,
      initial: {
        bridgeExposed: rawRun.initial.bridgeExposed,
        mode: rawRun.initial.mode,
        capture: publicCapture(lookup.get(rawRun.initial.capture.label)),
      },
      gestures,
      timeline: [
        publicCapture(lookup.get(rawRun.initial.capture.label)),
        ...gestures.flatMap(({ before, after }) => [before, after]),
      ],
    });
  }
  for (const capture of normalizedCaptures)
    await fs.writeFile(path.join(directory, capture.frameFile), capture.frame);
  await Promise.all([
    writeJson(path.join(directory, "gesture-log.json"), {
      schemaVersion: 1,
      profileId,
      runs: normalizedRuns.map(({ scenarioId, cameraMode, gestures }) => ({
        scenarioId,
        cameraMode,
        gestures,
      })),
    }),
    writeJson(path.join(directory, "states.json"), {
      schemaVersion: 1,
      profileId,
      runs: normalizedRuns,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      profileId,
      frames: normalizedCaptures.map(publicCapture),
    }),
  ]);
  await writeContactSheet(directory, normalizedCaptures);
  return { profileId, runs: normalizedRuns };
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
  try {
    const runs = [];
    for (const runSpec of CAMERA_MOTION_RUN_SPECS) {
      const route = await prepareProductionPage(page, baseURL, runSpec);
      const initialCapture = await capture(
        page,
        `${runSpec.artifactPrefix}-initial`,
      );
      const gestures = [];
      for (const gestureId of runSpec.gestureIds) {
        gestures.push(
          gestureId === "approach-map-edge"
            ? await runApproach(page, runSpec.artifactPrefix)
            : await runHeldGesture(
                page,
                session,
                profile,
                runSpec.artifactPrefix,
                gestureId,
              ),
        );
      }
      runs.push({
        scenarioId: runSpec.scenarioId,
        cameraMode: runSpec.cameraMode,
        cameraBounds: route.cameraBounds,
        initial: {
          bridgeExposed: false,
          mode: "observe-only",
          capture: initialCapture,
        },
        gestures,
      });
    }
    return {
      profileId,
      runs,
    };
  } finally {
    await session?.detach();
    const video = page.video();
    await context.close();
    const videoPath = video ? await video.path() : null;
    if (videoPath) {
      await fs.mkdir(profileDirectory, { recursive: true });
      await fs.copyFile(
        videoPath,
        path.join(profileDirectory, "camera-motion.webm"),
      );
    }
  }
}

async function main() {
  const requestedProfiles = option("profiles", null);
  const profileIds = requestedProfiles
    ? requestedProfiles.split(",").filter((id) => id in PROFILES)
    : [...CAMERA_MOTION_PROFILE_IDS];
  if (profileIds.length === 0)
    throw new Error("--profiles must name at least one known camera profile");
  const requestedPort = option("port");
  const port = Number(requestedPort ?? (await availablePort()));
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
    for (const raw of rawProfiles) {
      const normalized = await normalizeProfile(raw, raw.profileId);
      profiles.push(normalized);
    }
    await fs.rm(path.join(OUTPUT, "video-tmp"), {
      recursive: true,
      force: true,
    });
    const evidence = {
      requiredProfiles: profileIds,
      requiredRunSpecs: CAMERA_MOTION_RUN_SPECS,
      requiredScenarioIds: CAMERA_MOTION_RUN_SPECS.map(
        ({ scenarioId }) => scenarioId,
      ),
      requiredGestureIds: [...CAMERA_MOTION_GESTURE_IDS],
      profiles,
    };
    const comparison = evaluateCameraMotionEvidence(evidence);
    const controls = runCameraMotionNegativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-CAMERA-016",
      recipeId: "recipe:pres-camera-016",
      evaluator: "camera-motion-continuity-v1",
      scenarioIds: CAMERA_MOTION_RUN_SPECS.map(({ scenarioId }) => scenarioId),
      actualScenarioIds: CAMERA_MOTION_RUN_SPECS.map(
        ({ scenarioId }) => scenarioId,
      ),
      profileIds,
      gestureIds: [...CAMERA_MOTION_GESTURE_IDS],
      runSpecs: CAMERA_MOTION_RUN_SPECS,
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:camera-motion",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "camera.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "camera-motion-continuity-v1",
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
        `PRES-CAMERA-016 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-CAMERA-016 PASS: ${profileIds.length} profiles, ${CAMERA_MOTION_RUN_SPECS.length} camera modes/routes, and five negative controls detected`,
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
