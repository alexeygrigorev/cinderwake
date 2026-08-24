# ADR 0032: Gate the city journey and arbitrary-state replay explicitly

Date: 2026-08-24

## Status

Accepted

## Context

The 26-row presentation contract described the reported visual and interaction failures, but an independent coverage audit found two paths that were only implicit:

1. No row required one production-input journey from the wilderness landmark through Embercross's gate and every merchant, tavern, and healer action.
2. No row tested the framework boundary that loads an arbitrary scenario or exact state, resets it without residue, replays the same command tape, and proves synchronized state, manifest, and frame determinism.

Generic liveness, scenery, mobile, motion, and review rows cannot substitute for these paths. A release could satisfy their individual samples while the complete city journey or reusable state adapter was broken.

## Decision

Append two stable P0 rows without renumbering the published checks:

- `PRES-CITY-027` requires the no-injection production journey, all service intents and outcomes, desktop/mobile evidence, and mutations for missing discovery, inert entry, inert controls, and suppressed outcomes.
- `PRES-STATE-028` requires scenario and exact-state loading, reset isolation, identical replay hashes for state/manifests/frames, and mutations for stale state, nondeterministic replay, and evidence desynchronization.

Both rows receive canonical recipes and blank run entries. The validator now requires all 28 IDs in exact order, so older or partial run records cannot silently omit the added gates.

## Consequences

- Future self-testing agents have an explicit checkbox and evidence schema for every reported defect plus the core reusable test-framework promise.
- Both new rows begin as `partial`; they block acceptance until their complete matrices, evaluators, and negative controls are implemented and retained.
- The city row requires independent visual review because discoverability and service feedback are presentation judgments. Exact state replay equivalence is machine-authoritative, while the presentation rows still review whether the deterministic frames look good.
- The checklist remains reusable: a future game maps its hub/service journey and state adapter to the same two contracts.
