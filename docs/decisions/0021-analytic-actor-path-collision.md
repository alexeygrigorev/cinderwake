# 0021 — Prove the complete actor path against solid scenery

## Context

Actor movement and touch navigation originally checked discrete positions. That
was sufficient at ordinary content speeds, but arbitrary restored scenarios can
declare larger speeds. An actor could then start and end outside a building yet
cross its solid footprint between those endpoints.

A 128-world-unit sampling interval fixed the full-building reproduction but was
still not a proof. The audit found a 128-unit horizontal path whose endpoints
were outside a small lantern's actor-expanded ellipse while the short chord
between them passed through it. Increasing sample density would only move the
false-green boundary and could make one simulation tick unbounded for extreme
but schema-valid speed values.

## Decision

`navigationSegmentWalkable` is the shared continuous collision predicate for
actor travel. It:

- requires both endpoints to satisfy the authoritative tile and scenery point
  contract;
- intersects the complete segment with open, actor-radius-expanded boxes for
  blocked map tiles;
- analytically minimizes distance along the segment to every
  actor-radius-expanded scenery ellipse;
- limits the tile broadphase to the finite map instead of iterating once per
  distance sample.

Axis-separated player and monster movement uses this predicate for each axis,
preserving wall sliding. The final previous-to-current tick chord is checked as
well because rendering interpolates it directly; when two safe axis legs would
form an unsafe visible diagonal, the tick accepts only one deterministic safe
axis. Monster crowd-separation corrections validate both their correction leg
and the complete previous-to-final render chord, so a large or multi-pass
correction cannot push or visually interpolate a creature through scenery.
Touch routes and AI routes use the same predicate before emitting waypoints.
Scenario and exact-snapshot loaders apply it to every actor's declared
`previousPosition→position` path, rejecting invalid arbitrary-state captures at
ingress rather than preserving an impossible interpolated frame. Snapshot room
records must also contain positive, finite, in-map integer geometry before they
can derive scenery, and the scenery authoring contract rejects non-finite or
zero-sized solid footprints.

## Evidence

The regression suite includes four failures that endpoint checks cannot catch:

1. a restored player tries to cross an entire solid building in one tick;
2. a normal-radius player moves 128 units across a near-tangent chord of a
   manifested lantern, with both endpoints independently proven clear;
3. a large diagonal input has two safe axis legs but a solid-crossing visible
   previous-to-current chord;
4. scenario and snapshot fixtures place an actor inside a solid or declare an
   interpolation path through one;
5. solid-object metadata is mutated to a zero/non-finite footprint or an
   arbitrary snapshot supplies invalid room geometry.

The second case also runs through the real mobile canvas adapter. The tap may
not command movement through the lantern; ordinary longer mobile routes still
prove that the player navigates around workshop objects, reaches the target,
and returns to idle without walking in place.

## Consequences

Solid visual objects now block the complete continuous actor path for keyboard,
joystick, tap navigation, AI pursuit, and separation. The calculation is
deterministic and its work is bounded by map size and manifested scenery count.
Flat ground decals remain explicitly passable.
