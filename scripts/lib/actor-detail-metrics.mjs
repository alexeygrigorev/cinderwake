import sharp from "sharp";

export const ACTOR_DETAIL_ALGORITHM_VERSION =
  "cinderwake-actor-runtime-detail-v1";

const ALPHA_THRESHOLD = 192;
const EROSION_RADIUS = 2;
const WEAK_DETAIL_MINIMUM = 2;
const STRONG_DETAIL_MINIMUM = 8;

function assertFrame(frame) {
  if (
    !frame?.data ||
    !Number.isInteger(frame.info?.width) ||
    !Number.isInteger(frame.info?.height) ||
    frame.info.width <= 0 ||
    frame.info.height <= 0 ||
    frame.info.channels !== 4 ||
    frame.data.length !== frame.info.width * frame.info.height * 4
  )
    throw new Error("Actor detail metrics require a non-empty raw RGBA frame");
}

function keyedAlpha(red, green, blue) {
  const magentaDominance = Math.min(red, blue) - green;
  const magentaBalance = Math.abs(red - blue);
  if (magentaDominance >= 28 && magentaBalance <= 110) return 0;
  if (magentaDominance > 12 && magentaBalance < 130)
    return Math.max(0, Math.round(((28 - magentaDominance) / 16) * 255));
  const distance = Math.hypot(255 - red, green, 255 - blue);
  if (distance <= 24) return 0;
  if (distance < 115) return Math.round(((distance - 24) / 91) * 255);
  return 255;
}

function applyMagentaKey(data) {
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset + 3] = Math.min(
      data[offset + 3],
      keyedAlpha(data[offset], data[offset + 1], data[offset + 2]),
    );
    if (data[offset + 3] < 8) data[offset + 3] = 0;
  }
}

export async function loadActorDetailFrame(
  fileOrBuffer,
  { extract, resize, keyMagenta = false } = {},
) {
  let image = sharp(fileOrBuffer).ensureAlpha();
  if (extract) image = image.extract(extract);
  if (keyMagenta) {
    const keyed = await image.raw().toBuffer({ resolveWithObject: true });
    applyMagentaKey(keyed.data);
    image = sharp(keyed.data, { raw: keyed.info });
  }
  if (resize)
    image = image.resize(resize.width, resize.height, {
      fit: "fill",
      kernel: resize.kernel ?? "lanczos3",
    });
  const frame = await image.raw().toBuffer({ resolveWithObject: true });
  if (keyMagenta) applyMagentaKey(frame.data);
  assertFrame(frame);
  return frame;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function classifyActorDetailFrame(frame) {
  assertFrame(frame);
  const { data, info } = frame;
  const { width, height } = info;
  const pixels = width * height;
  const opaque = new Uint8Array(pixels);
  const interior = new Uint8Array(pixels);
  const luma = new Float64Array(pixels);
  const horizontalBlur = new Float64Array(pixels);
  const blur = new Float64Array(pixels);
  const detailClass = new Uint8Array(pixels);
  const extrema = new Uint8Array(pixels);

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    opaque[pixel] = data[offset + 3] >= ALPHA_THRESHOLD ? 1 : 0;
    luma[pixel] =
      0.2126 * data[offset] +
      0.7152 * data[offset + 1] +
      0.0722 * data[offset + 2];
  }

  for (let y = EROSION_RADIUS; y < height - EROSION_RADIUS; y += 1) {
    for (let x = EROSION_RADIUS; x < width - EROSION_RADIUS; x += 1) {
      let usable = true;
      for (let dy = -EROSION_RADIUS; dy <= EROSION_RADIUS && usable; dy += 1)
        for (let dx = -EROSION_RADIUS; dx <= EROSION_RADIUS; dx += 1)
          if (!opaque[(y + dy) * width + x + dx]) {
            usable = false;
            break;
          }
      if (usable) interior[y * width + x] = 1;
    }
  }

  for (let y = 0; y < height; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      horizontalBlur[pixel] =
        (luma[pixel - 1] + 2 * luma[pixel] + luma[pixel + 1]) / 4;
    }
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      blur[pixel] =
        (horizontalBlur[pixel - width] +
          2 * horizontalBlur[pixel] +
          horizontalBlur[pixel + width]) /
        4;
    }

  let usableInteriorPixels = 0;
  let weakDetailPixels = 0;
  let strongDetailPixels = 0;
  let isolatedExtremaPixels = 0;
  for (let y = EROSION_RADIUS; y < height - EROSION_RADIUS; y += 1) {
    for (let x = EROSION_RADIUS; x < width - EROSION_RADIUS; x += 1) {
      const pixel = y * width + x;
      if (!interior[pixel]) continue;
      usableInteriorPixels += 1;
      const highPass = Math.abs(luma[pixel] - blur[pixel]);
      if (highPass >= STRONG_DETAIL_MINIMUM) {
        detailClass[pixel] = 2;
        strongDetailPixels += 1;
      } else if (highPass >= WEAK_DETAIL_MINIMUM) {
        detailClass[pixel] = 1;
        weakDetailPixels += 1;
      }

      let brighter = true;
      let darker = true;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = luma[(y + dy) * width + x + dx];
          if (luma[pixel] < neighbor + STRONG_DETAIL_MINIMUM) brighter = false;
          if (luma[pixel] > neighbor - STRONG_DETAIL_MINIMUM) darker = false;
        }
      if (brighter || darker) {
        extrema[pixel] = 1;
        isolatedExtremaPixels += 1;
      }
    }
  }

  const detailedPixels = weakDetailPixels + strongDetailPixels;
  const denominator = Math.max(1, usableInteriorPixels);
  return {
    metrics: {
      algorithmVersion: ACTOR_DETAIL_ALGORITHM_VERSION,
      usableInteriorPixels,
      weakDetailPixels,
      strongDetailPixels,
      isolatedExtremaPixels,
      weakOccupancy: rounded(weakDetailPixels / denominator),
      strongOccupancy: rounded(strongDetailPixels / denominator),
      readability: rounded(
        detailedPixels === 0 ? 0 : strongDetailPixels / detailedPixels,
      ),
      isolatedExtremaOccupancy: rounded(isolatedExtremaPixels / denominator),
    },
    classification: { interior, detailClass, extrema },
  };
}

export function measureActorDetailFrame(frame) {
  return classifyActorDetailFrame(frame).metrics;
}

export function assessActorDetail(metrics, thresholds) {
  const violations = [];
  if (metrics.usableInteriorPixels < thresholds.usableInteriorMinimum)
    violations.push({
      code: "runtime-detail-insufficient-interior",
      actual: metrics.usableInteriorPixels,
      minimum: thresholds.usableInteriorMinimum,
    });
  if (
    metrics.strongOccupancy < thresholds.strongOccupancyMinimum ||
    metrics.readability < thresholds.readabilityMinimum
  )
    violations.push({
      code: "runtime-detail-collapse",
      strongOccupancy: metrics.strongOccupancy,
      strongOccupancyMinimum: thresholds.strongOccupancyMinimum,
      readability: metrics.readability,
      readabilityMinimum: thresholds.readabilityMinimum,
    });
  if (
    metrics.strongOccupancy > thresholds.strongOccupancyMaximum ||
    metrics.isolatedExtremaOccupancy >
      thresholds.isolatedExtremaOccupancyMaximum
  )
    violations.push({
      code: "runtime-detail-overload",
      strongOccupancy: metrics.strongOccupancy,
      strongOccupancyMaximum: thresholds.strongOccupancyMaximum,
      isolatedExtremaOccupancy: metrics.isolatedExtremaOccupancy,
      isolatedExtremaOccupancyMaximum:
        thresholds.isolatedExtremaOccupancyMaximum,
    });
  return { pass: violations.length === 0, violations };
}

export async function renderActorDetailMap(frame) {
  const { metrics, classification } = classifyActorDetailFrame(frame);
  const output = Buffer.alloc(frame.data.length);
  for (let pixel = 0; pixel < classification.interior.length; pixel += 1) {
    const offset = pixel * 4;
    if (!classification.interior[pixel]) continue;
    output[offset + 3] = 255;
    if (classification.extrema[pixel]) {
      output[offset] = 255;
      output[offset + 1] = 64;
      output[offset + 2] = 220;
    } else if (classification.detailClass[pixel] === 2) {
      output[offset] = 238;
      output[offset + 1] = 78;
      output[offset + 2] = 63;
    } else if (classification.detailClass[pixel] === 1) {
      output[offset] = 242;
      output[offset + 1] = 179;
      output[offset + 2] = 65;
    } else {
      output[offset] = 44;
      output[offset + 1] = 111;
      output[offset + 2] = 168;
    }
  }
  const png = await sharp(output, { raw: frame.info }).png().toBuffer();
  return { metrics, png };
}
