import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SIZE = 1024;
const MATTE = [255, 0, 255];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  root,
  "art/generation/guides/quadruped-pose-layout-v2.png",
);
const manifestPath = path.join(
  root,
  "art/generation/guides/quadruped-pose-layout-v2.json",
);
const checkOnly = process.argv.slice(2).includes("--check");

if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error(
    "Usage: node scripts/build-pose-layout-guide-v2.mjs [--check]",
  );
}

const routes = [
  {
    name: "farHind",
    start: [415, 385],
    joint: [347, 491],
    rootControl: [370, 430],
    pawControl: [306, 565],
    end: [287, 624],
  },
  {
    name: "nearHind",
    start: [448, 438],
    joint: [442, 604],
    rootControl: [477, 525],
    pawControl: [395, 710],
    end: [400, 790],
  },
  {
    name: "farFore",
    start: [585, 402],
    joint: [590, 503],
    rootControl: [610, 450],
    pawControl: [575, 570],
    end: [600, 650],
  },
  {
    name: "nearFore",
    start: [615, 452],
    joint: [637, 614],
    rootControl: [665, 540],
    pawControl: [625, 695],
    end: [640, 790],
  },
];

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function svg() {
  const routePaths = routes
    .map(
      (route) =>
        `<path class="route" d="M${route.start.join(" ")} Q${route.rootControl.join(" ")} ${route.joint.join(" ")} Q${route.pawControl.join(" ")} ${route.end.join(" ")}"/>`,
    )
    .join("\n  ");
  const joints = routes
    .map(
      (route) =>
        `<circle class="joint" cx="${route.joint[0]}" cy="${route.joint[1]}" r="7"/>`,
    )
    .join("\n  ");
  const paws = routes
    .map(
      (route) =>
        `<ellipse class="paw" cx="${route.end[0]}" cy="${route.end[1]}" rx="15" ry="9"/>`,
    )
    .join("\n  ");

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#ff00ff"/>
  <g fill="none" stroke="#1d3f4d" stroke-linecap="round" stroke-linejoin="round">
    <!-- One open elevated center axis: not an enclosing torso or silhouette. -->
    <path d="M375 377 C460 342 572 350 665 401" stroke-width="5" stroke-dasharray="2 16"/>
    <path d="M430 354 L426 380 M500 345 L497 373 M570 353 L568 380 M630 375 L628 402" stroke-width="3"/>
    <path d="M375 357 L205 195 L230 235" stroke-width="4" stroke-dasharray="6 11"/>
    <path d="M674 365 L850 278 L810 278" stroke-width="4" stroke-dasharray="6 11"/>
    <path d="M850 278 L820 313" stroke-width="4" stroke-dasharray="6 11"/>
  </g>
  <g fill="none" stroke="#163844" stroke-linecap="round" stroke-linejoin="round">
    ${routePaths}
  </g>
  <g fill="#ff00ff" stroke="#0d2d38" stroke-width="4">
    ${joints}
    ${paws}
  </g>
  <g fill="#0d2d38">
    <circle cx="415" cy="385" r="4"/><circle cx="448" cy="438" r="4"/>
    <circle cx="585" cy="402" r="4"/><circle cx="615" cy="452" r="4"/>
  </g>
</svg>`);
}

async function render() {
  return sharp(svg(), { density: 72 })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      effort: 10,
      palette: false,
    })
    .toBuffer();
}

function isMatte(data, offset) {
  return (
    data[offset] === MATTE[0] &&
    data[offset + 1] === MATTE[1] &&
    data[offset + 2] === MATTE[2]
  );
}

function quadratic(start, control, end, t) {
  const u = 1 - t;
  return [0, 1].map(
    (axis) =>
      u ** 2 * start[axis] + 2 * u * t * control[axis] + t ** 2 * end[axis],
  );
}

function routeSegments(route) {
  return [
    { start: route.start, control: route.rootControl, end: route.joint },
    { start: route.joint, control: route.pawControl, end: route.end },
  ];
}

function hasInkNear(data, info, x, y, radius) {
  for (
    let row = Math.max(0, Math.floor(y - radius));
    row <= Math.min(info.height - 1, Math.ceil(y + radius));
    row += 1
  ) {
    for (
      let column = Math.max(0, Math.floor(x - radius));
      column <= Math.min(info.width - 1, Math.ceil(x + radius));
      column += 1
    ) {
      if (
        (column - x) ** 2 + (row - y) ** 2 <= radius ** 2 &&
        !isMatte(data, (row * info.width + column) * info.channels)
      )
        return true;
    }
  }
  return false;
}

function regionInkRatio(data, info, region) {
  let ink = 0;
  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      if (!isMatte(data, (y * info.width + x) * info.channels)) ink += 1;
    }
  }
  return ink / (region.width * region.height);
}

async function inspect(bytes) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== SIZE || info.height !== SIZE || info.channels !== 4)
    throw new Error("Guide must decode as 1024x1024 RGBA");
  let left = SIZE;
  let top = SIZE;
  let right = -1;
  let bottom = -1;
  let mattePixels = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (y * SIZE + x) * 4;
      if (data[offset + 3] !== 255)
        throw new Error(`Transparency at ${x},${y}`);
      if (isMatte(data, offset)) {
        mattePixels += 1;
      } else {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
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
  const widthRatio = occupied.width / SIZE;
  const heightRatio = occupied.height / SIZE;
  const bottomRatio = occupied.bottom / SIZE;
  if (
    widthRatio < 0.6 ||
    widthRatio > 0.64 ||
    heightRatio < 0.58 ||
    heightRatio > 0.63 ||
    bottomRatio < 0.77 ||
    bottomRatio > 0.79
  )
    throw new Error(
      `Envelope outside target: ${JSON.stringify({ widthRatio, heightRatio, bottomRatio })}`,
    );
  if (mattePixels / (SIZE * SIZE) < 0.94)
    throw new Error(
      "Sparse guide has insufficient literal #ff00ff matte coverage",
    );

  for (const route of routes) {
    for (const segment of routeSegments(route)) {
      for (let sample = 1; sample < 24; sample += 1) {
        const [x, y] = quadratic(
          segment.start,
          segment.control,
          segment.end,
          sample / 24,
        );
        if (!hasInkNear(data, info, x, y, 7))
          throw new Error(
            `${route.name} route is discontinuous near ${Math.round(x)},${Math.round(y)}`,
          );
      }
    }
    for (const [label, point] of [
      ["root", route.start],
      ["declared joint", route.joint],
      ["paw", route.end],
    ]) {
      if (!hasInkNear(data, info, point[0], point[1], 6)) {
        throw new Error(`${route.name} ${label} lacks route ink`);
      }
    }
    const [x, y] = route.end;
    const ratio = regionInkRatio(data, info, {
      left: x - 22,
      top: y - 16,
      width: 45,
      height: 33,
    });
    if (ratio < 0.05)
      throw new Error(`${route.name} terminal marker is missing`);
  }

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    for (
      let otherIndex = routeIndex + 1;
      otherIndex < routes.length;
      otherIndex += 1
    ) {
      let minimum = Infinity;
      for (const segment of routeSegments(routes[routeIndex])) {
        for (let sample = 3; sample < 22; sample += 1) {
          const point = quadratic(
            segment.start,
            segment.control,
            segment.end,
            sample / 24,
          );
          for (const otherSegment of routeSegments(routes[otherIndex])) {
            for (let otherSample = 3; otherSample < 22; otherSample += 1) {
              const other = quadratic(
                otherSegment.start,
                otherSegment.control,
                otherSegment.end,
                otherSample / 24,
              );
              minimum = Math.min(
                minimum,
                Math.hypot(point[0] - other[0], point[1] - other[1]),
              );
            }
          }
        }
      }
      if (minimum < 12)
        throw new Error(
          `${routes[routeIndex].name} and ${routes[otherIndex].name} lack useful separation (${minimum.toFixed(1)}px)`,
        );
    }
  }
  const nearMidpoint = (routes[1].end[0] + routes[3].end[0]) / 2;
  if (
    Math.abs(nearMidpoint - SIZE / 2) > 12 ||
    Math.abs(routes[1].end[1] - routes[3].end[1]) > 2
  )
    throw new Error("Near paw pair is not centered on a shared baseline");

  for (let top = 0; top < SIZE; top += 32) {
    for (let left = 0; left < SIZE; left += 32) {
      if (
        regionInkRatio(data, info, { left, top, width: 32, height: 32 }) > 0.38
      )
        throw new Error(`Forbidden broad filled region near ${left},${top}`);
    }
  }
  return {
    occupied,
    widthRatio,
    heightRatio,
    bottomRatio,
    matteRatio: mattePixels / (SIZE * SIZE),
    nearMidpoint,
  };
}

const first = await render();
const second = await render();
if (!first.equals(second))
  throw new Error("Two clean guide renders were not byte-identical");
const metrics = await inspect(first);
const sha256 = hash(first);
if (checkOnly) {
  const [committed, manifestText] = await Promise.all([
    readFile(outputPath),
    readFile(manifestPath, "utf8"),
  ]);
  if (!committed.equals(first))
    throw new Error(
      `Committed PNG differs from deterministic rebuild (${hash(committed)} != ${sha256})`,
    );
  const manifest = JSON.parse(manifestText);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.contract !== "CinderwakeSparseQuadrupedPoseLayoutGuideV2" ||
    manifest.file !== "art/generation/guides/quadruped-pose-layout-v2.png" ||
    manifest.sha256 !== sha256 ||
    manifest.visualReview?.status !== "ACCEPT" ||
    manifest.visualReview?.reviewedSha256 !== sha256 ||
    typeof manifest.visualReview?.reviewer !== "string" ||
    manifest.visualReview.reviewer.length === 0 ||
    typeof manifest.visualReview?.approvedRole !== "string" ||
    !manifest.visualReview.approvedRole.includes(
      "no contour, width, silhouette, anatomy, material, lighting, production-art, or automatic-acceptance authority",
    ) ||
    !Array.isArray(manifest.visualReview?.acceptedAxes) ||
    manifest.visualReview.acceptedAxes.length < 6 ||
    !Array.isArray(manifest.visualReview?.rejectedAxes) ||
    manifest.visualReview.rejectedAxes.length !== 0 ||
    !Array.isArray(manifest.visualReview?.cautions) ||
    manifest.visualReview.cautions.length < 4
  )
    throw new Error("V2 guide manifest or exact-hash visual review is invalid");
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, first);
}
console.log(
  `${checkOnly ? "Verified" : "Built"} sparse quadruped pose layout v2 ${sha256}: ${metrics.occupied.width}x${metrics.occupied.height}px, matte ${(metrics.matteRatio * 100).toFixed(2)}%, near midpoint ${metrics.nearMidpoint}.`,
);
