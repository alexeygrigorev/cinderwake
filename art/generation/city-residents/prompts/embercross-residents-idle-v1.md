# Embercross residents idle sheet V1

Status: frozen before generation on 2026-08-24. A generated result is a
candidate, never production art, until deterministic cell, alpha, identity,
anchor, motion, scale, and visual-style checks accept it.

## Reference inputs

1. `art/generation/city-kit/prepared/embercross-city-kit-v3.png` — production
   city palette, material rendering, elevated camera, edge treatment, and warm
   light reference. SHA-256
   `1f6b2fe52169c4e99dd101510e11674e4e3008f859be518ded33a0f773c61f85`.
2. `public/assets/sprites/actor-vanguard.png` — production actor body scale,
   south-facing camera, frame separation, and planted-foot reference. SHA-256
   `5004facbf1b0400554b30c80fe1f83dd097786c7c61f8b235734c551f8d620a4`.
3. `public/assets/sprites/actor-ranger.png` — production actor silhouette,
   material, and non-armored body-scale reference. SHA-256
   `d3def1e24d76dbba54db92b2d8bbde332eda542e1af3c08d744ec65566676862`.

## Exact generation prompt

```text
Use case: stylized-concept
Asset type: 4-by-4 game NPC idle-animation source sprite sheet
Input images: Image 1 is the production city style/palette/camera reference; Image 2 is the production armored actor scale, foot-anchor, and south-facing camera reference; Image 3 is the production unarmored actor scale and silhouette reference.
Primary request: Create one original sheet containing exactly four distinct Embercross town residents, with exactly four subtle looping idle poses for each resident. Arrange an exact 4-column by 4-row grid. Each row is one persistent character identity; each column is the next idle frame.
Row 1 subject: Mara Vale, adult female merchant, practical dark leather and muted burgundy wool, coin sash, small ledger at belt, alert and capable, no weapon.
Row 2 subject: Oren, broad adult male tavern keeper, rolled sleeves, dark brown leather apron, small wooden mug held low, welcoming but weathered, no weapon.
Row 3 subject: Tess, adult female innkeeper, layered charcoal and muted forest-green wool, visible key ring at belt, composed posture, no weapon.
Row 4 subject: Sister Ileya, adult female healer, worn ivory and deep red hooded robes, herb satchel and bandage roll, calm posture, no weapon.
Animation columns: column 1 neutral planted pose; column 2 subtle inhale with shoulders rising; column 3 small natural weight shift without a step; column 4 return toward neutral. Feet remain planted in every frame.
Scene/backdrop: genuinely transparent background; no floor plane, shadow tile, scenery, labels, borders, grid lines, or cell numbers.
Style/medium: original high-detail hand-painted pre-rendered 2D dark gothic action-RPG sprites, coherent with the supplied city buildings and current actors; restrained warm highlights, weathered natural materials, crisp readable silhouettes at 96 to 112 logical pixels.
Composition/framing: elevated three-quarter south-facing game camera for every figure; exactly sixteen complete full-body figures; one centered figure per equal cell; identical apparent body scale within each row; generous transparent separation; every foot contact centered at the same 90 percent cell-height baseline.
Lighting/mood: one consistent warm upper-left key light and cool dark ambient fill, matching Embercross; grounded, lived-in, serious, not heroic portrait posing.
Color palette: charcoal, soot brown, muted burgundy, dark forest green, worn ivory, restrained ember orange; preserve clear role-specific color separation.
Materials/textures: worn wool, scuffed leather, aged wood, dull metal hardware; crisp edges without photographic blur.
Constraints: exact 4-by-4 grid; exactly sixteen figures and no extras; same identity, face, clothing, equipment, proportions, camera, and scale across each row; full head, hands, clothing hem, and feet visible; no clipping at image or cell boundaries; pose centroid may shift by at most four percent of a cell; feet may shift by at most two percent of a cell; transparent gutters remain empty; no text, logo, watermark, UI, buildings, ground, attacks, weapons, spell effects, or dramatic gestures.
Avoid: duplicated hero classes; armor on town residents; side-view or front-view camera changes; walking or lifted feet; limb fusion; extra arms or legs; blurry or pixelated rendering; stretched bodies; inconsistent light; matte boxes; halos; neighboring-cell leakage.
```

## Intended deterministic acceptance

- The raw sheet must expose sixteen non-empty, separated cell components in a
  canonical 4×4 grid; no component may touch a cell or image boundary.
- Each row must keep stable alpha height, width, centroid, bottom support, and
  foot-contact columns across its four frames.
- Each row must contain more than one distinct raster pose without a frame
  order jump; its final frame must reconnect to the first.
- Prepared runtime cells must remain aspect-preserving and render at the same
  96–112 logical-pixel envelope as existing residents.
- Independent runtime-scale review must accept identity consistency, natural
  idle motion, role readability, city-style coherence, anatomy, and grounding.
