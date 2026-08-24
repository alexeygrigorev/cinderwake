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

2. Replace every placeholder and run the exact ordered matrix in the row's `executionRecipeId`. Copy the recipe's required IDs into the three `observed` arrays only after they were actually observed.
3. For each claimed artifact, record its repository-relative path, lowercase SHA-256, and `requirement` ID. A `PASS` has every shared and check-specific requirement.
4. Record evaluator signals as structured `actual` and `contract` values, and copy the recipe's exact per-row reproduction command. A partial, missing, or calibration-required recipe cannot become `PASS`.
5. Mark a negative control `DETECTED` only when its exact recipe `expectedSignal` and at least one hash-bound artifact are retained.
6. For mandatory review rows, record a stable `reviewerId`, nonempty reasons, `ACCEPT`, and SHA-256 values drawn only from that row's claimed artifacts. `REJECT`, `UNCERTAIN`, and `NOT_RUN` cannot be promoted to `PASS`.

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
