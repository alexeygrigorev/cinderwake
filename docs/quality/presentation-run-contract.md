# Executable presentation-run contract

The prose checklist remains the human explanation of what matters. The versioned [contract](../../quality/presentation-checklist.v1.json) makes its 26 `PRES-*` checks stable enough for a self-testing agent to execute without reinterpreting prior feedback. The adjacent [run template](../../quality/presentation-run.v1.template.json) deliberately records all rows as `UNRUN`; it is valid for linting but is never an accepted game-quality claim.

## Reproducing a run

1. Copy the template into a retained run directory, for example `quality-results/presentation-runs/<run-id>.json`.
2. Replace every placeholder and run the exact scenarios, physical gestures, captures, and detector-specific mutations named by the contract and the prose checklist.
3. For each claimed artifact, record its repository-relative path, lowercase SHA-256, and `requirement` ID. A `PASS` has every shared and check-specific requirement.
4. Mark a negative control `DETECTED` only when its expected evaluator signal and at least one hash-bound artifact are retained.
5. For mandatory review rows, record `ACCEPT` and the SHA-256 values of the exact reviewed artifacts. `REJECT`, `UNCERTAIN`, and `NOT_RUN` cannot be promoted to `PASS`.

Use these two commands:

```sh
npm run quality:presentation:lint
npm run quality:presentation:accept -- --run quality-results/presentation-runs/<run-id>.json
```

`lint` checks structure and permits the blank `UNRUN` template, so it never implies that Cinderwake passed. `accept` is a release gate: any malformed evidence, missing/reordered ID, unrun row, non-`PASS` result, incomplete P0 row, missing detected control, or mandatory review without hash-bound `ACCEPT` exits nonzero.

The validator intentionally checks paths and hashes, not whether a PNG looks good. The named evaluator and independent visual review in each checklist row retain that responsibility.
