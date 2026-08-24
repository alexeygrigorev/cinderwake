# Scenario authoring

`ScenarioV1` is the supported way to begin Cinderwake from a precise state. A loader validates the whole object and constructs a fresh world; tests never patch a running world. This guarantees that a reset clears old entities, input, timers, effects, event buffers, camera state, and random streams.

When debugging a failure that has already progressed beyond a convenient declarative setup, persist the canonical full `GameState` and use `loadState(stateOrJson)`. It reconstructs the snapshot and becomes the reset source; this is not a merge onto the running state. Pair it with a `ReplayTapeV1` in `commands.json` so a report carries its exact before-state and input history.

## Schema

```ts
interface ScenarioV1 {
  schemaVersion: 1;
  id: string;
  seed: string;
  classId: "vanguard" | "ranger" | "arcanist";
  tick?: number;
  phase?: "playing" | "won" | "lost";
  nextEntityId?: number;
  map:
    | { mode: "generated"; width?: number; height?: number }
    | { mode: "explicit"; rows: string[] }; // # wall, . floor, P player, E exit
  player?: {
    tile?: [number, number];
    previousTile?: [number, number];
    velocity?: [number, number];
    health?: number;
    maxHealth?: number;
    facing?: [number, number];
    radius?: number;
    armor?: number;
    moveSpeed?: number;
    attackDamage?: number;
    abilityDamage?: number;
    attackReadyTick?: number;
    abilityReadyTick?: number;
    invulnerableUntilTick?: number;
    level?: number;
    xp?: number;
    gold?: number;
    tonics?: number;
    power?: number;
    animation?: AnimationSpec;
  };
  monsters?: Array<{
    id?: string;
    kind: "ashfang" | "hexer" | "stonekin";
    tile: [number, number];
    previousTile?: [number, number];
    velocity?: [number, number];
    facing?: [number, number];
    health?: number;
    maxHealth?: number;
    armor?: number;
    moveSpeed?: number;
    attackDamage?: number;
    attackRange?: number;
    attackReadyTick?: number;
    elite?: boolean;
    guaranteedLoot?: boolean;
    animation?: AnimationSpec;
  }>;
  loot?: Array<{
    id?: string;
    kind: "gold" | "tonic" | "weapon";
    rarity?: "common" | "tempered" | "relic";
    tile: [number, number];
    amount?: number;
    sourceId?: string;
    bobOffset?: number;
  }>;
  pendingAttacks?: PendingAttackSpec[];
  projectiles?: ProjectileSpec[];
  effects?: EffectSpec[];
  exitUnlocked?: boolean;
  rng?: Partial<Record<"map" | "combat" | "loot" | "cosmetic", RngSpec>>;
  events?: GameEvent[];
  eventLog?: GameEvent[];
  metrics?: Partial<GameMetrics>;
  settings?: { ai?: boolean; autoPickup?: boolean; cameraFollow?: boolean };
  city?: CityStateV1; // exact override; no partial city patching
}

interface AnimationSpec {
  clip: "idle" | "walk" | "attack" | "ability" | "hurt" | "death";
  startedAtTick?: number;
  lockedUntilTick?: number;
}
```

The auxiliary `PendingAttackSpec`, `ProjectileSpec`, `EffectSpec`, event, metrics, and RNG fields mirror their serializable engine types; the authoritative TypeScript definition is [`src/testkit/scenarios.ts`](../src/testkit/scenarios.ts). A complete injected example is [`public/scenarios/arbitrary-state.json`](../public/scenarios/arbitrary-state.json).

Decimal tile coordinates are allowed for exact range boundaries. Tile values are converted to integer world coordinates during construction; raw velocity, facing, radius, damage range, and other vectors use integer world units. Generated maps may omit monsters to receive the standard seeded population. An explicit empty `monsters: []` means no monsters.

ScenarioV1 remains version 1, but it now constructs GameState schema version 2. Omitting `city` calls `createInitialCityState({ tick: scenario.tick ?? 0 })`, which starts with Embercross undiscovered; supplying `city` requires a complete valid `CityStateV1`, clones it exactly, and requires its tick not to exceed the game tick. Full GameState v2 snapshots must contain a valid city and never receive missing-field defaults. The snapshot loader has one explicit compatibility path for historical GameState v1 captures: it adds an undiscovered initial city at the captured game tick. A v1 snapshot that already contains a `city` field is ambiguous and rejected.

## Example: exact combat and loot state

```json
{
  "schemaVersion": 1,
  "id": "vanguard-hit-and-loot",
  "seed": "scn-loot-0301",
  "classId": "vanguard",
  "map": {
    "mode": "explicit",
    "rows": [
      "############",
      "#..........#",
      "#...P.E....#",
      "#..........#",
      "############"
    ]
  },
  "player": { "tile": [4, 2], "facing": [1024, 0], "power": 8 },
  "monsters": [
    {
      "id": "monster:target",
      "kind": "ashfang",
      "tile": [5.2, 2],
      "health": 20,
      "elite": true,
      "guaranteedLoot": true
    }
  ],
  "settings": { "ai": false, "autoPickup": true, "cameraFollow": true }
}
```

Load this fixture, hold primary attack at tick 0, and capture ticks 0, 4, 8, 12, 20, and 28. The state contract proves the attack starts, damage occurs on the declared impact tick, the enemy dies once, deterministic loot appears, and pickup changes the inventory statistic. The manifest and images prove that pose timing, weapon geometry, layering, and foot anchor agree with that state.

## Command tapes

A version-1 replay contains sorted changes to semantic input:

```json
{
  "version": 1,
  "scenarioId": "vanguard-hit-and-loot",
  "entries": [
    { "tick": 0, "input": { "attack": true } },
    { "tick": 1, "input": { "attack": false } },
    { "tick": 20, "input": { "moveX": 1 } },
    { "tick": 36, "input": { "moveX": 0 } }
  ],
  "checkpoints": []
}
```

Replay tests use exact engine ticks. Browser tests may queue the same entries through `window.__GAME_TEST__`. A separate adapter test should send real keys and pointer events to confirm that physical controls produce the same semantic inputs.

## Browser bridge reference

| Method                                            | Purpose                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `loadScenario(nameOrJson)`                        | validate, construct, and render a fresh complete world                   |
| `loadState(gameStateOrJson)`                      | reconstruct an exact full GameState; retain it as reset source           |
| `reset()`                                         | reconstruct the last loaded scenario and clear queued/live input         |
| `setInput(partial)` / `clearInput()`              | set semantic input without browser-event timing                          |
| `queueInputs(entries)`                            | schedule input changes at exact state ticks                              |
| `step(ticks, { render, useBrowserInput })`        | advance exact ticks, optionally sampling the real browser adapter        |
| `snapshot()` / `stateHash()` / `drainEvents()`    | capture behavior evidence                                                |
| `render()` / `renderManifest()`                   | capture deterministic drawing intent                                     |
| `captureFrame()` / `captureSequence(targetTicks)` | capture PNG data at the same states represented by snapshot and manifest |

## Authoring workflow

1. Start with the smallest explicit map and fewest entities that demonstrate the behavior.
2. Disable AI or auto-pickup unless it is the subject of the test.
3. Pin seed, hero, positions, health, facing, power, and entity IDs.
4. Express input changes at exact ticks; avoid sleeps.
5. Capture state, state hash, render manifest, and PNG at named ticks.
6. Inspect the generated frame report, especially the foot crosshair and continuity analysis.
7. Preserve the scenario or full initial state, `commands.json`, metadata, masks, and images as one reproducibility bundle when it catches a real defect.

Useful boundary scenarios include one-health death, attack exactly at range, projectile beside a wall, loot beneath an actor, two actors at equal foot Y, a player at each map edge, camera following sustained diagonal motion, cooldown with one tick remaining, and a terminal win/loss reset.
