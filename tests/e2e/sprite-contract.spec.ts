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
      x: 583,
      y: 95,
      width: 197,
      height: 82,
    });
    expect(health.fill.sourceRect.width).toBeGreaterThan(0);
    expect(health.fill.sourceRect.width).toBeLessThanOrEqual(254);
  }
  expect(evidence.drawImageCalls).toBeGreaterThanOrEqual(
    manifest.drawCalls.length +
      manifest.sceneSprites.length +
      manifest.worldUi.length * 2,
  );

  const atlasUrls = Object.fromEntries(
    Object.values(catalog.assets).map(({ id, url }) => [id, url]),
  );
  const healthSpriteReferences = [
    "world-ui:health-frame",
    "world-ui:health-fill",
  ].map((spriteId) => {
    const sprite = catalog.sprites[spriteId]!;
    const frameIdentity = sprite.clips.static!.frameIdentities[0]!;
    return {
      assetId: sprite.assetId,
      sourceRect: sprite.frames[frameIdentity]!,
    };
  });
  const visibleInk = await page.evaluate(
    async ({ references, assetUrls }) => {
      const images = new Map<string, HTMLImageElement>();
      const alphaEvidence = async (reference: {
        assetId: string;
        sourceRect: { x: number; y: number; width: number; height: number };
      }) => {
        let image = images.get(reference.assetId);
        if (!image) {
          image = new Image();
          image.src = assetUrls[reference.assetId]!;
          await image.decode();
          images.set(reference.assetId, image);
        }
        const canvas = document.createElement("canvas");
        canvas.width = reference.sourceRect.width;
        canvas.height = reference.sourceRect.height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(
          image,
          reference.sourceRect.x,
          reference.sourceRect.y,
          reference.sourceRect.width,
          reference.sourceRect.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const opaque = new Uint8Array(canvas.width * canvas.height);
        let alphaPixels = 0;
        for (let pixel = 0; pixel < opaque.length; pixel += 1) {
          if (pixels[pixel * 4 + 3]! <= 8) continue;
          opaque[pixel] = 1;
          alphaPixels += 1;
        }
        const visited = new Uint8Array(opaque.length);
        let componentCount = 0;
        let largestComponentPixels = 0;
        for (let start = 0; start < opaque.length; start += 1) {
          if (!opaque[start] || visited[start]) continue;
          componentCount += 1;
          const queue = [start];
          visited[start] = 1;
          let componentPixels = 0;
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const pixel = queue[cursor]!;
            componentPixels += 1;
            const x = pixel % canvas.width;
            for (const neighbor of [
              pixel - 1,
              pixel + 1,
              pixel - canvas.width,
              pixel + canvas.width,
            ]) {
              if (
                neighbor < 0 ||
                neighbor >= opaque.length ||
                visited[neighbor] ||
                !opaque[neighbor] ||
                Math.abs((neighbor % canvas.width) - x) > 1
              )
                continue;
              visited[neighbor] = 1;
              queue.push(neighbor);
            }
          }
          largestComponentPixels = Math.max(
            largestComponentPixels,
            componentPixels,
          );
        }
        return { alphaPixels, componentCount, largestComponentPixels };
      };
      return Promise.all(references.map(alphaEvidence));
    },
    { references: healthSpriteReferences, assetUrls: atlasUrls },
  );
  expect(visibleInk).toHaveLength(2);
  for (const evidence of visibleInk) {
    expect(evidence.alphaPixels).toBeGreaterThan(100);
    expect(evidence.componentCount).toBeGreaterThan(0);
    expect(
      evidence.largestComponentPixels / evidence.alphaPixels,
    ).toBeGreaterThan(0.98);
  }
});
