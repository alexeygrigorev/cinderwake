export const DEPTH_TRANSITION_SIGNAL_IDS = [
  "z-order-follows-foot-boundary",
  "attachments-follow-owner",
  "health-effect-occlusion-in-range",
  "state-manifest-anchors-reconcile",
  "ordered-combat-transition",
];

export const DEPTH_TRANSITION_FAILURE_IDS = [
  "paint-z-order-mismatch",
  "depth-order-mismatch",
  "health-z-order-mismatch",
  "effect-owner-detached",
  "duplicate-owner-body",
  "actor-depth-inverted",
  "health-occlusion-ratio-exceeded",
  "effect-owner-occlusion-ratio-exceeded",
  "presentation-offset-mismatch",
  "state-manifest-anchor-mismatch",
  "combat-sequence-mismatch",
];

export const DEPTH_TRANSITION_LIMITS = {
  maximumAttachedEffectAnchorDistance: 1,
  maximumHealthWidthActorRatio: 0.37,
  maximumHealthHeightActorRatio: 0.18,
  minimumHealthInkGap: 3,
  maximumHealthInkGap: 5,
  maximumHealthCenterOffset: 1,
  maximumHealthActorOverlapRatio: 0.08,
  maximumEffectOwnerOverlapRatio: 0.35,
  maximumHealthFrameOpacity: 0.85,
  maximumHealthFillOpacity: 0.75,
  maximumEffectOpacity: 0.65,
  positionTolerance: 0.01,
};

const ACTOR_TYPES = new Set(["player", "monster", "npc"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function position(value) {
  return object(value) && finite(value.x) && finite(value.y) ? value : null;
}

function rectangle(value) {
  return object(value) &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    finite(value.height)
    ? value
    : null;
}

function intersects(first, second) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function screenFor(world, camera) {
  return {
    x: 480 + ((world.x / 1024) * 48 - camera.x) * camera.zoom,
    y: 270 + ((world.y / 1024) * 48 - camera.y) * camera.zoom,
  };
}

function uniquePush(list, value) {
  if (!list.includes(value)) list.push(value);
}

function queueFor(manifest) {
  return Array.isArray(manifest?.paintQueue) ? manifest.paintQueue : [];
}

function queueIndex(queue, paintId) {
  return queue.findIndex(({ paintId: candidate }) => candidate === paintId);
}

function bodyItems(queue) {
  return queue.filter(({ kind }) => kind === "entity-body");
}

function actorCalls(manifest) {
  return (manifest?.drawCalls ?? []).filter(({ type }) =>
    ACTOR_TYPES.has(type),
  );
}

function stateEntity(snapshot, entityId) {
  if (entityId === "player") return snapshot?.player ?? null;
  return (
    (snapshot?.monsters ?? []).find(({ id }) => id === entityId) ??
    (snapshot?.effects ?? []).find(({ id }) => id === entityId) ??
    null
  );
}

function expectedWorldAnchor(snapshot, entityId, alpha) {
  const entity = stateEntity(snapshot, entityId);
  if (!entity || !position(entity.position)) return null;
  if (!position(entity.previousPosition)) return entity.position;
  return {
    x:
      entity.previousPosition.x +
      (entity.position.x - entity.previousPosition.x) * alpha,
    y:
      entity.previousPosition.y +
      (entity.position.y - entity.previousPosition.y) * alpha,
  };
}

function maskMetric(frame, paintId) {
  return (frame?.masks ?? []).find(
    ({ paintId: candidate }) => candidate === paintId,
  );
}

function ratio(overlapPixels, denominator) {
  if (!finite(overlapPixels) || !finite(denominator) || denominator <= 0)
    return Number.POSITIVE_INFINITY;
  return overlapPixels / denominator;
}

function checkQueue(frame, violations, summary) {
  const queue = queueFor(frame.manifest);
  const ids = new Set();
  for (const [index, item] of queue.entries()) {
    if (item.zOrder !== index)
      uniquePush(violations, `paint-z-order-mismatch:${item.paintId}`);
    if (ids.has(item.paintId))
      uniquePush(violations, `paint-z-order-mismatch:${item.paintId}`);
    ids.add(item.paintId);
  }
  summary.paintCount = queue.length;
}

function checkActorBodies(frame, violations, summary) {
  const queue = queueFor(frame.manifest);
  const bodyEntries = bodyItems(queue);
  const calls = actorCalls(frame.manifest);
  for (const actor of calls) {
    const copies = bodyEntries.filter(
      ({ ownerId }) => ownerId === actor.entityId,
    );
    if (copies.length !== 1)
      uniquePush(violations, `duplicate-owner-body:${actor.entityId}`);
    const body = copies[0];
    if (!body) continue;
    const bodyIndex = queue.indexOf(body);
    const shadowIndex = queueIndex(queue, `shadow:${actor.entityId}`);
    if (shadowIndex >= bodyIndex)
      uniquePush(violations, `shadow-z-order-mismatch:${actor.entityId}`);
    const healthIndex = queueIndex(queue, `health-frame:${actor.entityId}`);
    const fillIndex = queueIndex(queue, `health-fill:${actor.entityId}`);
    if (healthIndex >= 0 && healthIndex <= bodyIndex)
      uniquePush(violations, `health-z-order-mismatch:${actor.entityId}`);
    if (fillIndex >= 0 && (healthIndex < 0 || fillIndex <= healthIndex))
      uniquePush(violations, `health-z-order-mismatch:${actor.entityId}`);
  }

  let actorIntersections = 0;
  for (let firstIndex = 0; firstIndex < calls.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < calls.length;
      secondIndex += 1
    ) {
      const first = calls[firstIndex];
      const second = calls[secondIndex];
      const firstRect = rectangle(first.destinationRect);
      const secondRect = rectangle(second.destinationRect);
      if (!firstRect || !secondRect || !intersects(firstRect, secondRect))
        continue;
      actorIntersections += 1;
      const firstBody = bodyEntries.find(
        ({ ownerId }) => ownerId === first.entityId,
      );
      const secondBody = bodyEntries.find(
        ({ ownerId }) => ownerId === second.entityId,
      );
      if (!firstBody || !secondBody) continue;
      const footDelta = first.footAnchor.y - second.footAnchor.y;
      const firstPaintIndex = queue.indexOf(firstBody);
      const secondPaintIndex = queue.indexOf(secondBody);
      const correct =
        Math.abs(footDelta) < 0.01
          ? firstPaintIndex < secondPaintIndex
          : footDelta < 0
            ? firstPaintIndex < secondPaintIndex
            : firstPaintIndex > secondPaintIndex;
      if (!correct)
        uniquePush(
          violations,
          `actor-depth-inverted:${first.entityId}:${second.entityId}`,
        );
    }
  }
  summary.actorIntersections = actorIntersections;
}

function checkDepthSample(frame, violations, summary) {
  const sample = object(frame.depth);
  if (!sample) return;
  const actor = (frame.manifest?.drawCalls ?? []).find(
    ({ entityId }) => entityId === sample.actorId,
  );
  const scene = (frame.manifest?.sceneSprites ?? []).find(
    ({ objectId }) => objectId === sample.occluderId,
  );
  const queue = queueFor(frame.manifest);
  const actorIndex = queueIndex(
    queue,
    sample.actorPaintId ?? `body:${sample.actorId}`,
  );
  const sceneIndex = queueIndex(
    queue,
    sample.occluderPaintId ?? `scene:${sample.occluderId}`,
  );
  if (!actor || !scene || actorIndex < 0 || sceneIndex < 0) {
    uniquePush(violations, `depth-order-mismatch:${sample.occluderId}`);
    return;
  }
  const actorRect = rectangle(actor.destinationRect);
  const sceneRect = rectangle(scene.destinationRect);
  if (!actorRect || !sceneRect || !intersects(actorRect, sceneRect)) {
    uniquePush(violations, `depth-order-mismatch:${sample.occluderId}`);
    return;
  }
  if (!finite(sample.alphaIntersection) || sample.alphaIntersection <= 0)
    uniquePush(violations, `depth-order-mismatch:${sample.occluderId}`);
  const actorIsSouth = actor.footAnchor.y >= scene.screenAnchor.y;
  const correct = actorIsSouth
    ? actorIndex > sceneIndex
    : actorIndex < sceneIndex;
  if (!correct)
    uniquePush(violations, `depth-order-mismatch:${sample.occluderId}`);
  summary.depthSamples = (summary.depthSamples ?? 0) + 1;
}

function checkTransitions(evidence, frameMap, violations, summary) {
  for (const transition of evidence.transitions ?? []) {
    const behind = frameMap.get(transition.behindFrameId);
    const front = frameMap.get(transition.frontFrameId);
    if (!behind || !front) {
      uniquePush(violations, `depth-order-mismatch:${transition.occluderId}`);
      continue;
    }
    const samples = [behind, front].map((frame) => ({
      frame,
      actorId: transition.actorId,
      occluderId: transition.occluderId,
    }));
    const orders = samples.map(({ frame, actorId, occluderId }) => {
      const actor = frame.manifest?.drawCalls?.find(
        ({ entityId }) => entityId === actorId,
      );
      const scene = frame.manifest?.sceneSprites?.find(
        ({ objectId }) => objectId === occluderId,
      );
      const queue = queueFor(frame.manifest);
      const actorIndex = queueIndex(queue, `body:${actorId}`);
      const sceneIndex = queueIndex(queue, `scene:${occluderId}`);
      if (!actor || !scene || actorIndex < 0 || sceneIndex < 0) return null;
      return {
        actorBeforeScene: actorIndex < sceneIndex,
        intersects: finite(frame.depth?.alphaIntersection)
          ? frame.depth.alphaIntersection > 0
          : false,
      };
    });
    if (
      !orders[0] ||
      !orders[1] ||
      !orders[0].intersects ||
      !orders[1].intersects ||
      orders[0].actorBeforeScene === orders[1].actorBeforeScene
    )
      uniquePush(violations, `depth-order-mismatch:${transition.occluderId}`);
    else summary.transitions = (summary.transitions ?? 0) + 1;
  }
}

function checkAttachments(frame, evidence, violations, summary) {
  const calls = frame.manifest?.drawCalls ?? [];
  const actors = actorCalls(frame.manifest);
  const queue = queueFor(frame.manifest);
  const requiredOwners = new Set([
    ...(evidence.requiredEffectOwnerIds ?? []),
    ...(frame.requiredEffectOwnerIds ?? []),
  ]);
  const seenOwners = new Set();
  for (const effect of calls.filter(({ type }) => type === "effect")) {
    if (!effect.ownerId) continue;
    seenOwners.add(effect.ownerId);
    const owner = actors.find(({ entityId }) => entityId === effect.ownerId);
    const effectIndex = queueIndex(queue, `body:${effect.entityId}`);
    const ownerIndex = queueIndex(queue, `body:${effect.ownerId}`);
    const attached =
      owner &&
      distance(effect.screenAnchor, owner.screenAnchor) <=
        DEPTH_TRANSITION_LIMITS.maximumAttachedEffectAnchorDistance;
    if (
      !owner ||
      !attached ||
      effectIndex < 0 ||
      ownerIndex < 0 ||
      effectIndex >= ownerIndex
    )
      uniquePush(violations, `effect-owner-detached:${effect.entityId}`);
    const metric = (frame.effectMetrics ?? []).find(
      ({ effectId }) => effectId === effect.entityId,
    );
    if (metric) {
      const overlapRatio = ratio(metric.overlapPixels, metric.ownerAlphaPixels);
      const opacity = metric.opacity ?? effect.opacity;
      if (
        overlapRatio > DEPTH_TRANSITION_LIMITS.maximumEffectOwnerOverlapRatio ||
        opacity > DEPTH_TRANSITION_LIMITS.maximumEffectOpacity
      )
        uniquePush(
          violations,
          `effect-owner-occlusion-ratio-exceeded:${effect.entityId}`,
        );
    }
    summary.attachments = (summary.attachments ?? 0) + 1;
  }
  for (const ownerId of requiredOwners)
    if (!seenOwners.has(ownerId))
      uniquePush(violations, `effect-owner-detached:${ownerId}`);
}

function checkHealth(frame, evidence, violations, summary) {
  const manifest = frame.manifest;
  const calls = manifest?.drawCalls ?? [];
  const monsters = calls.filter(
    ({ type, visible }) => type === "monster" && visible,
  );
  const worldUi = Array.isArray(manifest?.worldUi) ? manifest.worldUi : [];
  const queue = queueFor(manifest);
  for (const monster of monsters)
    if (!worldUi.some(({ ownerId }) => ownerId === monster.entityId))
      uniquePush(violations, `health-z-order-mismatch:${monster.entityId}`);
  for (const health of worldUi) {
    const owner = calls.find(({ entityId }) => entityId === health.ownerId);
    if (!owner) {
      uniquePush(violations, `health-z-order-mismatch:${health.ownerId}`);
      continue;
    }
    const bodyIndex = queueIndex(queue, `body:${health.ownerId}`);
    const frameIndex = queueIndex(queue, `health-frame:${health.ownerId}`);
    const fillIndex = queueIndex(queue, `health-fill:${health.ownerId}`);
    if (bodyIndex < 0 || frameIndex <= bodyIndex || fillIndex <= frameIndex)
      uniquePush(violations, `health-z-order-mismatch:${health.ownerId}`);
    const widthRatio =
      health.destinationRect.width / owner.destinationRect.width;
    const heightRatio =
      health.destinationRect.height / owner.destinationRect.height;
    const inkGap =
      health.actorInkTop -
      (health.destinationRect.y + health.destinationRect.height);
    const centerOffset = Math.abs(
      health.destinationRect.x +
        health.destinationRect.width / 2 -
        (owner.destinationRect.x + owner.destinationRect.width / 2),
    );
    const metric = (frame.healthMetrics ?? []).find(
      ({ ownerId }) => ownerId === health.ownerId,
    );
    const healthOverlap = metric
      ? Math.max(
          ratio(metric.frameOverlapPixels, metric.ownerAlphaPixels),
          ratio(metric.fillOverlapPixels, metric.ownerAlphaPixels),
        )
      : 0;
    if (
      widthRatio > DEPTH_TRANSITION_LIMITS.maximumHealthWidthActorRatio ||
      heightRatio > DEPTH_TRANSITION_LIMITS.maximumHealthHeightActorRatio ||
      healthOverlap > DEPTH_TRANSITION_LIMITS.maximumHealthActorOverlapRatio ||
      health.frameOpacity > DEPTH_TRANSITION_LIMITS.maximumHealthFrameOpacity ||
      health.fillOpacity > DEPTH_TRANSITION_LIMITS.maximumHealthFillOpacity
    )
      uniquePush(
        violations,
        `health-occlusion-ratio-exceeded:${health.ownerId}`,
      );
    if (
      inkGap < DEPTH_TRANSITION_LIMITS.minimumHealthInkGap ||
      inkGap > DEPTH_TRANSITION_LIMITS.maximumHealthInkGap ||
      centerOffset > DEPTH_TRANSITION_LIMITS.maximumHealthCenterOffset
    )
      uniquePush(
        violations,
        `health-occlusion-ratio-exceeded:${health.ownerId}`,
      );
    if (metric) {
      const frameMask = maskMetric(frame, metric.framePaintId);
      const fillMask = maskMetric(frame, metric.fillPaintId);
      if (
        !frameMask ||
        !fillMask ||
        frameMask.alphaPixels <= 0 ||
        fillMask.alphaPixels <= 0
      )
        uniquePush(
          violations,
          `health-occlusion-ratio-exceeded:${health.ownerId}`,
        );
    }
    summary.health = (summary.health ?? 0) + 1;
  }
}

function checkStateManifest(frame, violations, summary) {
  const snapshot = frame.snapshot;
  const manifest = frame.manifest;
  if (!snapshot || !manifest) return;
  const alpha = finite(manifest.interpolationAlpha)
    ? manifest.interpolationAlpha
    : 1;
  const camera = manifest.camera;
  if (!object(camera)) {
    uniquePush(violations, `state-manifest-anchor-mismatch:${frame.id}`);
    return;
  }
  for (const call of (manifest.drawCalls ?? []).filter(
    ({ type }) => ACTOR_TYPES.has(type) || type === "effect",
  )) {
    const expectedWorld = expectedWorldAnchor(snapshot, call.entityId, alpha);
    if (!expectedWorld) continue;
    if (
      distance(call.worldAnchor, expectedWorld) >
      DEPTH_TRANSITION_LIMITS.positionTolerance
    ) {
      uniquePush(violations, `state-manifest-anchor-mismatch:${call.entityId}`);
      continue;
    }
    const projected = screenFor(expectedWorld, camera);
    const offset = call.presentationOffset ?? { x: 0, y: 0 };
    const expectedScreen = {
      x: projected.x + offset.x,
      y: projected.y + offset.y,
    };
    if (
      distance(call.screenAnchor, expectedScreen) >
      DEPTH_TRANSITION_LIMITS.positionTolerance
    )
      uniquePush(violations, `presentation-offset-mismatch:${call.entityId}`);
  }
  summary.reconciledAnchors = (summary.reconciledAnchors ?? 0) + 1;
}

function checkCombatSequence(evidence, frameMap, violations, summary) {
  const lifecycle = evidence.combatLifecycle ?? [];
  if (lifecycle.length === 0) return;
  let previousTick = Number.NEGATIVE_INFINITY;
  for (const expected of lifecycle) {
    const frame = frameMap.get(expected.frameId);
    const call = frame?.manifest?.drawCalls?.find(
      ({ entityId }) =>
        entityId === (expected.actorId ?? "monster:temporal-ashfang"),
    );
    if (
      !frame ||
      !call ||
      frame.tick <= previousTick ||
      call.clip !== expected.clip ||
      call.frameIndex !== expected.frameIndex
    )
      uniquePush(violations, `combat-sequence-mismatch:${expected.frameId}`);
    if (frame) previousTick = frame.tick;
  }
  summary.combatFrames = lifecycle.length;
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * Pure evaluator for the production depth evidence bundle. Pixel decoding is
 * intentionally performed by the recorder; this function consumes only the
 * bounded mask measurements and authoritative render/state projections.
 */
export function evaluateDepthTransitionEvidence(evidence) {
  const violations = [];
  const summary = {
    frameCount: Array.isArray(evidence?.frames) ? evidence.frames.length : 0,
    transitions: 0,
    depthSamples: 0,
    actorIntersections: 0,
    attachments: 0,
    health: 0,
    reconciledAnchors: 0,
    combatFrames: 0,
  };
  const frames = Array.isArray(evidence?.frames) ? evidence.frames : [];
  const frameMap = new Map(frames.map((frame) => [frame.id, frame]));
  for (const frame of frames) {
    if (
      !Number.isInteger(frame.tick) ||
      frame.tick !== frame.stateTick ||
      frame.tick !== frame.manifestTick
    )
      uniquePush(violations, `state-manifest-anchor-mismatch:${frame.id}`);
    checkQueue(frame, violations, summary);
    checkActorBodies(frame, violations, summary);
    checkDepthSample(frame, violations, summary);
    checkAttachments(frame, evidence, violations, summary);
    checkHealth(frame, evidence, violations, summary);
    checkStateManifest(frame, violations, summary);
  }
  checkTransitions(evidence, frameMap, violations, summary);
  checkCombatSequence(evidence, frameMap, violations, summary);
  const uniqueViolations = [...new Set(violations)];
  const has = (prefixes) =>
    uniqueViolations.some((violation) =>
      prefixes.some((prefix) => violation.startsWith(prefix)),
    );
  const signals = [
    signal(
      "z-order-follows-foot-boundary",
      !has([
        "paint-z-order-mismatch",
        "depth-order-mismatch",
        "actor-depth-inverted",
        "duplicate-owner-body",
        "shadow-z-order-mismatch",
      ]),
      summary,
    ),
    signal(
      "attachments-follow-owner",
      !has(["effect-owner-detached"]),
      summary,
    ),
    signal(
      "health-effect-occlusion-in-range",
      !has([
        "health-z-order-mismatch",
        "health-occlusion-ratio-exceeded",
        "effect-owner-occlusion-ratio-exceeded",
      ]),
      summary,
    ),
    signal(
      "state-manifest-anchors-reconcile",
      !has(["state-manifest-anchor-mismatch", "presentation-offset-mismatch"]),
      summary,
    ),
    signal(
      "ordered-combat-transition",
      !has(["combat-sequence-mismatch"]),
      summary,
    ),
  ];
  return {
    pass: uniqueViolations.length === 0,
    signals,
    failures: uniqueViolations,
    summary,
  };
}
