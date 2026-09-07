import { createHash } from "node:crypto";
import sharp from "sharp";

export const RANGER_DIRECTION_ACTIONS_SHA256 =
  "4e5786247b78c975c1a5b2ba62965c47ffdd999e990b07ba5d9d4ddd5c6c6a4b";
export const RANGER_RELEASE_CELL_SHA256 =
  "efbcfde0009e5c185d836658ee07c501e34df0552ff0f56e5fa2bc91bbaa0e25";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function connectedInk(data) {
  const seen = new Uint8Array(128 * 128),
    components = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || data[start * 4 + 3] === 0) continue;
    const pixels = [start];
    seen[start] = 1;
    let x0 = 128,
      y0 = 128,
      x1 = 0,
      y1 = 0;
    for (let index = 0; index < pixels.length; index++) {
      const pixel = pixels[index],
        x = pixel % 128,
        y = Math.floor(pixel / 128);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const next of [
        x > 0 ? pixel - 1 : -1,
        x < 127 ? pixel + 1 : -1,
        y > 0 ? pixel - 128 : -1,
        y < 127 ? pixel + 128 : -1,
      ]) {
        if (next < 0 || seen[next] || data[next * 4 + 3] === 0) continue;
        seen[next] = 1;
        pixels.push(next);
      }
    }
    components.push({
      pixels,
      bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
    });
  }
  return components.sort((a, b) => b.pixels.length - a.pixels.length);
}

/** This source-specific correction runs after reanchoring and palette assembly. */
export function removeRangerDetachedArrow(cell, sourceSha256) {
  if (sourceSha256 !== RANGER_DIRECTION_ACTIONS_SHA256)
    throw new Error(
      "Ranger direction-action art changed; review the detached-arrow correction",
    );
  if (
    cell.length !== 128 * 128 * 4 ||
    hash(cell) !== RANGER_RELEASE_CELL_SHA256
  )
    throw new Error(
      "Ranger release cell changed; review its actor, bow and detached components",
    );
  const components = connectedInk(cell);
  const expected = [
    { area: 3092, x: 17, y: 10, width: 76, height: 106 },
    { area: 24, x: 101, y: 37, width: 11, height: 4 },
    { area: 4, x: 95, y: 39, width: 2, height: 2 },
  ];
  const actual = components.map(({ pixels, bounds }) => ({
    area: pixels.length,
    ...bounds,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      "Ranger detached projectile component invariant changed; visual review required",
    );
  const output = Buffer.from(cell);
  for (const component of components.slice(1))
    for (const pixel of component.pixels)
      output.fill(0, pixel * 4, pixel * 4 + 4);
  return output;
}

export async function prepareRangerProjectileAtlas(
  buffer,
  sourceSha256,
  { candidateOutput = false } = {},
) {
  // An isolated generation trial can change other cells and hence the shared
  // palette. This exact-pixel correction belongs only to the reviewed atlas;
  // preserve an unreviewed candidate unchanged rather than applying that mask.
  // Production builds never opt into this branch and still fail closed.
  if (
    candidateOutput &&
    hash(buffer) !==
      "d3def1e24d76dbba54db92b2d8bbde332eda542e1af3c08d744ec65566676862"
  )
    return Buffer.from(buffer);
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 1024 || info.height !== 2560)
    throw new Error("Unexpected Ranger atlas dimensions");
  for (const column of [2, 3]) {
    const cell = Buffer.alloc(128 * 128 * 4);
    for (let y = 0; y < 128; y++) {
      const offset = ((1280 + y) * 1024 + column * 128) * 4;
      data.copy(cell, y * 128 * 4, offset, offset + 128 * 4);
    }
    const cleaned = removeRangerDetachedArrow(cell, sourceSha256);
    for (let y = 0; y < 128; y++) {
      const offset = ((1280 + y) * 1024 + column * 128) * 4;
      cleaned.copy(data, offset, y * 128 * 4, (y + 1) * 128 * 4);
    }
  }
  // Lossless RGBA avoids re-quantizing unrelated colors after removing ink.
  return sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
}
