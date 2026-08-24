# Deterministic pose-layout guides

`quadruped-pose-layout.png` is an internal composition reference for generating
isolated quadruped poses. It is deliberately a diagrammatic bitmap, not game art
and not an asset that may be promoted into a production atlas.

The guide fixes the reusable constraints that a text prompt cannot express as
precisely: a compact east-facing silhouette under the project's elevated
three-quarter camera, four separately readable support corridors, broad
magenta negative-space channels between the legs, and near-side paw contacts at
the shared lower anchor. The different muted support colors make each limb's
ownership unambiguous without adding text, labels, grid lines, scenery, or a
second figure. The surrounding source background is literal `#ff00ff`.

Rebuild the bitmap with:

```sh
node scripts/build-pose-layout-guide.mjs
```

Verify reproducibility and the committed artifact with:

```sh
node scripts/build-pose-layout-guide.mjs --check
```

Check mode performs two clean Sharp renders and requires byte-identical hashes,
then compares that exact result with the committed PNG. It also decodes the
bitmap and rejects the guide if its 1024-pixel canvas, opaque chroma background,
60–64% occupied width, 58–63% occupied height, 77–79% lowest-contact position,
four paw regions, or negative-space corridors drift.

[`quadruped-pose-layout.v1.json`](quadruped-pose-layout.v1.json) binds the exact
PNG hash to an independent visual acceptance and its limitations. The guide's
limb colors encode depth/ownership only; its long corridors are not anatomy;
and it must not supply character proportions, material, palette, or production
pixels. Check mode requires this exact review record in addition to mechanical
geometry because pixel ratios cannot prove the intended camera semantics.

Those mechanical checks cannot prove that the elevated camera reads correctly;
every regenerated guide still requires exact-hash visual review before use.

## Sparse balanced guide v2

`quadruped-pose-layout-v2.png` removes every filled creature shape. It contains
only four root→joint→paw centerlines, terminal markers, one open elevated body
axis with orientation ticks, and separate head/tail direction arrows. The near
paws share Y 790 at X 400 and 640, placing their midpoint at X 520 so a
generator is not conditioned toward v14's right-biased support.

The first v2 hash was mechanically green but visually rejected because the
near-hind joint marker did not lie on its route and two dotted arcs enclosed an
accidental oval torso. The corrected builder uses two explicit quadratic
segments per route, samples both segments, requires route ink at every declared
root/joint/paw, and uses one non-enclosing center axis. Exact hash
`ad58dca2bc784c6e59884703f4e9f430874ba4da8d477e5d31359bd3ec741478`
is independently accepted for one V15 conditioning attempt with Stonekin only.

It is not a silhouette, width, anatomy, material, lighting, or production-art
reference, and it cannot approve generated pixels. Rebuild or verify it with:

```sh
node scripts/build-pose-layout-guide-v2.mjs
node scripts/build-pose-layout-guide-v2.mjs --check
```

## Ashfang sparse idle guide v3

`ashfang-idle-sparse-layout-v3.png` is a new, immutable spatial-only contract
for the v16 fresh Ashfang idle generation. It intentionally does not reuse the
v2 geometry: it has four open three-point chains, one open axis, and open tail
and head directions on a literal `#ff00ff` field. It contains no torso contour,
width cue, ring, oval, surface mark, or any other closed shape.

The two near paws end at `(405,765)` and `(635,765)`, so their support midpoint
is exactly `x=520`; the far fore and near fore remain separated by at least 55
pixels below their elbows. It is paired only with the Stonekin style reference.
The v15 candidate pixels and seed are expressly forbidden.

```sh
node scripts/build-ashfang-idle-guide-v3.mjs
node scripts/build-ashfang-idle-guide-v3.mjs --check
node scripts/test-ashfang-idle-guide-v3.mjs
```

The focused test runs deterministic rebuild checks and negative controls for a
changed coordinate, malformed chain/closed-shape substitute, insufficient
foreleg gap, wrong baseline or midpoint, and excessive image occupancy.
