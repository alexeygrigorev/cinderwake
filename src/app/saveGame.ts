import type { GameState } from "../game/types";
import { stateFromSnapshot } from "../testkit/stateSnapshots";
import { fnv1a } from "../testkit/canonical";

export const SAVE_KEY = "cinderwake.save.v1";
export const AUTO_SAVE_KEY = "cinderwake.autosave.v1";
const MAX_SAVE_LENGTH = 4_194_304;
export interface CampaignSave {
  version: 1;
  savedAt: number;
  discoveries: string[];
  state: GameState;
}
type SaveStorage = Pick<Storage, "getItem" | "setItem">;

/** Corruption detection, not authentication. Imports always validate the full state. */
export function encodeSave(
  state: GameState,
  discoveries: readonly string[] = [],
  savedAt = Date.now(),
): string {
  const payload: CampaignSave = {
    version: 1,
    savedAt,
    discoveries: [...new Set(discoveries)].sort(),
    state: stateFromSnapshot(state),
  };
  const serialized = JSON.stringify({
    ...payload,
    checksum: fnv1a(JSON.stringify(payload)),
  });
  decodeSave(serialized);
  return serialized;
}

export function decodeSave(serialized: string): CampaignSave {
  if (serialized.length > MAX_SAVE_LENGTH)
    throw new Error("Save file is too large (maximum 4 MB).");
  const parsed = JSON.parse(serialized) as CampaignSave & { checksum: string };
  if (!parsed || parsed.version !== 1)
    throw new Error("Unsupported save version.");
  const { version, savedAt, discoveries, state } = parsed;
  if (!Number.isSafeInteger(savedAt) || savedAt < 0)
    throw new Error("Invalid save date.");
  if (
    !Array.isArray(discoveries) ||
    discoveries.length > 256 ||
    discoveries.some((id) => typeof id !== "string" || id.length > 128)
  )
    throw new Error("Invalid journal discoveries.");
  const payload = { version, savedAt, discoveries, state };
  if (parsed.checksum !== fnv1a(JSON.stringify(payload)))
    throw new Error("Save checksum mismatch. The file may be damaged.");
  return { ...payload, state: stateFromSnapshot(state) };
}

export function loadSave(
  storage: SaveStorage,
  kind?: "manual" | "auto",
): CampaignSave | null {
  const candidates: CampaignSave[] = [];
  for (const key of kind === "manual"
    ? [SAVE_KEY]
    : kind === "auto"
      ? [AUTO_SAVE_KEY]
      : [SAVE_KEY, AUTO_SAVE_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (raw) candidates.push(decodeSave(raw));
    } catch {
      /* A corrupt/unavailable slot must not hide the other checkpoint. */
    }
  }
  return candidates.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

/** setItem is atomic. Never remove the previous checkpoint before writing its replacement. */
export function storeSave(
  storage: SaveStorage,
  state: GameState,
  discoveries: readonly string[] = [],
  kind: "manual" | "auto" = "manual",
  savedAt = Date.now(),
): CampaignSave {
  const encoded = encodeSave(state, discoveries, savedAt);
  storage.setItem(kind === "manual" ? SAVE_KEY : AUTO_SAVE_KEY, encoded);
  return decodeSave(encoded);
}

export function safeToAutosave(state: GameState): boolean {
  // Completion is a stable checkpoint even when the final battle left low health.
  if (state.phase === "won") return true;
  return (
    state.phase === "playing" &&
    state.player.health >= state.player.maxHealth * 0.5 &&
    !state.monsters.some(
      (enemy) =>
        enemy.health > 0 &&
        Math.hypot(
          enemy.position.x - state.player.position.x,
          enemy.position.y - state.player.position.y,
        ) <
          5 * 1024,
    ) &&
    !state.projectiles.some((projectile) => projectile.owner !== "player") &&
    !state.pendingAttacks.some((attack) => attack.ownerId !== "player")
  );
}
