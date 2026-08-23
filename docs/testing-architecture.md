# Testing architecture

Cinderwake treats deterministic simulation and observable rendering as first-class product features. Tests can begin from a JSON state, issue a precise command tape, then assess state and pixels without relying on a human playthrough.

## Simulation contract

Simulation is a deterministic fixed-step transition kernel at **60 Hz**. `stepGame(world, input)` mutates only the fresh world object it owns; it does not read the DOM, wall-clock time, browser layout, or ambient randomness. Tests construct or clone that owned world before stepping it. Time is integral ticks; positions, velocities, timers, random choices, AI decisions, collision order, and animation phases derive only from declared state and seeded rules. Rendering reads state but never changes it. Floating-point work, if used, is rounded/canonicalized at observable boundaries; iteration order is stable.

`ScenarioV1` is the JSON injection format. It declares schema version, seed, tick, map bounds/exit, player archetype and state, entities, drops, camera, optional rules overrides, and capture instructions. Validation rejects unknown schema versions and malformed or impossible state before it reaches the simulation. This permits tests such as “brute already winding up beside a one-health player” without replaying ten minutes of combat.

Every meaningful boundary exposes a canonical state snapshot: tick, outcome, entity IDs and transforms, velocities, health, cooldowns, AI/animation state and phase, inventory, camera, active effects, and deterministic RNG state. Snapshots use stable ordering and serialized numeric precision so deep comparison, replay, and debugging agree.

## Commands and replay

A command tape is an ordered list of per-tick input samples—movement axes, aim, attack, dash, interact, and optional control-edge metadata. It is replayable from a `ScenarioV1` with no live keyboard dependence. A failing test stores the scenario, tape, expected snapshot/checkpoint, seed, and implementation version; rerunning them must reproduce the same frame sequence locally and in CI.

## Browser and render contracts

The browser bridge is a deliberately narrow test API that can load a scenario, advance an exact number of ticks, submit a tape, read canonical snapshots, and request captures. Browser-driven tests use it for simulation assertions while still exercising the real renderer.

The renderer emits a **render manifest** alongside each capture. It records logical viewport, device scale, camera transform, ordered draw calls/layers, geometry identity, world/screen/foot anchors, destination bounds, facing, scale, opacity, tint, animation clip and frame, visibility, and stable Z order. A future sprite-sheet renderer can extend the same contract with source rectangles. The manifest explains a pixel regression in ways an image diff cannot; it contains no nondeterministic timestamps or object iteration order.

Captures include single screenshots and multi-frame strips (adjacent frames at named ticks, with tick labels/metadata). Strips make sub-frame-looking jumps, camera lag, foot sliding, and attack timing inspectable. Screenshots and manifests are output from the same tick/state.

## Artifact layout

The sequence capture command writes:

```text
test-results/sequences/<scenario-id>/
  frame-0000.png
  closeup-0000.png
  states.json
  render-manifest-timeline.json
  animation-analysis.json
  contact-sheet.png
  report.html
  metadata.json
playwright-report/
```

The metadata includes the exact reproduction command. GitHub Actions retains failure evidence and publishes successful Playwright plus walking/attack sequence reports beside the game. These artifacts are the handoff between automated assertions and agent/human review: an evaluator can identify the exact injected state, reproduced commands, game state, and drawing decisions behind any image.

## Three complementary verdicts

1. **Semantic state:** canonical snapshots, typed events, and hashes prove behavior and replay equality.
2. **Semantic rendering:** manifests prove animation timing, anchor/bounds continuity, ordering, and camera geometry without guessing from pixels.
3. **Appearance over time:** screenshot baselines catch composition regressions, while contact sheets expose rhythm, pops, foot sliding, and camera lurch that a single image hides.

None replaces the others. A pixel-perfect frame could still represent the wrong health or attack tick; a correct manifest could still draw an unattractive silhouette; and a pleasing strip could hide nondeterministic state.

## Determinism constraints

Do not use wall-clock time, `Math.random()`, browser layout measurements as simulation inputs, asynchronous asset completion order, locale-dependent formatting, or unordered collections at contract boundaries. Asset readiness is awaited before capture; viewport, DPR, fonts, browser version, and image encoding are pinned in visual CI. UI event handlers translate browser events to commands, but only tick advancement consumes them.
