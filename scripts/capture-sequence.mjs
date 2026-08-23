import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
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

const scenario = option("scenario", "animation-idle");
const defaultAction = scenario.includes("walk")
  ? "move-east"
  : scenario.includes("combat")
    ? "attack"
    : "idle";
const action = option("action", defaultAction);
const frameCount = Number(option("frames", "12"));
const step = Number(option("step", "1"));
if (
  !Number.isInteger(frameCount) ||
  frameCount < 1 ||
  !Number.isInteger(step) ||
  step < 1
) {
  throw new Error("--frames and --step must be positive integers");
}

const port = Number(option("port", String(43_000 + (process.pid % 1_000))));
if (!Number.isInteger(port) || port < 1024 || port > 65_535)
  throw new Error("--port must be an available TCP port");
const baseURL = `http://127.0.0.1:${port}`;
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
  {
    stdio: "ignore",
  },
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
  throw new Error(
    `Cinderwake capture server did not become ready at ${baseURL}`,
  );

const output = path.resolve("test-results/sequences", scenario);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.goto(`${baseURL}/?testMode=1&scenario=animation-idle`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  await page.evaluate(
    (name) => window.__GAME_TEST__.loadScenario(name),
    scenario,
  );
  await page.evaluate(
    (input) => window.__GAME_TEST__.setInput(input),
    inputForAction(action),
  );

  const timeline = [];
  const embeddedFrames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const item = await page.evaluate((amount) => {
      window.__GAME_TEST__.step(amount, { render: true });
      const snapshot = window.__GAME_TEST__.snapshot();
      const manifest = window.__GAME_TEST__.renderManifest();
      const canvas = document.querySelector("canvas");
      const player = manifest.drawCalls.find(
        (call) => call.entityId === "player",
      );
      if (!canvas || !player)
        throw new Error("Player capture geometry is unavailable");
      const cropWidth = 240;
      const cropHeight = 180;
      const cropX = Math.max(
        0,
        Math.min(
          canvas.width - cropWidth,
          Math.round(player.footAnchor.x - cropWidth / 2),
        ),
      );
      const cropY = Math.max(
        0,
        Math.min(
          canvas.height - cropHeight,
          Math.round(player.footAnchor.y - cropHeight * 0.72),
        ),
      );
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      cropCanvas
        .getContext("2d")
        .drawImage(
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
        manifest,
        frame: window.__GAME_TEST__.captureFrame(),
        closeup: cropCanvas.toDataURL("image/png"),
        crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
      };
    }, step);
    if (index === 0 && (action === "attack" || action === "ability")) {
      await page.evaluate(() =>
        window.__GAME_TEST__.setInput({ attack: false, ability: false }),
      );
    }
    const fileName = `frame-${String(index).padStart(4, "0")}.png`;
    const closeupFileName = `closeup-${String(index).padStart(4, "0")}.png`;
    const data = item.frame.replace(/^data:image\/png;base64,/, "");
    const closeupData = item.closeup.replace(/^data:image\/png;base64,/, "");
    await fs.writeFile(
      path.join(output, fileName),
      Buffer.from(data, "base64"),
    );
    await fs.writeFile(
      path.join(output, closeupFileName),
      Buffer.from(closeupData, "base64"),
    );
    timeline.push({
      tick: item.tick,
      snapshot: item.snapshot,
      manifest: item.manifest,
      crop: item.crop,
    });
    embeddedFrames.push({
      tick: item.tick,
      source: item.frame,
      closeup: item.closeup,
      manifest: item.manifest,
      crop: item.crop,
    });
  }

  const metadata = {
    schemaVersion: 1,
    scenario,
    action,
    frameCount,
    stepTicks: step,
    viewport: { width: 960, height: 540, dpr: 1 },
    reproductionCommand: `npm run capture:sequence -- --scenario ${scenario} --action ${action} --frames ${frameCount} --step ${step}`,
  };
  await fs.writeFile(
    path.join(output, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(output, "states.json"),
    `${JSON.stringify(
      timeline.map((entry) => ({ tick: entry.tick, snapshot: entry.snapshot })),
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(output, "render-manifest-timeline.json"),
    `${JSON.stringify(timeline, null, 2)}\n`,
  );

  const figures = embeddedFrames
    .map((entry) => {
      const player = entry.manifest.drawCalls.find(
        (call) => call.entityId === "player",
      );
      const anchorX =
        (((player?.footAnchor.x ?? 0) - entry.crop.x) / entry.crop.width) * 100;
      const anchorY =
        (((player?.footAnchor.y ?? 0) - entry.crop.y) / entry.crop.height) *
        100;
      return `<figure><div class="frame"><img src="${entry.closeup}" alt="close-up at tick ${entry.tick}"><span class="anchor" style="left:${anchorX}%;top:${anchorY}%"></span></div><figcaption>tick ${entry.tick} · frame ${player?.frameIndex ?? "?"} · ${escapeHtml(player?.clip ?? "")}</figcaption><details><summary>Full scene</summary><img class="full" src="${entry.source}" alt="full scene at tick ${entry.tick}"></details></figure>`;
    })
    .join("");
  const report = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(scenario)} sequence</title><style>body{margin:0;padding:24px;background:#0a0d0f;color:#eee;font:14px ui-monospace,monospace}h1{margin:0 0 6px;font:32px Georgia,serif}.meta{color:#aab4ad;margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;background:#151a1c;border:1px solid #39413e;padding:6px}.frame{position:relative}.frame img,.full{display:block;width:100%;height:auto;image-rendering:auto}.anchor{position:absolute;width:11px;height:11px;border:1px solid #fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px #000}.anchor:after,.anchor:before{content:"";position:absolute;background:#fff}.anchor:after{height:1px;width:17px;left:-4px;top:4px}.anchor:before{width:1px;height:17px;left:4px;top:-4px}figcaption{padding:7px 2px 1px;color:#d9b77c;font-size:11px}details{margin-top:4px;color:#9aa6a0;font-size:10px}summary{cursor:pointer}</style></head><body><h1>${escapeHtml(scenario)}</h1><p class="meta">${escapeHtml(action)} · ${frameCount} frames · ${step} simulation tick(s) per frame · crosshair marks declared foot anchor</p><main class="grid">${figures}</main></body></html>`;
  await fs.writeFile(path.join(output, "report.html"), report);

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(report, { waitUntil: "load" });
  await page.screenshot({
    path: path.join(output, "contact-sheet.png"),
    fullPage: true,
  });

  const assessment = spawn(
    process.execPath,
    [
      "scripts/assess-sequence.mjs",
      path.join(output, "render-manifest-timeline.json"),
    ],
    {
      stdio: "inherit",
    },
  );
  const assessmentCode = await new Promise((resolve) =>
    assessment.on("exit", resolve),
  );
  if (assessmentCode !== 0)
    throw new Error(`Sequence assessment failed with code ${assessmentCode}`);
  console.log(`Captured ${frameCount} deterministic frames in ${output}`);
} finally {
  await browser.close();
  server.kill();
}
