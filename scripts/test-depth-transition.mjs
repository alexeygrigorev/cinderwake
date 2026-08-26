import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  DEPTH_TRANSITION_SIGNAL_IDS,
  evaluateDepthTransitionEvidence,
} from "./lib/depth-transition-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/depth-transition/pres-depth-019");
const LOGICAL_VIEWPORT = { width: 960, height: 540 };
const THORN_SCENARIO_ID = "depth-transition-thorn-pillar";
const THORN_PROP_ID = "prop:3:0:thorn-pillar";
const THORN_CAMERA = { x: 31.5 * 48, y: 6.5 * 48, zoom: 1 };
const COMBAT_SCENARIO_ID = "temporal-ashfang-attack";
const COMBAT_MONSTER_ID = "monster:temporal-ashfang";
const COMBAT_CAMERA = { x: 9 * 48, y: 7 * 48, zoom: 0.9 };
const COMBAT_TICKS = [0, 1, 4, 7, 8, 18, 26, 27];
const PROFILES = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  "phone-portrait": {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

const THORN_TAPE = JSON.parse(
  await fs.readFile(
    new URL(
      "../tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Depth evidence capture must contain a PNG data URL");
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
}

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
        `Depth evidence server exited with code ${server.exitCode}`,
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
  throw new Error(`Depth evidence server did not start at ${baseURL}`);
}

function compactCall(call) {
  return {
    entityId: call.entityId,
    ownerId: call.ownerId,
    type: call.type,
    clip: call.clip,
    frameIndex: call.frameIndex,
    frameIdentity: call.frameIdentity,
    worldAnchor: call.worldAnchor,
    screenAnchor: call.screenAnchor,
    presentationOffset: call.presentationOffset,
    destinationRect: call.destinationRect,
    bounds: call.bounds,
    footAnchor: call.footAnchor,
    opacity: call.opacity,
    layer: call.layer,
    zOrder: call.zOrder,
    visible: call.visible,
  };
}

function compactScene(scene) {
  return {
    objectId: scene.objectId,
    kind: scene.kind,
    tile: scene.tile,
    worldAnchor: scene.worldAnchor,
    screenAnchor: scene.screenAnchor,
    destinationRect: scene.destinationRect,
    layer: scene.layer,
    zOrder: scene.zOrder,
    visible: scene.visible,
    opacity: scene.opacity,
    collision: scene.collision,
    collisionParts: scene.collisionParts,
  };
}

function compactUi(ui) {
  return {
    id: ui.id,
    type: ui.type,
    ownerId: ui.ownerId,
    destinationRect: ui.destinationRect,
    actorInkTop: ui.actorInkTop,
    healthRatio: ui.healthRatio,
    frameOpacity: ui.frameOpacity,
    fillOpacity: ui.fillOpacity,
    visible: ui.visible,
  };
}

function compactQueueItem(item) {
  const base = {
    paintId: item.paintId,
    kind: item.kind,
    zOrder: item.zOrder,
  };
  if (item.kind === "scene")
    return { ...base, scene: compactScene(item.scene) };
  if (item.kind === "health-frame" || item.kind === "health-fill")
    return { ...base, ownerId: item.ownerId, worldUi: compactUi(item.worldUi) };
  return {
    ...base,
    ownerId: item.ownerId,
    call: compactCall(item.call),
  };
}

function compactManifest(manifest, sceneIds) {
  const selected = new Set(sceneIds);
  const sceneSprites = manifest.sceneSprites
    .filter(
      (scene) =>
        selected.has(scene.objectId) ||
        (scene.layer !== "terrain" && scene.visible),
    )
    .map(compactScene);
  return {
    schemaVersion: manifest.schemaVersion,
    spriteCatalogRevision: manifest.spriteCatalogRevision,
    tick: manifest.tick,
    simTick: manifest.simTick,
    presentationTick: manifest.presentationTick,
    interpolationAlpha: manifest.interpolationAlpha,
    viewport: manifest.viewport,
    camera: manifest.camera,
    cameraTarget: manifest.cameraTarget,
    cameraMode: manifest.cameraMode,
    sceneSprites,
    drawCalls: manifest.drawCalls.map(compactCall),
    worldUi: manifest.worldUi.map(compactUi),
    paintQueue: manifest.paintQueue.map(compactQueueItem),
  };
}

async function captureAt(page, id, sceneIds = []) {
  return page.evaluate(
    ({ captureId, selectedSceneIds }) => {
      const bridge = window.__GAME_TEST__;
      if (!bridge) throw new Error("Game test bridge is unavailable");
      bridge.render({ interpolationAlpha: 1 });
      const snapshot = bridge.snapshot();
      const manifest = bridge.renderManifest();
      const paintIds = manifest.paintQueue.flatMap((item) => {
        if (
          item.kind === "scene" &&
          selectedSceneIds.includes(item.scene.objectId)
        )
          return [item.paintId];
        if (
          item.kind === "entity-body" &&
          ["player", "monster", "effect"].includes(item.call.type)
        )
          return [item.paintId];
        if (item.kind === "health-frame" || item.kind === "health-fill")
          return [item.paintId];
        return [];
      });
      const masks = paintIds.flatMap((paintId) => {
        try {
          return [bridge.capturePaintMask(paintId)];
        } catch {
          return [];
        }
      });
      return {
        id: captureId,
        tick: Number(snapshot.tick),
        stateTick: Number(snapshot.tick),
        manifestTick: Number(manifest.tick),
        snapshot,
        manifest,
        stateHash: bridge.stateHash(),
        frame: bridge.captureFrame(),
        masks,
      };
    },
    { captureId: id, selectedSceneIds: sceneIds },
  );
}

async function advance(page, input, ticks) {
  await page.evaluate(
    ({ nextInput, amount }) => {
      const bridge = window.__GAME_TEST__;
      bridge.setInput(nextInput);
      bridge.step(amount, { render: true });
    },
    { nextInput: input, amount: ticks },
  );
}

async function rawThornRoute(page) {
  await page.evaluate((camera) => {
    const bridge = window.__GAME_TEST__;
    bridge.loadScenario("depth-transition-thorn-pillar");
    bridge.setCamera(camera, "fixed");
  }, THORN_CAMERA);
  const behind = await captureAt(page, "thorn-behind", [THORN_PROP_ID]);
  await advance(page, THORN_TAPE.entries[0].input, 16);
  await advance(page, THORN_TAPE.entries[1].input, 22);
  const crossing = await captureAt(page, "thorn-crossing", [THORN_PROP_ID]);
  await advance(page, THORN_TAPE.entries[2].input, 16);
  await advance(page, THORN_TAPE.entries[3].input, 0);
  const front = await captureAt(page, "thorn-front", [THORN_PROP_ID]);
  return { frames: [behind, crossing, front], scenarioId: THORN_SCENARIO_ID };
}

async function rawGeneratedOverview(page) {
  await page.evaluate(
    (camera) => {
      const bridge = window.__GAME_TEST__;
      bridge.loadScenario("generated-run");
      bridge.setCamera(camera, "fixed");
    },
    { x: 22.5 * 48, y: 16.5 * 48, zoom: 0.9 },
  );
  const sceneIds = await page.evaluate(() =>
    window.__GAME_TEST__
      .renderManifest()
      .sceneSprites.filter(
        ({ layer, visible }) => layer !== "terrain" && visible,
      )
      .map(({ objectId }) => objectId),
  );
  const frame = await captureAt(page, "generated-overview", sceneIds);
  return { frames: [frame], scenarioId: "generated-run", sceneIds };
}

async function rawCombatFrames(page) {
  await page.evaluate((camera) => {
    const bridge = window.__GAME_TEST__;
    bridge.loadScenario("temporal-ashfang-attack");
    bridge.setCamera(camera, "fixed");
  }, COMBAT_CAMERA);
  const frames = [];
  for (const tick of COMBAT_TICKS) {
    const current = Number(
      await page.evaluate(() => window.__GAME_TEST__.snapshot().tick),
    );
    if (tick < current)
      throw new Error(
        `Combat capture tick ${tick} is before current tick ${current}`,
      );
    if (tick > current) await advance(page, {}, tick - current);
    frames.push(await captureAt(page, `combat-ashfang-${tick}`));
  }
  return { frames, scenarioId: COMBAT_SCENARIO_ID };
}

function sanitize(value) {
  return String(value).replaceAll(/[^A-Za-z0-9._-]+/g, "-");
}

async function alphaStats(bytes) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let alphaPixels = 0;
  for (
    let index = info.channels - 1;
    index < data.length;
    index += info.channels
  )
    if (data[index] > 8) alphaPixels += 1;
  return { data, info, alphaPixels };
}

function overlapStats(first, second) {
  if (
    first.info.width !== second.info.width ||
    first.info.height !== second.info.height
  )
    return { overlapPixels: 0 };
  const alphaChannel = first.info.channels - 1;
  let overlapPixels = 0;
  for (
    let index = alphaChannel;
    index < first.data.length;
    index += first.info.channels
  )
    if (first.data[index] > 8 && second.data[index] > 8) overlapPixels += 1;
  return { overlapPixels };
}

function maskById(masks, paintId) {
  return masks.find(({ paintId: candidate }) => candidate === paintId) ?? null;
}

function pairById(overlaps, first, second) {
  return (
    overlaps.find(
      ({ first: left, second: right }) =>
        (left === first && right === second) ||
        (left === second && right === first),
    ) ?? null
  );
}

async function normalizeFrame(raw, directory, sceneIds, depth) {
  const frameBuffer = dataUrlBuffer(raw.frame);
  const frameFile = `frame-${sanitize(raw.id)}.png`;
  await fs.writeFile(path.join(directory, frameFile), frameBuffer);
  const masks = [];
  const decoded = new Map();
  for (const rawMask of raw.masks) {
    const bytes = dataUrlBuffer(rawMask.image);
    const maskFile = `mask-${sanitize(raw.id)}-${sanitize(rawMask.paintId)}.png`;
    await fs.writeFile(path.join(directory, maskFile), bytes);
    const stats = await alphaStats(bytes);
    decoded.set(rawMask.paintId, stats);
    const publicMask = { ...rawMask };
    delete publicMask.image;
    masks.push({
      ...publicMask,
      file: maskFile,
      artifactSha256: sha256(bytes),
      alphaPixels: stats.alphaPixels,
    });
  }
  const overlaps = [];
  for (let first = 0; first < masks.length; first += 1) {
    for (let second = first + 1; second < masks.length; second += 1) {
      const left = masks[first];
      const right = masks[second];
      const metrics = overlapStats(
        decoded.get(left.paintId),
        decoded.get(right.paintId),
      );
      overlaps.push({
        first: left.paintId,
        second: right.paintId,
        overlapPixels: metrics.overlapPixels,
      });
    }
  }
  const manifest = compactManifest(raw.manifest, sceneIds);
  const effectMetrics = manifest.drawCalls
    .filter(({ type, ownerId }) => type === "effect" && ownerId)
    .flatMap((effect) => {
      const owner = maskById(masks, `body:${effect.ownerId}`);
      const effectMask = maskById(masks, `body:${effect.entityId}`);
      const overlap = pairById(
        overlaps,
        `body:${effect.ownerId}`,
        `body:${effect.entityId}`,
      );
      if (!owner || !effectMask || !overlap) return [];
      return [
        {
          effectId: effect.entityId,
          ownerPaintId: owner.paintId,
          effectPaintId: effectMask.paintId,
          ownerAlphaPixels: owner.alphaPixels,
          effectAlphaPixels: effectMask.alphaPixels,
          overlapPixels: overlap.overlapPixels,
          opacity: effect.opacity,
        },
      ];
    });
  const healthMetrics = manifest.worldUi.flatMap((ui) => {
    if (!ui.visible) return [];
    const owner = maskById(masks, `body:${ui.ownerId}`);
    const frameMask = maskById(masks, `health-frame:${ui.ownerId}`);
    const fillMask = maskById(masks, `health-fill:${ui.ownerId}`);
    const frameOverlap = pairById(
      overlaps,
      `body:${ui.ownerId}`,
      `health-frame:${ui.ownerId}`,
    );
    const fillOverlap = pairById(
      overlaps,
      `body:${ui.ownerId}`,
      `health-fill:${ui.ownerId}`,
    );
    if (!owner || !frameMask || !fillMask || !frameOverlap || !fillOverlap)
      return [
        {
          ownerId: ui.ownerId,
          framePaintId: `health-frame:${ui.ownerId}`,
          fillPaintId: `health-fill:${ui.ownerId}`,
          ownerAlphaPixels: owner?.alphaPixels ?? 0,
          frameOverlapPixels: frameOverlap?.overlapPixels ?? 0,
          fillOverlapPixels: fillOverlap?.overlapPixels ?? 0,
        },
      ];
    return [
      {
        ownerId: ui.ownerId,
        framePaintId: frameMask.paintId,
        fillPaintId: fillMask.paintId,
        ownerAlphaPixels: owner.alphaPixels,
        frameOverlapPixels: frameOverlap.overlapPixels,
        fillOverlapPixels: fillOverlap.overlapPixels,
      },
    ];
  });
  const depthSample = depth
    ? {
        ...depth,
        alphaIntersection:
          pairById(overlaps, depth.actorPaintId, depth.occluderPaintId)
            ?.overlapPixels ?? 0,
      }
    : undefined;
  const publicFrame = {
    id: raw.id,
    scenarioId: raw.scenarioId,
    tick: raw.tick,
    stateTick: raw.stateTick,
    manifestTick: raw.manifestTick,
    snapshot: raw.snapshot,
    stateHash: raw.stateHash,
    manifestHash: hashJson(manifest),
    frameHash: sha256(frameBuffer),
    frameFile,
    manifest,
    masks,
    maskOverlaps: overlaps,
    effectMetrics,
    healthMetrics,
    requiredEffectOwnerIds: [
      ...new Set(
        manifest.drawCalls
          .filter(({ type, ownerId }) => type === "effect" && ownerId)
          .map(({ ownerId }) => ownerId),
      ),
    ],
  };
  if (depthSample) publicFrame.depth = depthSample;
  return publicFrame;
}

function combatLifecycle(frames) {
  return frames.flatMap((frame) => {
    const call = frame.manifest.drawCalls.find(
      ({ entityId }) => entityId === COMBAT_MONSTER_ID,
    );
    return call
      ? [
          {
            frameId: frame.id,
            actorId: COMBAT_MONSTER_ID,
            clip: call.clip,
            frameIndex: call.frameIndex,
          },
        ]
      : [];
  });
}

function profileEvidence(frames, generated) {
  const thorn = frames.filter(({ id }) => id.startsWith("thorn-"));
  const combat = frames.filter(({ id }) => id.startsWith("combat-"));
  return {
    schemaVersion: 1,
    checkId: "PRES-DEPTH-019",
    recipeId: "recipe:pres-depth-019",
    evaluator: "depth-transition-oracle-v1",
    profileId: generated.profileId,
    scenarioIds: ["generated-run", THORN_SCENARIO_ID, COMBAT_SCENARIO_ID],
    frames,
    transitions: [
      {
        behindFrameId: thorn[0]?.id,
        frontFrameId: thorn.at(-1)?.id,
        actorId: "player",
        occluderId: THORN_PROP_ID,
      },
    ],
    requiredEffectOwnerIds: [],
    combatLifecycle: combatLifecycle(combat),
    coverage: {
      generatedRaisedSceneIds: generated.sceneIds,
      actorClasses: ["vanguard"],
      occluders: [THORN_PROP_ID],
    },
  };
}

function reindex(frame) {
  frame.manifest.paintQueue.forEach((item, index) => {
    item.zOrder = index;
  });
}

function swapPaint(frame, firstPaintId, secondPaintId) {
  const queue = frame.manifest.paintQueue;
  const first = queue.findIndex(({ paintId }) => paintId === firstPaintId);
  const second = queue.findIndex(({ paintId }) => paintId === secondPaintId);
  if (first < 0 || second < 0) return;
  [queue[first], queue[second]] = [queue[second], queue[first]];
  reindex(frame);
}

function negativeControls(evidence) {
  const attached = evidence.frames.find(
    (frame) => frame.effectMetrics.length > 0,
  );
  const healthFrame = evidence.frames.find(
    (frame) => frame.healthMetrics.length > 0,
  );
  const thorn = evidence.frames.find((frame) => frame.id === "thorn-behind");
  const controls = [
    {
      id: "actor-prop-z-swapped",
      expectedSignal: "depth-order-mismatch",
      mutate(value) {
        swapPaint(
          value.frames.find(({ id }) => id === "thorn-behind"),
          "body:player",
          `scene:${THORN_PROP_ID}`,
        );
      },
    },
    {
      id: "health-behind-owner",
      expectedSignal: "health-z-order-mismatch",
      mutate(value) {
        const frame = value.frames.find(({ id }) => id === healthFrame?.id);
        if (frame)
          swapPaint(
            frame,
            `body:${COMBAT_MONSTER_ID}`,
            `health-frame:${COMBAT_MONSTER_ID}`,
          );
      },
    },
    {
      id: "effect-detached",
      expectedSignal: "effect-owner-detached",
      mutate(value) {
        const frame = value.frames.find(({ id }) => id === attached?.id);
        const effect = frame?.manifest.drawCalls.find(
          ({ type }) => type === "effect",
        );
        if (effect) effect.ownerId = "monster:missing";
      },
    },
    {
      id: "actor-drawn-twice",
      expectedSignal: "duplicate-owner-body",
      mutate(value) {
        const frame = value.frames.find(({ id }) => id === thorn?.id);
        const body = frame?.manifest.paintQueue.find(
          ({ paintId }) => paintId === "body:player",
        );
        if (frame && body) {
          frame.manifest.paintQueue.push({ ...body });
          reindex(frame);
        }
      },
    },
    {
      id: "rear-actor-covers-front",
      expectedSignal: "actor-depth-inverted",
      mutate(value) {
        const frame = value.frames.find(({ id }) => id === attached?.id);
        const player = frame?.manifest.drawCalls.find(
          ({ entityId }) => entityId === "player",
        );
        const monster = frame?.manifest.drawCalls.find(
          ({ entityId }) => entityId === COMBAT_MONSTER_ID,
        );
        if (!frame || !player || !monster) return;
        monster.destinationRect = { ...player.destinationRect };
        monster.footAnchor.y = player.footAnchor.y + 10;
        swapPaint(frame, "body:player", `body:${COMBAT_MONSTER_ID}`);
      },
    },
    {
      id: "health-enlarged-or-opaque",
      expectedSignal: "health-occlusion-ratio-exceeded",
      mutate(value) {
        const frame = value.frames.find(({ id }) => id === healthFrame?.id);
        const ui = frame?.manifest.worldUi.find(
          ({ ownerId }) => ownerId === COMBAT_MONSTER_ID,
        );
        if (!ui) return;
        ui.destinationRect.width *= 2;
        ui.frameOpacity = 1;
        ui.fillOpacity = 1;
      },
    },
    {
      id: "effect-covers-owner",
      expectedSignal: "effect-owner-occlusion-ratio-exceeded",
      mutate(value) {
        const frame = value.frames.find(({ id }) => id === attached?.id);
        const metric = frame?.effectMetrics[0];
        if (!metric) return;
        metric.overlapPixels = metric.ownerAlphaPixels;
        metric.opacity = 1;
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateDepthTransitionEvidence(mutated);
    const detected = result.failures.some((failure) =>
      failure.startsWith(expectedSignal),
    );
    return {
      id,
      expectedSignal,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      failures: result.failures,
    };
  });
}

async function writeContactSheet(directory, frames) {
  const selected = frames.filter(({ id }) =>
    [
      "thorn-behind",
      "thorn-crossing",
      "thorn-front",
      "generated-overview",
    ].includes(id),
  );
  if (selected.length === 0) return;
  const cellWidth = 320;
  const cellHeight = 180;
  const columns = 2;
  const rows = Math.ceil(selected.length / columns);
  const layers = await Promise.all(
    selected.map(async (frame, index) => ({
      input: await sharp(path.join(directory, frame.frameFile))
        .resize(cellWidth, cellHeight, { fit: "fill" })
        .png()
        .toBuffer(),
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    })),
  );
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

async function recordProfile(page, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  const generated = await rawGeneratedOverview(page);
  const thorn = await rawThornRoute(page);
  const combat = await rawCombatFrames(page);
  const rawFrames = [
    ...generated.frames.map((frame) => ({
      ...frame,
      scenarioId: generated.scenarioId,
    })),
    ...thorn.frames.map((frame) => ({
      ...frame,
      scenarioId: thorn.scenarioId,
      depth: {
        actorId: "player",
        occluderId: THORN_PROP_ID,
        actorPaintId: "body:player",
        occluderPaintId: `scene:${THORN_PROP_ID}`,
      },
    })),
    ...combat.frames.map((frame) => ({
      ...frame,
      scenarioId: combat.scenarioId,
    })),
  ];
  const frames = [];
  for (const raw of rawFrames) {
    const sceneIds =
      raw.scenarioId === THORN_SCENARIO_ID
        ? [THORN_PROP_ID]
        : raw.scenarioId === "generated-run"
          ? generated.sceneIds
          : [];
    frames.push(await normalizeFrame(raw, directory, sceneIds, raw.depth));
  }
  await writeContactSheet(directory, frames);
  const evidence = profileEvidence(frames, {
    profileId,
    sceneIds: generated.sceneIds,
  });
  const comparison = evaluateDepthTransitionEvidence(evidence);
  const controls = negativeControls(evidence);
  await Promise.all([
    writeJson(path.join(directory, "depth-transition.json"), evidence),
    writeJson(path.join(directory, "comparison.json"), {
      schemaVersion: 1,
      evaluator: "depth-transition-oracle-v1",
      comparison,
      negativeControls: controls,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      profileId,
      frames: frames.map(({ id, tick, stateTick, manifestTick, manifest }) => ({
        id,
        tick,
        stateTick,
        manifestTick,
        manifest,
      })),
    }),
  ]);
  return { profileId, evidence, comparison, controls, generated };
}

function aggregateComparisons(results) {
  const failures = [
    ...new Set(results.flatMap(({ comparison }) => comparison.failures)),
  ];
  const signals = DEPTH_TRANSITION_SIGNAL_IDS.map((id) => ({
    id,
    pass: results.every(
      ({ comparison }) =>
        comparison.signals.find((signal) => signal.id === id)?.pass === true,
    ),
    detail: {
      profiles: results.map(({ profileId, comparison }) => ({
        profileId,
        signal: comparison.signals.find((signal) => signal.id === id) ?? null,
      })),
    },
  }));
  return {
    pass: failures.length === 0 && signals.every(({ pass }) => pass),
    failures,
    signals,
    profiles: results.map(({ profileId, comparison }) => ({
      profileId,
      pass: comparison.pass,
      failures: comparison.failures,
    })),
  };
}

async function main() {
  const port = Number(option("port", String(46_000 + (process.pid % 1_000))));
  if (!Number.isInteger(port) || port < 1024 || port > 65_535)
    throw new Error("--port must be an available TCP port");
  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });
  let server;
  let browser;
  try {
    const started = await startServer(port);
    server = started.server;
    browser = await chromium.launch();
    const results = [];
    for (const [profileId, profile] of Object.entries(PROFILES)) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.deviceScaleFactor,
        colorScheme: "dark",
        isMobile: profile.isMobile,
        hasTouch: profile.hasTouch,
      });
      const page = await context.newPage();
      await page.goto(
        `${started.baseURL}/?testMode=1&scenario=animation-idle`,
        {
          waitUntil: "networkidle",
        },
      );
      await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
      results.push(await recordProfile(page, profileId));
      await context.close();
    }
    const comparison = aggregateComparisons(results);
    const controls = results.flatMap(({ profileId, controls: current }) =>
      current.map((control) => ({ ...control, profileId })),
    );
    const source = sourceSnapshot();
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-DEPTH-019",
      recipeId: "recipe:pres-depth-019",
      evaluator: "depth-transition-oracle-v1",
      profileIds: Object.keys(PROFILES),
      scenarioIds: ["generated-run", THORN_SCENARIO_ID, COMBAT_SCENARIO_ID],
      source,
      viewport: LOGICAL_VIEWPORT,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: await browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:depth-transition",
      coverage: results.map(({ profileId, generated, evidence }) => ({
        profileId,
        generatedRaisedSceneIds: generated.sceneIds,
        frameIds: evidence.frames.map(({ id }) => id),
        transitionCount: evidence.transitions.length,
        combatFrameCount: evidence.combatLifecycle.length,
      })),
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "depth-transition-oracle-v1",
        comparison,
        negativeControls: controls,
      }),
      writeJson(
        path.join(OUTPUT, "depth-transition.json"),
        Object.fromEntries(
          results.map(({ profileId, evidence }) => [profileId, evidence]),
        ),
      ),
    ]);
    if (
      !comparison.pass ||
      controls.some(({ status }) => status !== "DETECTED")
    )
      throw new Error(
        `PRES-DEPTH-019 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ profileId, id }) => `${profileId}:${id}-not-detected`),
        ].join(", ")}`,
      );
    console.log(
      `PRES-DEPTH-019 PASS: ${results.length} profiles, ${results[0].evidence.frames.length} frames/profile, seven negative controls/profile`,
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
