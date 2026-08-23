# Sprite art pipeline

Cinderwake’s presentation is original dark fantasy: charcoal stone and teal astral ruin, ember-gold heroes and exits, magenta/crimson hostile energy, and pale-cyan loot. It is a **fully sprite-driven** game surface. Canvas, HTML, and CSS may position, crop, tint, layer, and animate raster assets, but may not draw gameplay/UI decoration procedurally. The sole text exception is titles (for example, the game title or an outcome title); labels, buttons, counters, frames, icons, panels, effects, terrain, characters, and props are sprites. This keeps every visible non-title mark attributable to an inspectable asset and frame.

## Asset provenance

All checked-in assets must be original and local. A generated or assisted asset is accompanied by a small provenance record in the asset manifest: source file/hash, generator/tool and version, generated artifact ID, exact prompt when it was retained before generation or an explicitly labeled reconstructed brief when it was not, reference file/hash, seed/settings when available, creation date, human edits, and confirmation that no third-party game art, logos, or copyrighted references were used as image inputs. A reconstructed brief must never be presented as the verbatim historical prompt. The record describes origin; it is not runtime data.

Generation is an input to art direction, never a live rendering dependency. The build and test suite load only committed PNG/WebP assets and committed manifest data. A reviewer can therefore inspect exactly what was captured in CI, and regenerated candidates cannot silently change a baseline. Prompt reproducibility means the input decision is auditable; it does not imply that a nondeterministic model will emit the same pixels. Reproducible production begins at the immutable accepted source hash and deterministic packer.

## Atlas conventions

Use fixed-grid PNG atlases with transparent backgrounds, power-of-two cells, pinned canvas smoothing, no runtime trimming, and integer source/destination coordinates. An atlas may use a non-power-of-two height when that avoids decoding unused transparent rows on memory-constrained mobile browsers. Each atlas has a versioned JSON manifest with:

- atlas file name and content hash;
- sprite key, category, source rectangle, native size, and trim/padding policy;
- bottom-centre foot/pivot anchor in native pixels;
- animation clips in explicit frame order and tick duration;
- palette/tint policy, facing/flip policy, and intended render layer.

Frames in a clip share a declared canvas and anchor. Deliberate overhangs (weapon, cloak, projectile trail) are padded into the frame rather than cropped. At runtime the render manifest carries the atlas key, source rectangle, chosen frame, destination bounds, anchor, layer, and stable Z-order. That is the bridge from a bad pixel to the exact asset metadata responsible for it.

### Actor source contract

Every character is one actor ID with six square, 4 × 4 source sheets. The generated raster may be larger than the 1024 × 1024 contract canvas; the current generator returns 1254 × 1254 despite a 1024 × 1024 request. Ingress accepts only square images at least 1024 pixels wide, then deterministically resizes to 1024 × 1024 before treating each authoring cell as exactly 256 × 256 pixels. Each cell uses the bottom-center foot anchor and keeps the same identity, equipment, camera, lighting, proportions, and scale. This six-sheet template is the character-generation brief: a candidate that changes costume, viewpoint, light direction, body proportions, or cell placement is rejected before packing.

| Source file                              | Cell contract                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `{actor}-source.png`                     | Rows: east idle, east walk, legacy attack poses, legacy ability poses                   |
| `{actor}-directions-source.png`          | Rows: north idle, north walk, south idle, south walk                                    |
| `{actor}-actions-source.png`             | Cells 0–4 east attack motion, 5 review reserve, 6–7 recovery reserve, 8–15 east ability |
| `{actor}-reactions-source.png`           | Row 0 east hurt, cells 4–11 east death, row 3 grounded reserve                          |
| `{actor}-direction-actions-source.png`   | Rows: north attack, north ability, south attack, south ability                          |
| `{actor}-direction-reactions-source.png` | Rows: north hurt/death, south hurt/death                                                |

West is the only reflected facing and is derived by horizontally flipping east at render time. North and south are authored views. Cross-dissolves and translucent duplicate bodies are not production frames: movement and combat must use discrete, articulated poses. Large detached projectiles remain separate entities, while small contact flashes may stay attached to an action frame.

`art/actor-atlas-v1.json` is the single machine-readable packing authority (its schema ID is `ActorAtlasV2`; the stable filename preserves existing tooling). `npm run art:build` chroma-keys the source, removes boundary-connected cross-cell fragments, computes one safe normalization envelope across all six sheets, reanchors every frame, downsamples authoring cells to 128 × 128 runtime cells, and emits a fixed 1024 × 2560 atlas. The 20 rows cover east, north, and south versions of every clip plus two reserves; west reflects east. This reduces decoded memory per actor from roughly 24 MiB to 10 MiB while retaining the 256-pixel originals for future repacking. `npm run art:check` verifies source presence, declared cadence, dimensions, non-empty cells, padding, anchors, and content hashes. Adding a character therefore means supplying the six sheets and one actor ID, not writing character-specific animation code.

Clip recipes may reuse an exact source cell for recovery, hold an authored pose for intentional timing, or declare a deterministic foot-anchored scale transform. These exceptions live under an actor ID in the same contract and are applied by the normal packer; they are never opaque edits to a built atlas. Current Ashfang metadata uses this mechanism to hold its charged side ability before impact and to normalize its unusually low side-run silhouette against the authored north/south scale. Hurt clips for every actor finish on the exact facing-specific idle source cell, so recovery equality survives all rebuilds.

Run `npm run art:animation:check` after packing. It audits all 144 runtime-facing clip banks, records 720 authored-facing comparisons, injects four known-bad negative controls, and writes inspectable strips, actor overviews, JSON, and HTML to `quality-results/actor-atlas-audit/`. This is stricter than the source/geometry validator and broader than the curated browser sequence matrix; all three gates remain necessary.

### Generation ingress proof

`art/generation/trials.json` preserves three fresh exact-prompt trials across an armored humanoid, a fine-limbed ranged humanoid, and a heavy non-human actor. `art/generation/accepted-production.json` separately proves immutable lineage for all six accepted source families of those same three actors. Keeping those records separate prevents a promising candidate from being confused with production art.

Run `npm run art:generation:check` to verify prompt/reference/candidate existence and hashes, normalize and inspect all sixteen candidate cells, pass each candidate through the real actor packer in a temporary complete source set, build the three accepted production actors twice, and compare both builds byte-for-byte with each other and the committed atlases. The command writes a readable report to `quality-results/generation-pipeline/`; it never overwrites production sources or atlases.

Mechanical acceptance is deliberately narrower than art approval. Hashes, square input, keyed background, nonblank cells, atlas geometry, anchors, safe bounds, and deterministic packing can be gated. Identity, pose semantics, coherent anatomy, natural weight, effect restraint, and same-style judgment still require visual review. A trial can therefore pass as pipeline evidence while remaining rejected as a production replacement.

### Environmental decal ingress

`art/source/environment/decals-source.png` is the immutable generated source for a 4 × 4 set of ground marks: scorch, blood, bones, ritual paint, chain, boards, rubble, roots, candles, bramble, armor, embers, cloth, statue fragments, tracks, and flowers. The exact pre-generation prompt and reference hashes live under `art/generation/`. The built-in image generator returned a light checker-like matte instead of transparency, so the accepted source is preserved honestly and the deterministic packer owns removal of that matte; the provenance record does not claim the raw image was transparent.

`npm run art:build` keys the light connected field, decontaminates pale fringe pixels, removes boundary fragments, recenters every object within a 220 × 208 safe envelope, and writes `public/assets/sprites/environment-decals.png`. `npm run art:check` requires sixteen nonblank cells, at least 35% transparency, at least 1,200 ink pixels per cell, and a six-pixel transparent border. Generated-map layout treats every decal as passable terrain-layer art and anchors the first scorch ring exactly under the spawn forge. Explicit temporal fixtures receive no generated decals, avoiding unrelated baseline churn.

## Deterministic integration

An asset loader resolves manifest entries in stable key order, validates rectangles against decoded atlas dimensions, waits for every required image to decode before declaring capture readiness, and never lets network timing choose a fallback frame. Missing, duplicate, invalid, or unloaded sprite keys fail loudly in test mode. Pixel ratio, canvas smoothing, color mode, viewport (960 × 540 logical pixels at DPR 1 for baselines), and browser version are pinned in capture metadata.

Sprite selection is a pure consequence of game state plus presentation interpolation. Animation uses simulation tick and declared clip timing, never wall-clock time; camera interpolation is reported in the manifest. This preserves a smooth live display without making frame N depend on when the browser happened to paint.

## Mobile and readable delivery

Mobile uses the same atlas pixels and semantic frames as desktop; it may change layout and integer scale, never substitute emoji, web fonts, CSS icons, or text labels for game/UI art. Touch targets remain at least 44 CSS pixels, do not cover essential action, and are assessed in portrait and landscape with DPR/viewport captured as evidence. Atlases are compact enough for an initial local decode; no gameplay-critical image is fetched after play begins.

Source manifests, generation briefs, integration code, and documentation stay formatted and readable. Production output remains unminified with source maps, so a public quality report can be connected back to the atlas entry and authored render path. Compression at transport time is acceptable; opaque runtime art generation and minified-only debugging are not.

## Regeneration and temporal QA workflow

1. Create candidates from the original art brief; record provenance before review.
2. Pack approved frames with deterministic ordering and emit the atlas manifest; validate hashes, rectangles, anchors, and transparent padding.
3. Integrate by sprite key, not ad-hoc image path or numeric rectangle; update the render-manifest contract if a new visible property is introduced.
4. Run exact-state captures for idle, directional locomotion, attacks, hit/death, effects, loot, camera movement, terminal overlays, and mobile layout.
5. Review contact sheets and transparent entity masks, then update only intentionally changed baselines with the regenerated asset/manifest hashes and reproduction bundle.

The reproducible command sequence is:

```sh
npm ci
npm run art:build
npm run art:check
npm run art:animation:check
npm run art:generation:check
npm test
npm run capture:matrix
```

This workflow advances the testing goal directly: a temporal defect can be reduced to a state, command tape, atlas frame sequence, anchor, and PNG evidence. It makes clipping, pose pops, swapped frames, proportion drift, late decode/fallbacks, and mobile-only scaling regressions reproducible instead of merely visible.
