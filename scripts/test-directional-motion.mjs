import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  DIRECTIONAL_MOTION_ACTOR_IDS,
  DIRECTIONAL_MOTION_DIRECTION_IDS,
  DIRECTIONAL_MOTION_SCENARIO_IDS,
  evaluateDirectionalMotionEvidence,
} from "./lib/directional-motion-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/directional-motion/pres-move-003");
const REFERENCE_SCENE_ID = "tile:14:4";
const HOLD_MS = 850;
const CAMERA_MODES = ["fixed", "follow"];
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

const DIRECTIONS = [
  {
    id: "move-north",
    key: "w",
    x: 0,
    y: -1,
    axis: "y",
    sign: -1,
    facing: "north",
  },
  { id: "move-east", key: "d", x: 1, y: 0, axis: "x", sign: 1, facing: "east" },
  {
    id: "move-south",
    key: "s",
    x: 0,
    y: 1,
    axis: "y",
    sign: 1,
    facing: "south",
  },
  {
    id: "move-west",
    key: "a",
    x: -1,
    y: 0,
    axis: "x",
    sign: -1,
    facing: "west",
  },
];

const ACTUAL_SCENARIOS = Object.fromEntries(
  DIRECTIONAL_MOTION_ACTOR_IDS.flatMap((actorId) => [
    [
      `${DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera}:${actorId}`,
      `fixed-camera-open-floor-${actorId}`,
    ],
    [
      `${DIRECTIONAL_MOTION_SCENARIO_IDS.followCamera}:${actorId}`,
      `follow-camera-open-floor-${actorId}`,
    ],
  ]),
);

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
    throw new Error("Directional-motion evidence must contain a PNG data URL");
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
        `Directional-motion server exited with code ${server.exitCode}`,
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
  throw new Error(`Directional-motion server did not start at ${baseURL}`);
}

async function prepareProductionPage(page, baseURL, actorId, cameraMode) {
  const actualScenarioId =
    ACTUAL_SCENARIOS[`${cameraMode}-camera-open-floor:${actorId}`];
  if (!actualScenarioId)
    throw new Error(`No directional scenario for ${cameraMode}/${actorId}`);
  await page.goto(`${baseURL}/?scenario=${actualScenarioId}`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  const evidence = await page.evaluate(
    ({ expectedActorId, expectedScenarioId, expectedCameraMode }) => {
      const observer = window.__GAME_OBSERVE__;
      const snapshot = observer?.snapshot();
      const manifest = observer?.renderManifest();
      const reference = manifest?.sceneSprites.find(
        ({ objectId }) => objectId === "tile:14:4",
      );
      return {
        bridgeExposed: Boolean(window.__GAME_TEST__),
        mode: observer?.mode,
        scenarioId: snapshot?.scenarioId,
        actorId: snapshot?.player?.classId,
        cameraMode: manifest?.cameraMode,
        referenceScene: reference
          ? {
              objectId: reference.objectId,
              screenAnchor: reference.screenAnchor,
            }
          : null,
        expectedActorId,
        expectedScenarioId,
        expectedCameraMode,
      };
    },
    {
      expectedActorId: actorId,
      expectedScenarioId: actualScenarioId,
      expectedCameraMode: cameraMode === "fixed" ? "fixed" : "smooth",
    },
  );
  if (evidence.bridgeExposed)
    throw new Error("Directional-motion route exposed a mutating test bridge");
  if (evidence.mode !== "observe-only")
    throw new Error(
      `Directional-motion route is not observe-only: ${evidence.mode}`,
    );
  if (evidence.scenarioId !== actualScenarioId)
    throw new Error(`Directional-motion route loaded ${evidence.scenarioId}`);
  if (evidence.actorId !== actorId)
    throw new Error(
      `Directional-motion route loaded actor ${evidence.actorId}`,
    );
  if (evidence.cameraMode !== (cameraMode === "fixed" ? "fixed" : "smooth"))
    throw new Error(
      `Directional-motion route used camera mode ${evidence.cameraMode}`,
    );
  if (evidence.referenceScene?.objectId !== REFERENCE_SCENE_ID)
    throw new Error("Directional-motion route has no stable reference scene");
  return evidence;
}

async function capture(page, label) {
  return page.evaluate((captureLabel) => {
    const observer = window.__GAME_OBSERVE__;
    if (!observer) throw new Error("Production observer is unavailable");
    const snapshot = observer.snapshot();
    const manifest = observer.renderManifest();
    const reference = manifest.sceneSprites.find(
      ({ objectId }) => objectId === "tile:14:4",
    );
    return {
      label: captureLabel,
      tick: Number(snapshot.tick),
      stateTick: Number(snapshot.tick),
      manifestTick: Number(manifest.tick),
      snapshot,
      manifest,
      referenceScene: reference
        ? { objectId: reference.objectId, screenAnchor: reference.screenAnchor }
        : null,
      frame: observer.captureFrame(),
    };
  }, label);
}

async function waitForMovement(page, before, direction) {
  await page.waitForFunction(
    ({ initial, axis, sign }) => {
      const position = window.__GAME_OBSERVE__?.snapshot().player.position;
      if (!position) return false;
      return sign * (position[axis] - initial[axis]) > 0;
    },
    {
      initial: before.snapshot.player.position,
      axis: direction.axis,
      sign: direction.sign,
    },
    { timeout: 3_000 },
  );
}

async function keyboardGesture(page, direction) {
  await page.evaluate(() =>
    window.__GAME_OBSERVE__?.clearPresentationSamples(),
  );
  const before = await capture(
    page,
    `${direction.actorId}-${direction.cameraMode}-${direction.id}-before`,
  );
  await page.keyboard.down(direction.key);
  try {
    await waitForMovement(page, before, direction);
    await page.waitForTimeout(HOLD_MS);
  } finally {
    await page.keyboard.up(direction.key);
  }
  await page.waitForTimeout(260);
  const samples = await page.evaluate(() =>
    window.__GAME_OBSERVE__?.presentationSamples(),
  );
  const after = await capture(
    page,
    `${direction.actorId}-${direction.cameraMode}-${direction.id}-after`,
  );
  return {
    id: direction.id,
    input: {
      type: "keyboard",
      key: direction.key,
      vector: { x: direction.x, y: direction.y },
    },
    before,
    after,
    samples,
  };
}

async function movePadBounds(page) {
  const bounds = await page.locator(".move-pad").boundingBox();
  if (!bounds) throw new Error("Movement pad has no bounds");
  return bounds;
}

async function touchGesture(page, session, direction) {
  await page.evaluate(() =>
    window.__GAME_OBSERVE__?.clearPresentationSamples(),
  );
  const before = await capture(
    page,
    `${direction.actorId}-${direction.cameraMode}-${direction.id}-before`,
  );
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
    touchPoints: [{ ...center, id: 31, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 31, radiusX: 1, radiusY: 1, force: 1 }],
  });
  try {
    await waitForMovement(page, before, direction);
    await page.waitForTimeout(HOLD_MS);
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await page.waitForTimeout(260);
  const samples = await page.evaluate(() =>
    window.__GAME_OBSERVE__?.presentationSamples(),
  );
  const after = await capture(
    page,
    `${direction.actorId}-${direction.cameraMode}-${direction.id}-after`,
  );
  return {
    id: direction.id,
    input: {
      type: "touch",
      control: "move-pad",
      direction: { x: direction.x, y: direction.y },
      bounds,
      physical: { center, target },
    },
    before,
    after,
    samples,
  };
}

async function runActorMode(
  page,
  session,
  baseURL,
  actorId,
  cameraMode,
  input,
) {
  const actualScenarioId =
    ACTUAL_SCENARIOS[`${cameraMode}-camera-open-floor:${actorId}`];
  await prepareProductionPage(page, baseURL, actorId, cameraMode);
  await page.evaluate(() =>
    window.__GAME_OBSERVE__?.clearPresentationSamples(),
  );
  const initialCapture = await capture(
    page,
    `${actorId}-${cameraMode}-initial`,
  );
  const gestures = [];
  for (const baseDirection of DIRECTIONS) {
    const direction = { ...baseDirection, actorId, cameraMode };
    await prepareProductionPage(page, baseURL, actorId, cameraMode);
    gestures.push(
      input === "keyboard"
        ? await keyboardGesture(page, direction)
        : await touchGesture(page, session, direction),
    );
  }
  return {
    actorId,
    scenarioId:
      cameraMode === "fixed"
        ? DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera
        : DIRECTIONAL_MOTION_SCENARIO_IDS.followCamera,
    actualScenarioId,
    cameraMode,
    initial: {
      injectionUsed: false,
      bridgeExposed: false,
      mode: "observe-only",
      snapshot: initialCapture.snapshot,
      capture: initialCapture,
    },
    gestures,
    timeline: [
      initialCapture,
      ...gestures.flatMap(({ before, after }) => [before, after]),
    ],
  };
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
    referenceScene: raw.referenceScene,
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
    manifest: capture.manifest,
    referenceScene: capture.referenceScene,
    label: capture.label,
  };
}

function publicSample(sample) {
  return {
    observedAtMs: sample.observedAtMs,
    tick: sample.tick,
    presentationTick: sample.presentationTick,
    playerFrameIdentity: sample.playerFrameIdentity,
    playerFrameIndex: sample.playerFrameIndex,
    playerClip: sample.playerClip,
    playerFacingBucket: sample.playerFacingBucket,
    playerWorldAnchor: sample.playerWorldAnchor,
    playerScreenAnchor: sample.playerScreenAnchor,
    referenceScene: sample.referenceScene,
  };
}

async function normalizeProfile(raw, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.mkdir(directory, { recursive: true });
  const normalizedCaptures = [];
  const lookup = new Map();
  for (const run of raw.runs) {
    for (const current of run.timeline) {
      const normalized = normalizeCapture(
        current,
        directory,
        normalizedCaptures.length,
      );
      await fs.writeFile(
        path.join(directory, normalized.frameFile),
        normalized.frame,
      );
      normalizedCaptures.push(normalized);
      lookup.set(current.label, normalized);
    }
  }
  const runs = raw.runs.map((run) => {
    const normalizedInitial = lookup.get(run.initial.capture.label);
    const initial = {
      ...run.initial,
      snapshot: normalizedInitial.snapshot,
      capture: publicCapture(normalizedInitial),
    };
    const gestures = run.gestures.map((gesture) => ({
      ...gesture,
      before: publicCapture(lookup.get(gesture.before.label)),
      after: publicCapture(lookup.get(gesture.after.label)),
      samples: gesture.samples.map(publicSample),
    }));
    return {
      actorId: run.actorId,
      scenarioId: run.scenarioId,
      actualScenarioId: run.actualScenarioId,
      cameraMode: run.cameraMode,
      initial,
      gestures,
      timeline: [
        initial.capture,
        ...gestures.flatMap(({ before, after }) => [before, after]),
      ],
    };
  });
  const timeline = runs.flatMap(({ timeline: current }) => current);
  await Promise.all([
    writeJson(
      path.join(directory, "gesture-log.json"),
      runs.map(({ actorId, scenarioId, cameraMode, gestures }) => ({
        actorId,
        scenarioId,
        cameraMode,
        gestures,
      })),
    ),
    writeJson(path.join(directory, "states.json"), {
      schemaVersion: 1,
      profileId,
      runs: runs.map(
        ({
          actorId,
          scenarioId,
          actualScenarioId,
          cameraMode,
          initial,
          gestures,
          timeline: current,
        }) => ({
          actorId,
          scenarioId,
          actualScenarioId,
          cameraMode,
          initial,
          gestures: gestures.map(({ id, input, before, after, samples }) => ({
            id,
            input,
            before,
            after,
            samples,
          })),
          timeline: current,
        }),
      ),
      timeline,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      frames: timeline.map(
        ({
          tick,
          stateTick,
          manifestTick,
          stateHash,
          manifestHash,
          frameHash,
          frameFile,
          manifest,
          label,
        }) => ({
          tick,
          stateTick,
          manifestTick,
          stateHash,
          manifestHash,
          frameHash,
          frameFile,
          manifest,
          label,
        }),
      ),
    }),
  ]);
  return { profileId, runs, timeline };
}

function negativeControls(evidence) {
  const controls = [
    {
      id: "render-projection-reversed",
      expectedSignal: "screen-direction",
      mutate(value) {
        const run = value.profiles[0].runs.find(
          ({ actorId, cameraMode }) =>
            actorId === "vanguard" && cameraMode === "fixed",
        );
        const gesture = run.gestures.find(({ id }) => id === "move-east");
        gesture.after.manifest.drawCalls.find(
          ({ entityId }) => entityId === "player",
        ).screenAnchor.x =
          gesture.before.manifest.drawCalls.find(
            ({ entityId }) => entityId === "player",
          ).screenAnchor.x - 80;
      },
    },
    {
      id: "walk-frame-frozen",
      expectedSignal: "walk-frozen",
      mutate(value) {
        const run = value.profiles[0].runs[0];
        for (const sample of run.gestures[0].samples)
          sample.playerFrameIdentity = "same-frame";
      },
    },
    {
      id: "facing-forced-opposite",
      expectedSignal: "facing-mismatch",
      mutate(value) {
        const run = value.profiles[0].runs[0];
        for (const sample of run.gestures[0].samples)
          sample.playerFacingBucket = "south";
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateDirectionalMotionEvidence(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      expectedSignal,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      failures: result.failures,
    };
  });
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
    for (const actorId of DIRECTIONAL_MOTION_ACTOR_IDS)
      for (const cameraMode of CAMERA_MODES)
        runs.push(
          await runActorMode(
            page,
            session,
            baseURL,
            actorId,
            cameraMode,
            profile.input,
          ),
        );
    return { profileId, runs };
  } finally {
    await session?.detach();
    const video = page.video();
    await context.close();
    const videoPath = video ? await video.path() : null;
    if (videoPath) {
      await fs.mkdir(profileDirectory, { recursive: true });
      await fs.copyFile(
        videoPath,
        path.join(profileDirectory, "directional-motion.webm"),
      );
    }
  }
}

async function main() {
  const requestedProfiles = option("profiles", null);
  const profileIds = requestedProfiles
    ? requestedProfiles.split(",").filter((id) => id in PROFILES)
    : Object.keys(PROFILES);
  if (profileIds.length === 0)
    throw new Error("--profiles must name at least one known device profile");
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
    const profiles = [];
    for (const raw of rawProfiles)
      profiles.push(await normalizeProfile(raw, raw.profileId));
    await fs.rm(path.join(OUTPUT, "video-tmp"), {
      recursive: true,
      force: true,
    });
    const evidence = {
      requiredProfiles: profileIds,
      requiredActorIds: [...DIRECTIONAL_MOTION_ACTOR_IDS],
      requiredScenarioIds: Object.values(DIRECTIONAL_MOTION_SCENARIO_IDS),
      requiredDirectionIds: [...DIRECTIONAL_MOTION_DIRECTION_IDS],
      profiles,
    };
    const comparison = evaluateDirectionalMotionEvidence(evidence);
    const controls = negativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-MOVE-003",
      recipeId: "recipe:pres-move-003",
      evaluator: "directional-motion-v1",
      scenarioIds: Object.values(DIRECTIONAL_MOTION_SCENARIO_IDS),
      actualScenarioIds: Object.values(ACTUAL_SCENARIOS),
      actorIds: [...DIRECTIONAL_MOTION_ACTOR_IDS],
      profileIds,
      directionIds: [...DIRECTIONAL_MOTION_DIRECTION_IDS],
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:directional-motion",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "movement.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "directional-motion-v1",
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
        `PRES-MOVE-003 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-MOVE-003 PASS: ${profileIds.length} profiles, ${DIRECTIONAL_MOTION_ACTOR_IDS.length} actors, four cardinal directions, and three negative controls detected`,
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
