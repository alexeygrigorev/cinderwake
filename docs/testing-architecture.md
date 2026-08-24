# Testing architecture

Cinderwake treats deterministic simulation and observable rendering as first-class product features. Tests can begin from a JSON state, issue a precise command tape, then assess state and pixels without relying on a human playthrough.

## Simulation contract

Simulation is a deterministic fixed-step transition kernel at **60 Hz**. `stepGame(world, input)` mutates only the fresh world object it owns; it does not read the DOM, wall-clock time, browser layout, or ambient randomness. Tests construct or clone that owned world before stepping it. Time is integral ticks; positions, velocities, timers, random choices, AI decisions, collision order, and animation phases derive only from declared state and seeded rules. Rendering reads state but never changes it. Floating-point work, if used, is rounded/canonicalized at observable boundaries; iteration order is stable.

`ScenarioV1` is the declarative JSON injection format. Validation rejects unknown schema versions and malformed or impossible state before construction. For an exact captured world, the bridge also accepts a complete serialized `GameState` through `loadState`; it reconstructs the state rather than applying a partial patch. `reset()` retains the last successfully loaded ScenarioV1 or GameState and reconstructs it afresh, clearing both live and queued inputs. This makes an arbitrary state, its reset, and its failure reproduction the same contract.

Every meaningful boundary exposes a canonical state snapshot: tick, outcome, entity IDs and transforms, velocities, health, cooldowns, AI/animation state and phase, inventory, active effects, and deterministic RNG state. Camera is presentation state and is therefore recorded in the synchronized render manifest instead of `GameState`. Snapshots use stable ordering and serialized numeric precision so deep comparison, replay, and debugging agree.

## Commands and replay

A command tape is an ordered list of per-tick input samples—movement axes, aim, attack, ability, and tonic edges. It is replayable from a ScenarioV1 or persisted initial GameState with no live keyboard dependence. A failing test stores `initial-state.json`, `commands.json`, checkpoints/state hashes, seed, capture profile, and environment metadata; rerunning the recorded command must reproduce the same state and frame sequence locally and in CI.

## Browser and render contracts

The browser bridge is a deliberately narrow test API that can load a scenario, advance an exact number of ticks, submit a tape, read canonical snapshots, and request captures. Browser-driven tests use it for simulation assertions while still exercising the real renderer.

The ordinary public route additionally installs an **observe-only player boundary**. It returns cloned state, manifests, pixels, and a bounded history of real `requestAnimationFrame` presentation samples, but exposes no load, input, step, reset, pause, or clock control. The live-player journey enters through character selection, waits wall-clock time, sends physical touch, and reads only this observer. It therefore detects a frozen production loop, a launch button that never enters play, or an input adapter disconnected from simulation even when every exact-step fixture still passes.

The renderer emits a **render manifest** alongside each capture. It records logical viewport, device scale, camera transform, ordered draw calls/layers, atlas/sprite identity, source rectangle, world/screen/foot anchors, destination bounds, facing, scale, opacity, tint, animation clip and frame, visibility, and stable Z order. Solid scenery additionally records its world collision shape, center, dimensions, and solid/passable mode. Monster world-UI records the owning entity, health ratio, destination, and current frame's measured alpha-ink top, so a floating health bar is diagnosable as geometry rather than a vague screenshot complaint. Simulation and rendering derive scenery placements from the same pure `DungeonMap` layout, so a browser test can join real input, actor position, visible object ID, and collision footprint without making gameplay depend on the renderer. The manifest explains a pixel regression in ways an image diff cannot; it contains no nondeterministic timestamps or object iteration order. The corresponding [art pipeline](art-pipeline.md) requires atlas decoding/validation before capture readiness.

Manifest visibility is necessary but not sufficient on responsive devices. A portrait viewport cover-fits and horizontally crops the 16:9 canvas. Screen-contract tests therefore project logical destination rectangles through the canvas's actual CSS bounding box, subtract the physical mobile-control region, and require the opening encounter to remain wholly inside that device-space safe area. This prevents an offscreen enemy from passing merely because its logical 960 × 540 rectangle was marked visible.

Collision checks use deliberate tunneling inputs as negative controls. A
projectile is advanced far enough to cross an entire solid object within one
tick; the replay must retain the earliest swept contact, remove the projectile,
prevent damage behind cover, and render the state-backed impact. This proves
that shared solid-world behavior holds between sampled endpoints rather than
only at ordinary gameplay speeds.

Captures include single screenshots and multi-frame strips (adjacent frames at named ticks, with tick labels/metadata). The capturer also draws each tracked entity alone to a transparent canvas and records actual alpha-pixel ink bounds, centroid, bottom offset, count, and hash. This is pixel evidence for proportions, anchor adherence, and clipping; it is deliberately stronger than inferring those facts from a semantic rectangle. Screenshots, masks, and manifests are output from the same tick/state.

Interactive rendering interpolates `previousPosition → position` and `previousCamera → camera`; this is presentation only. The manifest reports `simTick`, fractional `presentationTick`, `interpolationAlpha`, current camera, camera target, and camera mode. Capture/test mode requests alpha 1 and a deterministic snap camera by default. Smooth camera updates use a fixed per-tick rule, never elapsed wall time, and a fixed camera is available for isolated geometry tests.

## Artifact layout

The sequence capture command writes:

```text
quality-results/sequences/<scenario-id>/
  frame-0000.png
  closeup-0000.png
  mask-0000.png
  page-0000.png
  initial-state.json
  commands.json
  states.json
  render-manifest-timeline.json
  animation-analysis.json
  contact-sheet.png
  report.html
  metadata.json # commit, reproduction command, viewport/DPR and tool environment
playwright-report/
```

The metadata includes the exact reproduction command plus commit, Node, Chromium, Playwright, Vite, package version, browser viewport/DPR, logical canvas, and mobile setting. A dirty local capture also bundles source status and a patch. Temporal artifacts deliberately live outside Playwright's disposable `test-results/` root, so the order of browser and sequence verification cannot destroy evidence. `capture:matrix` runs 23 named profiles sequentially, writes a machine-readable catalog, and fails if any member fails. GitHub Actions retains failure evidence and publishes successful Playwright and temporal reports beside the game. These artifacts are the handoff between automated assertions and agent/human review: an evaluator can identify the exact injected state, reproduced commands, game state, drawing decisions, and execution environment behind any image.

The public quality index is generated only after the component reports exist
and links them from one commit. Screen evidence has three explicit states:
candidate, hash-matched accepted, and hash-matched rejected. A matching visual
rejection remains public even when geometry, input, and pixel-risk checks pass;
changing either the contract or ordered screenshot hash invalidates the verdict
and returns the next set to candidate.

## Three complementary verdicts

1. **Semantic state:** canonical snapshots, typed events, and hashes prove behavior and replay equality.
2. **Semantic rendering:** manifests prove animation timing, anchor/bounds continuity, ordering, and camera geometry without guessing from pixels.
3. **Appearance over time:** screenshot baselines catch composition regressions, while contact sheets expose rhythm, pops, foot sliding, and camera lurch that a single image hides.

None replaces the others. A pixel-perfect frame could still represent the wrong health or attack tick; a correct manifest could still draw an unattractive silhouette; and a pleasing strip could hide nondeterministic state.

## Determinism constraints

Do not use wall-clock time, `Math.random()`, browser layout measurements as simulation inputs, asynchronous asset completion order, locale-dependent formatting, or unordered collections at contract boundaries. Asset readiness is awaited before capture; viewport, DPR, fonts, browser version, and image encoding are pinned in visual CI. UI event handlers translate browser events to commands, but only tick advancement consumes them.
