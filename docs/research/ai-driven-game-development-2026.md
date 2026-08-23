# AI-driven game development: reusable quality architecture

Date: 2026-08-23  
Scope: evidence-backed practices for Cinderwake and future browser games

## Purpose

AI can accelerate planning, code, art trials, scenario authoring, and evidence review. It must not become the source of truth for whether a game works or looks good. Cinderwake therefore puts deterministic workflows around discretionary agents: repository state, tests, artifact hashes, and independent review establish completion, not an agent's narrative.

This follows the useful distinction between predictable workflows and open-ended agents in [Anthropic's engineering guidance](https://www.anthropic.com/engineering/building-effective-agents). Agent evaluation should also distinguish the task, repeated trial, grader, trace, and final environment outcome; a plausible answer is not evidence that the environment is correct. [Anthropic's agent-evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) makes that distinction explicit.

The practical development loop is:

1. Define a user-visible behavior and its evidence contract before implementation.
2. Let an agent implement one bounded slice.
3. Run deterministic build, behavior, browser, screen, and temporal workflows.
4. Retain the first failure and the final candidate as reproducible evidence.
5. Give subjective evidence to a reviewer independent of the implementation pass.
6. Promote assets or baselines only after machine gates and the required human verdict agree.

## Project status vocabulary

This document separates policy from implementation status:

- **Established:** already represented by committed architecture, tests, or accepted decisions.
- **Adopt next:** project policy that should become a reusable gate; individual checks may still be under construction.
- **Future option:** useful only after a measured trial or a second game demonstrates the need.

## Established Cinderwake practices

Cinderwake already has the most important foundation:

- A fixed-step, seeded simulation that can start from a declarative scenario or complete state and replay semantic command tapes.
- Canonical snapshots and hashes that make behavior equality machine-checkable.
- A narrow browser bridge that exercises the real renderer while permitting exact state injection and stepping.
- Synchronized render manifests, isolated alpha masks, exact-tick frames, contact sheets, and retained reproduction bundles.
- Fixed sprite source/atlas contracts with deterministic packing, immutable hashes, and atlas-wide animation-bank auditing.
- A visual-review veto: a green metric result cannot approve composition, naturalness, weight, readability, or style by itself.
- Real launch-path checks for class selection, asset loading, gameplay controls, and recoverable atlas failure.

See [testing architecture](../testing-architecture.md), [sprite art pipeline](../art-pipeline.md), [visual-review veto](../decisions/0009-visual-review-veto.md), [atlas-wide audit](../decisions/0015-exhaustive-actor-atlas-audit.md), and [mobile launch-path testing](../decisions/0014-mobile-selection-and-launch-path.md).

## Adopt next: the four-oracle model

The failures reported during development fall into four independent oracle classes. A future game should implement all four rather than treating screenshot tests as a universal answer.

| Oracle          | Question                                                                                           | Reliable automatic evidence                                                                                   | Independent judgment                                           |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Intent**      | Did the physical gesture become the intended command, and no forbidden command?                    | Browser event, semantic input record, consumed tick, state/event delta                                        | Whether the chosen control scheme feels intuitive              |
| **Composition** | Is the screen mechanically valid and visually well composed?                                       | Decode, containment, safe areas, target size, hit testing, occlusion, nonblank pixels, pinned regression diff | Hierarchy, anatomy, coherence, focal emphasis, premium feel    |
| **Assessor**    | Does the quality framework still catch known defects?                                              | Paired valid controls and deliberate mutations with expected failing check IDs                                | Whether the defect catalog represents the risks players notice |
| **Liveness**    | Did a real control or loading transition reach an effect or recoverable error before its deadline? | Screen state, progress, command/state transition, timeout, retry/back result                                  | Whether wait time and recovery experience are acceptable       |

### Intent oracle

An input test must join the whole causal chain:

```text
precondition → physical gesture → normalized intent → consumed command
             → state/screen effect → forbidden effects → deadline → evidence
```

For the mobile regression, touching ordinary ground must record a touch-origin `move-to` or movement intent, change position by the declared tick, persist as designed, and produce no attack event. The Strike surface must do the inverse. Tests should cover arrival, retargeting, near taps, other directions, cancellation, release outside a control, and simultaneous movement/action contacts.

Pointer behavior must not be inferred only from mouse-driven tests. The W3C specification defines a unified pointer model while preserving pointer type, cancellation, capture, lost capture, and `touch-action`; those paths are part of the input contract. [Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)

### Composition oracle

Hard gates should reject:

- failed or zero-size critical asset decode;
- unexpected page overflow or scrolling;
- roots, titles, subjects, controls, or safe regions outside the viewport;
- undersized, disabled, hidden, or center-occluded interaction targets;
- controls covering more than their declared playfield allowance;
- blank canvases, accidental transparent regions, clipped subject masks, and missing required layers;
- player-facing routes that expose test-only controls.

Pinned screenshots remain useful change detectors, but Playwright warns that rendering can vary with operating system, browser version, hardware, settings, power source, and headless mode. Baselines therefore need a pinned environment and explicit review. More importantly, a screenshot diff answers “did this change?” rather than “was the original screen good?” [Playwright visual-comparison documentation](https://playwright.dev/docs/test-snapshots)

Geometry can prove that a hero is inside a declared focal region; it cannot prove that the face is anatomically coherent or that the hero, buildings, props, title, and controls form a convincing composition. Those remain reviewer vetoes. The project-specific criteria and device matrix live in the [screen test playbook](../screen-test-playbook.md).

### Assessor oracle

Every evaluator needs a compact defect corpus. Each fixture starts from a passing control, applies exactly one named mutation, and declares the check IDs that must fail. It is insufficient for a defect to fail only because an unrelated broad assertion happened to break.

Required mutations include:

| Reported risk                   | Representative mutations                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Tap attacks instead of moving   | Remap touch-world intent to attack; swallow move intent; delay consumption                                                    |
| Bad selector/HUD composition    | Move a control outside the safe area; shrink or occlude a target; crop or blank the focal subject                             |
| Jumping sprite animation        | Offset a source crop or anchor; duplicate/reorder a frame; blank a cell; introduce a one-frame scale pop or bad recovery seam |
| Inert button or stalled loading | Remove a listener; swallow a semantic command; never resolve, abort, or corrupt a required asset                              |

Use two levels. Fast offline mutations of retained timelines, manifests, masks, and geometry reports validate evaluator logic. At least one representative end-to-end fault per layer proves that capture observes the defect before assessment begins.

This is an engineering adaptation of broader evaluation guidance. NIST recommends empirical testing, retained evaluation history, documented limitations, explicit human roles, and evaluation of whether the metrics and TEVV process itself remain effective. [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) Metamorphic testing is also useful when a complete golden output is impractical but a relation between a valid control and a transformed run is exact. [NIST's simulation-testing paper](https://www.nist.gov/publications/metamorphic-testing-continuum-verification-and-validation-simulation-models)

### Liveness oracle

“The button was clickable” is never a sufficient assertion. Every interaction surface declares:

- its valid precondition;
- the physical action used;
- an expected semantic command, state delta, or screen transition;
- forbidden effects;
- a deadline;
- disabled/busy behavior;
- recovery behavior after failure.

Loading is an explicit state machine: `idle → loading → ready | recoverable-error`. A stalled asset must reach the error state by policy rather than leave an infinite spinner. Retry must succeed after the fault is removed, and Back must restore a usable launch screen. Selection, modal, ability, tonic, and retry controls all require causal postconditions.

## Reusable contract boundary

Future games should provide semantic data plus a small test-only adapter. Game-specific selectors and clip names must not become the reusable API.

```ts
interface GameQualityAdapter {
  appSnapshot(): {
    screen: string;
    phase: string;
    busy: boolean;
    error?: string;
  };
  inputLog(): InputIntentRecord[];
  stateSnapshot(): unknown;
  stateHash?(): string;
  injectState?(fixture: unknown): void;
  step?(ticks: number): void;
  renderManifest?(): unknown;
  captureEntityMask?(entityId: string): unknown;
  assetStatus(): AssetStatus[];
}
```

The repository-level contract should be split into readable versioned files:

```text
quality/
  project.v1.json                  # capabilities, profiles, evidence policy
  screens/*.screen.json            # roots, surfaces, regions, hard rules
  journeys/*.journey.json          # actions, effects, prohibitions, deadlines
  rigs/*.rig.json                   # grids, frames, cadence, anchors, thresholds
  negative-controls/*.mutation.json
  schemas/*.schema.json
```

A journey refers to semantic surface IDs such as `world`, `strike`, or `launch`; an adapter resolves those IDs to DOM or canvas targets. A rig declares source grid and cells, ordered frame identities, authored holds, looping, pivots/foot anchors, safe ink bounds, facing policy, recovery target, and optional contact metadata. The runner owns generic actions and assertions; the game owns meaning.

## Evidence bundle contract

One immutable bundle should connect player action to promotion decision:

```text
quality-results/runs/<run-id>/
  bundle.json                       # hashes and links for every member
  initial-state.json
  browser-events.json
  input-intents.json
  commands.json
  states-and-hashes.json
  asset-lifecycle.json
  screen-geometry.json
  screenshots/
  render-manifest-timeline.json
  masks/
  contact-sheet.png
  measurements.json
  trace.zip                         # normally retained on failure
  machine-verdict.json
  visual-review.json
```

`bundle.json` records schema/contract versions and hashes, source commit and dirty patch/status, lockfile hash, browser/OS/viewport/DPR/input profile, scenario, mutation ID or `none`, reproduction command, and every artifact hash. Stable IDs should join `commit → journey → state/commands → render evidence → checks → review → baseline`.

Playwright traces already preserve action timing, before/action/after DOM snapshots, screenshots, console and network evidence, metadata, and attachments, making them a strong browser-side member of this bundle. [Playwright Trace Viewer documentation](https://playwright.dev/docs/trace-viewer) Generated-art manifests should likewise preserve immutable bytes, hashes, ingredients/references, prompts or honestly reconstructed briefs, tool/model identity, edits, and derived outputs. C2PA provides useful provenance vocabulary while also warning that valid provenance is not a judgment that content is good. [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)

## AI visual review: useful but non-authoritative

An implementation agent must not approve its own visual output. Anthropic reports a positive self-evaluation tendency on subjective frontend work; a separate evaluator was more useful, but still required calibration and still missed layout and interaction defects. [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

An AI reviewer may:

- triage large screen and animation matrices;
- cite suspicious viewport regions, frames, ticks, or entities;
- compare evidence against a written rubric;
- recommend rejection or request human attention.

It may not promote art or screenshot baselines. A 2026 peer-reviewed study found that multimodal-model image ratings can align with humans overall while differing by attribute and failing to generalize on anatomy, style, and aesthetics tasks. The study concerns static generated images, not sprite animation, so it supports caution rather than a game-specific error estimate. [AAAI-26 paper](https://ojs.aaai.org/index.php/AAAI/article/view/39666)

If trialed, AI review must be blind to the implementer's justification, repeated because outputs vary, and compared against independent human labels. Retain false accepts, false rejects, abstentions, and disagreement by rubric axis. `visual-review.json` records bundle/commit hashes, reviewer kind and model/version, rubric version, independence from authoring, per-item verdict, cited evidence, confidence, limitations, and any owner override.

## Promotion process

Adopt the following order:

1. Validate schemas, readable source, and asset hashes.
2. Run deterministic state/replay tests.
3. Run real Playwright journeys for intent and liveness.
4. Run screen hard gates across the declared device matrix.
5. Run temporal sprite, camera, combat, and lifecycle assessment.
6. Run paired negative controls whenever an evaluator, contract, or threshold changes.
7. Produce a **candidate** bundle and optional advisory AI review.
8. Require an independent human verdict for changed appearance evidence.
9. Promote the baseline only when the promotion tool verifies the exact bundle, commit, and review hashes.
10. Rerun the normal non-update suite; a baseline-update command is never final verification.

CI may generate and publish candidate evidence. It must not self-promote it.

## Future options requiring evidence

These are not current acceptance authorities:

- **Stateful property exploration:** use generated commands, shrinking, and seed/path replay, then export minimized failures into the existing game replay bundle. `fast-check` supports stateful commands, shrinking, and explicit replay metadata. [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- **Cross-engine and physical-device calibration:** add WebKit semantic/layout smoke, then sample an owner-selected physical phone before claiming real-device quality. Browser device emulation changes declared context properties; it is not physical GPU, thermal, display, or touch-latency evidence. [Playwright emulation](https://playwright.dev/docs/emulation)
- **Live delivery telemetry:** report `requestAnimationFrame` cadence, missed-budget streaks, input-to-present latency, decode cost, and severe long-frame attribution separately from exact simulation tests. Do not let performance telemetry affect canonical game state.
- **Support-foot metadata:** trial explicit contact intervals on one walk clip before changing every actor rig.
- **Static perceptual metrics:** SSIM or learned patch metrics may be offline ranking features on aligned crops, not broad animation-quality scores.
- **Signed media/supply-chain attestations:** readable hashes and lineage are sufficient until an external trust or distribution requirement justifies full C2PA/SLSA machinery.

## Extraction path from Cinderwake to future games

1. **Finish Cinderwake end to end.** Keep schemas and generic runners under `quality/`, while Cinderwake selectors, state projection, sprite semantics, and thresholds remain adapters and contract data.
2. **Bootstrap one different game.** Implement the same four oracles with different controls, screens, state, and rig vocabulary. Record every place the new game must fork the runner.
3. **Extract only repeated primitives.** Package stable schemas, journey actions, evidence cataloging, mutation protocol, screen geometry, and review validation. Keep engine-specific state injection and render-manifest projection behind adapters.
4. **Version compatibility.** Preserve old evidence readers, make additions optional or explicitly versioned, and retain the exact contract used by every bundle.
5. **Calibrate before strengthening authority.** A second implementation may justify reusable defaults; labeled trials may justify advisory AI triage. Neither automatically justifies model-only acceptance.

Packaging before two implementations would freeze Cinderwake-specific selectors, 60 Hz assumptions, clip names, and atlas geometry into a framework that only appears game-agnostic. The reusable product is the causal and evidence shape, not Cinderwake's content model.
