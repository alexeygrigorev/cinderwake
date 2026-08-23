# Quality model

Quality is assessed at declared scenarios and frame ranges, not by a vague claim that the game “feels good.” Automated checks establish repeatable invariants; an agent or human reviews the retained visual artifacts for gestalt that metrics cannot faithfully capture.

| Area                  | Acceptance criterion                                                                                                                                                                  | Automated evidence                                | Visual judgment                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Movement smoothness   | At 60 Hz, each sustained tick changes position by the declared integer `moveSpeed`; direction changes have no unexplained displacement spike; normalized diagonal speed is within 1%. | snapshots, velocity/position deltas, frame strip  | apparent smooth travel and responsive starts/stops                     |
| Animation naturalness | State transitions begin on declared ticks; looping cadence is stable; no repeated/skipped frame except explicitly authored holds; attack wind-up/active/recover order is valid.       | animation phase/frame sequence, manifest          | motion reads as intentional, weighty, and not robotic                  |
| Non-jumpiness         | Consecutive root/anchor positions do not exceed the maximum motion implied by velocity plus declared dash/knockback; camera discontinuities only occur at documented snaps.           | consecutive manifests/snapshots                   | no visible teleport, jitter, or one-frame pose pop                     |
| Pivot / foot anchor   | A camera-tracked grounded actor has no more than 0.25 logical pixels of screen-anchor range; horizontal flips preserve the declared world anchor.                                     | manifest anchor vs transform                      | feet look planted rather than sliding/floating                         |
| Clipping              | Source rectangles are inside sprite-sheet bounds; destination rectangles are finite; intended scene clipping is limited to viewport boundaries.                                       | manifest rectangle bounds, screenshot edge checks | no chopped heads/weapons or accidental layer cuts                      |
| Proportionality       | Each archetype/enemy remains within its authored width/height and aspect-ratio tolerance (normally ±2%); scale never becomes zero/negative.                                           | manifest dimensions/scale                         | silhouette and weapon size look believable across poses                |
| Camera                | Camera follows its declared target smoothly, stays clamped to map bounds, and preserves viewport framing; target screen offset stays within configured dead-zone.                     | camera snapshots and strip                        | no nausea-inducing lurch, late catch-up, or revealing void outside map |
| Input-to-action       | A command accepted on tick N changes the appropriate state no later than N+1, subject only to explicit cooldown/buffer rules.                                                         | command tape correlated with snapshots            | controls feel immediate and directionally faithful                     |
| State transitions     | Health, death, pickup, cooldown, victory, and loss transitions occur once, in valid order, and freeze/continue only as specified.                                                     | invariant tests and replay snapshots              | feedback is readable: hit, death, pickup, win/loss are visually clear  |
| Screenshots           | Baseline scenarios render after assets settle, at pinned viewport/DPR; image diff stays within approved threshold and no unexpected blank/transparent regions appear.                 | pixel diff, alpha/region checks, manifest         | composition, contrast, readability, and style coherence                |

Numeric tolerances belong in scenario/test metadata, never hidden in an evaluator’s judgment. Pixel comparisons are valuable for regressions but may vary with browser rasterization; manifests and semantic snapshots are the source of truth for geometry and timing. Conversely, passing all metrics is not proof of quality: reviewers inspect screenshots and especially multi-frame strips for unnatural rhythm, overlap, visual hierarchy, and whether the action is understandable at a glance.

## Enforced sequence thresholds

`scripts/assess-sequence.mjs` currently fails a capture when any applicable condition is false:

| Measurement or contract                             | Threshold                                               | Why it matters                                                          |
| --------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Recomputed state hash and state→manifest projection | exact                                                   | proves every image is synchronized with its claimed simulation state    |
| Saved isolated-mask SHA-256 and render signature    | exact                                                   | detects artifact substitution and nondeterministic drawing              |
| Presence lifecycle                                  | exact `always`, `present-until`, or `appears-at`        | distinguishes a valid despawn/spawn from a missing actor                |
| Screen foot-anchor range, X and Y                   | `≤ 0.25` logical pixels where grounding is required     | detects camera jitter and sprite pivot drift                            |
| World displacement versus state velocity            | exactly `0` units where motion is required              | detects rendering or stepping discontinuities                           |
| Speed range across sampled intervals                | `≤ 0.01` units/tick where constant motion is required   | detects uneven motion under constant input                              |
| Semantic frame error / frame advance                | exactly `0` / `≤ 1` frame per sample                    | detects incorrect cadence and skipped animation frames                  |
| Raster centroid/dimension step                      | profile bounds (`18`/`32` px; death allows `32`/`48`)   | detects implausible silhouette pops while allowing an authored collapse |
| Attached-effect body core                           | 48 px center band; step `≤ 16`, acceleration `≤ 10`     | lets attached magic bloom while the character body remains stable       |
| Grounded raster bottom range                        | `≤ 1` px; death profile `≤ 18` px                       | catches visible float or foot drift                                     |
| One-shot lifecycle and recovery seam                | start + terminal + idle; RMSE `≤ 0.001`, geometry exact | rejects visible recovery pops without failing atlas-filtering noise     |
| One-shot visual poses                               | at least `5` distinct isolated raster masks             | rejects semantically advancing attacks whose silhouette barely changes  |
| Loop lifecycle                                      | every semantic frame plus at least one wrap             | proves that a loop is complete rather than a short sample               |
| Death lifecycle                                     | start + terminal + contiguous despawn                   | proves the final death frame is retained and cleanup occurs once        |
| Camera convergence / acceleration                   | final error `≤ 2` px; acceleration `≤ 40` px/tick²      | catches reversal, lurch, and incomplete follow                          |
| Actual ink visibility, geometry envelope, clipping  | visible, plausible, and inside viewport when required   | catches blank, degenerate, disproportionate, or chopped drawing         |

Camera acceleration is measured and retained for diagnosis, but is not globally gated because deliberate camera snaps and tracked-camera scenarios need distinct thresholds. Scenario-specific tests assert camera clamping and stable screen anchors. The current smooth camera uses a deterministic fixed per-tick follow rule; captured test frames use alpha 1 and can use snap/fixed camera mode so display interpolation never makes a state assertion ambiguous.

## Capture profiles and public matrix

The sequence assessor names its expectations through capture profiles: `pose`, `static-pose`, `loop`, `one-shot`, `one-shot-floating`, `death`, `anchored-motion`, `projectile`, and `camera-smooth`. A profile selects relevant checks rather than pretending that an idle sprite and a projectile have identical motion obligations. Every profile still keeps semantic frame timing, transparent entity-mask evidence, and a replayable state/tape bundle.

The shipped public matrix contains 23 deterministic reports: four directional locomotion runs; one mobile run sampled at quarter-tick interpolation; all six east-facing hero primary/ability actions; explicit north-facing Ranger and south-facing Arcanist action/recovery regressions; all three enemy attacks; enemy death through terminal pose and despawn; long projectile travel; a separate projectile hit/effect/despawn lifecycle; a full 48-tick loot loop; smooth camera convergence; and win/loss overlays. The sprite contract additionally resolves every clip for all six actors across all four cardinal facings. Keyboard/pointer, touch controls, viewport layout, selection, generated maps, and broader state behavior remain in the Playwright/unit reports. Expand both layers with each newly shipped system, especially the roadmap Cinder Nodes, dodge, equipment, and boss content.

## Review protocol for changed visuals

1. Run the exact-tick visual tests and generate the relevant sequence report.
2. Check that state events and render-manifest clip/frame changes occur on the intended ticks.
3. Inspect close-ups with the foot-anchor crosshair for travel, silhouette stability, weapon arcs, contact, recovery, and camera motion.
4. Only then update a screenshot baseline, record the reason in the development log, and rerun the normal non-update suite.

This protocol already caught a one-frame attack seam: the final one-shot frame wrapped to the start pose immediately before idle. One-shot frame selection now clamps at its terminal frame, and the authored recovery pose converges to idle, so the transition is both semantically monotonic and visually continuous.

Recommended review set: idle, four-direction locomotion, abrupt turn, each archetype attack and ability, enemy wind-up/hit/death, projectile travel, pickup, map edge camera clamp, victory, loss, and any known regression. A failed visual judgment should become a named scenario and, where feasible, a new measurable invariant. Dodge is deferred and must join this set when implemented.
