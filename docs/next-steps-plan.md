# Next steps: an executable plan for bounded implementation agents

Status: T12 automated gate passed; T13 play review remains. Evidence: `quality-results/game-feedback/t12-final/`. Baseline: `a44734b` (2026-09-06).
Audience: a coordinator and agents such as Luna Max. Give an agent **one task card**, not this entire backlog as an implementation assignment.

## Outcome and scope

Make the existing first chapter worth replaying before expanding it. The next playable milestone should teach a visible attack, let the player evade it, reward a punish window, and explain the resulting reward. Its feedback must distinguish an actual gameplay defect from incomplete or invalid evidence.

These are proposed product decisions, not findings that the game is already fun. The first batch preserves the three heroes, existing map/city, mission sequence, saves, and input scheme. No inventory grid, new class, second chapter, procedural quest engine, multiplayer, dependency upgrade, new model API, or paid audio generation.

Success requires both behavioral evidence and a recorded play review. A green automated report cannot substitute for the latter.

## Current facts and where to look

Paths below are relative to the repository root. Files proposed by task cards are explicitly marked **new**.

| Observed fact                                                                                                                                                                           | Evidence / starting point                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The last combined run passed 463 unit tests, nine control cases, nine campaign cases, and 22 browser tests with unchanged source. Counts describe this baseline, not permanent targets. | `quality-results/game-feedback/run-RD6iAI/feedback.json`; this ignored local artifact may not exist in another checkout—rerun the command there. |
| The aggregate currently relies partly on summary flags and counts; it does not establish exact required browser test identities.                                                        | `scripts/lib/game-feedback.mjs:componentReportValid`                                                                                             |
| The campaign pilot knows the full map and uses semantic simulation inputs. It is not a first-time human or a complete physical-browser playthrough.                                     | `scripts/test-campaign-journey.mjs`; `docs/model-feedback.md`                                                                                    |
| Elite Stonekin have boosted stats but use the same short Stonekin attack scheduling path.                                                                                               | `src/testkit/scenarios.ts:createMonster`, `src/game/simulation.ts:updateMonsters`                                                                |
| A pending attack already stores committed origin, direction, impact tick, range, damage, and kind. Enemy impact resolution already checks a living owner.                               | `src/game/types.ts:PendingAttack`; `src/game/simulation.ts:resolvePendingAttacks`                                                                |
| Weapon drops immediately add power; they are not equippable items.                                                                                                                      | `src/game/simulation.ts:collectLoot`                                                                                                             |
| Entering the city removes wilderness entities. Victory comes from returning to the south gate.                                                                                          | `src/game/simulation.ts:enterEmbercross`, `sealRiftAtCityGate`; `src/game/missions.ts`                                                           |
| Saves use envelope version 1 containing GameState schema 2; imported states are validated.                                                                                              | `src/app/saveGame.ts`; `src/testkit/stateSnapshots.ts`                                                                                           |
| Logical-canvas visibility and physical-device visibility are different. The observer is read-only, but still privileged: it exposes full state/navigation.                              | `src/testkit/playerObserver.ts`                                                                                                                  |
| Native journal copy is a narrow presentation exception, not permission for arbitrary unregistered graphics/text.                                                                        | `tests/e2e/ui-text-contract.spec.ts`; `scripts/test-visible-sprite-provenance.mjs`                                                               |

Inference: improve the oracle before adding a more demanding encounter, so agents cannot “fix” difficulty by silently weakening checks.

## Coordinator protocol

1. Run T00. Record the current commit, baseline evidence, and unrelated dirty paths. The plan-only turn did not run a new gameplay baseline; T00 is mandatory.
2. Dispatch only the next unblocked card. Default to serial execution.
3. Allow parallel work only on disjoint listed paths. Never run competing browser gates or commit/edit during a source-fingerprinted capture.
4. Require the agent's red/green evidence and complete diff. A reviewer checks that the test would detect the original failure.
5. Merge/commit a coherent change, then dispatch the next card. Do not hand off a half-integrated behavior behind unexplained test failures.
6. Run milestone gates after T03, T09, and T12. T13 is a separate acceptance decision.
7. Mark cards with `NOT_STARTED / IN_PROGRESS / REVIEW / ACCEPTED / BLOCKED` in a coordinator-owned work log. Record commit IDs and evidence paths, not just “done.”

## Coordinator work log

- T12 — `REVIEW` / `PLAY_REVIEW_PENDING`: implemented in `9e45c34`, hardened through `9806916`, and integrated into the aggregate evidence contract in `a1b06cb`. The committed gate passed in `run-o2kNCf` with distinct desktop and portrait-phone cases, eight ordered checkpoints per profile, real browser input, observe-only state access, save/reload, and victory assertions. Final milestone evidence is retained at `quality-results/game-feedback/t12-final/`; independent human play review remains T13.
- Post-T12 verification — the current source passes the complete `npm run check` gate, including 57 Vitest files / 501 tests. Two source-stable aggregate retries (`run-oc4s4B` and `run-eJ5VUz`) passed desktop but the phone journey exceeded its fixed 300-second physical budget under the loaded shared host; those failures remain retained and are not relabeled. `run-o2kNCf` remains the last accepted aggregate evidence; T13 human play review is still pending.

A task is too large if it needs a new persistent schema, changes an unlisted subsystem, or cannot reach its stated gate without redesign. Stop and return a split proposal; do not improvise the architecture.

### Every agent must obey

- Read `AGENTS.md`, this protocol, its card, and only the card's prerequisite contracts.
- Inspect `git status --short` and the named code before editing. Other agents/user changes are not yours.
- Add a causal test first. Preserve the failing output before fixing behavior.
- For a new feature that initially fails to compile, compilation failure is not sufficient red evidence. Add the smallest compiling stub, observe the behavioral failure, then implement it.
- Do not loosen assertions, shorten gameplay tapes, remove seeds/classes, add blanket retries, turn off AI, grant health, or update screenshots to manufacture a pass.
- Fixed-state injection is allowed in a labeled isolated regression. It is forbidden in a production-journey run.
- Keep deterministic game decisions in simulation state. No wall-clock timers, random calls, DOM reads, or audio state in combat rules.
- Do not edit a secret file, print API keys, push, deploy, or regenerate paid assets.
- Before committing: inspect the complete diff and status, stage explicit owned paths, and use an imperative subject. Separate behavior, tests, docs, and reviewed image evidence when independently reviewable.
- Stop after the assigned card. “Also cleaned up” is not part of the assignment.

### Failure handling

| Observation                                   | Required response                                                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expected damage/movement/reward is absent     | Retain exact state/input evidence; reproduce the smallest case; fix the underlying behavior.                                                                               |
| A pilot gets stuck                            | Inspect its target, remaining route and collision evidence. Distinguish pilot-policy failure from unreachable world geometry.                                              |
| Browser never becomes ready                   | Inspect page errors and failed requests first. Preserve trace. A single separately recorded rerun is allowed for evidenced transport failure, not as automatic acceptance. |
| Screenshot differs                            | Inspect expected, actual, and diff at full size. Explain every changed region. Only a reviewer/coordinator may accept a new baseline.                                      |
| Source changed during capture                 | Keep the invalid run; freeze source and rerun. Never relabel it PASS.                                                                                                      |
| Broad baseline already fails                  | Record it before editing. Coordinator decides whether to fix first or explicitly quarantine as unrelated; an agent may not silently ignore it.                             |
| Two attempted fixes fail the same causal test | Return evidence, attempted changes, and the smallest unresolved question. Do not launch a broad rewrite.                                                                   |

## Task order

`T00 → T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13`

T10 and T11 could run independently after T09, but serial execution is the default. Everything beyond T13 is a separate planning phase.

## T00 — Establish the current baseline

**Owner:** coordinator or one read-only verification agent.
**Scope:** no game/source changes; coordinator work log and ignored evidence only.

Read `docs/model-feedback.md`, `package.json`, and the existing combined runner. Run:

```bash
git status --short
git rev-parse HEAD
npm run feedback:game
```

Record all component verdicts, source identity, current discovered test IDs, and output paths. Inspect at least one desktop and one phone full-size gameplay frame. If the prior retained report is missing, do not reconstruct it from this document.

**Done:** a current baseline exists; unrelated failures/dirty files are explicitly identified. No promise that old counts are still current.

## T01 — Reject wrong or incomplete component evidence

**Own:** `scripts/lib/game-feedback.mjs`, `scripts/game-feedback.mjs`, `scripts/test-game-feedback.mjs`; **new** `scripts/lib/game-feedback-contract.mjs`.

Replace count-only acceptance with a declared manifest of required case identities. Browser identities use project + repository-relative file + title path, not line numbers. Discover the selected test list with Playwright's list mode, and bind that list to the same source run. Normalize path separators.

Controls must contain every declared case exactly once, nonempty passing checks, no failures, and consistent completion flags. Campaign evidence must contain exactly the declared seed/class pairs, wins, and successful `replayMatched`, `snapshotMatched`, and `saveResumeMatched` values with empty `validationErrors`. Browser evidence must account for every discovered required test, no skipped/failed/flaky required results and no top-level errors. Rules must contain nonempty results consistent with their summary.

Keep the current commands and test sets. Additional valid tests are allowed only when declared/discovered for this run. Do not replace “22” with a different magic number.

**Red controls:** duplicate one case while preserving counts; omit one required browser test and substitute an unrelated pass; forge success over a failed nested check; remove replay evidence; inject a skipped/flaky result; supply summary-only JSON. Each must fail.

**Check:** `node --test scripts/test-game-feedback.mjs`.
**Done:** genuine baseline reports pass; every forged fixture fails for a specific reason. Commit behavior and coverage separately where practical.

## T02 — Produce a compact first-failure handoff

**Depends:** T01.
**Own:** `scripts/game-feedback.mjs`, `scripts/lib/game-feedback.mjs`, `scripts/test-game-feedback.mjs`; **new** `scripts/lib/game-feedback-diagnostics.mjs`.

Add an additive `issues` array to aggregate JSON. Each issue contains:
`component, caseId, category, code, expected, actual, evidencePaths, reproduceCommand`.
Use null when information is unavailable; never fabricate a cause or working reproduction command.

Categories: `behavior`, `evidence`, `runtime`, `transport`, `unknown`. These are diagnostic labels, not PASS exemptions. A failed request can support “transport”; a timeout alone cannot.

Generate `next-action.md`: verdict, completion/source status, first failing case, expected/actual, up to five useful relative evidence links, exact reproduction command when available, and missing evidence. Cap the summary at 120 lines; keep raw artifacts intact. It is an evidence handoff, not a generated patch recommendation.

**Red controls:** runtime exception, missing artifact, mismatched source, malformed report, HTML-special characters in error text, and a timeout without network evidence. Verify safe HTML escaping and that every emitted local link resolves. Escape shell arguments in any generated command; no execution of report content.

**Check:** `node --test scripts/test-game-feedback.mjs`.
**Done:** a small agent can find the failing case without reading a huge browser JSON file; unknown causes remain unknown.

## T03 — Add a real-process failure drill

**Depends:** T02.
**Dispatch as two cards:** T03a extracts the runner; T03b adds process tests. Do not assign both at once.

**T03a owns:** `scripts/game-feedback.mjs`; **new** `scripts/lib/run-game-feedback.mjs`. Extract orchestration into an exported function accepting component definitions, output directory and source-identity provider. Production CLI always supplies the production manifest; no environment/CLI bypass of required tests. Preserve exit, timeout, signal, cleanup and incremental-report behavior. The test module can inject isolated component definitions without editing production sources.

**T03b owns:** `scripts/test-game-feedback.mjs`; **new** `scripts/test-game-feedback-integration.mjs`; `package.json` only to include this test in `test:feedback`.

Exercise a minimal actual browser subprocess, using existing `scripts/test-feedback.mjs` patterns. Cover one valid run, intentionally ineffective attack, thrown runtime error, missing output, and interrupted child. Run perturbations in isolated fixtures/processes, never by rewriting production files.

Assert exit status, partial-report availability, failure category, synchronized retained state/frame references where a capture exists, and no false PASS after interruption. Startup failure need not fabricate a screenshot that was never captured. Test that the runner closes its own server/child process; never kill an unrelated process using a shared port.

**Check T03a:** `node --test scripts/test-game-feedback.mjs`, then one unchanged `npm run feedback:game`. **Check T03b:** `node --test scripts/test-game-feedback-integration.mjs`, then `npm run test:feedback`.
**Milestone gate:** `npm run feedback:game`.
**Done:** the feedback system itself has executable negative controls, not merely JSON-parser tests.

## T04 — Specify a Bell Keeper attack profile without changing gameplay

**Depends:** T03.
**Own:** **new** `src/game/monsterAttackProfile.ts`, **new** `tests/unit/monster-attack-profile.test.ts`.

Export a pure profile function taking a MonsterState and returning:
`pattern, windupTicks, recoveryTicks, cooldownTicks, range, damage`.
Patterns are `cone`, `projectile`, and `radial-slam`.

Proposed first-playtest constants for `kind === "stonekin" && elite`:

- radial slam, 48-tick windup, 24-tick recovery;
- 132-tick cooldown, or 96 ticks when health is at most half maximum;
- radius `2 * UNITS_PER_TILE`;
- damage `monster.attackDamage`, without an extra multiplier.

All other monsters reproduce current timing/range/damage exactly. Do not increase boss health or spawn counts. The profile is not integrated in this card.

Use `PendingAttack.kind === "ability"` to identify newly queued elite slams later; retain `primary` interpretation for existing saved attacks. No GameState/save schema change.

**Check:** `npx vitest run tests/unit/monster-attack-profile.test.ts`.
**Done:** boundary tests at just above/at half health and all ordinary kinds pass. These numbers are a starting hypothesis, not approved balance.

## T05 — Implement committed, dodgeable slams and recovery

**Depends:** T04.
**Own:** `src/game/simulation.ts`, `src/game/monsterAttackProfile.ts`; **new** `tests/unit/bell-keeper-combat.test.ts`.

Integrate the profile at attack scheduling and impact resolution. For an elite Stonekin slam: queue a monster-owned `ability` attack with a fixed origin, radius, impact tick and damage. Lock normal boss movement/new attacks through impact + recovery. The warning origin must not chase the player. Use the profile range consistently for attack eligibility. Any physical displacement from monster separation must not change the committed damage geometry.

At impact, damage the player at most once if the player center is within the stored radius and line of sight is clear. Keep the existing damage/armor/invulnerability rules. A dead owner cancels impact. Incoming player hits still deal damage but must not replace the elite's committed attack/recovery lock with the shorter hurt lock; death still cancels it. Cooldown is chosen when scheduling and is not shortened retroactively by crossing half health.

Use existing serialized animation/pending-attack fields; no hidden module-level boss phase. Do not let the shared fixed-duration animation helper accidentally end a 72-tick attack lock after the old 26-tick duration.

**Red tests:** no damage one tick early; damage at impact inside radius; no damage outside; solid wall blocks; owner death cancels; no normal AI movement/new attack during recovery, including after a player hit; separation displacement does not move the damage origin; attacks resume afterward; damage occurs only once; ordinary monsters unchanged.

**Check:** `npx vitest run tests/unit/bell-keeper-combat.test.ts tests/unit/combat.test.ts tests/unit/combat-feel.test.ts`.
**Done:** fixtures prove the damage contract and an actual escape using normal movement. Do not tune stats to hide an undodgeable attack.

## T06 — Prove old saves and mid-slam replay remain valid

**Depends:** T05.
**Own:** `tests/unit/save-game.test.ts`, `tests/unit/state-replay.test.ts`; **new** `tests/fixtures/saves/pre-bell-keeper-profile.v1.json`. Change `src/testkit/stateSnapshots.ts` only if the new valid pending attack is currently rejected.

Capture a legitimate save from baseline `a44734b` through a non-destructive read-only extraction or temporary worktree. Do not rewrite a live checkpoint or synthesize a checksum by bypassing the codec.

Test loading the old save, including an already pending elite `primary` attack: it stays an old-style primary, not a retroactive slam. Test exact same-version continuation after save during windup, at the impact boundary and during recovery. Pausing must not advance combat ticks.

Compatibility promise: old saves load with preserved player/journal data and valid pending actions. Future behavior after an upgrade can change; do **not** promise old-version and new-version tapes end identically.

**Check:** `npx vitest run tests/unit/save-game.test.ts tests/unit/state-replay.test.ts tests/unit/bell-keeper-combat.test.ts`.
**Done:** new save envelope remains version 1/GameState 2, old saves are accepted, same-version replay matches exactly. A required schema redesign blocks this card and returns to the coordinator.

## T07 — Add evidence-backed warning geometry

**Depends:** T06.
**Own:** **new** `src/render/combatTelegraphs.ts`, `src/render/manifest.ts`, `src/render/CanvasRenderer.ts`; **new** `tests/unit/combat-telegraphs.test.ts`.
**Coordinator prerequisite:** approve the narrow presentation-role approach below before rendering integration. If rejected, replace this card with a separately scoped atlas-backed warning; do not let the worker bypass the policy.

Add a `combat-telegraph` paint role derived exclusively from live monster-owned radial-slam pending attacks. Include attack ID, owner ID, world center/radius, impact tick, and projected bounds in the manifest. One shared helper supplies simulation-warning geometry; do not derive the visible radius from arbitrary sprite-cell width.

Render a thin outlined ground ring with a shrinking/countdown accent; use shape and motion, not color alone. Draw below actor bodies and health UI. Do not scale enemies, alter collision, or move actors to make the warning readable. Preserve camera/DPR transforms. Align the elite's authored windup/contact/recovery presentation to the new impact tick; a normal 10-tick contact pose followed by damage at tick 48 is a failure. Keep ordinary monster frame cadence unchanged. The ring denotes the player-center hit boundary; do not silently add the player's radius.

This is a deliberately narrow code-native ground marker, **not** a general waiver of the project's sprite policy. T08 must register and test it before this milestone is accepted. Keep evidence of the previous appearance; no blanket screenshot updates.

**Red tests:** wrong radius/center, stale/canceled attack, dead owner, duplicate paint, wrong layer, a contact pose preceding actual impact, and desktop/portrait projections. Warning disappears at impact and after a loaded state without that attack.

**Check:** `npx vitest run tests/unit/combat-telegraphs.test.ts tests/unit/combat-readability.test.ts`, `npm run build`.
**Done:** warning metadata matches pending damage geometry. The existing nova effect alone is not evidence of an accurate hit boundary.

## T08 — Register the marker and test physical evasion

**Depends:** T07. T07 and T08 form one coordinated integration milestone; neither is releasable alone.
**Own:** `scripts/test-visible-sprite-provenance.mjs`, `scripts/lib/visible-sprite-provenance-evidence.mjs`, its `.d.mts` declaration, `tests/unit/visible-sprite-provenance-evidence.test.ts`, `tests/framework/combat-readability.ts`; **new** `tests/e2e/bell-keeper.spec.ts`.
If this exceeds one bounded patch, split policy registration and browser tests into T08a/T08b before dispatch.

Permit only the registered, manifest-backed `combat-telegraph` role. Preserve all existing non-title text, CSS decoration, sprite identity, overlap, and health-bar checks. A forged marker without a matching live pending attack must fail.

In a clearly labeled isolated arena, use real keyboard input on desktop and touch controls on a 390×844 phone. Cover:

1. standing inside the ring takes damage at impact;
2. reacting to a visible warning and moving outside avoids damage;
3. returning during recovery lands a player hit before the next boss attack;
4. save/load mid-warning renders the same remaining timing and geometry.

Use deterministic stepping with browser input for exact-tick assertions; separately retain a short real-time visual sequence. Do not call semantic `setInput` in a test labeled physical input. Capture windup start, just-before-impact, impact, recovery, and next attack, including full-page screenshots.

**Check:** `npx playwright test tests/e2e/bell-keeper.spec.ts --workers=1`; `npm run test:sprite-provenance`.
**Done:** both positive and deliberately broken warning controls work. Reviewer inspects full-size phone frames; numbers alone cannot approve the warning.

## T09 — Teach the campaign pilot to respect the new mechanic

**Depends:** T08.
**Own:** `scripts/test-campaign-journey.mjs`; **new** `scripts/lib/campaign-hazard-policy.mjs`, **new** `scripts/test-campaign-hazard-policy.mjs`.

Add a small deterministic avoidance decision before the existing combat policy. For an imminent live slam containing the player, choose a reachable point outside stored radius + 128 world units. Evaluate a bounded set of eight radial candidates; use stable order/tie-breaking and the real navigation/collision rules. Do not teleport, alter speed, add invulnerability, disable AI, or delay the attack.

Report dodge opportunities, successful escapes, actual slam hits, and time spent unable to find a route as diagnostics. Do not gate arbitrary win-rate improvements. The pilot remains explicitly omniscient.

**Red controls:** no legal escape is reported honestly; candidate inside a wall is rejected; disabled movement fails to escape; a successful dodge changes position through legal inputs; seed replay remains exact.

**Check:** `node --test scripts/test-campaign-hazard-policy.mjs`, then `npm run feedback:campaign`.
**Milestone gate:** add the new boss browser test file to the declared aggregate manifest; run `npm run feedback:game`. Coordinator owns that manifest integration; do not silently forget the new cases.
**Done:** all nine campaigns still complete and replay, without simplifying the encounter for the pilot.

## T10 — Explain the warning and reward in existing UI

**Depends:** T09.
**Own:** `src/game/missions.ts`, `src/app/CampaignUI.ts`, `src/main.ts`; `tests/unit/missions.test.ts`, `tests/e2e/campaign.spec.ts`.

Add concise Bell Keeper guidance to the existing journal: move outside the marked circle, then counterattack during recovery. Show the elite name near the encounter without covering the warning. Do not require reading dialogue to win.

Replace ambiguous reward copy with facts: weapon pickup says `Power +N`, gold says `Gold +N`, tonic says `Tonic +N`. Keep existing pickup/level rules unchanged. The journal displays current level, XP progress, power and supplies; no fake equipment slot or claim that the player equipped a named item.

Keep discovered text available after city entry and reload. Reuse the established journal/native-copy boundaries and glyph HUD roles.

**Red tests:** pickup text must match the actual stat delta; missed pickup shows no success; guidance persists through save/reload; no overlap with warning, health or touch actions at 390×844 and 844×390.

**Check:** `npx vitest run tests/unit/missions.test.ts`; `npx playwright test tests/e2e/campaign.spec.ts tests/e2e/bell-keeper.spec.ts --workers=1`.
**Done:** the player can understand both the counterplay and reward. No new currency, quest flag, or save field.

## T11 — Add one nonessential audio cue without new generation

**Depends:** T09.
**Own:** `src/audio/GameAudio.ts`, `tests/unit/game-audio.test.ts`, `tests/e2e/bell-keeper.spec.ts`.

Reuse an appropriate bundled sound for slam windup, selected by listening first. Trigger once per new attack ID, never every render. Existing mute/volume, activation, hidden-page stop, pause and overlap caps apply. Loading a mid-warning save must not produce a burst of historical cues.

Audio reinforces the visible warning; muted play must remain fully usable. Do not change voice scripts or call ElevenLabs in this card. If existing sounds are unsuitable, record the missing cue for a later explicit generation task.

**Check:** `npx vitest run tests/unit/game-audio.test.ts tests/unit/audio-assets.test.ts`; focused boss browser test with muted and unmuted cases.
**Done:** one audible cue per windup when enabled; zero duplicate storms or dependency of gameplay on sound.

## T12 — Add a complete physical-browser journey

**Depends:** T10, T11.
**Own:** **new** `tests/e2e/campaign-production-journey.spec.ts`, optionally **new** `tests/framework/campaign-browser-driver.ts`; coordinator integrates aggregate command/manifest.

Start with Vanguard/`cinder-041` on desktop. Enter through ordinary character selection with the observe-only bridge, fight, follow the sign, enter Embercross, read an NPC, save through the journal, reload via Continue, and reach the ending. Then add the same route on a portrait phone. Do not multiply to every seed/class yet; the simulation matrix already covers those.

Use actual Playwright keyboard/pointer/CDP touch actions. Read-only full state/navigation may guide this deterministic driver, as in `tests/e2e/city-production-route.spec.ts`, but label it privileged. It is **not** an unaided-player test. Assert `__GAME_TEST__` is absent. No state loading, semantic stepping, injection, hidden grants or direct storage writes.

Retain named checkpoints, real gesture timestamps, pause/load state comparisons, screenshots and a trace on failure. Use a declared 300-second per-route ceiling and a 10-second no-progress detector that pauses during intentional journal/loading states. Progress means player displacement, changed enemy/player health, a mission transition, or a completed UI checkpoint action—not movement alone. Set the timeout on these route tests explicitly, not globally. These are operational bounds, not human pacing targets. Do not hide an exhausted budget.

Run this as a separate aggregate component with a 660-second budget for two sequential 300-second routes plus startup/cleanup; do not squeeze two full journeys into the existing five-minute short-browser component. Update report manifest/tests so missing this component cannot pass.

**Check:** `npx playwright test tests/e2e/campaign-production-journey.spec.ts --workers=1`.
**Milestone gate:** `npm run feedback:game`.
**Done:** both physical journeys reach victory after a real UI save/reload. The declared limitation remains visible in the report.

## T13 — Acceptance review, not more implementation

**Owner:** coordinator plus a human or an independent visual/gameplay reviewer.
**Scope:** evidence and a short acceptance record; no unreviewed balance edits.

Run sequentially on frozen source:

```bash
npm run check
npm run test:e2e -- --workers=1
npm run feedback:game
```

Read the first-failure handoff and verify evidence links if anything fails. All required cases must pass; distinguish a separately documented transport rerun from a clean initial pass. Do not publish until separately authorized.

Play/review the chapter without consulting hidden state. Record evidence for:

- Does the player notice the first useful direction cue and know where to go?
- Is the slam distinguishable before damage, including muted phone play?
- Can the player evade and understand why a hit/miss occurred?
- Is the recovery opportunity usable, not merely an animation?
- Do pickups communicate a benefit and saves restore the expected journey?
- Is any required travel dead time? Record timestamps and the cause, not a guessed “fun score.”

An agent using hidden state cannot sign off as a first-time human. If no suitable reviewer is available, mark `BEHAVIOR_VERIFIED / PLAY_REVIEW_PENDING`; do not declare the milestone fully accepted.

**Done:** review says ACCEPT or gives one evidence-backed, bounded follow-up card. Balance constants may be changed only by that follow-up with before/after evidence. Never ask a Luna worker to “make it more fun until done.”

## Handoff templates

### Coordinator → implementation agent

```text
Implement only T__ from docs/next-steps-plan.md.
Prerequisites accepted: [task IDs and commits].
Your owned paths: [copy exact scope].
Other agents/user changes exist: preserve them; do not edit outside this scope.
Read the common protocol and your task card. Reproduce the red test before fixing.
Use the specified checks; preserve raw failure evidence and source identity.
Do not change thresholds, goldens, schemas, dependencies, secrets, or the plan.
If two attempts fail or you need another subsystem, stop with a precise blocker.
Return the template below and stop. Do not start the next card.
```

### Agent → coordinator

```text
Task:
Status: REVIEW or BLOCKED (not self-approved ACCEPTED)
Starting/ending commits:
Changed paths:
Observed failure and retained evidence:
Why the fix addresses that cause:
Red test: command + result + artifact
Green test: command + result + artifact
Broader gate (or explicitly not run):
Source stable during evidence: yes/no
Screenshots/trace paths and what they prove:
Compatibility/security impact:
Remaining limitation or smallest blocker:
```

### Reviewer → coordinator

```text
Task and exact commit reviewed:
Verdict: ACCEPT / REJECT / NEEDS HUMAN PLAY REVIEW
Would the regression test fail with the old behavior?
Were checks or pilot difficulty weakened?
Does evidence correspond to this source and declared inputs?
Were save compatibility and phone behavior covered when applicable?
Concrete remaining issue, with artifact:
```

## Later roadmap — not ready-to-dispatch cards

1. **Equipment choices:** one weapon slot with an explicit comparison and bounded inventory. First decide typed item IDs, deterministic item rolls, equip actions, old-power migration, save versioning, and replay semantics. Do not bolt arbitrary objects onto city inventory.
2. **A second chapter:** returnable maps, durable world IDs, encounter persistence, explicit campaign progression and a migration plan. The current city transition discards wilderness entities; appending another mission string is not enough.
3. **Optional authored mission:** one NPC request with a nonessential reward and an idempotent completion transaction. Do not rely on temporary DOM state or a journal read ID as an authoritative reward flag.
4. **Enemy variety:** one new counterplay pattern at a time, each with hit/miss/obstacle/replay and visible-warning tests before content expansion.
5. **Additional voiced content:** finalize exact scripts first; then use the existing generation script with an explicitly scoped cue list and cost authorization. Never copy the neighboring project's secret into this repository.

These require fresh task cards and coordinator-approved interfaces. Do not let a smaller agent infer those designs from this list.

## Decisions and acceptance limitations

Chosen: deepen the existing encounter, preserve schemas, make aggregate evidence identity-aware, and prove a full physical journey. Rejected for this batch: a broad RPG rewrite, blanket retries, generic automatic “fun” scoring, mandatory paid assets, and expanding content before counterplay is demonstrated.

No user choice blocks preparing the first cards. T07 requires a recorded presentation-role review; T13 requires an independent play review. Equipment migration, second-chapter duration and extra audio spending are deliberately unresolved later decisions.

This plan was grounded in live code and retained results, then checked for scope, provenance, migration and red/green coverage. It is a handoff, not a claim that any task above has been implemented.
