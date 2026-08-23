# Cinderwake sprite style bible

Every asset prompt and review uses the same visual contract. “Dark fantasy” by itself is not a style specification.

- Original ember-gothic world: ruined charcoal masonry, soot-brown timber, oxidized bronze, ember-orange practical light, and sparse ghost-cyan rift energy. Do not use third-party game art, screenshots, names, logos, characters, or level layouts as inputs.
- Painterly, high-detail, pre-rendered 2D sprites with realistic anatomy and materials. Silhouettes stay crisp and readable at the 960 × 540 logical gameplay resolution.
- World sprites share an elevated three-quarter camera of approximately 55 degrees. UI sprites are straight-on. Light always arrives from the upper left, with a warm rim and restrained cool bounce.
- Actors use realistic proportions, a bottom-center ground anchor, and one stable world scale. Clothing, weapons, limbs, effects, and shadows must fit inside their cell.
- Background values are quieter than actors. Ember-orange and cyan are gameplay signals, not decoration spread evenly across the scene.
- Pure `#ff00ff` is a source-only chroma key. It cannot appear in approved production atlases.
- Generated candidates remain source material. The deterministic build normalizes, keys, anchors, packs, hashes, and validates the committed runtime atlas.

## Actor source brief

Every actor supplies four 1024 × 1024 PNGs on the same strict 4 × 4 grid of 256 × 256 cells. The primary sheet uses [actor-source-template.svg](actor-source-template.svg):

1. idle breathing poses;
2. locomotion loop key poses;
3. primary attack from anticipation through contact and recovery;
4. ability from anticipation through contact and recovery.

The `{actor}-directions-source.png` sheet contains north idle, north locomotion, south idle, and south locomotion rows. North must be an unmistakable authored rear view; south must be an authored front view. A horizontal flip is permitted only for west from the east bank.

The `{actor}-actions-source.png` sheet contains six distinct attack frames in cells 0–5, two recovery reserves, and eight distinct ability frames in cells 8–15. The terminal attack and ability cells return to the natural idle silhouette. These are authored raster poses: cross-dissolves, baked projectiles, translucent ghosts, and duplicate bodies are rejected.

The `{actor}-reactions-source.png` sheet contains four articulated hurt/recoil poses, eight anatomy-specific collapse poses across rows two and three, and grounded terminal reserves in row four. Equipment and anatomy remain attached throughout; projectiles and large detached effects belong to their own runtime sprites.

The identity, costume, equipment, camera, scale, lighting, and foot baseline must not change between cells or source families. The build reads `ActorAtlasV2` metadata, removes chroma and cross-cell fragments, normalizes all four sheets together, and packs a fixed 2048 × 3072 atlas. Two final rows remain reserved. Runtime animation needs only the semantic sprite ID, clip name, and facing bucket.
