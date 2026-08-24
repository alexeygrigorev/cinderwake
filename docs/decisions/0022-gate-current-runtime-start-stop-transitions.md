# 0022 — Gate current-runtime start/stop transitions

**Status:** accepted on 2026-08-24

## Problem

The atlas audit inspected every idle and walk bank, but it did not show those
clips changing in the browser on the opening players actually see. Continuous
locomotion sequences also began in `walk`, so a clip-wide apparent scale change
at movement start or stop could remain outside the temporal matrix.

## Decision

Retain two deterministic browser sequences named `ashfang-start-stop-east` and
`arcanist-start-stop-east`. Both use the production `cinder-041` generated map,
start on its opening floor, run ordinary simulation, and replay the same player
movement tape. Arcanist responds directly. Ashfang uses ordinary pursuit: it
idles while the player is close, walks east after the player opens a gap, and
returns to idle after catching up. No actor state or raster is patched during
capture.

Each replay tape declares a machine-readable three-phase contract. It pins the
clip order, clip start ticks, first and last captured state ticks, required
semantic frame indices, east facing, isolated-mask foot-anchor range of at most
0.25 logical pixels, raster-bottom range of at most 1 pixel, and idle↔walk
median visible-height difference of at most 8 logical pixels. The analysis
records both expected and observed phases.

## Consequence

Current evidence is red. Ashfang's idle/walk medians are 54/66 logical pixels
(12 px apart); Arcanist's are 104/80 (24 px apart). Both phase contracts and
grounding checks pass, so the failures specifically identify the visible size
pop. The matrix must publish that result as failure until a separately reviewed
actor-art change clears the unchanged threshold.

A paired detector control uses equal-height idle/walk measurements as the
passing baseline and raises every walk-mask height measurement by 9 logical pixels. The same
median-height detector rejects the mutation. This control is reported
separately from the already-failing production assets, so their failure cannot
masquerade as proof that the detector works.
