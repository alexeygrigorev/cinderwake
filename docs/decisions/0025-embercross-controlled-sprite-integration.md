# 0025 — Integrate Embercross through exact sprite and collision contracts

**Status:** accepted on 2026-08-24

## Problem

The city domain could be restored and transacted deterministically, but its
runtime initially reused generic scenery. That made the city functional without
making it legible, stylistically coherent, or safe to traverse. A single broad
gate collider would also contradict the visibly open doorway, while service
ranges shorter than actor silhouettes forced the player and resident sprites to
overlap whenever an action became available.

## Decision

Promote only prepared city-kit V3, hash
`1f6b2fe52169c4e99dd101510e11674e4e3008f859be518ded33a0f773c61f85`.
Its six declared tight crops use uniform aspect-preserving logical sizes. Raw
V1/V2 failures and V3 provenance remain public; raw near-magenta pixels are not
production assets.

Compose Embercross from those market, tavern, infirmary, gate, road-sign, and
bed/service sprites plus already reviewed compatible props. Each raised object
owns a semantic ID and one or more collision ellipses. Every ellipse's projected
bounding box must remain inside the tight visible sprite rectangle. The gate
owns a left pier and right pier footprint, and no center footprint. The generic
rift exit sprite is forbidden on the city map.

Use a 2-tile (`2048` world-unit) resident interaction radius and a 1.5-tile
approach distance. That keeps 100-pixel actor sprites visually separate while
retaining immediate mobile access. Portrait uses a bottom sheet; short landscape
uses a compact side sheet so the service UI does not blanket the playfield.

## Test the tester

Unit tests bind every service building to its exact semantic sprite, require the
gate center to remain walkable while both piers collide, compare additional
collision parts through the public manifest, and reject any city footprint that
projects outside visible sprite ink. The strict arbitrary-state loader rejected
two attempted screenshot fixtures that landed inside visible lantern bases.

Browser tests restore each provider state, tap all five real 48-pixel controls,
and require matching receipts plus synchronized player/city fields. Three idle
samples require four stable resident anchors and changing frame identities.
Portrait and landscape screenshots are accepted only after direct pixel review.

## Consequence

The city now reads as an authored location rather than a generic arena and its
visible mass explains movement constraints. The remaining quality gap is
explicit: distinct resident art, NPC-tap approach, a complete production route,
and broader temporal review still need their own evidence before a 10/10 claim.
