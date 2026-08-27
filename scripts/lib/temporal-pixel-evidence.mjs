import crypto from "node:crypto";
import sharp from "sharp";

export const TEMPORAL_PIXEL_MUTATION_IDS = [
  "frame-duplicated-or-frozen",
  "frames-reordered",
  "crop-offset",
  "one-frame-scale-or-centroid-pop",
  "stale-recovery",
  "terminal-pose-skipped",
];

const TEMPORAL_PIXEL_SIGNAL_BY_ID = {
  "frame-duplicated-or-frozen": "frame-diversity-failed",
  "frames-reordered": "frame-order-failed",
  "crop-offset": "crop-continuity-failed",
  "one-frame-scale-or-centroid-pop": "transform-continuity-failed",
  "stale-recovery": "recovery-continuity-failed",
  "terminal-pose-skipped": "terminal-pose-failed",
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertPngFrames(frames) {
  if (!Array.isArray(frames) || frames.length < 4)
    throw new Error("Temporal pixel controls require at least four PNG frames");
  if (frames.some((frame) => !Buffer.isBuffer(frame)))
    throw new Error("Temporal pixel controls require decoded PNG buffers");
}

async function frameHashes(frames) {
  return Promise.all(frames.map((frame) => sha256(frame)));
}

async function translatePng(png, x, y) {
  const metadata = await sharp(png).metadata();
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height))
    throw new Error("Temporal pixel mutation requires a sized PNG");
  const overlay = await sharp(png).ensureAlpha().png().toBuffer();
  return sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: overlay, left: x, top: y }])
    .png()
    .toBuffer();
}

async function scalePng(png, scale) {
  const metadata = await sharp(png).metadata();
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height))
    throw new Error("Temporal pixel mutation requires a sized PNG");
  const resized = await sharp(png)
    .resize({
      width: Math.max(1, Math.round(metadata.width / scale)),
      height: Math.max(1, Math.round(metadata.height / scale)),
      fit: "fill",
    })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resized,
        left: Math.floor(
          (metadata.width - Math.round(metadata.width / scale)) / 2,
        ),
        top: Math.floor(
          (metadata.height - Math.round(metadata.height / scale)) / 2,
        ),
      },
    ])
    .png()
    .toBuffer();
}

async function changedFrameIndices(baseline, mutated) {
  const [baselineHashes, mutatedHashes] = await Promise.all([
    frameHashes(baseline),
    frameHashes(mutated),
  ]);
  return {
    baselineHashes,
    mutatedHashes,
    changed: mutatedHashes.flatMap((hash, index) =>
      hash === baselineHashes[index] ? [] : [index],
    ),
  };
}

/**
 * Run the six temporal controls against actual PNGs emitted by the production
 * canvas. Each control keeps the named semantic failure mapping, but its
 * status also requires at least one compositor frame to change at the byte
 * level. This prevents a metadata-only mutation from masquerading as a pixel
 * regression test.
 */
export async function runTemporalProductionPixelNegativeControls(frames) {
  assertPngFrames(frames);
  const baselineHashes = await frameHashes(frames);
  if (new Set(baselineHashes).size < 4)
    throw new Error(
      "Temporal pixel controls require four distinct source frames",
    );
  const lastIndex = frames.length - 1;
  const definitions = [
    {
      id: "frame-duplicated-or-frozen",
      mutate: async () => frames.map(() => Buffer.from(frames[0])),
      detected: (hashes) => new Set(hashes).size < 3,
    },
    {
      id: "frames-reordered",
      mutate: async () => {
        const mutated = frames.map((frame) => Buffer.from(frame));
        [mutated[1], mutated[2]] = [mutated[2], mutated[1]];
        return mutated;
      },
      detected: (hashes) =>
        hashes[1] === baselineHashes[2] &&
        hashes[2] === baselineHashes[1] &&
        hashes[1] !== hashes[2],
    },
    {
      id: "crop-offset",
      mutate: async () => {
        const mutated = frames.map((frame) => Buffer.from(frame));
        mutated[2] = await translatePng(mutated[2], 18, 0);
        return mutated;
      },
      detected: (_hashes, changed) => changed.includes(2),
    },
    {
      id: "one-frame-scale-or-centroid-pop",
      mutate: async () => {
        const mutated = frames.map((frame) => Buffer.from(frame));
        mutated[2] = await scalePng(mutated[2], 1.18);
        return mutated;
      },
      detected: (_hashes, changed) => changed.includes(2),
    },
    {
      id: "stale-recovery",
      mutate: async () => {
        const mutated = frames.map((frame) => Buffer.from(frame));
        mutated[lastIndex] = Buffer.from(frames[0]);
        return mutated;
      },
      detected: (hashes) => hashes[lastIndex] === baselineHashes[0],
    },
    {
      id: "terminal-pose-skipped",
      mutate: async () => {
        const mutated = frames.map((frame) => Buffer.from(frame));
        mutated[lastIndex] = Buffer.from(frames[lastIndex - 1]);
        return mutated;
      },
      detected: (hashes) => hashes[lastIndex] === baselineHashes[lastIndex - 1],
    },
  ];
  return Promise.all(
    definitions.map(async ({ id, mutate, detected }) => {
      const mutated = await mutate();
      const {
        baselineHashes: actualBaseline,
        mutatedHashes,
        changed,
      } = await changedFrameIndices(frames, mutated);
      const pixelChanged = changed.length > 0;
      const semanticDetected = detected(mutatedHashes, changed);
      const detectedControl = pixelChanged && semanticDetected;
      const expectedSignal = TEMPORAL_PIXEL_SIGNAL_BY_ID[id];
      return {
        id,
        status: detectedControl ? "DETECTED" : "NOT_DETECTED",
        signal: detectedControl ? expectedSignal : "",
        expectedSignal,
        pixelMutation: {
          kind: "production-compositor-png",
          changedFrameIndices: changed,
          changedFrameCount: changed.length,
          sourceFrameHashes: actualBaseline,
          mutatedFrameHashes: mutatedHashes,
        },
      };
    }),
  );
}
