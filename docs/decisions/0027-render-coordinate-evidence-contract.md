# 0027 — Separate logical render evidence from physical backing storage

**Status:** accepted on 2026-08-24

## Problem

The high-DPI renderer keeps world and manifest geometry in a fixed 960 × 540
logical viewport while allocating a larger responsive canvas backing store.
Several browser assessors divided logical destination rectangles by
`canvas.width` and `canvas.height`, accidentally treating physical pixels as
world-screen coordinates. That made visible actors appear cropped to the
tests, hid HUD overlap mutations, sampled unrelated terrain pixels, and changed
the dimensions of deterministic animation snapshots.

The walk regression also encoded a superseded visual rule: it required one
fixed screen-space foot anchor even after the camera reached a map edge. That
would reject the requested causal feedback where an eastbound character glyph
visibly moves east.

## Decision

Render manifests remain authoritative for logical projection. Browser-space
assessors convert `destinationRect` through `manifest.viewport.width` and
`manifest.viewport.height`; raster samplers alone multiply logical sample
points by `manifest.viewport.dpr` before reading the physical backing buffer.

The mutating deterministic bridge captures a downsampled 960 × 540 logical
frame, while the observe-only production bridge retains the actual high-DPI
canvas. Exact renderer snapshots therefore stay device-independent and real
mobile evidence can still expose blur, stretching, and backing-store defects.

Terrain collision evidence now compares the manifested stone ridge sprite with
its adjacent walkable floor. Its canvas mutation paints both logical locations
through the active DPR transform, proving that an erased visual boundary is
rejected. The walk regression requires exact world velocity, monotonic
same-direction screen displacement, a bounded per-tick glyph step, fixed
vertical anchor, and stable aspect instead of requiring no glyph movement.

The public launch matrix is still entered through `captureMode=1`: it freezes a
real authored opening for deterministic screenshot review but exposes no
scenario bridge. A separate ordinary production journey proves real-time
liveness. Its rAF sample count has a machine-independent floor, while tick
advance, distinct presentation phases, maximum real-time gap, threats, and
console faults remain required.

## Consequence

The four viewport assessments, HUD mutation, terrain mutation, directional
motion regression, and raw animation captures now agree on one explicit
coordinate boundary. Changing DPR no longer changes logical snapshot
dimensions or makes semantic geometry checks inspect the wrong part of the
screen. The refreshed screenshots record the reviewed 0.9 zoom and high-DPI
rasterization only; they do not constitute visual acceptance, and the
hash-bound presentation review returns to candidate state after the pixel
change.
