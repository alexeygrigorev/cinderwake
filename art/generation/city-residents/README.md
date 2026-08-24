# Embercross resident atlas boundary

This directory keeps one generated 4 × 4 resident candidate behind a deterministic, reviewable preparation boundary. Nothing here is registered with the runtime. The raw PNG, frozen prompt, references, and generation metadata establish provenance; `prepare.mjs` is the only permitted path from those raw bytes to a mechanically reviewable atlas.

Rows have fixed semantics and are never inferred from the pixels:

1. Mara — merchant;
2. Oren — tavern keeper;
3. Tess — innkeeper;
4. Ileya — healer.

Columns are `neutral`, `inhale`, `weight-shift`, and `return`. The sequence is an idle loop, not a directional walk cycle.

## Reproduce the candidate and evidence

Run both commands from the repository root:

```bash
node art/generation/city-residents/prepare.mjs
node art/generation/city-residents/check.mjs
```

Expected result:

```text
embercross-residents-idle-v1 PASS; 16/16 nonblank; 4/4 rows pass; 5/5 mutations detected; prepared 0c5e7fc390603b5958a8b5389ded0da55cc67390e2ceea475aab764b4b620f80
```

The first command writes:

- `prepared/embercross-residents-idle-v1.png` — 1024 × 1024 RGBA atlas;
- `evidence/preparation-v1.json` — exact cuts, extraction counts, retained components, crops, transforms, and hashes.

The second writes:

- `evidence/audit-v1.json` — provenance, frame metrics, row metrics, verdict, and negative-mutation proof;
- `evidence/runtime-scale-contact-sheet-v1.png` — all 16 poses at a 128-pixel runtime review box on a dark checker.

The checker runs preparation twice in fresh temporary paths and requires both generated PNGs to be byte-identical to the committed prepared PNG. The raw generation itself is intentionally not called reproducible: its prompt and artifact identity are frozen, while only the deterministic transformation after the immutable raw SHA-256 is reproducible.

## Exact cutting and background extraction

The raw image is 1254 × 1254, which is not evenly divisible by four. Both axes therefore use `floor(i * 1254 / 4)` and the exact boundaries:

```text
0, 313, 627, 940, 1254
```

This produces alternating 313/314-pixel cells without dropping, duplicating, or shifting a source column. A naive `1254 / 4` rounded cut is prohibited because it changes the pose anchor from frame to frame.

Within each source cell the extractor:

1. starts only from that cell's border;
2. flood-fills four-connected pixels whose minimum RGB channel is at least 232 and whose channel spread is at most 10;
3. makes only those border-connected light-neutral pixels transparent;
4. finds the largest remaining eight-connected component as the resident;
5. retains components of at least four pixels within 12 pixels of the growing resident bounds, preserving nearby hair, keys, baskets, and antialiased fragments;
6. excludes all unrelated islands;
7. zeroes RGB whenever alpha is below the 24 audit threshold.

The border-connectivity condition matters: a white or light-neutral pixel isolated inside a resident is not treated as background merely because of its color. `preparation-v1.json` records `disconnectedLightNeutralPixels` and `retainedLightNeutralPixels` for every pose; every current pose preserves such pixels.

## Normalization contract

Each isolated pose is cropped and resized exactly once with one uniform scalar. It is never stretched independently by width and height. The normalized pose is horizontally centered in a 256 × 256 RGBA cell, has at least 24 pixels of safe inset on every side, and places its last visible contact pixel on local Y 227. All transparent RGB is zero.

The mechanical audit requires:

- exactly 1024 × 1024 RGBA and sixteen nonblank cells;
- no alpha on a cell boundary and at least 24 pixels of safe inset;
- no nonzero RGB under zero alpha and at least 35% transparent area per cell;
- every frame on the common Y 227 foot baseline;
- an aspect-scale delta no greater than 0.006;
- per resident: height spread at most 3%, width spread at most 8%, centroid spread at most 3 px horizontally and 4 px vertically;
- per resident: support centroid spread at most 4 px and support-width spread at most 20%;
- every frame pair differs in at least 5% of cell pixels and at least 1% of silhouette, preventing duplicated poses disguised by metadata;
- first/last silhouette IoU of at least 0.88 and no more than 0.05 below the weakest adjacent-pose IoU, preventing a visibly open loop.

These bounds are deliberately tied to this subtle four-pose idle contract. A directional walk, attack, or intentionally broad gesture needs a separate profile rather than weakening these thresholds.

## Mutation proof

`check.mjs` mutates the accepted RGBA bytes in memory and re-runs the same audit. A mutation counts as detected only if the full audit rejects it **and** its named checks fail:

| Mutation                                                  | Checks that must fail                     |
| --------------------------------------------------------- | ----------------------------------------- |
| blank pose                                                | `allNonblank`                             |
| pose shifted upward by 12 px                              | `commonBaseline`, `rowCentroidContinuity` |
| alpha leaked onto a cell edge                             | `noBoundaryInk`, `safeInsets`             |
| one pose copied byte-for-byte over another                | `frameDistinctness`                       |
| transparent area replaced by an opaque checker-like matte | `transparentBackground`, `noBoundaryInk`  |

The committed audit must say `5/5 mutations detected`. This makes the evidence executable: it proves the checks respond to the defects instead of merely documenting intended thresholds.

## Acceptance boundary

A `PASS` means the raw bytes can be deterministically cut and that the resulting idle rows meet the encoded mechanical continuity rules. It does not certify character identity, art direction, gameplay scale, interaction readability, or animation timing. Production use still requires a visual review of the runtime-scale contact sheet and an in-game temporal capture. Until a separate integration decision records that review and the exact prepared hash, this atlas remains quarantined.
