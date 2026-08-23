# ADR 0004: animation quality is evaluated across frames

## Context

Single screenshots cannot reveal foot sliding, pose pops, incorrect cadence, or a camera that catches up one frame late. These are central to perceived action quality.

## Decision

Define animation state/phase in simulation, emit it in snapshots/manifests, and capture named consecutive-frame strips for locomotion, attacks, impacts, death, and camera motion. Combine measurable continuity/ordering checks with visual review.

## Alternatives considered

- Approve animations from a hero screenshot: misses temporal defects.
- Pixel-diff every frame as the sole gate: detects change but cannot distinguish intentional motion from a bad jump.
- Human-only playtesting: valuable but not repeatable from arbitrary states.

## Consequences

The suite catches regressions in timing and geometry while retaining human/agent judgment for naturalness. Tests and artifacts grow modestly, and each animation needs declared intended holds, transitions, and anchor behaviour.
