# Decision 0034: keep melee readability in the presentation layer

## Context

The first combat-readability repair made the reviewed frame clearer by raising
Ashfang and Stonekin attack ranges, adding a large invisible player/monster
exclusion ring, and moving overlapping imported monsters during the first
simulation tick. That changed reach, collision, pursuit, input response, and
arbitrary-state replay. It also hid a 586-unit first-tick teleport behind zero
reported velocity. A presentation defect must not silently redefine combat.

## Decision

Restore the original attack ranges and simulation behavior exactly. Preserve
the independently useful smaller health treatment and the shared manifest /
canvas paint-order comparator.

When a living melee monster's painted body would fully merge with the player,
offset only its render-manifest anchor away from the player. Keep its
`worldAnchor` equal to the interpolated simulation position. The minimum
presented spacing is a fixed fraction of the rendered atlas cell, calibrated
from the widest non-transparent attack frames (Ashfang 110/128; Stonekin
111/128). Lateral and vertical banks have separate fractions because their
authored silhouettes occupy the cell differently. The remaining overlap is
deliberate close contact, not an air gap.

The offset applies consistently to every living close-contact clip, rather
than appearing only on an attack frame, so clip transitions cannot introduce a
pose snap. Ranged Hexers and defeated monsters are not displaced.

## Verification contract

The deterministic browser gate now reviews ordered windup, adjacent tick,
contact, and recovery manifests; all four Ashfang cardinals; Stonekin shared
behavior; and a phone portrait profile. It proves simulation positions and
manifest world anchors do not move, while presentation offsets remain bounded.

The oracle requires health UI for every visible monster. Contact frames also
declare the effect owner they require. Negative controls remove health, remove
or detach the effect, paint it in front, stack bodies, enlarge health UI, and
inject a one-tick presentation jump. Missing evidence cannot pass by producing
an empty measurement set.

This geometry contract does not approve Ashfang anatomy or animation quality.
The current Ashfang atlas still reads too prone and remains a separate visual
promotion blocker.
