import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const RECOVERY_SEAM_PIXEL_RMSE = 0.001;
const ATTACHED_EFFECT_CORE_HALF_WIDTH = 24;
const START_STOP_FOOT_ANCHOR_RANGE = 0.25;
const START_STOP_FOOT_BOTTOM_RANGE = 1;
const START_STOP_IDLE_WALK_MEDIAN_HEIGHT_DIFFERENCE = 8;

const [timelineFile, outputFile] = process.argv.slice(2);
if (timelineFile === "--self-test-start-stop-height-pop") {
  const control = startStopHeightPopNegativeControl(
    START_STOP_IDLE_WALK_MEDIAN_HEIGHT_DIFFERENCE,
  );
  console.log(JSON.stringify(control));
  process.exit(control.detected ? 0 : 1);
}
if (!timelineFile)
  throw new Error(
    "Usage: node scripts/assess-sequence.mjs <render-manifest-timeline.json> [output.json]",
  );

const timeline = JSON.parse(await fs.readFile(timelineFile, "utf8"));
if (timeline.schemaVersion !== 2 || !Array.isArray(timeline.frames))
  throw new Error("Sequence timeline must use schemaVersion 2");
const frames = timeline.frames;
const trackedEntityId = timeline.trackedEntityId ?? "player";
const profile = timeline.profile ?? "pose";
const presenceContract = timeline.presenceContract ?? "always";
const profiles = new Set([
  "pose",
  "static-pose",
  "loop",
  "one-shot",
  "one-shot-floating",
  "death",
  "anchored-motion",
  "start-stop",
  "projectile",
  "camera-smooth",
]);
if (!profiles.has(profile))
  throw new Error(`Unknown quality profile ${profile}`);
if (!new Set(["always", "present-until", "appears-at"]).has(presenceContract))
  throw new Error(`Unknown presence contract ${presenceContract}`);

const clipDefinitions = {
  idle: { frameCount: 6, durationTicks: 60, looping: true },
  walk: { frameCount: 8, durationTicks: 40, looping: true },
  attack: { frameCount: 6, durationTicks: 26, looping: false },
  ability: { frameCount: 8, durationTicks: 36, looping: false },
  hurt: { frameCount: 4, durationTicks: 12, looping: false },
  death: { frameCount: 8, durationTicks: 48, looping: false },
  loot: { frameCount: 4, durationTicks: 48, looping: true },
  projectile: { frameCount: 1, durationTicks: 1, looping: true },
};

function stateEntity(snapshot, entityId) {
  if (entityId === "player") return snapshot?.player;
  return [
    ...(snapshot?.monsters ?? []),
    ...(snapshot?.projectiles ?? []),
    ...(snapshot?.loot ?? []),
  ].find((entity) => entity.id === entityId);
}

function range(values) {
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
}

function median(values) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function visibleHeightComparison(idleHeights, walkHeights, maximumDifference) {
  const idleMedian = median(idleHeights);
  const walkMedian = median(walkHeights);
  const difference = Math.abs(idleMedian - walkMedian);
  return {
    idleMedian,
    walkMedian,
    difference,
    maximumDifference,
    pass:
      idleHeights.length > 0 &&
      walkHeights.length > 0 &&
      difference <= maximumDifference,
  };
}

function startStopHeightPopNegativeControl(maximumDifference) {
  const baselineIdle = [48, 49, 48, 49, 48, 49];
  const baselineWalk = [...baselineIdle];
  const mutatedWalk = baselineWalk.map(
    (height) => height + maximumDifference + 1,
  );
  const baseline = visibleHeightComparison(
    baselineIdle,
    baselineWalk,
    maximumDifference,
  );
  const mutation = visibleHeightComparison(
    baselineIdle,
    mutatedWalk,
    maximumDifference,
  );
  return {
    id: "start-stop-walk-height-pop",
    expectedCheck: "startStopIdleWalkMedianVisibleHeight",
    mutation: `raise every walk mask by ${maximumDifference + 1} logical pixels`,
    baseline,
    mutated: mutation,
    detected: baseline.pass && !mutation.pass,
  };
}

function validateClipTransitionContract(contract) {
  if (
    !contract ||
    contract.schemaVersion !== 1 ||
    contract.facingBucket !== "east" ||
    !Array.isArray(contract.phases) ||
    contract.phases.length !== 3 ||
    contract.thresholds?.maximumFootAnchorRange !==
      START_STOP_FOOT_ANCHOR_RANGE ||
    contract.thresholds?.maximumFootBottomRange !==
      START_STOP_FOOT_BOTTOM_RANGE ||
    contract.thresholds?.maximumIdleWalkMedianVisibleHeightDifference !==
      START_STOP_IDLE_WALK_MEDIAN_HEIGHT_DIFFERENCE
  )
    throw new Error("Start/stop clip-transition contract is invalid");
  const expectedClips = ["idle", "walk", "idle"];
  for (const [index, phase] of contract.phases.entries()) {
    if (
      typeof phase?.id !== "string" ||
      phase.clip !== expectedClips[index] ||
      !Number.isInteger(phase.clipStartedAtTick) ||
      !Number.isInteger(phase.firstObservedTick) ||
      !Number.isInteger(phase.lastObservedTick) ||
      phase.lastObservedTick < phase.firstObservedTick ||
      !Array.isArray(phase.requiredFrameIndices) ||
      phase.requiredFrameIndices.some(
        (frameIndex) => !Number.isInteger(frameIndex) || frameIndex < 0,
      )
    )
      throw new Error(`Start/stop phase ${index} is invalid`);
  }
  return contract;
}

function observedClipPhases(points) {
  const phases = [];
  for (const point of points) {
    let phase = phases.at(-1);
    if (!phase || phase.clip !== point.actor.clip) {
      phase = {
        clip: point.actor.clip,
        clipStartedAtTick: point.actor.clipStartedAtTick,
        firstObservedTick: point.tick,
        lastObservedTick: point.tick,
        frameIndices: [],
      };
      phases.push(phase);
    }
    phase.lastObservedTick = point.tick;
    if (!phase.frameIndices.includes(point.actor.frameIndex))
      phase.frameIndices.push(point.actor.frameIndex);
  }
  return phases;
}

function phaseSatisfiesContract(observed, expected) {
  return (
    observed?.clip === expected.clip &&
    observed.clipStartedAtTick === expected.clipStartedAtTick &&
    observed.firstObservedTick === expected.firstObservedTick &&
    observed.lastObservedTick === expected.lastObservedTick &&
    expected.requiredFrameIndices.every((frameIndex) =>
      observed.frameIndices.includes(frameIndex),
    )
  );
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : 0;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function close(a, b, tolerance = 0.000001) {
  return (
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance
  );
}

function normalizedPixelRmse(first, second) {
  if (!first || !second || first.length !== second.length) return Infinity;
  let squaredError = 0;
  for (let index = 0; index < first.length; index += 1) {
    const difference = first[index] - second[index];
    squaredError += difference * difference;
  }
  return Math.sqrt(squaredError / first.length) / 255;
}

function coreCentroid(data, info, anchor) {
  const minimumX = Math.max(
    0,
    Math.floor(anchor.x - ATTACHED_EFFECT_CORE_HALF_WIDTH),
  );
  const maximumX = Math.min(
    info.width - 1,
    Math.ceil(anchor.x + ATTACHED_EFFECT_CORE_HALF_WIDTH),
  );
  let weightedX = 0;
  let weightedY = 0;
  let alphaWeight = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3] / 255;
      if (alpha === 0) continue;
      weightedX += x * alpha;
      weightedY += y * alpha;
      alphaWeight += alpha;
    }
  }
  return alphaWeight > 0
    ? { x: weightedX / alphaWeight, y: weightedY / alphaWeight }
    : undefined;
}

function canonicalize(value, key) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    if (
      ["monsters", "pendingAttacks", "projectiles", "loot", "effects"].includes(
        key,
      )
    )
      items.sort((a, b) =>
        String(a?.id ?? "").localeCompare(String(b?.id ?? "")),
      );
    return items;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((name) => [name, canonicalize(value[name], name)]),
    );
  if (typeof value === "number" && !Number.isFinite(value))
    return String(value);
  return value;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function snapshotHash(snapshot) {
  return fnv1a(JSON.stringify(canonicalize(snapshot)));
}

function expectedFrame(call, presentationTick) {
  const elapsed = Math.max(0, presentationTick - call.clipStartedAtTick);
  if (["attack", "ability", "hurt", "death"].includes(call.clip))
    return Math.min(
      call.frameCount - 1,
      Math.floor((elapsed * call.frameCount) / call.clipDurationTicks),
    );
  return Math.floor(
    ((elapsed % call.clipDurationTicks) * call.frameCount) /
      call.clipDurationTicks,
  );
}

const observations = frames.map((frame, index) => {
  if (
    frame.tick !== frame.snapshot?.tick ||
    frame.tick !== frame.manifest?.tick ||
    frame.manifest?.simTick !== frame.snapshot?.tick ||
    !Number.isFinite(frame.manifest?.presentationTick) ||
    !Number.isFinite(frame.manifest?.interpolationAlpha) ||
    frame.manifest.interpolationAlpha < 0 ||
    frame.manifest.interpolationAlpha > 1
  )
    throw new Error(`Tick contract mismatch at capture index ${index}`);
  const actor = frame.manifest?.drawCalls?.find?.(
    (call) => call.entityId === trackedEntityId,
  );
  if (actor && !frame.mask)
    throw new Error(`Pixel mask missing at capture index ${index}`);
  if (!actor && frame.mask)
    throw new Error(
      `Mask exists without a draw call at capture index ${index}`,
    );
  if (frame.mask && frame.mask.entityId !== trackedEntityId)
    throw new Error(`Mask entity mismatch at capture index ${index}`);
  return {
    index,
    tick: frame.tick,
    presentationTick: frame.manifest.presentationTick ?? frame.tick,
    snapshot: frame.snapshot,
    manifest: frame.manifest,
    actor,
    entity: stateEntity(frame.snapshot, trackedEntityId),
    mask: frame.mask,
    stateHash: frame.stateHash,
    files: frame.files,
  };
});
const presence = observations.map(({ actor, mask }) => Boolean(actor && mask));
for (let index = 1; index < observations.length; index += 1) {
  if (
    observations[index].tick < observations[index - 1].tick ||
    observations[index].presentationTick <=
      observations[index - 1].presentationTick
  )
    throw new Error(`Non-monotonic timeline at capture index ${index}`);
}
const firstAbsent = presence.indexOf(false);
const firstPresent = presence.indexOf(true);
const contiguousPresentPrefix =
  firstAbsent < 0 || presence.slice(firstAbsent).every((value) => !value);
const contiguousPresentSuffix =
  firstPresent < 0 || presence.slice(firstPresent).every(Boolean);
const presenceContractSatisfied =
  presenceContract === "always"
    ? presence.every(Boolean)
    : presenceContract === "present-until"
      ? presence[0] === true &&
        presence.at(-1) === false &&
        contiguousPresentPrefix
      : presence[0] === false &&
        presence.at(-1) === true &&
        contiguousPresentSuffix;
const points = observations.filter(({ actor, mask }) => actor && mask);
if (points.length < 2)
  throw new Error(
    "A sequence needs at least two present tracked-entity frames",
  );

let expectedClipTransitionContract = null;
if (profile === "start-stop") {
  let commands;
  try {
    commands = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(timelineFile), "commands.json"),
        "utf8",
      ),
    );
  } catch (error) {
    throw new Error("Start/stop sequence requires commands.json", {
      cause: error,
    });
  }
  expectedClipTransitionContract = validateClipTransitionContract(
    commands.clipTransitionContract,
  );
}

let stateHashMismatches = 0;
let manifestContractErrors = 0;
let artifactIntegrityErrors = 0;
for (const observation of observations) {
  if (snapshotHash(observation.snapshot) !== observation.stateHash)
    stateHashMismatches += 1;
}
for (const point of points) {
  const { actor, entity, manifest, mask } = point;
  const definition = clipDefinitions[actor.clip];
  if (!entity) {
    manifestContractErrors += 1;
    continue;
  }
  if (
    !definition ||
    actor.frameCount !== definition.frameCount ||
    actor.clipDurationTicks !== definition.durationTicks ||
    !Number.isInteger(actor.frameIndex) ||
    actor.frameIndex < 0 ||
    actor.frameIndex >= actor.frameCount ||
    !Number.isFinite(actor.visualPhase) ||
    actor.visualPhase < 0 ||
    actor.visualPhase > 1
  )
    manifestContractErrors += 1;

  const actorAnimation = entity?.animation;
  if (
    actorAnimation &&
    (actor.clip !== actorAnimation.clip ||
      actor.clipStartedAtTick !== actorAnimation.startedAtTick ||
      actor.clipLockedUntilTick !== actorAnimation.lockedUntilTick)
  )
    manifestContractErrors += 1;
  if (
    !actorAnimation &&
    (actor.clipStartedAtTick !==
      (actor.type === "loot"
        ? -entity.bobOffset
        : actor.type === "projectile"
          ? entity.spawnedAtTick
          : 0) ||
      actor.clipLockedUntilTick !==
        (actor.type === "projectile" ? entity.expiresAtTick : 0))
  )
    manifestContractErrors += 1;

  const expectedType =
    trackedEntityId === "player"
      ? "player"
      : entity?.kind && entity?.health !== undefined
        ? "monster"
        : entity?.hostile !== undefined
          ? "projectile"
          : "loot";
  const expectedGeometry =
    expectedType === "player"
      ? `hero:${entity?.classId}`
      : expectedType === "monster"
        ? `monster:${entity?.kind}`
        : expectedType === "projectile"
          ? entity?.hostile
            ? "projectile:hostile"
            : "projectile:friendly"
          : `loot:${entity?.kind}:${entity?.rarity}`;
  const expectedClip = actorAnimation
    ? actorAnimation.clip
    : expectedType === "projectile"
      ? "projectile"
      : "loot";
  const monsterDimensions = {
    ashfang: { width: 128, height: 128 },
    hexer: { width: 112, height: 112 },
    stonekin: { width: 128, height: 128 },
  };
  const expectedDimensions =
    expectedType === "player"
      ? { width: 118, height: 118 }
      : expectedType === "monster"
        ? {
            width:
              monsterDimensions[entity.kind].width * (entity.elite ? 1.16 : 1),
            height:
              monsterDimensions[entity.kind].height * (entity.elite ? 1.16 : 1),
          }
        : expectedType === "loot"
          ? entity.rarity === "relic"
            ? { width: 64, height: 64 }
            : { width: 54, height: 54 }
          : { width: 42, height: 42 };
  const expectedScale =
    expectedType === "player"
      ? 118 / 256
      : expectedType === "monster"
        ? (monsterDimensions[entity.kind].width / 256) *
          (entity.elite ? 1.16 : 1)
        : expectedType === "loot"
          ? entity.rarity === "relic"
            ? 0.25
            : 0.21
          : 0.16;
  const expectedTint = "#ffffff";
  if (
    actor.type !== expectedType ||
    actor.geometryId !== expectedGeometry ||
    actor.clip !== expectedClip ||
    !close(actor.scale, expectedScale) ||
    actor.destinationRect?.width !== Math.round(expectedDimensions.width) ||
    actor.destinationRect?.height !== Math.round(expectedDimensions.height) ||
    actor.bounds?.width !== Math.round(expectedDimensions.width) ||
    actor.bounds?.height !== Math.round(expectedDimensions.height) ||
    actor.tint !== expectedTint
  )
    manifestContractErrors += 1;

  const alpha = manifest.interpolationAlpha;
  const previousPosition = entity?.previousPosition ?? entity?.position;
  const expectedWorld = {
    x: previousPosition.x + (entity.position.x - previousPosition.x) * alpha,
    y: previousPosition.y + (entity.position.y - previousPosition.y) * alpha,
  };
  const expectedFacing =
    expectedType === "projectile"
      ? entity.velocity
      : expectedType === "loot"
        ? { x: 0, y: 0 }
        : entity.facing;
  const expectedScreen = {
    x: 480 + (expectedWorld.x / 1024) * 48 - manifest.camera.x,
    y: 270 + (expectedWorld.y / 1024) * 48 - manifest.camera.y,
  };
  const expectedVisualPhase =
    expectedType === "loot"
      ? ((((point.presentationTick + entity.bobOffset) % 48) + 48) % 48) / 48
      : actor.frameCount <= 1
        ? 0
        : actor.frameIndex / (actor.frameCount - 1);
  if (
    !close(actor.worldAnchor.x, expectedWorld.x) ||
    !close(actor.worldAnchor.y, expectedWorld.y) ||
    !close(actor.facing.x, expectedFacing.x) ||
    !close(actor.facing.y, expectedFacing.y) ||
    !close(actor.screenAnchor.x, expectedScreen.x) ||
    !close(actor.screenAnchor.y, expectedScreen.y) ||
    !close(actor.footAnchor.x, actor.screenAnchor.x) ||
    !close(actor.footAnchor.y, actor.screenAnchor.y) ||
    !close(actor.visualPhase, expectedVisualPhase)
  )
    manifestContractErrors += 1;

  const maskFile = point.files?.maskName;
  if (
    mask?.mode !== "isolated-draw-call" ||
    mask?.maskInternalClipping ||
    typeof maskFile !== "string" ||
    path.basename(maskFile) !== maskFile ||
    typeof mask?.artifactSha256 !== "string"
  ) {
    artifactIntegrityErrors += 1;
    continue;
  }
  try {
    const buffer = await fs.readFile(
      path.join(path.dirname(timelineFile), maskFile),
    );
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== mask.artifactSha256) artifactIntegrityErrors += 1;
    const decoded = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== mask.width ||
      decoded.info.height !== mask.height
    )
      artifactIntegrityErrors += 1;
    point.maskPixels = decoded.data;
    point.coreCentroid = coreCentroid(decoded.data, decoded.info, mask.anchor);
  } catch {
    artifactIntegrityErrors += 1;
  }
}

const anchorsX = points.map(({ actor }) => actor.footAnchor.x);
const anchorsY = points.map(({ actor }) => actor.footAnchor.y);
const maskAnchorsX = points.map(({ mask }) => mask.anchor.x);
const maskAnchorsY = points.map(({ mask }) => mask.anchor.y);
const maskBottomOffsets = points.map(({ mask }) => mask.bottomOffset);
const maskWidths = points.map(({ mask }) => mask.inkBounds.width);
const maskHeights = points.map(({ mask }) => mask.inkBounds.height);
const maskAreas = points.map(({ mask }) => mask.alphaPixels);
const idleVisibleHeights = points
  .filter(({ actor }) => actor.clip === "idle")
  .map(({ mask }) => mask.inkBounds.height);
const walkVisibleHeights = points
  .filter(({ actor }) => actor.clip === "walk")
  .map(({ mask }) => mask.inkBounds.height);
const frameErrors = points.map(({ actor, presentationTick }) =>
  Math.abs(actor.frameIndex - expectedFrame(actor, presentationTick)),
);
const worldSpeeds = [];
const velocityErrors = [];
const frameAdvances = [];
const centroidSteps = [];
const centroidAccelerations = [];
const coreCentroidSteps = [];
const coreCentroidAccelerations = [];
const inkWidthSteps = [];
const inkHeightSteps = [];
const cameraErrors = points.map(({ manifest }) =>
  distance(manifest.camera, manifest.cameraTarget),
);
const cameraVelocities = [];
let previousCentroidVelocity;
let previousCoreCentroidVelocity;
let oneShotBackwardJumps = 0;
let recoveryTransitions = 0;
let recoverySeamMismatches = 0;
const recoverySeamPixelRmses = [];
let loopWraps = 0;

for (let index = 1; index < points.length; index += 1) {
  const previous = points[index - 1];
  const current = points[index];
  const tickDelta = current.presentationTick - previous.presentationTick;
  if (tickDelta <= 0)
    throw new Error(`Non-increasing presentation tick at index ${index}`);
  const worldDelta = {
    x: current.actor.worldAnchor.x - previous.actor.worldAnchor.x,
    y: current.actor.worldAnchor.y - previous.actor.worldAnchor.y,
  };
  worldSpeeds.push(Math.hypot(worldDelta.x, worldDelta.y) / tickDelta);
  const velocity = current.entity?.velocity ?? { x: 0, y: 0 };
  velocityErrors.push(
    Math.hypot(
      worldDelta.x - velocity.x * tickDelta,
      worldDelta.y - velocity.y * tickDelta,
    ),
  );
  if (current.actor.clip === previous.actor.clip) {
    const looping = ["idle", "walk", "loot", "projectile"].includes(
      current.actor.clip,
    );
    const advance = looping
      ? (current.actor.frameIndex -
          previous.actor.frameIndex +
          current.actor.frameCount) %
        current.actor.frameCount
      : current.actor.frameIndex - previous.actor.frameIndex;
    frameAdvances.push(advance);
    if (looping && current.actor.frameIndex < previous.actor.frameIndex)
      loopWraps += 1;
    if (!looping && advance < 0) oneShotBackwardJumps += 1;
  }
  if (
    ["attack", "ability", "hurt"].includes(previous.actor.clip) &&
    previous.actor.frameIndex === previous.actor.frameCount - 1 &&
    current.actor.clip === "idle"
  ) {
    recoveryTransitions += 1;
    const seamRmse = normalizedPixelRmse(
      previous.maskPixels,
      current.maskPixels,
    );
    recoverySeamPixelRmses.push(seamRmse);
    if (
      seamRmse > RECOVERY_SEAM_PIXEL_RMSE ||
      distance(previous.mask.centroid, current.mask.centroid) > 0.25 ||
      previous.mask.inkBounds.width !== current.mask.inkBounds.width ||
      previous.mask.inkBounds.height !== current.mask.inkBounds.height ||
      previous.mask.alphaPixels !== current.mask.alphaPixels
    )
      recoverySeamMismatches += 1;
  }
  const centroidVelocity = {
    x: (current.mask.centroid.x - previous.mask.centroid.x) / tickDelta,
    y: (current.mask.centroid.y - previous.mask.centroid.y) / tickDelta,
  };
  centroidSteps.push(distance(current.mask.centroid, previous.mask.centroid));
  const previousCore = previous.coreCentroid ?? previous.mask.centroid;
  const currentCore = current.coreCentroid ?? current.mask.centroid;
  coreCentroidSteps.push(distance(currentCore, previousCore));
  if (previousCentroidVelocity)
    centroidAccelerations.push(
      distance(centroidVelocity, previousCentroidVelocity),
    );
  previousCentroidVelocity = centroidVelocity;
  const coreCentroidVelocity = {
    x: (currentCore.x - previousCore.x) / tickDelta,
    y: (currentCore.y - previousCore.y) / tickDelta,
  };
  if (previousCoreCentroidVelocity)
    coreCentroidAccelerations.push(
      distance(coreCentroidVelocity, previousCoreCentroidVelocity),
    );
  previousCoreCentroidVelocity = coreCentroidVelocity;
  inkWidthSteps.push(
    Math.abs(current.mask.inkBounds.width - previous.mask.inkBounds.width),
  );
  inkHeightSteps.push(
    Math.abs(current.mask.inkBounds.height - previous.mask.inkBounds.height),
  );
  cameraVelocities.push({
    x: (current.manifest.camera.x - previous.manifest.camera.x) / tickDelta,
    y: (current.manifest.camera.y - previous.manifest.camera.y) / tickDelta,
    duration: tickDelta,
  });
}

const cameraAccelerations = cameraVelocities
  .slice(1)
  .map(
    (velocity, index) =>
      distance(velocity, cameraVelocities[index]) / velocity.duration,
  );
const actualInkClipping = points.some(({ actor, manifest, mask }) => {
  const left = actor.screenAnchor.x + mask.inkBounds.x - mask.anchor.x;
  const top = actor.screenAnchor.y + mask.inkBounds.y - mask.anchor.y;
  return (
    left < 0 ||
    top < 0 ||
    left + mask.inkBounds.width > manifest.viewport.width ||
    top + mask.inkBounds.height > manifest.viewport.height
  );
});
const renderedVisibility = points.map(({ mask }) => mask.renderVisible);
const visualSignatures = new Map();
let geometryEnvelopeViolations = 0;
for (const { actor, mask } of points) {
  const signature = JSON.stringify({
    geometryId: actor.geometryId,
    clip: actor.clip,
    frameIndex: actor.frameIndex,
    visualPhase: actor.visualPhase,
    facing: actor.facing,
    scale: actor.scale,
    tint: actor.tint,
  });
  const hashes = visualSignatures.get(signature) ?? new Set();
  hashes.add(mask.pixelHash);
  visualSignatures.set(signature, hashes);
  const minimumArea =
    actor.type === "player" || actor.type === "monster"
      ? 100
      : actor.type === "loot"
        ? 20
        : 10;
  const minimumDimension =
    actor.type === "player" || actor.type === "monster" ? 10 : 3;
  const aspect = mask.inkBounds.width / mask.inkBounds.height;
  if (
    mask.alphaPixels < minimumArea ||
    mask.inkBounds.width < minimumDimension ||
    mask.inkBounds.height < minimumDimension ||
    aspect < 0.1 ||
    aspect > 10
  )
    geometryEnvelopeViolations += 1;
}
const renderSignatureMismatches = [...visualSignatures.values()].filter(
  (hashes) => hashes.size > 1,
).length;
const cameraErrorIncreases = cameraErrors
  .slice(1)
  .filter((error, index) => error > cameraErrors[index] + 0.001).length;
const oneShotClips = points.filter(({ actor }) =>
  ["attack", "ability", "hurt"].includes(actor.clip),
);
const sawOneShotTerminal = oneShotClips.some(
  ({ actor }) => actor.frameIndex === actor.frameCount - 1,
);
const sawOneShotStart = oneShotClips.some(
  ({ actor }) => actor.frameIndex === 0,
);
const deathClips = points.filter(({ actor }) => actor.clip === "death");
const sawDeathStart = deathClips.some(({ actor }) => actor.frameIndex === 0);
const sawDeathTerminal = deathClips.some(
  ({ actor }) => actor.frameIndex === actor.frameCount - 1,
);
const loopFrameCount = points[0]?.actor.frameCount ?? 0;
const loopFramesCovered = new Set(points.map(({ actor }) => actor.frameIndex));
const requiresMotion = ["anchored-motion", "projectile"].includes(profile);
const requiresAnchor = [
  "pose",
  "one-shot",
  "anchored-motion",
  "death",
].includes(profile);
const requiresAnimation = [
  "pose",
  "loop",
  "one-shot",
  "one-shot-floating",
  "death",
  "anchored-motion",
  "start-stop",
].includes(profile);
const oneShotProfile = ["one-shot", "one-shot-floating"].includes(profile);
const samplesInsideSimulationTick = points.some(
  (point, index) =>
    index > 0 &&
    point.presentationTick - points[index - 1].presentationTick < 1,
);

const startStopObservedPhases =
  profile === "start-stop" ? observedClipPhases(points) : [];
const startStopPhaseContractSatisfied =
  profile !== "start-stop" ||
  (startStopObservedPhases.length ===
    expectedClipTransitionContract.phases.length &&
    expectedClipTransitionContract.phases.every((phase, index) =>
      phaseSatisfiesContract(startStopObservedPhases[index], phase),
    ));
const startStopFacingSatisfied =
  profile !== "start-stop" ||
  points.every(
    ({ actor }) =>
      actor.facingBucket === expectedClipTransitionContract.facingBucket,
  );
const startStopHeightComparison = visibleHeightComparison(
  idleVisibleHeights,
  walkVisibleHeights,
  START_STOP_IDLE_WALK_MEDIAN_HEIGHT_DIFFERENCE,
);
const startStopNegativeControl = startStopHeightPopNegativeControl(
  START_STOP_IDLE_WALK_MEDIAN_HEIGHT_DIFFERENCE,
);

const thresholds = {
  semanticFrameError: 0,
  footAnchorRange: 0.25,
  velocityError: 0,
  speedRange: 0.01,
  inkBottomRange: profile === "death" ? 18 : 1,
  // Authored attack contacts can legitimately move a weapon-heavy silhouette
  // farther than locomotion without constituting a pop. The tighter limit is
  // retained for loops and walking; visual review still has veto authority.
  inkCentroidStep:
    profile === "death" ? 32 : profile.startsWith("one-shot") ? 24 : 18,
  // Quarter-tick captures intentionally hold a discrete authored pose between
  // atlas boundaries. Normalize only that sampling profile; full-tick loops
  // and actions retain the tighter acceleration gate.
  inkCentroidAcceleration:
    profile === "death" ? 32 : samplesInsideSimulationTick ? 24 : 18,
  inkDimensionStep: profile === "death" ? 48 : 32,
  // One-shot frames may carry a shield spark, hand flash, or ground pulse.
  // Permit that attached effect to expand only while the actor's center stays
  // substantially steadier than the normal pose-continuity limits.
  attachedEffectDimensionStep: 42,
  attachedEffectCoreHalfWidth: ATTACHED_EFFECT_CORE_HALF_WIDTH,
  attachedEffectCentroidStep: 16,
  attachedEffectCentroidAcceleration: 10,
  recoverySeamPixelRmse: RECOVERY_SEAM_PIXEL_RMSE,
  cameraAcceleration: 40,
  cameraFinalError: 2,
  oneShotVisualPoses: 5,
  startStopFootAnchorRange: START_STOP_FOOT_ANCHOR_RANGE,
  startStopFootBottomRange: START_STOP_FOOT_BOTTOM_RANGE,
  startStopIdleWalkMedianVisibleHeightDifference:
    START_STOP_IDLE_WALK_MEDIAN_HEIGHT_DIFFERENCE,
};
const measurements = {
  profile,
  presenceContract,
  trackedEntityId,
  frames: observations.length,
  presentFrames: points.length,
  uniqueSemanticFrames: new Set(
    points.map(({ actor }) => `${actor.clip}:${actor.frameIndex}`),
  ).size,
  uniquePixelMasks: new Set(points.map(({ mask }) => mask.pixelHash)).size,
  footAnchorRangeX: range(anchorsX),
  footAnchorRangeY: range(anchorsY),
  isolatedMaskFootAnchorRangeX: range(maskAnchorsX),
  isolatedMaskFootAnchorRangeY: range(maskAnchorsY),
  velocityErrorPeak: maximum(velocityErrors),
  speedRange: range(worldSpeeds),
  maximumFrameAdvance: maximum(frameAdvances),
  semanticFrameErrorPeak: maximum(frameErrors),
  oneShotBackwardJumps,
  recoveryTransitions,
  recoverySeamMismatches,
  recoverySeamPixelRmsePeak: maximum(recoverySeamPixelRmses),
  loopWraps,
  inkBottomRange: range(maskBottomOffsets),
  inkWidthRange: range(maskWidths),
  inkHeightRange: range(maskHeights),
  inkAreaRange: range(maskAreas),
  idleMedianVisibleHeight: startStopHeightComparison.idleMedian,
  walkMedianVisibleHeight: startStopHeightComparison.walkMedian,
  idleWalkMedianVisibleHeightDifference: startStopHeightComparison.difference,
  inkCentroidStepPeak: maximum(centroidSteps),
  inkCentroidAccelerationPeak: maximum(centroidAccelerations),
  coreCentroidStepPeak: maximum(coreCentroidSteps),
  coreCentroidAccelerationPeak: maximum(coreCentroidAccelerations),
  inkWidthStepPeak: maximum(inkWidthSteps),
  inkHeightStepPeak: maximum(inkHeightSteps),
  actualInkClipping,
  renderVisibleFrames: renderedVisibility.filter(Boolean).length,
  cameraErrorStart: cameraErrors[0] ?? 0,
  cameraErrorEnd: cameraErrors.at(-1) ?? 0,
  cameraErrorIncreases,
  cameraAccelerationPeak: maximum(cameraAccelerations),
  stateHashMismatches,
  manifestContractErrors,
  artifactIntegrityErrors,
  renderSignatureMismatches,
  geometryEnvelopeViolations,
};
const attachedEffectBloomIsContinuous =
  oneShotProfile &&
  measurements.inkWidthStepPeak <= thresholds.attachedEffectDimensionStep &&
  measurements.inkHeightStepPeak <= thresholds.attachedEffectDimensionStep &&
  measurements.coreCentroidStepPeak <= thresholds.attachedEffectCentroidStep &&
  measurements.coreCentroidAccelerationPeak <=
    thresholds.attachedEffectCentroidAcceleration;
const checks = {
  enoughFrames: measurements.frames >= 6 && measurements.presentFrames >= 2,
  presenceContract: presenceContractSatisfied,
  stateHashesExact: stateHashMismatches === 0,
  stateManifestContract: manifestContractErrors === 0,
  savedMaskArtifactsExact: artifactIntegrityErrors === 0,
  renderSignatureDeterministic: renderSignatureMismatches === 0,
  geometryEnvelope: geometryEnvelopeViolations === 0,
  actualInkVisible: points.every(({ mask }) => mask.alphaPixels > 0),
  trackedEntityVisibility:
    profile === "camera-smooth"
      ? renderedVisibility.at(-1) === true
      : renderedVisibility.every(Boolean),
  actualInkInsideViewport: profile === "camera-smooth" || !actualInkClipping,
  semanticFrameExact:
    measurements.semanticFrameErrorPeak <= thresholds.semanticFrameError,
  animationNotStuck: !requiresAnimation || measurements.uniquePixelMasks >= 2,
  oneShotVisualPoses:
    !oneShotProfile ||
    measurements.uniquePixelMasks >= thresholds.oneShotVisualPoses,
  semanticAnimationChanges:
    !requiresAnimation || measurements.uniqueSemanticFrames >= 2,
  semanticFrameCadence: measurements.maximumFrameAdvance <= 1,
  loopLifecycle:
    profile !== "loop" ||
    (loopFramesCovered.size === loopFrameCount && loopWraps >= 1),
  startStopClipTransitionContract: startStopPhaseContractSatisfied,
  startStopEastFacing: startStopFacingSatisfied,
  startStopFootAnchorStable:
    profile !== "start-stop" ||
    (measurements.isolatedMaskFootAnchorRangeX <=
      thresholds.startStopFootAnchorRange &&
      measurements.isolatedMaskFootAnchorRangeY <=
        thresholds.startStopFootAnchorRange),
  startStopFootBottomStable:
    profile !== "start-stop" ||
    measurements.inkBottomRange <= thresholds.startStopFootBottomRange,
  startStopIdleWalkMedianVisibleHeight:
    profile !== "start-stop" || startStopHeightComparison.pass,
  startStopHeightPopNegativeControl:
    profile !== "start-stop" || startStopNegativeControl.detected,
  screenAnchorStable:
    !requiresAnchor ||
    (measurements.footAnchorRangeX <= thresholds.footAnchorRange &&
      measurements.footAnchorRangeY <= thresholds.footAnchorRange),
  actualGroundingStable:
    !requiresAnchor || measurements.inkBottomRange <= thresholds.inkBottomRange,
  actualPoseContinuous:
    measurements.inkCentroidStepPeak <= thresholds.inkCentroidStep &&
    measurements.inkCentroidAccelerationPeak <=
      thresholds.inkCentroidAcceleration &&
    ((measurements.inkWidthStepPeak <= thresholds.inkDimensionStep &&
      measurements.inkHeightStepPeak <= thresholds.inkDimensionStep) ||
      attachedEffectBloomIsContinuous),
  attachedEffectBloomIsContinuous:
    !oneShotProfile ||
    (measurements.inkWidthStepPeak <= thresholds.inkDimensionStep &&
      measurements.inkHeightStepPeak <= thresholds.inkDimensionStep) ||
    attachedEffectBloomIsContinuous,
  motionMatchesState:
    !requiresMotion ||
    measurements.velocityErrorPeak <= thresholds.velocityError,
  constantMotion:
    !requiresMotion || measurements.speedRange <= thresholds.speedRange,
  oneShotFrameOrder: measurements.oneShotBackwardJumps === 0,
  oneShotLifecycle:
    !oneShotProfile ||
    (sawOneShotStart &&
      sawOneShotTerminal &&
      measurements.recoveryTransitions >= 1),
  oneShotRecoverySeam:
    !oneShotProfile || measurements.recoverySeamMismatches === 0,
  deathLifecycle:
    profile !== "death" ||
    (presenceContract === "present-until" &&
      sawDeathStart &&
      sawDeathTerminal &&
      presence.at(-1) === false),
  cameraConverges:
    profile !== "camera-smooth" ||
    (measurements.cameraErrorEnd < measurements.cameraErrorStart &&
      measurements.cameraErrorIncreases === 0 &&
      measurements.cameraErrorEnd <= thresholds.cameraFinalError),
  cameraAcceleration:
    profile !== "camera-smooth" ||
    measurements.cameraAccelerationPeak <= thresholds.cameraAcceleration,
};
const result = {
  schemaVersion: 2,
  thresholds,
  measurements,
  clipTransitionContract:
    profile === "start-stop"
      ? {
          schemaVersion: 1,
          expected: expectedClipTransitionContract,
          observed: {
            facingBuckets: [
              ...new Set(points.map(({ actor }) => actor.facingBucket)),
            ],
            phases: startStopObservedPhases,
          },
          pass: startStopPhaseContractSatisfied && startStopFacingSatisfied,
        }
      : null,
  negativeControls: profile === "start-stop" ? [startStopNegativeControl] : [],
  checks,
  pass: Object.values(checks).every(Boolean),
};
const destination =
  outputFile ??
  path.join(path.dirname(timelineFile), "animation-analysis.json");
await fs.writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.pass ? "PASS" : "FAIL"} ${destination}`);
process.exitCode = result.pass ? 0 : 1;
