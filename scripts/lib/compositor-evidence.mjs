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
  "effect-despawn-clean",
];

export const LIVE_COMPOSITOR_FAILURE_IDS = [
  "duplicate-owner-body",
  "expected-frame-absent",
  "stale-pixels-detected",
  "stale-effect-retained",
];

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

/**
 * Evaluate ordered compositor samples. The recorder supplies independent
 * expected-owner lists from semantic state, observed-owner lists from the
 * render manifest, and decoded pixel residuals against a fresh reconstruction.
 */
export function evaluateLiveCompositorEvidence({
  segments,
  residuals,
  effects,
}) {
  const assessments = Array.isArray(segments)
    ? segments.map(segmentAssessment)
    : [];
  const oneCurrentBodyPerOwner =
    assessments.length > 0 &&
    assessments.every(({ oneCurrentBodyPerOwner: pass }) => pass);
  const noUnexplainedAbsence =
    assessments.length > 0 &&
    assessments.every(({ noUnexplainedAbsence: pass }) => pass);
  const presentationCadenceComplete =
    assessments.length > 0 &&
    assessments.every(({ presentationCadenceComplete: pass }) => pass);
  const noStalePixels =
    Array.isArray(residuals) &&
    residuals.length > 0 &&
    residuals.every(residualIsClean);
  const effectDespawnClean =
    Array.isArray(effects) &&
    effects.length > 0 &&
    effects.every(
      (effect) =>
        typeof effect?.effectId === "string" &&
        effect.effectId.length > 0 &&
        effect.observedBefore === true &&
        effect.observedAfter === false,
    );
  const failures = [];
  if (!oneCurrentBodyPerOwner) failures.push("duplicate-owner-body");
  if (!noUnexplainedAbsence || !presentationCadenceComplete)
    failures.push("expected-frame-absent");
  if (!noStalePixels) failures.push("stale-pixels-detected");
  if (!effectDespawnClean) failures.push("stale-effect-retained");
  return {
    pass: failures.length === 0,
    failures,
    signals: [
      signal("one-current-body-per-owner", oneCurrentBodyPerOwner, {
        segments: assessments,
      }),
      signal("no-unexplained-absence", noUnexplainedAbsence, {
        segments: assessments,
      }),
      signal("no-stale-pixels", noStalePixels, {
        residuals: residuals ?? [],
      }),
      signal("presentation-cadence-complete", presentationCadenceComplete, {
        segments: assessments,
      }),
      signal("effect-despawn-clean", effectDespawnClean, {
        effects: effects ?? [],
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
