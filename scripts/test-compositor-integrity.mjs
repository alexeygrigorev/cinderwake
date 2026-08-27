import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  evaluateCompositorEvidence,
  runCompositorNegativeControls,
} from "./lib/compositor-evidence.mjs";
import {
  SPRITE_LEAK_ALPHA_THRESHOLD,
  assessSpriteLeakSample,
  evaluateSpriteLeakAssessments,
  runSpriteLeakNegativeControls,
} from "./lib/sprite-leak-evidence.mjs";

const OUTPUT = path.resolve("quality-results/compositor/pres-leak-012");
const VIEWPORT = { width: 960, height: 540 };
const ATLAS_DIRECTORY = path.resolve("public/assets/sprites");
const LEAK_POLICY = JSON.parse(
  await fs.readFile("quality/sprite-leak-policy.v1.json", "utf8"),
);

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

function pixelHasInk(rgba) {
  for (let offset = 3; offset < rgba.length; offset += 4)
    if (rgba[offset] >= SPRITE_LEAK_ALPHA_THRESHOLD) return true;
  return false;
}

function extractCell(data, atlasWidth, cellWidth, cellHeight, column, row) {
  const rgba = Buffer.alloc(cellWidth * cellHeight * 4);
  for (let y = 0; y < cellHeight; y += 1) {
    const sourceStart =
      ((row * cellHeight + y) * atlasWidth + column * cellWidth) * 4;
    rgba.set(
      data.subarray(sourceStart, sourceStart + cellWidth * 4),
      y * cellWidth * 4,
    );
  }
  return rgba;
}

async function collectSpriteLeakCorpus() {
  if (
    LEAK_POLICY.alphaThreshold !== SPRITE_LEAK_ALPHA_THRESHOLD ||
    !Array.isArray(LEAK_POLICY.contracts) ||
    LEAK_POLICY.contracts.length === 0
  )
    throw new Error(
      "sprite leak policy is invalid or disagrees with evaluator",
    );

  const assessments = [];
  const representatives = [];
  const contractSummaries = [];
  for (const contract of LEAK_POLICY.contracts) {
    let sampleCount = 0;
    let firstSample;
    for (const file of contract.files ?? []) {
      const filePath = path.join(ATLAS_DIRECTORY, file);
      const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cellWidth = contract.cell?.width;
      const cellHeight = contract.cell?.height;
      if (
        !Number.isInteger(cellWidth) ||
        !Number.isInteger(cellHeight) ||
        info.width % cellWidth !== 0 ||
        info.height % cellHeight !== 0
      )
        throw new Error(`${file} dimensions do not contain whole policy cells`);
      for (let row = 0; row < info.height / cellHeight; row += 1) {
        for (let column = 0; column < info.width / cellWidth; column += 1) {
          const rgba = extractCell(
            data,
            info.width,
            cellWidth,
            cellHeight,
            column,
            row,
          );
          if (!pixelHasInk(rgba)) continue;
          const sample = {
            id: `${contract.id}:${file}:${row}:${column}`,
            width: cellWidth,
            height: cellHeight,
            rgba,
            cell: {
              x: column * cellWidth,
              y: row * cellHeight,
              width: cellWidth,
              height: cellHeight,
            },
            sourceRect: {
              x: column * cellWidth,
              y: row * cellHeight,
              width: cellWidth,
              height: cellHeight,
            },
            transparentBorder: { ...contract.transparentBorder },
          };
          assessments.push(assessSpriteLeakSample(sample));
          sampleCount += 1;
          if (!firstSample) firstSample = sample;
        }
      }
    }
    if (!firstSample)
      throw new Error(`${contract.id} has no nonblank raster samples`);
    representatives.push({ contractId: contract.id, sample: firstSample });
    contractSummaries.push({
      id: contract.id,
      files: [...(contract.files ?? [])],
      nonblankSampleCount: sampleCount,
    });
  }
  return {
    assessment: evaluateSpriteLeakAssessments(assessments),
    representatives,
    contractSummaries,
  };
}

function checkerboardSvg(width, height) {
  const half = width / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="dark" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#243238"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#34464c"/></pattern><pattern id="light" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#d6c69e"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#b2a37c"/></pattern></defs><rect width="${half}" height="${height}" fill="url(#dark)"/><rect x="${half}" width="${half}" height="${height}" fill="url(#light)"/></svg>`,
  );
}

async function writeCheckerboardArtifacts(representatives) {
  const artifacts = {};
  for (const { contractId, sample } of representatives) {
    const file = `checkerboard-${contractId}.png`;
    const background = checkerboardSvg(sample.width * 2, sample.height);
    const sprite = await sharp(sample.rgba, {
      raw: { width: sample.width, height: sample.height, channels: 4 },
    })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: sample.width * 2,
        height: sample.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([
        { input: background },
        { input: sprite, left: 0, top: 0 },
        { input: sprite, left: sample.width, top: 0 },
      ])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUTPUT, file));
    artifacts[contractId] = file;
  }
  return artifacts;
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
    const spriteLeak = await collectSpriteLeakCorpus();
    const checkerboardArtifacts = await writeCheckerboardArtifacts(
      spriteLeak.representatives,
    );
    const compositor = evaluateCompositorEvidence(evidence);
    const comparison = {
      pass: spriteLeak.assessment.pass && compositor.pass,
      failures: [
        ...new Set([...spriteLeak.assessment.failures, ...compositor.failures]),
      ],
      signals: [
        ...spriteLeak.assessment.signals,
        {
          id: "no-stale-or-duplicate-body",
          pass: compositor.pass,
          detail: {
            signals: compositor.signals,
          },
        },
      ],
    };
    const compositorControls = runCompositorNegativeControls(evidence).filter(
      ({ id }) =>
        id === "prior-frame-not-cleared" || id === "duplicate-body-draw",
    );
    const controls = [
      ...runSpriteLeakNegativeControls(spriteLeak.representatives[0].sample),
      ...compositorControls,
    ];
    const source = sourceSnapshot();
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-LEAK-012",
      recipeId: "recipe:pres-leak-012",
      evaluator: "sprite-leak-and-ghost-v1",
      scenarioIds: [
        "animation-idle",
        "combat-loot",
        "registered-raster-corpus",
      ],
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
        evaluator: "sprite-leak-and-ghost-v1",
        evidence,
        spriteLeak: {
          policyId: LEAK_POLICY.id,
          alphaThreshold: LEAK_POLICY.alphaThreshold,
          contracts: spriteLeak.contractSummaries,
          assessment: spriteLeak.assessment,
          checkerboardArtifacts,
        },
        compositor,
        comparison,
        negativeControls: controls,
      }),
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
    ]);

    if (
      !comparison.pass ||
      controls.length !== 5 ||
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
      `PRES-LEAK-012 PASS: ${spriteLeak.assessment.assessments.length} raster cells and reconstructed frames are clean, ${controls.length} leak/compositor controls detected`,
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
