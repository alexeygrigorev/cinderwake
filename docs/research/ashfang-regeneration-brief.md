# Ashfang regeneration brief

**Recorded:** 2026-08-24  
**Status:** implementation guidance; no candidate is production-approved

## Finding

The current Ashfang needs new source generation. Enlarging its runtime
destination from 118 × 86 to 128 × 108 was a useful negative experiment, but
the body still reads as an ember-streaked carcass or ground prop before its
health bar is noticed.

The cause is source composition rather than resolution. Current east-idle ink
is about 110 × 65 atlas pixels. The bank is a strict lateral profile with a long
body, little negative space under the torso, and few elevated-camera top planes.
Scaling it to the height of the other actors also makes it excessively wide;
vertical-only scaling distorts its anatomy. The existing walk-only 1.42 Y scale
cannot repair idle, attack, ability, hurt, death, or the camera change on a turn.
Broad orange fissures also merge with the new ember and blood ground art.

Stonekin is already readable; its crop is a staging concern. Hexer is
stylistically credible but can be occluded by the forge. Ashfang is therefore
the highest-impact actor-art replacement.

## Primary-family exact prompt addition

Append the following actor-specific text to the shared contract in
`art/generation/prompt-template.md`, then append only the primary-family layout:

> Use the attached original Cinderwake Ashfang sheet as the immutable identity
> reference. Preserve exactly one four-legged volcanic predator with the same
> long armored tail, wedge-shaped fanged head, four clawed limbs, layered
> charcoal-black back plates, sparse ember-orange fissures, pale eyes, realistic
> heavy anatomy, and no equipment. Do not turn it into a humanoid, dragon,
> insect, ordinary wolf, or a different creature.
>
> Recompose that identity for the Cinderwake world camera: elevated
> three-quarter view near 55 degrees, with visible top planes on the skull,
> shoulders, spine plates, and hips. East-facing poses must point and move east
> but must not be strict flat side profiles. Foreshorten the body length and
> keep the tail curved inward so the silhouette is taller and less horizontally
> dominant.
>
> The Ashfang remains a low stalking quadruped, but it is not prone. Keep the
> chest and shoulder ridge clearly above the ground, separate the head from the
> torso, show readable negative space between all four planted limbs, and keep
> the eyes, jaw, forefeet, and shoulder mass distinguishable at small gameplay
> size. Idle poses should project as a compact living predator rather than a
> corpse or scorch mark.
>
> Keep the complete creature and compact contact shadow inside each cell. No
> broad flame trails, ember rings, ground eruptions, detached sparks, smoke
> plumes, or traveling effects; those would shrink every frame under shared
> normalization and visually merge with terrain decals. A small attached ember
> contact is permitted only during action contact.
>
> Preserve upper-left warm light, restrained cool bounce, dark quiet body mass,
> and sparse orange fissures. Orange is an accent, not the dominant silhouette.
> Maintain identical head size, plate count and arrangement, tail construction,
> limb count, body mass, camera, light, and ground baseline in all sixteen
> cells.

The primary sheet has four east-idle poses in row one, four east locomotion
poses with alternating planted feet and visible weight transfer in row two,
four compact bite/claw references in row three, and four compact planted
shoulder/ember-ability references in row four.

## Original local references

Use only original Cinderwake assets:

- Ashfang identity: `art/source/actors/ashfang-source.png`, SHA-256
  `bfe2ec6c9e7cbfbad1ac24878ad646cf5b8e42e7a045ddb3ff87ed3f96772629`.
- Ashfang cardinal anatomy: `art/source/actors/ashfang-directions-source.png`,
  SHA-256
  `952b82482a28e01d2be2240af1023dfaa7cafac277805bf7ee041be269055d01`.
- Stonekin camera, scale, light, and material density only:
  `art/source/actors/stonekin-source.png`, SHA-256
  `3d68ad28f34c1ebae30cddcc8f2bf1429815044307506a58afc88883cb6fce6c`.

Stonekin is not an anatomy reference. Do not attach the gameplay screenshot or
runtime Ashfang atlas because they reinforce the rejected small lateral
composition.

## Staged six-family plan

Do not promote a partial replacement; the packer derives one shared
normalization scale across all 96 cells. Generation is staged only to avoid
spending on a failed camera/identity direction:

1. Generate `primary`; calibrate and accept or reject it.
2. Generate `directions`: north idle/walk and south idle/walk.
3. Generate `actions`: east attack cells 0–4, reserves 5–7, compact ability
   cells 8–14, recovered-idle reserve 15.
4. Generate `reactions`: east hurt 0–3, continuous collapse 4–11, grounded
   settling 12–15.
5. Generate `directionActions`: north attack/ability and south attack/ability.
6. Generate `directionReactions`: north hurt/death and south hurt/death.

Every later family uses an accepted new primary as the identity master. No
partial family replaces production.

## Expected failure modes

- old strict profile reproduced instead of elevated top planes;
- species drift, humanoid posture, altered plates/head/tail, or extra limbs;
- repeated locomotion cells without alternating support;
- east poses mislabeled as north/south;
- large fire trails or eruptions that shrink the body during normalization;
- nonliteral key background, floor plane, long shadow, dividers, or labels;
- detached limbs, merged paws, duplicate bodies, or morphing proportions;
- wrong action cell semantics, airborne recovery, or one oversized frame that
  determines the scale of every sheet.

## Acceptance before full-family generation

The raw trial must be square and at least 1,024 pixels; its deterministic
prepared form is exactly 1,024 × 1,024. Every cell is nonblank, keyed, grounded,
inside safe bounds, and free of scenery or detached traveling effects. In a
temporary built atlas:

- every east-idle frame is at least 72 pixels tall, with median height 76–86;
- east-idle ink aspect ratio is no more than 1.50;
- logical idle ink is roughly 68–82 pixels tall, 72–86% of Vanguard height,
  without changing collision radius;
- grayscale and alpha composites keep head, raised torso, four-limb stance,
  and tail distinct from the opening floor with health bars hidden; and
- fixed calibration scenes beside Vanguard, Hexer, Stonekin, and the forge pass
  desktop, narrow desktop, phone landscape, and phone portrait review.

If the primary fails, record the exact prompt, bytes, hashes, and rejection
reason, then iterate the primary only. If it passes, generate all remaining
families, remove the Ashfang walk-only scale override, and require the complete
actor/build/animation/browser review matrix before production promotion.
