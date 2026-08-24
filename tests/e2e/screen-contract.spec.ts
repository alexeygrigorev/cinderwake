import { expect, test, type Browser, type Page } from "@playwright/test";
import contract from "../../quality/screen-contract.v1.json" with { type: "json" };
import { assessOpeningComposition } from "../framework/opening-composition";

type Profile = (typeof contract.profiles)[number];
type TargetEvidence = {
  id: string;
  width: number;
  height: number;
  contained: boolean;
  hit: boolean;
};

type TerrainPixelEvidence = {
  collisionContrasts: number[];
  sameMaterialSeams: number[];
};

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function terrainPixelViolations(evidence: TerrainPixelEvidence): string[] {
  const violations: string[] = [];
  if (evidence.collisionContrasts.length < 6)
    violations.push("terrain:insufficient-collision-samples");
  else if (median(evidence.collisionContrasts) < 3)
    violations.push("terrain:collision-boundary-imperceptible");
  if (evidence.sameMaterialSeams.length < 8)
    violations.push("terrain:insufficient-material-seam-samples");
  else if (median(evidence.sameMaterialSeams) > 18)
    violations.push("terrain:scale-or-tile-seams-visible");
  return violations;
}

type TerrainMutation = "none" | "erase-collision" | "exaggerate-seams";

async function extractTerrainPixelEvidence(
  page: Page,
  mutation: TerrainMutation = "none",
): Promise<TerrainPixelEvidence> {
  return page.evaluate<TerrainPixelEvidence, TerrainMutation>((mutationId) => {
    const manifest = window.__GAME_TEST__!.render();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const raisedBounds = [
      ...manifest.sceneSprites
        .filter(({ layer, visible }) => layer !== "terrain" && visible)
        .map(({ destinationRect }) => destinationRect),
      ...manifest.drawCalls
        .filter(({ visible }) => visible)
        .map(({ destinationRect }) => destinationRect),
    ];
    const covered = (x: number, y: number) =>
      raisedBounds.some(
        (rect) =>
          x >= rect.x - 4 &&
          y >= rect.y - 4 &&
          x <= rect.x + rect.width + 4 &&
          y <= rect.y + rect.height + 4,
      );
    const directionVectors = {
      north: { x: 0, y: -1 },
      east: { x: 1, y: 0 },
      south: { x: 0, y: 1 },
      west: { x: -1, y: 0 },
    } as const;
    const collisionSamples: Array<{
      floor: { x: number; y: number };
      wall: { x: number; y: number };
    }> = [];
    for (const boundary of manifest.sceneSprites.filter(
      ({ objectId, visible }) => objectId.startsWith("boundary:") && visible,
    )) {
      const direction = boundary.objectId.split(
        ":",
      )[1] as keyof typeof directionVectors;
      const vector = directionVectors[direction];
      if (!vector) continue;
      const floor = {
        x: boundary.screenAnchor.x + vector.x * 18,
        y: boundary.screenAnchor.y + vector.y * 18,
      };
      const wall = {
        x: boundary.screenAnchor.x - vector.x * 18,
        y: boundary.screenAnchor.y - vector.y * 18,
      };
      if (covered(floor.x, floor.y) || covered(wall.x, wall.y)) continue;
      collisionSamples.push({ floor, wall });
    }

    const tileByCoordinate = new Map(
      manifest.sceneSprites
        .filter(({ objectId }) => objectId.startsWith("tile:"))
        .map((sprite) => [`${sprite.tile.x}:${sprite.tile.y}`, sprite]),
    );
    const wallCoordinates = new Set(
      manifest.sceneSprites
        .filter(({ objectId }) => objectId.startsWith("wall-overlay:"))
        .map(({ tile }) => `${tile.x}:${tile.y}`),
    );
    const seamSamples: Array<{
      first: { x: number; y: number };
      second: { x: number; y: number };
    }> = [];
    for (const tile of tileByCoordinate.values()) {
      for (const direction of [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]) {
        const neighbor = tileByCoordinate.get(
          `${tile.tile.x + direction.x}:${tile.tile.y + direction.y}`,
        );
        if (!neighbor) continue;
        const tileWall = wallCoordinates.has(`${tile.tile.x}:${tile.tile.y}`);
        const neighborWall = wallCoordinates.has(
          `${neighbor.tile.x}:${neighbor.tile.y}`,
        );
        if (tileWall !== neighborWall) continue;
        const anchor = {
          x: (tile.screenAnchor.x + neighbor.screenAnchor.x) / 2,
          y: (tile.screenAnchor.y + neighbor.screenAnchor.y) / 2,
        };
        const first = {
          x: anchor.x - direction.x * 3,
          y: anchor.y - direction.y * 3,
        };
        const second = {
          x: anchor.x + direction.x * 3,
          y: anchor.y + direction.y * 3,
        };
        if (covered(first.x, first.y) || covered(second.x, second.y)) continue;
        seamSamples.push({ first, second });
      }
    }

    const paintPatch = (
      point: { x: number; y: number },
      gray: number,
      radius: number,
    ) => {
      context.fillStyle = `rgb(${gray} ${gray} ${gray})`;
      context.fillRect(
        Math.round(point.x) - radius,
        Math.round(point.y) - radius,
        radius * 2 + 1,
        radius * 2 + 1,
      );
    };
    if (mutationId === "erase-collision")
      for (const sample of collisionSamples) {
        paintPatch(sample.floor, 64, 4);
        paintPatch(sample.wall, 64, 4);
      }
    if (mutationId === "exaggerate-seams")
      for (const sample of seamSamples) {
        paintPatch(sample.first, 0, 3);
        paintPatch(sample.second, 255, 3);
      }

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const patchLuma = (x: number, y: number, radius = 2) => {
      let sum = 0;
      let count = 0;
      for (let patchY = y - radius; patchY <= y + radius; patchY += 1) {
        for (let patchX = x - radius; patchX <= x + radius; patchX += 1) {
          if (
            patchX < 0 ||
            patchY < 0 ||
            patchX >= canvas.width ||
            patchY >= canvas.height
          )
            continue;
          const offset =
            (Math.round(patchY) * canvas.width + Math.round(patchX)) * 4;
          sum +=
            pixels[offset]! * 0.2126 +
            pixels[offset + 1]! * 0.7152 +
            pixels[offset + 2]! * 0.0722;
          count += 1;
        }
      }
      return count ? sum / count : Number.NaN;
    };
    return {
      collisionContrasts: collisionSamples
        .map(({ floor, wall }) =>
          Math.abs(patchLuma(floor.x, floor.y) - patchLuma(wall.x, wall.y)),
        )
        .filter(Number.isFinite),
      sameMaterialSeams: seamSamples
        .map(({ first, second }) =>
          Math.abs(
            patchLuma(first.x, first.y, 1) - patchLuma(second.x, second.y, 1),
          ),
        )
        .filter(Number.isFinite),
    };
  }, mutation);
}

async function contractPage(
  browser: Browser,
  profile: Profile,
): Promise<{
  context: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  errors: string[];
}> {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:43917",
    viewport: profile.viewport,
    hasTouch: profile.touch,
    isMobile: profile.touch,
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`page:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return { context, page, errors };
}

async function expectDecodedBackgrounds(page: Page): Promise<void> {
  const urls = await page
    .locator("[style], .class-portrait")
    .evaluateAll((elements) => [
      ...new Set(
        elements.flatMap((element) => {
          const match = getComputedStyle(element).backgroundImage.match(
            /url\(["']?(.*?)["']?\)/,
          );
          return match?.[1] ? [match[1]] : [];
        }),
      ),
    ]);
  expect(urls.length).toBeGreaterThan(0);
  const decoded = await page.evaluate(async (sources) => {
    return Promise.all(
      sources.map(async (source) => {
        const image = new Image();
        image.src = source;
        try {
          await image.decode();
          return image.naturalWidth > 0 && image.naturalHeight > 0;
        } catch {
          return false;
        }
      }),
    );
  }, urls);
  expect(decoded.every(Boolean)).toBe(true);
}

async function inspectTargets(
  page: Page,
  selector: string,
): Promise<TargetEvidence[]> {
  return page.locator(selector).evaluateAll((targets) =>
    targets
      .filter(
        (target) =>
          getComputedStyle(target).visibility !== "hidden" &&
          target.getClientRects().length > 0,
      )
      .map((target) => {
        const element = target as HTMLElement;
        const rect = element.getBoundingClientRect();
        const center = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          id:
            element.id ||
            element.getAttribute("aria-label") ||
            element.className,
          width: rect.width,
          height: rect.height,
          contained:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight,
          hit:
            center === element || Boolean(center && element.contains(center)),
        };
      }),
  );
}

function targetViolations(
  targets: TargetEvidence[],
  minTargetPixels: number,
): string[] {
  return targets.flatMap((target) => {
    const failures: string[] = [];
    if (target.width < minTargetPixels || target.height < minTargetPixels)
      failures.push(`${target.id}:undersized`);
    if (!target.contained) failures.push(`${target.id}:outside-viewport`);
    if (!target.hit) failures.push(`${target.id}:not-hit-testable`);
    return failures;
  });
}

async function landscapeSubjectViolations(page: Page): Promise<string[]> {
  const evidence = await page.locator(".selection-art").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundSize: style.backgroundSize,
      maskImage: style.maskImage || style.webkitMaskImage,
    };
  });
  const size = evidence.backgroundSize.match(/^auto\s+([\d.]+)%$/);
  const heightScale = size ? Number(size[1]) : Number.NaN;
  const violations: string[] = [];
  if (!size || heightScale < 115 || heightScale > 135)
    violations.push("landscape-hero:full-character-fit");
  if (!evidence.maskImage || evidence.maskImage === "none")
    violations.push("landscape-hero:subject-blend");
  return violations;
}

type SelectionClass = keyof typeof contract.screens.selection.landmarks;

async function landscapeLandmarkViolations(
  page: Page,
  classId: SelectionClass,
): Promise<string[]> {
  const evidence = await page
    .locator(".selection-art")
    .evaluate(async (element, landmarks) => {
      const style = getComputedStyle(element);
      const url = style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
      const image = new Image();
      image.src = url ?? "";
      await image.decode();
      const size = style.backgroundSize.match(/^auto\s+([\d.]+)%$/);
      const position = style.backgroundPosition.match(
        /^([\d.]+)%\s+([\d.]+)%$/,
      );
      const height = size ? (innerHeight * Number(size[1])) / 100 : Number.NaN;
      const width = height * (image.naturalWidth / image.naturalHeight);
      const left = position
        ? ((innerWidth - width) * Number(position[1])) / 100
        : Number.NaN;
      const top = position
        ? ((innerHeight - height) * Number(position[2])) / 100
        : Number.NaN;
      const occluders = [".choose", ".selection-header"].map((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return {
          selector,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      });
      return landmarks.flatMap((landmark) => {
        const x = left + landmark.x * width;
        const y = top + landmark.y * height;
        const radius = 7;
        const failures: string[] = [];
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x - radius < 0 ||
          y - radius < 0 ||
          x + radius > innerWidth ||
          y + radius > innerHeight
        )
          failures.push(`landmark:${landmark.id}:outside`);
        for (const occluder of occluders)
          if (
            x + radius > occluder.left &&
            x - radius < occluder.right &&
            y + radius > occluder.top &&
            y - radius < occluder.bottom
          )
            failures.push(
              `landmark:${landmark.id}:occluded-by-${occluder.selector}`,
            );
        return failures;
      });
    }, contract.screens.selection.landmarks[classId]);
  return evidence;
}

async function selectionGeometry(page: Page, profile: Profile): Promise<void> {
  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      title: bounds(".selection-header h1"),
      choose: bounds(".choose"),
    };
  });
  expect(geometry.document.width).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.document.height).toBeLessThanOrEqual(
    geometry.viewport.height,
  );
  expect(geometry.title.left).toBeGreaterThanOrEqual(0);
  expect(geometry.title.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.title.height / geometry.viewport.height).toBeLessThan(0.2);
  expect(geometry.choose.left).toBeGreaterThanOrEqual(0);
  expect(geometry.choose.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.choose.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  const targets = await inspectTargets(page, ".class-card, #seed, #begin");
  expect(targetViolations(targets, profile.minTargetPixels)).toEqual([]);
}

async function gameGeometry(page: Page, profile: Profile): Promise<void> {
  const geometry = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage")!;
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    const controls = document.querySelector<HTMLElement>(".mobile-controls")!;
    const stageRect = stage.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const counterRect = document
      .querySelector<HTMLElement>("#monsters")!
      .getBoundingClientRect();
    const objectiveRect = document
      .querySelector<HTMLElement>("#objective")!
      .getBoundingClientRect();
    const context = canvas.getContext("2d")!;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    let luminanceTotal = 0;
    for (let offset = 0; offset < pixels.length; offset += 64) {
      if (pixels[offset + 3]! > 0) opaque += 1;
      luminanceTotal +=
        pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!;
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      stage: {
        area: stageRect.width * stageRect.height,
        left: stageRect.left,
        top: stageRect.top,
        right: stageRect.right,
        bottom: stageRect.bottom,
      },
      controls: {
        visible: getComputedStyle(controls).display !== "none",
        height: controlsRect.height,
        left: controlsRect.left,
        top: controlsRect.top,
        right: controlsRect.right,
        bottom: controlsRect.bottom,
      },
      hudClusterDistance: Math.hypot(
        Math.max(
          0,
          Math.max(counterRect.left, objectiveRect.left) -
            Math.min(counterRect.right, objectiveRect.right),
        ),
        Math.max(
          0,
          Math.max(counterRect.top, objectiveRect.top) -
            Math.min(counterRect.bottom, objectiveRect.bottom),
        ),
      ),
      sampledOpaque: opaque,
      sampledLuminance: luminanceTotal,
    };
  });
  const viewportArea = geometry.viewport.width * geometry.viewport.height;
  expect(geometry.document.width).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.document.height).toBeLessThanOrEqual(
    geometry.viewport.height,
  );
  expect(geometry.stage.area / viewportArea).toBeGreaterThanOrEqual(
    profile.minStageCoverage,
  );
  expect(geometry.stage.left).toBeGreaterThanOrEqual(0);
  expect(geometry.stage.top).toBeGreaterThanOrEqual(0);
  expect(geometry.stage.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.stage.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.sampledOpaque).toBeGreaterThan(1000);
  expect(geometry.sampledLuminance).toBeGreaterThan(1000);
  const targets = await inspectTargets(
    page,
    ".mobile-actions button, .move-pad, .skills button",
  );
  expect(targetViolations(targets, profile.minTargetPixels)).toEqual([]);
  if (profile.touch) {
    expect(geometry.controls.visible).toBe(true);
    expect(
      geometry.controls.height / geometry.viewport.height,
    ).toBeLessThanOrEqual(profile.maxControlHeightRatio);
    expect(geometry.controls.left).toBeGreaterThanOrEqual(0);
    expect(geometry.controls.top).toBeGreaterThanOrEqual(geometry.stage.top);
    expect(geometry.controls.right).toBeLessThanOrEqual(
      geometry.viewport.width,
    );
    expect(geometry.controls.bottom).toBeLessThanOrEqual(
      geometry.viewport.height,
    );
    expect(geometry.hudClusterDistance).toBeLessThanOrEqual(24);
  } else {
    expect(geometry.controls.visible).toBe(false);
  }
}

async function mobileHudClusterDistance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const counter = document
      .querySelector<HTMLElement>("#monsters")!
      .getBoundingClientRect();
    const objective = document
      .querySelector<HTMLElement>("#objective")!
      .getBoundingClientRect();
    const horizontalGap = Math.max(
      0,
      Math.max(counter.left, objective.left) -
        Math.min(counter.right, objective.right),
    );
    const verticalGap = Math.max(
      0,
      Math.max(counter.top, objective.top) -
        Math.min(counter.bottom, objective.bottom),
    );
    return Math.hypot(horizontalGap, verticalGap);
  });
}

async function hudWorldOverlapViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const manifest = window.__GAME_OBSERVE__!.renderManifest();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    const objective = document.querySelector<HTMLElement>("#objective")!;
    const canvasRect = canvas.getBoundingClientRect();
    const objectiveRect = objective.getBoundingClientRect();
    const objectiveArea = objectiveRect.width * objectiveRect.height;
    const candidates = [
      ...manifest.sceneSprites
        .filter(({ layer, visible }) => layer === "structures" && visible)
        .map(({ objectId, destinationRect }) => ({
          id: objectId,
          destinationRect,
        })),
      ...manifest.drawCalls
        .filter(
          ({ type, visible }) =>
            visible && (type === "player" || type === "monster"),
        )
        .map(({ entityId, destinationRect }) => ({
          id: entityId,
          destinationRect,
        })),
    ];
    return candidates.flatMap(({ id, destinationRect }) => {
      const worldRect = {
        left:
          canvasRect.left +
          (destinationRect.x / canvas.width) * canvasRect.width,
        top:
          canvasRect.top +
          (destinationRect.y / canvas.height) * canvasRect.height,
        right:
          canvasRect.left +
          ((destinationRect.x + destinationRect.width) / canvas.width) *
            canvasRect.width,
        bottom:
          canvasRect.top +
          ((destinationRect.y + destinationRect.height) / canvas.height) *
            canvasRect.height,
      };
      const width = Math.max(
        0,
        Math.min(objectiveRect.right, worldRect.right) -
          Math.max(objectiveRect.left, worldRect.left),
      );
      const height = Math.max(
        0,
        Math.min(objectiveRect.bottom, worldRect.bottom) -
          Math.max(objectiveRect.top, worldRect.top),
      );
      return objectiveArea > 0 && (width * height) / objectiveArea > 0.05
        ? [`objective:occludes-${id}`]
        : [];
    });
  });
}

for (const profile of contract.profiles) {
  test(`${profile.id} public selection obeys the screen contract`, async ({
    browser,
  }) => {
    const { context, page, errors } = await contractPage(browser, profile);
    try {
      await page.goto(contract.screens.selection.route);
      await expect(
        page.locator(contract.screens.selection.ready),
      ).toBeVisible();
      for (const selector of contract.screens.selection.required)
        await expect(page.locator(selector).first()).toBeVisible();
      for (const selector of contract.screens.selection.publicForbidden)
        await expect(page.locator(selector)).toHaveCount(0);
      await expectDecodedBackgrounds(page);
      await selectionGeometry(page, profile);
      for (const classId of ["vanguard", "ranger", "arcanist"] as const) {
        await page.locator(`[data-class='${classId}']`).click();
        await expect(page.locator(".selection")).toHaveAttribute(
          "data-selected-class",
          classId,
        );
        if (profile.id === "phone-landscape") {
          expect(await landscapeSubjectViolations(page)).toEqual([]);
          expect(await landscapeLandmarkViolations(page, classId)).toEqual([]);
        }
        await expect(page).toHaveScreenshot(
          `${profile.id}-selection-${classId}.png`,
        );
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test(`${profile.id} public launch obeys the screen contract`, async ({
    browser,
  }) => {
    const { context, page, errors } = await contractPage(browser, profile);
    try {
      await page.goto(contract.screens.game.route);
      await page.locator("#begin").click();
      await expect(page.locator(contract.screens.game.ready)).toBeVisible({
        timeout: 30_000,
      });
      for (const selector of contract.screens.game.required)
        await expect(page.locator(selector).first()).toBeVisible();
      for (const selector of contract.screens.game.publicForbidden)
        await expect(page.locator(selector)).toHaveCount(0);
      await gameGeometry(page, profile);
      expect(await hudWorldOverlapViolations(page)).toEqual([]);
      const openingComposition = await page.evaluate(() =>
        window.__GAME_OBSERVE__!.renderManifest(),
      );
      const openingViewport = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return {
          x: (left - rect.left) * scaleX,
          y: (top - rect.top) * scaleY,
          width: Math.max(0, right - left) * scaleX,
          height: Math.max(0, bottom - top) * scaleY,
        };
      });
      const openingAssessment = assessOpeningComposition(
        openingComposition,
        openingViewport,
      );
      expect(openingAssessment.violations).toEqual([]);
      if (profile.id === "phone-portrait") {
        expect(openingAssessment.evidence.maximumOpeningFocalAreaRatio).toBe(
          0.36,
        );
        expect(openingAssessment.evidence.openingFocalAreaRatio).toBeLessThan(
          0.3,
        );
      }
      await expect(page).toHaveScreenshot(`${profile.id}-game.png`);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("game HUD assessor rejects an objective ribbon across the encounter", async ({
  browser,
}) => {
  const profile = contract.profiles.find(({ id }) => id === "desktop")!;
  const { context, page, errors } = await contractPage(browser, profile);
  try {
    await page.goto(contract.screens.game.route);
    await page.locator("#begin").click();
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    expect(await hudWorldOverlapViolations(page)).toEqual([]);
    await page.locator("#objective").evaluate((element) => {
      Object.assign((element as HTMLElement).style, {
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
      });
    });
    expect(await hudWorldOverlapViolations(page)).not.toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("mobile HUD assessor rejects a detached objective compass", async ({
  browser,
}) => {
  const profile = contract.profiles.find(({ id }) => id === "phone-portrait")!;
  const { context, page, errors } = await contractPage(browser, profile);
  try {
    await page.goto(contract.screens.game.route);
    await page.locator("#begin").click();
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    expect(await mobileHudClusterDistance(page)).toBeLessThanOrEqual(24);
    await page.locator("#objective").evaluate((element) => {
      (element as HTMLElement).style.top = "45svh";
    });
    expect(await mobileHudClusterDistance(page)).toBeGreaterThan(24);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("screen assessors reject known target and hero-crop regressions", async ({
  browser,
}) => {
  const profile = contract.profiles.find(({ id }) => id === "phone-landscape")!;
  const { context, page, errors } = await contractPage(browser, profile);
  try {
    await page.goto("/");
    await expect(page.locator(".selection-art")).toBeVisible();
    await page.locator("#begin").evaluate((element) => {
      const button = element as HTMLElement;
      Object.assign(button.style, {
        position: "fixed",
        left: "-10px",
        top: "10px",
        width: "20px",
        minWidth: "0",
        height: "20px",
        minHeight: "0",
        zIndex: "20",
      });
      const blocker = document.createElement("div");
      Object.assign(blocker.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "24px",
        height: "40px",
        zIndex: "21",
        pointerEvents: "auto",
      });
      document.body.append(blocker);
    });
    const targetFailures = targetViolations(
      await inspectTargets(page, "#begin"),
      profile.minTargetPixels,
    );
    expect(targetFailures).toContain("begin:undersized");
    expect(targetFailures).toContain("begin:outside-viewport");
    expect(targetFailures).toContain("begin:not-hit-testable");

    await page.locator(".selection-art").evaluate((element) => {
      const art = element as HTMLElement;
      art.style.backgroundSize = "cover";
      art.style.maskImage = "none";
      art.style.webkitMaskImage = "none";
    });
    expect(await landscapeSubjectViolations(page)).toEqual([
      "landscape-hero:full-character-fit",
      "landscape-hero:subject-blend",
    ]);

    await page.reload();
    await expect(page.locator(".selection-art")).toBeVisible();
    await page.locator(".choose").evaluate((element) => {
      const choose = element as HTMLElement;
      choose.style.right = "0";
      choose.style.left = "0";
      choose.style.width = "100%";
    });
    expect(
      (await landscapeLandmarkViolations(page, "vanguard")).some((failure) =>
        failure.includes("occluded"),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("rendered terrain exposes collision without scale-mismatched seams", async ({
  page,
}, testInfo) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__GAME_TEST__)))
    .toBe(true);
  const evidence = await extractTerrainPixelEvidence(page);
  expect(terrainPixelViolations(evidence)).toEqual([]);

  const erasedCollision = await extractTerrainPixelEvidence(
    page,
    "erase-collision",
  );
  expect(terrainPixelViolations(erasedCollision)).toContain(
    "terrain:collision-boundary-imperceptible",
  );

  const exaggeratedSeams = await extractTerrainPixelEvidence(
    page,
    "exaggerate-seams",
  );
  expect(terrainPixelViolations(exaggeratedSeams)).toContain(
    "terrain:scale-or-tile-seams-visible",
  );
  await testInfo.attach("terrain-pixel-evidence.json", {
    body: Buffer.from(
      `${JSON.stringify(
        {
          thresholds: {
            minimumCollisionSamples: 6,
            minimumMedianCollisionContrast: 3,
            minimumMaterialSeamSamples: 8,
            maximumMedianMaterialSeamContrast: 18,
          },
          valid: evidence,
          negativeControls: { erasedCollision, exaggeratedSeams },
        },
        null,
        2,
      )}\n`,
    ),
    contentType: "application/json",
  });
});
