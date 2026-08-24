# 0023 — Assemble isolated actor poses with one shared scale

**Status:** accepted on 2026-08-24

## Problem

Full-sheet image generation repeatedly collapsed walk semantics: a candidate
could contain sixteen cleanly cut cells while the same paw remained planted
through every locomotion phase. Generating one pose at a time solves the grid
and phase-instruction problem, but the existing one-pose preparer independently
safe-fits each image. Four differently framed poses can therefore acquire four
different scales, share a foot anchor, and still pop visibly in motion.

Raster mechanics and art judgment also need separate states. A deterministic
assembler may prove hashes, placement, and scale without proving identity,
camera, anatomy, weight transfer, or style.

## Decision

Use `CinderwakeIsolatedPoseAssemblyV1` for any source sheet containing
separately generated poses:

1. Normalize every square raw pose into the ActorAtlasV2 1024-pixel source
   coordinate space before measuring it.
2. Key and clean every isolated pose without changing its silhouette
   independently.
3. Derive one uniform scale from the maximum isolated-pose width and height,
   cap it at the canonical 1024→256 canvas factor `0.25`, then apply that exact
   scale to every isolated cell. The assembler may shrink an oversized set but
   never magnify away the authored canvas framing.
4. After keying and compositing, align the final visible support rather than the
   rectangular placement box: ink bottom is source Y `231`, and the centroid
   of the lowest eight source pixels is alpha-weighted and within `0.5` pixels
   of anchor X `128`. If contact alignment would cross the `(10, 8, 236, 224)`
   safe region, shrink the one shared scale for every isolated cell and render
   them again; do not reject a fit that a smaller common scale can represent.
5. Reject every cell-local scale, resize, or transform field. Inherited cells
   come from an exact-hash base sheet and retain identical decoded pixels.
6. Bind each isolated cell to its raw image, phase prompt, generation artifact,
   byte-identical common prompt prefix, and identical ordered reference set.
7. Emit `UNREVIEWED` after successful mechanical assembly. `ACCEPT` requires a
   matching prepared-sheet hash and all six fixed visual axes to pass.

The assembler does not replace the full-sheet candidate gate. A partial row
must still pass idle/walk size continuity, grounding, persistent-support
contact, complete atlas audit, runtime start→walk→stop capture, mobile capture,
and independent temporal review. This second boundary catches a newly assembled
row whose common scale is still inconsistent with inherited rows.

## Test the tester

`npm run art:pose:assembly:check` constructs a temporary primary sheet from 12
inherited cells and four isolated 1024-pixel poses, builds it twice, proves byte
identity, one shared scale, visible-bottom grounding, alpha-weighted
bottom-contact centering, and common-scale shrink for an asymmetric support,
then compares inherited pixels to their base cells. Sixteen named
mutations cover missing and duplicate cells,
undersized raw input, stale actor/style/base/raw/prompt/prefix/reference hashes,
non-magenta base margins, forbidden per-cell scale and transform, reordered
references, stale prepared bytes, and stale visual review.

The first new identity master, Ashfang v2, is deliberately not assembled. Its
compact living posture is useful direction, but both exact mechanical and
independent visual reviews reject it before follow-up generation because it is
oversized and exposes only three readable paws.

Ashfang v3 proves the opposite disagreement is also safe: canonical framing,
grounding, contact, runtime dimensions, and all mechanical controls pass, but
an exact-hash independent review rejects the shallow viewpoint, mismatched
mass, missing fourth paw, and undefined diagonal support. A mechanically green
trial therefore requires a matching visual veto to verify its recorded
rejection; without that review, the audit exits nonzero.

Ashfang v4 adds another necessary distinction: four paws can be countable in
the raw image while one limb connection disappears after reduction. Review is
performed on raw, prepared, runtime evidence, and a same-scale cast comparison;
source-scale anatomy alone cannot authorize generation of motion phases.

## Consequence

A new character can use the same manifest and fixed rig without new runtime
animation code. Generation remains nondeterministic, while prompt decisions,
input bytes, assembly, tests, and promotion are reproducible. The extra cost is
retaining one manifest record per pose and refusing to generate downstream
families until an identity master and primary motion are genuinely accepted.
