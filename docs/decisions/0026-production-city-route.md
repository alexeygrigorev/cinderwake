# 0026 — Prove city discovery and entry through physical mobile input

**Status:** accepted on 2026-08-24

## Problem

Unit tests could place the player at Embercross's sign or gate and prove each
state transition, while city browser tests could restore a player beside every
service provider. Neither boundary proved that a mobile player could actually
travel from the wilderness sign to the city through production controls.

The first physical attempt exposed a real dead end: pointer navigation stopped
at the nearest safe cardinal cell beside the sign, 1,026 world units from its
anchor, while discovery required 720 units. The route was complete, the solid
sign correctly prevented overlap, and nothing happened.

## Decision

Give `ScenarioV1.player` a validated `city-landmark-approach` placement for
generated maps. The deterministic loader derives a collision-aware route from
the seeded spawn and starts four safe route cells before the sign. This keeps
the real generated map, authored scenery, collision layout, and landmark while
making a focused production journey reproducible and bounded.

Set the sign discovery affordance to 1,152 world units: one adjacent tile plus
a small simulation-rounding margin. A regression places the actor at the exact
final waypoint returned by production navigation and requires discovery on the
next tick.

The browser journey runs without `?testMode=1`, requires the mutating test
bridge to be absent, and reads only the cloned observe-only boundary. At a DPR-3
mobile viewport it uses physical canvas taps for visible one-cell waypoints and
short joystick touch streams for off-crop waypoints. It retains ordered frames
before discovery, after discovery, and after entry, and requires the objective,
events, map digest, gate sprite/collision parts, and four resident draw calls to
agree with observer state. Sixteen physical waypoints bound either route even
when slower machines need more time to decode and capture the large raster
scene.

## Consequence

The focused production journey now proves the complete wilderness-sign-to-city
transition and catches inert controls, touch/strike confusion, unreachable
solid landmarks, missing objective changes, failed map swaps, and absent city
sprites. It deliberately removes combat from this fixture so a combat failure
cannot hide a presentation/input regression; the ordinary generated-run and
opening journeys retain combat coverage.
