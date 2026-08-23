import type { RngStream, RngStreams } from "./types";

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: string): RngStream {
  const state = hashString(seed) || 0x6d2b79f5;
  return { state, draws: 0 };
}

export function createRngStreams(seed: string): RngStreams {
  return {
    map: createRng(`${seed}:map`),
    combat: createRng(`${seed}:combat`),
    loot: createRng(`${seed}:loot`),
    ai: createRng(`${seed}:ai`),
    cosmetic: createRng(`${seed}:cosmetic`),
  };
}

export function nextUint(stream: RngStream): number {
  let value = stream.state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  stream.state = value >>> 0 || 0x6d2b79f5;
  stream.draws += 1;
  return stream.state;
}

export function randomFloat(stream: RngStream): number {
  return nextUint(stream) / 0x1_0000_0000;
}

export function randomInt(
  stream: RngStream,
  minimum: number,
  maximumExclusive: number,
): number {
  return (
    minimum + Math.floor(randomFloat(stream) * (maximumExclusive - minimum))
  );
}

export function pick<T>(stream: RngStream, values: readonly T[]): T {
  const value = values[randomInt(stream, 0, values.length)];
  if (value === undefined) throw new Error("Cannot pick from an empty list");
  return value;
}
