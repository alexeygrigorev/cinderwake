import type { GameEvent } from "./types";

const PICKUP_LABELS = {
  gold: "Gold",
  tonic: "Tonic",
  weapon: "Power",
  "ashfang-pelt": "Pelt",
} as const;

/** Facts shown in the run log are the stat delta applied by collectLoot. */
export function lootPickupCopy(
  event: Pick<GameEvent, "type" | "detail" | "amount">,
): string | null {
  const amount = event.amount;
  if (
    event.type !== "loot_picked" ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0
  )
    return null;
  const label = PICKUP_LABELS[event.detail as keyof typeof PICKUP_LABELS];
  return label ? `${label} +${amount}` : null;
}
