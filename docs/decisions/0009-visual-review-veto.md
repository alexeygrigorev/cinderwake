# ADR 0009: visual review can veto passing metrics

## Context

The first complete temporal matrix passed every semantic, raster, and lifecycle check, yet an independent frame-sheet review found that the loss modal hid the death animation, two melee attacks lacked readable weight, and projectile coverage stopped before impact. No generic numeric score could safely infer all three judgments.

## Decision

Require both machine acceptance and an explicit visual verdict before publishing changed temporal evidence. A reviewer may reject a green matrix with a concrete frame/tick explanation. Every accepted rejection must then become a named scenario, a measurable invariant, or both; the original visual judgment remains documented instead of being disguised as a retroactive threshold choice.

## Alternatives considered

- Let green checks publish automatically: reproducible, but demonstrated to approve unreadable presentation.
- Use visual review without measurements: catches gestalt, but is difficult to reproduce and easy to apply inconsistently.
- Raise generic pixel-difference sensitivity: detects change rather than quality and cannot distinguish an intentional effect from a hidden animation.

## Consequences

Publication takes one additional review pass when temporal presentation changes. In return, subjective findings produce durable assets: death-modal timing has an exact browser assertion, one-shots require five distinct raster poses, projectile impact has a presence lifecycle, and the retained sheets still let future reviewers judge whether those measurements create a convincing result.
