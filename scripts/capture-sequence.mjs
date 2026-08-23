import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function inputForAction(action) {
  const inputs = {
    idle: {},
    "move-east": { moveX: 1 },
    "move-west": { moveX: -1 },
    "move-north": { moveY: -1 },
    "move-south": { moveY: 1 },
    attack: { attack: true },
    ability: { ability: true },
    tonic: { useTonic: true },
  };
  if (!(action in inputs)) throw new Error(`Unknown --action ${action}`);
  return inputs[action];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

const scenario = option("scenario", "animation-idle");
const defaultAction = scenario.includes("walk")
  ? "move-east"
  : scenario.includes("ability")
    ? "ability"
    : scenario.includes("combat") || scenario.includes("attack")
      ? "attack"
      : "idle";
const action = option("action", defaultAction);
const trackedEntityId = option("track", "player");
const stateFile = option("state-file", null);
const commandsFile = option("commands-file", null);
const frameCount = Number(option("frames", "16"));
const step = Number(option("step", "2"));
const subframes = Number(option("subframes", "1"));
const viewportWidth = Number(option("viewport-width", "1440"));
const viewportHeight = Number(option("viewport-height", "900"));
const mobile = option("mobile", "false") === "true";
const profile = option(
  "profile",
  scenario.includes("camera")
    ? "camera-smooth"
    : action.startsWith("move-")
      ? "anchored-motion"
      : action === "attack" || action === "ability"
        ? "one-shot"
        : trackedEntityId.startsWith("projectile:")
          ? "projectile"
          : trackedEntityId.startsWith("loot:")
            ? "loop"
            : "pose",
);
const presenceContract = option(
  "presence",
  profile === "death" ? "present-until" : "always",
);
const suppliedState = stateFile
  ? JSON.parse(await fs.readFile(path.resolve(stateFile), "utf8"))
  : null;
const suppliedCommands = commandsFile
  ? JSON.parse(await fs.readFile(path.resolve(commandsFile), "utf8"))
  : null;
const identity = createHash("sha256")
  .update(
    JSON.stringify({
      scenario,
      action,
      trackedEntityId,
      frameCount,
      step,
      subframes,
      viewportWidth,
      viewportHeight,
      mobile,
      profile,
      presenceContract,
    }),
  )
  .digest("hex")
  .slice(0, 10);
const captureId = option(
  "id",
  `${scenario}--${action}--${trackedEntityId.replaceAll(":", "-")}--${identity}`,
);

if (!/^[a-zA-Z0-9._-]+$/.test(captureId))
  throw new Error(
    "--id may contain only letters, numbers, dot, underscore, dash",
  );
if (captureId === "." || captureId === "..")
  throw new Error("--id must name a capture, not a relative directory");
if (
  !Number.isInteger(frameCount) ||
  frameCount < 2 ||
  !Number.isInteger(step) ||
  step < 1 ||
  !Number.isInteger(subframes) ||
  subframes < 1 ||
  subframes > 8 ||
  !Number.isInteger(viewportWidth) ||
  viewportWidth < 280 ||
  !Number.isInteger(viewportHeight) ||
  viewportHeight < 280
)
  throw new Error(
    "Frames, step, subframes, and viewport dimensions are invalid",
  );
if (!new Set(["always", "present-until", "appears-at"]).has(presenceContract))
  throw new Error(`Unknown --presence ${presenceContract}`);

const port = Number(option("port", String(43_000 + (process.pid % 1_000))));
if (!Number.isInteger(port) || port < 1024 || port > 65_535)
  throw new Error("--port must be an available TCP port");
const baseURL = `http://127.0.0.1:${port}`;
let server;
let browser;

try {
  server = spawn(
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

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (server.exitCode !== null)
      throw new Error(`Capture server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(baseURL);
      ready = response.ok && (await response.text()).includes("Cinderwake");
      if (ready) break;
    } catch {
      // Vite is still starting.
    }
  }
  if (!ready)
    throw new Error(`Cinderwake capture server did not start at ${baseURL}`);

  // Playwright clears test-results at the beginning of a browser run. Keep
  // durable temporal evidence in a sibling root so verification order cannot
  // erase an already captured matrix.
  const outputRoot = path.resolve("quality-results/sequences");
  const output = path.resolve(outputRoot, captureId);
  if (path.dirname(output) !== outputRoot)
    throw new Error(
      "Capture output must remain inside quality-results/sequences",
    );
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch();

  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    hasTouch: mobile,
    isMobile: mobile,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?testMode=1&scenario=animation-idle`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  if (suppliedState)
    await page.evaluate(
      (state) => window.__GAME_TEST__.loadState(state),
      suppliedState,
    );
  else
    await page.evaluate(
      (name) => window.__GAME_TEST__.loadScenario(name),
      scenario,
    );
  const initialState = await page.evaluate(() =>
    window.__GAME_TEST__.snapshot(),
  );
  const initialStateHash = await page.evaluate(() =>
    window.__GAME_TEST__.stateHash(),
  );
  const initialTick = Number(initialState.tick);
  const semanticInput = inputForAction(action);
  const commands = suppliedCommands ?? {
    version: 1,
    initialStateFile: "initial-state.json",
    entries: [
      { tick: initialTick, input: semanticInput },
      ...(action === "attack" || action === "ability"
        ? [
            {
              tick: initialTick + step,
              input: { attack: false, ability: false },
            },
          ]
        : []),
    ],
  };
  if (
    commands.version !== 1 ||
    !Array.isArray(commands.entries) ||
    commands.entries.some(
      (entry) =>
        !Number.isInteger(entry?.tick) ||
        entry.tick < initialTick ||
        !entry.input ||
        typeof entry.input !== "object",
    )
  )
    throw new Error("Command tape is invalid for the loaded initial state");
  const commandEntries = [...commands.entries].sort(
    (left, right) => left.tick - right.tick,
  );
  let nextCommand = 0;
  const applyCommandsAtTick = async (tick) => {
    while (
      nextCommand < commandEntries.length &&
      commandEntries[nextCommand].tick === tick
    ) {
      await page.evaluate(
        (input) => window.__GAME_TEST__.setInput(input),
        commandEntries[nextCommand].input,
      );
      nextCommand += 1;
    }
  };
  await applyCommandsAtTick(initialTick);

  const timeline = [];
  const reportFrames = [];
  let displayFrameIndex = 0;
  let lastAnchor = null;
  const captureDisplayFrame = async (interpolationAlpha) => {
    const item = await page.evaluate(
      ({ entityId, interpolationAlpha, lastAnchor }) => {
        window.__GAME_TEST__.render({ interpolationAlpha });
        const snapshot = window.__GAME_TEST__.snapshot();
        const manifest = window.__GAME_TEST__.renderManifest();
        const canvas = document.querySelector("canvas");
        const tracked = manifest.drawCalls.find(
          (call) => call.entityId === entityId,
        );
        if (!canvas) throw new Error("Game canvas is unavailable");
        const anchor = tracked?.footAnchor ??
          lastAnchor ?? {
            x: canvas.width / 2,
            y: canvas.height / 2,
          };
        const cropWidth = 260;
        const cropHeight = 200;
        const cropX = Math.max(
          0,
          Math.min(
            canvas.width - cropWidth,
            Math.round(anchor.x - cropWidth / 2),
          ),
        );
        const cropY = Math.max(
          0,
          Math.min(
            canvas.height - cropHeight,
            Math.round(anchor.y - cropHeight * 0.74),
          ),
        );
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        const cropContext = cropCanvas.getContext("2d");
        if (!cropContext) throw new Error("Close-up Canvas 2D is unavailable");
        cropContext.drawImage(
          canvas,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );
        return {
          tick: snapshot.tick,
          snapshot,
          stateHash: window.__GAME_TEST__.stateHash(),
          manifest,
          frame: window.__GAME_TEST__.captureFrame(),
          closeup: cropCanvas.toDataURL("image/png"),
          mask: tracked
            ? window.__GAME_TEST__.captureEntityMask(entityId)
            : null,
          anchor: tracked?.footAnchor ?? null,
          crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
        };
      },
      { entityId: trackedEntityId, interpolationAlpha, lastAnchor },
    );
    if (item.anchor) lastAnchor = item.anchor;
    const pageFrame = await page.locator(".game").screenshot({
      animations: "disabled",
    });

    const suffix = String(displayFrameIndex).padStart(4, "0");
    const frameName = `frame-${suffix}.png`;
    const closeupName = `closeup-${suffix}.png`;
    const maskName = item.mask ? `mask-${suffix}.png` : null;
    const pageName = `page-${suffix}.png`;
    const frameBuffer = Buffer.from(
      item.frame.replace(/^data:image\/png;base64,/, ""),
      "base64",
    );
    const closeupBuffer = Buffer.from(
      item.closeup.replace(/^data:image\/png;base64,/, ""),
      "base64",
    );
    const maskBuffer = item.mask
      ? Buffer.from(
          item.mask.image.replace(/^data:image\/png;base64,/, ""),
          "base64",
        )
      : null;
    await Promise.all([
      fs.writeFile(path.join(output, frameName), frameBuffer),
      fs.writeFile(path.join(output, closeupName), closeupBuffer),
      ...(maskName && maskBuffer
        ? [fs.writeFile(path.join(output, maskName), maskBuffer)]
        : []),
      fs.writeFile(path.join(output, pageName), pageFrame),
    ]);
    const maskMetrics = item.mask ? { ...item.mask } : null;
    if (maskMetrics && maskBuffer) {
      delete maskMetrics.image;
      maskMetrics.artifactSha256 = createHash("sha256")
        .update(maskBuffer)
        .digest("hex");
    }
    timeline.push({
      tick: item.tick,
      stateHash: item.stateHash,
      snapshot: item.snapshot,
      manifest: item.manifest,
      mask: maskMetrics,
      crop: item.crop,
      files: { frameName, closeupName, maskName, pageName },
    });
    reportFrames.push({
      tick: item.tick,
      source: frameName,
      closeup: closeupName,
      mask: maskName,
      page: pageName,
      manifest: item.manifest,
      crop: item.crop,
    });
    displayFrameIndex += 1;
  };

  for (let interval = 0; interval < frameCount; interval += 1) {
    if (interval > 0) {
      for (let tickOffset = 0; tickOffset < step; tickOffset += 1) {
        const currentTick = Number(
          await page.evaluate(() => window.__GAME_TEST__.snapshot().tick),
        );
        await applyCommandsAtTick(currentTick);
        await page.evaluate(() =>
          window.__GAME_TEST__.step(1, { render: false }),
        );
      }
    }
    const interpolationAlphas =
      interval === 0 || subframes === 1
        ? [1]
        : Array.from(
            { length: subframes },
            (_, index) => (index + 1) / subframes,
          );
    for (const interpolationAlpha of interpolationAlphas)
      await captureDisplayFrame(interpolationAlpha);
  }

  const sourceCommit =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourceStatus = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  });
  const sourceDiff = execFileSync("git", ["diff", "--binary", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const sourceDirty = sourceStatus.trim().length > 0;
  const sourcePatchSha256 = createHash("sha256")
    .update(sourceDiff)
    .digest("hex");
  const trackedWorktreeHash = createHash("sha256")
    .update(sourceCommit)
    .update("\0")
    .update(sourceDiff)
    .digest("hex");
  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
  const artifactDirectory = path.join(
    "quality-results",
    "sequences",
    captureId,
  );
  const reproductionCommand = [
    "npm run capture:sequence --",
    `--id ${shellQuote(`${captureId}-reproduced`)}`,
    `--state-file ${shellQuote(path.join(artifactDirectory, "initial-state.json"))}`,
    `--commands-file ${shellQuote(path.join(artifactDirectory, "commands.json"))}`,
    `--scenario ${shellQuote(scenario)}`,
    `--action ${shellQuote(action)}`,
    `--track ${shellQuote(trackedEntityId)}`,
    `--profile ${shellQuote(profile)}`,
    `--presence ${shellQuote(presenceContract)}`,
    `--frames ${frameCount}`,
    `--step ${step}`,
    `--subframes ${subframes}`,
    `--viewport-width ${viewportWidth}`,
    `--viewport-height ${viewportHeight}`,
    ...(mobile ? ["--mobile true"] : []),
  ].join(" ");
  const metadata = {
    schemaVersion: 2,
    captureId,
    scenario,
    action,
    profile,
    trackedEntityId,
    simulationFrameCount: frameCount,
    displayFrameCount: timeline.length,
    stepTicks: step,
    subframes,
    presenceContract,
    initialTick,
    initialStateHash,
    sourceCommit,
    sourceDirty,
    sourcePatchSha256,
    trackedWorktreeHash,
    sourceStatus: sourceStatus.trim().split("\n").filter(Boolean),
    viewport: { width: viewportWidth, height: viewportHeight, dpr: 1, mobile },
    logicalCanvas: { width: 960, height: 540, dpr: 1 },
    environment: {
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
      browser: await browser.version(),
      packageVersion: packageJson.version,
      playwright: packageJson.devDependencies["@playwright/test"],
      vite: packageJson.devDependencies.vite,
    },
    reproductionCommand,
  };
  await Promise.all([
    fs.writeFile(
      path.join(output, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(output, "initial-state.json"),
      `${JSON.stringify(initialState, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(output, "commands.json"),
      `${JSON.stringify({ ...commands, initialStateFile: "initial-state.json" }, null, 2)}\n`,
    ),
    fs.writeFile(path.join(output, "source-diff.patch"), sourceDiff),
    fs.writeFile(path.join(output, "source-status.txt"), sourceStatus),
    fs.writeFile(
      path.join(output, "states.json"),
      `${JSON.stringify(
        timeline.map(({ tick, stateHash, snapshot }) => ({
          tick,
          stateHash,
          snapshot,
        })),
        null,
        2,
      )}\n`,
    ),
    fs.writeFile(
      path.join(output, "render-manifest-timeline.json"),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          captureId,
          trackedEntityId,
          profile,
          presenceContract,
          frames: timeline,
        },
        null,
        2,
      )}\n`,
    ),
  ]);

  const assessment = spawn(
    process.execPath,
    [
      "scripts/assess-sequence.mjs",
      path.join(output, "render-manifest-timeline.json"),
    ],
    { stdio: "inherit" },
  );
  const assessmentCode = await new Promise((resolve) =>
    assessment.on("exit", resolve),
  );
  if (assessmentCode !== 0)
    throw new Error(`Sequence assessment failed with code ${assessmentCode}`);
  const analysis = JSON.parse(
    await fs.readFile(path.join(output, "animation-analysis.json"), "utf8"),
  );

  const figures = reportFrames
    .map((entry) => {
      const tracked = entry.manifest.drawCalls.find(
        (call) => call.entityId === trackedEntityId,
      );
      const anchorX =
        (((tracked?.footAnchor.x ?? 0) - entry.crop.x) / entry.crop.width) *
        100;
      const anchorY =
        (((tracked?.footAnchor.y ?? 0) - entry.crop.y) / entry.crop.height) *
        100;
      const anchor = tracked
        ? `<span class="anchor" style="left:${anchorX}%;top:${anchorY}%"></span>`
        : "";
      const mask = entry.mask
        ? `<img class="mask" src="${entry.mask}" alt="transparent entity mask at tick ${entry.tick}">`
        : `<div class="missing">entity absent</div>`;
      const pageEvidence =
        profile === "static-pose"
          ? `<img class="page-preview" src="${entry.page}" alt="game page at tick ${entry.tick}">`
          : `<details><summary>Composed page with HUD</summary><img class="full" src="${entry.page}" alt="game page at tick ${entry.tick}"></details>`;
      return `<figure><div class="comparison"><div class="frame"><img src="${entry.closeup}" alt="close-up at tick ${entry.tick}">${anchor}</div>${mask}</div><figcaption>tick ${entry.tick} · presentation ${entry.manifest.presentationTick} · frame ${tracked?.frameIndex ?? "—"} · ${escapeHtml(tracked?.clip ?? "absent")}</figcaption><details><summary>Full canvas</summary><img class="full" src="${entry.source}" alt="full scene at tick ${entry.tick}"></details>${pageEvidence}</figure>`;
    })
    .join("");
  const checks = Object.entries(analysis.checks)
    .map(
      ([name, pass]) =>
        `<li class="${pass ? "pass" : "fail"}">${pass ? "PASS" : "FAIL"} · ${escapeHtml(name)}</li>`,
    )
    .join("");
  const report = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(captureId)} sequence</title><style>body{margin:0;padding:24px;background:#0a0d0f;color:#eee;font:14px ui-monospace,monospace}h1{margin:0 0 6px;font:32px Georgia,serif}.meta{color:#aab4ad;line-height:1.6;margin:0 0 16px}.status{padding:12px;background:#101718;border:1px solid #384641;margin-bottom:20px}.status strong{color:${analysis.pass ? "#83d0a3" : "#ed796f"}}ul{display:flex;flex-wrap:wrap;gap:6px;padding:0;list-style:none}li{padding:5px 7px;background:#18201e}.pass{color:#8dd6a9}.fail{color:#ff8175}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}figure{margin:0;background:#151a1c;border:1px solid #39413e;padding:6px}.comparison{display:grid;grid-template-columns:1fr 110px;gap:6px;align-items:end}.frame{position:relative}.frame img,.mask,.full,.page-preview{display:block;width:100%;height:auto}.page-preview{max-height:260px;margin-top:6px;object-fit:contain;background:#080b0d}.mask,.missing{background:repeating-conic-gradient(#24302d 0 25%,#19211f 0 50%) 50%/12px 12px}.missing{display:grid;min-height:90px;place-items:center;color:#8d9993}.anchor{position:absolute;width:11px;height:11px;border:1px solid #fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px #000}.anchor:after,.anchor:before{content:"";position:absolute;background:#fff}.anchor:after{height:1px;width:17px;left:-4px;top:4px}.anchor:before{width:1px;height:17px;left:4px;top:-4px}figcaption{padding:7px 2px 1px;color:#d9b77c;font-size:11px}details{margin-top:4px;color:#9aa6a0;font-size:10px}summary{cursor:pointer}code{color:#efbd76;word-break:break-all}</style></head><body><h1>${escapeHtml(captureId)}</h1><p class="meta">${escapeHtml(action)} · track ${escapeHtml(trackedEntityId)} · ${timeline.length} display frames from ${frameCount} simulation samples · ${step} tick(s) per sample · ${subframes} presentation sample(s) per interval · presence ${escapeHtml(presenceContract)} · crosshair is the semantic anchor; checkerboard is the actor rendered in isolation by the same draw routine; full-canvas and composed-page evidence are attached separately</p><section class="status"><strong>${analysis.pass ? "PASS" : "FAIL"}</strong><ul>${checks}</ul><p>Commit <code>${sourceCommit}</code>${sourceDirty ? " · source patch and status are bundled" : " · clean source tree"}<br>Reproduce: <code>${escapeHtml(reproductionCommand)}</code></p></section><main class="grid">${figures}</main></body></html>`;
  const reportFile = path.join(output, "report.html");
  await fs.writeFile(reportFile, report);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(pathToFileURL(reportFile).href, { waitUntil: "load" });
  await page.screenshot({
    path: path.join(output, "contact-sheet.png"),
    fullPage: true,
  });
  console.log(`Captured ${timeline.length} reproducible frames in ${output}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}
