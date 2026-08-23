# Scenario authoring

`ScenarioV1` is the supported way to begin Cinderwake from a precise state. A loader validates the whole object and constructs a fresh world; tests never patch a running world. This guarantees that a reset clears old entities, input, timers, effects, event buffers, camera state, and random streams.

## Schema

```ts
interface ScenarioV1 {
  schemaVersion: 1;
  id: string;
  seed: string;
  classId: "vanguard" | "ranger" | "arcanist";
  map:
    | { mode: "generated"; width?: number; height?: number }
    | { mode: "explicit"; rows: string[] }; // # wall, . floor, P player, E exit
  player?: {
    tile?: [number, number];
    health?: number;
    facing?: [number, number];
    power?: number;
  };
  monsters?: Array<{
    id?: string;
    kind: "ashfang" | "hexer" | "stonekin";
    tile: [number, number];
    health?: number;
    elite?: boolean;
    guaranteedLoot?: boolean;
  }>;
  loot?: Array<{
    id?: string;
    kind: "gold" | "tonic" | "weapon";
    rarity?: "common" | "tempered" | "relic";
    tile: [number, number];
    amount?: number;
  }>;
  settings?: { ai?: boolean; autoPickup?: boolean; cameraFollow?: boolean };
}
```

Decimal tile coordinates are allowed for exact range boundaries. Generated maps may omit monsters to receive the standard seeded population. An explicit empty `monsters: []` means no monsters.

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

## Authoring workflow

1. Start with the smallest explicit map and fewest entities that demonstrate the behavior.
2. Disable AI or auto-pickup unless it is the subject of the test.
3. Pin seed, hero, positions, health, facing, power, and entity IDs.
4. Express input changes at exact ticks; avoid sleeps.
5. Capture state, state hash, render manifest, and PNG at named ticks.
6. Inspect the generated frame report, especially the foot crosshair and continuity analysis.
7. Preserve the scenario as a regression fixture when it catches a real defect.

Useful boundary scenarios include one-health death, attack exactly at range, projectile beside a wall, loot beneath an actor, two actors at equal foot Y, a player at each map edge, camera following sustained diagonal motion, cooldown with one tick remaining, and a terminal win/loss reset.
