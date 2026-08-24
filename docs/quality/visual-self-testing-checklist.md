# Visual and presentation self-testing checklist

This is the repeatable release checklist for presentation defects. It is deliberately **not** a gameplay-design checklist: quests, balance, NPC behavior, economy, and progression are out of scope. Run it for Cinderwake now and keep the IDs and evidence shapes when adapting the framework to another game.

The [executable presentation-run contract](presentation-run-contract.md), [ordered recipe catalog](../../quality/presentation-recipes.v1.json), and [exact blank run template](../../quality/presentation-run.v1.template.json) lock this checklist’s 28 IDs, order, matrices, controls, evidence shape, and acceptance semantics. Use those files rather than copying a partial handwritten result next time.

For every item, mark exactly one result:

- `[ ] PASS` — the valid candidate passes and its named negative control fails through the intended detector.
- `[ ] FAIL` — the candidate violates the contract; record the named signal, first failing frame, and reproduction command.
- `[ ] NEEDS VISUAL REVIEW` — machine prerequisites pass, but the required independent appearance judgment is absent, uncertain, or rejects the candidate.

`PASS` is prohibited when a row says **calibration required** until an accepted corpus, its measurements, and a detector-specific negative mutation are hash-bound in the repository. A generic screenshot change is not a detector control. Current coverage labels mean:

- **Automatic** — a named machine oracle and representative negative control exist.
- **Partial** — useful evidence or assertions exist, but the exact defect can still escape or its detector lacks a negative control.
- **Missing** — no dedicated machine oracle exists.

## User-reported regression gate

This is the short entry checklist for the concrete failures found during Cinderwake playtesting. A future self-testing agent must go through every box on every release candidate. The box is satisfied only when all linked `PRES-*` rows have executable evidence in the same hash-bound presentation run; checking the prose box by inspection is not sufficient.

- [ ] The ordinary production page starts, character selection works, Begin works, and every visible button produces its declared state change. (`PRES-LIVE-001`, `PRES-BLANK-011`)
- [ ] On mobile, tapping reachable ground walks without striking; Strike attacks without creating a movement route; the four pad directions work. (`PRES-INPUT-002`, `PRES-MOBILE-010`)
- [ ] Every playable character's world position, on-screen glyph, facing, and walk animation agree with each commanded direction. (`PRES-MOVE-003`, `PRES-FACING-015`)
- [ ] Every actor and monster atlas is cut correctly: no clipped cells, blank cells, stale recovery poses, scale pops, displaced anchors, or malformed facing banks. (`PRES-SPRITE-004`, `PRES-ANCHOR-013`)
- [ ] Idle, walk, turn, attack, ability, hurt, recovery, and death sequences look natural in order and do not jump, freeze, duplicate, skip, flicker, or retain stale pixels. (`PRES-MOTION-005`, `PRES-DUP-014`, `PRES-FLICKER-024`)
- [ ] The player, enemies, buildings, props, and UI sprites remain crisp at the original captured resolution on high-DPR phones and desktops. (`PRES-CRISP-006`, `PRES-CROSSDEVICE-025`)
- [ ] Nothing is stretched: source and destination aspect ratios, X/Y camera scale, role proportions, and facing-to-facing scale remain consistent. (`PRES-ASPECT-007`, `PRES-PROPORTION-023`)
- [ ] Default zoom and framing show enough surrounding world to navigate while actors, threats, buildings, and controls remain readable; no crop reveals void. (`PRES-ZOOM-017`, `PRES-CAMERA-016`)
- [ ] The camera follows starts, stops, turns, reversals, and map edges smoothly without jitter, lurch, overshoot, or a one-frame discontinuity. (`PRES-CAMERA-016`, `PRES-MOTION-005`)
- [ ] Characters cannot walk through solid scenery, but every collision is explained by a visible footprint, names the blocking object, gives immediate feedback, and still permits a route around it. (`PRES-COLLIDE-008`)
- [ ] There are no invisible fences, oversized roof colliders, unexplained blocked directions, or collision geometry left behind after its sprite disappears. (`PRES-COLLIDE-008`, `PRES-LEAK-012`)
- [ ] All player-facing world imagery is sprite-backed except permitted title text; no CSS placeholder, emoji, glyph, gradient panel, or debug shape substitutes for game art. (`PRES-SPRITE-009`)
- [ ] Wilderness and Embercross visibly contain coherent sprite-backed buildings, landmarks, props, objects, ground detail, and service locations rather than empty scattered tiles. (`PRES-PROP-020`, `PRES-DENSITY-022`, `PRES-TILE-018`)
- [ ] Actors, monsters, scenery, loot, effects, city residents, service surfaces, and selection art share one Cinderwake perspective, lighting, palette, edge treatment, and detail density. (`PRES-STYLE-021`, `PRES-PROPORTION-023`)
- [ ] Wide desktop and landscape views do not expose repetitive topology, large low-information ground fields, checkerboard seams, or cloned-prop patterns. (`PRES-TILE-018`, `PRES-DENSITY-022`)
- [ ] Actors and monsters read as living intentional poses at play scale; none looks like a prone corpse, malformed cutout, floating body, or unrelated ground prop. (`PRES-SPRITE-004`, `PRES-MOTION-005`, `PRES-PROPORTION-023`)
- [ ] Combat remains legible: actors do not collapse into accidental overlaps, depth order is logical, effects stay attached, and health indicators do not obscure the sprites. (`PRES-DEPTH-019`, `PRES-DENSITY-022`)
- [ ] Phone portrait and landscape layouts keep the player, destination, city services, status text, and controls readable, unobscured, safe-area aware, and comfortably tappable. (`PRES-MOBILE-010`, `PRES-CROSSDEVICE-025`)
- [ ] Embercross can be found from the wilderness, entered through a visible gate, and its merchant, tavern, and healer controls are visibly identifiable and live through physical input. (`PRES-CITY-027`, supported by `PRES-LIVE-001`, `PRES-PROP-020`, and `PRES-MOBILE-010`)
- [ ] Every reproduction starts from a declared production route or serialized state, records the exact gesture/command tape, and captures synchronized snapshots, manifests, ordered frames, final state, environment, and hashes. (`PRES-STATE-028`, `PRES-REVIEW-026`, and every applicable recipe)
- [ ] An independent visual agent reviews the ordered frames at actual play scale and normal speed; a machine pass cannot override its specific rejection. (`PRES-REVIEW-026` and every row marked mandatory review)

If any box cannot be backed by its linked rows, leave it unchecked and record the gap as a blocker. The canonical execution order remains the 28-row contract below so results stay comparable between Cinderwake and future games.

## Fixed execution order

1. Record commit, dirty patch, browser/runtime versions, asset hashes, viewport, DPR, locale, and exact reproduction command.
2. Run asset decode, sprite-source, crop, blank-frame, aspect, and exhaustive animation-bank checks.
3. Run deterministic arbitrary-state captures for motion, transitions, collision contact, camera, and compositing.
4. Run the ordinary production route with physical mouse, keyboard, and touch gestures; do not use a mutating test bridge for this step.
5. Run the four screen profiles and at least one real high-DPR phone profile. Retain ordered frames, not only final screenshots.
6. Run every named negative control through the same evaluator used on the candidate.
7. Give the immutable, hash-bound artifacts to an independent visual agent at actual play scale.
8. Publish one result record keyed by the IDs below. Any `FAIL`, unrun P0, missing negative control, or mandatory review without `ACCEPT` blocks visual acceptance.

## Reusable adapter and evidence contract

A future game supplies a `PresentationAdapterV1`; the checklist does not depend on Cinderwake entity or clip names.

| Generic adapter concept | Required observation                                                                                       | Cinderwake mapping                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `readySurface`          | visible player-facing render surface and asset-ready state                                                 | `canvas`, `__GAME_OBSERVE__.ready`                                    |
| `physicalGestures`      | pointer, key, touch-route, touch-pad, and action gestures                                                  | `InputController`, selection `#begin`, `.move-pad`, `.mobile-actions` |
| `semanticSnapshot`      | tick, actor world transform, animation state, events, blocked-object identity                              | `__GAME_OBSERVE__.snapshot()` / canonical state                       |
| `renderManifest`        | ordered sprite calls, source/destination rectangles, anchors, facing, opacity, layer/Z, camera, collisions | `RenderManifestV1` in `src/render/manifest.ts`                        |
| `frameCapture`          | lossless full surface and composed page at a named presentation tick                                       | observer `captureFrame()`, Playwright PNG                             |
| `entityMask`            | isolated alpha mask, ink bounds, centroid, foot/support anchor and hash                                    | sequence capture `mask-*.png` and timeline mask metadata              |
| `sceneRoles`            | semantic visual roles, visible footprint, collision mode, stable ID                                        | tiles, exits, structures, props in `sceneSprites`                     |
| `deviceProjection`      | canvas backing size, CSS box, device scale, crop, safe-area/control occlusion                              | screen-contract projection                                            |
| `reviewBundle`          | immutable artifacts plus reviewer verdict and exact hashes                                                 | `quality-results`, screen review/index records                        |

Unless a row narrows it, “ordered artifacts” means: `(1)` initial state/snapshot, `(2)` physical gesture log or deterministic command tape, `(3)` state snapshots by tick, `(4)` synchronized render-manifest timeline, `(5)` full PNG frames and isolated masks in presentation order, `(6)` contact sheet or real-time video, `(7)` final state, metrics, negative-control result, environment metadata, and hashes. The existing sequence layout is documented in `docs/testing-architecture.md` under “Artifact layout”; the production observer shape is implemented in `src/testkit/playerObserver.ts`.

## P0 — player-visible correctness

### PRES-LIVE-001 — launch and control liveness

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: cold ordinary `/` route, every selectable character in turn, assets uncached; separately abort and stall one required atlas.
- Production gesture: select character, activate Begin, then activate every visible game/modal control using its real mouse or touch event.
- Ordered artifacts: page frame before gesture; browser-event log; the declared control-to-intent registry; observer readiness and presentation samples; frame/state after each control; console/page errors; failure, Retry, and Back frames; standard metadata/hashes.
- Machine signal and threshold: each declared intent must reach its semantic postcondition within the deadline already owned by that route; presentation ticks must remain live; failure must reach a recoverable screen. Do not add a universal timing number—calibrate per transition from green CI and a slow reference phone, then freeze it in screen metadata.
- Required negative control: separately remove the Begin listener and one visible action listener; stall one asset; abort one atlas. Each must fail as `launch-inert`, `control-inert`, or reach the intended recovery contract, never pass merely because the element was clickable.
- Current evidence: `tests/e2e/live-player-journey.spec.ts` test “ordinary production route advances…”; `tests/e2e/physical-gesture-temporal.spec.ts`; `tests/e2e/mobile.spec.ts` test “real mobile selection path…”; loading abort/stall tests in `tests/e2e/ui-text-contract.spec.ts`; criteria in `docs/screen-test-playbook.md` lines 60–75.
- Missing automation/next implementation: the two listener-removal mutations and per-control intent registry are contractually required but not yet wired into one evaluator; ordinary-route coverage is still a curated subset.
- Independent visual-agent review mandatory: **yes**, for visible pressed/loading/recovery feedback; liveness itself is machine-authoritative.

### PRES-INPUT-002 — touch movement is not strike

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: ordinary production mobile route with player idle, no cooldown, a reachable unobstructed ground point, visible movement pad, and visible Strike control.
- Production gesture: tap ordinary ground, drag the joystick in four cardinal directions, release; then tap Strike at the same viewport profile.
- Ordered artifacts: initial snapshot/frame; target/pad/button device coordinates; raw touch sequence; ordered observer samples and PNGs during each gesture; event/state deltas after release; control pressed-state frames.
- Machine signal and threshold: ground tap and pad produce movement intent and world displacement without `attack_started`; Strike produces `attack_started` without route persistence or movement. Use exact intent exclusion and the input adapter’s declared next-tick/deadline contract, not a pixel-diff threshold.
- Required negative control: swap ground-tap and Strike bindings; the evaluator must report `gesture-intent-mismatch` for both routes.
- Current evidence: `tests/e2e/mobile.spec.ts` test “tapping the ground persistently moves without striking”; `tests/e2e/physical-gesture-temporal.spec.ts` mobile journey; `docs/decisions/0025-production-gesture-temporal-evidence.md`.
- Missing automation/next implementation: add the explicit swapped-binding mutation and exercise all four physical joystick directions on the ordinary route.
- Independent visual-agent review mandatory: **yes**, for unambiguous pressed/route feedback; intent separation is machine-authoritative.

### PRES-MOVE-003 — glyph follows the commanded direction

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: actor idle on open floor; fixed camera for direct glyph displacement, then normal follow camera with one stable scene reference; repeat all four cardinal directions for every playable actor.
- Production gesture: key down/up or cardinal joystick drag; ground tap in each reachable quadrant.
- Ordered artifacts: input vector; initial world/screen anchors; every walk sample’s world anchor, screen anchor, facing bucket, clip, frame identity, camera, reference-scene anchor; ordered full frames/masks/contact sheet; final state.
- Machine signal and threshold: nonzero world displacement has the same axis sign as input; under fixed camera, glyph screen displacement has the same sign; under follow camera, the scene reference moves with the opposite sign; clip is `walk`, facing matches the command, and at least two authored frames occur during a sufficiently long gesture. Use exact signs and declared clip cadence.
- Required negative control: reverse rendered projection only; freeze the walk frame; force the opposite facing. Each mutation must fail its own `screen-direction`, `walk-frozen`, or `facing-mismatch` signal.
- Current evidence: `tests/unit/directional-motion.test.ts`; production east checks in `tests/e2e/physical-gesture-temporal.spec.ts` lines 91–150; cardinal sprite-bank assertions in `tests/unit/sprite-contract.test.ts` test “projects every actor clip…”; observer fields in `src/testkit/playerObserver.ts` lines 5–18.
- Missing automation/next implementation: no detector-specific negative mutations; production route currently proves east rather than every actor/direction.
- Independent visual-agent review mandatory: **yes**, because semantically correct travel can still look like foot sliding.

### PRES-SPRITE-004 — complete, correctly cut sprite cells

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Automatic**.
- Scenario/precondition: every registered actor × clip × runtime facing, including unreachable registered banks, decoded directly from the production atlas.
- Production gesture: none; launch production once to prove decoded assets, then audit the atlas offline in runtime order.
- Ordered artifacts: catalog/atlas hashes; per-bank ordered source cells; alpha masks and measurements; 144 strips and six overviews; report JSON/HTML; production decode evidence.
- Machine signal and threshold: nonblank alpha, source bounds, safe crop, common foot anchor, continuity envelopes, pose diversity, loop wrap, and recovery use the frozen values in `docs/quality-model.md` lines 99–115 and the actor contract—never silently widen them for a failing actor.
- Required negative control: stale recovery, displaced frame, cell-edge clipping, facing-scale overflow, and declared clip-transition scale pop.
- Current evidence: `npm run art:animation:check`; `scripts/audit-actor-atlases.mjs`; `docs/decisions/0015-exhaustive-actor-atlas-audit.md` lines 17–25; decode test in `tests/e2e/sprite-contract.spec.ts`.
- Missing automation/next implementation: none for structural/cut coverage; add any newly registered sprite family to the exhaustive registry rather than sampling it in one scene.
- Independent visual-agent review mandatory: **yes**, for anatomy, support ownership, and whether the cuts form natural motion.

### PRES-MOTION-005 — no jumpy, frozen, skipped, or reordered animation

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Automatic** for registered actor banks, **Partial** for real-time compositing.
- Scenario/precondition: every actor’s idle, walk, abrupt turn, attack, ability, hurt→idle, death, and relevant cross-clip seam; repeat representative sequences through the live renderer.
- Production gesture: sustained move, abrupt opposite/cardinal turn, Strike, Ability, receive damage, and death trigger.
- Ordered artifacts: command tape or gesture log; per-tick state/manifest; sub-tick frames where interpolation applies; isolated masks; bank strips, live contact sheets/video; lifecycle events.
- Machine signal and threshold: declared frame order/cadence, no unauthorized hold/skip, required unique masks, centroid/body-core/dimension/IoU continuity, exact or calibrated recovery seam, and anchor/bottom ranges from `docs/quality-model.md` lines 71–97 and 99–115.
- Required negative control: duplicate/freeze a frame, reorder two frames, offset one crop, inject one-frame scale/centroid pop, stale recovery, and skip a terminal pose.
- Current evidence: exhaustive atlas audit and its five controls; `scripts/assess-sequence.mjs`; `tests/visual/animation.spec.ts` tests “idle loop…” and “walk is monotonic…”; `docs/decisions/0012-raster-aware-temporal-continuity.md`.
- Missing automation/next implementation: add named live-compositor flicker/ghost mutations and require one ordinary-route temporal strip per actor; static atlas success cannot prove interpolation/compositing.
- Independent visual-agent review mandatory: **yes**, always at actual play scale and normal playback speed.

### PRES-CRISP-006 — crisp high-DPR rendering

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: same deterministic scene at baseline DPR 1, desktop DPR 2, and portrait mobile DPR 3 with real cover-fit CSS; assets settled.
- Production gesture: launch, stand idle, walk, and attack so both static edges and moving sprites are sampled.
- Ordered artifacts: viewport/DPR; CSS canvas box; backing-store dimensions; manifest viewport/device scale; full-resolution PNGs before/during motion; 100% crops of player, prop, UI glyph, and diagonal edge.
- Machine signal and threshold: backing and CSS aspect agree; backing pixels satisfy the renderer’s declared target physical-pixels-per-CSS-pixel policy on both axes; no unintended browser resample stage. Use the policy encoded and tested in `tests/e2e/render-resolution.spec.ts`, then calibrate an edge-acutance/alias metric from accepted DPR fixtures before gating perceived sharpness.
- Required negative control: force the old 960×540 backing store at DPR 2/3; it must fail `backing-resolution-insufficient`. A separately blurred accepted crop must fail the future sharpness metric.
- Current evidence: geometry assertions in `tests/e2e/render-resolution.spec.ts`; adaptive backing in `src/render/CanvasRenderer.ts` lines 51–80.
- Missing automation/next implementation: no detector mutation or calibrated raster-sharpness oracle yet; current test proves resolution allocation, not that art looks crisp.
- Independent visual-agent review mandatory: **yes**, on original-resolution mobile output rather than a zoomed screenshot viewer.

### PRES-ASPECT-007 — no stretched actors, buildings, props, or UI sprites

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Automatic** for actors and reviewed environment-kit sprites, **Partial** globally.
- Scenario/precondition: manifest containing every sprite role at each supported camera zoom and device profile.
- Production gesture: launch, move until each role is visible, trigger all action/effect roles.
- Ordered artifacts: catalog logical/source dimensions; per-frame source and destination rectangles; camera zoom timeline; PNG/mask crops; role inventory and hashes.
- Machine signal and threshold: destination aspect must equal the declared source/logical aspect within deterministic numeric precision; zoom must multiply X and Y uniformly. Exceptions require an explicit reviewed transform contract, never an ad hoc destination width/height.
- Required negative control: widen one actor destination, stretch one wall, and apply unequal X/Y camera scaling; each must fail the role/aspect oracle.
- Current evidence: `tests/unit/sprite-contract.test.ts` test “preserves every actor source-cell aspect ratio at runtime” lines 474–496; environment logical-aspect validation in `tests/framework/sprite-contract.ts`; stretched-wall mutation in `tests/unit/opening-composition.test.ts`; `tests/unit/camera-projection.test.ts`.
- Missing automation/next implementation: inventory every UI/effect/legacy scenery role through the same source→destination aspect evaluator and add actor/non-wall mutations.
- Independent visual-agent review mandatory: **yes**, because technically uniform scale can still produce bad authored proportions.

### PRES-COLLIDE-008 — visible solid footprint and understandable blocked movement

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: inject player just outside every solid object’s four principal contact sides, with adjacent slide space and AI disabled; include thin props, wall/fence edges, building bases, and cover-fit mobile crop.
- Production gesture: hold/drag directly into the object until blocked, then move tangentially around it.
- Ordered artifacts: initial state; object ID/name, alpha/support footprint and collision geometry; attempted input vectors; per-tick actor/camera/manifest; contact PNGs/masks; `movement_blocked` event and rate-limited impact/log feedback; final slide state.
- Machine signal and threshold: actor never enters/crosses the solid; collision extent beyond visible support must stay inside the accepted actor-contact allowance; blocking names the manifested object and produces immediate visible feedback; tangential motion remains possible. Use the existing sprite-specific measured support values, not a universal guessed collider ratio.
- Required negative control: enlarge or offset the collider beyond visible alpha; remove the object sprite while retaining collision; remove blocked feedback; make an endpoint-only collision test. Each must fail a distinct signal.
- Current evidence: `tests/unit/scenery-collision.test.ts` tests “keeps opening collision contact…” (lines 130–163) and “names a blocked object…” (lines 213–259); `tests/e2e/scenery-collision.spec.ts`; terrain boundary contrast mutation in `tests/e2e/screen-contract.spec.ts` lines 819–864.
- Missing automation/next implementation: generalize alpha-derived support comparison from the three opening props to every solid role and add invisible/offset collider mutations to the same evaluator.
- Independent visual-agent review mandatory: **yes**, to judge whether the blocker and impact cue are understandable during normal motion.

### PRES-SPRITE-009 — all visible graphics are sprite-backed except approved titles

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: selection, loading, gameplay HUD, all actions/effects/loot, Test Lab, failure/retry, win/loss, and any newly added city/interior screen.
- Production gesture: traverse each screen and activate every stateful surface so hidden/conditional visuals become visible.
- Ordered artifacts: visible DOM text/element inventory per state; computed background images; manifest draw-call inventory; decoded asset dimensions; screenshots and accessibility labels.
- Machine signal and threshold: visible non-title text offender count is exactly zero; every declared visual role resolves to a decoded local raster sprite/draw; only the explicit title allowlist may render as text.
- Required negative control: replace one glyph/button/health/frame/scenery role with CSS shape or plain text; the inventory must name that role.
- Current evidence: `tests/e2e/ui-text-contract.spec.ts` lines 6–76 and its selection/gameplay states; `tests/e2e/sprite-contract.spec.ts` test “real canvas uses atlas image draws…”.
- Missing automation/next implementation: current DOM selector lists and manifest role registry are curated; add a complete visible-element/draw provenance inventory and a CSS-shape mutation.
- Independent visual-agent review mandatory: **no** for provenance; **yes** under style/composition rows.

### PRES-MOBILE-010 — mobile crop, overlap, readability, and tap feedback

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: phone portrait and landscape, safe-area inset variants, DPR 1 and real-device DPR, selection/loading/gameplay/modal states, central actor near each control region.
- Production gesture: select/Begin, touch route, pad drag/release, every action tap, orientation change, Retry/Back.
- Ordered artifacts: composed-page screenshots before/pressed/after each gesture; element rectangles and center hit tests; safe areas; canvas device projection/crop; manifest actors/objectives; state/intent deltas.
- Machine signal and threshold: no page overflow; required regions contained; targets meet each profile’s frozen minimum (44 CSS px on touch); stage/control coverage and world-UI overlap obey `quality/screen-contract.v1.json`; pressed gesture must yield both immediate visual state and semantic outcome.
- Required negative control: undersize/occlude/offscreen a target, crop a subject landmark, detach HUD, suppress pressed state, and rotate into overlap.
- Current evidence: profile contract at `quality/screen-contract.v1.json` lines 4–36; `tests/e2e/screen-contract.spec.ts` including target/crop/HUD mutations; `tests/e2e/mobile.spec.ts` layout and real controls.
- Missing automation/next implementation: add safe-area inset emulation, pressed-state image/oracle, orientation transition capture, and real-device artifact ingestion.
- Independent visual-agent review mandatory: **yes**, for native readability, hand occlusion, and perceived response.

## P1 — visual continuity, composition, and coherence

### PRES-BLANK-011 — no blank, transparent, undecoded, or substituted frame

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Automatic** for registered actors/assets, **Partial** for every conditional role.
- Scenario/precondition: exhaustive registry and every runtime state that selects a sprite/effect/UI role.
- Production gesture: launch and exercise all clips/effects/outcomes.
- Ordered artifacts: catalog and asset hashes/dimensions; source rectangles; isolated alpha masks; manifested role inventory; frame sequence and decode/error log.
- Machine signal and threshold: decode succeeds; source rect is in bounds; required alpha count uses the role’s calibrated minimum; render-visible role has nonzero pixels; manifest reference exactly matches catalog.
- Required negative control: blank one cell, use out-of-bounds crop, substitute an asset ID/hash, and fail decode.
- Current evidence: atlas blank/crop controls; `tests/e2e/sprite-contract.spec.ts`; `scripts/assess-sequence.mjs`; loading failure tests.
- Missing automation/next implementation: require exhaustive runtime-role reachability or isolated render fixtures for UI/effect/scenery states beyond actors.
- Independent visual-agent review mandatory: **no** for blankness; **yes** if substitution remains stylistically plausible.

### PRES-LEAK-012 — no atlas-cell leakage, matte box, fringe, or ghost body

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Automatic** for environment ingress, **Partial** for final compositing.
- Scenario/precondition: every prepared/generated atlas cell on transparent and contrasting checkerboard backgrounds, plus moving live scene.
- Production gesture: walk/attack through light and dark ground; trigger large attached effects.
- Ordered artifacts: raw/prepared hashes; alpha masks and connected components; source crop; isolated frame on checkerboards; ordered full-scene frames/video.
- Machine signal and threshold: safe-border ink, cross-cell ink, opaque matte, disconnected unexpected component, and isolated-vs-composed render signatures follow existing role contracts; suspected persistence across cleared frames requires calibration from accepted effects.
- Required negative control: cross-cell pixel shift, opaque rectangular matte, colored fringe, failure to clear prior frame, and duplicate body draw.
- Current evidence: environment mutations in `tests/unit/environment-composition.test.ts`; actor safe-crop audit; isolated draw signatures in sequence reports.
- Missing automation/next implementation: add a cleared-canvas persistence/duplicate-body compositor oracle with temporal mutations.
- Independent visual-agent review mandatory: **yes**, especially for subtle chroma fringe and intentional particles.

### PRES-ANCHOR-013 — planted anchors and no scale pop

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Automatic** for actor banks/captured profiles.
- Scenario/precondition: idle loop, idle↔walk, every facing turn, attack/ability/hurt recovery, death exception profile, fixed and tracked cameras.
- Production gesture: start, stop, turn, strike, ability, receive hit.
- Ordered artifacts: per-frame semantic foot/world/screen anchors; isolated mask bottom/centroid/dimensions; camera; full frames and contact sheet.
- Machine signal and threshold: use the foot-anchor, raster-bottom, median-height, centroid, and dimension envelopes already frozen in `docs/quality-model.md` lines 73–97; death/attached-effect exceptions must name a profile.
- Required negative control: raise one frame, move one anchor, inject one-frame scale, and use a per-cell normalizer that hides a shared-scale error.
- Current evidence: `scripts/assess-sequence.mjs`, start-stop tapes, exhaustive actor audit, actor candidate/assembly checks.
- Missing automation/next implementation: require current live production strips for every playable actor rather than relying only on deterministic capture and static banks.
- Independent visual-agent review mandatory: **yes**, for foot sliding and apparent weight.

### PRES-DUP-014 — enough distinct frames; no accidental freeze or duplicates

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Automatic** for actor atlas banks, **Partial** for live presentation.
- Scenario/precondition: each declared loop/one-shot over one complete duration plus wrap/recovery.
- Production gesture: sustain the relevant action for its declared duration.
- Ordered artifacts: semantic frame indices/identities; isolated mask hashes; presentation timestamps; ordered frames/contact sheet.
- Machine signal and threshold: expected frame coverage and minimum distinct-pose counts come from the clip contract; authored holds must be explicitly declared. Presentation samples must show the same sequence, allowing only repeat sampling caused by higher display rate.
- Required negative control: duplicate one authored cell, freeze renderer selection, and skip one semantic frame.
- Current evidence: `scripts/audit-actor-atlases.mjs` pose-diversity checks; `scripts/assess-sequence.mjs` loop coverage; production frame progression in `tests/e2e/physical-gesture-temporal.spec.ts`.
- Missing automation/next implementation: bind live display samples to the exact expected frame timeline for each refresh-rate profile and add a frozen-renderer mutation.
- Independent visual-agent review mandatory: **yes**, because distinct hashes can still be visually identical poses.

### PRES-FACING-015 — facing bank, pose, weapon, and travel agree

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Partial**.
- Scenario/precondition: each actor on open floor, every cardinal direction, then abrupt same-tick turns during idle/walk/action/recovery.
- Production gesture: cardinal keys/pad and target-directed action in each quadrant.
- Ordered artifacts: input/aim vector; actor facing state; sprite ID, `facingBucket`, `flipX`, frame; world/screen displacement; ordered crops/contact sheet.
- Machine signal and threshold: deterministic vector→bank/flip mapping is exact; movement sign agrees with input; recovery remains on the selected bank; weapon/projectile origin aligns with authored anchor contract.
- Required negative control: select opposite bank, forget west reflection, retain stale bank after turn, and mirror pose without mirrored attack origin.
- Current evidence: cardinal mapping in `tests/unit/sprite-contract.test.ts`; `tests/unit/directional-motion.test.ts`; directional action recovery fixtures; actor facing comparisons.
- Missing automation/next implementation: add the four named mutations and projectile/weapon-origin coupling for every class.
- Independent visual-agent review mandatory: **yes**, for pose readability even when metadata is correct.

### PRES-CAMERA-016 — smooth camera without jitter, lurch, overshoot, or void

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Partial**.
- Scenario/precondition: fixed camera, snap follow, smooth follow, abrupt direction reversal, map edges/corners, and actor start/stop; repeat desktop/mobile crop.
- Production gesture: sustained travel, abrupt reverse, diagonal travel, stop at center and each map edge.
- Ordered artifacts: target/camera position and zoom per simulation/presentation tick; player and stable scene screen anchors; full frames/contact sheet/video; viewport projection.
- Machine signal and threshold: fixed-step convergence and acceleration use the camera profile in `docs/quality-model.md` lines 94–97; clamps never reveal outside-map void; no unexplained discontinuity; render-only calls do not advance camera.
- Required negative control: double-update camera per render, one-tick snap in smooth mode, overshoot target, wrong clamp after zoom, and axis-only jitter.
- Current evidence: `tests/e2e/browser-bridge.spec.ts` tests “advances smooth camera once…” and “honors cameraFollow false…”; camera profile in sequence matrix; `tests/unit/camera-projection.test.ts`.
- Missing automation/next implementation: add the explicit jitter/overshoot/clamp mutations and a real-time production camera strip.
- Independent visual-agent review mandatory: **yes**, at normal playback speed for perceived comfort.

### PRES-ZOOM-017 — framing is neither too close nor unreadably far

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Partial**.
- Scenario/precondition: opening scene, dense combat, largest actor/effect, building threshold, and phone portrait/landscape at declared default zoom.
- Production gesture: launch, move through the opening, approach threat/building, attack.
- Ordered artifacts: camera zoom timeline; visible world extents; focal actor/object device-space ink bounds; encounter occupancy; controls crop; full-resolution frames/video for every profile.
- Machine signal and threshold: zoom is finite, uniform, stable, invertible for input, clamped to map; focal occupancy/readability use accepted screen-contract baselines and opening-composition envelopes. Aesthetic distance has **calibration required** from independently accepted screenshots at actual device scale.
- Required negative control: zoom far in until focal crop/void, zoom far out until accepted subjects fall below calibrated ink/readability bounds, and apply zoom only to positions but not sizes.
- Current evidence: default uniform zoom and inverse projection in `tests/unit/camera-projection.test.ts`; opening occupancy/crop controls in `tests/framework/opening-composition.ts`; device profiles in screen tests.
- Missing automation/next implementation: no accepted min/max play-scale readability envelope or near/far paired mutations yet.
- Independent visual-agent review mandatory: **yes**; this row cannot become PASS from geometry alone.

### PRES-TILE-018 — no seams, checkerboards, incompatible material scale, or exposed topology

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Automatic** for current floor profiles.
- Scenario/precondition: deterministic maps showing long same-material joins and walkable/blocked boundaries, at every device profile and zoom.
- Production gesture: launch and traverse across cell boundaries while camera moves.
- Ordered artifacts: source material/atlas hashes; tile/edge manifest; full frames and seam sample coordinates; pixel metric JSON; motion strip across joins.
- Machine signal and threshold: current collision-boundary contrast, same-material seam, periodic seam salience, repeat, and exact tile-edge-contiguity thresholds remain those frozen in screen/environment tests.
- Required negative control: erase collision contrast, exaggerate seams, inject square grid, obvious repeated tile, and fractional zoom gap.
- Current evidence: `tests/e2e/screen-contract.spec.ts` lines 819–864; `tests/unit/environment-composition.test.ts`; `tests/unit/camera-projection.test.ts` test “keeps zoomed terrain cells edge-contiguous…”.
- Missing automation/next implementation: add moving-camera temporal seam detection at high DPR; current production pixel gates are largely still-frame based.
- Independent visual-agent review mandatory: **yes**, for texture coherence and whether visible topology feels authored.

### PRES-DEPTH-019 — correct Z-order, occlusion, and attachment

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Partial**.
- Scenario/precondition: actor passes in front of and behind each tall prop/building, actors overlap, projectile/effect crosses them, health UI follows owner.
- Production gesture: approach, circle, and cross each occluder; strike on both sides.
- Ordered artifacts: ordered draw calls with Z/layer and world/screen foot anchors; per-frame masks; overlap geometry; full frames/contact sheet; owner IDs for attached UI/effects.
- Machine signal and threshold: stable unique draw order; depth relation changes only at the declared ground/foot ordering boundary; attached UI/effects retain owner and calibrated offset; no duplicate owner body.
- Required negative control: swap actor/prop Z, render health behind owner, detach effect, duplicate actor draw, and let a rear actor cover a front actor.
- Current evidence: manifest records stable Z; health attachment checks in `tests/e2e/live-player-journey.spec.ts`; sequence attached-effect body-core checks; broad appearance criterion in `quality/screen-contract.v1.json`.
- Missing automation/next implementation: no general depth-transition oracle or paired Z mutations across scenery/actors/effects.
- Independent visual-agent review mandatory: **yes**, because artistically correct partial occlusion depends on silhouette.

### PRES-PROP-020 — buildings, props, objects, and complex scenery are visibly present

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Automatic** for opening role presence, **Partial** for overall richness.
- Scenario/precondition: opening, threshold, representative generated rooms, and every future city/interior visual state; seed matrix includes sparse and dense topology.
- Production gesture: launch and traverse until each declared environment role is visible.
- Ordered artifacts: seed/map; semantic scene-role inventory; sprite IDs/hashes; visibility/device projection and focal occupancy; full frames and scene contact sheet.
- Machine signal and threshold: required role count/identity, decoded sprite provenance, visible fraction, focal occupancy, and no adjacent-room leaks use scenario metadata and accepted composition contracts. “Complex/rich enough” has **calibration required**; do not equate object count with visual quality.
- Required negative control: remove each required role, substitute a wrong sprite, crop the focal building, delete all secondary props, and clone one prop repeatedly.
- Current evidence: opening role/occupancy mutations in `tests/unit/opening-composition.test.ts`; environment kit audits; four public screen PNGs.
- Missing automation/next implementation: define role/occupancy contracts for generated rooms and city/interiors, plus repetition/diversity evidence; current hard gate centers on the opening.
- Independent visual-agent review mandatory: **yes**, to judge complexity, coherence, and “not lame/empty.”

### PRES-STYLE-021 — one coherent art direction across all raster roles

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Missing** as an automatic gate.
- Scenario/precondition: contact sheet of every actor, monster, building, prop, ground, effect, loot, UI, selection scene, and future city/interior at runtime scale under the same background.
- Production gesture: traverse screens and trigger conditional effects so the inventory is complete.
- Ordered artifacts: exact asset hashes and provenance; normalized runtime-scale role sheet; full scene matrix; palette/value/edge-frequency/perspective feature report; independent notes by exact asset/frame.
- Machine signal and threshold: structural outlier metrics may rank palette, value range, edge density, light direction, perspective, and scale, but acceptance thresholds have **calibration required** from multiple independently accepted in-style assets plus deliberate foreign-style mutations. Metrics may triage; they may not self-approve style.
- Required negative control: inject one glossy cartoon actor, flat vector prop, wrong-perspective building, opposite-lit object, and foreign UI palette.
- Current evidence: appearance statements in `quality/screen-contract.v1.json` lines 74–95; hash-bound visual review; generated-art ingress explicitly retains visual veto.
- Missing automation/next implementation: build the normalized cross-role sheet and outlier report; bind each mutation to a named detector without replacing independent review.
- Independent visual-agent review mandatory: **yes**, always.

### PRES-DENSITY-022 — coherent density, hierarchy, and readable scene at play scale

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Partial**.
- Scenario/precondition: opening, combat, sparse/dense generated rooms, map threshold, and future city/interior on all device profiles.
- Production gesture: launch, move through each composition, enter combat, stop beside major structure.
- Ordered artifacts: role/occupancy map; saliency/contrast and overlap evidence; device-space actor/object bounds; ordered gameplay frames/video; accepted/rejected reference hashes.
- Machine signal and threshold: existing focal occupancy, crop, safe encounter, overlap, and HUD occlusion gates are prerequisites. Global density/hierarchy has **calibration required** from accepted scenes and deliberately empty, cluttered, repetitive, and low-contrast mutations.
- Required negative control: remove secondary scenery, fill frame with repeated props, hide player among same-value objects, overlap focal actors, and create large empty ground field.
- Current evidence: `tests/framework/opening-composition.ts` occupancy/crop limits; `tests/e2e/screen-contract.spec.ts`; current screen review explicitly identifies empty ground/under-staging in `quality/screen-review.v1.json`.
- Missing automation/next implementation: promote those qualitative rejection reasons into candidate-vs-reference measurements and negative controls; current geometry can pass a scene that still looks bad.
- Independent visual-agent review mandatory: **yes**, always.

### PRES-PROPORTION-023 — consistent actor/object scale and natural proportions

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Partial**.
- Scenario/precondition: all actors and primary environment roles on one ground line at runtime scale; repeat key actions/facings and live scene overlaps.
- Production gesture: approach each monster/prop and perform idle, walk, attack, hurt.
- Ordered artifacts: source/destination aspect; alpha ink bounds, ground anchors, actor radius/visible support; runtime comparison sheet; live frames.
- Machine signal and threshold: uniform transforms and existing role-specific height/aspect/anchor envelopes are exact prerequisites. Cross-role believability has **calibration required** from accepted production fixtures, not one global humanoid ratio.
- Required negative control: shrink one actor, enlarge one weapon/limb silhouette, change only one facing’s scale, and mismatch collider/support scale.
- Current evidence: actor candidate/presentation assessors; atlas facing/transition gates; `docs/quality-model.md` proportionality row; environment runtime-scale sheets.
- Missing automation/next implementation: one cross-role production comparison report covering every actor and environment role with accepted fixture ranges.
- Independent visual-agent review mandatory: **yes**, for anatomy and believable relative scale.

### PRES-FLICKER-024 — no frame flicker, stale pixels, double images, or transient disappearance

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P1**; current coverage **Missing** as a dedicated live-compositor gate.
- Scenario/precondition: ordinary live route during idle, movement, turn, attack/effect, camera movement, and asset/state transition at 60 Hz plus a high-refresh presentation sample.
- Production gesture: sustained movement and repeated attacks while crossing contrasting ground.
- Ordered artifacts: consecutive lossless frames at presentation cadence; manifests/draw signatures; isolated owner masks; canvas clear/backing geometry; video at normal and slowed speed.
- Machine signal and threshold: every expected-present entity has exactly one manifested draw; no unexplained absent sample; pixels outside the union of current draws must match the freshly rendered scene. Temporal difference/ghost thresholds have **calibration required** from accepted effects and camera motion.
- Required negative control: skip `clearRect`, draw actor twice with an offset, omit one presentation frame, and retain a prior effect after despawn.
- Current evidence: presence lifecycle and isolated mask synchronization in `scripts/assess-sequence.mjs`; live observer samples. There is no named compositor mutation suite.
- Missing automation/next implementation: implement current-frame reconstruction/residual comparison and the four mutations.
- Independent visual-agent review mandatory: **yes**, at normal playback speed.

## P2 — broadening and audit integrity

### PRES-CROSSDEVICE-025 — stable appearance across viewport, DPR, orientation, and browser crop

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P2**; current coverage **Partial**.
- Scenario/precondition: every public screen on the four declared profiles, DPR variants, safe-area variants, and one physical phone.
- Production gesture: perform the same launch/move/strike route on each profile and rotate mobile once.
- Ordered artifacts: environment metadata; CSS/backing/device projection; same semantic-state screenshots; ordered interaction frames; geometry/overlap reports; physical-device image.
- Machine signal and threshold: semantic state and visible-role inventory agree; each profile obeys its own frozen containment, coverage, and target thresholds; no aspect/DPR violation. Cross-browser pixel differences remain candidate evidence, not automatic style approval.
- Required negative control: landscape-only crop, DPR-1 backing on high-DPR, safe-area overlap, and orientation-specific hidden control.
- Current evidence: four profiles in `quality/screen-contract.v1.json`; screen/mobile/resolution suites.
- Missing automation/next implementation: safe-area and orientation mutations, physical-device artifact schema, and at least one non-Chromium geometry pass.
- Independent visual-agent review mandatory: **yes**, especially on the physical phone.

### PRES-REVIEW-026 — immutable visual-review veto and reproducible result

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P2**; current coverage **Automatic** for hash binding, **Partial** for this unified checklist.
- Scenario/precondition: complete candidate bundle from a clean or fully patched source state; reviewer did not implement the change.
- Production gesture: exact gesture tapes from applicable rows replayed against the candidate commit.
- Ordered artifacts: all standard artifacts; source commit/patch; artifact SHA-256; contract hash; reviewer identity/verdict/reasons tied to exact frame/profile; reproduction commands and detector-control results.
- Machine signal and threshold: candidate, contract, and review hashes match exactly; every applicable ID has one result; P0 complete; all required controls detected; mandatory reviewer verdict is `ACCEPT`. A matching `REJECT` remains failed even when mechanics pass.
- Required negative control: alter one reviewed PNG or contract byte, omit a checklist ID, and try to publish a rejected candidate as accepted.
- Current evidence: `docs/decisions/0017-hash-bound-screen-acceptance.md`; `docs/decisions/0009-visual-review-veto.md`; quality-index scripts and `quality/screen-review.v1.json`.
- Missing automation/next implementation: add this checklist’s ID/result schema to the public quality index and fail publishing on absent applicable IDs.
- Independent visual-agent review mandatory: **yes** by definition.

## P0 — complete journey and framework reproducibility

These rows were appended without renumbering the published presentation IDs. They remain P0 acceptance blockers even though their stable IDs follow the P2 audit rows in execution order.

### PRES-CITY-027 — real wilderness-to-city service journey

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: cold ordinary production route in the wilderness with no state injection; separately run a complete production-input route through every Embercross service on desktop, phone portrait, and phone landscape.
- Production gesture: discover the city sign/landmark, navigate to and enter the gate, approach each resident, open the merchant and buy/sell, open the tavern and eat/sleep, then open the healer and heal.
- Ordered artifacts: complete production journey state/manifest/frame timeline; gate and service-affordance frames; physical gesture log; service intent and before/after state deltas; mobile video at normal speed.
- Machine signal and threshold: the route landmark and gate are visible and reachable; entry completes through the production transition; every visible service control emits its declared intent; each affordable valid action changes exactly its documented state and feedback. No injected beside-NPC fixture may stand in for the discovery route.
- Required negative control: remove the city sign, disable gate entry, remove one service listener, and suppress one service outcome/feedback. The journey evaluator must fail each at the first missing affordance, transition, intent, or outcome.
- Current evidence: city unit/browser tests prove isolated layout and transactions; production-route tests prove only portions of the journey. No retained no-injection route currently proves the complete chain.
- Missing automation/next implementation: add one production mobile journey recorder that traverses from wilderness to every service and emits the required synchronized artifact bundle plus all four mutations.
- Independent visual-agent review mandatory: **yes**, for discoverability, transition quality, service readability, and mobile interaction feedback.

### PRES-STATE-028 — arbitrary-state load, reset, replay, and frame determinism

- Result: `[ ] PASS` `[ ] FAIL` `[ ] NEEDS VISUAL REVIEW`; priority **P0**; current coverage **Partial**.
- Scenario/precondition: representative named `ScenarioV1`, an exact serialized `GameState`, reset/reload isolation, and two clean replays of the same state plus command tape at the deterministic capture profile.
- Production gesture: load scenario; capture; load exact state; run a command tape and capture; reset; reload the identical state; replay the identical tape and capture again.
- Ordered artifacts: serialized initial state; load/reset records; per-tick semantic state hashes; render-manifest hashes; ordered lossless frame hashes; final states; environment and exact command.
- Machine signal and threshold: loaded state equals the canonical serialized input; reset leaves no entity, input, camera, animation, or presentation residue; same input produces identical per-tick state hashes; synchronized manifests and deterministic frames match at every declared capture tick.
- Required negative control: retain stale state after reset, perturb one replay state tick, perturb one deterministic frame, and shift one manifest/frame tick association. Each must fail its dedicated isolation, state-hash, frame-hash, or synchronization signal.
- Current evidence: `tests/e2e/browser-bridge.spec.ts`, `tests/unit/testkit.test.ts`, temporal scenario tests, and deterministic visual captures cover important parts separately.
- Missing automation/next implementation: one evaluator must bind those parts into two replay bundles and compare every state/manifest/frame tick rather than trusting independently green tests.
- Independent visual-agent review mandatory: **no** for exact deterministic equivalence; the relevant presentation rows still require review of whether matching frames look good.

## Result record template

Store one entry per applicable ID so a future self-testing agent can compare runs without interpreting prose:

Do not recreate this shape from prose. Copy the linked blank run template. Each row has `checkId`, `executionRecipeId`, `result`, `coverageAtRun`, structured `observed.scenarioIds`, `observed.deviceProfileIds`, and `observed.gestureIds`, `firstFailingTick`, structured evaluator `signals`, requirement-bound `artifacts`, ordered controls using `status`, `signal`, and `artifacts`, a review with `mandatory`, `verdict`, `reviewerId`, `reasons`, and row-bound `reviewedArtifactHashes`, plus the recipe's exact `reproduce` command. Commit belongs once in the run's top-level `environment`, not in each row.

The result record is evidence, not a replacement for the artifacts. A later framework extraction should keep this vocabulary and let each game adapter map its own classes, clip names, scene roles, selectors, and semantic events onto it.
