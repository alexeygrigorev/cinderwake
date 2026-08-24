import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

import {
  ACTOR_DETAIL_ALGORITHM_VERSION,
  assessActorDetail,
  loadActorDetailFrame,
  measureActorDetailFrame,
  renderActorDetailMap,
} from "./lib/actor-detail-metrics.mjs";

const root = process.cwd();
const contract = JSON.parse(
  await fs.readFile(
    path.join(root, "quality", "actor-detail-contract.v1.json"),
    "utf8",
  ),
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function loadFixture(fixture) {
  const filePath = path.join(root, fixture.file);
  const bytes = await fs.readFile(filePath);
  assert.equal(
    sha256(bytes),
    fixture.sha256,
    `${fixture.id} source hash drifted`,
  );
  if (fixture.projection.kind === "atlas-crop")
    return loadActorDetailFrame(bytes, {
      extract: {
        left: fixture.projection.left,
        top: fixture.projection.top,
        width: fixture.projection.width,
        height: fixture.projection.height,
      },
    });
  const frame = await loadActorDetailFrame(bytes, {
    keyMagenta: true,
    resize: {
      width: fixture.projection.width,
      height: fixture.projection.height,
      kernel: fixture.projection.kernel,
    },
  });
  const png = await sharp(frame.data, { raw: frame.info }).png().toBuffer();
  assert.equal(
    sha256(png),
    fixture.projection.sha256,
    `${fixture.id} runtime projection hash drifted`,
  );
  return frame;
}

function selectedMetrics(metrics) {
  return {
    usableInteriorPixels: metrics.usableInteriorPixels,
    strongOccupancy: metrics.strongOccupancy,
    readability: metrics.readability,
    isolatedExtremaOccupancy: metrics.isolatedExtremaOccupancy,
  };
}

function cloneFrame(frame) {
  return { data: Buffer.from(frame.data), info: { ...frame.info } };
}

function blurredAndAttenuated(frame) {
  const output = cloneFrame(frame);
  const { width, height } = output.info;
  let source = Buffer.from(output.data);
  for (let pass = 0; pass < 6; pass += 1) {
    const next = Buffer.from(source);
    for (let y = 1; y < height - 1; y += 1)
      for (let x = 1; x < width - 1; x += 1) {
        const pixel = y * width + x;
        if (source[pixel * 4 + 3] < 192) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          let total = 0;
          let weight = 0;
          for (let dy = -1; dy <= 1; dy += 1)
            for (let dx = -1; dx <= 1; dx += 1) {
              const neighbor = (y + dy) * width + x + dx;
              if (source[neighbor * 4 + 3] < 192) continue;
              const binomialWeight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
              total += source[neighbor * 4 + channel] * binomialWeight;
              weight += binomialWeight;
            }
          next[pixel * 4 + channel] = Math.round(total / weight);
        }
      }
    source = next;
  }
  const means = [0, 0, 0];
  let opaquePixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (source[pixel * 4 + 3] < 192) continue;
    opaquePixels += 1;
    for (let channel = 0; channel < 3; channel += 1)
      means[channel] += source[pixel * 4 + channel];
  }
  for (let channel = 0; channel < 3; channel += 1)
    means[channel] /= opaquePixels;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (source[pixel * 4 + 3] < 192) continue;
    for (let channel = 0; channel < 3; channel += 1)
      source[pixel * 4 + channel] = Math.round(
        means[channel] + (source[pixel * 4 + channel] - means[channel]) * 0.3,
      );
  }
  output.data = source;
  return output;
}

function seededGrain(frame) {
  const output = cloneFrame(frame);
  let state = 0x6d_2b_79_f5;
  for (
    let pixel = 0;
    pixel < output.info.width * output.info.height;
    pixel += 1
  ) {
    const offset = pixel * 4;
    if (output.data[offset + 3] < 192) continue;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const delta = (state >>> 0) % 2 === 0 ? -24 : 24;
    for (let channel = 0; channel < 3; channel += 1)
      output.data[offset + channel] = Math.max(
        0,
        Math.min(255, output.data[offset + channel] + delta),
      );
  }
  return output;
}

function denseInternalRims(frame) {
  const output = cloneFrame(frame);
  const { width, height } = output.info;
  let layer = new Uint8Array(width * height);
  const distance = new Uint16Array(width * height);
  for (let pixel = 0; pixel < layer.length; pixel += 1)
    if (output.data[pixel * 4 + 3] >= 192) layer[pixel] = 1;
  for (let depth = 1; layer.some(Boolean); depth += 1) {
    const next = new Uint8Array(layer);
    let removed = 0;
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (!layer[pixel]) continue;
        let boundary =
          x === 0 || y === 0 || x === width - 1 || y === height - 1;
        for (let dy = -1; dy <= 1 && !boundary; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1)
            if (!layer[(y + dy) * width + x + dx]) {
              boundary = true;
              break;
            }
        if (!boundary) continue;
        distance[pixel] = depth;
        next[pixel] = 0;
        removed += 1;
      }
    assert.ok(removed > 0, "rim erosion must make deterministic progress");
    layer = next;
  }
  for (let pixel = 0; pixel < distance.length; pixel += 1) {
    if (distance[pixel] === 0) continue;
    const delta = distance[pixel] % 2 === 0 ? 48 : -48;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1)
      output.data[offset + channel] = Math.max(
        0,
        Math.min(255, output.data[offset + channel] + delta),
      );
  }
  return output;
}

assert.equal(contract.algorithmVersion, ACTOR_DETAIL_ALGORITHM_VERSION);
assert.deepEqual(contract.thresholds, {
  status: "provisional-frozen",
  usableInteriorMinimum: 500,
  strongOccupancyMinimum: 0.3,
  strongOccupancyMaximum: 0.6,
  readabilityMinimum: 0.38,
  isolatedExtremaOccupancyMaximum: 0.07,
});

const frames = new Map();
const reported = {};
for (const fixture of contract.calibrationFixtures) {
  const frame = await loadFixture(fixture);
  frames.set(fixture.id, frame);
  const first = measureActorDetailFrame(frame);
  const second = measureActorDetailFrame(frame);
  assert.deepEqual(
    first,
    second,
    `${fixture.id} metrics are not deterministic`,
  );
  assert.deepEqual(
    selectedMetrics(first),
    fixture.expectedMetrics,
    `${fixture.id} calibration metrics drifted`,
  );
  const assessment = assessActorDetail(first, contract.thresholds);
  assert.equal(
    assessment.pass,
    fixture.expected === "pass",
    `${fixture.id} assessment did not match its frozen expectation`,
  );
  if (fixture.expectedViolation)
    assert.ok(
      assessment.violations.some(
        ({ code }) => code === fixture.expectedViolation,
      ),
      `${fixture.id} did not report ${fixture.expectedViolation}`,
    );
  reported[fixture.id] = first;
}

const mapFrame = frames.get("accepted-vanguard-east-idle-runtime-0");
const firstMap = await renderActorDetailMap(mapFrame);
const secondMap = await renderActorDetailMap(mapFrame);
assert.deepEqual(firstMap.metrics, secondMap.metrics);
assert.equal(
  sha256(firstMap.png),
  sha256(secondMap.png),
  "detail-map artifact is not deterministic",
);

const mutations = [
  {
    id: "deterministic-blur-attenuation",
    create: () =>
      blurredAndAttenuated(frames.get("accepted-vanguard-east-idle-runtime-0")),
    violation: "runtime-detail-collapse",
  },
  {
    id: "seeded-plus-minus-24-grain",
    create: () =>
      seededGrain(frames.get("accepted-ranger-east-idle-runtime-0")),
    violation: "runtime-detail-overload",
  },
  {
    id: "dense-internal-rim-tracing",
    create: () =>
      denseInternalRims(frames.get("accepted-stonekin-east-idle-runtime-0")),
    violation: "runtime-detail-overload",
  },
];

for (const mutation of mutations) {
  const firstFrame = mutation.create();
  const secondFrame = mutation.create();
  assert.deepEqual(
    firstFrame.data,
    secondFrame.data,
    `${mutation.id} pixels are not deterministic`,
  );
  const first = measureActorDetailFrame(firstFrame);
  const second = measureActorDetailFrame(secondFrame);
  assert.deepEqual(first, second, `${mutation.id} is not deterministic`);
  const assessment = assessActorDetail(first, contract.thresholds);
  assert.ok(
    assessment.violations.some(({ code }) => code === mutation.violation),
    `${mutation.id} did not report ${mutation.violation}: ${JSON.stringify(first)}`,
  );
  reported[mutation.id] = first;
}

console.log(
  `Actor runtime detail metrics PASS: ${JSON.stringify(reported, null, 2)}`,
);
