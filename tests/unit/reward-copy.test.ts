import { describe, expect, it } from "vitest";
import { lootPickupCopy } from "../../src/game/rewardCopy";

describe("loot pickup copy", () => {
  it.each([
    ["gold", 6, "Gold +6"],
    ["tonic", 1, "Tonic +1"],
    ["weapon", 3, "Power +3"],
  ] as const)("reports the applied %s delta", (detail, amount, expected) => {
    expect(lootPickupCopy({ type: "loot_picked", detail, amount })).toBe(
      expected,
    );
  });

  it("does not report a reward when no pickup occurred", () => {
    expect(
      lootPickupCopy({ type: "loot_dropped", detail: "weapon", amount: 3 }),
    ).toBeNull();
    expect(
      lootPickupCopy({ type: "loot_picked", detail: "weapon" }),
    ).toBeNull();
  });

  it("does not invent a named equipment claim for unknown loot", () => {
    expect(
      lootPickupCopy({ type: "loot_picked", detail: "relic-sword", amount: 1 }),
    ).toBeNull();
  });
});
