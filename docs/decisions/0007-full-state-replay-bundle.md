# ADR 0007: retain full-state replay bundles

## Context

ScenarioV1 is ideal for small authored setups, but a discovered failure may occur after generated state, combat progression, or a particular presentation boundary. A scenario plus a screenshot does not always preserve enough information to reproduce it faithfully.

## Decision

Support exact `GameState` loading as well as ScenarioV1, and retain a bundle containing `initial-state.json`, `commands.json`, state hashes, manifests, frames/masks, capture profile, and environment metadata. `reset()` reconstructs the last retained source and clears input queues instead of modifying the current world.

## Alternatives considered

- Persist only a seed: compact, but cannot retain arbitrary injected or progressed state.
- Patch a live state: easy to expose, but stale timers, entities, and input make results untrustworthy.
- Store images only: preserves appearance but not controls or semantic cause.

## Consequences

Failures have a portable before-state and exact control history, advancing reproducible state/control/frame-sequence testing. Bundles take more storage and schema migrations must remain explicit, but the stored environment and hashes make incompatibility diagnosable.
