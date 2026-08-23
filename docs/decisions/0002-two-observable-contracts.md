# ADR 0002: two observable contracts

## Context

A correct state snapshot can hide a clipped weapon, wrong pivot, or camera jerk. A screenshot can look wrong without explaining whether AI, collision, animation, or drawing caused it.

## Decision

Expose two complementary contracts: canonical simulation snapshots and renderer manifests/screenshots/frame strips. Tests may assert either or correlate both at the same tick.

## Alternatives considered

- Screenshot-only visual testing: catches appearance but is brittle and poorly diagnosable.
- State-only unit testing: fast but cannot validate pixels, layering, or animation feel.
- Exposing internal renderer objects directly: couples tests to implementation rather than a stable observable contract.

## Consequences

Failures are explainable and both behaviour and visual quality can be evaluated. This adds an artifact format and baseline maintenance burden; manifests must be stable, concise, and free of incidental implementation details.
