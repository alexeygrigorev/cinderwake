import fs from "node:fs/promises";
import path from "node:path";

const [timelineFile, outputFile] = process.argv.slice(2);
if (!timelineFile)
  throw new Error(
    "Usage: node scripts/assess-sequence.mjs <render-manifest-timeline.json> [output.json]",
  );
const timeline = JSON.parse(await fs.readFile(timelineFile, "utf8"));
const frames = Array.isArray(timeline) ? timeline : (timeline.frames ?? []);
const points = frames
  .map((frame) => ({
    tick: frame.tick,
    snapshot: frame.snapshot,
    manifest: frame.manifest,
    actor: frame.manifest?.drawCalls?.find?.(
      (call) => call.entityId === "player",
    ),
  }))
  .filter((frame) => frame.actor);

const ranges = (values) =>
  values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
const anchorsX = points
  .map(({ actor }) => actor.footAnchor?.x)
  .filter(Number.isFinite);
const anchorsY = points
  .map(({ actor }) => actor.footAnchor?.y)
  .filter(Number.isFinite);
const widths = points
  .map(({ actor }) => actor.bounds?.width)
  .filter(Number.isFinite);
const heights = points
  .map(({ actor }) => actor.bounds?.height)
  .filter(Number.isFinite);
const framesSeen = points
  .map(({ actor }) => actor.frameIndex)
  .filter(Number.isFinite);
const worldSpeeds = [];
const velocityErrors = [];
const frameSkips = [];
let oneShotBackwardJumps = 0;
const cameraAccelerations = [];
let previousCameraVelocity;

for (let index = 1; index < points.length; index += 1) {
  const previous = points[index - 1];
  const current = points[index];
  const tickDelta = current.tick - previous.tick;
  const worldDeltaX =
    current.actor.worldAnchor.x - previous.actor.worldAnchor.x;
  const worldDeltaY =
    current.actor.worldAnchor.y - previous.actor.worldAnchor.y;
  worldSpeeds.push(Math.hypot(worldDeltaX, worldDeltaY) / tickDelta);
  const velocity = current.snapshot?.player?.velocity ?? { x: 0, y: 0 };
  velocityErrors.push(
    Math.hypot(
      worldDeltaX - velocity.x * tickDelta,
      worldDeltaY - velocity.y * tickDelta,
    ),
  );
  const frameCounts = {
    idle: 6,
    walk: 8,
    attack: 6,
    ability: 8,
    hurt: 4,
    death: 8,
  };
  const frameCount = frameCounts[current.actor.clip];
  if (frameCount && current.actor.clip === previous.actor.clip) {
    if (["idle", "walk"].includes(current.actor.clip)) {
      frameSkips.push(
        (current.actor.frameIndex - previous.actor.frameIndex + frameCount) %
          frameCount,
      );
    } else {
      frameSkips.push(current.actor.frameIndex - previous.actor.frameIndex);
      if (current.actor.frameIndex < previous.actor.frameIndex)
        oneShotBackwardJumps += 1;
    }
  }
  const cameraVelocity = {
    x: (current.manifest.camera.x - previous.manifest.camera.x) / tickDelta,
    y: (current.manifest.camera.y - previous.manifest.camera.y) / tickDelta,
  };
  if (previousCameraVelocity) {
    cameraAccelerations.push(
      Math.hypot(
        cameraVelocity.x - previousCameraVelocity.x,
        cameraVelocity.y - previousCameraVelocity.y,
      ),
    );
  }
  previousCameraVelocity = cameraVelocity;
}

const clipping = points.some(
  ({ actor, manifest }) =>
    actor.visible === false ||
    !actor.bounds ||
    actor.bounds.width <= 0 ||
    actor.bounds.height <= 0 ||
    actor.bounds.x < 0 ||
    actor.bounds.y < 0 ||
    actor.bounds.x + actor.bounds.width > manifest.viewport.width ||
    actor.bounds.y + actor.bounds.height > manifest.viewport.height,
);
const measurements = {
  frames: points.length,
  uniqueAnimationFrames: new Set(framesSeen).size,
  footAnchorJitterX: ranges(anchorsX),
  footAnchorJitterY: ranges(anchorsY),
  velocityError: velocityErrors.length ? Math.max(...velocityErrors) : 0,
  speedDelta: ranges(worldSpeeds),
  maximumFrameAdvance: frameSkips.length ? Math.max(...frameSkips) : 0,
  oneShotBackwardJumps,
  boundsWidthDelta: ranges(widths),
  boundsHeightDelta: ranges(heights),
  cameraAccelerationPeak: cameraAccelerations.length
    ? Math.max(...cameraAccelerations)
    : 0,
  clipping,
};
const thresholds = {
  footAnchorJitter: 0.25,
  velocityError: 0,
  speedDelta: 0.01,
  maximumFrameAdvance: 1,
  boundsDelta: 0,
  clipping: false,
};
const checks = {
  enoughFrames: measurements.frames >= 2,
  footAnchorStable:
    measurements.footAnchorJitterX <= thresholds.footAnchorJitter &&
    measurements.footAnchorJitterY <= thresholds.footAnchorJitter,
  velocityContinuous: measurements.velocityError <= thresholds.velocityError,
  speedContinuous: measurements.speedDelta <= thresholds.speedDelta,
  frameCadence:
    measurements.maximumFrameAdvance <= thresholds.maximumFrameAdvance &&
    measurements.oneShotBackwardJumps === 0,
  proportionsStable:
    measurements.boundsWidthDelta <= thresholds.boundsDelta &&
    measurements.boundsHeightDelta <= thresholds.boundsDelta,
  clipping: measurements.clipping === thresholds.clipping,
};
const result = {
  schemaVersion: 1,
  thresholds,
  measurements,
  checks,
  pass: Object.values(checks).every(Boolean),
};
const destination =
  outputFile ??
  path.join(path.dirname(timelineFile), "animation-analysis.json");
await fs.writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.pass ? "PASS" : "FAIL"} ${destination}`);
process.exitCode = result.pass ? 0 : 1;
