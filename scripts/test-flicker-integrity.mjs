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
const SEGMENT_TICKS = {
  "mid-action-state": [240, 241, 242, 243],
  "loot-and-projectile-owners": [0, 1, 2, 3, 4],
  "effect-despawn": Array.from({ length: 32 }, (_, index) => index),
};

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

function manifestEffectIds(manifest) {
  return (manifest.drawCalls ?? [])
    .filter(({ type, visible }) => type === "effect" && visible)
    .map(({ entityId }) => entityId)
    .sort();
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
    frame: capture.frame,
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
          populated: captureSegment("mid-action", [240]),
          afterTransition: captureSegment("animation-idle", [0]),
          fresh: captureSegment("animation-idle", [0]),
        };
      },
      {
        midAction: SEGMENT_TICKS["mid-action-state"],
        lootAndProjectile: SEGMENT_TICKS["loot-and-projectile-owners"],
        effectDespawn: SEGMENT_TICKS["effect-despawn"],
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
    ];

    const effectFrames = segments[2].frames;
    const effectStartIndex = effectFrames.findIndex(
      ({ effectIds }) => effectIds.length > 0,
    );
    const effectEndIndex =
      effectStartIndex < 0
        ? -1
        : effectFrames.findIndex(
            ({ effectIds }, index) =>
              index > effectStartIndex && effectIds.length === 0,
          );
    if (effectStartIndex < 0 || effectEndIndex < 0)
      throw new Error(
        "Effect lifecycle fixture did not contain both a visible and a despawned sample",
      );
    const effectId = effectFrames[effectStartIndex].effectIds[0];
    const transitionFrame = raw.afterTransition[0].frame;
    const freshFrame = raw.fresh[0].frame;
    const residual = await measurePngResidual(
      dataUrlBuffer(transitionFrame),
      dataUrlBuffer(freshFrame),
    );
    const evidence = {
      segments: segments.map(({ id, expectedTicks, frames }) => ({
        id,
        expectedTicks,
        frames: frames.map(
          ({ tick, expectedOwnerIds, observedOwnerIds, ownerPaints }) => ({
            tick,
            expectedOwnerIds,
            observedOwnerIds,
            ownerPaints,
          }),
        ),
      })),
      residuals: [residual],
      effects: [
        {
          effectId,
          observedBefore: true,
          observedAfter: false,
          beforeTick: effectFrames[effectStartIndex].tick,
          afterTick: effectFrames[effectEndIndex].tick,
        },
      ],
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
        "mid-action",
        "temporal-loot-bob",
        "temporal-friendly-projectile-impact",
        "animation-idle",
      ],
      deviceProfileIds: ["desktop-deterministic"],
      viewport: { ...VIEWPORT, dpr: 1 },
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
            }) => ({
              tick,
              snapshot,
              manifest,
              expectedOwnerIds,
              observedOwnerIds,
              ownerPaints,
              effectIds,
            }),
          ),
        })),
        frameArtifacts,
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
