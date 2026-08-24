# 0021 — Publish hash-bound visual rejections

**Status:** accepted on 2026-08-24

## Problem

The screen report previously had only `accepted` and `candidate` states. When
an independent reviewer inspected the exact candidate pixels and rejected
them, the public gallery still said that the images merely awaited review.
That erased valuable failure evidence and understated the difference between
“not reviewed” and “reviewed and not good enough.”

New environment and actor reports also existed only as CI internals. The public
`/quality/` link had no generated index that stated which evidence passed,
failed, or remained rejected.

## Decision

The screen report recognizes three hash-bound states:

- `candidate` when no review matches the current contract and ordered image
  hashes;
- `accepted` when a matching independent `ACCEPT` exists; and
- `rejected` when a matching independent `REJECT` exists.

Changing one rule or pixel invalidates either verdict and returns the next set
to candidate. Machine checks may continue to pass under a visual rejection,
but cannot promote it.

CI builds a public quality index after every underlying report. It links the
responsive screen verdict, temporal replay matrix, complete actor audit,
environment-composition gate, generation provenance, candidate calibration,
and browser interaction report from the same commit. The index states
explicitly when no visual-completion claim is valid.

## Consequence

A failed art iteration becomes inspectable project knowledge instead of a
transient chat judgment. Reviewers can see that mechanics passed, which exact
pixels were rejected, and why. Future games can reuse the same state machine
without inheriting Cinderwake-specific art thresholds.
