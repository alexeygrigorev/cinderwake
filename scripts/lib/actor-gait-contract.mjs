const REQUIRED_LANDMARKS = [
  "root",
  "torso",
  "leftFoot",
  "rightFoot",
  "leftKnee",
  "rightKnee",
];

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function addFailure(failures, code, detail) {
  if (!failures.some((failure) => failure.code === code))
    failures.push({ code, detail });
}

/**
 * Assess an authored walk bank whose semantic landmarks have already been
 * reviewed. Raster hashes alone cannot tell left from right, so promotion
 * requires the sidecar rather than guessing anatomy from opaque pixels.
 */
export function assessLandmarkGaitBank(bank, thresholds, alphaAt) {
  const failures = [];
  const frames = bank?.frames ?? [];
  if (frames.length !== thresholds.expectedFrames) {
    addFailure(
      failures,
      "frame-count",
      `expected ${thresholds.expectedFrames} frames, observed ${frames.length}`,
    );
    return { pass: false, failures, measurements: {} };
  }

  const rasterHashes = frames.map(({ rasterHash }) => rasterHash);
  const uniqueHashes = new Set(rasterHashes);
  const supports = frames.map(({ support }) => support);
  const phases = frames.map(({ phase }) => phase);
  const allHashesDistinct = uniqueHashes.size === frames.length;
  const supportSwitches = supports
    .slice(1)
    .filter((support, index) => support !== supports[index]).length;

  if (allHashesDistinct && new Set(supports).size === 1)
    addFailure(
      failures,
      "hash-distinct-same-support",
      "different raster hashes disguise a bank that keeps the same support foot",
    );
  if (supportSwitches < thresholds.minimumSupportSwitches)
    addFailure(
      failures,
      "missing-alternating-support",
      `expected at least ${thresholds.minimumSupportSwitches} support changes, observed ${supportSwitches}`,
    );
  if (phases.some((phase, index) => phase !== thresholds.phaseSequence[index]))
    addFailure(
      failures,
      "phase-reversal",
      `phase sequence ${phases.join(",")} differs from ${thresholds.phaseSequence.join(",")}`,
    );

  for (const [frameIndex, frame] of frames.entries()) {
    if (!Number.isFinite(frame.anchorY))
      addFailure(
        failures,
        "invalid-anchor",
        `frame ${frameIndex} has no anchorY`,
      );
    for (const landmark of REQUIRED_LANDMARKS) {
      const point = frame.landmarks?.[landmark];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        addFailure(
          failures,
          "missing-landmark",
          `frame ${frameIndex} has no valid ${landmark}`,
        );
        continue;
      }
      if (
        alphaAt(frameIndex, point.x, point.y) < thresholds.minimumLandmarkAlpha
      )
        addFailure(
          failures,
          "invalid-landmark-alpha-binding",
          `frame ${frameIndex} ${landmark} is not bound to opaque actor paint`,
        );
    }
  }

  const anchorRange = range(frames.map(({ anchorY }) => anchorY));
  if (anchorRange > thresholds.maximumAnchorShift)
    addFailure(
      failures,
      "anchor-shift",
      `anchor range ${anchorRange} exceeds ${thresholds.maximumAnchorShift}`,
    );

  const torsoRootDistances = frames.map(({ landmarks }) =>
    pointDistance(landmarks.root, landmarks.torso),
  );
  const minimumTorsoRootDistance = Math.min(...torsoRootDistances);
  const verticalScaleRatio =
    Math.max(...torsoRootDistances) / minimumTorsoRootDistance;
  if (
    !Number.isFinite(verticalScaleRatio) ||
    verticalScaleRatio > thresholds.maximumVerticalScaleRatio
  )
    addFailure(
      failures,
      "vertical-stretch",
      `torso/root scale ratio ${verticalScaleRatio.toFixed(3)} exceeds ${thresholds.maximumVerticalScaleRatio}`,
    );

  const leftFootRange = range(
    frames.map(({ landmarks }) => landmarks.leftFoot.x),
  );
  const rightFootRange = range(
    frames.map(({ landmarks }) => landmarks.rightFoot.x),
  );
  const leftKneeRange = range(
    frames.map(({ landmarks }) => landmarks.leftKnee.x),
  );
  const rightKneeRange = range(
    frames.map(({ landmarks }) => landmarks.rightKnee.x),
  );
  if (
    Math.min(leftFootRange, rightFootRange) < thresholds.minimumFootTravel ||
    Math.min(leftKneeRange, rightKneeRange) < thresholds.minimumKneeTravel
  )
    addFailure(
      failures,
      "insufficient-articulation",
      `foot travel ${leftFootRange}/${rightFootRange}; knee travel ${leftKneeRange}/${rightKneeRange}`,
    );

  return {
    pass: failures.length === 0,
    failures,
    measurements: {
      uniqueRasterHashes: uniqueHashes.size,
      supportSwitches,
      anchorRange,
      verticalScaleRatio,
      leftFootRange,
      rightFootRange,
      leftKneeRange,
      rightKneeRange,
    },
  };
}

export function fixtureAlphaReader(fixture) {
  const opaqueByFrame = fixture.frames.map(
    ({ opaquePixels }) => new Set(opaquePixels),
  );
  return (frameIndex, x, y) =>
    opaqueByFrame[frameIndex]?.has(`${x},${y}`) ? 255 : 0;
}

export function mutateFixture(fixture, mutation) {
  return mutation(structuredClone(fixture));
}
