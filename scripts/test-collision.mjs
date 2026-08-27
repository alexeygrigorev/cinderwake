import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  COLLISION_TOPOLOGY_EXEMPTION,
  COLLISION_GESTURE_IDS,
  COLLISION_SCENARIO_IDS,
  evaluateCollisionEvidence,
  isMapBlockedBoundaryObjectId,
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
  "phone-landscape": {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

const CONTACT_SIDES = ["north", "east", "south", "west"];

// Keep lossless contact PNGs for a small visual review subset. Every solid
// role still receives the semantic contact journey below; retaining a frame
// triplet for all three DPR profiles would turn this bundle into gigabytes of
// duplicate raster data.
const GENERATED_CONTACT_FRAME_TARGET_IDS = [
  "prop:0:barricade-v2",
  "structure:0:forge",
  "structure:2:rubble",
  "prop:3:0:thorn-pillar",
  "structure:4:forge",
  "prop:5:1:ritual-totem",
  "structure:6:mausoleum",
];

const CITY_CONTACT_FRAME_TARGET_IDS = [
  "building:embercross:smithy",
  "building:embercross:market",
  "building:embercross:tavern",
  "building:embercross:infirmary",
  "gate:embercross:south",
];

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

async function capture(page, id, targetId) {
  return page.evaluate(
    ({ captureId, targetSceneId }) => {
      const bridge = window.__GAME_TEST__;
      if (!bridge) throw new Error("Game test bridge is unavailable");
      bridge.render({ interpolationAlpha: 1 });
      const snapshot = bridge.snapshot();
      const manifest = bridge.renderManifest();
      const compactManifest = {
        ...manifest,
        // The terrain layer contains thousands of deterministic tile entries and
        // is already represented by the full per-profile inventory. Contact
        // captures only need the target scenery entry plus actor/effect calls.
        sceneSprites: manifest.sceneSprites.filter(
          ({ objectId }) => objectId === targetSceneId,
        ),
        // Keep the target's scene paint and all dynamic paint entries. The
        // omitted terrain plan is deterministic inventory context, not contact
        // evidence, and repeating it for every tick makes the bundle enormous.
        paintQueue: manifest.paintQueue
          .filter(
            ({ kind, scene }) =>
              kind !== "scene" || scene?.objectId === targetSceneId,
          )
          .map((paint, zOrder) => ({ ...paint, zOrder })),
      };
      return {
        id: captureId,
        tick: Number(snapshot.tick),
        stateTick: Number(snapshot.tick),
        manifestTick: Number(manifest.tick),
        snapshot,
        manifest: compactManifest,
        stateHash: bridge.stateHash(),
        frame: bridge.captureFrame(),
      };
    },
    { captureId: id, targetSceneId: targetId },
  );
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

async function setupContact(page, scenario, targetId, sideId) {
  return page.evaluate(
    ({ value, objectId, side }) => {
      const bridge = window.__GAME_TEST__;
      const overlaps = (point, radius, footprint) => {
        const horizontal = footprint.halfWidth + radius;
        const vertical = footprint.halfHeight + radius;
        const x = (point.x - footprint.worldCenter.x) / horizontal;
        const y = (point.y - footprint.worldCenter.y) / vertical;
        return x * x + y * y < 1;
      };
      const makeCandidate = (
        currentSide,
        footprint,
        radius,
        moveSpeed,
        offset,
      ) => {
        const gap = radius + 32;
        const direction = {
          north: { x: 0, y: 1 },
          east: { x: -1, y: 0 },
          south: { x: 0, y: -1 },
          west: { x: 1, y: 0 },
        }[currentSide];
        const tangentVector = {
          north: { x: 1, y: 0 },
          east: { x: 0, y: 1 },
          south: { x: 1, y: 0 },
          west: { x: 0, y: 1 },
        }[currentSide];
        const tangent = {
          north: "d",
          east: "s",
          south: "d",
          west: "s",
        }[currentSide];
        const from = {
          x:
            footprint.worldCenter.x +
            (currentSide === "east"
              ? gap + footprint.halfWidth
              : currentSide === "west"
                ? -(gap + footprint.halfWidth)
                : 0) +
            tangentVector.x * offset,
          y:
            footprint.worldCenter.y +
            (currentSide === "south"
              ? gap + footprint.halfHeight
              : currentSide === "north"
                ? -(gap + footprint.halfHeight)
                : 0) +
            tangentVector.y * offset,
        };
        return {
          side: currentSide,
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
        .flatMap((scene) =>
          [scene.collision, ...(scene.collisionParts ?? [])]
            .filter(Boolean)
            .map((collision) => ({ objectId: scene.objectId, collision })),
        );
      const offsets = [
        0,
        ...Array.from(
          { length: Math.max(base.map.width, base.map.height) * 4 },
          (_, index) => 256 * (index + 1),
        ).flatMap((offset) => [offset, -offset]),
      ];
      const inMap = (point) => {
        const tile = {
          x: Math.floor(point.x / 1024),
          y: Math.floor(point.y / 1024),
        };
        return (
          tile.x >= 0 &&
          tile.y >= 0 &&
          tile.x < base.map.width &&
          tile.y < base.map.height &&
          base.map.tiles[tile.y * base.map.width + tile.x] === 0
        );
      };
      const walkablePoint = (point) =>
        [
          [-base.player.radius, -base.player.radius],
          [base.player.radius, -base.player.radius],
          [-base.player.radius, base.player.radius],
          [base.player.radius, base.player.radius],
        ].every(([x, y]) => inMap({ x: point.x + x, y: point.y + y }));
      const segmentHitTime = (from, to, footprint) => {
        const horizontal = footprint.halfWidth + base.player.radius;
        const vertical = footprint.halfHeight + base.player.radius;
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
      const pathClear = (candidate) => {
        const targetEntry = segmentHitTime(
          candidate.from,
          candidate.attemptedPosition,
          target.collision,
        );
        if (targetEntry === null || targetEntry <= 0) return false;
        for (let index = 0; index <= 20; index += 1) {
          const fraction = Math.min(
            (index / 20) * targetEntry,
            targetEntry - 0.001,
          );
          const point = {
            x:
              candidate.from.x +
              (candidate.attemptedPosition.x - candidate.from.x) * fraction,
            y:
              candidate.from.y +
              (candidate.attemptedPosition.y - candidate.from.y) * fraction,
          };
          if (
            !walkablePoint(point) ||
            solids.some(
              ({ objectId: candidateId, collision }) =>
                candidateId !== objectId &&
                overlaps(point, base.player.radius, collision),
            )
          )
            return false;
        }
        return true;
      };
      const candidates = offsets.map((offset) =>
        makeCandidate(
          side,
          target.collision,
          base.player.radius,
          base.player.moveSpeed,
          offset,
        ),
      );
      const candidate = candidates.find(
        (current) =>
          inMap(current.from) &&
          inMap(current.attemptedPosition) &&
          walkablePoint(current.from) &&
          overlaps(
            current.attemptedPosition,
            base.player.radius,
            target.collision,
          ) &&
          pathClear(current),
      );
      if (!candidate) {
        const hasFloorBackedCandidate = candidates.some(
          (current) => inMap(current.from) && inMap(current.attemptedPosition),
        );
        return {
          skipped: true,
          objectId,
          side,
          reason: hasFloorBackedCandidate
            ? "no-clear-floor-approach"
            : "outside-map-boundary",
        };
      }
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
        skipped: false,
        objectId,
        collision: target.collision,
        radius: base.player.radius,
        moveSpeed: base.player.moveSpeed,
        ...candidate,
        camera,
      };
    },
    { value: scenario, objectId: targetId, side: sideId },
  );
}

async function runContact(
  page,
  scenario,
  targetId,
  gestureId,
  label,
  side,
  persistCapture,
  retainFrames = true,
) {
  const setup = await setupContact(page, scenario, targetId, side);
  if (setup.skipped) return setup;
  const initial = retainFrames
    ? await persistCapture(await capture(page, `${label}-initial`, targetId))
    : null;
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
        if (event) break;
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
  if (!movement.blockedEvent)
    throw new Error(
      `Contact did not produce movement_blocked for ${targetId} from ${side}`,
    );
  const blocked = retainFrames
    ? await persistCapture(await capture(page, `${label}-blocked`, targetId))
    : null;
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
  const slide = retainFrames
    ? await persistCapture(await capture(page, `${label}-slide`, targetId))
    : null;
  const slidePosition =
    slide?.snapshot.player.position ??
    (await page.evaluate(
      () => window.__GAME_TEST__.snapshot().player.position,
    ));
  const slideTick =
    slide?.tick ??
    (await page.evaluate(() => window.__GAME_TEST__.snapshot().tick));
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
      tick: slideTick,
    },
    captures: [initial, blocked, slide].filter(Boolean),
  };
}

async function runProjectile(
  page,
  scenario,
  targetId,
  hostile,
  label,
  persistCapture,
) {
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
  const initial = await persistCapture(
    await capture(page, `${label}-initial`, targetId),
  );
  await page.evaluate(() => {
    const bridge = window.__GAME_TEST__;
    bridge.step(2, { render: true });
  });
  const impact = await persistCapture(
    await capture(page, `${label}-impact`, targetId),
  );
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

async function persistCaptures(directory, captures, startIndex = 0) {
  const persisted = [];
  for (const [index, captureValue] of captures.entries()) {
    const frameFile = `frame-${String(startIndex + index).padStart(4, "0")}-${slug(captureValue.id)}.png`;
    const frame = dataUrlBuffer(captureValue.frame);
    await fs.writeFile(path.join(directory, frameFile), frame);
    const withoutFrame = { ...captureValue };
    delete withoutFrame.frame;
    persisted.push({
      ...withoutFrame,
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

function selectContactSolids(solids, targetIds, label) {
  const available = new Set(solids.map(({ objectId }) => objectId));
  const missing = targetIds.filter((objectId) => !available.has(objectId));
  if (missing.length > 0)
    throw new Error(`${label} contact targets missing: ${missing.join(", ")}`);
  const selected = new Set(targetIds);
  return solids.filter(({ objectId }) => selected.has(objectId));
}

function withContactCoverage(solids, coverage) {
  return solids.map((solid) => ({
    ...solid,
    contactCoverage: coverage.get(solid.objectId) ?? {
      principalSides: CONTACT_SIDES,
      requiredSides: CONTACT_SIDES,
      skippedSides: {},
      selected: true,
      scope: "exhaustive-cardinal-matrix",
    },
  }));
}

async function recordSolidContacts(
  page,
  scenario,
  solids,
  gestureId,
  labelPrefix,
  persistCapture,
  frameTargetIds,
) {
  const contacts = [];
  const coverage = new Map();
  for (const solid of solids) {
    const requiredSides = [];
    const skippedSides = {};
    for (const side of CONTACT_SIDES) {
      const contact = await runContact(
        page,
        scenario,
        solid.objectId,
        gestureId,
        `${labelPrefix}-${slug(solid.objectId)}-${side}`,
        side,
        persistCapture,
        frameTargetIds.has(solid.objectId),
      );
      if (contact.skipped) skippedSides[side] = contact.reason;
      else {
        requiredSides.push(side);
        contacts.push(contact);
      }
    }
    const topologyExempt =
      requiredSides.length === 0 &&
      isMapBlockedBoundaryObjectId(solid.objectId);
    coverage.set(solid.objectId, {
      principalSides: CONTACT_SIDES,
      requiredSides,
      skippedSides,
      selected: !topologyExempt,
      scope: "exhaustive-cardinal-matrix",
      ...(topologyExempt ? { exemption: COLLISION_TOPOLOGY_EXEMPTION } : {}),
    });
  }
  return { contacts, coverage };
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
  const generatedContactFrameSolids = selectContactSolids(
    generatedSolids,
    GENERATED_CONTACT_FRAME_TARGET_IDS,
    "Generated scenery frame",
  );
  const cityContactFrameSolids = selectContactSolids(
    citySolids,
    CITY_CONTACT_FRAME_TARGET_IDS,
    "Embercross frame",
  );
  let captureIndex = 0;
  const captures = [];
  const persistCapture = async (captureValue) => {
    const [persisted] = await persistCaptures(
      directory,
      [captureValue],
      captureIndex,
    );
    captureIndex += 1;
    captures.push(persisted);
    return persisted;
  };

  const generatedContactResult = await recordSolidContacts(
    page,
    GENERATED_SCENARIO,
    generatedSolids,
    "walk-into-solid",
    "generated-contact",
    persistCapture,
    new Set(generatedContactFrameSolids.map(({ objectId }) => objectId)),
  );
  if (generatedContactResult.contacts.length === 0)
    throw new Error("Generated scenery produced no contact target");
  const generatedContacts = generatedContactResult.contacts;
  const generatedSolidsWithCoverage = withContactCoverage(
    generatedSolids,
    generatedContactResult.coverage,
  );

  const cityContactResult = await recordSolidContacts(
    page,
    EMBERCROSS_SCENARIO,
    citySolids,
    "tap-route-into-solid",
    "city-contact",
    persistCapture,
    new Set(cityContactFrameSolids.map(({ objectId }) => objectId)),
  );
  if (cityContactResult.contacts.length === 0)
    throw new Error("Embercross produced no contact target");
  const cityContacts = cityContactResult.contacts;
  const citySolidsWithCoverage = withContactCoverage(
    citySolids,
    cityContactResult.coverage,
  );
  const projectiles = [
    await runProjectile(
      page,
      GENERATED_SCENARIO,
      "structure:0:forge",
      false,
      "projectile-friendly",
      persistCapture,
    ),
    await runProjectile(
      page,
      GENERATED_SCENARIO,
      "structure:0:forge",
      true,
      "projectile-hostile",
      persistCapture,
    ),
  ];

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
        solids: generatedSolidsWithCoverage,
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
        solids: citySolidsWithCoverage,
        contacts: cityContacts.map(resolveContact),
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
    "principal-sides-covered",
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
          principalSideCount: scenario.solids.reduce(
            (count, solid) =>
              count + (solid.contactCoverage?.requiredSides?.length ?? 0),
            0,
          ),
          skippedSideCount: scenario.solids.reduce(
            (count, solid) =>
              count +
              Object.keys(solid.contactCoverage?.skippedSides ?? {}).length,
            0,
          ),
          topologyExemptionCount: scenario.solids.filter(
            (solid) =>
              solid.contactCoverage?.exemption === COLLISION_TOPOLOGY_EXEMPTION,
          ).length,
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
    const solidCount = results.reduce(
      (count, result) =>
        count +
        result.evidence.scenarios.reduce(
          (total, scenario) => total + scenario.solids.length,
          0,
        ),
      0,
    );
    const contactCount = results.reduce(
      (count, result) =>
        count +
        result.evidence.scenarios.reduce(
          (total, scenario) => total + scenario.contacts.length,
          0,
        ),
      0,
    );
    console.log(
      `PRES-COLLIDE-008 PASS: ${results.length} profiles, ${solidCount} solid roles, ${contactCount} exhaustive cardinal contacts, five negative controls`,
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
