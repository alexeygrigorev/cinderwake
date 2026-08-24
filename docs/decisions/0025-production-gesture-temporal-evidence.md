# 0025 — Capture temporal evidence through production input adapters

**Status:** accepted on 2026-08-24

## Problem

Exact-step scenario captures prove deterministic simulation, renderer output,
and temporal continuity, but their queued command tapes intentionally bypass
the browser input adapters. A disconnected launch button, keyboard listener,
touch route, joystick pointer stream, or Strike button could therefore fail in
the shipped route while deterministic captures remained reproducible.

Separate liveness assertions were not sufficient evidence for the reported
failure class. We need to bind an ordered frame sequence to the causal input
and resulting observer state so “nothing happened” and “a ground tap attacked”
cannot hide behind a later healthy screenshot.

## Decision

Retain a production-route Playwright journey for desktop and mobile. It enters
through character selection without `?testMode=1`, confirms that the mutating
`__GAME_TEST__` bridge is absent, and reads only the cloned
`__GAME_OBSERVE__` boundary. It sends real browser inputs:

- desktop keyboard movement, canvas mouse attack, and the Strike button;
- mobile touchscreen ground routing, a Chromium touch stream across the
  joystick, and the mobile Strike button.

Each case attaches ordered canvas PNG frames plus JSON snapshots and
presentation ticks. Movement must change player position without adding a
player `attack_started` event. Strike must add that event without routing or
moving the player. Simulation ticks and captured pixels must advance.

## Consequence

The physical journey complements rather than replaces exact command-tape
captures. It is less byte-deterministic because the ordinary route uses wall
clock and `requestAnimationFrame`, so it asserts causal postconditions and
ordered change rather than exact tick hashes. The deterministic matrix remains
the reproduction oracle; the production journey proves that real controls can
reach it and that visible frames accompany the state change.
