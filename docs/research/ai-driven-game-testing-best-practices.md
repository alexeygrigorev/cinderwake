# AI-driven browser-game testing: evidence-backed practices

Date: 2026-08-24  
Scope: reproducible state, input, sprite, temporal, camera, mobile, and AI-assisted visual testing for Cinderwake and future browser games

## Evidence labels

- `[FACT S#]` is a paraphrase supported by a primary source in the source register.
- `[PROJECT]` describes a current Cinderwake mechanism and links to its project documentation or implementation.
- `[INFERENCE S#,...]` is a Cinderwake-specific recommendation derived from the cited evidence. It is not a claim made by the source.
- `[OPEN]` is a decision that needs calibration or another implementation before it can become framework policy.

This distinction matters because an attractive AI review or a green perceptual score is not evidence that the simulation, controls, or pixels are correct. The framework should retain the causal evidence and expose uncertain judgment rather than convert it into a fact.

## Executive conclusion

Cinderwake already has the difficult foundation: fixed-step seeded simulation, full JSON state injection, semantic command tapes, canonical hashes, a browser test bridge, render manifests, isolated entity masks, deterministic sprite builds, mutation-tested animation audits, commit-bound sequence evidence, and an independent visual-review veto. The useful next move is extraction and coverage, not a second testing architecture.

The reusable product should be a small game adapter plus a generic evidence runner. The adapter gives the runner valid state, logical actions, semantic observations, rendering metadata, and masks. The runner owns replay, generated exploration and shrinking, physical browser input, temporal and camera metrics, mutation tests, device profiles, provenance, reports, and advisory visual review.

## Current Cinderwake mechanism map

| Concern               | Existing mechanism                                                                                                                                                                 | Framework extension                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary start state | `ScenarioV1`, complete `loadState`, validation before host mutation, and deterministic reset in [`src/testkit`](../../src/testkit/)                                                | Put a versioned, game-neutral scenario/state transport in front of the Cinderwake types; add generated valid states and shrinking.                  |
| Reproducible action   | `queueInputs`, exact tick stepping, canonical snapshots, RNG streams, and state hashes in [`browserBridge.ts`](../../src/testkit/browserBridge.ts)                                 | Introduce logical `ActionV1` and an input-receipt timeline; replay each tape in fresh contexts and compare every observable tick.                   |
| Physical controls     | Playwright journeys for keyboard, pointer, and touch under [`tests/e2e`](../../tests/e2e/)                                                                                         | Require a physical-input test and a semantic-action test for every critical control, joined by the same action ID and causal postconditions.        |
| Semantic rendering    | `RenderManifestV1`, camera state/target, draw calls, world/screen/foot anchors, sprite identity, and collision metadata                                                            | Define a generic render observation with stable entity IDs and optional game-specific fields instead of exposing Cinderwake clip names to the core. |
| Pixel evidence        | Full frames, close-ups, isolated entity masks, contact sheets, and artifact hashes from `capture:sequence`                                                                         | Add anchor- and camera-compensated temporal residuals while retaining raw frames and masks for review.                                              |
| Sprite ingestion      | Fixed actor source contract, deterministic atlas builder, source/output hashes, safe bounds, anchors, and exhaustive atlas audit                                                   | Make the rig schema portable and make registration automatically enroll every clip and facing in all static and temporal checks.                    |
| Animation and camera  | `assess-sequence.mjs` measures cadence, grounding, centroid continuity, lifecycle, recovery seams, state/render agreement, camera convergence, and acceleration                    | Add jerk, overshoot, settling, start/stop velocity continuity, and explicit loop-boundary residuals with one named mutation per new detector.       |
| Evidence freshness    | Sequence bundles include state, tape, hashes, manifests, masks, source commit, dirty patch/status, environment, and reproduction command; the quality index rejects stale evidence | Generalize the bundle schema and hash the adapter, contracts, assets, browser, lockfile, review prompt, and review output.                          |
| Visual acceptance     | A hash-bound review can reject a mechanically green screen set; changed pixels invalidate the verdict                                                                              | Add blind, independent reviewers by rubric axis; disagreement remains visible and cannot promote a candidate.                                       |

The detailed current architecture and thresholds remain authoritative in [testing architecture](../testing-architecture.md), [quality model](../quality-model.md), and [sprite art pipeline](../art-pipeline.md).

## Evidence-backed practices

### 1. Keep simulation time, presentation time, and performance time separate

- `[FACT S1]` Unity's deterministic sample identifies a fixed simulation timestep, deterministic seeded random calls, stable system/entity order, deterministic numeric behavior, and race-free query ordering as requirements for reproducible outcomes.
- `[FACT S2]` Playwright can control `Date`, timers, `performance`, and `requestAnimationFrame`; its documentation recommends installing the test clock before navigation.
- `[PROJECT]` Cinderwake already advances simulation with explicit integer ticks and renders without mutating state. Canonical hashes make observable equality exact.
- `[INFERENCE S1,S2]` Add a determinism-conformance run that loads the same state and action tape in at least three fresh browser contexts and compares the state hash, semantic event list, render-manifest hash, and isolated-mask hash at every retained tick. Record the first divergent tick and member, not just a final mismatch.
- `[INFERENCE S2]` Use Playwright's controlled clock for deterministic UI and presentation tests only. A separate real-clock lane must measure actual delivery; faking `requestAnimationFrame` would invalidate a performance claim.

### 2. Generate valid state/action sequences and shrink failures

- `[FACT S3]` QuickCheck tests executable properties over generated inputs and supports custom generators.
- `[FACT S4]` Its model-based form supports preconditions, postconditions, and comparison between an implementation and a model.
- `[FACT S5]` Deterministic shrinking can preserve the reproducibility of the minimal counterexample; recent parallel work reports that property evaluation and shrinking can also be parallelized.
- `[PROJECT]` Cinderwake can already start from a declarative scenario or exact complete state and save the initial state plus command tape in a reproduction bundle.
- `[INFERENCE S3,S4,S5]` Generate only valid worlds and commands: walkable placements, collision-safe radii, legal phase/cooldown combinations, bounded entity counts, and actions permitted by the current model state. On failure, shrink the command sequence first, then entities, map dimensions/topology, timers, health, and coordinates while preserving validity.
- `[INFERENCE S3,S4]` Useful always-on properties include deterministic replay, finite/in-bounds geometry, no solid overlap after a movement step, no duplicate terminal event, animation clip compatible with state, stable entity identity, and state-to-manifest agreement.
- `[INFERENCE S5]` Save the minimized `initial-state.json`, logical action tape, generator seed/path, shrink history, exact failing check, and normal sequence evidence. A generated failure is not actionable until the checked-in reproduction runs without the generator.

### 3. Test logical actions and real controls as two joined paths

- `[FACT S6]` Google Research's game-testing work uses a semantic API of observations and logical actions rather than raw pixels and physical controller bindings. It favors several short task-specific gameplay loops over one monolithic end-to-end agent.
- `[FACT S7]` Playwright recommends isolated tests of user-visible behavior. Its device profiles include viewport, user agent, mobile behavior, and touch capability.
- `[FACT S8]` Playwright's touchscreen API emits a real `touchstart`/`touchend` tap in a touch-enabled browser context.
- `[PROJECT]` Cinderwake already exposes semantic input through the browser bridge and also has live Playwright input journeys.
- `[INFERENCE S6,S7,S8]` Every critical control should prove the full chain: precondition, physical input, normalized logical action, consumed tick, required state/event/render change, forbidden effects, and deadline. For example, an ordinary world tap must produce navigation and no strike; the Strike surface must produce a strike and no navigation target.
- `[INFERENCE S6]` An AI player should consume the same minimal `ObservationV1` and emit the same `ActionV1` as scripted tests. It may discover candidate failures, but correctness remains the job of deterministic oracles. Its output is a replay bundle, not a pass/fail verdict.

### 4. Treat a sprite sheet as a versioned rig contract

- `[FACT S9]` Aseprite's official batch interface can export tagged frames, durations, trimming metadata, padding, edge extrusion, and JSON; slices can carry pivots.
- `[PROJECT]` Cinderwake already declares fixed actor cells, foot anchors, cadence, source hashes, safe bounds, deterministic packing, and runtime sprite registration.
- `[INFERENCE S9]` The reusable rig contract should require actor/clip/facing/frame identity, source rectangle, untrimmed logical size, trim offset, runtime destination size, duration ticks, bottom-center foot anchor, safe padding, collision envelope, airborne exception where applicable, and source/output hashes. Equivalent metadata may be produced without depending on Aseprite.
- `[INFERENCE S9]` Registration must automatically test every frame for source containment, transparent-matte cleanup, safe-border contact, alpha support under the declared foot, stable runtime scale/anchor, unintended duplicates, frame order, complete loops, recovery seams, and deterministic runtime masks.
- `[PROJECT]` Cinderwake's mutation discipline is already the right model: bad recovery, displacement, clipping, and scale changes must be rejected by named checks. Extend it with blank, duplicate, reordered, shifted-crop, one-frame scale-pop, and wrong-loop-seam mutants wherever coverage is missing.

### 5. Decompose temporal quality instead of trusting one score

- `[FACT S10]` VBench evaluates temporal flicker, motion smoothness, subject consistency, and background consistency as separate dimensions. Its motion-smoothness method uses intermediate-frame consistency rather than a single still-image score.
- `[FACT S11]` LPIPS is a learned patch-distance metric whose authors report better human perceptual alignment than shallow pixel metrics for image patches; its output is still an image distance, not a game-animation correctness oracle.
- `[PROJECT]` Cinderwake already separates semantic cadence/lifecycle, world motion, foot anchoring, isolated-mask geometry, recovery seams, and camera behavior.
- `[INFERENCE S10]` Add separate retained measurements for core-centroid jerk, loop-boundary jerk, start/stop velocity discontinuity, anchor-compensated mask/edge residual, and background residual after subtracting known camera displacement. Preserve individual verdicts; an average must never hide a failure.
- `[INFERENCE S10,S11]` Learned optical-flow, interpolation, or LPIPS signals should remain advisory until thresholds are calibrated against accepted Cinderwake clips and paired injected defects. Authored pixel-art pose changes can be valid even when a learned image metric reports a large distance.
- `[INFERENCE S10]` Programmatic checks and visual review should inspect the same exact runtime-scale frame sequence and semantic anchor overlay. This joins a measurable failure with the evidence needed to decide whether the motion looks natural.

### 6. Measure camera path semantics and browser delivery independently

- `[PROJECT]` The current camera profile records target error, monotonic convergence, final error, and acceleration.
- `[INFERENCE S1,S10]` Extend it with tick-normalized speed, acceleration, jerk, overshoot count, settling time, player screen-space excursion, and background displacement error. Cover movement start, stop, reversal, diagonal movement, target teleport, map clamp, portrait/landscape rotation, and compact mobile crop.
- `[FACT S12]` The W3C Long Animation Frames draft defines entries for frames over 50 ms that can block input and visible updates; it is a Working Draft rather than a stable cross-browser acceptance API.
- `[FACT S13]` Browser rendering can vary with operating system, browser version, hardware, settings, power state, and headless mode; Playwright recommends comparing screenshots in the same environment used to produce their baselines.
- `[INFERENCE S12,S13]` Add a real-clock delivery report with `requestAnimationFrame` interval distribution, missed-refresh streaks, event-to-consumed-action latency, event-to-first-changed-paint latency, and Long Animation Frame entries where supported. Pin screenshot environments and keep browser-specific baselines; do not infer physical-phone performance from emulation.

### 7. Use AI visual reviewers as a blind panel, not an authority

- `[FACT S14]` A multimodal-judge study found stronger human-like behavior for pairwise comparison than scalar scoring, while also reporting bias, hallucination, and inconsistency.
- `[FACT S15]` A heterogeneous panel of language-model judges reduced single-judge intra-model bias across the paper's text-evaluation settings.
- `[INFERENCE S14,S15]` Adapt, do not overgeneralize, these results to visual QA: give independent reviewers the exact hash-bound frames or video without the implementer's justification; ask one randomized pairwise question and separate absolute rubric questions for animation, composition/style, mobile readability, and input evidence.
- `[INFERENCE S14,S15]` Record the artifact hash, rubric version, prompt, reviewer/model version, per-axis rationale, confidence, and disagreement. Reviewer disagreement produces `candidate` or `needs-human-review`; it never becomes an averaged automatic approval.
- `[PROJECT]` Mechanical failures and the owner's visual verdict retain veto power. An AI reviewer may triage, locate suspicious frames, and recommend rejection, but it cannot promote art or screenshot baselines.

## Proposed reusable boundary

```ts
interface GameTestingAdapter<State, Scenario> {
  capabilities(): CapabilityManifestV1;

  validateScenario(value: unknown): Scenario;
  loadScenario(scenario: Scenario): ObservationV1;
  loadState(state: State): ObservationV1;
  reset(): ObservationV1;

  dispatch(action: ActionV1): void;
  step(ticks: number): ObservationV1;
  observe(): ObservationV1;

  render(interpolationAlpha?: number): RenderObservationV1;
  canonicalState(): unknown;
  stateHash(): string;
  captureEntityMask(entityId: string): EntityMaskV1;
}
```

`ActionV1` describes logical intent such as move vector, move-to target, aim, primary, ability, tonic, select, confirm, cancel, and pause. It does not encode `KeyW` or a CSS coordinate. `ObservationV1` contains the minimal semantic state needed by an assertion or gameplay agent: tick/phase, controllable actor, relevant entities, events, action availability, and outcome. `RenderObservationV1` contains viewport/camera plus stable entity/object IDs, sprite/clip/frame identity where applicable, world and screen anchors, destination and ink bounds, depth, visibility, and collision metadata.

| Generic framework owns                                                                                                                                          | Per-game adapter owns                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action-tape schema, replay, generator/shrinker, browser transports, device matrix, temporal/camera analysis, mutations, bundle hashing, reports, review records | State and scenario types, validation and migration, action-to-input mapping, semantic observation projection, renderer projection, entity-mask capture, content-specific invariants and thresholds |

The current `GameTestBridge` should remain the browser transport and become the first adapter implementation. Cinderwake's actor dimensions, clip vocabulary, tile size, collision policy, and scenario builders must stay on the adapter side. Extraction is successful only when a second game implements the interface without importing Cinderwake content.

## Next five concrete framework improvements

1. **Define and conformance-test the adapter protocol.** Add versioned `ActionV1`, `ObservationV1`, and `RenderObservationV1` schemas; wrap the existing bridge; replay one fixture in fresh contexts and require exact per-tick state, event, manifest, and mask hashes.
2. **Add a causal input log and dual-path control contracts.** Give every physical gesture and logical action a correlation ID and consumed tick. Cover world tap versus Strike, keyboard movement, retarget/cancel, ability, tonic, selection, launch, retry, and back with required and forbidden effects.
3. **Add model-based state/action generation with deterministic shrinking.** Begin with collision/navigation and combat lifecycle properties. Check in every minimized failure as an ordinary reproduction fixture before treating it as a regression test.
4. **Upgrade temporal and camera assessment with calibrated mutations.** Add jerk, transition velocity, loop seam, compensated residual, overshoot, and settle-time measurements. Each new check ships with a passing control and a single-defect mutant it must reject.
5. **Create a two-lane mobile evidence and review gate.** Lane A uses pinned-clock deterministic captures across desktop, touch portrait, touch landscape, and WebKit-mobile profiles. Lane B uses the real clock for frame delivery and input latency, with a physical-phone smoke sample before a mobile-quality claim. Changed visual evidence then receives blind independent rubric reviews; uncertainty or disagreement remains a visible rejection/candidate state.

## Source register

- **S1 — Unity Technologies, “Determinism Overview.”** Official engine sample documentation. Fixed timestep, seeded RNG call order, update order, numeric determinism, entity creation, and parallel-order considerations. Accessed 2026-08-24. <https://github.com/Unity-Technologies/ECSGalaxySample/blob/main/_Documentation/determinism.md>
- **S2 — Playwright, “Clock.”** Official documentation for deterministic browser time and animation-frame control. Accessed 2026-08-24. <https://playwright.dev/docs/clock>
- **S3 — Claessen and Hughes, “QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs,” ICFP 2000.** Original property-based testing paper. <https://doi.org/10.1145/1988042.1988046>
- **S4 — Claessen and Hughes, “Testing Monadic Code with QuickCheck,” 2002.** Primary model-based, precondition, and postcondition testing paper. <https://doi.org/10.1145/636517.636527>
- **S5 — Krook et al., “QuickerCheck: Implementing and Evaluating a Parallel Run-Time for QuickCheck,” 2024.** Primary research on parallel property evaluation and deterministic versus greedy shrinking. <https://research.chalmers.se/publication/542175>
- **S6 — Google Research, “Quickly Training Game-Playing Agents with Machine Learning,” and the Falken repository.** Primary project account and implementation documentation for semantic observations/actions and task-specific gameplay agents. Accessed 2026-08-24. <https://research.google/blog/quickly-training-game-playing-agents-with-machine-learning/> and <https://github.com/google-research/falken>
- **S7 — Playwright, “Best Practices” and “Emulation.”** Official user-visible testing, isolation, and device-profile guidance. Accessed 2026-08-24. <https://playwright.dev/docs/best-practices> and <https://playwright.dev/docs/emulation>
- **S8 — Playwright, “Touchscreen.”** Official semantics of browser tap input. Accessed 2026-08-24. <https://playwright.dev/docs/api/class-touchscreen>
- **S9 — Aseprite, “Command Line Interface.”** Official sprite-sheet metadata and deterministic batch-export capabilities. Accessed 2026-08-24. <https://www.aseprite.org/docs/cli/>
- **S10 — Huang et al., “VBench: Comprehensive Benchmark Suite for Video Generative Models,” CVPR 2024.** Primary paper separating motion, flicker, and consistency dimensions. <https://openaccess.thecvf.com/content/CVPR2024/papers/Huang_VBench_Comprehensive_Benchmark_Suite_for_Video_Generative_Models_CVPR_2024_paper.pdf>
- **S11 — Zhang et al., “The Unreasonable Effectiveness of Deep Features as a Perceptual Metric,” CVPR 2018.** Primary LPIPS paper and implementation. <https://richzhang.github.io/PerceptualSimilarity/>
- **S12 — W3C Web Performance Working Group, “Long Animation Frames API,” First Public Working Draft, 2026-04-28.** Primary draft specification; its draft status limits cross-browser authority. <https://www.w3.org/TR/long-animation-frames/>
- **S13 — Playwright, “Visual Comparisons.”** Official warning about screenshot environment variance and baseline handling. Accessed 2026-08-24. <https://playwright.dev/docs/test-snapshots>
- **S14 — Chen et al., “MLLM-as-a-Judge: Assessing Multimodal LLM-as-a-Judge with Vision-Language Benchmark,” 2024.** Primary study of pairwise, scalar, and batch multimodal judging, including reported limitations. <https://arxiv.org/abs/2402.04788>
- **S15 — Verga et al., “Replacing Judges with Juries: Evaluating LLM Generations with a Panel of Diverse Models,” 2024.** Primary text-evaluation study; using its panel result for game visuals is explicitly an inference. <https://arxiv.org/abs/2404.18796>

## Limitations and open questions

- `[OPEN]` Numeric jerk, compensated-residual, frame-delivery, and input-latency thresholds require defect mutations plus accepted Cinderwake references. The sources support the dimensions, not project-specific numbers.
- `[OPEN]` Playwright mobile profiles validate browser behavior, layout, and touch routing but not physical GPU, thermal, display, or touch-sampling performance.
- `[OPEN]` VBench and LPIPS evaluate generated video or image similarity, not authored sprite rigs. They justify decomposition and advisory experiments, not direct adoption of their scores.
- `[OPEN]` The heterogeneous-panel result in S15 concerns language evaluation. Cinderwake must calibrate visual reviewers against owner labels and retain false accepts, false rejects, abstentions, and disagreements before assigning any authority.
- `[OPEN]` Extract the framework only after Cinderwake completes the workflow and a second game reveals which parts are genuinely generic. Until then, portable schemas may live beside Cinderwake without being published as a package.
