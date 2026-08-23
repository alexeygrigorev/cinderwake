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

Supply one 1024 × 1024 source PNG using [actor-source-template.svg](actor-source-template.svg). It contains a strict 4 × 4 grid of 256 × 256 cells:

1. idle breathing poses;
2. locomotion loop key poses;
3. primary attack from anticipation through contact and recovery;
4. ability from anticipation through contact and recovery.

The identity, costume, equipment, camera, scale, lighting, and foot baseline must not change between cells. The build maps those key poses into the fixed 2048 × 2048 `ActorAtlasV1`, derives hurt and grounded-collapse rows, and leaves two rows reserved. Runtime animation needs only the semantic sprite ID and clip name.
