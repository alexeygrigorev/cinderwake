# Cinderwake

[Play the public build](https://alexeygrigorev.com/cinderwake/) · [Open the public quality report](https://alexeygrigorev.com/cinderwake/quality/)

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

Choose Vanguard, Ranger, or Arcanist, enter a repeatable seed, clear the generated ruin, collect deterministic drops, and enter the opened rift. Use WASD or arrow keys to move, the pointer to aim, left click to strike, right click for the class ability, and Q to drink a tonic. The interface also works with touch action buttons.

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

Each run writes exact frames, close-ups, state history, render-manifest history, metadata, a contact sheet, an HTML report, and `animation-analysis.json` under `quality-results/sequences/<scenario>/`. This root is intentionally separate from Playwright's disposable `test-results/`, so running browser tests after a capture cannot erase temporal evidence. The assessor rejects anchor jitter, position/velocity disagreement, uneven speed, frame skips, one-shot backward frame jumps, changing proportions, and clipping. Screenshot baselines are updated only after reviewing the changed frame sequence:

```bash
npm run test:visual:update
npm run test:visual
```

Each reproducibility bundle also includes `initial-state.json`, `commands.json`, transparent `mask-*.png` images, page captures, and metadata for the commit, Node, Chromium, Playwright, Vite, canvas/viewport/DPR, and exact command. Masks are rendered in isolation and measured from real alpha pixels, providing concrete evidence for ink bounds, centroid, foot relation, proportions, and clipping.

## Display, touch, and public evidence

Simulation advances only in whole 60 Hz ticks. Live display may interpolate previous/current state and camera, but test captures use `interpolationAlpha: 1` and deterministic snap camera by default; manifests name the simulation/presentation tick, alpha, camera target, and mode. The touch layout maps a pointer-captured movement pad, canvas aim, and large primary/ability/tonic buttons into the same semantic input consumed by keyboard/pointer tests, with responsive targets kept in the viewport.

The public quality report catalogs 21 explicit sequences: locomotion in four directions; quarter-tick mobile interpolation; primary and ability actions for all three heroes; attacks for all three enemy families; enemy death/despawn; projectile travel plus a separate hit/effect/despawn lifecycle; a complete loot-bob loop; smooth camera convergence; and win/loss presentation. Each card links to its state, command tape, raw canvas, isolated mask, composed page, contact sheet, metadata, measurements, and exact reproduction command. This is broad coverage of the shipped vertical slice, not a claim about unimplemented future systems; the matrix must grow with every shipped system.

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
- [Chronological development decisions](docs/development-log.md)
- [Architecture decision records](docs/decisions/)

CI publishes the tested game and its latest Playwright and temporal frame-sequence reports together on GitHub Pages. Every artifact therefore points back to the same commit and can be reproduced with the command recorded in its metadata.
