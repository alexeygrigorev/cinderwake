import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  evaluateCompositorEvidence,
  runCompositorNegativeControls,
} from "./lib/compositor-evidence.mjs";

const OUTPUT = path.resolve("quality-results/compositor/pres-leak-012");
const VIEWPORT = { width: 960, height: 540 };

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("Compositor evidence must contain a PNG data URL");
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
        `Compositor test server exited with code ${server.exitCode}`,
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
  throw new Error(`Compositor test server did not start at ${baseURL}`);
}

function ownerPaintCounts(manifest) {
  const paintCounts = new Map();
  const ownerIds = new Set(
    (manifest.drawCalls ?? [])
      .map(({ entityId }) => entityId)
      .filter((entityId) => typeof entityId === "string"),
  );
  for (const paint of manifest.paintQueue ?? []) {
    if (typeof paint.paintId !== "string" || !paint.paintId.startsWith("body:"))
      continue;
    const ownerId = paint.paintId.slice("body:".length);
    ownerIds.add(ownerId);
    paintCounts.set(ownerId, (paintCounts.get(ownerId) ?? 0) + 1);
  }
  return [...ownerIds].sort().map((ownerId) => ({
    ownerId,
    bodyPaintCount: paintCounts.get(ownerId) ?? 0,
  }));
}

async function main() {
  const port = 44_000 + (process.pid % 1_000);
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

    const raw = await page.evaluate(() => {
      const bridge = window.__GAME_TEST__;
      if (!bridge) throw new Error("Game test bridge is unavailable");
      const capture = () => {
        bridge.render({ interpolationAlpha: 1 });
        return {
          snapshot: bridge.snapshot(),
          manifest: bridge.renderManifest(),
          frame: bridge.captureFrame(),
        };
      };

      bridge.loadScenario("animation-idle");
      const first = capture();
      const second = capture();
      bridge.loadScenario("combat-loot");
      const populated = capture();
      bridge.loadScenario("animation-idle");
      const afterTransition = capture();
      bridge.loadScenario("animation-idle");
      const fresh = capture();
      return { first, second, populated, afterTransition, fresh };
    });

    const frameFiles = {
      first: "first.png",
      second: "second.png",
      populated: "populated.png",
      afterTransition: "after-transition.png",
      fresh: "fresh.png",
    };
    const captures = {};
    for (const [name, capture] of Object.entries(raw)) {
      const bytes = dataUrlBuffer(capture.frame);
      const frameFile = frameFiles[name];
      await fs.writeFile(path.join(OUTPUT, frameFile), bytes);
      captures[name] = {
        snapshot: capture.snapshot,
        manifest: capture.manifest,
        frameHash: sha256(bytes),
        frameFile,
      };
    }
    const evidence = {
      repeat: {
        firstFrameHash: captures.first.frameHash,
        secondFrameHash: captures.second.frameHash,
      },
      transition: {
        afterFrameHash: captures.afterTransition.frameHash,
        freshFrameHash: captures.fresh.frameHash,
      },
      ownerPaints: ownerPaintCounts(captures.populated.manifest),
    };
    const comparison = evaluateCompositorEvidence(evidence);
    const controls = runCompositorNegativeControls(evidence);
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-LEAK-012",
      recipeId: "recipe:pres-leak-012",
      evaluator: "compositor-reconstruction-v1",
      scenarioIds: ["animation-idle", "combat-loot"],
      deviceProfileIds: ["desktop"],
      viewport: { ...VIEWPORT, dpr: 1 },
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
      },
      reproductionCommand: "npm run test:compositor",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "captures.json"), captures),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "compositor-reconstruction-v1",
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
        `PRES-LEAK-012 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-LEAK-012 PASS: repeated and reconstructed frames are exact, ${controls.length} compositor controls detected`,
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
