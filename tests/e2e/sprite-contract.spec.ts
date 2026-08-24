import { expect, test } from "@playwright/test";
import {
  loadProductionSpriteCatalog,
  validateManifestSpriteContract,
} from "../framework/sprite-contract";

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=temporal-ashfang-attack");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("registered sprite atlases decode at their declared dimensions", async ({
  page,
}) => {
  const catalog = await loadProductionSpriteCatalog();
  const expected = Object.values(catalog.assets).map((asset) => ({
    url: asset.url,
    width: asset.pixelWidth,
    height: asset.pixelHeight,
  }));
  const decoded = await page.evaluate(async (assets) => {
    return Promise.all(
      assets.map(
        (asset) =>
          new Promise<{
            url: string;
            width: number;
            height: number;
            complete: boolean;
          }>((resolve) => {
            const image = new Image();
            image.onload = () =>
              resolve({
                url: asset.url,
                width: image.naturalWidth,
                height: image.naturalHeight,
                complete: image.complete,
              });
            image.onerror = () =>
              resolve({ url: asset.url, width: 0, height: 0, complete: false });
            image.src = asset.url;
          }),
      ),
    );
  }, expected);
  expect(decoded).toEqual(
    expected.map((asset) => ({ ...asset, complete: true })),
  );
});

test("the real canvas uses atlas image draws for every manifested sprite", async ({
  page,
}) => {
  const catalog = await loadProductionSpriteCatalog();
  const evidence = await page.evaluate(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.drawImage;
    let drawImageCalls = 0;
    prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      drawImageCalls += 1;
      return (original as (...parameters: unknown[]) => void).apply(this, args);
    } as typeof prototype.drawImage;
    try {
      window.__GAME_TEST__!.render();
      return {
        drawImageCalls,
        manifest: window.__GAME_TEST__!.renderManifest(),
      };
    } finally {
      prototype.drawImage = original;
    }
  });
  const manifest = validateManifestSpriteContract(evidence.manifest, catalog);
  expect(manifest.worldUi).not.toHaveLength(0);
  for (const health of manifest.worldUi) {
    expect(health.frame.spriteId).toBe("world-ui:health-frame");
    expect(health.fill.spriteId).toBe("world-ui:health-fill");
    expect(health.frame.sourceRect).toEqual({
      x: 512,
      y: 0,
      width: 256,
      height: 82,
    });
    expect(health.fill.sourceRect.width).toBeGreaterThan(0);
    expect(health.fill.sourceRect.width).toBeLessThanOrEqual(256);
  }
  expect(evidence.drawImageCalls).toBeGreaterThanOrEqual(
    manifest.drawCalls.length +
      manifest.sceneSprites.length +
      manifest.worldUi.length * 2,
  );
});
