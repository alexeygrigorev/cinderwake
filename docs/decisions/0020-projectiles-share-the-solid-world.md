# 0020 — Projectiles share the solid world

**Status:** accepted on 2026-08-24

## Problem

Players and monsters could no longer walk through walls, the forge, or solid
props, but projectiles still advanced directly to their next endpoint. A fast
shot could therefore cross an entire building or blocked tile in one tick and
hit an actor behind it. The screen depicted one collision model while combat
used another, and an endpoint-only test would miss tunneling.

## Decision

Every projectile performs a deterministic swept collision from its previous
position to its proposed next position. Blocked map tiles are expanded by the
projectile radius and solved as segment/box contacts. Solid scenery uses the
same authoritative map-derived ellipses as actor movement, expanded by the
projectile radius and solved for the first segment/ellipse contact. The lowest
contact fraction wins, with stable world ordering for ties.

A colliding projectile is consumed at that exact point and creates an
authoritative eight-tick impact effect using its existing color. This makes the
blocked shot observable in state, render manifests, browser pixels, and replay
bundles; it is not a renderer-only decoration.

## Testing consequence

Focused tests fire friendly and hostile projectiles fast enough to cross the
whole spawn forge in one tick, cross an interior wall tile, and place a player
behind the obstruction. Acceptance requires exact deterministic contact,
projectile removal, no damage through the obstruction, identical cloned-state
results, and a visible manifested impact. The deliberately high speed is the
negative control for the endpoint-only implementation that previously passed.
