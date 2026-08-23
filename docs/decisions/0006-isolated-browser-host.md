# ADR 0006: Isolate the browser test host

## Status

Accepted on 2026-08-23.

## Context

A browser run originally reused a process already listening on a conventional preview port. The page was valid HTML but was not Cinderwake, which can produce misleading failures—or worse, false confidence when selectors happen to overlap.

## Decision

Playwright owns `127.0.0.1:43917`, starts Vite with `--strictPort`, and never reuses an existing server. The standalone sequence capturer chooses its own high loopback port, also uses `--strictPort`, and verifies that the returned document identifies Cinderwake before loading the test bridge.

## Why this supports the goal

Autonomous quality assessment is trustworthy only when the captured pixels and state come from the intended build. Host identity and process isolation are therefore test correctness requirements, not incidental configuration.
