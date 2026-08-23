import type { GameState } from "../game/types";

/** JSON-safe, reproducible representation intended for assertions and artifacts. */
export type CanonicalState = GameState;

const ENTITY_ARRAYS = new Set([
  "monsters",
  "pendingAttacks",
  "projectiles",
  "loot",
  "effects",
]);

function canonicalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    if (key && ENTITY_ARRAYS.has(key)) {
      return items.sort((a, b) =>
        String((a as { id?: string }).id ?? "").localeCompare(
          String((b as { id?: string }).id ?? ""),
        ),
      );
    }
    return items;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((name) => [name, canonicalize(record[name], name)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value))
    return String(value);
  return value;
}

export function canonicalState(state: GameState): CanonicalState {
  return canonicalize(state) as GameState;
}

export function canonicalJson(state: GameState): string {
  return JSON.stringify(canonicalState(state));
}

/** FNV-1a 32-bit: intentionally lightweight, stable, and not cryptographic. */
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stateHash(state: GameState): string {
  return fnv1a(canonicalJson(state));
}
