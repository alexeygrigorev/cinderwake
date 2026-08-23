# ADR 0008: measure real raster masks and separate presentation from simulation

## Context

Manifests know intended geometry, but cannot prove that the rasterized actor has ink where intended. Conversely, live interpolation and smooth camera are desirable for play but can obscure which exact simulation state a screenshot represents.

## Decision

Capture each tracked entity in isolation on a transparent canvas and record alpha-derived ink bounds, centroid, bottom offset, pixel count, hash, and PNG. Keep presentation interpolation/camera as an explicit manifest contract; test captures render alpha 1 with deterministic snap or fixed camera unless a smooth-camera profile is the subject.

## Alternatives considered

- Use only draw-call bounds: misses drawing bugs inside or outside the declared rectangle.
- Use full-scene pixel diffs only: overlap and background make sprite-specific diagnosis weak.
- Disable interpolation in all builds: simplifies capture but unnecessarily degrades the playable display.

## Consequences

The framework can substantiate clipping, foot-anchor, and proportion judgments with actual pixels while retaining smooth interactive display. Isolated masks and profile-aware camera tests add capture work, but make visual failures more explainable and reproducible.
