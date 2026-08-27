export const SPRITE_LEAK_ALPHA_THRESHOLD = 8;

export const SPRITE_LEAK_SIGNAL_IDS = [
  "no-cross-cell-ink",
  "no-matte-or-fringe",
];

export const SPRITE_LEAK_FAILURE_IDS = [
  "cross-cell-ink-detected",
  "opaque-matte-detected",
  "colored-fringe-detected",
];

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isRect(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function sameRect(first, second) {
  return (
    isRect(first) &&
    isRect(second) &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function containsRect(outer, inner) {
  return (
    isRect(outer) &&
    isRect(inner) &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function isRgba(width, height, rgba) {
  return (
    Number.isInteger(width) &&
    width > 0 &&
    Number.isInteger(height) &&
    height > 0 &&
    rgba instanceof Uint8Array &&
    rgba.length === width * height * 4
  );
}

function validBorder(border, width, height) {
  return (
    border !== null &&
    typeof border === "object" &&
    Number.isInteger(border.left) &&
    Number.isInteger(border.top) &&
    Number.isInteger(border.right) &&
    Number.isInteger(border.bottom) &&
    border.left >= 0 &&
    border.top >= 0 &&
    border.right >= 0 &&
    border.bottom >= 0 &&
    border.left + border.right < width &&
    border.top + border.bottom < height
  );
}

function inBorder(x, y, width, height, border) {
  return (
    x < border.left ||
    y < border.top ||
    x >= width - border.right ||
    y >= height - border.bottom
  );
}

function failure(code, detail) {
  return { code, detail };
}

function invalidAssessment(sample, code, detail) {
  return {
    id: typeof sample?.id === "string" ? sample.id : "",
    valid: false,
    pass: false,
    failures: [failure(code, detail)],
    metrics: {
      width: sample?.width ?? null,
      height: sample?.height ?? null,
      inkPixels: 0,
      borderPixels: 0,
      borderInkPixels: 0,
      opaqueMattePixels: 0,
      fringePixels: 0,
      sourceRectInsideCell: false,
      sourceRectMatchesCell: false,
    },
  };
}

/**
 * Inspect one decoded atlas cell. The caller supplies the exact source crop
 * contract and a role-specific transparent border; no hidden image heuristic
 * is used to decide whether a crop may cross into a neighboring cell.
 */
export function assessSpriteLeakSample(sample) {
  const width = sample?.width;
  const height = sample?.height;
  if (!isRgba(width, height, sample?.rgba))
    return invalidAssessment(
      sample,
      "invalid-raster",
      "sample must contain width × height RGBA bytes",
    );
  if (!isRect(sample.cell) || !isRect(sample.sourceRect))
    return invalidAssessment(
      sample,
      "invalid-rect-contract",
      "cell and sourceRect must be positive finite rectangles",
    );
  if (!validBorder(sample.transparentBorder, width, height))
    return invalidAssessment(
      sample,
      "invalid-border-contract",
      "transparentBorder must leave a nonempty interior",
    );

  const sourceRectInsideCell = containsRect(sample.cell, sample.sourceRect);
  const sourceRectMatchesCell = sameRect(sample.cell, sample.sourceRect);
  const failures = [];
  if (!sourceRectInsideCell || !sourceRectMatchesCell)
    failures.push(
      failure("cross-cell-ink-detected", {
        cell: sample.cell,
        sourceRect: sample.sourceRect,
      }),
    );

  let inkPixels = 0;
  let borderPixels = 0;
  let borderInkPixels = 0;
  let opaqueMattePixels = 0;
  let fringePixels = 0;
  let maxBorderAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = sample.rgba[offset + 3];
      if (alpha >= SPRITE_LEAK_ALPHA_THRESHOLD) inkPixels += 1;
      if (!inBorder(x, y, width, height, sample.transparentBorder)) continue;
      borderPixels += 1;
      maxBorderAlpha = Math.max(maxBorderAlpha, alpha);
      if (alpha >= SPRITE_LEAK_ALPHA_THRESHOLD) borderInkPixels += 1;
      if (alpha >= 250) opaqueMattePixels += 1;
      else if (alpha > 0) fringePixels += 1;
    }
  }
  if (opaqueMattePixels > 0)
    failures.push(
      failure("opaque-matte-detected", {
        opaqueMattePixels,
        borderPixels,
      }),
    );
  if (fringePixels > 0)
    failures.push(
      failure("colored-fringe-detected", {
        fringePixels,
        maxBorderAlpha,
      }),
    );
  if (inkPixels === 0)
    failures.push(failure("blank-sample", "sample has no alpha ink"));

  return {
    id: typeof sample.id === "string" ? sample.id : "",
    valid: true,
    pass: failures.length === 0,
    failures,
    metrics: {
      width,
      height,
      inkPixels,
      borderPixels,
      borderInkPixels,
      opaqueMattePixels,
      fringePixels,
      maxBorderAlpha,
      sourceRectInsideCell,
      sourceRectMatchesCell,
    },
  };
}

function hasFailure(assessment, code) {
  return assessment?.failures?.some(({ code: actual }) => actual === code);
}

/** Aggregate per-cell observations without retaining raw image bytes. */
export function evaluateSpriteLeakAssessments(assessments) {
  const values = Array.isArray(assessments) ? assessments : [];
  const noCrossCellInk =
    values.length > 0 &&
    values.every(
      (assessment) =>
        assessment?.valid === true &&
        !hasFailure(assessment, "cross-cell-ink-detected"),
    );
  const noMatteOrFringe =
    values.length > 0 &&
    values.every(
      (assessment) =>
        assessment?.valid === true &&
        !hasFailure(assessment, "opaque-matte-detected") &&
        !hasFailure(assessment, "colored-fringe-detected"),
    );
  const failures = [
    ...new Set(
      values.flatMap((assessment) =>
        (assessment?.failures ?? []).map(({ code }) => code),
      ),
    ),
  ];
  return {
    pass: noCrossCellInk && noMatteOrFringe,
    failures,
    signals: [
      signal(
        "no-cross-cell-ink",
        noCrossCellInk,
        values.map(({ id, metrics, failures: sampleFailures }) => ({
          id,
          sourceRectInsideCell: metrics?.sourceRectInsideCell ?? false,
          sourceRectMatchesCell: metrics?.sourceRectMatchesCell ?? false,
          failures: sampleFailures ?? [],
        })),
      ),
      signal(
        "no-matte-or-fringe",
        noMatteOrFringe,
        values.map(({ id, metrics, failures: sampleFailures }) => ({
          id,
          opaqueMattePixels: metrics?.opaqueMattePixels ?? 0,
          fringePixels: metrics?.fringePixels ?? 0,
          failures: sampleFailures ?? [],
        })),
      ),
    ],
    assessments: values,
  };
}

export function evaluateSpriteLeakEvidence({ samples } = {}) {
  const assessments = Array.isArray(samples)
    ? samples.map(assessSpriteLeakSample)
    : [];
  return evaluateSpriteLeakAssessments(assessments);
}

function cloneSample(sample) {
  return {
    ...sample,
    cell: { ...sample.cell },
    sourceRect: { ...sample.sourceRect },
    transparentBorder: { ...sample.transparentBorder },
    rgba: new Uint8Array(sample.rgba),
  };
}

function firstBorderPixel(sample) {
  for (let y = 0; y < sample.height; y += 1)
    for (let x = 0; x < sample.width; x += 1)
      if (inBorder(x, y, sample.width, sample.height, sample.transparentBorder))
        return { x, y };
  return null;
}

function setPixel(sample, point, red, green, blue, alpha) {
  if (!point) return;
  const offset = (point.y * sample.width + point.x) * 4;
  sample.rgba[offset] = red;
  sample.rgba[offset + 1] = green;
  sample.rgba[offset + 2] = blue;
  sample.rgba[offset + 3] = alpha;
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/** Exercise source-crop, opaque-matte, and fringe mutations independently. */
export function runSpriteLeakNegativeControls(sample) {
  const definitions = [
    {
      id: "cross-cell-shift",
      expectedSignal: "cross-cell-ink-detected",
      mutate(candidate) {
        candidate.sourceRect.x -= 1;
      },
    },
    {
      id: "opaque-matte",
      expectedSignal: "opaque-matte-detected",
      mutate(candidate) {
        setPixel(candidate, firstBorderPixel(candidate), 238, 238, 238, 255);
      },
    },
    {
      id: "colored-fringe",
      expectedSignal: "colored-fringe-detected",
      mutate(candidate) {
        setPixel(candidate, firstBorderPixel(candidate), 255, 24, 196, 24);
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const candidate = cloneSample(sample);
    mutate(candidate);
    const assessment = assessSpriteLeakSample(candidate);
    const detected = hasFailure(assessment, expectedSignal);
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: assessment.failures.map(({ code }) => code),
    };
  });
}
