import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  MOBILE_SCREEN_GESTURE_IDS,
  MOBILE_SCREEN_PROFILE_IDS,
  MOBILE_SCREEN_SCENARIO_IDS,
  evaluateMobileScreenEvidence,
} from "./lib/mobile-screen-evidence.mjs";
import { hashJson, sha256 } from "./lib/state-replay-evidence.mjs";

const OUTPUT = path.resolve("quality-results/mobile-screen/pres-mobile-010");
const PUBLIC_RUN_SCENARIO_ID = "run:cinder-041";
const CITY_SCENARIO_ID = "production-city-services-route";
const UNITS_PER_TILE = 1_024;
const TILE_PIXELS = 48;
const TOUCH_PULSE_MS = 70;
const VIEWPORT_LOGICAL = { width: 960, height: 540 };

const PROFILES = {
  "phone-portrait": {
    viewport: { width: 390, height: 844 },
    orientation: "portrait",
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    insets: { top: 18, right: 10, bottom: 22, left: 10 },
  },
  "phone-landscape": {
    viewport: { width: 844, height: 390 },
    orientation: "landscape",
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    insets: { top: 10, right: 18, bottom: 12, left: 18 },
  },
};

const SELECTION_LANDMARKS = {
  head: { x: 0.5, y: 0.34 },
  "weapon-hand": { x: 0.31, y: 0.6 },
  "shield-hand": { x: 0.61, y: 0.51 },
  "left-foot": { x: 0.42, y: 0.84 },
  "right-foot": { x: 0.57, y: 0.84 },
};

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
    { stdio: "ignore" },
  );
  const baseURL = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (server.exitCode !== null)
      throw new Error(
        `Mobile screen server exited with code ${server.exitCode}`,
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
  throw new Error(`Mobile screen server did not start at ${baseURL}`);
}

async function applySafeArea(page, insets) {
  await page.evaluate((values) => {
    for (const side of ["top", "right", "bottom", "left"])
      document.documentElement.style.setProperty(
        `--safe-area-inset-${side}`,
        `${values[side]}px`,
      );
  }, insets);
  await page.waitForTimeout(20);
}

function oppositeProfile(profile) {
  return profile.orientation === "portrait"
    ? PROFILES["phone-landscape"]
    : PROFILES["phone-portrait"];
}

async function inspectTargets(page, selectors, insets) {
  return page.evaluate(
    ({ selectors: selectorList, insets: safeInsets }) => {
      const safe = {
        left: safeInsets.left,
        top: safeInsets.top,
        right: innerWidth - safeInsets.right,
        bottom: innerHeight - safeInsets.bottom,
      };
      const bounds = (element) => {
        const rect = element.getBoundingClientRect();
        const center = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const contained =
          rect.left >= -0.5 &&
          rect.top >= -0.5 &&
          rect.right <= innerWidth + 0.5 &&
          rect.bottom <= innerHeight + 0.5;
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          contained,
          safeContained:
            rect.left >= safe.left - 0.5 &&
            rect.top >= safe.top - 0.5 &&
            rect.right <= safe.right + 0.5 &&
            rect.bottom <= safe.bottom + 0.5,
          hit:
            center === element || Boolean(center && element.contains(center)),
          occluded: center !== element && !element.contains(center),
        };
      };
      return selectorList.flatMap((selector) =>
        [...document.querySelectorAll(selector)]
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              element.getClientRects().length > 0
            );
          })
          .map((element, index) => ({
            id:
              element.id ||
              element.getAttribute("data-action") ||
              element.getAttribute("data-city-action") ||
              element.getAttribute("aria-label") ||
              `${element.className || selector}-${index}`,
            selector,
            ...bounds(element),
          })),
      );
    },
    { selectors, insets },
  );
}

async function selectionSubject(page) {
  return page.evaluate(async (landmarks) => {
    const element = document.querySelector(".selection-art");
    if (!element)
      return { id: "selection-hero", contained: false, landmarks: [] };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const source = style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const image = new Image();
    image.src = source ?? "";
    if (source && typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        // The geometry verdict below remains false when the source did not
        // decode; keeping the measurement is more useful than hiding it.
      }
    }
    const parsePosition = (value, axis, containerSize, imageSize) => {
      const token = value.trim().split(/\s+/)[axis] ?? "50%";
      const available = containerSize - imageSize;
      if (token === "center") return available / 2;
      if (token === "left" || token === "top") return 0;
      if (token === "right" || token === "bottom") return available;
      const numeric = Number.parseFloat(token);
      if (!Number.isFinite(numeric)) return available / 2;
      return token.endsWith("px") ? numeric : (available * numeric) / 100;
    };
    const size = style.backgroundSize;
    const scale =
      size === "cover"
        ? Math.max(
            rect.width / image.naturalWidth,
            rect.height / image.naturalHeight,
          )
        : size.match(/^auto\s+([\d.]+)%$/)
          ? (rect.height * Number(size.match(/^auto\s+([\d.]+)%$/)[1])) /
            100 /
            image.naturalHeight
          : 1;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const left =
      rect.left + parsePosition(style.backgroundPosition, 0, rect.width, width);
    const top =
      rect.top +
      parsePosition(style.backgroundPosition, 1, rect.height, height);
    const occluders = [".selection-header", ".choose"].flatMap((selector) => {
      const node = document.querySelector(selector);
      if (!node) return [];
      const bounds = node.getBoundingClientRect();
      return [
        {
          selector,
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        },
      ];
    });
    const details = Object.entries(landmarks).map(([id, point]) => {
      const x = left + point.x * width;
      const y = top + point.y * height;
      const radius = 7;
      const inside =
        image.naturalWidth > 0 &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x - radius >= 0 &&
        y - radius >= 0 &&
        x + radius <= innerWidth &&
        y + radius <= innerHeight;
      const occludedBy = occluders
        .filter(
          (occluder) =>
            x + radius > occluder.left &&
            x - radius < occluder.right &&
            y + radius > occluder.top &&
            y - radius < occluder.bottom,
        )
        .map(({ selector }) => selector);
      return {
        id,
        x,
        y,
        contained: inside && occludedBy.length === 0,
        occludedBy,
      };
    });
    return {
      id: "selection-hero",
      contained:
        details.length > 0 && details.every(({ contained }) => contained),
      landmarks: details,
      background: {
        source,
        size,
        position: style.backgroundPosition,
        width,
        height,
      },
    };
  }, SELECTION_LANDMARKS);
}

async function measureSelection(page, insets) {
  const targets = await inspectTargets(
    page,
    [".class-card", "#seed", "#begin"],
    insets,
  );
  const layout = await page.evaluate((safeInsets) => {
    const root = document.querySelector(".selection");
    const rect = root?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight,
      rootContained: Boolean(
        rect &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight,
      ),
      stageContained: Boolean(
        rect &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight,
      ),
      safeArea: {
        insets: safeInsets,
        contentContained: true,
      },
    };
  }, insets);
  return {
    layout: {
      ...layout,
      safeArea: {
        ...layout.safeArea,
        contentContained: targets.every(({ safeContained }) => safeContained),
      },
    },
    targets,
    subject: await selectionSubject(page),
  };
}

async function measureTextMetrics(page, screen) {
  return page.evaluate((screenId) => {
    const selectors = [
      "[data-ui-title]",
      ".sprite-text",
      ".move-pad small",
      ".mobile-actions button",
    ];
    const elements = [
      ...new Set(
        selectors.flatMap((selector) => [
          ...document.querySelectorAll(selector),
        ]),
      ),
    ].filter((element) => {
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0 &&
        element.getAttribute("aria-hidden") !== "true"
      );
    });
    const parseColor = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].replaceAll("/", " ").trim().split(/[ ,]+/);
      const channels = parts.slice(0, 3).map(Number);
      const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
      return channels.some((channel) => !Number.isFinite(channel))
        ? null
        : { channels, alpha: Number.isFinite(alpha) ? alpha : 1 };
    };
    const luma = (value) => {
      const color = parseColor(value);
      if (!color) return 0;
      const values = color.channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const ratio = (foreground, background) => {
      const first = luma(foreground);
      const second = luma(background);
      return (
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      );
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        style,
      };
    };
    return elements.map((element, index) => {
      const { rect, style } = visible(element);
      const isTitle = element.matches("[data-ui-title]");
      const quietSurface = Boolean(
        element.closest(
          [
            ".selection-header",
            ".selected-class",
            ".choose",
            ".class-card",
            ".begin",
            ".seed-control",
            ".hud.top",
            ".hud.bottom",
            ".mobile-controls",
            ".city-service-sheet",
            ".city-service-actions button",
          ].join(","),
        ),
      );
      let background = "rgb(9, 13, 15)";
      let hasRasterBackdrop = false;
      let hasGradientBackdrop = false;
      for (let current = element; current; current = current.parentElement) {
        const currentStyle = getComputedStyle(current);
        const backgroundColor = parseColor(currentStyle.backgroundColor);
        if (backgroundColor && backgroundColor.alpha > 0) {
          background = currentStyle.backgroundColor;
          break;
        }
        if (
          currentStyle.backgroundImage !== "none" &&
          currentStyle.backgroundImage.includes("url(")
        ) {
          hasRasterBackdrop = true;
          if (background === "rgb(9, 13, 15)") background = "rgb(17, 24, 25)";
        }
        if (
          currentStyle.backgroundImage !== "none" &&
          currentStyle.backgroundImage.includes("gradient")
        )
          hasGradientBackdrop = true;
      }
      const words = [...element.querySelectorAll(".sprite-word")];
      const wordRects = words.map((word) => {
        const wordRect = word.getBoundingClientRect();
        return {
          text: word.textContent ?? "",
          top: Math.round(wordRect.top),
          left: wordRect.left,
          right: wordRect.right,
          bottom: wordRect.bottom,
        };
      });
      const lines = new Map();
      for (const word of wordRects) {
        const line = lines.get(word.top) ?? [];
        line.push(word);
        lines.set(word.top, line);
      }
      const lastLine = [...lines.values()].at(-1) ?? [];
      const labelTokens = (element.getAttribute("aria-label") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const lastToken = labelTokens.at(-1) ?? "";
      const orphanToken =
        lines.size > 1 && lastLine.length === 1 && lastToken.length <= 2;
      const wrapValid = wordRects.every(
        (word) =>
          word.left >= rect.left - 2 &&
          word.right <= rect.right + 2 &&
          word.top >= rect.top - 2 &&
          word.bottom <= rect.bottom + 2,
      );
      return {
        id: `${screenId}:${element.id || element.className || element.tagName.toLowerCase()}:${index}`,
        screen: screenId,
        label:
          element.getAttribute("aria-label") ??
          element.textContent?.trim() ??
          "",
        fontSize: Number.parseFloat(style.fontSize),
        color: style.color,
        background,
        contrastRatio: ratio(style.color, background),
        quietField:
          isTitle || quietSurface || hasRasterBackdrop || hasGradientBackdrop,
        wrapValid,
        orphanToken,
        rect,
      };
    });
  }, screen);
}

async function measureGame(page, insets) {
  const selectors = [
    ".move-pad",
    ".mobile-actions button",
    ".skills button",
    "#city-services [data-city-action]",
  ];
  const targets = await inspectTargets(page, selectors, insets);
  const evidence = await page.evaluate(
    ({ safeInsets, targets: targetEvidence }) => {
      const root = document.querySelector(".game");
      const stage = document.querySelector(".stage");
      const canvas = document.querySelector("canvas");
      const controls = document.querySelector(".mobile-controls");
      const objective = document.querySelector("#objective");
      const counter = document.querySelector("#monsters");
      const rect = (element) => element?.getBoundingClientRect() ?? null;
      const bounds = (element) => {
        const value = rect(element);
        return value
          ? {
              left: value.left,
              top: value.top,
              right: value.right,
              bottom: value.bottom,
              width: value.width,
              height: value.height,
            }
          : null;
      };
      const viewport = { width: innerWidth, height: innerHeight };
      const stageRect = rect(stage);
      const controlsRect = rect(controls);
      const canvasRect = rect(canvas);
      const contained = (value, within = viewport) =>
        Boolean(
          value &&
          value.left >= (within.left ?? 0) - 0.5 &&
          value.top >= (within.top ?? 0) - 0.5 &&
          value.right <= (within.right ?? innerWidth) + 0.5 &&
          value.bottom <= (within.bottom ?? innerHeight) + 0.5,
        );
      const distance = (first, second) => {
        if (!first || !second) return Number.POSITIVE_INFINITY;
        return Math.hypot(
          Math.max(
            0,
            Math.max(first.left, second.left) -
              Math.min(first.right, second.right),
          ),
          Math.max(
            0,
            Math.max(first.top, second.top) -
              Math.min(first.bottom, second.bottom),
          ),
        );
      };
      const observer = window.__GAME_OBSERVE__;
      const manifest = observer?.renderManifest();
      const canvasToPage = (destination) => {
        if (!canvasRect || !manifest) return null;
        return {
          left:
            canvasRect.left +
            (destination.x / manifest.viewport.width) * canvasRect.width,
          top:
            canvasRect.top +
            (destination.y / manifest.viewport.height) * canvasRect.height,
          right:
            canvasRect.left +
            ((destination.x + destination.width) / manifest.viewport.width) *
              canvasRect.width,
          bottom:
            canvasRect.top +
            ((destination.y + destination.height) / manifest.viewport.height) *
              canvasRect.height,
        };
      };
      const actorLandmarks = (manifest?.drawCalls ?? [])
        .filter(
          ({ type, visible }) =>
            visible && (type === "player" || type === "monster"),
        )
        .map((call) => {
          const pageRect = canvasToPage(call.destinationRect);
          return {
            id: call.entityId,
            contained: contained(pageRect),
            pageRect,
            worldAnchor: call.worldAnchor,
            screenAnchor: call.screenAnchor,
          };
        });
      const objectiveRect = rect(objective);
      const objectiveArea = objectiveRect
        ? objectiveRect.width * objectiveRect.height
        : 0;
      const worldOverlapIds = (manifest?.sceneSprites ?? [])
        .filter(({ layer, visible }) => layer === "structures" && visible)
        .map(({ objectId, destinationRect }) => ({
          id: objectId,
          pageRect: canvasToPage(destinationRect),
        }))
        .concat(
          (manifest?.drawCalls ?? [])
            .filter(
              ({ type, visible }) =>
                visible && (type === "player" || type === "monster"),
            )
            .map(({ entityId, destinationRect }) => ({
              id: entityId,
              pageRect: canvasToPage(destinationRect),
            })),
        )
        .flatMap(({ id, pageRect }) => {
          if (!pageRect || !objectiveRect || objectiveArea <= 0) return [];
          const width = Math.max(
            0,
            Math.min(objectiveRect.right, pageRect.right) -
              Math.max(objectiveRect.left, pageRect.left),
          );
          const height = Math.max(
            0,
            Math.min(objectiveRect.bottom, pageRect.bottom) -
              Math.max(objectiveRect.top, pageRect.top),
          );
          return (width * height) / objectiveArea > 0.05
            ? [`objective:occludes-${id}`]
            : [];
        });
      const targetOverlaps = [];
      for (let first = 0; first < targetEvidence.length; first += 1) {
        for (
          let second = first + 1;
          second < targetEvidence.length;
          second += 1
        ) {
          const left = Math.max(
            targetEvidence[first].left,
            targetEvidence[second].left,
          );
          const right = Math.min(
            targetEvidence[first].right,
            targetEvidence[second].right,
          );
          const top = Math.max(
            targetEvidence[first].top,
            targetEvidence[second].top,
          );
          const bottom = Math.min(
            targetEvidence[first].bottom,
            targetEvidence[second].bottom,
          );
          if (right > left && bottom > top)
            targetOverlaps.push(
              `${targetEvidence[first].id}:${targetEvidence[second].id}`,
            );
        }
      }
      const layout = {
        viewport,
        document: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        overflowX: document.documentElement.scrollWidth > innerWidth,
        overflowY: document.documentElement.scrollHeight > innerHeight,
        rootContained: contained(rect(root)),
        stageContained: contained(stageRect),
        controlsVisible: Boolean(
          controls && getComputedStyle(controls).display !== "none",
        ),
        controlsContained: contained(controlsRect),
        controlsSafeContained: targetEvidence
          .filter(({ selector }) => selector !== ".skills button")
          .every(({ safeContained }) => safeContained),
        controlHeightRatio: controlsRect
          ? controlsRect.height / innerHeight
          : Number.NaN,
        hudClusterDistance: distance(rect(counter), objectiveRect),
        worldOverlapIds,
        safeArea: {
          insets: safeInsets,
          contentContained: targetEvidence
            .filter(({ selector }) => selector !== ".skills button")
            .every(({ safeContained }) => safeContained),
        },
        canvasProjection: {
          canvas: bounds(canvas),
          logicalViewport: manifest?.viewport ?? null,
          deviceScaleFactor: manifest?.viewport?.dpr ?? null,
          crop:
            canvasRect && manifest
              ? {
                  widthScale: canvasRect.width / manifest.viewport.width,
                  heightScale: canvasRect.height / manifest.viewport.height,
                  pageContained: contained(canvasRect),
                }
              : null,
        },
        orientationTargetOverlaps: targetOverlaps,
      };
      return {
        layout,
        subject: {
          id: "game-actors",
          contained:
            actorLandmarks.length > 0 &&
            actorLandmarks.every(({ contained: isContained }) => isContained),
          landmarks: actorLandmarks,
        },
        manifest: manifest
          ? {
              tick: manifest.tick,
              viewport: manifest.viewport,
              camera: manifest.camera,
              cameraMode: manifest.cameraMode,
              actorIds: manifest.drawCalls
                .filter(
                  ({ type, visible }) =>
                    visible &&
                    (type === "player" || type === "monster" || type === "npc"),
                )
                .map(({ entityId }) => entityId),
              objectiveId:
                document.querySelector("#objective")?.dataset.targetId ?? null,
            }
          : null,
        safeArea: {
          emulated: true,
          applied: ["top", "right", "bottom", "left"].every(
            (side) =>
              getComputedStyle(document.documentElement)
                .getPropertyValue(`--safe-area-inset-${side}`)
                .trim() === `${safeInsets[side]}px`,
          ),
          insets: safeInsets,
          contentContained: layout.safeArea.contentContained,
        },
      };
    },
    { safeInsets: insets, targets },
  );
  return {
    ...evidence,
    targets,
    layout: {
      ...evidence.layout,
      orientation: {
        overlap: evidence.layout.orientationTargetOverlaps.length > 0,
        targetsContained: targets.every(({ contained }) => contained),
      },
    },
  };
}

function mapRoute(map) {
  const key = (point) => `${point.x},${point.y}`;
  const queue = [{ ...map.spawn }];
  const previous = new Map([[key(map.spawn), null]]);
  let cursor = 0;
  while (cursor < queue.length && !previous.has(key(map.exit))) {
    const current = queue[cursor++];
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = key(next);
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= map.width ||
        next.y >= map.height ||
        map.tiles[next.y * map.width + next.x] !== 0 ||
        previous.has(nextKey)
      )
        continue;
      previous.set(nextKey, key(current));
      queue.push(next);
    }
  }
  const route = [];
  let active = key(map.exit);
  while (active && previous.has(active)) {
    const [x, y] = active.split(",").map(Number);
    route.push({ x, y });
    active = previous.get(active) ?? null;
  }
  return route.reverse();
}

function tileCenter(tile) {
  return {
    x: (tile.x + 0.5) * UNITS_PER_TILE,
    y: (tile.y + 0.5) * UNITS_PER_TILE,
  };
}

function cityLandmarkTarget(map) {
  const route = mapRoute(map);
  return tileCenter(route[Math.max(0, route.length - 4)] ?? map.exit);
}

async function prepareSelection(page, baseURL, insets) {
  await page.goto(`${baseURL}/?selection=1`, { waitUntil: "networkidle" });
  await page.locator(".selection-art").waitFor({ state: "visible" });
  await applySafeArea(page, insets);
}

async function prepareGame(page, baseURL, scenarioId, insets) {
  await page.goto(`${baseURL}/?scenario=${scenarioId}`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  await applySafeArea(page, insets);
  const route = await page.evaluate(() => ({
    bridgeExposed: Boolean(window.__GAME_TEST__),
    mode: window.__GAME_OBSERVE__?.mode,
    scenarioId: window.__GAME_OBSERVE__?.snapshot().scenarioId,
  }));
  if (route.bridgeExposed)
    throw new Error(
      `Mobile production route ${scenarioId} exposed a mutating bridge`,
    );
  if (route.mode !== "observe-only")
    throw new Error(
      `Mobile production route is not observe-only: ${route.mode}`,
    );
  if (route.scenarioId !== scenarioId)
    throw new Error(`Mobile production route loaded ${route.scenarioId}`);
  return route;
}

async function preparePublicGame(page, baseURL, insets) {
  await prepareSelection(page, baseURL, insets);
  const ranger = page.locator("[data-class='ranger']");
  if ((await ranger.getAttribute("aria-pressed")) !== "true")
    await ranger.tap();
  await page.locator("#begin").tap();
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  await applySafeArea(page, insets);
  const route = await page.evaluate(() => ({
    bridgeExposed: Boolean(window.__GAME_TEST__),
    mode: window.__GAME_OBSERVE__?.mode,
    scenarioId: window.__GAME_OBSERVE__?.snapshot().scenarioId,
  }));
  if (route.bridgeExposed)
    throw new Error("Public mobile launch exposed a mutating bridge");
  if (route.mode !== "observe-only")
    throw new Error(`Public mobile route is not observe-only: ${route.mode}`);
  if (route.scenarioId !== PUBLIC_RUN_SCENARIO_ID)
    throw new Error(`Public mobile route loaded ${route.scenarioId}`);
  return route;
}

async function capture(page, label) {
  const frame = await page.screenshot({ animations: "disabled" });
  const observed = await page.evaluate(() => {
    const observer = window.__GAME_OBSERVE__;
    if (!observer) return { snapshot: null, manifest: null };
    return {
      snapshot: observer.snapshot(),
      manifest: observer.renderManifest(),
    };
  });
  const tick = Number(observed.snapshot?.tick ?? 0);
  return {
    label,
    tick,
    stateTick: tick,
    manifestTick: Number(observed.manifest?.tick ?? 0),
    stateHash: hashJson(observed.snapshot ?? { label, screen: true }),
    manifestHash: hashJson(observed.manifest ?? { label, screen: true }),
    frameHash: sha256(frame),
    snapshot: observed.snapshot,
    manifest: observed.manifest,
    frame,
  };
}

async function touchStart(session, bounds, id = 31) {
  const point = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, id, radiusX: 1, radiusY: 1, force: 1 }],
  });
  return point;
}

async function touchEnd(session) {
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function pressCapture(page, session, locator, label) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error(`${label} has no device bounds`);
  const point = await touchStart(session, bounds);
  await page.waitForTimeout(35);
  const pressed = await capture(page, label);
  await touchEnd(session);
  return { bounds, point, pressed };
}

async function waitForMovement(page, initial) {
  await page.waitForFunction(
    (position) => {
      const current = window.__GAME_OBSERVE__?.snapshot().player.position;
      return (
        current &&
        Math.hypot(current.x - position.x, current.y - position.y) > 0
      );
    },
    initial,
    { timeout: 2_000 },
  );
}

async function moveGesture(page, session, baseURL, insets, profileId) {
  await preparePublicGame(page, baseURL, insets);
  const before = await capture(page, `${profileId}-move-before`);
  const pad = page.locator(".move-pad");
  const bounds = await pad.boundingBox();
  if (!bounds) throw new Error("Mobile movement pad has no bounds");
  const center = await touchStart(session, bounds);
  const target = { x: center.x + bounds.width * 0.3, y: center.y };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 31, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForTimeout(35);
  const pressed = await capture(page, `${profileId}-move-pressed`);
  try {
    await waitForMovement(page, before.snapshot.player.position);
  } finally {
    await touchEnd(session);
  }
  await page.waitForTimeout(70);
  const after = await capture(page, `${profileId}-move-after`);
  return {
    id: "touch-move",
    input: { type: "touch", control: "move-pad", bounds, center, target },
    before,
    pressed: {
      ...pressed,
      visualChanged: pressed.frameHash !== before.frameHash,
    },
    after: {
      ...after,
      semanticOutcome:
        Math.hypot(
          after.snapshot.player.position.x - before.snapshot.player.position.x,
          after.snapshot.player.position.y - before.snapshot.player.position.y,
        ) > 0,
    },
  };
}

async function attackGesture(page, session, baseURL, insets, profileId) {
  await preparePublicGame(page, baseURL, insets);
  const before = await capture(page, `${profileId}-strike-before`);
  const attack = page.locator(".mobile-actions [data-action='attack']");
  const activation = await pressCapture(
    page,
    session,
    attack,
    `${profileId}-strike-pressed`,
  );
  await page.waitForFunction(
    (initialCount) =>
      (window.__GAME_OBSERVE__?.snapshot().eventLog ?? []).filter(
        ({ type, sourceId }) =>
          type === "attack_started" && sourceId === "player",
      ).length > initialCount,
    (before.snapshot.eventLog ?? []).filter(
      ({ type, sourceId }) =>
        type === "attack_started" && sourceId === "player",
    ).length,
    { timeout: 2_000 },
  );
  const after = await capture(page, `${profileId}-strike-after`);
  return {
    id: "touch-strike",
    input: {
      type: "touch",
      control: "mobile-actions",
      action: "attack",
      bounds: activation.bounds,
    },
    before,
    pressed: {
      ...activation.pressed,
      visualChanged: activation.pressed.frameHash !== before.frameHash,
    },
    after: { ...after, semanticOutcome: true },
  };
}

async function joystickPulse(page, session, direction) {
  const bounds = await page.locator(".move-pad").boundingBox();
  if (!bounds) throw new Error("City route has no movement pad");
  const center = await touchStart(session, bounds, 41);
  const length = Math.max(1, Math.hypot(direction.x, direction.y));
  const radius = Math.min(bounds.width, bounds.height) * 0.3;
  const target = {
    x: center.x + (direction.x / length) * radius,
    y: center.y + (direction.y / length) * radius,
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...target, id: 41, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForTimeout(TOUCH_PULSE_MS);
  await touchEnd(session);
}

function projectedDevicePoint(point, manifest, canvas) {
  const logical = {
    x:
      VIEWPORT_LOGICAL.width / 2 +
      ((point.x / UNITS_PER_TILE) * TILE_PIXELS - manifest.camera.x) *
        manifest.camera.zoom,
    y:
      VIEWPORT_LOGICAL.height / 2 +
      ((point.y / UNITS_PER_TILE) * TILE_PIXELS - manifest.camera.y) *
        manifest.camera.zoom,
  };
  return {
    x: canvas.left + (logical.x / manifest.viewport.width) * canvas.width,
    y: canvas.top + (logical.y / manifest.viewport.height) * canvas.height,
  };
}

async function cityNavigationStep(page, session, waypoint, state) {
  const projection = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")?.getBoundingClientRect();
    const controls = document
      .querySelector(".mobile-controls")
      ?.getBoundingClientRect();
    const manifest = window.__GAME_OBSERVE__?.renderManifest();
    return {
      canvas: canvas
        ? {
            left: canvas.left,
            top: canvas.top,
            width: canvas.width,
            height: canvas.height,
          }
        : null,
      controls: controls ? { top: controls.top } : null,
      manifest,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const point =
    projection.canvas && projection.manifest
      ? projectedDevicePoint(waypoint, projection.manifest, projection.canvas)
      : null;
  const visible = Boolean(
    point &&
    point.x >= 8 &&
    point.x <= projection.viewport.width - 8 &&
    point.y >= 56 &&
    point.y <= (projection.controls?.top ?? projection.viewport.height) - 8,
  );
  if (visible) {
    await page.touchscreen.tap(point.x, point.y);
    return { type: "touch-route", point };
  }
  await joystickPulse(page, session, {
    x: waypoint.x - state.player.position.x,
    y: waypoint.y - state.player.position.y,
  });
  return { type: "joystick-fallback" };
}

async function driveTo(page, session, target, complete, label) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const state = await page.evaluate(() => window.__GAME_OBSERVE__.snapshot());
    if (complete(state)) return state;
    const route = await page.evaluate((requestedTarget) => {
      const observer = window.__GAME_OBSERVE__;
      if (!observer) throw new Error("Production observer is unavailable");
      return observer.navigationRoute(requestedTarget);
    }, target);
    if (route.length === 0)
      throw new Error(`${label} has no remaining navigation route`);
    const waypoint = route[0];
    await cityNavigationStep(page, session, waypoint, state);
    await page.waitForTimeout(70);
  }
  throw new Error(`${label} exceeded its physical waypoint budget`);
}

async function cityGesture(page, session, baseURL, insets, profileId) {
  await prepareGame(page, baseURL, CITY_SCENARIO_ID, insets);
  const wilderness = await page.evaluate(() =>
    window.__GAME_OBSERVE__.snapshot(),
  );
  await driveTo(
    page,
    session,
    cityLandmarkTarget(wilderness.map),
    (state) => state.city.locationPhase !== "undiscovered",
    "discover Embercross",
  );
  const discovered = await page.evaluate(() =>
    window.__GAME_OBSERVE__.snapshot(),
  );
  await driveTo(
    page,
    session,
    tileCenter(discovered.map.exit),
    (state) => state.city.locationPhase === "inside",
    "enter Embercross",
  );
  const mara = await page.evaluate(
    () =>
      window.__GAME_OBSERVE__
        .renderManifest()
        .drawCalls.find(({ entityId }) => entityId === "npc:embercross:mara")
        ?.worldAnchor,
  );
  if (!mara) throw new Error("Embercross merchant is not manifested");
  await driveTo(
    page,
    session,
    mara,
    (state) => state.city.nearbyNpcId === "npc:embercross:mara",
    "approach Embercross merchant",
  );
  await page
    .locator("#city-services")
    .waitFor({ state: "visible", timeout: 5_000 });
  const before = await capture(page, `${profileId}-city-before`);
  const button = page.locator(
    "#city-services [data-city-action='merchant:buy-tonic']",
  );
  const activation = await pressCapture(
    page,
    session,
    button,
    `${profileId}-city-pressed`,
  );
  const receiptCount = before.snapshot.city.receipts.length;
  await page.waitForFunction(
    (initialCount) =>
      (window.__GAME_OBSERVE__?.snapshot().city.receipts ?? []).length >
      initialCount,
    receiptCount,
    { timeout: 2_000 },
  );
  const after = await capture(page, `${profileId}-city-after`);
  const city = await measureGame(page, insets);
  return {
    id: "open-city-service",
    input: {
      type: "touch",
      control: "city-services",
      action: "merchant:buy-tonic",
      bounds: activation.bounds,
    },
    before,
    pressed: {
      ...activation.pressed,
      visualChanged: activation.pressed.frameHash !== before.frameHash,
    },
    after: { ...after, semanticOutcome: true },
    city,
  };
}

async function selectionGesture(page, session, baseURL, insets, profileId) {
  await prepareSelection(page, baseURL, insets);
  const before = await capture(page, `${profileId}-selection-before`);
  const selectionEvidence = await measureSelection(page, insets);
  const ranger = page.locator("[data-class='ranger']");
  const rangerBounds = await ranger.boundingBox();
  if (!rangerBounds) throw new Error("Ranger selection target has no bounds");
  await touchStart(session, rangerBounds, 51);
  await page.waitForTimeout(35);
  await touchEnd(session);
  await expectSelected(page, "ranger");
  const selectedFrame = await page.screenshot({ animations: "disabled" });
  const begin = page.locator("#begin");
  const activation = await pressCapture(
    page,
    session,
    begin,
    `${profileId}-begin-pressed`,
  );
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__GAME_OBSERVE__?.ready));
  await applySafeArea(page, insets);
  const after = await capture(page, `${profileId}-selection-after-game`);
  return {
    id: "touch-select-begin",
    selectionEvidence,
    input: {
      type: "touch",
      controls: {
        selection: rangerBounds,
        begin: activation.bounds,
      },
    },
    before,
    pressed: {
      ...activation.pressed,
      visualChanged: activation.pressed.frameHash !== before.frameHash,
      selectionProbe: {
        frameHash: sha256(selectedFrame),
        selected: true,
      },
    },
    after: {
      ...after,
      semanticOutcome:
        after.snapshot?.player?.classId === "ranger" &&
        after.snapshot?.scenarioId === PUBLIC_RUN_SCENARIO_ID,
    },
  };
}

async function expectSelected(page, classId) {
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector(".selection")
        ?.getAttribute("data-selected-class") === expected,
    classId,
  );
}

async function orientationGesture(page, baseURL, profile, profileId) {
  await preparePublicGame(page, baseURL, profile.insets);
  const before = await capture(page, `${profileId}-rotate-before`);
  const targetProfile = oppositeProfile(profile);
  await page.setViewportSize(targetProfile.viewport);
  await applySafeArea(page, targetProfile.insets);
  const after = await capture(page, `${profileId}-rotate-after`);
  const layout = await measureGame(page, targetProfile.insets);
  return {
    gesture: {
      id: "rotate",
      input: {
        type: "viewport-transition",
        from: profile.viewport,
        to: targetProfile.viewport,
      },
      before,
      pressed: before,
      after: { ...after, orientation: targetProfile.orientation },
      fromOrientation: profile.orientation,
      toOrientation: targetProfile.orientation,
      orientationChanged: true,
    },
    orientation: {
      from: profile.orientation,
      to: targetProfile.orientation,
      before,
      after,
      overlap: layout.layout.orientation.overlap,
      targetsContained: layout.layout.orientation.targetsContained,
      layout,
    },
  };
}

function publicCapture(capture) {
  if (!capture) return null;
  return {
    label: capture.label,
    tick: capture.tick,
    stateTick: capture.stateTick,
    manifestTick: capture.manifestTick,
    stateHash: capture.stateHash,
    manifestHash: capture.manifestHash,
    frameHash: capture.frameHash,
    frameFile: capture.frameFile,
    snapshot: capture.snapshot,
    manifest: capture.manifest,
  };
}

function publicGestureCapture(capture) {
  if (!capture) return null;
  return {
    ...publicCapture(capture),
    ...(typeof capture.visualChanged === "boolean"
      ? { visualChanged: capture.visualChanged }
      : {}),
    ...(typeof capture.semanticOutcome === "boolean"
      ? { semanticOutcome: capture.semanticOutcome }
      : {}),
    ...(capture.selectionProbe
      ? { selectionProbe: capture.selectionProbe }
      : {}),
    ...(capture.orientation ? { orientation: capture.orientation } : {}),
  };
}

function publicManifestCapture(capture) {
  return {
    label: capture.label,
    tick: capture.tick,
    stateTick: capture.stateTick,
    manifestTick: capture.manifestTick,
    stateHash: capture.stateHash,
    manifestHash: capture.manifestHash,
    frameHash: capture.frameHash,
    frameFile: capture.frameFile,
    manifest: capture.manifest,
  };
}

async function normalizeProfile(raw, profileId) {
  const directory = path.join(OUTPUT, profileId);
  await fs.mkdir(directory, { recursive: true });
  const captures = [];
  const seen = new Set();
  const collect = (capture) => {
    if (!capture || seen.has(capture.label)) return;
    seen.add(capture.label);
    captures.push(capture);
  };
  collect(raw.selection.before);
  collect(raw.selection.pressed);
  collect(raw.game.initial);
  for (const gesture of raw.gestures) {
    collect(gesture.before);
    collect(gesture.pressed);
    collect(gesture.after);
  }
  collect(raw.orientation.before);
  collect(raw.orientation.after);
  collect(raw.city.before);
  collect(raw.city.pressed);
  collect(raw.city.after);
  for (const [index, current] of captures.entries()) {
    current.frameFile = `frame-${String(index).padStart(4, "0")}-${current.label.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}.png`;
    await fs.writeFile(path.join(directory, current.frameFile), current.frame);
  }
  const publicGestures = raw.gestures.map((gesture) => ({
    ...gesture,
    before: publicGestureCapture(gesture.before),
    pressed: publicGestureCapture(gesture.pressed),
    after: publicGestureCapture(gesture.after),
  }));
  const timeline = captures.map(publicCapture);
  const publicProfile = {
    profileId,
    viewport: raw.viewport,
    orientation: raw.orientation,
    deviceScaleFactor: raw.deviceScaleFactor,
    mode: raw.mode,
    bridgeExposed: raw.bridgeExposed,
    scenarioIds: raw.scenarioIds,
    safeArea: raw.safeArea,
    selection: {
      layout: raw.selection.layout,
      targets: raw.selection.targets,
      subject: raw.selection.subject,
      initial: publicCapture(raw.selection.before),
    },
    game: {
      layout: raw.game.layout,
      targets: raw.game.targets,
      subject: raw.game.subject,
      manifest: raw.game.manifest,
      initial: publicCapture(raw.game.initial),
    },
    city: {
      layout: raw.city.layout,
      targets: raw.city.targets,
      subject: raw.city.subject,
      manifest: raw.city.manifest,
      initial: publicCapture(raw.city.before),
    },
    textMetrics: raw.textMetrics,
    orientationEvidence: raw.orientation,
    gestures: publicGestures,
    timeline,
  };
  await Promise.all([
    writeJson(path.join(directory, "gesture-log.json"), publicGestures),
    writeJson(path.join(directory, "states.json"), {
      selection: publicProfile.selection,
      game: publicProfile.game,
      city: publicProfile.city,
      orientation: {
        ...raw.orientation,
        before: publicCapture(raw.orientation.before),
        after: publicCapture(raw.orientation.after),
      },
      timeline,
    }),
    writeJson(path.join(directory, "render-manifest-timeline.json"), {
      frames: captures
        .filter(({ manifest }) => manifest)
        .map(publicManifestCapture),
    }),
    writeJson(path.join(directory, "layout.json"), {
      selection: raw.selection.layout,
      game: raw.game.layout,
      city: raw.city.layout,
      orientation: raw.orientation.layout,
    }),
    writeJson(path.join(directory, "safe-area.json"), raw.safeArea),
    writeJson(path.join(directory, "text-metrics.json"), raw.textMetrics),
  ]);
  return publicProfile;
}

function negativeControls(evidence) {
  const controls = [
    {
      id: "target-undersized-or-occluded",
      expectedSignal: "touch-target-invalid",
      mutate(value) {
        value.profiles[0].game.targets[0].width = 20;
      },
    },
    {
      id: "subject-cropped",
      expectedSignal: "subject-containment-failed",
      mutate(value) {
        value.profiles[0].selection.subject.landmarks[0].contained = false;
      },
    },
    {
      id: "hud-detached",
      expectedSignal: "hud-containment-failed",
      mutate(value) {
        value.profiles[0].game.layout.hudClusterDistance = 80;
      },
    },
    {
      id: "pressed-state-suppressed",
      expectedSignal: "pressed-feedback-missing",
      mutate(value) {
        value.profiles[0].gestures.find(
          ({ id }) => id === "touch-strike",
        ).pressed.visualChanged = false;
      },
    },
    {
      id: "orientation-overlap",
      expectedSignal: "orientation-overlap-detected",
      mutate(value) {
        value.profiles[0].orientationEvidence.overlap = true;
      },
    },
    {
      id: "status-text-too-small",
      expectedSignal: "phone-text-size-below-contract",
      mutate(value) {
        value.profiles[0].textMetrics[0].fontSize = 5;
      },
    },
    {
      id: "copy-low-contrast",
      expectedSignal: "phone-text-contrast-below-contract",
      mutate(value) {
        value.profiles[0].textMetrics[0].contrastRatio = 1.1;
      },
    },
    {
      id: "copy-over-ornament",
      expectedSignal: "copy-quiet-field-violated",
      mutate(value) {
        value.profiles[0].textMetrics[0].quietField = false;
      },
    },
    {
      id: "label-wrap-orphan",
      expectedSignal: "phone-copy-wrap-invalid",
      mutate(value) {
        value.profiles[0].textMetrics[0].orphanToken = true;
      },
    },
  ];
  return controls.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateMobileScreenEvidence(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      expectedSignal,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      failures: result.failures,
    };
  });
}

async function runProfile(browser, profileId, profile, baseURL) {
  const videoDirectory = path.join(OUTPUT, "video-tmp", profileId);
  await fs.mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    colorScheme: "dark",
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
    recordVideo: { dir: videoDirectory, size: profile.viewport },
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    const selection = await selectionGesture(
      page,
      session,
      baseURL,
      profile.insets,
      profileId,
    );
    const selectionEvidence = selection.selectionEvidence;
    const gameRoute = await page.evaluate(() => ({
      bridgeExposed: Boolean(window.__GAME_TEST__),
      mode: window.__GAME_OBSERVE__?.mode,
      scenarioId: window.__GAME_OBSERVE__?.snapshot().scenarioId,
    }));
    if (gameRoute.bridgeExposed)
      throw new Error("Public mobile launch exposed a mutating bridge");
    if (gameRoute.mode !== "observe-only")
      throw new Error(
        `Public mobile route is not observe-only: ${gameRoute.mode}`,
      );
    if (gameRoute.scenarioId !== PUBLIC_RUN_SCENARIO_ID)
      throw new Error(`Public mobile route loaded ${gameRoute.scenarioId}`);
    const initial = await capture(page, `${profileId}-game-initial`);
    const gameEvidence = await measureGame(page, profile.insets);
    const gameText = await measureTextMetrics(page, "game");
    const movement = await moveGesture(
      page,
      session,
      baseURL,
      profile.insets,
      profileId,
    );
    const strike = await attackGesture(
      page,
      session,
      baseURL,
      profile.insets,
      profileId,
    );
    const orientation = await orientationGesture(
      page,
      baseURL,
      profile,
      profileId,
    );
    await page.setViewportSize(profile.viewport);
    await applySafeArea(page, profile.insets);
    const cityGestureEvidence = await cityGesture(
      page,
      session,
      baseURL,
      profile.insets,
      profileId,
    );
    const cityText = await measureTextMetrics(page, "city");
    const cityEvidence = cityGestureEvidence.city;
    const selectionText = await (async () => {
      await prepareSelection(page, baseURL, profile.insets);
      return measureTextMetrics(page, "selection");
    })();
    return {
      profileId,
      viewport: profile.viewport,
      deviceOrientation: profile.orientation,
      deviceScaleFactor: profile.deviceScaleFactor,
      mode: gameRoute.mode,
      bridgeExposed: gameRoute.bridgeExposed,
      scenarioIds: [...MOBILE_SCREEN_SCENARIO_IDS],
      safeArea: {
        emulated: true,
        applied: true,
        insets: profile.insets,
        contentContained:
          selectionEvidence.layout.safeArea.contentContained &&
          gameEvidence.safeArea.contentContained &&
          cityEvidence.safeArea.contentContained,
      },
      selection: {
        ...selectionEvidence,
        gesture: selection,
        textMetrics: selectionText,
      },
      game: {
        ...gameEvidence,
        initial,
        textMetrics: gameText,
      },
      city: cityEvidence,
      textMetrics: [...selectionText, ...gameText, ...cityText],
      orientation: orientation.orientation,
      orientationGesture: orientation.gesture,
      gestures: [
        selection,
        movement,
        strike,
        orientation.gesture,
        cityGestureEvidence,
      ],
      timeline: [
        selection.before,
        selection.pressed,
        selection.after,
        initial,
        movement.before,
        movement.pressed,
        movement.after,
        strike.before,
        strike.pressed,
        strike.after,
        orientation.before,
        orientation.after,
        cityGestureEvidence.before,
        cityGestureEvidence.pressed,
        cityGestureEvidence.after,
      ],
    };
  } finally {
    const video = page.video();
    await context.close();
    const videoPath = video ? await video.path() : null;
    if (videoPath) {
      await fs.mkdir(path.join(OUTPUT, profileId), { recursive: true });
      await fs.copyFile(
        videoPath,
        path.join(OUTPUT, profileId, "mobile-screen.webm"),
      );
    }
  }
}

async function main() {
  const requestedProfiles = option("profiles", null);
  const profileIds = requestedProfiles
    ? requestedProfiles.split(",").filter((id) => id in PROFILES)
    : [...MOBILE_SCREEN_PROFILE_IDS];
  if (profileIds.length === 0)
    throw new Error("--profiles must name at least one known mobile profile");
  const port = Number(option("port", String(48_000 + (process.pid % 1_000))));
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535)
    throw new Error("--port must be an available TCP port");
  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });
  let server;
  let browser;
  try {
    const started = await startServer(port);
    server = started.server;
    browser = await chromium.launch();
    const rawProfiles = [];
    for (const profileId of profileIds)
      rawProfiles.push(
        await runProfile(
          browser,
          profileId,
          PROFILES[profileId],
          started.baseURL,
        ),
      );
    const profiles = [];
    for (const raw of rawProfiles)
      profiles.push(await normalizeProfile(raw, raw.profileId));
    await fs.rm(path.join(OUTPUT, "video-tmp"), {
      recursive: true,
      force: true,
    });
    const evidence = {
      requiredProfiles: profileIds,
      requiredScenarioIds: [...MOBILE_SCREEN_SCENARIO_IDS],
      requiredGestureIds: [...MOBILE_SCREEN_GESTURE_IDS],
      profiles,
    };
    const comparison = evaluateMobileScreenEvidence(evidence);
    const controls = negativeControls(evidence);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const metadata = {
      schemaVersion: 1,
      checkId: "PRES-MOBILE-010",
      recipeId: "recipe:pres-mobile-010",
      evaluator: "mobile-screen-contract-v1",
      scenarioIds: [...MOBILE_SCREEN_SCENARIO_IDS],
      profileIds,
      gestureIds: [...MOBILE_SCREEN_GESTURE_IDS],
      source: sourceSnapshot(),
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        node: process.version,
        browser: browser.version(),
        packageVersion: packageJson.version,
        playwright: packageJson.devDependencies["@playwright/test"],
        vite: packageJson.devDependencies.vite,
      },
      reproductionCommand: "npm run test:mobile-screen",
    };
    await Promise.all([
      writeJson(path.join(OUTPUT, "mobile-screen.json"), evidence),
      writeJson(path.join(OUTPUT, "comparison.json"), {
        schemaVersion: 1,
        evaluator: "mobile-screen-contract-v1",
        comparison,
        negativeControls: controls,
      }),
      writeJson(path.join(OUTPUT, "metadata.json"), metadata),
    ]);
    if (
      !comparison.pass ||
      controls.some(({ status }) => status !== "DETECTED")
    )
      throw new Error(
        `PRES-MOBILE-010 failed: ${[
          ...comparison.failures,
          ...controls
            .filter(({ status }) => status !== "DETECTED")
            .map(({ id }) => `${id}-not-detected`),
        ].join(", ")}`,
      );
    console.log(
      `PRES-MOBILE-010 PASS: ${profileIds.length} phone profiles, ${MOBILE_SCREEN_GESTURE_IDS.length} gesture/orientation records, five signals, and nine negative controls detected`,
    );
    console.log(`Evidence: ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await browser?.close();
    server?.kill();
  }
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
