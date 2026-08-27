import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  evaluateRenderResolutionEvidence,
  measurePngCropSharpness,
  runRenderResolutionNegativeControls,
} from "./lib/render-resolution-evidence.mjs";

const OUTPUT = path.resolve("quality-results/render-resolution/pres-crisp-006");
const LOGICAL_VIEWPORT = { width: 960, height: 540 };
const PROFILES = [
  {
    id: "desktop-dpr1",
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  {
    id: "phone-portrait-high-dpr",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  },
];
const CONTROLLED_SCENARIOS = [
  { id: "animation-idle", loadId: "animation-idle", ticks: 0 },
  { id: "animation-walk", loadId: "animation-walk", ticks: 4 },
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Crispness evidence must contain a PNG data URL");
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
        `Crispness test server exited with code ${server.exitCode}`,
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
  throw new Error(`Crispness test server did not start at ${baseURL}`);
}

async function waitForObserver(page) {
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready), {
    timeout: 30_000,
  });
}

async function readGeometry(page, profileId) {
  return page.locator("canvas").evaluate((element, id) => {
    const canvas = element;
    const rect = canvas.getBoundingClientRect();
    const manifest = window.__GAME_OBSERVE__?.renderManifest();
    if (!manifest)
      throw new Error("Crispness observer manifest is unavailable");
    return {
      profileId: id,
      logicalViewport: {
        width: manifest.viewport.width,
        height: manifest.viewport.height,
      },
      css: { width: rect.width, height: rect.height },
      backing: { width: canvas.width, height: canvas.height },
      devicePixelRatio: window.devicePixelRatio,
      manifestDpr: manifest.viewport.dpr,
    };
  }, profileId);
}

async function captureProductionLaunch(page, profile, baseURL) {
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  const classCard = page.locator("[data-class='vanguard']");
  await classCard.waitFor({ state: "visible" });
  if (profile.hasTouch) await classCard.tap();
  else await classCard.click();
  const begin = page.locator("#begin");
  if (profile.hasTouch) await begin.tap();
  else await begin.click();
  await waitForObserver(page);
  return page.evaluate(() => {
    const observer = window.__GAME_OBSERVE__;
    if (!observer)
      throw new Error("Production crispness observer is unavailable");
    const manifest = observer.renderManifest();
    return {
      snapshot: observer.snapshot(),
      manifest,
      frame: observer.captureFrame(),
      mode: observer.mode,
    };
  });
}

async function captureControlledScenario(page, scenario) {
  return page.evaluate((current) => {
    const bridge = window.__GAME_TEST__;
    const observer = window.__GAME_OBSERVE__;
    if (!bridge || !observer)
      throw new Error("Controlled crispness bridge is unavailable");
    bridge.loadScenario(current.loadId);
    if (current.ticks > 0) {
      bridge.setInput({ moveX: 1 });
      bridge.step(current.ticks);
      bridge.setInput({ moveX: 0 });
    }
    bridge.render({ interpolationAlpha: 1 });
    return {
      snapshot: observer.snapshot(),
      manifest: observer.renderManifest(),
      frame: observer.captureFrame(),
    };
  }, scenario);
}

function sceneTarget(manifest, production = false) {
  return production
    ? manifest.sceneSprites.find(
        ({ kind, visible }) => kind === "tile" && visible,
      )
    : manifest.sceneSprites.find(
        ({ objectId, visible }) => objectId === "tile:14:4" && visible,
      );
}

function targetRect(manifest, target) {
  const actor = manifest.drawCalls.find(
    ({ entityId }) => entityId === "player",
  );
  if (!actor?.visible)
    throw new Error("Crispness player target is not visible");
  const scene = sceneTarget(manifest, target === "production");
  if (!scene) throw new Error("Crispness terrain target is not visible");
  return {
    player: { role: "player", objectId: "player", rect: actor.destinationRect },
    terrain: {
      role: "terrain",
      objectId: scene.objectId,
      rect: scene.destinationRect,
    },
  };
}

async function writeCapture(directory, name, bytes) {
  const file = path.join(directory, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return {
    file: path.relative(OUTPUT, file),
    sha256: sha256(bytes),
  };
}

async function collectCrops({
  profile,
  capture,
  scenarioId,
  captureLabel,
  outputDirectory,
  production = false,
}) {
  const frameBytes = dataUrlBuffer(capture.frame);
  const frameArtifact = await writeCapture(
    outputDirectory,
    `${captureLabel}.png`,
    frameBytes,
  );
  const targets = targetRect(
    capture.manifest,
    production ? "production" : "controlled",
  );
  const samples = [];
  const cropArtifacts = [];
  for (const target of Object.values(targets)) {
    const scale = capture.manifest.viewport.dpr;
    const request = {
      x: target.rect.x * scale,
      y: target.rect.y * scale,
      width: target.rect.width * scale,
      height: target.rect.height * scale,
    };
    const measured = await measurePngCropSharpness(frameBytes, request);
    const cropName = `${captureLabel}-${target.role}`;
    const cropArtifact = await writeCapture(
      path.join(outputDirectory, "crops"),
      `${cropName}.png`,
      measured.cropPng,
    );
    const blurredArtifact = await writeCapture(
      path.join(outputDirectory, "crops"),
      `${cropName}-blurred.png`,
      measured.blurredPng,
    );
    cropArtifacts.push({
      role: target.role,
      objectId: target.objectId,
      original: cropArtifact,
      blurred: blurredArtifact,
    });
    samples.push({
      id: `${profile.id}-${scenarioId}-${target.role}`,
      profileId: profile.id,
      role: target.role,
      objectId: target.objectId,
      scenarioId,
      captureMode: "physical-canvas",
      frameSize: measured.frameSize,
      crop: measured.crop,
      blurMutation: "gaussian-blur-1.5",
      sharpness: measured.sharpness,
      blurredSharpness: measured.blurredSharpness,
      frame: frameArtifact,
      crops: cropArtifacts.slice(-1),
    });
  }
  return {
    frame: frameArtifact,
    crops: cropArtifacts,
    samples,
    snapshot: capture.snapshot,
    manifest: capture.manifest,
  };
}

async function main() {
  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });
  let browser;
  let server;
  try {
    const port = 4181;
    const started = await startServer(port);
    server = started.server;
    browser = await chromium.launch();
    const geometrySamples = [];
    const cropSamples = [];
    const profileArtifacts = [];
    const productionLaunches = [];
    for (const profile of PROFILES) {
      const context = await browser.newContext(profile);
      const page = await context.newPage();
      try {
        const production = await captureProductionLaunch(
          page,
          profile,
          started.baseURL,
        );
        const productionGeometry = await readGeometry(page, profile.id);
        productionLaunches.push({
          profileId: profile.id,
          mode: production.mode,
          geometry: productionGeometry,
          snapshot: production.snapshot,
          manifest: production.manifest,
        });
        const profileRoot = path.join(OUTPUT, profile.id);
        const productionCapture = await collectCrops({
          profile,
          capture: production,
          scenarioId: "ordinary-production-launch",
          captureLabel: "ordinary-production-launch",
          outputDirectory: path.join(profileRoot, "production"),
          production: true,
        });
        cropSamples.push(...productionCapture.samples);

        await page.goto(
          `${started.baseURL}/?testMode=1&scenario=animation-idle`,
          { waitUntil: "networkidle" },
        );
        await waitForObserver(page);
        for (const scenario of CONTROLLED_SCENARIOS) {
          const geometry = await readGeometry(page, profile.id);
          if (
            geometrySamples.every(({ profileId }) => profileId !== profile.id)
          )
            geometrySamples.push(geometry);
          const capture = await captureControlledScenario(page, scenario);
          const controlledCapture = await collectCrops({
            profile,
            capture,
            scenarioId: scenario.id,
            captureLabel: scenario.id,
            outputDirectory: path.join(profileRoot, "controlled"),
          });
          cropSamples.push(...controlledCapture.samples);
          profileArtifacts.push({
            profileId: profile.id,
            scenarioId: scenario.id,
            snapshot: controlledCapture.snapshot,
            manifest: controlledCapture.manifest,
            frame: controlledCapture.frame,
            crops: controlledCapture.crops,
          });
        }
        await writeJson(path.join(profileRoot, "production", "launch.json"), {
          schemaVersion: 1,
          profileId: profile.id,
          scenarioId: "ordinary-production-launch",
          geometry: productionGeometry,
          snapshot: production.snapshot,
          manifest: production.manifest,
          frame: productionCapture.frame,
          crops: productionCapture.crops,
        });
      } finally {
        await context.close();
      }
    }
    const evidence = { geometrySamples, cropSamples };
    const comparison = evaluateRenderResolutionEvidence(evidence);
    const negativeControls = runRenderResolutionNegativeControls(evidence);
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-CRISP-006",
      recipeId: "recipe:pres-crisp-006",
      evaluator: "render-resolution-contract-v1",
      scenarioIds: [
        "ordinary-production-launch",
        "animation-idle",
        "animation-walk",
      ],
      deviceProfileIds: PROFILES.map(({ id }) => id),
      gestureIds: ["begin", "move-east"],
      viewport: LOGICAL_VIEWPORT,
      geometrySamples,
      productionLaunches,
      profiles: profileArtifacts,
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
      },
      reproductionCommand: "npm run test:crispness",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "dpr-projection.json"), {
        schemaVersion: 1,
        evaluator: "render-resolution-contract-v1",
        geometrySamples,
      }),
      writeJson(path.join(OUTPUT, "motion.json"), {
        schemaVersion: 1,
        evaluator: "render-resolution-contract-v1",
        profiles: profileArtifacts,
      }),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "render-resolution-contract-v1",
        evidence,
        comparison,
        negativeControls,
      }),
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
    ]);
    if (
      !comparison.pass ||
      negativeControls.length !== 2 ||
      negativeControls.some(({ status }) => status !== "DETECTED")
    ) {
      throw new Error(
        `PRES-CRISP-006 failed: ${[
          ...comparison.failures,
          ...negativeControls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-CRISP-006 PASS: ${geometrySamples.length} DPR projections and ${cropSamples.length} physical crops calibrated, ${negativeControls.length} sharpness/resolution controls detected`,
    );
    console.log(`Evidence: ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await browser?.close();
    server?.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
