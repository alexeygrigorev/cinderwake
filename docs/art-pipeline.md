# Sprite art pipeline

Cinderwake’s presentation is original dark fantasy: charcoal stone and teal astral ruin, ember-gold heroes and exits, magenta/crimson hostile energy, and pale-cyan loot. It is a **fully sprite-driven** game surface. Canvas, HTML, and CSS may position, crop, tint, layer, and animate raster assets, but may not draw gameplay/UI decoration procedurally. The sole text exception is titles (for example, the game title or an outcome title); labels, buttons, counters, frames, icons, panels, effects, terrain, characters, and props are sprites. This keeps every visible non-title mark attributable to an inspectable asset and frame.

## Asset provenance

All checked-in assets must be original and local. A generated or assisted asset is accompanied by a small provenance record in the asset manifest: source file/hash, generator/tool and version, prompt or art brief, seed/settings when available, creation date, human edits, and confirmation that no third-party game art, logos, or copyrighted references were used as image inputs. The record describes origin; it is not runtime data.

Generation is an input to art direction, never a live rendering dependency. The build and test suite load only committed PNG/WebP assets and committed manifest data. A reviewer can therefore inspect exactly what was captured in CI, and regenerated candidates cannot silently change a baseline.

## Atlas conventions

Use power-of-two PNG atlases with transparent backgrounds, nearest-neighbour sampling, no runtime trimming, and integer source/destination coordinates. Each atlas has a versioned JSON manifest with:

- atlas file name and content hash;
- sprite key, category, source rectangle, native size, and trim/padding policy;
- bottom-centre foot/pivot anchor in native pixels;
- animation clips in explicit frame order and tick duration;
- palette/tint policy, facing/flip policy, and intended render layer.

Frames in a clip share a declared canvas and anchor. Deliberate overhangs (weapon, cloak, projectile trail) are padded into the frame rather than cropped. At runtime the render manifest carries the atlas key, source rectangle, chosen frame, destination bounds, anchor, layer, and stable Z-order. That is the bridge from a bad pixel to the exact asset metadata responsible for it.

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

This workflow advances the testing goal directly: a temporal defect can be reduced to a state, command tape, atlas frame sequence, anchor, and PNG evidence. It makes clipping, pose pops, swapped frames, proportion drift, late decode/fallbacks, and mobile-only scaling regressions reproducible instead of merely visible.
