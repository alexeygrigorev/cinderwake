import sharp from "sharp";

export const COMPOSITOR_SIGNAL_IDS = [
  "same-state-render-is-identical",
  "scene-transition-reconstructs-fresh-frame",
  "one-body-paint-per-owner",
];

export const COMPOSITOR_FAILURE_IDS = [
  "duplicate-body-detected",
  "stale-pixels-detected",
  "duplicate-owner-body",
];

export const LIVE_COMPOSITOR_SIGNAL_IDS = [
  "one-current-body-per-owner",
  "no-unexplained-absence",
  "no-stale-pixels",
  "presentation-cadence-complete",
  "effect-ownership-complete",
  "effect-despawn-clean",
  "real-clock-cadence-complete",
];

export const LIVE_COMPOSITOR_FAILURE_IDS = [
  "duplicate-owner-body",
  "expected-frame-absent",
  "stale-pixels-detected",
  "effect-owner-mismatch",
  "stale-effect-retained",
  "presentation-cadence-stalled",
];

export const LIVE_EFFECT_KINDS = ["slash", "nova", "impact"];

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * Decode two captured PNGs and report the exact residual between them. A
 * caller can use this after rendering a transition and a fresh reconstruction;
 * hashes alone do not show how large or where a stale-pixel region is.
 */
export async function measurePngResidual(firstPng, secondPng) {
  const [first, second] = await Promise.all(
    [firstPng, secondPng].map((value) =>
      sharp(value).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  if (
    first.info.width !== second.info.width ||
    first.info.height !== second.info.height ||
    first.info.channels !== second.info.channels
  )
    return {
      width: first.info.width,
      height: first.info.height,
      differingPixels: Number.MAX_SAFE_INTEGER,
      maxChannelDelta: 255,
      changedBounds: null,
    };

  let differingPixels = 0;
  let maxChannelDelta = 0;
  let minX = first.info.width;
  let minY = first.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < first.info.height; y += 1) {
    for (let x = 0; x < first.info.width; x += 1) {
      const offset = (y * first.info.width + x) * first.info.channels;
      let pixelDiffers = false;
      for (let channel = 0; channel < first.info.channels; channel += 1) {
        const delta = Math.abs(
          first.data[offset + channel] - second.data[offset + channel],
        );
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta !== 0) pixelDiffers = true;
      }
      if (!pixelDiffers) continue;
      differingPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width: first.info.width,
    height: first.info.height,
    differingPixels,
    maxChannelDelta,
    changedBounds:
      maxX >= 0
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
  };
}

function equalHashes(first, second) {
  return (
    typeof first === "string" &&
    first.length > 0 &&
    typeof second === "string" &&
    second.length > 0 &&
    first === second
  );
}

function ownerPaintsAreUnique(ownerPaints) {
  return (
    Array.isArray(ownerPaints) &&
    ownerPaints.length > 0 &&
    new Set(ownerPaints.map(({ ownerId }) => ownerId)).size ===
      ownerPaints.length &&
    ownerPaints.every(
      ({ ownerId, bodyPaintCount }) =>
        typeof ownerId === "string" &&
        ownerId.length > 0 &&
        bodyPaintCount === 1,
    )
  );
}

/**
 * Compare exact PNG hashes from the production canvas and the manifest's
 * declared body paint ownership. The browser recorder computes the hashes
 * from PNG bytes before this pure evaluator sees them.
 */
export function evaluateCompositorEvidence({
  repeat,
  transition,
  ownerPaints,
}) {
  const sameStateRenderIsIdentical = equalHashes(
    repeat?.firstFrameHash,
    repeat?.secondFrameHash,
  );
  const sceneTransitionReconstructsFreshFrame = equalHashes(
    transition?.afterFrameHash,
    transition?.freshFrameHash,
  );
  const oneBodyPaintPerOwner = ownerPaintsAreUnique(ownerPaints);
  const failures = [];
  if (!sameStateRenderIsIdentical) failures.push("duplicate-body-detected");
  if (!sceneTransitionReconstructsFreshFrame)
    failures.push("stale-pixels-detected");
  if (!oneBodyPaintPerOwner) failures.push("duplicate-owner-body");
  return {
    pass: failures.length === 0,
    failures,
    signals: [
      signal("same-state-render-is-identical", sameStateRenderIsIdentical, {
        firstFrameHash: repeat?.firstFrameHash ?? null,
        secondFrameHash: repeat?.secondFrameHash ?? null,
      }),
      signal(
        "scene-transition-reconstructs-fresh-frame",
        sceneTransitionReconstructsFreshFrame,
        {
          afterFrameHash: transition?.afterFrameHash ?? null,
          freshFrameHash: transition?.freshFrameHash ?? null,
        },
      ),
      signal("one-body-paint-per-owner", oneBodyPaintPerOwner, {
        ownerPaints: ownerPaints ?? [],
      }),
    ],
  };
}

/** Exercise the compositor controls without mutating production rendering. */
export function runCompositorNegativeControls(evidence) {
  const definitions = [
    {
      id: "prior-frame-not-cleared",
      expectedSignal: "stale-pixels-detected",
      mutate(value) {
        value.transition.afterFrameHash = "stale-frame";
      },
    },
    {
      id: "duplicate-body-draw",
      expectedSignal: "duplicate-body-detected",
      mutate(value) {
        value.repeat.secondFrameHash = "duplicated-body";
      },
    },
    {
      id: "owner-body-painted-twice",
      expectedSignal: "duplicate-owner-body",
      mutate(value) {
        value.ownerPaints[0].bodyPaintCount = 2;
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateCompositorEvidence(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: result.failures,
    };
  });
}

function sameStringSet(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.every((value) => typeof value === "string" && value.length > 0) &&
    second.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(first).size === first.length &&
    new Set(second).size === second.length &&
    first.length === second.length &&
    first.every((value) => second.includes(value))
  );
}

function sameNumberList(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every(
      (value, index) =>
        Number.isInteger(value) &&
        Number.isInteger(second[index]) &&
        value === second[index],
    )
  );
}

function residualIsClean(residual) {
  return (
    residual &&
    Number.isInteger(residual.differingPixels) &&
    residual.differingPixels >= 0 &&
    Number.isInteger(residual.maxChannelDelta) &&
    residual.maxChannelDelta >= 0 &&
    residual.differingPixels === 0 &&
    residual.maxChannelDelta === 0
  );
}

function effectOwnershipIsComplete(effects) {
  return (
    Array.isArray(effects) &&
    effects.length > 0 &&
    effects.every(
      (effect) =>
        typeof effect?.effectId === "string" &&
        effect.effectId.length > 0 &&
        LIVE_EFFECT_KINDS.includes(effect.kind) &&
        effect.kind === effect.expectedKind &&
        typeof effect.ownerId === "string" &&
        effect.ownerId.length > 0 &&
        typeof effect.expectedOwnerId === "string" &&
        effect.expectedOwnerId.length > 0 &&
        effect.ownerId === effect.expectedOwnerId,
    )
  );
}

function effectDespawnIsClean(effects) {
  return (
    Array.isArray(effects) &&
    effects.length > 0 &&
    effects.every(
      (effect) =>
        typeof effect?.effectId === "string" &&
        effect.effectId.length > 0 &&
        effect.observedBefore === true &&
        effect.observedAfter === false &&
        Number.isInteger(effect.beforeTick) &&
        Number.isInteger(effect.afterTick) &&
        Number.isInteger(effect.startedAtTick) &&
        Number.isInteger(effect.expectedDespawnStateTick) &&
        effect.beforeTick >= effect.startedAtTick &&
        effect.beforeTick < effect.afterTick &&
        effect.afterTick === effect.expectedDespawnStateTick,
    )
  );
}

function segmentAssessment(segment) {
  const frames = Array.isArray(segment?.frames) ? segment.frames : [];
  const hasFrames = frames.length > 0;
  const oneCurrentBodyPerOwner =
    hasFrames &&
    frames.every((frame) => ownerPaintsAreUnique(frame?.ownerPaints));
  const noUnexplainedAbsence =
    hasFrames &&
    frames.every((frame) =>
      sameStringSet(frame?.expectedOwnerIds, frame?.observedOwnerIds),
    );
  const presentationCadenceComplete =
    hasFrames &&
    sameNumberList(
      segment?.expectedTicks,
      frames.map(({ tick }) => tick),
    );
  return {
    id: typeof segment?.id === "string" ? segment.id : "",
    frameCount: frames.length,
    oneCurrentBodyPerOwner,
    noUnexplainedAbsence,
    presentationCadenceComplete,
  };
}

const MIN_LIVE_PRESENTATION_SAMPLES = 30;
const MAX_LIVE_PRESENTATION_GAP_MS = 250;
const MIN_LIVE_PRESENTATION_TICKS = 4;
const TARGET_PRESENTATION_INTERVAL_MS = 1000 / 60;

function liveProfileAssessment(profile) {
  const samples = Array.isArray(profile?.samples) ? profile.samples : [];
  const timestamps = samples.map(({ observedAtMs }) => observedAtMs);
  const intervals = timestamps.slice(1).map((value, index) => {
    const previous = timestamps[index];
    return value - previous;
  });
  const timestampOrderIsValid = timestamps.every(
    (value, index) => index === 0 || value > timestamps[index - 1],
  );
  const maxIntervalMs = intervals.length > 0 ? Math.max(...intervals) : 0;
  const distinctPresentationTicks = new Set(
    samples.map(({ presentationTick }) => presentationTick),
  ).size;
  const oneCurrentBodyPerOwner =
    samples.length > 0 &&
    samples.every(({ ownerPaints }) => ownerPaintsAreUnique(ownerPaints));
  const noUnexplainedAbsence =
    samples.length > 0 &&
    samples.every(({ expectedOwnerIds, observedOwnerIds }) =>
      sameStringSet(expectedOwnerIds, observedOwnerIds),
    );
  const cadenceComplete =
    samples.length >= MIN_LIVE_PRESENTATION_SAMPLES &&
    timestampOrderIsValid &&
    intervals.length > 0 &&
    maxIntervalMs <= MAX_LIVE_PRESENTATION_GAP_MS &&
    distinctPresentationTicks >= MIN_LIVE_PRESENTATION_TICKS;
  const missedRefreshes = intervals.map((interval) =>
    Math.max(0, Math.ceil(interval / TARGET_PRESENTATION_INTERVAL_MS) - 1),
  );
  return {
    id: typeof profile?.id === "string" ? profile.id : "",
    required: profile?.required !== false,
    frameCount: samples.length,
    durationMs: timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0,
    minIntervalMs: intervals.length > 0 ? Math.min(...intervals) : 0,
    medianIntervalMs:
      intervals.length > 0
        ? [...intervals].sort((first, second) => first - second)[
            Math.floor(intervals.length / 2)
          ]
        : 0,
    maxIntervalMs,
    maxMissedRefreshes: missedRefreshes.length
      ? Math.max(...missedRefreshes)
      : 0,
    distinctPresentationTicks,
    oneCurrentBodyPerOwner,
    noUnexplainedAbsence,
    cadenceComplete,
  };
}

/**
 * Evaluate ordered compositor samples. The recorder supplies independent
 * expected-owner lists from semantic state, observed-owner lists from the
 * render manifest, and decoded pixel residuals against a fresh reconstruction.
 */
export function evaluateLiveCompositorEvidence({
  segments,
  residuals,
  effects,
  liveProfiles,
}) {
  const assessments = Array.isArray(segments)
    ? segments.map(segmentAssessment)
    : [];
  const liveAssessments = Array.isArray(liveProfiles)
    ? liveProfiles.map(liveProfileAssessment)
    : [];
  const gatedLiveAssessments = liveAssessments.filter(
    ({ required }) => required,
  );
  const allOwnershipAssessments = [...assessments, ...gatedLiveAssessments];
  const oneCurrentBodyPerOwner =
    allOwnershipAssessments.length > 0 &&
    allOwnershipAssessments.every(({ oneCurrentBodyPerOwner: pass }) => pass);
  const noUnexplainedAbsence =
    allOwnershipAssessments.length > 0 &&
    allOwnershipAssessments.every(({ noUnexplainedAbsence: pass }) => pass);
  const presentationCadenceComplete =
    assessments.length > 0 &&
    assessments.every(({ presentationCadenceComplete: pass }) => pass);
  const realClockCadenceComplete =
    gatedLiveAssessments.length > 0 &&
    gatedLiveAssessments.every(
      ({
        cadenceComplete,
        oneCurrentBodyPerOwner: ownership,
        noUnexplainedAbsence: absence,
      }) => cadenceComplete && ownership && absence,
    );
  const noStalePixels =
    Array.isArray(residuals) &&
    residuals.length > 0 &&
    residuals.every(residualIsClean);
  const effectOwnershipComplete = effectOwnershipIsComplete(effects);
  const effectDespawnClean = effectDespawnIsClean(effects);
  const failures = [];
  if (!oneCurrentBodyPerOwner) failures.push("duplicate-owner-body");
  if (!noUnexplainedAbsence || !presentationCadenceComplete)
    failures.push("expected-frame-absent");
  if (!noStalePixels) failures.push("stale-pixels-detected");
  if (!effectOwnershipComplete) failures.push("effect-owner-mismatch");
  if (!effectDespawnClean) failures.push("stale-effect-retained");
  if (!realClockCadenceComplete) failures.push("presentation-cadence-stalled");
  return {
    pass: failures.length === 0,
    failures,
    signals: [
      signal("one-current-body-per-owner", oneCurrentBodyPerOwner, {
        segments: assessments,
        profiles: liveAssessments,
      }),
      signal("no-unexplained-absence", noUnexplainedAbsence, {
        segments: assessments,
        profiles: liveAssessments,
      }),
      signal("no-stale-pixels", noStalePixels, {
        residuals: residuals ?? [],
      }),
      signal("presentation-cadence-complete", presentationCadenceComplete, {
        segments: assessments,
      }),
      signal("effect-ownership-complete", effectOwnershipComplete, {
        effects: effects ?? [],
      }),
      signal("effect-despawn-clean", effectDespawnClean, {
        effects: effects ?? [],
      }),
      signal("real-clock-cadence-complete", realClockCadenceComplete, {
        profiles: liveAssessments,
        gatedProfileIds: gatedLiveAssessments.map(({ id }) => id),
        observedOnlyProfileIds: liveAssessments
          .filter(({ required }) => !required)
          .map(({ id }) => id),
        observedOnlyFailures: liveAssessments
          .filter(
            ({ required, cadenceComplete }) => !required && !cadenceComplete,
          )
          .map(({ id }) => `${id}:cadence-stalled`),
        minimumSamples: MIN_LIVE_PRESENTATION_SAMPLES,
        maximumGapMs: MAX_LIVE_PRESENTATION_GAP_MS,
        minimumDistinctPresentationTicks: MIN_LIVE_PRESENTATION_TICKS,
      }),
    ],
  };
}

/** Exercise every named live-compositor mutation against a clean fixture. */
export function runLiveCompositorNegativeControls(evidence) {
  const definitions = [
    {
      id: "canvas-clear-skipped",
      expectedSignal: "stale-pixels-detected",
      mutate(value) {
        value.residuals[0].differingPixels = 1;
        value.residuals[0].maxChannelDelta = 255;
      },
    },
    {
      id: "offset-double-draw",
      expectedSignal: "duplicate-owner-body",
      mutate(value) {
        value.segments[0].frames[0].ownerPaints[0].bodyPaintCount = 2;
      },
    },
    {
      id: "presentation-frame-omitted",
      expectedSignal: "expected-frame-absent",
      mutate(value) {
        value.segments[0].frames.splice(1, 1);
      },
    },
    {
      id: "despawned-effect-retained",
      expectedSignal: "stale-effect-retained",
      mutate(value) {
        value.effects[0].observedAfter = true;
      },
    },
    {
      id: "effect-owner-mismatched",
      expectedSignal: "effect-owner-mismatch",
      mutate(value) {
        value.effects[0].ownerId = "owner:wrong";
      },
    },
    {
      id: "live-renderer-frozen",
      expectedSignal: "presentation-cadence-stalled",
      mutate(value) {
        value.liveProfiles[0].samples = [];
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateLiveCompositorEvidence(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: result.failures,
    };
  });
}
