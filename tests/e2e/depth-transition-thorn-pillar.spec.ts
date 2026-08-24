import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { assessDepthTransition } from "../framework/depth-transition";

const PROP_ID = "prop:3:0:thorn-pillar";
const FIXED_CAMERA = { x: 31.5 * 48, y: 6.5 * 48, zoom: 1 };

async function runThornPillarRoute(page: Page) {
  return page.evaluate(async ({ propId, camera }) => {
    const bridge = window.__GAME_TEST__!;
    bridge.loadScenario("depth-transition-thorn-pillar");
    bridge.setCamera(camera, "fixed");
    const alphaIntersection = async (first: string, second: string) => {
      const decode = async (source: string) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [left, right] = await Promise.all([decode(first), decode(second)]);
      let intersection = 0;
      for (let index = 3; index < left.length; index += 4)
        if (left[index]! > 8 && right[index]! > 8) intersection += 1;
      return intersection;
    };
    const capture = async (id: string) => {
      bridge.render();
      const manifest = bridge.renderManifest();
      const player = bridge.capturePaintMask("body:player");
      const prop = bridge.capturePaintMask(`scene:${propId}`);
      const playerOrder = manifest.paintQueue.findIndex(
        ({ paintId }) => paintId === "body:player",
      );
      const propOrder = manifest.paintQueue.findIndex(
        ({ paintId }) => paintId === `scene:${propId}`,
      );
      return {
        id,
        tick: bridge.snapshot().tick,
        player: bridge.snapshot().player.position,
        playerOrder,
        propOrder,
        alphaIntersection: await alphaIntersection(player.image, prop.image),
        playerPaintHash: player.pixelHash,
        propPaintHash: prop.pixelHash,
        frameLength: bridge.captureFrame().length,
        manifest,
      };
    };
    const behind = await capture("behind");
    bridge.setInput({ moveX: -1 });
    bridge.step(16, { render: true });
    bridge.setInput({ moveX: 0, moveY: 1 });
    bridge.step(22, { render: true });
    const crossing = await capture("crossing");
    bridge.setInput({ moveX: 1, moveY: 0 });
    bridge.step(16, { render: true });
    bridge.setInput({ moveX: 0, moveY: 0 });
    const front = await capture("front");
    return { behind, crossing, front, events: bridge.drainEvents() };
  }, { propId: PROP_ID, camera: FIXED_CAMERA });
}

function assertRoute(result: Awaited<ReturnType<typeof runThornPillarRoute>>) {
  expect(result.behind.player).toEqual({ x: 32256, y: 5956 });
  expect(result.front.player).toEqual({ x: 32256, y: 7364 });
  expect(result.events.filter(({ type }) => type === "movement_blocked")).toEqual([]);
  for (const frame of [result.behind, result.front]) {
    expect(frame.alphaIntersection, frame.id).toBeGreaterThan(0);
    expect(frame.frameLength, frame.id).toBeGreaterThan(1_000);
  }
  expect(result.behind.playerOrder).toBeLessThan(result.behind.propOrder);
  expect(result.front.playerOrder).toBeGreaterThan(result.front.propOrder);
  expect(result.crossing.playerPaintHash).not.toBe(result.behind.playerPaintHash);
  expect(assessDepthTransition(result.behind.manifest).verdict).toBe("PASS");
  expect(assessDepthTransition(result.front.manifest).verdict).toBe("PASS");
  const swapped = structuredClone(result.front.manifest);
  const playerIndex = swapped.paintQueue.findIndex(({ paintId }) => paintId === "body:player");
  const propIndex = swapped.paintQueue.findIndex(({ paintId }) => paintId === `scene:${PROP_ID}`);
  [swapped.paintQueue[playerIndex], swapped.paintQueue[propIndex]] = [
    swapped.paintQueue[propIndex]!,
    swapped.paintQueue[playerIndex]!,
  ];
  swapped.paintQueue.forEach((item, index) => (item.zOrder = index));
  expect(assessDepthTransition(swapped).violations.join(" ")).toContain("depth-order-mismatch");
}

test.describe("thorn-pillar production depth transition", () => {
  test("records ordered desktop behind-to-front paint evidence", async ({ page }) => {
    await page.goto("/?testMode=1&scenario=depth-transition-thorn-pillar");
    await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
    assertRoute(await runThornPillarRoute(page));
  });

  test("records ordered 390x844 phone evidence", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?testMode=1&scenario=depth-transition-thorn-pillar");
    await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
    assertRoute(await runThornPillarRoute(page));
  });
});
