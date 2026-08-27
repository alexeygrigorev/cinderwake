import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  evaluateStateReplayEvidence,
  hashJson,
  sha256,
} from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/state-replay/pres-state-028");
const SCENARIO_ID = "animation-walk";
const VIEWPORT = { width: 960, height: 540 };

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function dataUrlBuffer(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    throw new Error("State replay evidence must contain a PNG data URL");
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

function normalizeCapture(raw, frameFile) {
  const frame = dataUrlBuffer(raw.frame);
  return {
    tick: Number(raw.tick),
    stateTick: Number(raw.stateTick),
    manifestTick: Number(raw.manifestTick),
    snapshot: raw.snapshot,
    stateHash: raw.stateHash,
    manifest: raw.manifest,
    manifestHash: hashJson(raw.manifest),
    frameHash: sha256(frame),
    frameFile,
    frame,
  };
}

async function writeSingleCapture(directory, raw, frameFile) {
  await fs.mkdir(directory, { recursive: true });
  const capture = normalizeCapture(raw, frameFile);
  await fs.writeFile(path.join(directory, frameFile), capture.frame);
  return capture;
}

async function writeTimeline(directory, rawTimeline) {
  await fs.mkdir(directory, { recursive: true });
  const timeline = [];
  for (const [index, raw] of rawTimeline.entries()) {
    const frameFile = `frame-${String(index).padStart(4, "0")}.png`;
    timeline.push(await writeSingleCapture(directory, raw, frameFile));
  }
  return timeline;
}

function publicCapture(capture) {
  return {
    tick: capture.tick,
    stateTick: capture.stateTick,
    manifestTick: capture.manifestTick,
    snapshot: capture.snapshot,
    stateHash: capture.stateHash,
    manifest: capture.manifest,
    manifestHash: capture.manifestHash,
    frameHash: capture.frameHash,
    frameFile: capture.frameFile,
  };
}

function publicStates(timeline) {
  return timeline.map(({ tick, stateTick, stateHash, snapshot }) => ({
    tick,
    stateTick,
    stateHash,
    snapshot,
  }));
}

function publicManifests(timeline) {
  return timeline.map(
    ({
      tick,
      stateTick,
      manifestTick,
      stateHash,
      manifestHash,
      frameHash,
      frameFile,
      manifest,
    }) => ({
      tick,
      stateTick,
      manifestTick,
      stateHash,
      manifestHash,
      frameHash,
      frameFile,
      manifest,
    }),
  );
}

function cloneEvidence(evidence) {
  return structuredClone(evidence);
}

function negativeControls(evidence) {
  const controls = [
    {
      id: "stale-state-retained-after-reset",
      expectedSignal: "reset-isolation-failed",
      mutate(value) {
        value.reset.snapshot.player.position.x += 1;
      },
    },
    {
      id: "same-tape-state-diverged",
      expectedSignal: "replay-state-hash-mismatch",
      mutate(value) {
        value.replayB.timeline[2].stateHash = "mutated-state-hash";
      },
    },
    {
      id: "same-state-frame-diverged",
      expectedSignal: "replay-frame-hash-mismatch",
      mutate(value) {
        value.replayB.timeline[2].frameHash = "mutated-frame-hash";
      },
    },
    {
      id: "manifest-frame-tick-desynchronized",
      expectedSignal: "evidence-timeline-desynchronized",
      mutate(value) {
        value.replayB.timeline[1].manifestTick += 1;
      },
    },
    {
      id: "replay-snapshot-hash-diverged",
      expectedSignal: "state-hash-integrity-failed",
      mutate(value) {
        value.replayB.timeline[2].snapshot.player.position.x += 1;
      },
    },
    {
      id: "replay-manifest-hash-diverged",
      expectedSignal: "manifest-hash-integrity-failed",
      mutate(value) {
        value.replayB.timeline[2].manifest.tick += 1;
      },
    },
    {
      id: "replay-declared-ticks-diverged",
      expectedSignal: "evidence-timeline-desynchronized",
      mutate(value) {
        value.replayB.declaredTicks[2] += 1;
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = cloneEvidence(evidence);
    mutate(mutated);
    const result = evaluateStateReplayEvidence(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: result.failures,
    };
  });
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
        `State replay server exited with code ${server.exitCode}`,
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
  throw new Error(`State replay server did not start at ${baseURL}`);
}

function commandTape(initialTick) {
  return {
    version: 1,
    initialStateFile: "initial-state.json",
    entries: [
      { tick: initialTick, input: { moveX: 1 } },
      { tick: initialTick + 5, input: { moveX: 0, moveY: 1 } },
      { tick: initialTick + 10, input: { moveX: -1, moveY: 0 } },
      { tick: initialTick + 15, input: { moveX: 0, moveY: 0 } },
    ],
  };
}

async function main() {
  const port = Number(option("port", String(44_000 + (process.pid % 1_000))));
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

    const browserEvidence = await page.evaluate(() => {
      const bridge = window.__GAME_TEST__;
      if (!bridge) throw new Error("Game test bridge is unavailable");
      const captureCurrent = () => {
        bridge.render({ interpolationAlpha: 1 });
        const snapshot = bridge.snapshot();
        const manifest = bridge.renderManifest();
        return {
          tick: Number(snapshot.tick),
          stateTick: Number(snapshot.tick),
          manifestTick: Number(manifest.tick),
          snapshot,
          stateHash: bridge.stateHash(),
          manifest,
          frame: bridge.captureFrame(),
        };
      };
      const captureTimeline = (ticks, commands) => {
        bridge.queueInputs(commands.entries);
        return ticks.map((targetTick) => {
          const remaining = targetTick - Number(bridge.snapshot().tick);
          if (remaining < 0)
            throw new Error(`Cannot capture past tick ${targetTick}`);
          bridge.step(remaining, { render: true });
          return captureCurrent();
        });
      };

      bridge.loadScenario("animation-walk");
      const initialState = bridge.snapshot();
      const initialStateHash = bridge.stateHash();
      const initialTick = Number(initialState.tick);
      const commands = {
        version: 1,
        initialStateFile: "initial-state.json",
        entries: [
          { tick: initialTick, input: { moveX: 1 } },
          { tick: initialTick + 5, input: { moveX: 0, moveY: 1 } },
          { tick: initialTick + 10, input: { moveX: -1, moveY: 0 } },
          { tick: initialTick + 15, input: { moveX: 0, moveY: 0 } },
        ],
      };
      const captureTicks = [
        initialTick,
        initialTick + 5,
        initialTick + 10,
        initialTick + 15,
        initialTick + 20,
      ];
      bridge.loadState(initialState);
      const loaded = captureCurrent();
      const firstTimeline = captureTimeline(captureTicks, commands);
      bridge.reset();
      const reset = captureCurrent();
      const secondTimeline = captureTimeline(captureTicks, commands);
      return {
        initialState,
        initialStateHash,
        initialTick,
        captureTicks,
        commands,
        loaded,
        reset,
        firstTimeline,
        secondTimeline,
      };
    });

    const commands = commandTape(browserEvidence.initialTick);
    // The command tape is created in Node so its persisted form and its
    // browser execution cannot silently diverge.
    if (JSON.stringify(commands) !== JSON.stringify(browserEvidence.commands))
      throw new Error(
        "Browser command tape did not match the Node command tape",
      );

    const loaded = await writeSingleCapture(
      OUTPUT,
      browserEvidence.loaded,
      "loaded-state.png",
    );
    const reset = await writeSingleCapture(
      OUTPUT,
      browserEvidence.reset,
      "reset-state.png",
    );
    const replayADirectory = path.join(OUTPUT, "replay-a");
    const replayBDirectory = path.join(OUTPUT, "replay-b");
    const replayA = await writeTimeline(
      replayADirectory,
      browserEvidence.firstTimeline,
    );
    const replayB = await writeTimeline(
      replayBDirectory,
      browserEvidence.secondTimeline,
    );
    const evidence = {
      initialState: browserEvidence.initialState,
      initialStateHash: browserEvidence.initialStateHash,
      loaded: publicCapture(loaded),
      reset: publicCapture(reset),
      replayA: {
        declaredTicks: browserEvidence.captureTicks,
        timeline: replayA.map(publicCapture),
      },
      replayB: {
        declaredTicks: browserEvidence.captureTicks,
        timeline: replayB.map(publicCapture),
      },
    };
    const comparison = evaluateStateReplayEvidence(evidence);
    const controls = negativeControls(evidence);

    const source = sourceSnapshot();
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-STATE-028",
      recipeId: "recipe:pres-state-028",
      evaluator: "state-replay-determinism-v2",
      scenarioId: SCENARIO_ID,
      initialTick: browserEvidence.initialTick,
      captureTicks: browserEvidence.captureTicks,
      viewport: { ...VIEWPORT, dpr: 1 },
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:state-replay",
    };
    await Promise.all([
      writeJson(
        path.join(OUTPUT, "initial-state.json"),
        browserEvidence.initialState,
      ),
      writeJson(path.join(OUTPUT, "commands.json"), commands),
      writeJson(path.join(OUTPUT, "load-reset.json"), {
        schemaVersion: 1,
        initialStateHash: browserEvidence.initialStateHash,
        loaded: publicCapture(loaded),
        reset: publicCapture(reset),
      }),
      writeJson(
        path.join(replayADirectory, "states.json"),
        publicStates(replayA),
      ),
      writeJson(path.join(replayADirectory, "render-manifest-timeline.json"), {
        schemaVersion: 1,
        captureTicks: browserEvidence.captureTicks,
        frames: publicManifests(replayA),
      }),
      writeJson(
        path.join(replayBDirectory, "states.json"),
        publicStates(replayB),
      ),
      writeJson(path.join(replayBDirectory, "render-manifest-timeline.json"), {
        schemaVersion: 1,
        captureTicks: browserEvidence.captureTicks,
        frames: publicManifests(replayB),
      }),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "state-replay-determinism-v2",
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
        `PRES-STATE-028 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    }
    console.log(
      `PRES-STATE-028 PASS: ${browserEvidence.captureTicks.length} synchronized ticks, seven negative controls detected`,
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
