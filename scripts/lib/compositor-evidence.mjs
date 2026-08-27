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

function signal(id, pass, detail) {
  return { id, pass, detail };
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
