# ADR 0001: deterministic fixed-step simulation

## Context

The framework must start from arbitrary game states and reproduce behaviour, state, and frame sequences in browsers and CI. Real-time loops, ambient randomness, and rendering-driven updates make failures hard to reproduce.

## Decision

Use a pure, fixed 60 Hz simulation driven by seeded state and per-tick commands. Rendering is a read-only projection of state; snapshots serialize canonical state at checkpoints.

## Alternatives considered

- Variable `requestAnimationFrame` deltas: convenient for a demo, but produces timing-dependent tests.
- Record only browser input events: cannot reliably recreate scheduling or initial state.
- Server-authoritative simulation: adds infrastructure without improving local visual diagnosis.

## Consequences

Replay and state assertions are stable and arbitrary setup is practical. The cost is discipline: all nondeterministic sources, ordering, timers, and numeric serialization require explicit control, and real-time presentation must interpolate without changing simulation results.
