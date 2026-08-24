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
presented spacing is a fixed per-actor fraction of the rendered atlas cell,
calibrated from the widest non-transparent attack frames (Ashfang 110/128;
Stonekin 111/128). A single fraction applies across every facing so an abrupt
cardinal change cannot change spacing while simulation coordinates are
stationary. The remaining overlap is deliberate close contact, not an air gap.

The offset applies consistently to every living close-contact clip, rather
than appearing only on an attack frame, so clip transitions cannot introduce a
pose snap. Ranged Hexers and defeated monsters are not displaced.

## Verification contract

The deterministic browser gate now reviews the exact ordered lifecycle
`idle:0 → attack:0 → attack:1 → attack:4 → idle:0` at ticks 0, 1, 8, 18,
and 27. All four Ashfang cardinals run the complete strip, an abrupt cardinal
change gates per-frame offset continuity, and Stonekin plus a phone portrait
profile cover shared behavior. It proves simulation positions and manifest
world anchors do not move, while presentation offsets remain bounded.

The general sequence oracle treats `worldAnchor` as interpolated simulation
state and `screenAnchor` as its camera projection plus the explicitly declared
`presentationOffset`. It reports the contract result for every captured frame;
missing and incorrect declarations are production-detector negative controls.

The oracle requires health UI for every visible monster. Contact frames also
declare the effect owner they require. Negative controls remove health, remove
or detach the effect, paint it in front, stack bodies, enlarge health UI, and
inject a one-tick presentation jump. Missing evidence cannot pass by producing
an empty measurement set.

The current manifest can gate actor-vs-actor depth, including duplicate actors
and rear actors painted over front actors. Actor-vs-prop ordering and health UI
paint depth are not independently represented in the manifest: scenery and
world UI use separate render queues, with health painted as part of its owner.
Those two PRES-DEPTH mutations remain explicit scope gaps rather than claimed
coverage.

This geometry contract does not approve Ashfang anatomy or animation quality.
The current Ashfang atlas still reads too prone and remains a separate visual
promotion blocker.
