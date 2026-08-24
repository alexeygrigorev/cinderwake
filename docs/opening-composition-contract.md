# Opening composition contract

This contract turns “the first screen looks intentional” into reusable evidence
without pretending that geometry can judge art direction. Each game supplies a
small adapter describing its focal actors, structural landmarks, entrance and
objective, routes, scenery classes, crop policy, and responsive profiles. The
runner joins that data to the game's render manifest, navigation model, real
device-space canvas transform, and captured pixels.

The contract is game-neutral. Cinderwake may call a structure a forge and an
enemy an Ashfang; another game can use a hangar and a drone. Stable semantic
roles—not selectors, class names, or a fixed 60 Hz clock—are the reusable
boundary.

## Adapter shape

An adapter declares:

- viewport and input profiles, including safe areas and control occlusion;
- focal actors and their required visible fractions, scale envelopes, and
  overlap limits;
- structures, boundaries, entrances, objectives, prop clusters, and ground
  details by semantic role;
- which sprites may continue beyond a viewport edge and which must remain
  whole;
- the navigable route from entrance through the first decision to its
  objective, including minimum actor clearance;
- target coverage, empty-region, focal-occupancy, and mobile-readability bands;
  and
- the allowlist of sprite/atlas sources plus the narrow title-text exception.

Thresholds live in the adapter. A runner may calculate the same signal for two
games, but it may not silently impose Cinderwake's actor sizes, viewport crop,
or room proportions on both.

## Risk detectors and paired controls

| Signal                   | Automated risk detector                                                                                           | Required negative control                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Scene topology           | Required boundaries or outdoor-arena landmarks are visible and provide declared structural coverage.              | Move every boundary/landmark outside the opening camera.                |
| Entrance and route       | A minimum-width authoritative route connects the visible entrance, first decision, and objective.                 | Block the route or move its entrance marker off-screen.                 |
| Scenery composition      | Required semantic classes and prop clusters are present without excessive empty area or uniformly random scatter. | Remove the structure and clusters while leaving only floor decals.      |
| Edge-crop policy         | Only `edgeContinuation` art crosses a safe edge; focal actors, buildings, and interactables retain their minimum. | Shift one critical structure beyond its permitted visible fraction.     |
| Focal hierarchy          | The focal subject has the declared occupancy, remains unobstructed, clears HUD, and outranks incidental saliency. | Hide it beneath HUD or make a minor prop dominate the saliency map.     |
| Actor/scenery separation | Actors clear solid footprints, deep stacking, flattening, detached health markers, and invalid scale ratios.      | Co-locate actors, place one inside a solid, and flatten one silhouette. |
| Mobile-safe composition  | Critical actors and landmarks survive the real portrait/landscape crop above controls at readable size.           | Reuse the desktop crop or move the focal cluster underneath controls.   |
| Sprite-only provenance   | Every visible non-title draw resolves to an approved raster source.                                               | Replace one HUD sprite with CSS geometry and inject non-title DOM text. |

A signal earns authority only after its normal fixture passes and its paired
mutation fails for the intended reason. The evidence overlay must show the
route, crop, overlap, coverage, or saliency region behind the verdict so a
reviewer can diagnose it without reading game code.

## Evidence bundle

Retain the exact contract and adapter hashes, source commit and dirty status,
viewport/DPR/input profile, initial state, device-space canvas rectangle,
semantic render manifest, route result, assessor measurements, mutation IDs,
full screenshot, annotated failure overlay, and reproduction command. Bind the
independent verdict to the ordered screenshot-set hash. A matching rejection
is a published result; changing one pixel invalidates it and returns the next
set to candidate.

## Visual-review veto

Automation flags risk but cannot approve:

- coherent perspective, material, outline, palette, and lighting;
- a creature reading as alive, moving, and threatening rather than as scenery;
- environmental storytelling instead of an inventory of scattered props;
- dramatic hierarchy, atmosphere, and a memorable opening beat; or
- natural proportions and glance readability on a physical phone.

Promotion requires all normal fixtures, every paired mutation, and a fresh
explicit review of those judgments. A numeric metric never overrides a visual
rejection.

## Reuse path

Finish the Cinderwake adapter end to end, then implement this same evidence
shape in a second small game. Only the contracts and runners that survive both
implementations should become a shared package. This prevents Cinderwake's
selectors, clip names, frame cadence, or room vocabulary from masquerading as
a generic framework.
