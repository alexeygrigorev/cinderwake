# ADR 0003: procedural raster art

## Context

The project needs readable sprites and repeatable visual artifacts without a large external art pipeline. Test scenes must work in fresh clones and deterministic CI.

## Decision

Use small, authored/procedural raster-style assets with declared source rectangles, anchors, and palette choices. Asset generation and selection are deterministic; render manifests identify the exact source/destination geometry.

## Alternatives considered

- Commissioned high-resolution art: attractive but slower to iterate and less suitable for a compact test fixture.
- Runtime generative art: introduces nondeterminism and makes visual baselines opaque.
- Pure geometry placeholders: easy to test but insufficient for sprite clipping, proportions, and animation quality.

## Consequences

The game retains a coherent, inspectable visual language while keeping assets portable. Raster scaling rules, source bounds, anchors, and browser rasterization need explicit tests; procedural art remains an implementation tool, not a substitute for visual review.
