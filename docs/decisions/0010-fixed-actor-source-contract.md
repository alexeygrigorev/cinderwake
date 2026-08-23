# ADR 0010: Fixed actor source contract

## Status

Accepted.

## Context

Character generation is inexpensive only if every new result has the same spatial and semantic contract. Ad-hoc sheets force character-specific cropping, anchors, frame counts, and renderer branches; they also make temporal comparisons ambiguous because a shifted crop can look like motion.

## Decision

Each actor supplies six original 4 × 4 sheets with 256 × 256 cells: primary identity/east movement, authored north/south movement, east attack/ability detail, east hurt/death reactions, north/south action detail, and north/south reactions. All sheets share one bottom-center ground anchor and one normalization envelope. `ActorAtlasV2` declares every source cell, output row, frame count, duration, facing rule, and reserved row. The deterministic build creates a fixed untrimmed 1024 × 2560 runtime atlas with 128 × 128 cells and a hash manifest. The higher-resolution source remains committed; only the browser delivery atlas is downsampled to keep six actors practical on mobile.

West may reflect east. North and south may not be synthesized by tinting, skewing, or mirroring. Production animation uses articulated poses rather than cross-dissolved duplicate bodies. Each action bank ends on the corresponding directional idle source so recovery has a measurable near-zero raster seam and exact geometry endpoint.

## Consequences

New characters require art that satisfies the same template but no character-specific renderer code. Tests can resolve every semantic clip and cardinal facing to a stable source rectangle, compare isolated masks, and distinguish an anchor regression from world movement. The cost is six source sheets and rejection/regeneration when a sheet breaks identity or alignment; this is intentional quality control rather than runtime complexity.
