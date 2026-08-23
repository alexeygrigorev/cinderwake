# Canonical actor-sheet prompt template

Copy this file to a new exact prompt record before generation. Replace every bracketed field and include exactly one family layout. Never add an identity feature that is absent from the reference; explicitly say that headgear, anatomy, weapons, costume pieces, and markings must neither be added nor removed.

## Shared prompt body

> Use the attached original Cinderwake `[actor name]` sheet only as the immutable identity and style reference. Create one new `[source family]` sprite sheet for that exact same actor. Preserve the same anatomy, face/head construction, headgear or lack of headgear, costume, equipment, material shapes, markings, palette, proportions, and stable world scale in every cell. Do not invent, remove, or substitute identity features.
>
> Produce one square raster arranged as a strict edge-to-edge 4 × 4 semantic grid. Target 1024 × 1024 with sixteen 256 × 256 cells; the pipeline will preserve and deterministically normalize a larger square returned by the tool. Do not draw grid lines, gutters, labels, captions, numbers, diagrams, UI, borders, or a title. Fill unused background in every cell with flat pure chroma-key magenta `#ff00ff`, without gradient, texture, scenery, horizon, floor plane, or vignette.
>
> Use the Cinderwake actor contract: painterly high-detail pre-rendered 2D ember-gothic game sprites, realistic or identity-specific anatomy, elevated three-quarter camera near 55 degrees, upper-left warm key light, restrained cool bounce, crisp silhouette at small gameplay scale, bottom-center ground anchor, and a consistent foot/support baseline. Keep the complete body, attached equipment, permitted compact effect, and contact shadow well inside every cell with empty margin. Never let ink touch or cross a cell boundary.
>
> Keep identity, head and torso mass, equipment dimensions, camera, scale, light direction, ground anchor, and contact shadow stable across all sixteen cells. Motion must come from articulated pose changes, not camera movement, cropping, morphing, or changing proportions. No translucent ghost bodies, motion-blur duplicates, cross-dissolves, detached equipment, extra limbs, baked traveling projectiles, typography, logos, scenery, or third-party game references.

## Choose one family layout

### `primary`

- Row 1: four subtle east-facing idle breathing key poses.
- Row 2: four east-facing locomotion poses with alternating planted feet and coherent weight transfer.
- Row 3: four legacy east-facing primary-action reference poses; runtime uses the detailed action sheet.
- Row 4: four legacy east-facing ability reference poses; runtime uses the detailed action sheet.

### `directions`

- Row 1: four north-facing idle poses, unmistakable authored rear view.
- Row 2: four north-facing locomotion poses with alternating planted feet.
- Row 3: four south-facing idle poses, unmistakable authored front view.
- Row 4: four south-facing locomotion poses with alternating planted feet.

### `actions`

- Cells 0–4: settled anticipation, preparation, wind-up/draw, contact/release, and controlled follow-through for the east-facing primary action.
- Cell 5: an additional review/follow-through reserve; it is not consumed by the current runtime clip.
- Cells 6–7: natural recovered-idle reserves.
- Cells 8–14: seven distinct east-facing ability phases from anticipation through contact and follow-through.
- Cell 15: a natural recovered-idle reserve. Runtime attack and ability clips terminate on the exact primary idle source to guarantee a zero-geometry recovery seam.

Attached effects must remain smaller than and visually subordinate to the actor or weapon. Traveling projectiles belong to separate runtime sprites.

### `reactions`

- Row 1: four distinct east-facing hurt/recoil poses, impact through regained balance.
- Rows 2–3: eight anatomy-specific collapse poses in continuous order.
- Row 4: four grounded terminal reserves with the same final silhouette and only subtle settling differences.

Major anatomy and equipment remain attached. Small crumble particles are permitted only when they remain inside the cell and do not obscure body continuity.

### `directionActions`

- Row 1: four north-facing primary-action phases.
- Row 2: four north-facing ability phases.
- Row 3: four south-facing primary-action phases.
- Row 4: four south-facing ability phases.

North remains a rear view and south remains a front view throughout every action.

### `directionReactions`

- Row 1: four north-facing hurt/recoil poses.
- Row 2: four north-facing collapse phases.
- Row 3: four south-facing hurt/recoil poses.
- Row 4: four south-facing collapse phases.

North remains a rear view and south remains a front view. Major anatomy and equipment stay attached.

## Pre-call checklist

- The exact actor reference is attached and its SHA-256 will be recorded.
- No prompt sentence contradicts visible identity details in that reference.
- The family layout matches `art/actor-atlas-v1.json`, including unused reserves and exact-primary-idle recovery.
- The prompt contains flat-chroma, cell-margin, stable-anchor, shared-camera, and no-detached-projectile constraints.
- The final prompt is saved before the image-generation call.
