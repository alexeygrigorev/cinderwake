import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  DIRECTIONAL_BANK_ACTOR_IDS,
  DIRECTIONAL_BANK_DIRECTION_IDS,
  expectedHorizontalFlip,
  evaluateDirectionalBankEvidence,
} from "./lib/directional-bank-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";
import { runtimeFingerprint } from "./lib/action-visual-review.mjs";

const OUTPUT = path.resolve("quality-results/directional-bank/pres-facing-015");
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

const DIRECTIONS = [
  {
    id: "move-north",
    x: 0,
    y: -1,
    facing: "north",
    opposite: "move-south",
  },
  { id: "move-east", x: 1, y: 0, facing: "east", opposite: "move-west" },
  {
    id: "move-south",
    x: 0,
    y: 1,
    facing: "south",
    opposite: "move-north",
  },
  { id: "move-west", x: -1, y: 0, facing: "west", opposite: "move-east" },
];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function vector(facing) {
  return {
    north: { x: 0, y: -1024 },
    east: { x: 1024, y: 0 },
    south: { x: 0, y: 1024 },
    west: { x: -1024, y: 0 },
  }[facing];
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Directional-bank evidence must contain a PNG data URL");
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
        `Directional-bank server exited with code ${server.exitCode}`,
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
  throw new Error(`Directional-bank server did not start at ${baseURL}`);
}

async function preparePage(page, baseURL) {
  await page.goto(`${baseURL}/?testMode=1&scenario=animation-idle`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () =>
      Boolean(window.__GAME_TEST__?.ready && window.__GAME_OBSERVE__?.ready),
    { timeout: 30_000 },
  );
  const route = await page.evaluate(() => ({
    bridge: Boolean(window.__GAME_TEST__),
    observer: window.__GAME_OBSERVE__?.mode,
  }));
  if (!route.bridge || route.observer !== "observe-only")
    throw new Error(
      "Directional-bank route did not expose both test boundaries",
    );
}

async function loadFacing(page, scenarioId, facing) {
  await page.evaluate(
    ({ currentScenarioId, currentFacing }) => {
      const bridge = window.__GAME_TEST__;
      if (!bridge)
        throw new Error("Directional-bank test bridge is unavailable");
      bridge.loadScenario(currentScenarioId);
      const state = bridge.snapshot();
      state.player.facing = currentFacing;
      state.player.velocity = { x: 0, y: 0 };
      state.player.previousPosition = { ...state.player.position };
      bridge.loadState(state);
      bridge.render({ interpolationAlpha: 1 });
    },
    { currentScenarioId: scenarioId, currentFacing: vector(facing) },
  );
}

async function capture(page, label, retainFrame, actorId, expectedFacing) {
  return page.evaluate(
    async ({
      captureLabel,
      shouldRetainFrame,
      currentActorId,
      currentFacing,
      expectedFlipX,
    }) => {
      const bridge = window.__GAME_TEST__;
      if (!bridge)
        throw new Error("Directional-bank test bridge is unavailable");
      bridge.render({ interpolationAlpha: 1 });
      const snapshot = bridge.snapshot();
      const manifest = bridge.renderManifest();
      const call = manifest.drawCalls.find(
        ({ entityId }) => entityId === "player",
      );
      let visualFacing = null;
      if (call && (currentFacing === "east" || currentFacing === "west")) {
        const actualMask = bridge.captureEntityMask("player");
        const image = new Image();
        image.src = new URL(
          `assets/sprites/actor-${currentActorId}.png`,
          document.baseURI,
        ).href;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = actualMask.width;
        canvas.height = actualMask.height;
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) throw new Error("Raster facing canvas is unavailable");
        const anchor = {
          x: canvas.width / 2,
          y: canvas.height - 28,
        };
        const destination = {
          x: Math.round(anchor.x - call.destinationRect.width / 2),
          y: Math.round(anchor.y - (232 / 256) * call.destinationRect.height),
          width: call.destinationRect.width,
          height: call.destinationRect.height,
        };
        const centerX = destination.x + destination.width / 2;
        const centerY = destination.y + destination.height / 2;
        context.save();
        context.globalAlpha = Math.max(0, Math.min(1, call.opacity));
        context.translate(centerX, centerY);
        if (expectedFlipX) context.scale(-1, 1);
        context.drawImage(
          image,
          call.sourceRect.x,
          call.sourceRect.y,
          call.sourceRect.width,
          call.sourceRect.height,
          -destination.width / 2,
          -destination.height / 2,
          destination.width,
          destination.height,
        );
        context.restore();
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let hash = 0x811c9dc5;
        for (const pixel of pixels) {
          hash ^= pixel;
          hash = Math.imul(hash, 0x01000193);
        }
        visualFacing = {
          expectedFacing: currentFacing,
          expectedFlipX,
          actualFlipX: call.flipX,
          actualPixelHash: actualMask.pixelHash,
          expectedPixelHash: (hash >>> 0).toString(16).padStart(8, "0"),
        };
      }
      return {
        label: captureLabel,
        tick: Number(snapshot.tick),
        stateTick: Number(snapshot.tick),
        manifestTick: Number(manifest.tick),
        stateHash: bridge.stateHash(),
        snapshot,
        manifest,
        visualFacing,
        frame: shouldRetainFrame ? bridge.captureFrame() : null,
      };
    },
    {
      captureLabel: label,
      shouldRetainFrame: retainFrame,
      currentActorId: actorId,
      currentFacing: expectedFacing,
      expectedFlipX:
        actorId && expectedFacing
          ? expectedHorizontalFlip(actorId, expectedFacing)
          : false,
    },
  );
}

async function runAction(page, scenarioId, actorId, direction, kind) {
  await loadFacing(page, scenarioId, direction.facing);
  const actionBefore = await capture(
    page,
    `${actorId}-${direction.id}-${kind}-before`,
    false,
    actorId,
    direction.facing,
  );
  const aim = {
    x: actionBefore.snapshot.player.position.x + direction.x * 1_024,
    y: actionBefore.snapshot.player.position.y + direction.y * 1_024,
  };
  const input = {
    ...(kind === "primary" ? { attack: true } : { ability: true }),
    aim,
  };
  await page.evaluate(
    ({ actionInput }) => {
      const bridge = window.__GAME_TEST__;
      bridge.setInput(actionInput);
      bridge.step(1, { render: true });
      bridge.clearInput();
    },
    { actionInput: input },
  );
  const actionAfter = await capture(
    page,
    `${actorId}-${direction.id}-${kind}-after`,
    true,
    actorId,
    direction.facing,
  );
  const pendingAttack = actionAfter.snapshot.pendingAttacks.find(
    ({ ownerId, kind: attackKind }) =>
      ownerId === "player" && attackKind === kind,
  );
  if (!pendingAttack)
    throw new Error(`No pending ${kind} attack for ${actorId}/${direction.id}`);
  const impactTicks = pendingAttack.impactTick - actionAfter.snapshot.tick + 1;
  await page.evaluate((ticks) => {
    const bridge = window.__GAME_TEST__;
    bridge.step(Math.max(1, ticks), { render: true });
  }, impactTicks);
  const actionImpact = await capture(
    page,
    `${actorId}-${direction.id}-${kind}-impact`,
    true,
    actorId,
    direction.facing,
  );
  const recoveryTicks =
    actionAfter.snapshot.player.animation.lockedUntilTick -
    actionAfter.snapshot.tick +
    1;
  await page.evaluate((ticks) => {
    const bridge = window.__GAME_TEST__;
    bridge.step(Math.max(1, ticks), { render: true });
  }, recoveryTicks);
  const actionRecovery = await capture(
    page,
    `${actorId}-${direction.id}-${kind}-recovery`,
    true,
    actorId,
    direction.facing,
  );
  return {
    kind,
    input,
    before: actionBefore,
    after: actionAfter,
    impact: actionImpact,
    recovery: actionRecovery,
    pendingAttack,
    produced: producedEntities(actorId, kind, actionImpact.snapshot),
  };
}

function producedEntities(actorId, kind, snapshot) {
  if (actorId === "vanguard" || (actorId === "arcanist" && kind === "ability"))
    return snapshot.effects
      .filter(({ ownerId }) => ownerId === "player")
      .map(({ id, ownerId, kind, position }) => ({
        id,
        type: "effect",
        ownerId,
        kind,
        position,
      }));
  return snapshot.projectiles
    .filter(({ owner }) => owner === "player")
    .map(({ id, owner, position, previousPosition, velocity }) => ({
      id,
      type: "projectile",
      ownerId: owner,
      position: previousPosition ?? position,
      velocity,
    }));
}

async function runActor(page, actorId) {
  const scenarioId = `fixed-camera-open-floor-${actorId}`;
  const directions = [];
  for (const direction of DIRECTIONS) {
    await loadFacing(page, scenarioId, direction.facing);
    const movementBefore = await capture(
      page,
      `${actorId}-${direction.id}-movement-before`,
      false,
      actorId,
      direction.facing,
    );
    await page.evaluate(({ x, y }) => {
      const bridge = window.__GAME_TEST__;
      bridge.setInput({ moveX: x, moveY: y });
      bridge.step(6, { render: true });
    }, direction);
    const movementAfter = await capture(
      page,
      `${actorId}-${direction.id}-movement-after`,
      true,
      actorId,
      direction.facing,
    );
    const opposite = DIRECTIONS.find(({ id }) => id === direction.opposite);
    await page.evaluate(({ x, y }) => {
      const bridge = window.__GAME_TEST__;
      bridge.setInput({ moveX: x, moveY: y });
      bridge.step(1, { render: true });
      bridge.clearInput();
    }, opposite);
    const movementTurn = await capture(
      page,
      `${actorId}-${direction.id}-movement-turn`,
      true,
      actorId,
      opposite.facing,
    );
    directions.push({
      directionId: direction.id,
      turnDirectionId: direction.opposite,
      movement: {
        before: movementBefore,
        after: movementAfter,
        turn: movementTurn,
      },
      action: await runAction(page, scenarioId, actorId, direction, "primary"),
      ability: await runAction(page, scenarioId, actorId, direction, "ability"),
    });
  }
  return { profileId: null, actorId, scenarioId, directions };
}

function directionalSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    scenarioId: snapshot.scenarioId,
    tick: snapshot.tick,
    player: {
      classId: snapshot.player.classId,
      position: snapshot.player.position,
      previousPosition: snapshot.player.previousPosition,
      velocity: snapshot.player.velocity,
      facing: snapshot.player.facing,
      animation: snapshot.player.animation,
    },
    pendingAttacks: snapshot.pendingAttacks.map(
      ({ id, ownerId, kind, impactTick, origin, direction }) => ({
        id,
        ownerId,
        kind,
        impactTick,
        origin,
        direction,
      }),
    ),
    projectiles: snapshot.projectiles.map(
      ({
        id,
        owner,
        hostile,
        position,
        previousPosition,
        velocity,
        spawnedAtTick,
      }) => ({
        id,
        owner,
        hostile,
        position,
        previousPosition,
        velocity,
        spawnedAtTick,
      }),
    ),
    effects: snapshot.effects.map(
      ({ id, ownerId, kind, position, startedAtTick, expiresAtTick }) => ({
        id,
        ownerId,
        kind,
        position,
        startedAtTick,
        expiresAtTick,
      }),
    ),
  };
}

function directionalCall(call) {
  if (!call) return null;
  return {
    entityId: call.entityId,
    type: call.type,
    geometryId: call.geometryId,
    spriteId: call.spriteId,
    assetId: call.assetId,
    clip: call.clip,
    frameIndex: call.frameIndex,
    frameCount: call.frameCount,
    frameIdentity: call.frameIdentity,
    facing: call.facing,
    facingBucket: call.facingBucket,
    flipX: call.flipX,
    worldAnchor: call.worldAnchor,
    screenAnchor: call.screenAnchor,
    destinationRect: call.destinationRect,
    footAnchor: call.footAnchor,
    visible: call.visible,
  };
}

function directionalManifest(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    spriteCatalogRevision: manifest.spriteCatalogRevision,
    tick: manifest.tick,
    simTick: manifest.simTick,
    presentationTick: manifest.presentationTick,
    interpolationAlpha: manifest.interpolationAlpha,
    cameraMode: manifest.cameraMode,
    camera: manifest.camera,
    cameraTarget: manifest.cameraTarget,
    viewport: manifest.viewport,
    drawCalls: [
      directionalCall(
        manifest.drawCalls.find(({ entityId }) => entityId === "player"),
      ),
    ].filter(Boolean),
  };
}

function normalizeCapture(raw, directory, index) {
  const frame = raw.frame ? dataUrlBuffer(raw.frame) : null;
  const frameFile = frame
    ? `frames/frame-${String(index).padStart(4, "0")}-${raw.label}.png`
    : null;
  return {
    tick: raw.tick,
    stateTick: raw.stateTick,
    manifestTick: raw.manifestTick,
    stateHash: raw.stateHash,
    manifestHash: hashJson(directionalManifest(raw.manifest)),
    frameHash: frame ? sha256(frame) : null,
    frameFile,
    snapshot: directionalSnapshot(raw.snapshot),
    manifest: directionalManifest(raw.manifest),
    visualFacing: raw.visualFacing,
    label: raw.label,
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
    manifest: capture.manifest,
    visualFacing: capture.visualFacing,
    label: capture.label,
  };
}

function publicAttack(attack) {
  return {
    id: attack.id,
    ownerId: attack.ownerId,
    kind: attack.kind,
    impactTick: attack.impactTick,
    origin: attack.origin,
    direction: attack.direction,
    range: attack.range,
    damage: attack.damage,
  };
}

function publicProduced(entry) {
  return {
    id: entry.id,
    type: entry.type,
    ownerId: entry.ownerId,
    kind: entry.kind,
    position: entry.position,
    velocity: entry.velocity,
  };
}

async function writeContactSheet(directory, captures) {
  const selected = captures.filter(({ frame }) => frame);
  const cellWidth = 240;
  const cellHeight = 150;
  const columns = 4;
  const rows = Math.ceil(selected.length / columns);
  const layers = [];
  for (const [index, capture] of selected.entries()) {
    layers.push({
      input: await sharp(capture.frame)
        .resize(cellWidth, cellHeight, { fit: "fill" })
        .png()
        .toBuffer(),
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    });
  }
  await sharp({
    create: {
      width: columns * cellWidth,
      height: Math.max(1, rows) * cellHeight,
      channels: 4,
      background: "#120f16",
    },
  })
    .composite(layers)
    .png()
    .toFile(path.join(directory, "contact-sheet.png"));
  await writeJson(
    path.join(directory, "contact-sheet-order.json"),
    selected.map(({ label, frameFile }) => ({ label, frameFile })),
  );
}

async function normalizeProfile(raw, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(path.join(directory, "frames"), { recursive: true });
  const normalizedCaptures = [];
  const lookup = new Map();
  const rawTimeline = raw.runs.flatMap((run) =>
    run.directions.flatMap(({ movement, action, ability }) => [
      movement.before,
      movement.after,
      movement.turn,
      action.before,
      action.after,
      action.impact,
      action.recovery,
      ability.before,
      ability.after,
      ability.impact,
      ability.recovery,
    ]),
  );
  for (const [index, current] of rawTimeline.entries()) {
    const normalized = normalizeCapture(current, directory, index);
    if (normalized.frameFile)
      await fs.writeFile(
        path.join(directory, normalized.frameFile),
        normalized.frame,
      );
    normalizedCaptures.push(normalized);
    lookup.set(current.label, normalized);
  }
  const runs = raw.runs.map((run) => ({
    profileId,
    actorId: run.actorId,
    scenarioId: run.scenarioId,
    directions: run.directions.map((direction) => ({
      directionId: direction.directionId,
      turnDirectionId: direction.turnDirectionId,
      movement: {
        before: publicCapture(lookup.get(direction.movement.before.label)),
        after: publicCapture(lookup.get(direction.movement.after.label)),
        turn: publicCapture(lookup.get(direction.movement.turn.label)),
      },
      action: {
        kind: direction.action.kind,
        input: direction.action.input,
        before: publicCapture(lookup.get(direction.action.before.label)),
        after: publicCapture(lookup.get(direction.action.after.label)),
        impact: publicCapture(lookup.get(direction.action.impact.label)),
        recovery: publicCapture(lookup.get(direction.action.recovery.label)),
        pendingAttack: publicAttack(direction.action.pendingAttack),
        produced: direction.action.produced.map(publicProduced),
      },
      ability: {
        kind: direction.ability.kind,
        input: direction.ability.input,
        before: publicCapture(lookup.get(direction.ability.before.label)),
        after: publicCapture(lookup.get(direction.ability.after.label)),
        impact: publicCapture(lookup.get(direction.ability.impact.label)),
        recovery: publicCapture(lookup.get(direction.ability.recovery.label)),
        pendingAttack: publicAttack(direction.ability.pendingAttack),
        produced: direction.ability.produced.map(publicProduced),
      },
    })),
  }));
  const timeline = normalizedCaptures.map(publicCapture);
  await writeContactSheet(directory, normalizedCaptures);
  await writeJson(path.join(directory, "states.json"), {
    schemaVersion: 1,
    profileId,
    runs,
    timeline,
  });
  return {
    profileId,
    runs,
    timeline,
    artifacts: {
      contactSheet: path.relative(
        OUTPUT,
        path.join(directory, "contact-sheet.png"),
      ),
      contactSheetOrder: path.relative(
        OUTPUT,
        path.join(directory, "contact-sheet-order.json"),
      ),
    },
  };
}

function negativeControls(evidence) {
  const controls = [
    {
      id: "opposite-bank-selected",
      expectedSignal: "sprite-bank-mismatch",
      mutate(value) {
        const direction = value.profiles[0].runs[0].directions.find(
          ({ directionId }) => directionId === "move-east",
        );
        direction.movement.after.manifest.drawCalls[0].spriteId =
          "hero:vanguard:south";
      },
    },
    {
      id: "east-reflection-missing",
      expectedSignal: "east-reflection-missing",
      mutate(value) {
        const direction = value.profiles[0].runs[0].directions.find(
          ({ directionId }) => directionId === "move-east",
        );
        direction.movement.after.manifest.drawCalls[0].flipX = false;
      },
    },
    {
      id: "stale-bank-after-turn",
      expectedSignal: "stale-facing-bank",
      mutate(value) {
        const direction = value.profiles[0].runs[0].directions.find(
          ({ directionId }) => directionId === "move-east",
        );
        direction.movement.turn.manifest.drawCalls[0].facingBucket = "east";
        direction.movement.turn.manifest.drawCalls[0].spriteId =
          "hero:vanguard";
        direction.movement.turn.manifest.drawCalls[0].flipX = false;
      },
    },
    {
      id: "unmirrored-attack-origin",
      expectedSignal: "attack-origin-not-mirrored",
      mutate(value) {
        value.profiles[0].runs[0].directions[0].action.pendingAttack.origin.x += 1;
      },
    },
    {
      id: "target-aim-points-to-wrong-quadrant",
      expectedSignal: "target-aim-not-mirrored",
      mutate(value) {
        const direction = value.profiles[0].runs[0].directions.find(
          ({ directionId }) => directionId === "move-north",
        );
        direction.action.input.aim.x += 2_048;
      },
    },
    {
      id: "ability-recovery-stale-bank",
      expectedSignal: "ability-recovery-mismatch",
      mutate(value) {
        const direction = value.profiles[0].runs[0].directions.find(
          ({ directionId }) => directionId === "move-east",
        );
        direction.ability.recovery.manifest.drawCalls[0].facingBucket = "west";
        direction.ability.recovery.manifest.drawCalls[0].spriteId =
          "hero:vanguard";
        direction.ability.recovery.manifest.drawCalls[0].flipX = false;
      },
    },
    {
      id: "horizontal-raster-opposite",
      expectedSignal: "raster-facing-mismatch",
      mutate(value) {
        const run = value.profiles[0].runs.find(
          ({ actorId }) => actorId === "ranger",
        );
        const direction = run.directions.find(
          ({ directionId }) => directionId === "move-east",
        );
        direction.movement.after.visualFacing.actualPixelHash = "opposite";
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateDirectionalBankEvidence(mutated);
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
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    colorScheme: "dark",
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
  });
  const page = await context.newPage();
  try {
    await preparePage(page, baseURL);
    const runs = [];
    for (const actorId of DIRECTIONAL_BANK_ACTOR_IDS)
      runs.push(await runActor(page, actorId));
    return { profileId, runs };
  } finally {
    await context.close();
  }
}

async function main() {
  const registry = JSON.parse(
    await fs.readFile("quality/action-review.v1.json", "utf8"),
  );
  const capturedRuntime = await runtimeFingerprint(
    process.cwd(),
    registry.sourceRoots,
  );
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
    const profiles = [];
    for (const profileId of profileIds) {
      const raw = await runProfile(
        browser,
        profileId,
        PROFILES[profileId],
        started.baseURL,
      );
      profiles.push(await normalizeProfile(raw, profileId));
    }
    const evidence = {
      requiredProfiles: profileIds,
      requiredActorIds: [...DIRECTIONAL_BANK_ACTOR_IDS],
      requiredDirectionIds: [...DIRECTIONAL_BANK_DIRECTION_IDS],
      profiles,
    };
    const comparison = evaluateDirectionalBankEvidence(evidence);
    const controls = negativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      runtimeFingerprint: capturedRuntime,
      checkId: "PRES-FACING-015",
      recipeId: "recipe:pres-facing-015",
      evaluator: "directional-bank-selection-v1",
      scenarioIds: ["fixed-camera-open-floor"],
      actualScenarioIds: DIRECTIONAL_BANK_ACTOR_IDS.map(
        (actorId) => `fixed-camera-open-floor-${actorId}`,
      ),
      actorIds: [...DIRECTIONAL_BANK_ACTOR_IDS],
      profileIds,
      directionIds: [...DIRECTIONAL_BANK_DIRECTION_IDS],
      actionKinds: ["primary", "ability"],
      capturePolicy: {
        semanticCapturesPerDirection: 11,
        retainedPngCapturesPerDirection: 8,
        retainedPngStages: [
          "movement-after",
          "movement-turn",
          "primary-after",
          "primary-impact",
          "primary-recovery",
          "ability-after",
          "ability-impact",
          "ability-recovery",
        ],
      },
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:directional-bank",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "evidence.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "directional-bank-selection-v1",
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
        `PRES-FACING-015 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-FACING-015 PASS: ${profileIds.length} profiles, ${DIRECTIONAL_BANK_ACTOR_IDS.length} actors, four directions, target-directed primary/ability recovery, and seven negative controls detected`,
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
