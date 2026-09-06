# Cinderwake

[Play the public build](https://alexeygrigorev.com/cinderwake/) · [Open the public quality report](https://alexeygrigorev.com/cinderwake/quality/) · [Inspect screen acceptance](https://alexeygrigorev.com/cinderwake/quality/screens/) · [Inspect actor animation evidence](https://alexeygrigorev.com/cinderwake/quality/actor-atlas-audit/)

Cinderwake is an original browser action RPG and, more importantly, a reference framework for testing games from arbitrary state. A test can load a complete JSON world, apply semantic input at exact 60 Hz ticks, then retain three synchronized forms of evidence:

1. a canonical state snapshot and hash proving what the game did;
2. a semantic render manifest explaining every actor's clip, frame, anchors, bounds, layer, and camera transform;
3. PNG frames and contact sheets showing whether the result actually looks natural over time.

![The three original Cinderwake heroes](public/assets/cinderwake-heroes.png)

## Play

```bash
npm ci
npm run dev
```

Choose Vanguard, Ranger, or Arcanist, enter a repeatable seed, clear the generated ruin, collect deterministic drops, and enter the opened rift. Use WASD or arrow keys to move, the pointer to aim, hold left click or Space to strike repeatedly, right click or E for the class ability, and Q to drink a tonic. Aim stays on the cursor while moving. Touch players can hold Strike and use the movement pad to face their target. Buildings and solid props block both heroes and monsters at their painted ground footprint; movement slides along their base instead of passing through the sprite.

This project takes inspiration from the readable top-down combat loop of classic action RPGs, but its world, characters, enemies, art, names, and implementation are original.

## Test any state

Open the browser with `?testMode=1`; the deliberately narrow `window.__GAME_TEST__` bridge is then available. It accepts a built-in scenario name, a `ScenarioV1` object, or its JSON string.

```ts
window.__GAME_TEST__.loadScenario(myScenario);
window.__GAME_TEST__.queueInputs([
  { tick: 120, input: { moveX: 1 } },
  { tick: 132, input: { attack: true } },
  { tick: 133, input: { attack: false } },
]);

const stateAtImpact = window.__GAME_TEST__.step(20, { render: true });
const stateHash = window.__GAME_TEST__.stateHash();
const geometry = window.__GAME_TEST__.renderManifest();
const png = window.__GAME_TEST__.captureFrame();

window.__GAME_TEST__.loadState(savedGameState); // exact complete GameState
window.__GAME_TEST__.reset(); // rebuild last source and clear live/queued input
```

The scenario schema can inject the tick and phase; player and enemy transforms, velocities, health, cooldowns, and animation locks; active attacks, projectiles, loot, and effects; RNG stream states; metrics; exit state; and event history. Loading validates and constructs a fresh world instead of patching a running one, so old timers, inputs, and entities cannot leak into the next test. `loadState(GameState | JSON)` likewise reconstructs a complete persisted world, and `reset()` reloads the last scenario or state. See [scenario authoring](docs/scenario-authoring.md) and the [complete fixture](public/scenarios/arbitrary-state.json).

## Quality workflow

For a short model-facing feedback loop, run `npm run feedback`. It checks actual
movement and damage, replay consistency, and physical desktop/phone controls for
all three heroes. Each run produces a compact failure report, state/input replay
data, and images under `quality-results/feedback/`, including when checks fail.
See [the model feedback workflow](docs/model-feedback.md) for an agent task,
custom behavioral expectations, and focused reruns. Passing checks do not approve
visual quality; the report keeps that review explicit.

```text
ScenarioV1 + exact input tape
            │
            ▼
 deterministic 60 Hz simulation
       ┌────┼────────────┐
       ▼    ▼            ▼
   state   render       PNG sequence
   hash    manifest     + contact sheet
       │    │            │
       └────┼────────────┘
            ▼
 invariants + pixel baselines + visual review
```

Run every source-level gate:

```bash
npm run check
```

That command includes the fixed actor validator, exhaustive actor-animation audit, deterministic mobile-selection rebuild, generation-ingress verifier, calibrated high-DPR crispness probe, and live compositor probe. The animation audit checks all 144 actor/clip/facing banks, 720 authored-facing comparisons, and four injected negative controls; its inspectable strips and report are written to `quality-results/actor-atlas-audit/index.html`. The generation verifier preserves exact prompt/reference/candidate hashes for three fresh trials, passes each candidate through the real packer without touching production, and rebuilds the complete Vanguard, Ranger, and Stonekin atlases twice to prove byte equality with the committed runtime art. The crispness probe writes its ordinary-launch, DPR projection, full-resolution motion, crop calibration, and two negative-control artifacts to `quality-results/render-resolution/pres-crisp-006/`; native-device capture and visual review remain explicit checklist gates. `npm run test:flicker` retains ordinary-route actor strips and per-actor cadence evidence under `quality-results/compositor/pres-flicker-024/`; its temporal companion audit applies six PNG-level compositor mutations. Its local report is `quality-results/generation-pipeline/index.html`.

The visible-sprite provenance probe is also part of `npm run check` and CI. Run
`npm run test:sprite-provenance` directly to audit the production selection,
gameplay, Test Lab, terminal, and Embercross service surfaces at desktop and
phone-portrait profiles. It retains the DOM/text/title, CSS/pseudo-element,
canvas, manifest, decoded-asset, state, and frame inventory under
`quality-results/visible-sprite-provenance/pres-sprite-009/`; the Pages build
publishes that bundle at `/quality/visible-sprite-provenance/`.

`npm run report:screens` builds the 16-image public screen matrix. The report becomes accepted only when the committed independent-review record matches both the screen-contract hash and the ordered screenshot-set hash; any changed viewport, rule, landmark, or PNG automatically returns it to candidate status.

Run the real Chromium input and visual suite:

```bash
npx playwright install chromium
npm run test:e2e
```

Generate a self-contained sequence report and machine-readable assessment:

```bash
npm run capture:sequence -- --scenario animation-walk --frames 16 --step 2
npm run capture:sequence -- --scenario combat-loot --action attack --frames 16 --step 2
npm run capture:matrix
```

The matrix writes `quality-results/sequences/index.json` after every entry, so
an interrupted browser run can be recovered without discarding completed
evidence. Use `npm run capture:matrix -- --resume` to retain complete passing
entries from the exact current source state, or rerun a named subset with
`npm run capture:matrix -- --only camera-smooth-follow,city-entry`. A selective
run preserves the other catalog entries and still reports the full 26-entry
catalog as incomplete until every entry passes.

Each run writes exact frames, close-ups, state history, render-manifest history, metadata, and `animation-analysis.json` under `quality-results/sequences/<scenario>/`; passing runs then add a contact sheet and HTML report. A failing assessment exits nonzero while preserving its raw browser evidence and named failed checks. This root is intentionally separate from Playwright's disposable `test-results/`, so running browser tests after a capture cannot erase temporal evidence. The assessor rejects anchor jitter, position/velocity disagreement, uneven speed, frame skips, one-shot backward frame jumps, changing proportions, clipping, and idle/walk median visible-height differences above 8 logical pixels. Screenshot baselines are updated only after reviewing the changed frame sequence:

```bash
npm run test:visual:update
npm run test:visual
```

Each reproducibility bundle also includes `initial-state.json`, `commands.json`, transparent `mask-*.png` images, page captures, and metadata for the commit, Node, Chromium, Playwright, Vite, canvas/viewport/DPR, and exact command. Masks are rendered in isolation and measured from real alpha pixels, providing concrete evidence for ink bounds, centroid, foot relation, proportions, and clipping.

For responsive raster evidence, `npm run test:crispness` retains the physical
canvas PNG, the CSS/backing/DPR projection, player and terrain crops at their
captured resolution, and a Gaussian-blurred counterpart for each crop. Its
normalized detail-retention calibration is reproducible from the retained
`comparison.json`; it does not turn a screenshot viewer zoom into evidence of
native-device sharpness.

## Add characters without custom animation code

Every actor uses the same six 4 × 4 semantic source families: primary identity/east movement, north/south movement, east actions, east reactions, north/south actions, and north/south reactions. Generated rasters are normalized onto a fixed 1024 × 1024 contract grid, then every frame is keyed, jointly scaled, grounded, and packed into the same 128-pixel-cell runtime atlas. New characters therefore inherit clip order, cadence, anchors, cardinal-facing behavior, and tests from metadata instead of adding bespoke crop logic.

The [character generation guide](art/generation/README.md) gives exact cell positions, prompt/reference provenance rules, three same-style example prompts, the safe non-destructive trial workflow, and production-promotion gates. Prompt preservation makes the request auditable; immutable accepted source hashes and the deterministic packer make builds reproducible.

The same guide records the separate production selection-art contract. `npm run art:selection:check` regenerates all three mobile WebP scenes from immutable source PNGs and proves their bytes match. To test the ordinary player path while retaining the state bridge, open `?testMode=1&selection=1`; this is also the route used by the browser test that selects a hero, starts the game, and exercises every touch action.

## Display, touch, and public evidence

Simulation advances only in whole 60 Hz ticks. Live display may interpolate previous/current state and camera, but test captures use `interpolationAlpha: 1` and deterministic snap camera by default; manifests name the simulation/presentation tick, alpha, camera target, and mode. The touch layout maps a pointer-captured movement pad, canvas aim, and large primary/ability/tonic buttons into the same semantic input consumed by keyboard/pointer tests, with responsive targets kept in the viewport.

The public quality report catalogs 26 explicit sequences: locomotion in four directions; quarter-tick mobile interpolation; Ashfang and Arcanist idle→east-walk→idle transitions on the real generated opening floor; primary and ability actions for all three heroes; north-facing Ranger and south-facing Arcanist action regressions; attacks for all three enemy families; enemy death/despawn; projectile travel plus a separate hit/effect/despawn lifecycle; a complete loot-bob loop; smooth camera convergence; the wilderness-to-Embercross transition; and restored win/loss terminal presentation. The production camera recorder additionally covers smooth edge/reversal, west/south edge traversal, diagonal/corner, and stop routes alongside fixed and snap follow modes on desktop and portrait profiles. Each card links to its state, command tape, raw canvas, isolated mask, composed page, contact sheet, metadata, measurements, and exact reproduction command. The pre-won fixture still checks arbitrary-state restoration and the terminal overlay, while the production city route now proves reachable victory at the return gate. This is broad coverage of the shipped vertical slice, not a claim about unimplemented future systems; the matrix must grow with every shipped system.

## Source quality standards

- Authored TypeScript, JavaScript, CSS, HTML, JSON, and Markdown stay formatted and human-readable.
- The production Vite build explicitly disables JavaScript and CSS minification and emits source maps, so the published artifact is inspectable too.
- Strict TypeScript, ESLint, Prettier, unit tests, browser tests, and visual tests run in CI.
- Simulation code never reads wall-clock time or `Math.random()`; random domains use named seeded streams.
- Rendering cannot mutate gameplay state, and browser events become semantic input before simulation consumes them.
- A changed tolerance, schema, baseline, or animation rule must be documented and committed as a focused decision.

## Documentation

- [Game design and rules](docs/game-design.md)
- [Testing architecture](docs/testing-architecture.md)
- [Animation quality model and thresholds](docs/quality-model.md)
- [Scenario authoring guide](docs/scenario-authoring.md)
- [Character generation and validation guide](art/generation/README.md)
- [Sprite art pipeline](docs/art-pipeline.md)
- [Screen test and review playbook](docs/screen-test-playbook.md)
- [Reusable opening composition contract](docs/opening-composition-contract.md)
- [AI-driven reusable game workflow research](docs/research/ai-driven-game-development-2026.md)
- [Chronological development decisions](docs/development-log.md)
- [Architecture decision records](docs/decisions/)

CI publishes the tested game and its latest Playwright and temporal frame-sequence reports together on GitHub Pages. Every artifact therefore points back to the same commit and can be reproduced with the command recorded in its metadata.
