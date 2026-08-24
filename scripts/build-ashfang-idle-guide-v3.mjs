import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const SIZE = 1024;
export const MATTE = [255, 0, 255];
export const CONTRACT = {
  axis: { start: [390, 365], end: [650, 390] },
  tail: { start: [390, 350], end: [225, 205] },
  head: { start: [665, 355], end: [825, 275] },
  routes: [
    {
      id: "farHind",
      points: [
        [420, 380],
        [360, 480],
        [305, 610],
      ],
    },
    {
      id: "nearHind",
      points: [
        [450, 425],
        [435, 580],
        [405, 765],
      ],
    },
    {
      id: "farFore",
      points: [
        [600, 380],
        [660, 475],
        [720, 610],
      ],
    },
    {
      id: "nearFore",
      points: [
        [625, 440],
        [600, 590],
        [635, 765],
      ],
    },
  ],
  nearPawBaselineY: 765,
  nearPairMidpointX: 520,
  minimumFarForeNearForeGapBelowElbows: 55,
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  root,
  "art/generation/guides/ashfang-idle-sparse-layout-v3.png",
);
const manifestPath = path.join(
  root,
  "art/generation/guides/ashfang-idle-sparse-layout-v3.json",
);

function samePoint(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === 2 &&
    actual.every((value, index) => value === expected[index])
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateContract(contract) {
  assert(
    samePoint(contract.axis.start, [390, 365]) &&
      samePoint(contract.axis.end, [650, 390]),
    "axis coordinates changed",
  );
  assert(
    samePoint(contract.tail.start, [390, 350]) &&
      samePoint(contract.tail.end, [225, 205]),
    "tail coordinates changed",
  );
  assert(
    samePoint(contract.head.start, [665, 355]) &&
      samePoint(contract.head.end, [825, 275]),
    "head coordinates changed",
  );
  const expected = [
    [
      "farHind",
      [
        [420, 380],
        [360, 480],
        [305, 610],
      ],
    ],
    [
      "nearHind",
      [
        [450, 425],
        [435, 580],
        [405, 765],
      ],
    ],
    [
      "farFore",
      [
        [600, 380],
        [660, 475],
        [720, 610],
      ],
    ],
    [
      "nearFore",
      [
        [625, 440],
        [600, 590],
        [635, 765],
      ],
    ],
  ];
  assert(
    contract.routes.length === expected.length,
    "guide must expose exactly four chains",
  );
  for (const [index, [id, points]] of expected.entries()) {
    const route = contract.routes[index];
    assert(
      route.id === id &&
        route.points.length === 3 &&
        route.points.every((point, pointIndex) =>
          samePoint(point, points[pointIndex]),
        ),
      `${id} coordinates changed`,
    );
  }
  validateSpatialRelationships(contract);
}

export function validateSpatialRelationships(contract) {
  const nearHind = contract.routes[1].points[2];
  const nearFore = contract.routes[3].points[2];
  assert(
    nearHind[1] === contract.nearPawBaselineY &&
      nearFore[1] === contract.nearPawBaselineY,
    "near-paw baseline is wrong",
  );
  assert(
    (nearHind[0] + nearFore[0]) / 2 === contract.nearPairMidpointX,
    "near-paw midpoint is wrong",
  );
  const farFore = contract.routes[2].points;
  const nearForeRoute = contract.routes[3].points;
  const minimumGap = Math.min(
    Math.abs(farFore[1][0] - nearForeRoute[1][0]),
    Math.abs(farFore[2][0] - nearForeRoute[2][0]),
  );
  assert(
    minimumGap >= contract.minimumFarForeNearForeGapBelowElbows,
    "far-fore and near-fore separation below elbows is insufficient",
  );
}

export function validateSvg(svg) {
  assert(
    !/<(?:circle|ellipse|polygon|polyline)\b/i.test(svg),
    "closed shapes are forbidden in the sparse guide",
  );
  for (const pathTag of svg.match(/<path\b[^>]*>/gi) ?? [])
    assert(
      !/\bd\s*=\s*["'][^"']*[zZ]/.test(pathTag),
      "closed path is forbidden in the sparse guide",
    );
}

function routePath(points) {
  return `M${points[0].join(" ")} L${points[1].join(" ")} L${points[2].join(" ")}`;
}

export function svgFor(contract) {
  validateContract(contract);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#ff00ff"/>
  <g fill="none" stroke="#123b4a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <!-- Open spatial axes only: no torso contour, width, ring, oval, surface, or closed shape. -->
    <path d="M390 365 L650 390" stroke-dasharray="3 16"/>
    <path d="M390 350 L225 205" stroke-width="4" stroke-dasharray="6 11"/>
    <path d="M665 355 L825 275" stroke-width="4" stroke-dasharray="6 11"/>
  </g>
  <g fill="none" stroke="#0d2d38" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    ${contract.routes.map((route) => `<path d="${routePath(route.points)}"/>`).join("\n    ")}
  </g>
</svg>`;
  validateSvg(svg);
  return Buffer.from(svg);
}

function isMatte(data, offset) {
  return (
    data[offset] === MATTE[0] &&
    data[offset + 1] === MATTE[1] &&
    data[offset + 2] === MATTE[2]
  );
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function render(contract = CONTRACT) {
  return sharp(svgFor(contract), { density: 72 })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      effort: 10,
      palette: false,
    })
    .toBuffer();
}

export async function inspect(bytes) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(
    info.width === SIZE && info.height === SIZE && info.channels === 4,
    "guide must decode as 1024x1024 RGBA",
  );
  let left = SIZE;
  let top = SIZE;
  let right = -1;
  let bottom = -1;
  let mattePixels = 0;
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (y * SIZE + x) * 4;
      assert(data[offset + 3] === 255, `transparency at ${x},${y}`);
      if (isMatte(data, offset)) mattePixels += 1;
      else {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  const occupied = {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  assert(
    occupied.left >= 220 &&
      occupied.right <= 830 &&
      occupied.top >= 200 &&
      occupied.bottom <= 770,
    `excessive occupancy: ${JSON.stringify(occupied)}`,
  );
  assert(
    mattePixels / (SIZE * SIZE) >= 0.98,
    "sparse guide has insufficient literal #ff00ff matte coverage",
  );
  return { occupied, matteRatio: mattePixels / (SIZE * SIZE) };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== "--check"))
    throw new Error(
      "Usage: node scripts/build-ashfang-idle-guide-v3.mjs [--check]",
    );
  const checkOnly = arguments_.includes("--check");
  const first = await render();
  const second = await render();
  assert(
    first.equals(second),
    "two clean guide renders were not byte-identical",
  );
  const metrics = await inspect(first);
  const sha256 = hash(first);
  if (checkOnly) {
    const [committed, manifestText] = await Promise.all([
      readFile(outputPath),
      readFile(manifestPath, "utf8"),
    ]);
    assert(
      committed.equals(first),
      `committed PNG differs from deterministic rebuild (${hash(committed)} != ${sha256})`,
    );
    const manifest = JSON.parse(manifestText);
    assert(
      manifest.schemaVersion === 3 &&
        manifest.contract === "AshfangSparseIdleSpatialGuideV3" &&
        manifest.file ===
          "art/generation/guides/ashfang-idle-sparse-layout-v3.png" &&
        manifest.sha256 === sha256,
      "v3 guide manifest is invalid",
    );
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, first);
  }
  console.log(
    `${checkOnly ? "Verified" : "Built"} Ashfang sparse idle guide v3 ${sha256}: ${metrics.occupied.width}x${metrics.occupied.height}px, matte ${(metrics.matteRatio * 100).toFixed(2)}%.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
