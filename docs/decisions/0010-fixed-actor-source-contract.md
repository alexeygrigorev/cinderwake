# ADR 0010: Fixed actor source contract

## Status

Accepted.

## Context

Character generation is inexpensive only if every new result has the same spatial and semantic contract. Ad-hoc sheets force character-specific cropping, anchors, frame counts, and renderer branches; they also make temporal comparisons ambiguous because a shifted crop can look like motion.

## Decision

Each actor supplies four original 4 × 4 sheets with 256 × 256 cells: primary identity/east movement, authored north/south movement, authored attack/ability detail, and authored hurt/death reactions. All sheets share one bottom-center ground anchor and one normalization envelope. `ActorAtlasV2` declares every source cell, output row, frame count, duration, facing rule, and reserved row. The deterministic build creates a fixed untrimmed 2048 × 3072 runtime atlas and a hash manifest.

West may reflect east. North and south may not be synthesized by tinting, skewing, or mirroring. Production animation uses articulated poses rather than cross-dissolved duplicate bodies. The terminal action frame is the exact primary idle source so recovery has a measurable zero-seam endpoint.

## Consequences

New characters require art that satisfies the same template but no character-specific renderer code. Tests can resolve a semantic clip to a stable source rectangle, compare isolated masks, and distinguish an anchor regression from world movement. The cost is extra authored source material and rejection/regeneration when a sheet breaks identity or alignment; this is intentional quality control rather than runtime complexity.
