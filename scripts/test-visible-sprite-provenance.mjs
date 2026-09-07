import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  evaluateVisibleSpriteProvenanceEvidence,
  collectCampaignCopyFacts,
  runVisibleSpriteProvenanceNegativeControls,
  VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS,
  VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS,
} from "./lib/visible-sprite-provenance-evidence.mjs";
import { sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve(
  "quality-results/visible-sprite-provenance/pres-sprite-009",
);
const EVALUATOR = "visible-dom-sprite-provenance-v2";
const TITLE_ALLOWLIST = [
  "Atlas failed.",
  "Arcanist",
  "Cinderwake",
  "CINDERWAKE",
  "Cinders quieted.",
  "Ranger",
  "Run ended.",
  "Test lab",
  "Vanguard",
];
const DEBUG = process.argv.includes("--debug");

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

const CATALOG_ASSET_FILES = {
  "atlas:actor:vanguard": "actor-vanguard.png",
  "atlas:actor:ranger": "actor-ranger.png",
  "atlas:actor:arcanist": "actor-arcanist.png",
  "atlas:actor:ashfang": "actor-ashfang.png",
  "atlas:actor:hexer": "actor-hexer.png",
  "atlas:actor:stonekin": "actor-stonekin.png",
  "atlas:terrain": "environment-terrain.png",
  "atlas:ground": "environment-ground.png",
  "atlas:floor": "environment-floor.png",
  "atlas:structures": "environment-structures.png",
  "atlas:props": "environment-props.png",
  "atlas:decals": "environment-decals.png",
  "atlas:environment-kit-v2": "environment-kit-v2.png",
  "atlas:embercross-city-kit-v1": "embercross-city-kit-v1.png",
  "atlas:embercross-residents-idle-v1": "embercross-residents-idle-v1.png",
  "atlas:effects": "effects.png",
  "atlas:loot": "loot.png",
  "atlas:ui": "ui.png",
  "atlas:ui:service-panel": "ui-service-panel.png",
  "atlas:ui:service-button": "ui-service-button.png",
  "atlas:ui:service-field": "ui-service-field.png",
  "atlas:glyphs": "glyphs.png",
};

const CATALOG_ASSETS = Object.entries(CATALOG_ASSET_FILES).map(
  ([assetId, fileName]) => ({
    assetId,
    url: `/assets/sprites/${fileName}`,
  }),
);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
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
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  const baseURL = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (server.exitCode !== null)
      throw new Error(
        `Sprite provenance server exited with ${server.exitCode}`,
      );
    try {
      const response = await fetch(baseURL);
      if (response.ok && (await response.text()).includes("Cinderwake"))
        return { server, baseURL };
    } catch {
      // Vite is still starting.
    }
  }
  stopServer(server);
  throw new Error(`Sprite provenance server did not start at ${baseURL}`);
}

function stopServer(server) {
  if (server.exitCode !== null) return;
  if (process.platform === "win32") server.kill();
  else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill();
    }
  }
}

async function waitForSelection(page) {
  await page.locator(".selection").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function waitForGame(page, testMode) {
  await page.locator("canvas:not(.mini)").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForFunction(
    (isTestMode) =>
      isTestMode
        ? Boolean(window.__GAME_TEST__?.ready)
        : Boolean(window.__GAME_OBSERVE__?.ready),
    testMode,
    { timeout: 30_000 },
  );
  const route = await page.evaluate(() => ({
    bridgeExposed: Boolean(window.__GAME_TEST__),
    mode: window.__GAME_OBSERVE__?.mode ?? null,
  }));
  if (testMode && !route.bridgeExposed)
    throw new Error("Test provenance route did not expose its bridge");
  if (!testMode && (route.bridgeExposed || route.mode !== "observe-only"))
    throw new Error("Production provenance route was not observe-only");
}

async function waitForFrame(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

async function installCanvasInstrumentation(page) {
  await page.evaluate(() => {
    if (window.__VISIBLE_SPRITE_CANVAS__) return;
    const records = [];
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.drawImage;
    prototype.drawImage = function (...args) {
      const source = args[0];
      let provenance;
      if (source instanceof HTMLImageElement) {
        provenance = {
          kind: "decoded-raster",
          assetUrl: source.currentSrc || source.src,
        };
      } else if (source instanceof HTMLCanvasElement) {
        provenance = {
          kind: "canvas-copy",
          source:
            source === document.querySelector("canvas:not(.mini)")
              ? "game-canvas"
              : "other-canvas",
        };
      } else {
        provenance = { kind: "unknown-canvas-source" };
      }
      records.push({
        id: `canvas:drawImage:${records.length}`,
        visible: true,
        operation: "drawImage",
        provenance,
      });
      return Reflect.apply(original, this, args);
    };
    window.__VISIBLE_SPRITE_CANVAS__ = {
      reset() {
        records.splice(0);
      },
      read() {
        return records.map((record) => structuredClone(record));
      },
    };
  });
}

function safeFilePart(value) {
  return String(value).replaceAll(/[^a-zA-Z0-9_-]+/g, "-");
}

async function collectState(
  page,
  profileDirectory,
  scenarioId,
  stateId,
  testMode,
) {
  await page.evaluate(() => window.__VISIBLE_SPRITE_CANVAS__?.reset());
  if (testMode) await page.evaluate(() => window.__GAME_TEST__?.render());
  else await waitForFrame(page);
  const nativeCopyByIndex = await page.evaluate(collectCampaignCopyFacts);
  const inventory = await page.evaluate(
    ({ requestedScenarioId, requestedStateId, nativeCopyByIndex }) => {
      const visible = (element) => {
        let current = element;
        while (current) {
          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          )
            return false;
          current = current.parentElement;
        }
        const rect = element.getBoundingClientRect();
        return (
          element.getClientRects().length > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const absoluteLocalUrl = (value) => {
        if (typeof value !== "string" || !value) return null;
        try {
          const url = new URL(value, location.href);
          return url.pathname.startsWith("/assets/") ? url.href : null;
        } catch {
          return null;
        }
      };
      const urlsIn = (value) => {
        if (typeof value !== "string") return [];
        return [...value.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/g)]
          .map((match) => absoluteLocalUrl(match[1] || match[2] || match[3]))
          .filter(Boolean);
      };
      const rasterUrls = (element) => {
        const urls = [];
        for (const candidate of [element, ...element.querySelectorAll("*")]) {
          const style = getComputedStyle(candidate);
          for (const value of [style.backgroundImage, style.borderImageSource])
            urls.push(...urlsIn(value));
        }
        return [...new Set(urls)];
      };
      const elementId = (element, index) => {
        const className =
          typeof element.className === "string"
            ? element.className
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 3)
                .join(".")
            : "";
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${className ? `.${className}` : ""}[${index}]`;
      };
      const roleElements = [...document.querySelectorAll("[data-sprite-role]")];
      const visibleRoles = roleElements.map((element, index) => {
        const dataRole = element.getAttribute("data-sprite-role");
        const canvasSurface = element.tagName === "CANVAS";
        const urls = rasterUrls(element);
        const nativeSurface =
          element.matches("[data-native-ui]") &&
          element.closest("main[data-ui-copy='interface']")?.parentElement
            ?.id === "app";
        const role = canvasSurface || nativeSurface ? "layout" : "sprite";
        const result = {
          id: elementId(element, index),
          visible: visible(element),
          role,
          dataRole,
          rasterUrls: urls,
        };
        if (role === "sprite" && urls[0])
          result.provenance = { kind: "decoded-raster", assetUrl: urls[0] };
        return result;
      });
      const textNodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let textNode = walker.nextNode();
      let textIndex = 0;
      while (textNode) {
        const value = textNode.textContent?.trim() ?? "";
        const parent = textNode.parentElement;
        if (value && parent)
          textNodes.push({
            id: `text:${parent.tagName.toLowerCase()}[${textIndex}]`,
            value,
            visible: visible(parent),
            titleRole: Boolean(parent.closest("[data-ui-title]")),
            ...(nativeCopyByIndex[textIndex]
              ? { nativeCopy: nativeCopyByIndex[textIndex] }
              : {}),
          });
        textIndex += 1;
        textNode = walker.nextNode();
      }
      const pseudoElements = [];
      const nativeUiSurfaces = [
        ...document.querySelectorAll("[data-ui-copy]"),
      ].map((element, index) => {
        const style = getComputedStyle(element);
        return {
          id: elementId(element, index),
          visible: visible(element),
          kind: "native-campaign-ui",
          scope: element.getAttribute("data-ui-copy"),
          tag: element.tagName,
          label: element.getAttribute("aria-label"),
          styles: {
            backgroundColor: style.backgroundColor,
            border: style.border,
            boxShadow: style.boxShadow,
            fontSize: style.fontSize,
            overflowY: style.overflowY,
          },
        };
      });
      for (const element of document.querySelectorAll("*")) {
        if (!visible(element)) continue;
        for (const pseudo of ["::before", "::after"]) {
          const style = getComputedStyle(element, pseudo);
          const hasVisual =
            (style.content !== "none" && style.content !== '""') ||
            style.backgroundImage !== "none" ||
            style.borderTopStyle !== "none" ||
            style.borderRightStyle !== "none" ||
            style.borderBottomStyle !== "none" ||
            style.borderLeftStyle !== "none" ||
            style.boxShadow !== "none";
          if (!hasVisual) continue;
          const allowed =
            Boolean(
              element.closest("[data-provenance-decoration='legibility-mask']"),
            ) ||
            (element.matches("[data-native-ui]") &&
              element.closest("main[data-ui-copy='interface']")?.parentElement
                ?.id === "app");
          pseudoElements.push({
            id: `${elementId(element, 0)}${pseudo}`,
            visible: true,
            ownerRole: element.getAttribute("data-sprite-role"),
            styles: {
              content: style.content,
              backgroundImage: style.backgroundImage,
              boxShadow: style.boxShadow,
            },
            provenance: allowed
              ? { kind: "declared-composition", allowed: true }
              : { kind: "css-decoration" },
          });
        }
      }
      const cssDecorations = [];
      for (const [index, element] of roleElements.entries()) {
        if (!visible(element) || element.tagName === "CANVAS") continue;
        const style = getComputedStyle(element);
        const declared =
          element.getAttribute("data-css-decoration-contract") === "declared" ||
          (element.matches("[data-native-ui]") &&
            element.closest("main[data-ui-copy='interface']")?.parentElement
              ?.id === "app");
        const details = [];
        if (style.backgroundImage.includes("gradient"))
          details.push({ kind: "gradient", value: style.backgroundImage });
        if (
          style.borderImageSource !== "none" &&
          !urlsIn(style.borderImageSource).length
        )
          details.push({
            kind: "border-image",
            value: style.borderImageSource,
          });
        if (style.boxShadow !== "none")
          details.push({ kind: "box-shadow", value: style.boxShadow });
        if (style.filter !== "none")
          details.push({ kind: "filter", value: style.filter });
        for (const detail of details)
          cssDecorations.push({
            id: `css:${elementId(element, index)}:${detail.kind}`,
            visible: true,
            ...detail,
            provenance: declared
              ? { kind: "declared-composition", allowed: true }
              : { kind: "css-decoration" },
          });
      }
      const manifest =
        window.__GAME_TEST__?.renderManifest() ??
        window.__GAME_OBSERVE__?.renderManifest() ??
        null;
      const liveState =
        window.__GAME_TEST__?.snapshot() ??
        window.__GAME_OBSERVE__?.snapshot() ??
        null;
      const manifestDraws = [];
      const addManifestDraw = (reference, id, visibleOverride) => {
        if (!reference || typeof reference !== "object") return;
        manifestDraws.push({
          id,
          visible:
            visibleOverride === undefined
              ? reference.visible !== false
              : visibleOverride,
          renderMode: reference.renderMode,
          spriteId: reference.spriteId,
          assetId: reference.assetId,
        });
      };
      const addCombatTelegraphDraw = (paint) => {
        const telegraph = paint?.telegraph;
        if (!telegraph || typeof telegraph !== "object") {
          manifestDraws.push({
            id: paint?.paintId ?? null,
            visible: true,
            role: "combat-telegraph",
            paintRole: null,
          });
          return;
        }
        manifestDraws.push({
          id: paint.paintId,
          visible: telegraph.visible !== false,
          role: "combat-telegraph",
          paintRole: telegraph.paintRole,
          layer: telegraph.layer,
          attackId: telegraph.attackId,
          ownerId: telegraph.ownerId,
          worldCenter: telegraph.worldCenter,
          radius: telegraph.radius,
          impactTick: telegraph.impactTick,
          projectedBounds: telegraph.projectedBounds,
        });
      };
      if (Array.isArray(manifest?.paintQueue))
        for (const paint of manifest.paintQueue) {
          if (paint.kind === "scene")
            addManifestDraw(paint.scene, paint.paintId);
          else if (
            paint.kind === "actor-shadow" ||
            paint.kind === "entity-body"
          )
            addManifestDraw(paint.call, paint.paintId);
          else if (
            paint.kind === "health-frame" ||
            paint.kind === "health-fill"
          )
            addManifestDraw(
              paint.worldUi?.[paint.kind === "health-frame" ? "frame" : "fill"],
              paint.paintId,
              paint.worldUi?.visible,
            );
          else if (paint.kind === "combat-telegraph")
            addCombatTelegraphDraw(paint);
        }
      if (!manifestDraws.length) {
        for (const draw of manifest?.drawCalls ?? [])
          addManifestDraw(draw, `draw:${draw.entityId}`);
        for (const sprite of manifest?.sceneSprites ?? [])
          addManifestDraw(sprite, `scene:${sprite.objectId}`);
        for (const worldUi of manifest?.worldUi ?? []) {
          addManifestDraw(
            worldUi.frame,
            `${worldUi.id}:frame`,
            worldUi.visible,
          );
          addManifestDraw(worldUi.fill, `${worldUi.id}:fill`, worldUi.visible);
        }
      }
      return {
        scenarioId: requestedScenarioId,
        stateId: requestedStateId,
        visibleRoles,
        textNodes,
        nativeUiSurfaces,
        pseudoElements,
        cssDecorations,
        canvasOperations: window.__VISIBLE_SPRITE_CANVAS__?.read() ?? [],
        manifestDraws,
        manifestSummary: manifest
          ? {
              schemaVersion: manifest.schemaVersion,
              spriteCatalogRevision: manifest.spriteCatalogRevision,
              tick: manifest.tick,
              paintCount: manifest.paintQueue?.length ?? 0,
            }
          : null,
        combatState: liveState
          ? {
              tick: liveState.tick,
              pendingAttacks: (liveState.pendingAttacks ?? []).map(
                ({ id, ownerId, kind, impactTick, origin, range }) => ({
                  id,
                  ownerId,
                  kind,
                  impactTick,
                  origin,
                  range,
                }),
              ),
              monsters: (liveState.monsters ?? []).map(
                ({ id, kind, elite, health }) => ({ id, kind, elite, health }),
              ),
            }
          : null,
      };
    },
    {
      requestedScenarioId: scenarioId,
      requestedStateId: stateId,
      nativeCopyByIndex,
    },
  );
  const screenshotDirectory = path.join(profileDirectory, "screenshots");
  await fs.mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = path.join(
    screenshotDirectory,
    `${safeFilePart(scenarioId)}-${safeFilePart(stateId)}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return {
    ...inventory,
    screenshot: path.relative(process.cwd(), screenshotPath),
  };
}

function localPath(value) {
  try {
    return new URL(value, "http://sprite-provenance.invalid").pathname;
  } catch {
    return null;
  }
}

async function decodeAssets(page, states) {
  const requested = [
    ...CATALOG_ASSETS.map(({ url }) => url),
    ...states.flatMap((state) =>
      state.visibleRoles.flatMap(({ rasterUrls }) => rasterUrls),
    ),
  ];
  const urls = [
    ...new Set(
      requested.map(localPath).filter((value) => value?.startsWith("/assets/")),
    ),
  ];
  const decoded = await page.evaluate(async (requestedUrls) => {
    const decode = (url) =>
      new Promise((resolve) => {
        const image = new Image();
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            url,
            width: image.naturalWidth,
            height: image.naturalHeight,
            decoded: image.naturalWidth > 0 && image.naturalHeight > 0,
          });
        };
        image.onload = finish;
        image.onerror = finish;
        image.src = new URL(url, location.href).href;
        if (image.complete) queueMicrotask(finish);
      });
    return Promise.all(requestedUrls.map(decode));
  }, urls);
  const catalogByPath = new Map(
    CATALOG_ASSETS.map(({ assetId, url }) => [localPath(url), assetId]),
  );
  return decoded.map((asset) => ({
    ...asset,
    ...(catalogByPath.has(localPath(asset.url))
      ? { assetId: catalogByPath.get(localPath(asset.url)) }
      : {}),
  }));
}

async function driveTestToCityServices(page) {
  const history = [];
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const current = await page.evaluate(() => window.__GAME_TEST__.snapshot());
    if (
      current.city.locationPhase === "inside" &&
      current.city.nearbyNpcId === "npc:embercross:mara"
    )
      return history;
    let target;
    if (current.city.locationPhase !== "inside") {
      target = {
        x: (current.map.exit.x + 0.5) * 1_024,
        y: (current.map.exit.y + 0.5) * 1_024,
      };
    } else {
      target = await page.evaluate(() => {
        const call = window.__GAME_OBSERVE__
          .renderManifest()
          .drawCalls.find(({ entityId }) => entityId === "npc:embercross:mara");
        if (!call)
          throw new Error("Embercross services route has no Mara draw");
        return call.worldAnchor;
      });
    }
    const route = await page.evaluate(
      (requestedTarget) =>
        window.__GAME_OBSERVE__.navigationRoute(requestedTarget),
      target,
    );
    if (!route.length)
      throw new Error(
        `Embercross services route stalled: ${JSON.stringify({
          phase: current.city.locationPhase,
          player: current.player.position,
          target,
        })}`,
      );
    const waypoint = route[0];
    const before = current.player.position;
    await page.evaluate((requestedWaypoint) => {
      const state = window.__GAME_TEST__.snapshot();
      window.__GAME_TEST__.setInput({
        moveX: Math.sign(requestedWaypoint.x - state.player.position.x),
        moveY: Math.sign(requestedWaypoint.y - state.player.position.y),
      });
      window.__GAME_TEST__.step(8, { render: true });
      window.__GAME_TEST__.clearInput();
    }, waypoint);
    const after = await page.evaluate(() => window.__GAME_TEST__.snapshot());
    history.push({
      attempt,
      phase: current.city.locationPhase,
      before,
      waypoint,
      after: after.player.position,
      afterPhase: after.city.locationPhase,
      nearbyNpcId: after.city.nearbyNpcId,
      routeLength: route.length,
    });
    if (DEBUG)
      console.log(
        `[city] ${attempt} ${current.city.locationPhase} -> ${after.city.locationPhase} nearby=${after.city.nearbyNpcId ?? "none"}`,
      );
  }
  throw new Error(
    "Embercross services route exceeded 320 deterministic waypoints",
  );
}

async function runProfile(browser, profileId, profile, baseURL) {
  const profileDirectory = path.join(OUTPUT, profileId);
  await fs.mkdir(profileDirectory, { recursive: true });
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  const states = [];
  try {
    await page.goto(`${baseURL}/?selection=1`, {
      waitUntil: "domcontentloaded",
    });
    await waitForSelection(page);
    await installCanvasInstrumentation(page);
    states.push(
      await collectState(
        page,
        profileDirectory,
        "public-selection",
        "selection",
        false,
      ),
    );

    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await waitForSelection(page);
    await installCanvasInstrumentation(page);
    await page.locator("#begin").click();
    await waitForGame(page, false);
    states.push(
      await collectState(
        page,
        profileDirectory,
        "ordinary-production-launch",
        "gameplay",
        false,
      ),
    );
    await page.locator("[data-journal]").click();
    await page.locator("dialog.campaign-dialog").waitFor({ state: "visible" });
    states.push(
      await collectState(
        page,
        profileDirectory,
        "campaign-journal",
        "open-journal",
        false,
      ),
    );
    await page.locator("dialog.campaign-dialog [data-close]").click();

    await page.goto(`${baseURL}/?testMode=1&scenario=animation-idle`, {
      waitUntil: "domcontentloaded",
    });
    await waitForGame(page, true);
    await installCanvasInstrumentation(page);
    await page.locator(".game > .lab-toggle").click();
    await page.locator(".lab").waitFor({ state: "visible" });
    states.push(
      await collectState(
        page,
        profileDirectory,
        "ordinary-production-launch",
        "test-lab",
        true,
      ),
    );

    await page.goto(`${baseURL}/?testMode=1&scenario=temporal-run-win`, {
      waitUntil: "domcontentloaded",
    });
    await waitForGame(page, true);
    await installCanvasInstrumentation(page);
    await page.evaluate(() => {
      window.__GAME_TEST__.loadScenario("temporal-run-win");
      window.__GAME_TEST__.render();
    });
    await page.locator("#outcome").waitFor({ state: "visible" });
    states.push(
      await collectState(
        page,
        profileDirectory,
        "outcome-win",
        "terminal",
        true,
      ),
    );

    await page.goto(`${baseURL}/?testMode=1&scenario=temporal-run-loss`, {
      waitUntil: "domcontentloaded",
    });
    await waitForGame(page, true);
    await installCanvasInstrumentation(page);
    await page.evaluate(() => {
      window.__GAME_TEST__.loadScenario("temporal-run-loss");
      window.__GAME_TEST__.step(48, { render: true });
    });
    await page.locator("#outcome").waitFor({ state: "visible" });
    states.push(
      await collectState(
        page,
        profileDirectory,
        "outcome-loss",
        "terminal",
        true,
      ),
    );

    await page.goto(
      `${baseURL}/?testMode=1&scenario=production-city-services-route`,
      { waitUntil: "domcontentloaded" },
    );
    await waitForGame(page, true);
    await installCanvasInstrumentation(page);
    const routeHistory = await driveTestToCityServices(page);
    await page.locator("#city-services").waitFor({ state: "visible" });
    const serviceState = await collectState(
      page,
      profileDirectory,
      "embercross-services",
      "mara-services",
      true,
    );
    serviceState.routeHistory = routeHistory;
    states.push(serviceState);

    const decodedAssets = await decodeAssets(page, states);
    await writeJson(path.join(profileDirectory, "states.json"), states);
    return { profileId, decodedAssets, states };
  } finally {
    await context.close();
  }
}

async function main() {
  const port = Number(option("port", 4179));
  const source = sourceSnapshot();
  const { server, baseURL } = await startServer(port);
  const browser = await chromium.launch();
  try {
    const profiles = [];
    for (const profileId of VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS) {
      const result = await runProfile(
        browser,
        profileId,
        PROFILES[profileId],
        baseURL,
      );
      profiles.push(result);
      if (DEBUG)
        console.log(
          `[${profileId}] ${result.states.length} states, ${result.decodedAssets.length} decoded assets`,
        );
    }
    const evidence = {
      schemaVersion: 1,
      evaluator: EVALUATOR,
      requiredProfiles: [...VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS],
      requiredScenarioIds: [...VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS],
      titleAllowlist: TITLE_ALLOWLIST,
      profiles,
    };
    const comparison = evaluateVisibleSpriteProvenanceEvidence(evidence);
    const negativeControls =
      runVisibleSpriteProvenanceNegativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-SPRITE-009",
      recipeId: "recipe:pres-sprite-009",
      evaluator: EVALUATOR,
      scenarioIds: [...VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS],
      actualStateIds: profiles.flatMap(({ states }) =>
        states.map(({ scenarioId, stateId }) => `${scenarioId}:${stateId}`),
      ),
      profileIds: [...VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS],
      titleAllowlist: TITLE_ALLOWLIST,
      source,
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:sprite-provenance",
    };
    await fs.mkdir(OUTPUT, { recursive: true });
    await writeJson(path.join(OUTPUT, "metadata.json"), metadata);
    await writeJson(path.join(OUTPUT, "evidence.json"), evidence);
    await writeJson(path.join(OUTPUT, "comparison.json"), {
      schemaVersion: 1,
      evaluator: EVALUATOR,
      comparison,
      negativeControls,
    });
    await writeJson(
      path.join(OUTPUT, "negative-controls.json"),
      negativeControls,
    );
    const controlsPass = negativeControls.every(
      ({ status }) => status === "DETECTED",
    );
    console.log(
      `PRES-SPRITE-009 ${comparison.pass && controlsPass ? "PASS" : "FAIL"}: ${profiles.length} profiles, ${comparison.inventories.length} states, ${negativeControls.length} negative controls`,
    );
    if (!comparison.pass) console.error(JSON.stringify(comparison.failures));
    if (!controlsPass) console.error(JSON.stringify(negativeControls));
    process.exitCode = comparison.pass && controlsPass ? 0 : 1;
  } finally {
    await browser.close();
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
