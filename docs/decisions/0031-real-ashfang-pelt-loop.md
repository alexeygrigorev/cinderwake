# ADR 0031: Carry Ashfang pelts through the real reward-to-refuge loop

Status: accepted product/state path; visual asset replacement required

## Problem

Mara's sale transaction accepted `ashfang-pelt`, but ordinary combat could
never create that inventory. Existing city tests injected pelts at the service
boundary, so a green merchant button did not prove a player could earn and sell
the item.

## Decision

- Every dead Ashfang creates one common pelt in addition to its existing
  deterministic general reward.
- The pelt uses a separate stream keyed by `seed + monster ID + item role`.
  Existing drop chance, kind, rarity, amount, and bob draws are unchanged.
- Auto-pickup still requires the player body to enter the normal 700-unit
  radius. Pickup increments the canonical stable-order traveler inventory and
  emits the ordinary typed `loot_picked` event.
- Mara reads that same inventory. The live-player synchronization performed
  before a service transaction spreads the traveler state and therefore cannot
  erase wilderness trophies.
- Exact snapshots accept the new loot kind without changing GameState schema
  version 2; older snapshots contain only the prior enum members and restore
  unchanged.

## Production-path evidence and fixture boundary

The browser test begins at the existing pre-combat `combat-loot` scenario,
uses the shipped Strike control, waits through real damage/death/drop systems,
holds the physical east key until the player enters pickup range, and asserts
the item from both manifest pixels and captured state. It then carries that
exact captured inventory through the pure discovery/gate/entry commands,
relocating only map and player position to Mara before clicking the shipped sale
button. This city relocation is the sole fixture boundary: the separate mobile
journey test already proves physical wilderness-to-city traversal, while this
test isolates item provenance and deliberately never injects inventory.

## Visual limitation

No reviewed pelt exists in the current raster atlases. The stable
`loot:ashfang-pelt:<rarity>` catalog role temporarily addresses the existing
weapon loot cells, preserving a real sprite draw and animation contract without
inventing CSS, SVG, or unreviewed art. The product path is accepted; the pelt's
appearance is not. Replacing only those source rectangles with a generated,
cut, audited pelt row closes the visual gap without state or simulation changes.
