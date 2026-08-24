# 0024 — Enforce and verify topology-locked surface edits

**Status:** accepted on 2026-08-24

## Problem

An independently reviewed Ashfang anatomy blockout established four readable
limb chains, paw terminals, gaps, perspective order, and a coherent support
footprint. A later prompt told image generation to treat those pixels as an
immutable stencil while adding only surface identity. The generated result
looked close and passed size, aspect, grounding, contact, and every detector
control, yet exact review found that the footprint and outer contours had
moved. Prompt language and aggregate geometry cannot prove topology identity.

Rejecting every near-match is safe but leaves the generator responsible for a
pixel-exact operation it cannot reliably perform. Blindly clipping the result
is also unsafe if missing reference regions become magenta holes or if the
transformation hides how much repair occurred.

## Decision

Keep detection and transformation separate and opt-in:

1. A pose trial may declare `topologyLock` with an exact prepared-reference
   file/hash, alpha threshold, and maximum changed-pixel count. The assessor
   compares unshifted keyed 256-cell masks, reports missing and extra pixels,
   emits `topology-diff.png`, and raises `topology-mask-drift`. A ±1-pixel
   alignment search is retained only to explain a failure; it never changes the
   verdict.
2. Fresh surface-only preparation may pass `--topology-mask`. Candidate and
   reviewed topology are normalized, keyed, and boundary-cleaned in the same
   1024-pixel space. Reference alpha is authoritative. Candidate pixels outside
   it are clipped; reference pixels missing candidate foreground receive the
   nearest candidate-foreground color under four-neighbor Manhattan distance,
   row-major source order, then left/right/up/down neighbor order.
3. The preparation report publishes candidate/reference visible counts,
   missing, extra, changed, antialias, coordinate-space, distance/tie rules, and
   exact post-enforcement status. A manifest records the topology mask's exact
   file and hash so reproduction invokes the same option twice and compares
   committed bytes.
4. Without either opt-in record, historical preparation and pose assessment
   remain byte- and verdict-compatible.

## Test the tester

`npm run art:topology:check` pins a historical legacy hash, builds enforced
output twice, proves the exact reference mask, verifies nearest-color hole fill
and clipping, and rejects blank or missing inputs without partial output. A
separate oracle fixture accepts an identical mask, rejects a one-pixel contour
mutation by the exact named code, rejects a translated mask even when diagnostic
alignment reaches zero difference, rejects stale hashes and wrong dimensions,
and reproduces its diff PNG byte-for-byte.

The real v8 trial now reports 969 exact alpha-24 differences—463 missing and
506 extra—while the best one-pixel diagnostic still leaves 253. Its recorded
mechanical failure and independent visual veto therefore agree.

## Consequence

Later surface repaints can inherit reviewed silhouette topology without asking
the image model for pixel identity. The cost is retaining the transformation
and its repair counts as provenance. Exact silhouette does not approve the
interior: material style, value grouping, limb ownership, anatomy, identity,
runtime readability, and temporal motion still require their normal mechanical
evidence and independent exact-hash visual review.
