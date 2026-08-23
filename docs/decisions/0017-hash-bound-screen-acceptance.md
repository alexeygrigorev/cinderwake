# 0017 — Bind screen acceptance to exact contract and image hashes

**Status:** accepted on 2026-08-23

## Problem

Screenshot tests can prove that pixels did not change, but a baseline may preserve a bad screen. Geometry checks can prove that a character landmark is on-screen while dark paint still makes it unreadable. Conversely, a one-time visual approval becomes stale as soon as either the acceptance rules or any screenshot changes. A public gallery that always says “passed” would blur machine consistency, subjective approval, and the exact candidate that was reviewed.

## Decision

Use a four-profile public screen contract and keep three outcomes separate:

1. Browser checks validate decode, liveness, viewport geometry, hit testing, subject landmarks, stage coverage, and real-canvas terrain samples.
2. Pinned PNGs identify the exact visual candidate, not its quality.
3. An independent reviewer inspects every candidate at original resolution and returns a vetoable verdict.
4. `quality/screen-review.v1.json` binds an `ACCEPT` verdict to the SHA-256 of both the contract and the ordered 16-image set.

The public report says `accepted` only when the committed review is `ACCEPT` and both hashes match. Any changed threshold, landmark, viewport, or pixel automatically makes the report a candidate again. CI never creates or rewrites an acceptance record.

## Test the tester

The selection assessor deliberately makes Begin undersized, offscreen, and center-blocked; switches character art to a cover crop without a blend; and expands the chooser across authored hero landmarks. Each mutation must produce its named failure.

The terrain assessor first reads real composed canvas pixels. It then rerenders the valid scene, paints equal-luminance patches at the actual sampled wall/floor points, re-extracts pixels, and requires `terrain:collision-boundary-imperceptible`. A second rerender paints black/white patches at the actual same-material joins and requires `terrain:scale-or-tile-seams-visible`. These controls exercise the complete manifest-to-sample-to-classifier path rather than passing fabricated arrays directly to the final threshold function.

## Quality contribution

This makes the baseline promotion process reproducible and public without claiming that metrics can judge art direction. A future game can replace selectors, landmarks, and appearance statements while preserving the device-profile, evidence, negative-control, review, and hash-binding schemas.

The first accepted Cinderwake set contains 16 images. Independent review found 10 unobstructed collision samples with median contrast 4.82 and 399 same-material joins with median contrast 4.92. The acceptance record and gallery retain these measurements, exact hashes, and scope.
