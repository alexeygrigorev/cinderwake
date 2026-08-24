# 0030 — Compose Embercross as connected service districts

**Status:** candidate on 2026-08-24; visual acceptance remains open

## Problem

Embercross had functional service buildings and many declared objects, but the
real mobile crops told a different story. Portrait showed the market and edge
fragments; landscape placed all three service buildings in one upper band and
left a broad central/lower ground field. Counting off-screen objects made the
manifest sound richer than the frame looked. A subtle solid bench also sat on
the south-gate spine, creating another avoidable obstruction near the route a
new player is expected to follow.

## Decision

Reuse already shipped raster art that shares Cinderwake's elevated
three-quarter camera, charcoal masonry/timber materials, warm local firelight,
and realistic painterly rendering. Add four distinct structures—a reviewed
environment-kit smithy plus the production chapel, watchtower, and ruined
rowhouse—and compose the smithy with one weapon rack, brazier, and aligned
scorch decal. Add semantic chapel details, replace mismatched tavern/infirmary
decals with broken boards and grave flowers, and move the raised bench east off
the open gate spine. No runtime shape, DOM scenery, nonuniform scaling, or
duplicated resident is introduced.

Every new solid uses a compact ellipse inside its projected visible sprite
mass. Exact placement/role/footprint tests bind the composition; the existing
visible-alpha containment oracle rejects footprints outside sprite ink. A
collision-aware route must reach all four residents, the east square, and the
gate in both directions with the real player radius.

Add an Embercross-only manifest assessor for objective prerequisites: required
roles, sprite diversity, rectangle-union occupancy, axis spread, empty bands,
duplicate concentration, player visibility, and actor overlap. Five mutations
must be rejected: secondary scenery removal, cloned clutter, overlapped actors,
a structure hiding the player, and a large empty field. Its result explicitly
cannot approve beauty, art style, saliency, or hierarchy; `PRES-STYLE-021` and
`PRES-DENSITY-022` retain mandatory independent review.

Record both open-service and closed-service DPR-3 portrait/landscape frames.
The closed views prevent a bottom/side sheet from hiding the very composition
being evaluated; the open views continue to prove the playable UI context.

## Consequence

The city now reads as multiple connected districts rather than three service
facades on an arena floor, while the open central routes remain reproducible.
The committed screenshots are regression candidates, not a 10/10 claim. Style
still needs a cross-role runtime sheet and foreign-style mutations; density
still needs transparent-ink calibration and original-resolution independent
review before either checklist row can be accepted.
