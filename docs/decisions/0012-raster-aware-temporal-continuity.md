# ADR 0012: Raster-aware temporal continuity

## Status

Accepted.

## Context

An isolated actor rendered from two atlas locations can have different pixel hashes even when both locations contain the same source pose. Browser image filtering samples against different atlas coordinates, creating tiny color/alpha differences that are not a visible recovery pop. Conversely, attached spell particles can move the full-mask centroid while the character body remains planted. Treating both cases as exact full-mask identity makes the automated reviewer reject good motion, while simply increasing global tolerances would hide real jumps.

## Decision

Recovery transitions retain exact lifecycle, dimensions, alpha area, and a 0.25-pixel centroid bound, but compare decoded RGBA masks with normalized RMSE `≤ 0.001` instead of requiring equal hash strings. Artifact SHA-256 and identical render signatures remain exact integrity/determinism checks.

For a one-shot frame whose dimensions exceed the ordinary continuity envelope, the evaluator measures alpha-weighted motion inside a 48-pixel band centered on the semantic foot anchor. The attached effect passes only when full dimensions stay within 42 pixels, core centroid step stays at or below 16 pixels, and core acceleration stays at or below 10 pixels per sampled interval. Ordinary action, locomotion, grounding, lifecycle, and visual-review gates remain unchanged.

## Consequences

The report distinguishes harmless raster filtering from a visible pose change and distinguishes character-body motion from attached magic bloom. Both measurements are derived from retained mask PNGs, emitted with their thresholds, and reproducible offline. Detached effects, large body shifts, wrong recovery geometry, and substituted artifacts still fail. Independent sequence review retains veto authority over any metric pass.
