# ADR 0005: Keep source and production output readable

## Status

Accepted on 2026-08-23.

## Decision

All authored TypeScript, JavaScript, CSS, HTML, JSON, and Markdown is formatted by Prettier and checked by ESLint where applicable. Vite's production minifier is disabled and production source maps are emitted. The lockfile pins the resolved dependency graph, while CI runs formatting, linting, strict type/build checks, and tests before publication.

## Why this supports the goal

The framework exists to make failures explainable and reducible without constant supervision. A compact but opaque bundle would make the public artifact materially harder to inspect when a frame, state transition, or browser-only behavior fails. Readable output lets an evaluator connect deployed behavior to the authored simulation and render contracts without reconstructing minified control flow.

## Consequences

The deployed bundle is larger than a minified game bundle. That is acceptable for this testing reference and small vertical slice. If download performance later matters, compression can be enabled at the transport layer without minifying the inspectable source artifact.
