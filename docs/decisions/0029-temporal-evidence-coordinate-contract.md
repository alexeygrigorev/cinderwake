# 0029 — Make temporal evidence zoom- and backing-aware

**Status:** accepted on 2026-08-24

## Problem

The first matrix after introducing 0.9 world zoom and a responsive high-DPI
canvas reported zero passing sequences. The game frames were valid, but the
assessor still expected unzoomed actor scale, destination size, and screen
position. Every real draw call was therefore labeled a state/manifest mismatch.

The capture path had a separate evidence error. It calculated a 260 × 200
close-up in logical 960 × 540 coordinates, then supplied those coordinates
directly to a larger physical canvas backing. The report crosshair used the
logical crop and could appear correctly placed while the PNG sampled a
different region. Finally, the matrix named a removed `temporal-run-win`
fixture, so that member crashed while trying to parse its name as JSON.

## Decision

The assessor derives projection independently from state and declared camera
data:

`screen = viewport center + (world pixels - camera position) × camera zoom`

Actor scale and destination dimensions use the same uniform zoom. Destination
dimensions remain floating point because the renderer deliberately retained
exact 43.2-pixel tile adjacency at 0.9 zoom to prevent terrain seams.

Close-up bounds and anchor placement remain logical. The capture converts only
the `drawImage` source rectangle through the measured backing X/Y scale and
downsamples that physical region to the stable logical crop. Every timeline
frame records logical bounds, backing dimensions/scales, and physical source
rectangle. The assessor fails if those values no longer map exactly or leave
the backing. Paired controls prove that a coherent unzoomed manifest and an
unscaled 1.5× backing crop are both rejected.

Restore `temporal-run-win` as an explicit pre-won arbitrary-state fixture. It
proves state restoration, the victory overlay, and terminal-state freezing; it
does not claim that the current city progression has a reachable win. Add the
reachable wilderness-to-Embercross transition as its own 26th matrix member.

Directional locomotion no longer requires a permanently fixed screen anchor.
That obsolete rule rejected valid north/south motion when a camera clamp let
the glyph move in the commanded direction. The replacement requires exact
world velocity and permits the camera to absorb any portion of the projected
step, while rejecting screen movement opposite the world direction or larger
than the untracked projected step. A paired east-world/west-glyph mutation
proves the check can fail.

Smooth-camera convergence is measured against the renderer's declared
56-logical-pixel dead zone, not against the unreachable player-centered target
it deliberately avoids. Error must decrease monotonically, the final X/Y
excess beyond `56 / zoom` must be at most two camera pixels, zoom error must be
at most 0.001, and the existing acceleration bound remains unchanged.

## Consequence

Temporal verdicts now distinguish presentation defects from evidence-coordinate
defects. A valid zoomed runtime passes without weakening geometry thresholds,
and a close-up cannot silently describe one logical region while sampling
another physical region. Three real browser probes—east locomotion, pre-won
overlay, and city entry—passed the corrected full capture path before the full
matrix was rerun.
