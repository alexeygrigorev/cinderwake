/** Remove baked neutral matte before resizing, then decontaminate only its edge. */
export function cleanStructurePixels(input, width, height) {
  const data = Buffer.from(input);
  const distance = new Uint8Array(width * height).fill(255);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    const colors = [data[offset], data[offset + 1], data[offset + 2]];
    const spread = Math.max(...colors) - Math.min(...colors);
    const brightness = colors.reduce((sum, value) => sum + value, 0) / 3;
    if (data[offset + 3] === 0 || (spread < 24 && brightness >= 220)) {
      data.fill(0, offset, offset + 4);
      distance[pixel] = 0;
      queue[tail++] = pixel;
    }
  }
  // Limit soft matting to the two-pixel perimeter. Neutral stone inside a
  // structure is material, not background, and must retain its original RGB.
  while (head < tail) {
    const pixel = queue[head++];
    if (distance[pixel] === 2) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (const next of [
      x > 0 ? pixel - 1 : -1,
      x + 1 < width ? pixel + 1 : -1,
      y > 0 ? pixel - width : -1,
      y + 1 < height ? pixel + width : -1,
    ]) {
      if (next < 0 || distance[next] !== 255) continue;
      distance[next] = distance[pixel] + 1;
      queue[tail++] = next;
    }
  }
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (distance[pixel] === 0 || distance[pixel] > 2) continue;
    const offset = pixel * 4;
    const colors = [data[offset], data[offset + 1], data[offset + 2]];
    const spread = Math.max(...colors) - Math.min(...colors);
    const brightness = colors.reduce((sum, value) => sum + value, 0) / 3;
    if (spread >= 48 || brightness <= 145) continue;
    const alpha = Math.min(
      data[offset + 3] / 255,
      Math.max(0, (232 - brightness) / (232 - 90)),
    );
    if (alpha === 0) {
      data.fill(0, offset, offset + 4);
      continue;
    }
    data[offset + 3] = Math.round(alpha * 255);
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = Math.max(
        0,
        Math.min(
          255,
          Math.round((data[offset + channel] - 232 * (1 - alpha)) / alpha),
        ),
      );
    }
  }
  return data;
}

/** Detect light matte on translucent silhouette pixels, regardless of art style. */
export function lightFringePixels(data) {
  let count = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    const r = data[offset],
      g = data[offset + 1],
      b = data[offset + 2];
    if (
      alpha > 0 &&
      alpha < 250 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 32 &&
      (r + g + b) / 3 > 160
    )
      count++;
  }
  return count;
}
