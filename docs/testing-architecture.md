# Testing architecture

Cinderwake treats deterministic simulation and observable rendering as first-class product features. Tests can begin from a JSON state, issue a precise command tape, then assess state and pixels without relying on a human playthrough.

## Simulation contract

Simulation is a pure fixed-step function at **60 Hz**: `nextState(previousState, command, rules) -> state`. Time is integral ticks; positions, velocities, timers, random choices, AI decisions, collision order, and animation phases derive only from declared state and seeded rules. Rendering reads state but never changes it. Floating-point work, if used, must be rounded/canonicalized at observable boundaries; iteration order must be stable.

`ScenarioV1` is the JSON injection format. It declares schema version, seed, tick, map bounds/exit, player archetype and state, entities, drops, camera, optional rules overrides, and capture instructions. Validation rejects unknown schema versions and malformed or impossible state before it reaches the simulation. This permits tests such as “brute already winding up beside a one-health player” without replaying ten minutes of combat.

Every meaningful boundary exposes a canonical state snapshot: tick, outcome, entity IDs and transforms, velocities, health, cooldowns, AI/animation state and phase, inventory, camera, active effects, and deterministic RNG state. Snapshots use stable ordering and serialized numeric precision so deep comparison, replay, and debugging agree.

## Commands and replay

A command tape is an ordered list of per-tick input samples—movement axes, aim, attack, dash, interact, and optional control-edge metadata. It is replayable from a `ScenarioV1` with no live keyboard dependence. A failing test stores the scenario, tape, expected snapshot/checkpoint, seed, and implementation version; rerunning them must reproduce the same frame sequence locally and in CI.

## Browser and render contracts

The browser bridge is a deliberately narrow test API that can load a scenario, advance an exact number of ticks, submit a tape, read canonical snapshots, and request captures. Browser-driven tests use it for simulation assertions while still exercising the real renderer.

The renderer emits a **render manifest** alongside each capture. It records logical viewport, device scale, camera transform, ordered draw calls/layers, sprite source and destination rectangles, anchors, flips, opacity, tint, animation frame, clipping information, and UI regions. The manifest explains a pixel regression in ways an image diff cannot; it must not contain nondeterministic timestamps or object iteration order.

Captures include single screenshots and multi-frame strips (adjacent frames at named ticks, with tick labels/metadata). Strips make sub-frame-looking jumps, camera lag, foot sliding, and attack timing inspectable. Screenshots and manifests are output from the same tick/state.

## Artifact layout

Suggested test output is:

```text
test-results/<test-id>/
  scenario.json
  commands.json
  snapshots/<tick>.json
  renders/<tick>.png
  renders/<tick>.manifest.json
  strips/<name>.png
  metadata.json
playwright-report/
```

Artifacts are retained on failure (and optionally for approved visual baselines). They are the handoff between automated assertions and agent/human review: an evaluator can identify the exact injected state, reproduced commands, game state, and drawing decisions behind any image.

## Determinism constraints

Do not use wall-clock time, `Math.random()`, browser layout measurements as simulation inputs, asynchronous asset completion order, locale-dependent formatting, or unordered collections at contract boundaries. Asset readiness is awaited before capture; viewport, DPR, fonts, browser version, and image encoding are pinned in visual CI. UI event handlers translate browser events to commands, but only tick advancement consumes them.
