# Cinderwake sprite style bible

Every asset prompt and review uses the same visual contract. “Dark fantasy” by itself is not a style specification.

- Original ember-gothic world: ruined charcoal masonry, soot-brown timber, oxidized bronze, ember-orange practical light, and sparse ghost-cyan rift energy. Do not use third-party game art, screenshots, names, logos, characters, or level layouts as inputs.
- Painterly, high-detail, pre-rendered 2D sprites with realistic anatomy and materials. Silhouettes stay crisp and readable at the 960 × 540 logical gameplay resolution.
- World sprites share an elevated three-quarter camera of approximately 55 degrees. UI sprites are straight-on. Light always arrives from the upper left, with a warm rim and restrained cool bounce.
- Actors use realistic proportions, a bottom-center ground anchor, and one stable world scale. Clothing, weapons, limbs, effects, and shadows must fit inside their cell.
- Background values are quieter than actors. Ember-orange and cyan are gameplay signals, not decoration spread evenly across the scene.
- Pure `#ff00ff` is a source-only chroma key. It cannot appear in approved production atlases.
- Generated candidates remain source material. The deterministic build normalizes, keys, anchors, packs, hashes, and validates the committed runtime atlas.
- Character-selection scenes use the same identity, material, and palette contract but may use a straight-on cinematic camera. They require one dominant full-height hero, constructed architecture and props, a quiet title region, and a dark control region; they are never repurposed as animation frames.

## Actor source brief

Every actor supplies six square PNGs on the same strict semantic 4 × 4 grid. Image-generation tools may return a larger square raster (the legacy accepted sources and current trials are 1254 × 1254) even when asked for 1024 × 1024. A fresh raw output is preserved unchanged, linted, and never confused with an accepted source. `scripts/prepare-actor-source.mjs` then resizes it to the 1024 × 1024 contract grid, keys magenta shades, removes boundary-connected neighbor fragments, applies one shared scale across all sixteen cells, grounds every cell, and writes a literal-magenta prepared source. Raw candidates smaller than 1024 or non-square, prepared candidates that are not exactly 1024, and any candidate that fails semantic or visual review are rejected. Historical accepted sources predate this preparation record and remain covered by immutable hashes plus deterministic build evidence rather than retroactive claims. The primary sheet uses [actor-source-template.svg](actor-source-template.svg):

1. idle breathing poses;
2. locomotion loop key poses;
3. primary attack from anticipation through contact and recovery;
4. ability from anticipation through contact and recovery.

The `{actor}-directions-source.png` sheet contains north idle, north locomotion, south idle, and south locomotion rows. North must be an unmistakable authored rear view; south must be an authored front view. A horizontal flip is permitted only for west from the east bank.

The `{actor}-actions-source.png` sheet contains five runtime attack-motion frames in cells 0–4, one unused review/follow-through reserve in cell 5, two recovery reserves in cells 6–7, and eight distinct ability frames in cells 8–15. Runtime attack recovery uses the exact primary idle cell rather than trusting a generated near-idle reserve; runtime ability recovery does the same. These are authored raster poses: cross-dissolves, baked projectiles, translucent ghosts, and duplicate bodies are rejected.

The `{actor}-reactions-source.png` sheet contains four articulated hurt/recoil poses, eight anatomy-specific collapse poses across rows two and three, and grounded terminal reserves in row four. Equipment and anatomy remain attached throughout; projectiles and large detached effects belong to their own runtime sprites.

The `{actor}-direction-actions-source.png` sheet contains north attack, north ability, south attack, and south ability rows. The `{actor}-direction-reactions-source.png` sheet contains north hurt, north collapse, south hurt, and south collapse rows. These banks prevent a one-shot action from rotating a north/south-facing body to the east silhouette and back.

The identity, costume, equipment, camera, scale, lighting, and foot baseline must not change between cells or source families. Preparation can repair raster mechanics; it cannot manufacture a missing gait, correct an action’s phase order, remove a conceptually oversized effect, or resolve identity drift. The build reads `ActorAtlasV2` metadata, performs the declared square-to-1024 ingress normalization defensively, removes chroma and cross-cell fragments, normalizes all six sheets together, and downsamples them into fixed 128 × 128 runtime cells in a 1024 × 2560 atlas. This preserves the 256 × 256 contract grid while reducing decoded mobile memory. Two final rows remain reserved. Runtime animation needs only the semantic sprite ID, clip name, and facing bucket.

Separately generated poses use `CinderwakeIsolatedPoseAssemblyV1`. Their exact
phase prompts must share one byte-identical identity/camera/material/framing
prefix and one ordered reference set. All isolated cells are measured in the
same 1024-pixel coordinate space, receive one derived uniform scale, and use
the same bottom-center anchor; per-cell scale or transform exceptions are
forbidden. A source hash and mechanical pass cannot approve style, anatomy,
support ownership, weight transfer, or loop closure. Those remain six fixed
independent visual-review axes plus runtime temporal evidence.
