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
