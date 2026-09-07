# Player experience repair: 7 September 2026

The user's feedback is preserved as requirements in
[player-experience-contract.md](player-experience-contract.md), the precise
[action review workflow](action-visual-review.md), and the repository's
`AGENTS.md`. These requirements apply to new game adapters, not just RPGs.

## Changes

- Readable native interface text, a clear Start game button, visible selected
  hero, movement/attack instructions, and usable desktop/touch controls.
- ElevenLabs background music, early audio activation on the first gesture,
  visible sound controls, and persisted preferences with silence recovery.
- Clean structure silhouettes and recognizable upright iron fences at blocked
  boundaries. Generation prompts and source/output provenance remain in
  `art/generation/`.
- Ranger arrows rotate according to their painted metal point, are not
  reflected twice, and leave the authored bow/hand instead of the feet.
  Two detached pieces baked into a north-facing actor frame were also removed;
  exactly 56 atlas pixels changed and every other actor/bow pixel was preserved.
- Clear browser/device save location, checkpoint times, visible storage
  failures, portable export/import, and immediate victory recovery. Cloud sync
  is not implemented. See [game-saving.md](game-saving.md).

## Evidence and limits

The final unit run passed 546 tests. The action-review framework passed 19
tests, including missing cases, stale source/images, conflicting JSON keys,
uninspected frames, failed checks and uncertain verdicts. The selected audio,
save, campaign, combat-control and native-copy browser suite passed 32 tests;
the interface/screen/selection suite passed 23 cases across retries.

Luna accepted all 16 opening interface images. Subsequent captures after the
Ranger fixes reproduced every accepted PNG byte-for-byte. The current-source
equivalence receipt is
`quality-results/ui-final-source-equivalence/equivalence-receipt.json`; the
original review remains unchanged in `quality-results/ui-final-review/`.

Four separate Luna reviews accepted eight desktop Ranger firing cases:
primary/ability in north, east, south and west. All 128 original scene and native
crop images, the automatic comparison, exact prompts, individual reviews and
their mechanically merged result are committed as a reproducible example.
The aggregate records its source partitions; no observations were rewritten.

```sh
node scripts/action-visual-review.mjs validate
```

This is scoped firing evidence on the recorded scene, not certification of all
168 registered actor/action/direction/device combinations, every impact against
an enemy, or the whole presentation checklist. Missing combinations remain
missing rather than becoming implicit passes.

Formatting, lint, build, sprite provenance, compositor, crispness, live
desktop/touch flicker, animation and generation checks passed separately.
The combined `npm run check` was interrupted by SIGTERM, so it is not recorded
as a successful single end-to-end command. Later direct runs completed the
affected relevant checks, including the unit suite and live flicker recorder.
Audio checks prove decoded assets and actual nonzero output after master gain;
they do not constitute a subjective listening review.

## Reuse

Register each game's own actions and measurable invariants. Record affected
actors/devices/directions, build small ordered-frame bundles, and dispatch each
generated prompt to a separate visual agent. Keep automatic and visual results
independent. Fix FAIL results; obtain clearer evidence for UNCERTAIN results;
recapture after changing runtime or artwork. Never approve by copying an old
verdict or merely updating a screenshot baseline.
