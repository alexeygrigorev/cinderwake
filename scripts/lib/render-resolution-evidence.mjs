import sharp from "sharp";

export const RENDER_RESOLUTION_SIGNAL_IDS = [
  "backing-matches-dpr",
  "original-crop-retains-detail",
];

export const RENDER_RESOLUTION_FAILURE_IDS = [
  "backing-resolution-mismatch",
  "sharpness-regression",
];

export const RENDER_RESOLUTION_DETAIL_METRIC =
  "mean-absolute-laplacian-luma-v1";
export const RENDER_RESOLUTION_BLUR_MUTATION = "gaussian-blur-1.5";

const DEFAULT_LOGICAL_VIEWPORT = { width: 960, height: 540 };
const BACKING_WIDTH_QUANTUM = 16;
const MIN_DETAIL_SAMPLE_COUNT = 4;
const HIGH_RESIDUAL_THRESHOLD = 8;

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function integerPositive(value) {
  return Number.isInteger(value) && value > 0;
}

function equalNumbers(first, second, tolerance = 1e-6) {
  return (
    typeof first === "number" &&
    typeof second === "number" &&
    Number.isFinite(first) &&
    Number.isFinite(second) &&
    Math.abs(first - second) <= tolerance
  );
}

function viewportFor(sample) {
  const viewport = sample?.logicalViewport ?? DEFAULT_LOGICAL_VIEWPORT;
  if (!finitePositive(viewport.width) || !finitePositive(viewport.height))
    return null;
  return viewport;
}

/**
 * Mirror CanvasRenderer's bounded responsive backing-store policy. Keeping
 * this calculation outside the browser lets the retained evidence detect a
 * renderer that reports a plausible DPR while allocating the wrong surface.
 */
export function expectedBackingStore(sample) {
  const logical = viewportFor(sample);
  const css = sample?.css;
  const browserDpr = sample?.devicePixelRatio;
  if (
    !logical ||
    !finitePositive(css?.width) ||
    !finitePositive(css?.height) ||
    !finitePositive(browserDpr)
  )
    return null;
  const cssScale = Math.max(
    css.width / logical.width,
    css.height / logical.height,
  );
  const targetCssDpr = Math.min(2, Math.max(1, browserDpr));
  const targetScale = Math.min(3, Math.max(1, cssScale * targetCssDpr));
  const backingWidth =
    Math.ceil((logical.width * targetScale) / BACKING_WIDTH_QUANTUM) *
    BACKING_WIDTH_QUANTUM;
  const backingHeight = Math.round(
    backingWidth * (logical.height / logical.width),
  );
  return {
    width: backingWidth,
    height: backingHeight,
    renderScale: backingWidth / logical.width,
    cssScale,
    targetCssDpr,
    targetScale,
  };
}

function backingSampleDetails(samples) {
  const values = Array.isArray(samples) ? samples : [];
  const details = values.map((sample) => {
    const logical = viewportFor(sample);
    const expected = expectedBackingStore(sample);
    const actual = sample?.backing;
    const actualValid =
      integerPositive(actual?.width) && integerPositive(actual?.height);
    const expectedValid = expected !== null;
    const aspectPass =
      expectedValid &&
      actualValid &&
      equalNumbers(
        actual.width / actual.height,
        logical.width / logical.height,
        1e-5,
      );
    const dimensionsPass =
      expectedValid &&
      actualValid &&
      actual.width === expected.width &&
      actual.height === expected.height;
    const manifestDprPass =
      expectedValid &&
      equalNumbers(sample?.manifestDpr, expected.renderScale, 1e-6);
    return {
      profileId: sample?.profileId ?? null,
      pass: dimensionsPass && aspectPass && manifestDprPass,
      expected: expected
        ? {
            width: expected.width,
            height: expected.height,
            renderScale: expected.renderScale,
          }
        : null,
      actual: actualValid
        ? {
            width: actual.width,
            height: actual.height,
          }
        : null,
      manifestDpr:
        typeof sample?.manifestDpr === "number" ? sample.manifestDpr : null,
      css: sample?.css ?? null,
      devicePixelRatio:
        typeof sample?.devicePixelRatio === "number"
          ? sample.devicePixelRatio
          : null,
      checks: {
        dimensions: dimensionsPass,
        aspect: aspectPass,
        manifestDpr: manifestDprPass,
      },
    };
  });
  return {
    pass: details.length > 0 && details.every(({ pass }) => pass),
    details,
  };
}

function cropInsideFrame(crop, frameSize) {
  return (
    integerPositive(frameSize?.width) &&
    integerPositive(frameSize?.height) &&
    Number.isInteger(crop?.x) &&
    Number.isInteger(crop?.y) &&
    integerPositive(crop?.width) &&
    integerPositive(crop?.height) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.x + crop.width <= frameSize.width &&
    crop.y + crop.height <= frameSize.height
  );
}

function metricValue(value) {
  return value?.metric === RENDER_RESOLUTION_DETAIL_METRIC &&
    finitePositive(value?.meanAbsLaplacian)
    ? value.meanAbsLaplacian
    : null;
}

function detailSampleDetails(samples, geometryDetails) {
  const geometryByProfile = new Map(
    geometryDetails.map((detail) => [detail.profileId, detail]),
  );
  const values = Array.isArray(samples) ? samples : [];
  const details = values.map((sample) => {
    const geometry = geometryByProfile.get(sample?.profileId);
    const nativeMetric = metricValue(sample?.sharpness);
    const blurredMetric = metricValue(sample?.blurredSharpness);
    const frameResolutionPass = Boolean(
      geometry?.actual &&
      sample?.frameSize?.width === geometry.actual.width &&
      sample?.frameSize?.height === geometry.actual.height,
    );
    const captureModePass = sample?.captureMode === "physical-canvas";
    const cropPass = cropInsideFrame(sample?.crop, sample?.frameSize);
    const mutationPass =
      sample?.blurMutation === RENDER_RESOLUTION_BLUR_MUTATION;
    const metricPass = nativeMetric !== null && blurredMetric !== null;
    return {
      id: sample?.id ?? null,
      profileId: sample?.profileId ?? null,
      role: sample?.role ?? null,
      scenarioId: sample?.scenarioId ?? null,
      pass:
        Boolean(geometry) &&
        frameResolutionPass &&
        captureModePass &&
        cropPass &&
        mutationPass &&
        metricPass &&
        nativeMetric > blurredMetric,
      nativeMetric,
      blurredMetric,
      detailScore:
        nativeMetric !== null && blurredMetric !== null && blurredMetric > 0
          ? nativeMetric / blurredMetric
          : null,
      frameSize: sample?.frameSize ?? null,
      crop: sample?.crop ?? null,
      checks: {
        geometry: Boolean(geometry),
        frameResolution: frameResolutionPass,
        captureMode: captureModePass,
        crop: cropPass,
        blurMutation: mutationPass,
        metric: metricPass,
        nativeExceedsBlurred:
          nativeMetric !== null &&
          blurredMetric !== null &&
          nativeMetric > blurredMetric,
      },
    };
  });
  return details;
}

/**
 * Evaluate responsive backing geometry and an evidence-calibrated sharpness
 * corpus. The threshold is derived only from the accepted original crops and
 * their deterministic blurred mutations, so it does not encode a machine-
 * specific absolute sharpness value.
 */
export function evaluateRenderResolutionEvidence({
  geometrySamples = [],
  cropSamples = [],
} = {}) {
  const geometry = backingSampleDetails(geometrySamples);
  const cropDetails = detailSampleDetails(cropSamples, geometry.details);
  const blurredValues = cropDetails
    .map(({ blurredMetric }) => blurredMetric)
    .filter((value) => value !== null);
  const detailScores = cropDetails
    .map(({ detailScore }) => detailScore)
    .filter((value) => value !== null);
  const acceptedMinimumScore =
    detailScores.length > 0 ? Math.min(...detailScores) : null;
  // A crop replaced by its blurred mutation has a normalized retention score
  // of exactly one. This makes the calibration comparable across DPRs and
  // across crops whose absolute texture frequencies differ.
  const blurredControlMaximumScore = blurredValues.length > 0 ? 1 : null;
  const separation =
    acceptedMinimumScore !== null && blurredControlMaximumScore !== null
      ? acceptedMinimumScore - blurredControlMaximumScore
      : null;
  const threshold =
    acceptedMinimumScore !== null && blurredControlMaximumScore !== null
      ? (acceptedMinimumScore + blurredControlMaximumScore) / 2
      : null;
  const profileIds = new Set(
    cropDetails.filter(({ pass }) => pass).map(({ profileId }) => profileId),
  );
  const roles = new Set(
    cropDetails.filter(({ pass }) => pass).map(({ role }) => role),
  );
  const hasDprOne = (geometrySamples ?? []).some(({ devicePixelRatio }) =>
    equalNumbers(devicePixelRatio, 1),
  );
  const hasDprThree = (geometrySamples ?? []).some(({ devicePixelRatio }) =>
    equalNumbers(devicePixelRatio, 3),
  );
  const calibrationPass =
    acceptedMinimumScore !== null &&
    blurredControlMaximumScore !== null &&
    separation > 0 &&
    threshold !== null &&
    cropDetails.length >= MIN_DETAIL_SAMPLE_COUNT &&
    hasDprOne &&
    hasDprThree &&
    profileIds.size >= 2 &&
    roles.has("player") &&
    roles.has("terrain") &&
    cropDetails.every(
      ({ detailScore, pass }) =>
        pass && detailScore !== null && detailScore > threshold,
    );
  const detail = {
    metric: RENDER_RESOLUTION_DETAIL_METRIC,
    blurMutation: RENDER_RESOLUTION_BLUR_MUTATION,
    cropCount: cropDetails.length,
    calibratedProfileIds: [...profileIds],
    calibratedRoles: [...roles],
    acceptedMinimumScore,
    blurredControlMaximumScore,
    separation,
    threshold,
    required: {
      cropCount: MIN_DETAIL_SAMPLE_COUNT,
      devicePixelRatios: [1, 3],
      roles: ["player", "terrain"],
    },
    samples: cropDetails,
  };
  const failures = [];
  if (!geometry.pass) failures.push("backing-resolution-mismatch");
  if (!calibrationPass) failures.push("sharpness-regression");
  return {
    pass: failures.length === 0,
    failures,
    signals: [
      {
        id: "backing-matches-dpr",
        pass: geometry.pass,
        detail: { samples: geometry.details },
      },
      {
        id: "original-crop-retains-detail",
        pass: calibrationPass,
        detail,
      },
    ],
    calibration: detail,
  };
}

/** Exercise the render-resolution controls without changing production code. */
export function runRenderResolutionNegativeControls(evidence) {
  const definitions = [
    {
      id: "legacy-960x540-backing",
      expectedSignal: "backing-resolution-mismatch",
      mutate(value) {
        const samples = Array.isArray(value.geometrySamples)
          ? value.geometrySamples
          : [];
        const target =
          samples.find(
            ({ backing }) => backing?.width > DEFAULT_LOGICAL_VIEWPORT.width,
          ) ?? samples[0];
        if (!target) return;
        const logical = target.logicalViewport ?? DEFAULT_LOGICAL_VIEWPORT;
        target.backing = {
          width: logical.width,
          height: logical.height,
        };
        const expected = expectedBackingStore(target);
        if (
          expected &&
          target.backing.width === expected.width &&
          target.backing.height === expected.height
        )
          target.backing.width += BACKING_WIDTH_QUANTUM;
      },
    },
    {
      id: "accepted-crop-blurred",
      expectedSignal: "sharpness-regression",
      mutate(value) {
        for (const sample of value.cropSamples ?? []) {
          if (sample.blurredSharpness)
            sample.sharpness = structuredClone(sample.blurredSharpness);
        }
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence ?? {});
    mutate(mutated);
    const result = evaluateRenderResolutionEvidence(mutated);
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

function pixelCropFromRequest(request, frameSize) {
  if (
    !finiteNumber(request?.x) ||
    !finiteNumber(request?.y) ||
    !finitePositive(request?.width) ||
    !finitePositive(request?.height)
  )
    throw new Error("Raster crop requires positive coordinates and dimensions");
  const requested = {
    left: Math.floor(request.x),
    top: Math.floor(request.y),
    right: Math.ceil(request.x + request.width),
    bottom: Math.ceil(request.y + request.height),
  };
  const crop = {
    x: Math.max(0, requested.left),
    y: Math.max(0, requested.top),
    width:
      Math.min(frameSize.width, requested.right) - Math.max(0, requested.left),
    height:
      Math.min(frameSize.height, requested.bottom) - Math.max(0, requested.top),
  };
  if (!cropInsideFrame(crop, frameSize))
    throw new Error(
      `Raster crop ${JSON.stringify(crop)} is outside ${JSON.stringify(frameSize)}`,
    );
  return crop;
}

/** Measure the luma high-frequency residual of a PNG crop. */
export async function measurePngSharpness(png) {
  const decoded = await sharp(png)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  const sampleCount = Math.max(0, (info.width - 2) * (info.height - 2));
  if (sampleCount === 0)
    return {
      metric: RENDER_RESOLUTION_DETAIL_METRIC,
      width: info.width,
      height: info.height,
      sampleCount: 0,
      meanAbsLaplacian: 0,
      highResidualRatio: 0,
    };
  let residualTotal = 0;
  let highResidualCount = 0;
  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const index = y * info.width + x;
      const residual = Math.abs(
        4 * data[index] -
          data[index - 1] -
          data[index + 1] -
          data[index - info.width] -
          data[index + info.width],
      );
      residualTotal += residual;
      if (residual >= HIGH_RESIDUAL_THRESHOLD) highResidualCount += 1;
    }
  }
  return {
    metric: RENDER_RESOLUTION_DETAIL_METRIC,
    width: info.width,
    height: info.height,
    sampleCount,
    meanAbsLaplacian: residualTotal / sampleCount,
    highResidualRatio: highResidualCount / sampleCount,
  };
}

/** Extract a physical crop and the deterministic negative-control mutation. */
export async function measurePngCropSharpness(png, request) {
  const metadata = await sharp(png).metadata();
  const frameSize = {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
  const crop = pixelCropFromRequest(request, frameSize);
  const cropPng = await sharp(png)
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .png()
    .toBuffer();
  const blurredPng = await sharp(cropPng).blur(1.5).png().toBuffer();
  const [sharpness, blurredSharpness] = await Promise.all([
    measurePngSharpness(cropPng),
    measurePngSharpness(blurredPng),
  ]);
  return { crop, frameSize, cropPng, blurredPng, sharpness, blurredSharpness };
}
