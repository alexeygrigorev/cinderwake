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

The renderer emits a **render manifest** alongside each capture. It records logical viewport, device scale, camera transform, ordered draw calls/layers, atlas/sprite identity, source rectangle, world/screen/foot anchors, destination bounds, facing, scale, opacity, tint, animation clip and frame, visibility, and stable Z order. It explains a pixel regression in ways an image diff cannot; it contains no nondeterministic timestamps or object iteration order. The corresponding [art pipeline](art-pipeline.md) requires atlas decoding/validation before capture readiness.

Captures include single screenshots and multi-frame strips (adjacent frames at named ticks, with tick labels/metadata). The capturer also draws each tracked entity alone to a transparent canvas and records actual alpha-pixel ink bounds, centroid, bottom offset, count, and hash. This is pixel evidence for proportions, anchor adherence, and clipping; it is deliberately stronger than inferring those facts from a semantic rectangle. Screenshots, masks, and manifests are output from the same tick/state.

Interactive rendering interpolates `previousPosition → position` and `previousCamera → camera`; this is presentation only. The manifest reports `simTick`, fractional `presentationTick`, `interpolationAlpha`, current camera, camera target, and camera mode. Capture/test mode requests alpha 1 and a deterministic snap camera by default. Smooth camera updates use a fixed per-tick rule, never elapsed wall time, and a fixed camera is available for isolated geometry tests.

## Artifact layout

The sequence capture command writes:

```text
test-results/sequences/<scenario-id>/
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

The metadata includes the exact reproduction command plus commit, Node, Chromium, Playwright, Vite, package version, browser viewport/DPR, logical canvas, and mobile setting. A dirty local capture also bundles source status and a patch. `capture:matrix` runs 21 named profiles sequentially, writes a machine-readable catalog, and fails if any member fails. GitHub Actions retains failure evidence and publishes successful Playwright and temporal reports beside the game. These artifacts are the handoff between automated assertions and agent/human review: an evaluator can identify the exact injected state, reproduced commands, game state, drawing decisions, and execution environment behind any image.

## Three complementary verdicts

1. **Semantic state:** canonical snapshots, typed events, and hashes prove behavior and replay equality.
2. **Semantic rendering:** manifests prove animation timing, anchor/bounds continuity, ordering, and camera geometry without guessing from pixels.
3. **Appearance over time:** screenshot baselines catch composition regressions, while contact sheets expose rhythm, pops, foot sliding, and camera lurch that a single image hides.

None replaces the others. A pixel-perfect frame could still represent the wrong health or attack tick; a correct manifest could still draw an unattractive silhouette; and a pleasing strip could hide nondeterministic state.

## Determinism constraints

Do not use wall-clock time, `Math.random()`, browser layout measurements as simulation inputs, asynchronous asset completion order, locale-dependent formatting, or unordered collections at contract boundaries. Asset readiness is awaited before capture; viewport, DPR, fonts, browser version, and image encoding are pinned in visual CI. UI event handlers translate browser events to commands, but only tick advancement consumes them.
