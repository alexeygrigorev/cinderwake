# 0019 — Observe the real opening, not only a stepped fixture

**Status:** accepted on 2026-08-24

## Problem

The deterministic bridge could load any state, advance exact ticks, and inspect
pixels, yet every gameplay browser test ran through that bridge. A broken
ordinary `requestAnimationFrame` loop could therefore freeze the public game
while all exact-step tests remained green. The generated run also placed every
monster more than eight tiles away. Initial screenshots contained fourteen
valid enemies in state but showed an empty arena, and the 960 × 540 manifest
could call an enemy visible even when a portrait phone cover-cropped its body.

## Decision

The public game installs a second, read-only observation boundary. It can clone
the canonical state, render manifest, current canvas, and recent presentation
samples. It cannot load state, choose a scenario, inject input, pause, step,
reset, or mutate the clock. Production-journey tests must enter through `/`,
press the same character and launch controls as a player, use physical touch or
keys, wait real time, and observe outcomes only through that boundary.

Generated runs now author a small first engagement around the spawn while the
remaining enemies stay distributed through the dungeon. The first Stonekin,
Ashfang, and Hexer use deterministic mirrored slots chosen only from walkable
positions clear of solid scenery. The slots are constrained to the narrow
center slice retained by a portrait cover-fit. Generated rooms also receive
deterministic passable raster decals; explicit motion fixtures do not, so their
controlled temporal backgrounds remain stable.

The render manifest includes monster world-UI geometry. Health bars derive
their vertical position from the current frame's real alpha bounds rather than
the top of its mostly transparent atlas cell. This keeps a low Ashfang bar
attached to the silhouette and makes the relationship measurable.

## Testing consequence

The ordinary-player journey fails unless all of these remain true:

1. the real-time simulation advances at least 45 ticks in 1.25 seconds and
   produces more than twenty distinct presentation samples;
2. three opening enemies are present, wholly inside the unobstructed portrait
   device viewport after the real CSS canvas transform, and not deeply stacked;
3. the objective identifies a living target and its raster HUD does not cover a
   structure or actor in any screen-contract profile;
4. each opening health bar is centered and two to four logical pixels above
   the current frame's measured visible ink;
5. a ground tap moves without starting a player attack, while the explicit
   Strike control starts one; and
6. the production route exposes no mutation-capable `__GAME_TEST__` bridge.

Paired negative controls center the objective over the forge and calculate the
rejected cell-top health-bar gap. These prove the assessors detect the observed
failure classes instead of merely reporting a green happy path.

The four public gameplay screenshots are candidates whenever this composition
changes. Machine gates may regenerate them, but only a hash-bound independent
visual review can promote the exact set.
