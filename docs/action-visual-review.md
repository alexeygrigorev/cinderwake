# Automatic checks and visual action review

Each new game action needs two kinds of evidence. Deterministic checks establish
what happened: input direction, displacement, timing, state changes, collision,
frame selection, asset decoding, and output signal. A visual reviewer inspects
what the player actually sees when those checks cannot establish readability or
meaning. A renderer can rotate an arrow according to the correct velocity while
its painted arrowhead still points sideways. State metadata alone misses that.

The reusable runner is `scripts/action-visual-review.mjs`. Its contract is
`quality/action-review.v1.json`; the core has no RPG-specific action names or
direction assumptions. The Cinderwake adapter reads the existing directional-bank
recorder. Other games supply their own action catalog and ordered captures.

## Adding or changing an action

1. Register the action's actors, device profiles, directions, ordered stages and
   precise visual checks. Directions may be cardinal directions, left/right,
   clockwise/counterclockwise or `none`, according to the game. Describe what
   visible evidence constitutes success and failure. Do not write “looks good”.
2. Add automatic checks for measurable invariants and a negative control that
   deliberately violates the invariant. For a projectile, check the emitted
   origin, direction, movement, collision and rotation relative to the painted
   source tip. For a puzzle, check the moved piece, destination, score and undo.
   Keep failed automatic checks blocking; a visual opinion cannot override them.
   Separate the simulation collision origin from the painted launch socket.
   In an overhead game the simulation may use feet on the ground plane while
   the visible projectile must leave a raised bow or hand. Bind that presentation
   offset to the launch direction, not the player's later facing. Test the
   release point across directions and zoom levels; Cinderwake's regression is
   `tests/unit/projectile-release-socket.test.ts`.
3. Record a reproducible sequence from real simulation/rendering, including the
   input, expected result, ordered ticks, original PNGs and automatic report.
   Capture before/anticipation, release/impact, and recovery. Small or fast effects
   need consecutive flight frames and closeups as well as gameplay context.
   Never substitute an enlarged standalone asset for the rendered action.
4. Build the review bundle. It checks coverage, order, image hashes, automatic
   results and source freshness before producing `bundle.json` and
   `reviewer-prompt.md`. New or changed runtime code or assets require recapture.
5. Give that exact prompt to a separate `gpt-5.6-luna` agent with image tools.
   The reviewer opens every referenced PNG, checks every listed criterion and
   returns `review.json`. Use a fresh agent so implementation explanations do
   not substitute for evidence. Keep its tool transcript with the run when
   available. The reviewer must not implement fixes in its review task.
6. Validate the result. Fix each `FAIL`; for `UNCERTAIN`, obtain clearer or denser
   evidence. Re-record and repeat review after changing runtime or art. A missing
   image, case, check, observation or supporting frame reference blocks acceptance.

The directional and flicker recorders copy runtime sources, public assets and
artwork metadata into a temporary capture workspace before starting the browser.
This prevents parallel edits from reloading a scene halfway through a recording.
The capture fingerprint belongs to that frozen workspace. Acceptance still
compares it with the working game's current files: isolation keeps a recording
coherent, and freshness checks prevent an older recording from approving new code.

`scripts/test-action-visual-review.mjs` reads the actual TypeScript
`AnimationClip` union and boolean `InputState` actions. Adding a runtime animation
or input action without a registry entry fails the project check. When adapting
the framework, connect this completeness assertion to that game's authoritative
action registry; do not maintain an unrelated duplicate list. Non-animation
interfaces such as saving, onboarding and settings also need their appropriate
browser journeys and presentation checks.

## Run the Ranger example

```sh
node scripts/test-directional-bank.mjs --profiles desktop
node scripts/action-visual-review.mjs build --actors ranger --actions attack,ability --profiles desktop
```

Use the recorder's `--output quality-results/directional-bank/round-name` and
the bundle builder's matching `--directional-bank` option to preserve an earlier
round while a reviewer is still inspecting it. Never overwrite evidence under
an active review.

The result is eight cases: primary and ability in four directions. Each case has
ordered windup, impact and recovery images, intended direction, input, emitted
objects and explicit heading/origin/readability checks. The preferred reviewer
is stored in the registry, not inferred by whoever runs the task.

The recorder also captures release+1, +2, +3, +5 and +8 simulation ticks in
`additionalFrames`. PNGs preserve native canvas backing pixels. Each retained
frame has an unscaled crop enclosing the player and visible projectiles/effects;
the crop stays tied to its complete scene and tick. The reviewer merges the
main and additional frames by tick and inspects every scene and crop. Crops help
resolve arrowheads without losing the bow, actor or surrounding context.

Dispatch the contents of `quality-results/action-review/ranger/reviewer-prompt.md`
through the available agent tool with `model: "gpt-5.6-luna"`,
`reasoning_effort: "high"` and a fresh context (`fork_turns: "none"`). Tell it
the workspace path so the listed project-relative images resolve. Save its JSON
result as `quality-results/action-review/ranger/review.json`, then run:

```sh
node scripts/action-visual-review.mjs validate
```

The generated prompt explicitly requires inspecting images with a visual tool,
identifying the painted tip independently of metadata, comparing adjacent
frames, judging every check separately, and returning uncertainty when evidence
is insufficient. It gives the exact response structure and frame paths. An
`inspectedFrames` list is the reviewer's attestation; software cannot establish
that a model actually looked at pixels from that claim alone. Preserve tool
execution evidence rather than treating a valid JSON shape as proof of judgment.

These commands report **scoped** acceptance. They do not certify unrecorded
actions, devices or actors. The directional-bank adapter currently supplies
primary and ability sequences. To require the entire registered matrix, use
`build --full --captures your-complete-captures.json`; absent idle, walk, hurt,
death, tonic or other registered cases fail instead of disappearing from scope.
An old registry or review also fails after any new action is added.

## Generic capture format

Pass `--registry your-game.json --captures captures.json` to use another game or
recorder. The capture file contains `sourceFingerprint` from
`runtimeFingerprint(projectRoot, registry.sourceRoots)` at capture start and a
`captures` array. Each capture has:

```json
{
  "id": "actor/action/direction/profile",
  "expectation": "Describe the input and visible result without claiming a pass.",
  "automatic": {
    "pass": true,
    "evidence": "quality-results/run/automatic.json"
  },
  "frames": [
    {
      "stage": "before",
      "tick": 0,
      "file": "quality-results/run/before.png",
      "sha256": "SHA-256 of the actual PNG bytes"
    },
    {
      "stage": "after",
      "tick": 1,
      "file": "quality-results/run/after.png",
      "sha256": "SHA-256 of the actual PNG bytes"
    }
  ]
}
```

Stages must exactly match the action's registry entry and ticks must increase.
Optional `additionalFrames` use the same image structure with increasing ticks.
Optional `closeups` add `sourceFrame`, naming their same-tick full-scene image.
Every additional image is hash-checked and must appear in `inspectedFrames`;
reviewers can cite it as evidence for an individual criterion.
The adapter is responsible for evaluating its automatic report honestly; the
generic runner binds that report by hash and requires its declared pass. Bundle
and review validation detect stale runtime/assets, edited PNGs or reports,
reordered stages, omitted checks and foreign frame references. These hashes
detect stale or altered evidence; they are not authentication.

Use small scoped bundles to keep each visual task legible and affordable. For a
large matrix, partition by actor/action/device and validate every required
partition. A full acceptance process must account for the complete matrix.

## Other reusable acceptance rules

The same split applies beyond animation. An audio test should measure actual
output after the master gain, verify decoded assets and start/resume from the
first real user gesture. A counter saying that `start()` was called does not
prove audible sound. Test running context, nonzero output, intended music or
ambience during idle play, zero output while muted, persistence of preferences
and recovery from zero volume on desktop and touch. Listen separately for mood,
clarity, unpleasant repetition and whether cues convey the right meaning.

Saving needs a fresh-page restoration journey, storage-failure feedback and
portable recovery as described in [game-saving.md](game-saving.md). Interface
tests should measure readable text, accessible control names, tap target bounds,
occlusion and layout; a reviewer should identify the primary next action and
recognize scene objects without implementation hints. Automatic checks and
specific visual tasks complement each other across game genres.

Run `node --test scripts/test-action-visual-review.mjs` to exercise the framework's
negative controls, and `node scripts/action-visual-review.mjs lint` to validate
the action contract.
