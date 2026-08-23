# Development log

This is the chronological record of material build decisions. Focused ADRs contain deeper trade-off analysis; this log explains how each step contributes to an autonomously assessable game.

## 2026-08-23

1. Initialized an empty workspace as a `main`-branch Git repository. This makes each coherent decision reviewable and publishable instead of leaving one opaque final dump.
2. Selected Vite, strict TypeScript, Canvas, Vitest, and Playwright. Vite keeps the browser host small; strict types stabilize JSON contracts; Canvas exposes exact render control; Vitest runs the simulation without a browser; Playwright checks the real input and pixels.
3. Pinned dependency versions and generated a lockfile. Reproducible tools and Chromium are necessary for meaningful screenshot baselines.
4. Generated original Cinderwake three-hero key art with the built-in image generator and stored it locally under `public/assets`. It gives character selection a coherent identity without introducing a network dependency or copying an existing franchise.
5. Chose code-rendered runtime actors for the first slice. Explicit shapes make every frame, pivot, hitbox, bound, and foot anchor inspectable; generated raster animation can replace them later under the same manifest contract.
6. Delegated independent game-design, engine-architecture, test-architecture, documentation/CI, browser-rendering, and test-harness passes. Bounded ownership parallelizes work without allowing agents to overwrite the same files.
7. Fixed simulation at 60 Hz and 1,024 integer units per tile. Exact tick advancement removes wall-clock flakiness; integer positions prevent long-run drift.
8. Split random state by domain and made loot entity-keyed. Cosmetic changes cannot perturb gameplay, and killing enemies in a different order cannot silently change a particular enemy's drop.
9. Implemented complete ScenarioV1 construction instead of live-state patching. Arbitrary setups remain possible while reset semantics stay reliable.
10. Added a connected seeded room-and-corridor generator with a digest. Generated-world behavior can be fuzzed across seeds and reproduced from one short value.
11. Added three player archetypes and three enemies with melee, ranged, area, projectile, health, armor, death, loot, pickup, exit, win, and loss state. This is the smallest system mix that exercises both behavior and temporal rendering.
12. Defined two observable contracts: canonical state and semantic render manifest. Pixels show appearance; manifests explain geometry and timing when appearance changes.
13. Defined exact-tick PNG sequence capture and a self-contained report. An agent or human can review motion as a strip while automated checks measure anchors, bounds, speed, frame order, and camera movement.
14. Added a browser Test Lab for scenario loading, manual stepping, JSON export, and sequence preview. The same observability used in CI is available during ordinary development.
15. Added Prettier, ESLint, strict TypeScript, and a combined source-quality command. Authored code remains readable, and the production build now disables minification and emits source maps so the public artifact is inspectable rather than only the repository source.
16. Isolated browser tests on a dedicated strict port with server reuse disabled. An earlier run had silently attached to an unrelated process on Vite's default preview port; identity and isolation now form part of the harness contract.
17. Added real keyboard and pointer adapter coverage alongside semantic bridge tests. This proves that deterministic input injection and the controls a player actually uses reach the same simulation boundary.
18. Added reviewed screenshot baselines for selection, walking, combat impact, loot, and mid-action injection. The first visual review found an overlapping selection title and stale run-log data; both were corrected before preserving the baseline.
19. Added close-up sequence reports with a visible foot-anchor crosshair and machine-readable measurements. They retain exact full frames, state history, manifest history, metadata, and a reproduction command instead of reducing temporal evidence to one screenshot.
20. Visual review found a one-frame seam where the attack clip could wrap to its opening pose before returning to idle. One-shot frames now clamp at the terminal frame, and weapon recovery converges to the idle pose; a test fixes the terminal attack frame and subsequent idle frame in the contract.
21. Added public GitHub Pages assembly. CI rebuilds the readable game, executes source/unit/browser/visual gates, captures walking and attack reports, and publishes the game, browser report, and temporal evidence from the same commit.

Future entries should record any baseline update, tolerance change, schema migration, or intentional animation change. Those decisions directly alter what the quality system accepts and therefore must never be silent.
