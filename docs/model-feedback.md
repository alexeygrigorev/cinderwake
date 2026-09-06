# Improving the game with model feedback

Run `npm run feedback:game` before and after a gameplay change. Open the printed
`report.html` and read `feedback.json` under `quality-results/game-feedback/`.
The command runs four checks in sequence so browser captures don't compete:

1. Unit regressions, including moving attack origins, attacks through walls,
   XP progression, route reachability, and corrupted saves.
2. Live desktop/phone controls and isolated combat for all three heroes.
3. Nine generated campaigns: three seeds for each hero, real movement and combat,
   road-sign discovery, city entry, and the ending. Each campaign must reproduce
   from its exact input tape and from a saved checkpoint.
4. Browser tests for contextual attacks, the journal, save/reload, export/import,
   audio playback, persistent mute, and pause behavior on a phone.

Missing reports, interrupted runs, changed source files, skipped browser tests,
and unfinished campaigns can't produce `PASS`. The automated pilot knows the
whole map: its completion time doesn't estimate how long a new player needs.
Inspect the images and play the game as well; these checks don't rate fun.

For a shorter check, run `npm run feedback`. It starts a local server and
Chromium, runs nine short cases, and prints paths to `feedback.md` and
`report.html` under a new `quality-results/feedback/run-*` directory. Install
Chromium with `npx playwright install chromium` if needed.

Give an implementation model the following task:

> Run `npm run feedback:game`. Read the resulting feedback.md and feedback.json.
> Open the contact sheets and full-size frames for the relevant cases. For a
> failure, inspect its timeline.json, initial-state.json, commands.json and
> console.json. Reproduce it, fix the cause, add a behavioral expectation or
> regression test that fails before the fix, and rerun. Report what the evidence
> proves and what still needs visual or gameplay review. Do not change thresholds
> or screenshot baselines just to make a failure disappear.

To investigate a campaign failure, read its `*-final-state.json` and blocker in
`campaign/results.json`. The report includes the selected target, remaining
route, nearby collision footprints, and a reproduction command. Run one seed
and hero with `npm run feedback:campaign -- --seeds last-bell --classes ranger`.
The campaign runner sends only movement, aim, attack, ability, and tonic inputs;
it must never teleport actors, inject kills, or grant test-only stats.

This workflow uses the model's existing image inspection tools; it does not
require another model API or credentials.

## What the default run proves

Each hero gets an isolated movement/combat case and two ordinary player journeys,
one on desktop and one on a portrait phone. The isolated case requires movement,
actual primary and ability damage, a kill, exit unlocking, physical loot pickup,
survival, and matching state hashes
when its retained initial state and input tape are replayed. The ordinary routes
select a hero, launch the game, move using physical keyboard or Chromium touch
events, and hold Strike through its cooldown. They require real time to advance,
movement to change position without attacking, and held Strike to repeat.

These are regression probes, not a rating of the game. An ineffective attack can
fail even when its animation looks correct. A passing run does not establish
combat balance, a complete playthrough, pleasing art, smooth animation, or
performance on a physical phone. Add cases for the behavior being changed.

The result has separate behavioral and visual verdicts. `PASS` means every
declared case and its checks completed. `FAIL` exits with code 1 and identifies
the case, expectation, actual value, and evidence path. Invalid command lines or
plans exit with code 2. Partial reports remain `INCOMPLETE`; they cannot approve
an interrupted run. Visual quality remains `NEEDS_VISUAL_REVIEW` even when all
numeric checks pass.

## Keep iterations small

Rerun a named subset:

```bash
npm run feedback -- --only ranger-combat,ranger-phone-controls
```

Each report contains an exact command using its `replay-plan.json`. That file
replaces controlled scenarios with their complete retained initial states, so
edits to a built-in scenario do not change the reproduction. Input ticks are
absolute: a patch at tick 12 is applied before advancing from tick 12 to 13 and
persists until another patch changes the field. Real-time input timings are
recorded separately in `gestures.json`; their checks tolerate scheduling
variation and do not promise identical state hashes.

The report records the Git commit, working-tree patch, hashes of untracked
files, browser/Node versions, and a source fingerprint. If source changes while
the run is in progress, the final result fails. Finish edits before collecting
evidence. `--output` requires a new directory and will not overwrite an old
report. `--base-url` can target an existing server, but its source identity is
explicitly unverified.

## Add a causal expectation

Start with [the small example plan](../quality/feedback-example.v1.json):

```bash
npm run feedback -- --plan quality/feedback-example.v1.json
```

A version 1 plan contains `cases`. A controlled case needs a unique `id`, either
`scenario` (built-in name or ScenarioV1 object) or `state` (complete GameState),
`commands`, increasing capture `ticks`, and nonempty `expect`. The first capture
must equal the initial state tick. Every command must execute before the final
capture. A plan allows up to 50 cases, 60 frames per case, and 36,000 ticks per
case.

Expectations read a dot-separated snapshot `path` and compare it with `value`.
Supported operators are `eq`, `gte`, `lte`, `deltaGte` (change from the first
capture, or an earlier captured `from` tick), and `eventCountGte` (requires `event`, optionally `sourceId`, and counts
new retained events from the initial tick, excluding initial history). Missing paths fail. An optional `at` selects a
captured tick; otherwise the check uses the final capture. A `hint` tells the next
model where to investigate. Use a damage, pickup, outcome, or displacement check
to establish the result of an action, rather than just checking that it started.

Live cases accept only `live: { classId, profile }` with `profile` equal to
`desktop` or `phone`, and run the defined physical-control journey. Controlled
expectations on live cases are rejected rather than silently ignored.

Each case retains synchronized canvas PNGs, a state/render timeline, browser
faults and a contact sheet. The `*-page.png` files also show the HUD. On the live
route, page screenshots are later presentation samples and are explicitly
marked as unsynchronized; use `*-canvas.png` for pixels tied to a recorded
state/manifest. Frames are ordered by the capture ticks or live journey stages.
Always open full-size images when assessing readability or detail.

Run `npm run test:feedback` to check the evaluator and its real-browser failure
path. Its injected controls demonstrate that an ineffective hit fails while
attack events still pass, a runtime error retains evidence, and a replay uses
the captured state. The existing `capture:sequence` command remains useful for
dense animation strips and now also writes its HTML/contact sheet before exiting
on an assessment failure.
