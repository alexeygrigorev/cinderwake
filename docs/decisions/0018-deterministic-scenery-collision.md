# 0018 — Derive solid scenery collision from the visible layout

**Status:** accepted on 2026-08-24

## Problem

Buildings and props were visually solid but existed only in the render
manifest. The tile collision prevented actors from crossing walls, yet players
and monsters could walk through a forge, sarcophagus, wagon, or barricade.
That broke both interaction credibility and the promise that a captured state
fully explains what can happen next.

## Decision

Scenery placement is a pure game-layer derivation from the authoritative
`DungeonMap`. `buildSceneryLayout(map)` returns stable semantic object IDs,
names, tiles, world anchors, an explicit `solid`/`passable` tag, and optional
world collision footprints. It consumes no
mutable random stream, so identical generated maps and restored arbitrary
states always produce identical scenery.

Each solid object has an elliptical footprint around its painted contact base.
The footprint intentionally does not cover a tall roof, branch, or lantern: an
actor may render behind that silhouette, but cannot cross the base touching the
ground. The shared movement solver tests these footprints for both the player
and monsters and retains axis-by-axis movement, allowing natural sliding along
an obstacle instead of stopping all motion.

Low rubble is explicitly classified as passable ground clutter. Every other
currently placed prop is solid. Adding a scenery name therefore requires an
explicit collision profile or an explicit `null` pass-through decision.

## Testing consequence

Unit and browser tests verify six contracts:

1. snapshot restoration derives byte-equivalent semantic placement;
2. visible scene object IDs, tiles, anchors, solid/passable tags, and ellipse
   measurements match collision placement;
3. generated spawn and exit centers remain clear across varied seeds;
4. a player cannot enter a building base but can move tangentially beside it;
5. monster movement cannot enter a solid prop, while rubble remains explicitly
   passable.
6. a real keyboard-driven browser run starts from an injected state beside the
   manifested forge footprint, samples every approach tick, proves no overlap,
   and then proves tangential sliding still works.

This makes visual/collision drift and accidentally passable solid art machine
detectable rather than dependent on manual play-throughs.
