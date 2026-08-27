import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  evaluateLiveCompositorEvidence,
  measurePngResidual,
  runLiveCompositorNegativeControls,
} from "./lib/compositor-evidence.mjs";

const OUTPUT = path.resolve("quality-results/compositor/pres-flicker-024");
const VIEWPORT = { width: 960, height: 540 };
const PLAYABLE_ACTOR_IDS = ["vanguard", "ranger", "arcanist"];
const LIVE_PROFILES = {
  "desktop-60hz": {
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  "phone-portrait-rAF": {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  },
};
const LIVE_PACES = {
  normal: { sustainedMovementMs: 700, turnMovementMs: 350, actionGapMs: 180 },
  slow: { sustainedMovementMs: 1_200, turnMovementMs: 600, actionGapMs: 350 },
};
const SEGMENT_TICKS = {
  "mid-action-state": [240, 241, 242, 243],
  "loot-and-projectile-owners": [0, 1, 2, 3, 4],
  "effect-despawn": Array.from({ length: 32 }, (_, index) => index),
  "effect-kind-corpus": Array.from({ length: 26 }, (_, index) => index),
};
const EXPECTED_EFFECT_CORPUS = [
  {
    effectId: "effect:temporal-slash",
    kind: "slash",
    ownerId: "player",
  },
  {
    effectId: "effect:temporal-nova",
    kind: "nova",
    ownerId: "player",
  },
  {
    effectId: "effect:temporal-impact",
    kind: "impact",
    ownerId: "player",
  },
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Flicker evidence must contain a PNG data URL");
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
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
        `Flicker test server exited with code ${server.exitCode}`,
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
  throw new Error(`Flicker test server did not start at ${baseURL}`);
}

function expectedOwnerIds(snapshot) {
  return [
    "player",
    ...(snapshot.monsters ?? []).map(({ id }) => id),
    ...(snapshot.projectiles ?? []).map(({ id }) => id),
    ...(snapshot.loot ?? []).map(({ id }) => id),
    ...(snapshot.effects ?? []).map(({ id }) => id),
  ].sort();
}

function observedOwnerIds(manifest) {
  return (manifest.drawCalls ?? [])
    .filter(({ visible }) => visible)
    .map(({ entityId }) => entityId)
    .sort();
}

function ownerPaints(manifest) {
  const counts = new Map();
  for (const paint of manifest.paintQueue ?? []) {
    if (
      paint.kind !== "entity-body" ||
      !paint.call.visible ||
      typeof paint.ownerId !== "string"
    )
      continue;
    counts.set(paint.ownerId, (counts.get(paint.ownerId) ?? 0) + 1);
  }
  return [...counts]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([ownerId, bodyPaintCount]) => ({ ownerId, bodyPaintCount }));
}

function manifestEffects(manifest) {
  return (manifest.drawCalls ?? [])
    .filter(({ type, visible }) => type === "effect" && visible)
    .map(({ entityId, geometryId, ownerId }) => ({
      effectId: entityId,
      kind:
        typeof geometryId === "string" && geometryId.startsWith("effect:")
          ? geometryId.slice("effect:".length)
          : "",
      ownerId: ownerId ?? null,
    }))
    .sort((first, second) => first.effectId.localeCompare(second.effectId));
}

function manifestEffectIds(manifest) {
  return manifestEffects(manifest).map(({ effectId }) => effectId);
}

function frameRecord(capture) {
  return {
    tick: capture.snapshot.tick,
    snapshot: capture.snapshot,
    manifest: capture.manifest,
    expectedOwnerIds: expectedOwnerIds(capture.snapshot),
    observedOwnerIds: observedOwnerIds(capture.manifest),
    ownerPaints: ownerPaints(capture.manifest),
    effectIds: manifestEffectIds(capture.manifest),
    effectDetails: manifestEffects(capture.manifest),
    frame: capture.frame,
  };
}

function collectEffectLifecycles(effectFrames) {
  const expectedById = new Map();
  for (const frame of effectFrames) {
    for (const effect of frame.snapshot.effects ?? [])
      expectedById.set(effect.id, effect);
  }
  if (expectedById.size === 0)
    throw new Error("Effect lifecycle fixture contained no state effects");

  return [...expectedById.values()]
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((expected) => {
      const beforeIndex = effectFrames.findIndex(({ effectDetails }) =>
        effectDetails.some(({ effectId }) => effectId === expected.id),
      );
      const afterIndex =
        beforeIndex < 0
          ? -1
          : effectFrames.findIndex(
              ({ effectDetails }, index) =>
                index > beforeIndex &&
                !effectDetails.some(({ effectId }) => effectId === expected.id),
            );
      if (beforeIndex < 0 || afterIndex < 0)
        throw new Error(
          `Effect ${expected.id} did not contain both a visible and a despawned sample`,
        );
      const before = effectFrames[beforeIndex];
      const observed = before.effectDetails.find(
        ({ effectId }) => effectId === expected.id,
      );
      return {
        effectId: expected.id,
        kind: observed?.kind ?? "",
        expectedKind: expected.kind,
        ownerId: observed?.ownerId ?? null,
        expectedOwnerId: expected.ownerId ?? null,
        observedBefore: true,
        observedAfter: false,
        beforeTick: before.tick,
        afterTick: effectFrames[afterIndex].tick,
        startedAtTick: expected.startedAtTick,
        expectedDespawnStateTick: expected.expiresAtTick + 1,
      };
    });
}

function assertExpectedEffectCorpus(lifecycles) {
  for (const expected of EXPECTED_EFFECT_CORPUS) {
    const actual = lifecycles.find(
      ({ effectId }) => effectId === expected.effectId,
    );
    if (
      !actual ||
      actual.kind !== expected.kind ||
      actual.expectedKind !== expected.kind ||
      actual.ownerId !== expected.ownerId ||
      actual.expectedOwnerId !== expected.ownerId
    )
      throw new Error(
        `Effect corpus mismatch for ${expected.effectId}: expected ${expected.kind}/${expected.ownerId}`,
      );
  }
  if (
    new Set(lifecycles.map(({ kind }) => kind)).size !==
    EXPECTED_EFFECT_CORPUS.length
  )
    throw new Error("Effect corpus did not cover three distinct effect kinds");
}

async function waitForLiveReady(page) {
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready), {
    timeout: 30_000,
  });
  const route = await page.evaluate(() => ({
    bridgeExposed: Boolean(window.__GAME_TEST__),
    mode: window.__GAME_OBSERVE__?.mode,
  }));
  if (route.bridgeExposed || route.mode !== "observe-only")
    throw new Error("Live flicker route was not observe-only");
}

async function beginLiveRoute(page, baseURL, profile, actorId) {
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  const classCard = page.locator(`[data-class='${actorId}']`);
  await classCard.waitFor({ state: "visible" });
  if (profile.hasTouch) await classCard.tap();
  else await classCard.click();
  const begin = page.locator("#begin");
  if (profile.hasTouch) await begin.tap();
  else await begin.click();
  await waitForLiveReady(page);
  await page.evaluate(() =>
    window.__GAME_OBSERVE__?.clearPresentationSamples(),
  );
}

async function captureLiveFrame(page, label) {
  return page.evaluate((captureLabel) => {
    const observer = window.__GAME_OBSERVE__;
    if (!observer) throw new Error("Live flicker observer is unavailable");
    const snapshot = observer.snapshot();
    return {
      label: captureLabel,
      tick: snapshot.tick,
      frame: observer.captureFrame(),
    };
  }, label);
}

async function holdKeyboardMovement(page, pace) {
  await page.keyboard.down("d");
  try {
    await page.waitForTimeout(pace.sustainedMovementMs);
  } finally {
    await page.keyboard.up("d");
  }
  await page.waitForTimeout(80);
  await page.keyboard.down("s");
  try {
    await page.waitForTimeout(pace.turnMovementMs);
  } finally {
    await page.keyboard.up("s");
  }
}

async function holdTouchMovement(page, session, pace) {
  const pad = page.locator(".move-pad");
  const bounds = await pad.boundingBox();
  if (!bounds) throw new Error("Live flicker movement pad has no bounds");
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const radius = Math.min(bounds.width, bounds.height) * 0.32;
  const drag = async (id, target, duration) => {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...center, id, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...target, id, radiusX: 1, radiusY: 1, force: 1 }],
    });
    try {
      await page.waitForTimeout(duration);
    } finally {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
  };
  await drag(
    41,
    { x: center.x + radius, y: center.y },
    pace.sustainedMovementMs,
  );
  await page.waitForTimeout(80);
  await drag(42, { x: center.x, y: center.y + radius }, pace.turnMovementMs);
}

async function actionEventCount(page, eventType) {
  return page.evaluate(
    (type) =>
      (window.__GAME_OBSERVE__?.snapshot().eventLog ?? []).filter(
        ({ type: current, sourceId }) =>
          current === type && sourceId === "player",
      ).length,
    eventType,
  );
}

async function activateLiveAction(page, profile, action, pace) {
  const eventType = action === "ability" ? "ability_started" : "attack_started";
  const before = await actionEventCount(page, eventType);
  const button = page.locator(
    `${profile.hasTouch ? ".mobile-actions" : ".skills"} [data-action='${action}']`,
  );
  if (profile.hasTouch) await button.tap();
  else await button.click();
  await page.waitForFunction(
    ({ type, count }) =>
      (window.__GAME_OBSERVE__?.snapshot().eventLog ?? []).filter(
        ({ type: current, sourceId }) =>
          current === type && sourceId === "player",
      ).length > count,
    { type: eventType, count: before },
    { timeout: 3_000 },
  );
  await page.waitForTimeout(pace.actionGapMs);
}

function evaluatorLiveSample(sample, actorId) {
  return {
    actorId,
    observedAtMs: sample.observedAtMs,
    tick: sample.tick,
    presentationTick: sample.presentationTick,
    expectedOwnerIds: sample.expectedOwnerIds,
    observedOwnerIds: sample.observedOwnerIds,
    ownerPaints: sample.ownerPaints,
  };
}

async function runLiveRecording(
  browser,
  baseURL,
  profileId,
  profile,
  actorId,
  paceId,
  pace,
  captureFrames,
  recordVideo = true,
) {
  const videoDirectory = recordVideo
    ? path.join(OUTPUT, "video-tmp", `${profileId}-${actorId}-${paceId}`)
    : null;
  const liveDirectory = path.join(OUTPUT, "live", profileId, actorId);
  if (videoDirectory) await fs.mkdir(videoDirectory, { recursive: true });
  await fs.mkdir(liveDirectory, { recursive: true });
  const contextOptions = {
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    colorScheme: "dark",
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
  };
  if (recordVideo)
    contextOptions.recordVideo = {
      dir: videoDirectory,
      size: profile.viewport,
    };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const session = profile.hasTouch ? await context.newCDPSession(page) : null;
  const faults = [];
  const frames = [];
  page.on("pageerror", (error) => faults.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push(`console: ${message.text()}`);
  });
  let result;
  let videoPath;
  try {
    await beginLiveRoute(page, baseURL, profile, actorId);
    const capture = async (label) => {
      if (captureFrames) frames.push(await captureLiveFrame(page, label));
    };
    await capture("initial");
    if (profile.hasTouch) await holdTouchMovement(page, session, pace);
    else await holdKeyboardMovement(page, pace);
    await capture("after-sustained-movement-and-turn");
    await activateLiveAction(page, profile, "attack", pace);
    await capture("after-first-attack");
    await activateLiveAction(page, profile, "attack", pace);
    await capture("after-second-attack");
    await activateLiveAction(page, profile, "ability", pace);
    await capture("after-ability");
    await page.waitForTimeout(pace.actionGapMs * 2 + 250);
    const samples = await page.evaluate(() => {
      const observer = window.__GAME_OBSERVE__;
      if (!observer) throw new Error("Live flicker observer disappeared");
      return observer.presentationSamples();
    });
    if (faults.length > 0)
      throw new Error(
        `${profileId}/${actorId}/${paceId} browser faults: ${faults.join("; ")}`,
      );
    result = { samples, frames };
  } finally {
    await session?.detach();
    const video = page.video();
    await context.close();
    videoPath = video ? await video.path() : null;
    if (recordVideo && videoPath) {
      const target = path.join(liveDirectory, `${paceId}.webm`);
      await fs.copyFile(videoPath, target);
    }
  }
  if (recordVideo && !videoPath)
    throw new Error(`${profileId}/${actorId}/${paceId} did not produce video`);
  return result;
}

async function runLiveProfile(browser, baseURL, profileId, profile) {
  const actors = [];
  for (const actorId of PLAYABLE_ACTOR_IDS) {
    const normal = await runLiveRecording(
      browser,
      baseURL,
      profileId,
      profile,
      actorId,
      "normal",
      LIVE_PACES.normal,
      true,
    );
    const cadence = await runLiveRecording(
      browser,
      baseURL,
      profileId,
      profile,
      actorId,
      "cadence",
      LIVE_PACES.normal,
      false,
      false,
    );
    const slow =
      actorId === "vanguard"
        ? await runLiveRecording(
            browser,
            baseURL,
            profileId,
            profile,
            actorId,
            "slow",
            LIVE_PACES.slow,
            false,
          )
        : { samples: [] };
    const liveDirectory = path.join(OUTPUT, "live", profileId, actorId);
    const frameArtifacts = [];
    for (const [index, frame] of normal.frames.entries()) {
      const bytes = dataUrlBuffer(frame.frame);
      const name = `frame-${String(index).padStart(4, "0")}-${frame.label}.png`;
      await fs.writeFile(path.join(liveDirectory, name), bytes);
      frameArtifacts.push({
        actorId,
        tick: frame.tick,
        label: frame.label,
        file: `live/${profileId}/${actorId}/${name}`,
        sha256: sha256(bytes),
      });
    }
    const videoArtifacts = {};
    for (const paceId of actorId === "vanguard"
      ? ["normal", "slow"]
      : ["normal"]) {
      const file = `live/${profileId}/${actorId}/${paceId}.webm`;
      const bytes = await fs.readFile(path.join(OUTPUT, file));
      videoArtifacts[paceId] = { file, sha256: sha256(bytes) };
    }
    actors.push({
      actorId,
      sampleSource: "normal-no-frame-cadence-pass",
      samples: cadence.samples.map((sample) =>
        evaluatorLiveSample(sample, actorId),
      ),
      sampleDetails: cadence.samples,
      frameArtifacts,
      videoArtifacts,
      slowSampleCount: slow.samples.length,
    });
  }
  const frameArtifacts = actors.flatMap(({ frameArtifacts: frames }) => frames);
  const videoArtifacts = Object.fromEntries(
    actors.flatMap(({ actorId, videoArtifacts: videos }) =>
      Object.entries(videos).map(([paceId, artifact]) => [
        `${actorId}-${paceId}`,
        artifact,
      ]),
    ),
  );
  return {
    id: profileId,
    required: profileId === "desktop-60hz",
    viewport: { ...profile.viewport, dpr: profile.deviceScaleFactor },
    actors,
    samples: actors.flatMap(({ samples: actorSamples }) => actorSamples),
    sampleDetails: actors.flatMap(({ sampleDetails }) => sampleDetails),
    frameArtifacts,
    videoArtifacts,
    slowSampleCount: actors.reduce(
      (total, { slowSampleCount }) => total + slowSampleCount,
      0,
    ),
  };
}

async function main() {
  const port = 45_000 + (process.pid % 1_000);
  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });

  let server;
  let browser;
  try {
    const started = await startServer(port);
    server = started.server;
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await page.goto(`${started.baseURL}/?testMode=1&scenario=animation-idle`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));

    const raw = await page.evaluate(
      (segmentTicks) => {
        const bridge = window.__GAME_TEST__;
        if (!bridge) throw new Error("Game test bridge is unavailable");
        const captureAt = (targetTick) => {
          const remaining = targetTick - bridge.snapshot().tick;
          if (remaining < 0)
            throw new Error(`Cannot capture past tick ${targetTick}`);
          bridge.step(remaining, { render: true });
          bridge.render({ interpolationAlpha: 1 });
          return {
            snapshot: bridge.snapshot(),
            manifest: bridge.renderManifest(),
            frame: bridge.captureFrame(),
          };
        };
        const captureSegment = (scenarioId, ticks) => {
          bridge.loadScenario(scenarioId);
          return ticks.map(captureAt);
        };
        return {
          midAction: captureSegment("mid-action", segmentTicks.midAction),
          loot: captureSegment(
            "temporal-loot-bob",
            segmentTicks.lootAndProjectile,
          ),
          effect: captureSegment(
            "temporal-friendly-projectile-impact",
            segmentTicks.effectDespawn,
          ),
          effectCorpus: captureSegment(
            "temporal-effect-corpus",
            segmentTicks.effectKindCorpus,
          ),
          populated: captureSegment("mid-action", [240]),
          afterTransition: captureSegment("animation-idle", [0]),
          fresh: captureSegment("animation-idle", [0]),
        };
      },
      {
        midAction: SEGMENT_TICKS["mid-action-state"],
        lootAndProjectile: SEGMENT_TICKS["loot-and-projectile-owners"],
        effectDespawn: SEGMENT_TICKS["effect-despawn"],
        effectKindCorpus: SEGMENT_TICKS["effect-kind-corpus"],
      },
    );

    const segments = [
      {
        id: "mid-action-state",
        expectedTicks: SEGMENT_TICKS["mid-action-state"],
        frames: raw.midAction.map(frameRecord),
      },
      {
        id: "loot-and-projectile-owners",
        expectedTicks: SEGMENT_TICKS["loot-and-projectile-owners"],
        frames: raw.loot.map(frameRecord),
      },
      {
        id: "effect-despawn",
        expectedTicks: SEGMENT_TICKS["effect-despawn"],
        frames: raw.effect.map(frameRecord),
      },
      {
        id: "effect-kind-corpus",
        expectedTicks: SEGMENT_TICKS["effect-kind-corpus"],
        frames: raw.effectCorpus.map(frameRecord),
      },
    ];

    const runtimeEffectLifecycles = collectEffectLifecycles(segments[2].frames);
    const corpusEffectLifecycles = collectEffectLifecycles(segments[3].frames);
    assertExpectedEffectCorpus(corpusEffectLifecycles);
    const effects = [...runtimeEffectLifecycles, ...corpusEffectLifecycles];
    const transitionFrame = raw.afterTransition[0].frame;
    const freshFrame = raw.fresh[0].frame;
    const residual = await measurePngResidual(
      dataUrlBuffer(transitionFrame),
      dataUrlBuffer(freshFrame),
    );
    const liveRuns = [];
    for (const [profileId, profile] of Object.entries(LIVE_PROFILES))
      liveRuns.push(
        await runLiveProfile(browser, started.baseURL, profileId, profile),
      );
    const liveProfiles = liveRuns.flatMap(({ id, actors, required }) =>
      actors.map(({ actorId, samples }) => ({
        id: `${id}:${actorId}`,
        actorId,
        required,
        samples,
      })),
    );
    const evidence = {
      segments: segments.map(({ id, expectedTicks, frames }) => ({
        id,
        expectedTicks,
        frames: frames.map(
          ({
            tick,
            expectedOwnerIds,
            observedOwnerIds,
            ownerPaints,
            effectDetails,
          }) => ({
            tick,
            expectedOwnerIds,
            observedOwnerIds,
            ownerPaints,
            effectDetails,
          }),
        ),
      })),
      residuals: [residual],
      effects,
      liveProfiles,
    };
    const comparison = evaluateLiveCompositorEvidence(evidence);
    const controls = runLiveCompositorNegativeControls(evidence);

    const frameArtifacts = {};
    for (const segment of segments) {
      const directory = path.join(OUTPUT, segment.id);
      await fs.mkdir(directory, { recursive: true });
      frameArtifacts[segment.id] = [];
      for (const [frameIndex, frame] of segment.frames.entries()) {
        const name = `frame-${String(frameIndex).padStart(4, "0")}.png`;
        const bytes = dataUrlBuffer(frame.frame);
        await fs.writeFile(path.join(directory, name), bytes);
        frameArtifacts[segment.id].push({
          tick: frame.tick,
          file: `${segment.id}/${name}`,
          sha256: sha256(bytes),
        });
      }
    }
    const transitionArtifacts = {};
    for (const [name, capture] of Object.entries({
      populated: raw.populated[0],
      "after-transition": raw.afterTransition[0],
      fresh: raw.fresh[0],
    })) {
      const bytes = dataUrlBuffer(capture.frame);
      const file = `transition-${name}.png`;
      await fs.writeFile(path.join(OUTPUT, file), bytes);
      transitionArtifacts[name] = { file, sha256: sha256(bytes) };
    }

    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-FLICKER-024",
      recipeId: "recipe:pres-flicker-024",
      evaluator: "live-compositor-flicker-v1",
      scenarioIds: [
        ...PLAYABLE_ACTOR_IDS.map(
          (actorId) => `ordinary-live-idle-move-turn-attack:${actorId}`,
        ),
        "mid-action",
        "temporal-loot-bob",
        "temporal-friendly-projectile-impact",
        "temporal-effect-corpus",
        "animation-idle",
        "asset-state-transition",
      ],
      deviceProfileIds: liveRuns.map(({ id }) => id),
      gatedDeviceProfileIds: liveRuns
        .filter(({ required }) => required)
        .map(({ id }) => id),
      observedOnlyDeviceProfileIds: liveRuns
        .filter(({ required }) => !required)
        .map(({ id }) => id),
      gestureIds: ["sustained-movement", "repeated-attacks"],
      actorIds: PLAYABLE_ACTOR_IDS,
      viewport: { ...VIEWPORT, dpr: 1 },
      liveProfiles: liveRuns.map(
        ({
          id,
          required,
          viewport,
          actors,
          frameArtifacts,
          videoArtifacts,
          slowSampleCount,
        }) => ({
          id,
          required,
          viewport,
          actors,
          frameArtifacts,
          videoArtifacts,
          slowSampleCount,
        }),
      ),
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
      },
      reproductionCommand: "npm run test:flicker",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "timeline.json"), {
        schemaVersion: 1,
        evaluator: "live-compositor-flicker-v1",
        segments: segments.map(({ id, expectedTicks, frames }) => ({
          id,
          expectedTicks,
          frames: frames.map(
            ({
              tick,
              snapshot,
              manifest,
              expectedOwnerIds,
              observedOwnerIds,
              ownerPaints,
              effectIds,
              effectDetails,
            }) => ({
              tick,
              snapshot,
              manifest,
              expectedOwnerIds,
              observedOwnerIds,
              ownerPaints,
              effectIds,
              effectDetails,
            }),
          ),
        })),
        frameArtifacts,
        liveProfiles: liveRuns.map(
          ({
            id,
            required,
            viewport,
            actors,
            samples,
            sampleDetails,
            frameArtifacts,
            videoArtifacts,
          }) => ({
            id,
            required,
            viewport,
            actors,
            samples,
            sampleDetails,
            frameArtifacts,
            videoArtifacts,
          }),
        ),
      }),
      writeJson(path.join(OUTPUT, "transition.json"), {
        transition: {
          populated: transitionArtifacts.populated,
          after: transitionArtifacts["after-transition"],
          fresh: transitionArtifacts.fresh,
        },
        residual,
      }),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "live-compositor-flicker-v1",
        evidence,
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
        `PRES-FLICKER-024 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-FLICKER-024 PASS: ${segments.length} ordered segments, ${residual.differingPixels} residual pixels, ${controls.length} compositor controls detected`,
    );
    console.log(`Evidence: ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await browser?.close();
    server?.kill();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
