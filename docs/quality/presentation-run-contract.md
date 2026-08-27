# Executable presentation-run contract

The prose checklist remains the human explanation of what matters. The versioned [contract](../../quality/presentation-checklist.v1.json) makes its 28 `PRES-*` checks stable, and the ordered [recipe catalog](../../quality/presentation-recipes.v1.json) binds every row to required scenario, device-profile, gesture, evaluator-signal, mutation-signal, and reproduction-command sets. The adjacent [run template](../../quality/presentation-run.v1.template.json) is the exact record shape. It deliberately leaves every row `UNRUN`: valid for linting, never an accepted game-quality claim.

## Reproducing a run

1. Initialize the canonical template with a stable run ID. The command records the exact current commit, refuses to overwrite an existing run, and preserves all 28 rows as ordered `UNRUN` entries:

   ```sh
   npm run quality:presentation:init -- --run-id <run-id>
   ```

   By default it records the baseline reproduction chain (`check`, browser tests, screen report, temporal matrix, and quality report). Override that description only when the run has a different exact environment command:

   ```sh
   npm run quality:presentation:init -- --run-id <run-id> --reproduce "<one exact command>"
   ```

   This initializes a record; it does not execute a recipe, collect evidence, run a mutation, or perform visual review.

   The binder may later replace this exact blank initializer when its run ID and
   commit match. Once a run contains bound evidence, it is immutable; use a new
   run ID for another capture instead of overwriting it.

2. Run the executable P0 recorders and bind their fresh bundles into a row-level run:

   ```sh
   npm run art:animation:check
   npm run capture:matrix
   npm run quality:temporal:check
   npm run test:city-journey
   npm run test:state-replay
   npm run test:input-intents
   npm run test:directional-motion
   npm run test:directional-bank
   npm run test:production-liveness
   npm run test:sprite-provenance
   npm run test:mobile-screen
   npm run test:depth-transition
   npm run test:collision
   npm run test:crispness
   npm run test:camera-motion
   npm run quality:presentation:bind -- --run-id <run-id>
   ```

   When `<run-id>` is the blank initializer from step 1, binding fills that
   file in place. Binding an existing nonblank or stale run still fails safely.

   The 26-entry capture is resumable: use `npm run capture:matrix -- --resume`
   after an interrupted run, or `npm run capture:matrix -- --only <id,...>` to
   recover named entries. The matrix only reuses a passing entry when its
   retained artifacts and source metadata match the exact current source state.

   The binder refuses dirty or stale recorder metadata, hashes every referenced
   artifact, copies the canonical signals and detected mutations, records
   `PRES-STATE-028` as a machine `PASS`, and records `PRES-LIVE-001`,
   `PRES-CITY-027`, `PRES-INPUT-002`, `PRES-MOBILE-010`, `PRES-MOVE-003`, `PRES-FACING-015`, and `PRES-SPRITE-004`
   as `NEEDS_VISUAL_REVIEW` because their ordered frames, videos, strips, and
   overviews still need independent review. The mobile row binds its two phone
   profiles, five causal gestures/signals, safe-area and text metrics, and nine
   detected mutations. It also records `PRES-MOTION-005`
   as `NEEDS_VISUAL_REVIEW` after binding the 26-entry temporal catalog, its
   per-tick manifests/contact sheets, six ordinary-route actor strips, six
   PNG-level production-compositor controls, and six machine signals.
   `PRES-DEPTH-019` is also bound as
   `NEEDS_VISUAL_REVIEW` after the depth recorder captures desktop and
   phone-portrait transitions, z-ordered manifests, attached-owner records,
   and seven named detector controls. Its output remains under `quality-results/`; it does not
   claim that the other checklist rows ran or that the live/city/input/mobile/movement/
   atlas/temporal/depth/collision evidence was visually accepted. `PRES-COLLIDE-008`
   binds three-profile generated and Embercross solid inventories,
   exhaustive semantic cardinal-contact journeys, representative lossless
   contact frames, explicit topology skips including the validated
   `map-blocked-boundary` opening exemptions, swept projectile evidence,
   alpha-support measurements, compact contact-manifest projections, and five
   named detector controls as `NEEDS_VISUAL_REVIEW`.
   `PRES-CRISP-006` binds the
   ordinary production launch plus deterministic idle/walk captures at desktop
   DPR 1 and portrait DPR 3, twelve physical-canvas player/terrain crops, the
   policy-derived backing geometry, and its two detected resolution/sharpness
   controls as `NEEDS_VISUAL_REVIEW`. Its emulated device matrix remains partial
   until native high-DPR capture and independent original-resolution review are
   supplied.

   `PRES-CAMERA-016` binds the desktop and portrait production camera bundle with
   separate smooth edge/reversal, west/south edge, diagonal/corner, stop, fixed,
   and snap run specs,
   synchronized target/camera timelines, and the five named detector controls. It
   remains `NEEDS_VISUAL_REVIEW` until its contact sheets and videos receive the
   required independent playback review.

   `PRES-FACING-015` binds desktop and phone-portrait directional-bank evidence
   for all three actors and four cardinal directions. Its synchronized movement,
   opposite-turn, target-directed primary/ability impact, and lock-release
   recovery captures prove exact bank/reflection mapping, action origins, and
   recovery continuity, while six named mutations remain detected. The row
   remains `NEEDS_VISUAL_REVIEW` because authored weapon offsets, native high-DPR
   capture, and independent pose review are still open.

   `PRES-SPRITE-009` binds the visible-sprite provenance recorder across desktop
   and phone-portrait selection, production launch, Test Lab, terminal, and
   Embercross service states. Its visible DOM/text/title, pseudo-element,
   CSS-decoration, canvas-operation, manifest-draw, decoded-asset, state, and
   original-resolution frame artifacts are hash-bound to the row, and all three
   declared negative controls must be detected. It remains
   `NEEDS_VISUAL_REVIEW`; the recipe is intentionally partial until new or
   conditional screens are added to the required scenario matrix.

3. Replace every placeholder and run the exact ordered matrix in the row's `executionRecipeId`. Copy the recipe's required IDs into the three `observed` arrays only after they were actually observed.
4. For each claimed artifact, record its repository-relative path, lowercase SHA-256, and `requirement` ID. A `PASS` has every shared and check-specific requirement.
5. Record evaluator signals as structured `actual` and `contract` values, and copy the recipe's exact per-row reproduction command. A partial, missing, or calibration-required recipe cannot become `PASS`.
6. Mark a negative control `DETECTED` only when its exact recipe `expectedSignal` and at least one hash-bound artifact are retained.
7. For mandatory review rows, record a stable `reviewerId`, nonempty reasons, `ACCEPT`, and SHA-256 values drawn only from that row's claimed artifacts. `REJECT`, `UNCERTAIN`, and `NOT_RUN` cannot be promoted to `PASS`.

Inspect the ordered run at any point without changing it:

```sh
npm run quality:presentation:progress -- --run quality-results/presentation-runs/<run-id>.json
```

Progress uses the existing lint validator and prints every row, priority, recorded status, and acceptance blockers. It exits nonzero for a malformed record, but an honestly incomplete `UNRUN` record remains inspectable. It does not execute missing work or turn a machine result into visual acceptance.

Use these two commands:

```sh
npm run quality:presentation:lint
npm run quality:presentation:accept -- --run quality-results/presentation-runs/<run-id>.json
```

`lint` checks the exact contract ↔ recipe ↔ run order and permits the blank `UNRUN` template, so it never implies that Cinderwake passed. `accept` additionally requires the canonical contract/catalog paths, a lowercase 40-hex commit, complete observed matrices and signals, exact reproduction commands, and every claimed artifact to exist inside the repository and match its SHA-256 bytes. Any malformed evidence, missing/reordered ID, unrun row, non-`PASS` result, incomplete P0 row, missing detected control, or incomplete mandatory review exits nonzero.

The validator proves binding and byte integrity, not whether a PNG looks good. The named evaluator and independent visual review retain that responsibility.
