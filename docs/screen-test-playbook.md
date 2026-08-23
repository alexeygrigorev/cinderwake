# Screen test playbook

This playbook is the visual acceptance contract for Cinderwake and the template for future games. A screen is not accepted because it has a screenshot baseline. It is accepted only when its player route works, hard screen checks pass, a time sequence passes where motion is involved, and an independent reviewer approves the captured candidate at actual play scale.

The machine-readable companion is [`quality/screen-contract.v1.json`](../quality/screen-contract.v1.json). It separates reusable geometry thresholds from the appearance statements a reviewer must judge.

## Required device matrix

| Profile         | Viewport   | Input contract                     | Primary risk                                                       |
| --------------- | ---------- | ---------------------------------- | ------------------------------------------------------------------ |
| Phone portrait  | 390 × 749  | touch world, joystick, action orbs | browser chrome, safe area, excessive HUD height, tiny playfield    |
| Phone landscape | 844 × 390  | touch world, joystick, action orbs | cropped heads, controls covering combat, off-screen launch control |
| Narrow desktop  | 800 × 600  | mouse and keyboard                 | title crossing the hero, cramped chooser, weak canvas coverage     |
| Desktop         | 1440 × 900 | mouse and keyboard                 | small game island, black void, disconnected HUD                    |

Use CSS pixels and DPR 1 for deterministic baselines. A physical reference phone remains required before a release can claim real-device quality; its screenshot is compared to the same criteria, not promoted as a browser-independent pixel baseline.

## Acceptance sequence

1. Start from a clean build and run `npm run check`.
2. Run `npx playwright test tests/e2e/screen-contract.spec.ts tests/e2e/mobile.spec.ts`.
3. Run `npm run capture:matrix` for motion, camera, combat, and lifecycle evidence.
4. Open the screen screenshots at 100% and the animation contact sheets at actual play scale. Do not judge only enlarged sprite closeups.
5. Give the immutable candidate bundle to a reviewer who did not implement the change. The reviewer returns `ACCEPT`, `REJECT`, or `UNCERTAIN` with the exact viewport/frame and reason.
6. Update a baseline only after `ACCEPT`. Record the changed contract, reason, reviewer, and commit in the development log.
7. Run the normal non-update suites again. A baseline-update command is never the final verification command.

## Hard checks for every screen

Playwright must prove the following before visual judgment begins:

- The declared root and ready surface appear within the deadline, with no page or console error.
- Every critical raster image decodes to nonzero dimensions; the canvas has nonblank sampled pixels.
- Document width and height do not exceed the viewport. Required regions and targets remain inside it.
- Player-facing routes contain no Test Lab or other developer controls. Test mode is separately covered.
- Each control is enabled, center-hit-testable with `elementFromPoint`, and at least 44 × 44 CSS pixels on touch profiles.
- Phone controls overlay the world and consume no more than 20% of portrait height or 28% of landscape height.
- The mobile stage occupies at least 98% of the viewport. Desktop/narrow desktop stage area occupies at least 70%.
- The title is fully contained and less than 20% of screen height.
- Landscape selection maps authored head, hand, weapon, and foot landmarks through the browser's real background-size/position calculation; every landmark must remain inside the viewport and outside the title/chooser rectangles.
- Gameplay samples actual canvas pixels on both sides of collision edges and across same-material cell joins. Topology must be perceptible without exposing a second material scale or systematic tile seam.
- Real actions have causal postconditions. A click or tap alone is not a pass.

## Selection screen appearance

The selected hero is the dominant subject. Head, hands, feet, and signature equipment must not be accidentally cropped. `Cinderwake` may be real text; every other visible interface label is sprite-backed. The title must not cross the face. The three class tabs and launch controls read as one compact group, with selection visible without relying only on tiny copy.

Phone portrait should feel like a game cover that immediately becomes interactive: title at the top, unobstructed hero in the center, controls in the lower quarter, no scrolling. Phone landscape uses the left side for the title and the right/lower side for controls while retaining the hero's head. Desktop may use more negative space, but the hero, title, and chooser must form a deliberate triangle rather than three disconnected bands. All class scenes must share the same perspective, palette, contrast, lighting direction, architectural language, and body proportions.

Automatic geometry can catch overflow, occupancy, clipping of DOM regions, blank assets, title size, and occlusion of authored subject landmarks. It cannot prove that dark painted feet are visually legible, whether an AI-painted face looks anatomically correct, whether the hierarchy feels premium, or whether three scenes truly share an art direction. Those are independent-review vetoes.

## Gameplay screen appearance

The world is always the largest visual surface. There must be no separate dashboard below it and no large black desktop void. Mobile movement and action sprites sit in the lower corners; health sits above them without covering the player. Desktop HUD hugs the canvas edges and remains subordinate to combat.

Ground, buildings, props, actors, projectiles, effects, and UI must look as if they belong to one game: shared top-down/isometric perspective, scale, palette, edge treatment, and light direction. Collision boundaries must not appear as repeated floating tiles, checkerboard ribbons, or a map-sized rectangle made from a differently scaled material. The player and closest threat must be identifiable at a glance at actual play scale. Health bars must attach only to their intended actor.

For motion, inspect at least idle, eight-direction or declared-direction walk, abrupt turn, attack, ability, hurt-to-idle, death, projectile travel/impact, camera follow, and mobile tap-to-move. Reject one-frame scale pops, foot sliding, head/weapon clipping, centroid jumps, duplicate bodies, skipped or reordered frames, recovery snaps, camera lurch, and effects detached from their owner. The full actor audit must run every actor, clip, and facing—not a representative hero only.

## Interaction and liveness screens

Each journey declares an expected effect, forbidden effects, and deadline:

- Touching ordinary ground moves toward the tapped world point, persists without a second tap, and emits no attack.
- The Strike sprite emits an attack and does not become movement.
- Class selection changes the scene and selected state; Begin reaches the chosen hero's game.
- Ability changes clip/cooldown; tonic changes health/count when usable.
- Loading reaches the game or a recoverable error. An asset stall must time out; an abort/corrupt asset must expose working Retry and Back.
- Every modal button changes screen or state. No inert control is accepted because it was merely clickable.

These are reusable **intent** and **liveness** oracles. Future games provide different semantic commands through a small test adapter, but retain the same `precondition → physical gesture → expected intent/state delta → forbidden intent → deadline → evidence` shape.

## Test the tester

Every assessor needs paired negative controls. Deliberately remap ground tap to attack, remove a button listener, stall an asset, move a control outside the safe area, blank a sprite frame, offset one crop, shift an anchor, duplicate/reorder a frame, and introduce a one-frame scale pop. The valid control must pass and each mutation must fail through its named detector. A broad unrelated failure does not validate the assessor.

Screenshot diffs answer “did pixels change?” They do not answer “does this look good?” CI may create a candidate evidence bundle, but it must never self-promote that bundle to an approved baseline.

`captureMode=1` is the deterministic visual-candidate route: it freezes the simulation long enough to compare the same authored state across viewports. It is not evidence that the ordinary player route is live. The ordinary route is exercised separately for launch, loading recovery, movement, and action postconditions before a visual candidate can be accepted.

## Evidence and reproduction

Retain the contract hash, commit and dirty patch, viewport/DPR/input profile, initial scenario/state, browser event and semantic input logs, state hashes, asset progress, DOM geometry/hit-test report, screenshots, video/trace on failure, render manifests, masks, frame strips, measurements, negative-control ID, reproduction command, and independent verdict. This allows a future game team to trace one decision from user gesture to state to drawing to visual approval.

The intended extraction order is deliberate: finish Cinderwake end to end, use the same contracts on one second game, then package the stable schemas/runner/adapter. Packaging before two implementations would freeze Cinderwake-specific selectors and clip names into a supposedly generic framework.
