import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  COLLISION_GESTURE_IDS,
  COLLISION_SCENARIO_IDS,
  evaluateCollisionEvidence,
  runCollisionNegativeControls,
} from "./lib/collision-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/collision/pres-collide-008");
const LOGICAL_VIEWPORT = { width: 960, height: 540 };
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

const GENERATED_SCENARIO = {
  schemaVersion: 1,
  id: "scenery-contact",
  seed: "cinder-041",
  classId: "vanguard",
  map: { mode: "generated" },
  monsters: [],
  settings: { ai: false, autoPickup: false, cameraFollow: false },
};

const EMBERCROSS_ROWS = Array.from({ length: 30 }, (_, y) => {
  const cells = Array.from({ length: 32 }, (_, x) =>
    x === 0 || y === 0 || x === 31 || y === 29 ? "#" : ".",
  );
  if (y === 29) for (let x = 14; x <= 16; x += 1) cells[x] = ".";
  if (y === 26) cells[15] = "P";
  if (y === 28) cells[15] = "E";
  return cells.join("");
});

const EMBERCROSS_SCENARIO = {
  schemaVersion: 1,
  id: "embercross-solid-objects",
  seed: "embercross-collision-01",
  classId: "vanguard",
  map: { mode: "explicit", rows: EMBERCROSS_ROWS },
  monsters: [],
  settings: { ai: false, autoPickup: false, cameraFollow: false },
};

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Collision evidence capture must contain a PNG data URL");
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
        `Collision evidence server exited with code ${server.exitCode}`,
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
  throw new Error(`Collision evidence server did not start at ${baseURL}`);
}

function slug(value) {
  return String(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function capture(page, id) {
  return page.evaluate((captureId) => {
    const bridge = window.__GAME_TEST__;
    if (!bridge) throw new Error("Game test bridge is unavailable");
    bridge.render({ interpolationAlpha: 1 });
    const snapshot = bridge.snapshot();
    const manifest = bridge.renderManifest();
    return {
      id: captureId,
      tick: Number(snapshot.tick),
      stateTick: Number(snapshot.tick),
      manifestTick: Number(manifest.tick),
      snapshot,
      manifest,
      stateHash: bridge.stateHash(),
      frame: bridge.captureFrame(),
    };
  }, id);
}

async function inventoryScenario(page, scenario, scenarioId) {
  const sceneIds = await page.evaluate((value) => {
    const bridge = window.__GAME_TEST__;
    bridge.loadScenario(value);
    bridge.render({ interpolationAlpha: 1 });
    const sceneIds = bridge
      .renderManifest()
      .sceneSprites.filter(
        (scene) =>
          scene.layer !== "terrain" && scene.collision?.mode === "solid",
      )
      .map(({ objectId }) => objectId);
    const state = bridge.snapshot();
    const exit = state.map.exit;
    const position = {
      x: (exit.x + 0.5) * 1024,
      y: (exit.y + 0.5) * 1024,
    };
    state.player.position = position;
    state.player.previousPosition = { ...position };
    state.player.velocity = { x: 0, y: 0 };
    state.monsters = [];
    state.projectiles = [];
    state.effects = [];
    state.events = [];
    state.eventLog = [];
    bridge.loadState(state);
    return sceneIds;
  }, scenario);
  const entries = [];
  for (const objectId of sceneIds) {
    entries.push(
      await page.evaluate((targetId) => {
        const bridge = window.__GAME_TEST__;
        const before = bridge
          .renderManifest()
          .sceneSprites.find(({ objectId }) => objectId === targetId);
        if (!before?.collision)
          throw new Error(`Missing collision ${targetId}`);
        const center = before.collision.worldCenter;
        bridge.setCamera(
          {
            x: (center.x / 1024) * 48,
            y: (center.y / 1024) * 48,
            zoom: 1,
          },
          "fixed",
        );
        bridge.render({ interpolationAlpha: 1 });
        const manifest = bridge.renderManifest();
        const scene = manifest.sceneSprites.find(
          ({ objectId }) => objectId === targetId,
        );
        if (!scene) throw new Error(`Missing presented scene ${targetId}`);
        const mask = bridge.capturePaintMask(`scene:${targetId}`);
        return {
          scene,
          camera: manifest.camera,
          mask,
        };
      }, objectId),
    );
  }
  return { scenarioId, entries };
}

async function setupContact(page, scenario, targetId) {
  return page.evaluate(
    ({ value, objectId }) => {
      const bridge = window.__GAME_TEST__;
      const overlaps = (point, radius, footprint) => {
        const horizontal = footprint.halfWidth + radius;
        const vertical = footprint.halfHeight + radius;
        const x = (point.x - footprint.worldCenter.x) / horizontal;
        const y = (point.y - footprint.worldCenter.y) / vertical;
        return x * x + y * y < 1;
      };
      const makeCandidate = (side, footprint, radius, moveSpeed) => {
        const gap = radius + 32;
        const direction = {
          north: { x: 0, y: 1 },
          east: { x: -1, y: 0 },
          south: { x: 0, y: -1 },
          west: { x: 1, y: 0 },
        }[side];
        const tangent = { north: "d", east: "s", south: "d", west: "s" }[side];
        const from = {
          x:
            footprint.worldCenter.x +
            (side === "east"
              ? gap + footprint.halfWidth
              : side === "west"
                ? -(gap + footprint.halfWidth)
                : 0),
          y:
            footprint.worldCenter.y +
            (side === "south"
              ? gap + footprint.halfHeight
              : side === "north"
                ? -(gap + footprint.halfHeight)
                : 0),
        };
        return {
          side,
          from,
          attemptedPosition: {
            x: from.x + direction.x * moveSpeed,
            y: from.y + direction.y * moveSpeed,
          },
          direction,
          tangent,
          facing: { x: direction.x * 1024, y: direction.y * 1024 },
        };
      };
      bridge.loadScenario(value);
      bridge.render({ interpolationAlpha: 1 });
      const manifest = bridge.renderManifest();
      const target = manifest.sceneSprites.find(
        ({ objectId: candidate }) => candidate === objectId,
      );
      if (!target?.collision) throw new Error(`No solid target ${objectId}`);
      const base = bridge.snapshot();
      const solids = manifest.sceneSprites
        .filter((scene) => scene.collision?.mode === "solid")
        .map((scene) => scene.collision);
      const sides = ["south", "north", "east", "west"];
      const candidate = sides
        .map((side) =>
          makeCandidate(
            side,
            target.collision,
            base.player.radius,
            base.player.moveSpeed,
          ),
        )
        .find((current) => {
          const tile = {
            x: Math.floor(current.from.x / 1024),
            y: Math.floor(current.from.y / 1024),
          };
          const floor =
            tile.x >= 0 &&
            tile.y >= 0 &&
            tile.x < base.map.width &&
            tile.y < base.map.height &&
            base.map.tiles[tile.y * base.map.width + tile.x] === 0;
          return (
            floor &&
            !solids.some((solid) =>
              overlaps(current.from, base.player.radius, solid),
            ) &&
            overlaps(
              current.attemptedPosition,
              base.player.radius,
              target.collision,
            )
          );
        });
      if (!candidate)
        throw new Error(`No floor-backed contact side for ${objectId}`);
      const state = bridge.snapshot();
      state.player.position = { ...candidate.from };
      state.player.previousPosition = { ...candidate.from };
      state.player.velocity = { x: 0, y: 0 };
      state.player.facing = { ...candidate.facing };
      state.monsters = [];
      state.projectiles = [];
      state.effects = [];
      state.events = [];
      state.eventLog = [];
      bridge.loadState(state);
      const center = target.collision.worldCenter;
      const camera = {
        x: (center.x / 1024) * 48,
        y: (center.y / 1024) * 48,
        zoom: 1,
      };
      bridge.setCamera(camera, "fixed");
      return {
        objectId,
        collision: target.collision,
        radius: base.player.radius,
        moveSpeed: base.player.moveSpeed,
        ...candidate,
        camera,
      };
    },
    { value: scenario, objectId: targetId },
  );
}

async function runContact(page, scenario, targetId, gestureId, label) {
  const setup = await setupContact(page, scenario, targetId);
  const initial = await capture(page, `${label}-initial`);
  await page.keyboard.down(
    setup.direction.x > 0
      ? "d"
      : setup.direction.x < 0
        ? "a"
        : setup.direction.y > 0
          ? "s"
          : "w",
  );
  const movement = await page.evaluate(
    ({ targetId, direction, moveSpeed }) => {
      const bridge = window.__GAME_TEST__;
      const timeline = [];
      let blockedPosition = null;
      let blockedEvent = null;
      for (let index = 0; index < 60; index += 1) {
        bridge.step(1, { render: true, useBrowserInput: true });
        const snapshot = bridge.snapshot();
        const manifest = bridge.renderManifest();
        const event = [...snapshot.events]
          .reverse()
          .find(
            ({ type, targetId: eventTarget }) =>
              type === "movement_blocked" && eventTarget === targetId,
          );
        if (event) {
          blockedPosition = { ...snapshot.player.position };
          blockedEvent = event;
        }
        timeline.push({
          tick: Number(snapshot.tick),
          stateTick: Number(snapshot.tick),
          manifestTick: Number(manifest.tick),
          playerPosition: { ...snapshot.player.position },
          playerCall: (() => {
            const call = manifest.drawCalls.find(
              ({ entityId }) => entityId === "player",
            );
            return call
              ? {
                  entityId: call.entityId,
                  type: call.type,
                  geometryId: call.geometryId,
                  worldAnchor: call.worldAnchor,
                  screenAnchor: call.screenAnchor,
                  destinationRect: call.destinationRect,
                  visible: call.visible,
                  opacity: call.opacity,
                }
              : null;
          })(),
          targetScene: (() => {
            const scene = manifest.sceneSprites.find(
              ({ objectId }) => objectId === targetId,
            );
            return scene
              ? {
                  objectId: scene.objectId,
                  spriteId: scene.spriteId,
                  kind: scene.kind,
                  tile: scene.tile,
                  worldAnchor: scene.worldAnchor,
                  screenAnchor: scene.screenAnchor,
                  destinationRect: scene.destinationRect,
                  layer: scene.layer,
                  visible: scene.visible,
                  opacity: scene.opacity,
                  collision: scene.collision,
                  collisionParts: scene.collisionParts,
                }
              : null;
          })(),
          blocked: Boolean(event),
        });
      }
      const attemptedPosition = blockedPosition
        ? {
            x: blockedPosition.x + direction.x * moveSpeed,
            y: blockedPosition.y + direction.y * moveSpeed,
          }
        : null;
      return { timeline, blockedPosition, blockedEvent, attemptedPosition };
    },
    {
      targetId,
      direction: setup.direction,
      moveSpeed: setup.moveSpeed,
    },
  );
  await page.keyboard.up(
    setup.direction.x > 0
      ? "d"
      : setup.direction.x < 0
        ? "a"
        : setup.direction.y > 0
          ? "s"
          : "w",
  );
  const blocked = await capture(page, `${label}-blocked`);
  const blockedFeedback = await page.evaluate(
    ({ targetId }) => {
      const bridge = window.__GAME_TEST__;
      const snapshot = bridge.snapshot();
      const manifest = bridge.renderManifest();
      const event = [...snapshot.eventLog]
        .reverse()
        .find(
          ({ type, targetId: eventTarget }) =>
            type === "movement_blocked" && eventTarget === targetId,
        );
      const impact = manifest.drawCalls.find(
        ({ type, geometryId }) =>
          type === "effect" && geometryId === "effect:impact",
      );
      return {
        event,
        impactVisible: impact?.visible === true,
        impactId: impact?.entityId ?? null,
        log:
          document
            .querySelector("#log .sprite-log")
            ?.getAttribute("aria-label") ?? "",
      };
    },
    { targetId },
  );
  await page.keyboard.down(setup.tangent);
  await page.evaluate(() => {
    const bridge = window.__GAME_TEST__;
    bridge.step(10, { render: true, useBrowserInput: true });
  });
  await page.keyboard.up(setup.tangent);
  const slide = await capture(page, `${label}-slide`);
  const slidePosition = slide.snapshot.player.position;
  return {
    objectId: targetId,
    objectName: blockedFeedback.event?.detail ?? targetId,
    gestureId,
    side: setup.side,
    radius: setup.radius,
    collision: setup.collision,
    approach: {
      from: setup.from,
      attemptedPosition: movement.attemptedPosition ?? setup.attemptedPosition,
      input: setup.direction,
      timeline: movement.timeline,
    },
    blockedPosition:
      movement.blockedPosition ?? blocked.snapshot.player.position,
    feedback: blockedFeedback,
    slide: {
      from: movement.blockedPosition ?? blocked.snapshot.player.position,
      to: slidePosition,
      tick: slide.tick,
    },
    captures: [initial, blocked, slide],
  };
}

async function runProjectile(page, scenario, targetId, hostile, label) {
  const setup = await page.evaluate(
    ({ value, objectId, isHostile }) => {
      const bridge = window.__GAME_TEST__;
      const segmentHitTime = (from, to, footprint, radius) => {
        const horizontal = footprint.halfWidth + radius;
        const vertical = footprint.halfHeight + radius;
        const startX = (from.x - footprint.worldCenter.x) / horizontal;
        const startY = (from.y - footprint.worldCenter.y) / vertical;
        const deltaX = (to.x - from.x) / horizontal;
        const deltaY = (to.y - from.y) / vertical;
        const c = startX * startX + startY * startY - 1;
        if (c <= 0) return 0;
        const a = deltaX * deltaX + deltaY * deltaY;
        if (a < Number.EPSILON) return null;
        const b = 2 * (startX * deltaX + startY * deltaY);
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return null;
        const enter = (-b - Math.sqrt(discriminant)) / (2 * a);
        return enter >= 0 && enter <= 1 ? enter : null;
      };
      bridge.loadScenario(value);
      bridge.render({ interpolationAlpha: 1 });
      const initialManifest = bridge.renderManifest();
      const target = initialManifest.sceneSprites.find(
        ({ objectId: candidate }) => candidate === objectId,
      );
      if (!target?.collision)
        throw new Error(`No projectile target ${objectId}`);
      const state = bridge.snapshot();
      const radius = 120;
      const candidates = [
        {
          from: {
            x:
              target.collision.worldCenter.x -
              target.collision.halfWidth -
              radius -
              480,
            y: target.collision.worldCenter.y,
          },
          to: {
            x:
              target.collision.worldCenter.x +
              target.collision.halfWidth +
              radius +
              480,
            y: target.collision.worldCenter.y,
          },
        },
        {
          from: {
            x: target.collision.worldCenter.x,
            y:
              target.collision.worldCenter.y -
              target.collision.halfHeight -
              radius -
              480,
          },
          to: {
            x: target.collision.worldCenter.x,
            y:
              target.collision.worldCenter.y +
              target.collision.halfHeight +
              radius +
              480,
          },
        },
      ];
      const solidScenes = initialManifest.sceneSprites.filter(
        (scene) => scene.collision?.mode === "solid",
      );
      const floorAt = (point) => {
        const x = Math.floor(point.x / 1024);
        const y = Math.floor(point.y / 1024);
        return (
          x >= 0 &&
          y >= 0 &&
          x < state.map.width &&
          y < state.map.height &&
          state.map.tiles[y * state.map.width + x] === 0
        );
      };
      const crossing = candidates
        .map((candidate) => ({
          ...candidate,
          targetHit: segmentHitTime(
            candidate.from,
            candidate.to,
            target.collision,
            radius,
          ),
        }))
        .filter(
          (candidate) =>
            candidate.targetHit !== null &&
            floorAt(candidate.from) &&
            floorAt(candidate.to) &&
            !solidScenes.some((scene) => {
              if (scene.objectId === objectId || !scene.collision) return false;
              const hit = segmentHitTime(
                candidate.from,
                candidate.to,
                scene.collision,
                radius,
              );
              return hit !== null && hit < candidate.targetHit;
            }),
        )[0];
      if (!crossing)
        throw new Error(`No floor-backed projectile axis for ${objectId}`);
      const velocity = {
        x: crossing.to.x - crossing.from.x,
        y: crossing.to.y - crossing.from.y,
      };
      state.monsters = [];
      state.effects = [];
      state.projectiles = [
        {
          id: `projectile:collision:${isHostile ? "hostile" : "friendly"}`,
          owner: isHostile ? "monster:offscreen" : "player",
          hostile: isHostile,
          position: { ...crossing.from },
          previousPosition: { ...crossing.from },
          velocity,
          radius,
          damage: 99,
          expiresAtTick: 100,
          color: isHostile ? "#d36de7" : "#f0a24b",
          pierce: 4,
          spawnedAtTick: 0,
          hitTargets: [],
        },
      ];
      state.player.health = state.player.maxHealth;
      state.player.previousPosition = { ...state.player.position };
      bridge.loadState(state);
      const center = target.collision.worldCenter;
      const camera = {
        x: (center.x / 1024) * 48,
        y: (center.y / 1024) * 48,
        zoom: 1,
      };
      bridge.setCamera(camera, "fixed");
      return {
        objectId,
        projectileId: state.projectiles[0].id,
        from: crossing.from,
        to: crossing.to,
        radius,
        camera,
        targetHealthBefore: state.player.health,
      };
    },
    { value: scenario, objectId: targetId, isHostile: hostile },
  );
  const initial = await capture(page, `${label}-initial`);
  await page.evaluate(() => {
    const bridge = window.__GAME_TEST__;
    bridge.step(2, { render: true });
  });
  const impact = await capture(page, `${label}-impact`);
  const result = await page.evaluate(
    ({ projectileId, from, to, targetHealthBefore }) => {
      const bridge = window.__GAME_TEST__;
      const snapshot = bridge.snapshot();
      const manifest = bridge.renderManifest();
      const impactEffect = snapshot.effects.find(
        ({ kind }) => kind === "impact",
      );
      const impactCall = manifest.drawCalls.find(
        ({ entityId }) => entityId === impactEffect?.id,
      );
      const delta = { x: to.x - from.x, y: to.y - from.y };
      const lengthSquared = delta.x * delta.x + delta.y * delta.y;
      const t = impactEffect
        ? ((impactEffect.position.x - from.x) * delta.x +
            (impactEffect.position.y - from.y) * delta.y) /
          lengthSquared
        : null;
      return {
        projectileIdsAfter: snapshot.projectiles.map(({ id }) => id),
        removed: !snapshot.projectiles.some(({ id }) => id === projectileId),
        impact: impactEffect
          ? {
              position: impactEffect.position,
              t,
              visible: impactCall?.visible === true,
            }
          : null,
        targetHealthBefore,
        targetHealthAfter: snapshot.player.health,
        damageThroughSolid: snapshot.player.health < targetHealthBefore,
      };
    },
    {
      projectileId: setup.projectileId,
      from: setup.from,
      to: setup.to,
      targetHealthBefore: setup.targetHealthBefore,
    },
  );
  return {
    ...setup,
    endpointsFloorBacked: true,
    removed: result.removed,
    projectileIdsAfter: result.projectileIdsAfter,
    impact: result.impact,
    targetHealthBefore: result.targetHealthBefore,
    targetHealthAfter: result.targetHealthAfter,
    damageThroughSolid: result.damageThroughSolid,
    captures: [initial, impact],
  };
}

async function persistCaptures(directory, captures) {
  const persisted = [];
  for (const [index, captureValue] of captures.entries()) {
    const frameFile = `frame-${String(index).padStart(4, "0")}-${slug(captureValue.id)}.png`;
    const frame = dataUrlBuffer(captureValue.frame);
    await fs.writeFile(path.join(directory, frameFile), frame);
    persisted.push({
      ...captureValue,
      frameFile,
      frameHash: sha256(frame),
      manifestHash: hashJson(captureValue.manifest),
    });
  }
  return persisted;
}

async function writeContactSheet(directory, captures) {
  if (captures.length === 0) return;
  const cellWidth = 320;
  const cellHeight = 180;
  const columns = 3;
  const rows = Math.ceil(captures.length / columns);
  const layers = await Promise.all(
    captures.map(async (captureValue, index) => ({
      input: await sharp(path.join(directory, captureValue.frameFile))
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

function inventoryEvidence(inventory, directoryName) {
  return inventory.entries.map(({ scene, camera, mask }, index) => ({
    objectId: scene.objectId,
    objectName: scene.spriteId,
    visible: scene.visible,
    camera,
    collision: scene.collision,
    collisionParts: scene.collisionParts,
    support: {
      source: "alpha-mask",
      alphaPixels: mask.alphaPixels,
      bounds: mask.inkBounds,
      centroid: mask.centroid,
      pixelHash: mask.pixelHash,
      maskInternalClipping: mask.maskInternalClipping,
      renderVisible: mask.renderVisible,
      maskFile: `${directoryName}/mask-${String(index).padStart(4, "0")}-${slug(scene.objectId)}.png`,
    },
    _maskImage: mask.image,
  }));
}

async function persistInventoryMasks(directory, entries) {
  for (const entry of entries) {
    const file = path.join(directory, entry.support.maskFile.split("/").at(-1));
    await fs.writeFile(file, dataUrlBuffer(entry._maskImage));
    delete entry._maskImage;
  }
}

function publicCapture(captureValue) {
  return {
    id: captureValue.id,
    tick: captureValue.tick,
    stateTick: captureValue.stateTick,
    manifestTick: captureValue.manifestTick,
    stateHash: captureValue.stateHash,
    manifestHash: captureValue.manifestHash,
    frameHash: captureValue.frameHash,
    frameFile: captureValue.frameFile,
    snapshot: captureValue.snapshot,
    manifest: captureValue.manifest,
  };
}

async function recordProfile(page, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });

  const generatedInventory = await inventoryScenario(
    page,
    GENERATED_SCENARIO,
    "scenery-contact",
  );
  const cityInventory = await inventoryScenario(
    page,
    EMBERCROSS_SCENARIO,
    "embercross-solid-objects",
  );
  const generatedSolids = inventoryEvidence(generatedInventory, profileId);
  const citySolids = inventoryEvidence(cityInventory, profileId);
  await persistInventoryMasks(directory, [...generatedSolids, ...citySolids]);

  const generatedTargetIds = new Set(
    generatedSolids.map(({ objectId }) => objectId),
  );
  const generatedContacts = [];
  for (const [targetId, gestureId, label] of [
    ["structure:0:forge", "walk-into-solid", "generated-walk"],
    ["prop:0:barricade-v2", "tap-route-into-solid", "generated-route"],
  ]) {
    if (!generatedTargetIds.has(targetId)) continue;
    generatedContacts.push(
      await runContact(page, GENERATED_SCENARIO, targetId, gestureId, label),
    );
  }
  if (generatedContacts.length === 0)
    throw new Error("Generated scenery produced no contact target");

  const cityTarget =
    citySolids.find(({ objectId }) => objectId.includes("market-crates")) ??
    citySolids[0];
  if (!cityTarget) throw new Error("Embercross produced no solid target");
  const cityContact = await runContact(
    page,
    EMBERCROSS_SCENARIO,
    cityTarget.objectId,
    "tap-route-into-solid",
    "city-route",
  );
  const projectiles = [
    await runProjectile(
      page,
      GENERATED_SCENARIO,
      "structure:0:forge",
      false,
      "projectile-friendly",
    ),
    await runProjectile(
      page,
      GENERATED_SCENARIO,
      "structure:0:forge",
      true,
      "projectile-hostile",
    ),
  ];

  const rawCaptures = [
    ...generatedContacts.flatMap(({ captures }) => captures),
    ...[cityContact].flatMap(({ captures }) => captures),
    ...projectiles.flatMap(({ captures }) => captures),
  ];
  const captures = await persistCaptures(directory, rawCaptures);
  await writeContactSheet(directory, captures);
  const captureById = new Map(
    captures.map((captureValue) => [captureValue.id, captureValue]),
  );
  const resolveContact = (contact) => ({
    ...contact,
    captures: contact.captures.map(({ id }) =>
      publicCapture(captureById.get(id)),
    ),
  });
  const resolveProjectile = (projectile) => ({
    ...projectile,
    captures: projectile.captures.map(({ id }) =>
      publicCapture(captureById.get(id)),
    ),
  });
  const evidence = {
    schemaVersion: 1,
    checkId: "PRES-COLLIDE-008",
    recipeId: "recipe:pres-collide-008",
    evaluator: "visible-solid-contact-v1",
    profileId,
    scenarios: [
      {
        id: "scenery-contact",
        gestureIds: ["walk-into-solid", "tap-route-into-solid"],
        solids: generatedSolids,
        contacts: generatedContacts.map(resolveContact),
        projectiles: [],
      },
      {
        id: "projectile-scenery-contact",
        gestureIds: ["fire-through-solid"],
        solids: [],
        contacts: [],
        projectiles: projectiles.map(resolveProjectile),
      },
      {
        id: "embercross-solid-objects",
        gestureIds: ["tap-route-into-solid"],
        solids: citySolids,
        contacts: [resolveContact(cityContact)],
        projectiles: [],
      },
    ],
    captures: captures.map(publicCapture),
  };
  const comparison = evaluateCollisionEvidence(evidence);
  const controls = runCollisionNegativeControls(evidence);
  await Promise.all([
    writeJson(path.join(directory, "collision.json"), evidence),
    writeJson(path.join(directory, "comparison.json"), {
      schemaVersion: 1,
      evaluator: "visible-solid-contact-v1",
      comparison,
      negativeControls: controls,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      schemaVersion: 1,
      profileId,
      captures: captures.map(publicCapture),
      contacts: evidence.scenarios.flatMap(({ contacts: current }) =>
        current.map(({ objectId, approach }) => ({
          objectId,
          timeline: approach.timeline,
        })),
      ),
    }),
  ]);
  if (!comparison.pass || controls.some(({ status }) => status !== "DETECTED"))
    throw new Error(
      `PRES-COLLIDE-008 ${profileId} failed: ${[
        ...comparison.failures,
        ...controls
          .filter(({ status }) => status !== "DETECTED")
          .map(({ id }) => `${id}-not-detected`),
      ].join(", ")}`,
    );
  return { profileId, evidence, comparison, controls };
}

function aggregate(results) {
  const failures = [
    ...new Set(results.flatMap(({ comparison }) => comparison.failures)),
  ];
  const signals = [
    "solid-support-blocks",
    "blocked-object-visible",
    "swept-contact-holds",
  ].map((id) => ({
    id,
    pass: results.every(
      ({ comparison }) =>
        comparison.signals.find((signal) => signal.id === id)?.pass === true,
    ),
    detail: results.map(({ profileId, comparison }) => ({
      profileId,
      signal: comparison.signals.find((signal) => signal.id === id) ?? null,
    })),
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
  const port = Number(option("port", String(47_000 + (process.pid % 1_000))));
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
    const comparison = aggregate(results);
    const rootEvidence = {
      schemaVersion: 1,
      checkId: "PRES-COLLIDE-008",
      recipeId: "recipe:pres-collide-008",
      evaluator: "visible-solid-contact-v1",
      profiles: results.map(({ evidence }) => evidence),
    };
    const controls = runCollisionNegativeControls(rootEvidence).map(
      (control) => ({
        ...control,
        profileId: "all-profiles",
      }),
    );
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-COLLIDE-008",
      recipeId: "recipe:pres-collide-008",
      evaluator: "visible-solid-contact-v1",
      profileIds: Object.keys(PROFILES),
      scenarioIds: COLLISION_SCENARIO_IDS,
      gestureIds: COLLISION_GESTURE_IDS,
      source: sourceSnapshot(),
      viewport: LOGICAL_VIEWPORT,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: await browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:collision",
      coverage: results.map(({ profileId, evidence }) => ({
        profileId,
        scenarios: evidence.scenarios.map((scenario) => ({
          id: scenario.id,
          solidCount: scenario.solids.length,
          contactCount: scenario.contacts.length,
          projectileCount: scenario.projectiles.length,
          gestureIds: scenario.gestureIds,
        })),
        captureCount: evidence.captures.length,
      })),
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
      writeJson(path.join(OUTPUT, "collision.json"), rootEvidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "visible-solid-contact-v1",
        comparison,
        negativeControls: controls,
      }),
    ]);
    if (
      !comparison.pass ||
      controls.some(({ status }) => status !== "DETECTED")
    )
      throw new Error(
        `PRES-COLLIDE-008 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    console.log(
      `PRES-COLLIDE-008 PASS: ${results.length} profiles, ${results.reduce((count, result) => count + result.evidence.scenarios.reduce((total, scenario) => total + scenario.solids.length, 0), 0)} solid roles, four negative controls`,
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
