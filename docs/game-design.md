# Cinderwake game design

Cinderwake is an original, compact top-down browser action RPG built to be both playable and unusually observable. A run begins at character selection, generates a connected soot-and-crystal ruin from a seed, places enemies and an exit, and ends when the player clears the enemies and reaches the open rift gate—or loses all health.

The shipped vertical slice is intentionally shorter than a commercial ARPG run. It contains enough interacting systems to stress movement, combat, AI, projectiles, loot, animation, camera, and UI tests without making a regression expensive to reproduce.

## Player loop

1. Choose one of three heroes and enter a run seed.
2. Enter a newly generated connected ruin.
3. Explore rooms with keyboard, pointer, or touch controls.
4. Fight three enemy types with a class-specific primary attack and ability.
5. Collect gold, restorative tonics, and weapon-power drops.
6. Clear every enemy to unlock the rift gate.
7. Reach the gate to win. Reaching zero health loses the run.
8. Retry the exact seed or return to character selection.

## Simulation constants

- Simulation frequency: exactly 60 ticks per second.
- World coordinate scale: 1 tile = 1,024 integer units.
- Test render surface: 960 by 540 logical pixels at device scale 1.
- Rendered tile: 48 logical pixels.
- Player collision radius: 320 world units.
- Diagonal normalization: 724/1,024, an integer approximation of `1/sqrt(2)`.
- System order per tick: player command and motion, stable-ID enemy AI, due attacks, projectile motion and hits, death and loot, pickup, exit, transient effects.

Integer authoritative positions prevent accumulating drift in long replays. Rendering may interpolate in a live run but test mode renders an exact tick without interpolation.

## Heroes

| Hero     | Identity                | HP / armor |         Speed | Primary                                                      | Ability                                                               |
| -------- | ----------------------- | ---------: | ------------: | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Vanguard | resilient melee fighter |   160 / 30 | 64 units/tick | 18-damage 90-degree cleave; impact tick +8; 30-tick cooldown | 32-damage wider ember sweep; impact tick +12; 240-tick cooldown       |
| Ranger   | fast ranged marksman    |   105 / 10 | 72 units/tick | 13-damage arrow; spawn tick +6; 24-tick cooldown             | three piercing arrows; spawn tick +10; 270-tick cooldown              |
| Arcanist | fragile area controller |     90 / 5 | 66 units/tick | 15-damage crystal bolt; spawn tick +8; 36-tick cooldown      | 28-damage pulse around the caster; impact tick +12; 300-tick cooldown |

Weapon drops add deterministic power to primary and ability damage. Tonics heal 45 HP and are not consumed at full health.

## Controls

- `WASD` or arrow keys: eight-direction movement.
- Pointer: aim in world space.
- Left mouse or primary action button: primary attack.
- Right mouse or ability action button: class ability.
- `Q`: consume a tonic when injured.
- Test lab controls: pause live time, load a built-in scenario, step exact ticks, export state, and capture a frame sequence.

Browser events update a semantic `InputState`; only a simulation tick consumes it. Tests can therefore inject the same intent without depending on browser event timing, while a smaller Playwright suite still verifies that real keys and pointer buttons map correctly.

## Dungeon

The `dungeon-v1` generator begins with a wall-filled 44 by 32 grid, carves a central entrance room and up to ten non-overlapping rooms, then joins room centers with two-tile-wide L-shaped corridors. The exit is placed at the room center farthest from the entrance by Manhattan distance. Candidate monster tiles must be walkable and more than eight tiles from the spawn.

The generation result includes a stable digest. Tests verify that a seed repeats byte-for-byte, every walkable tile is connected, entrance and exit are walkable, and a different seed changes the layout.

## Enemies

| Enemy      | Behavior                               | HP / armor | Attack                                                      |
| ---------- | -------------------------------------- | ---------: | ----------------------------------------------------------- |
| Ashfang    | closes to melee range                  |     36 / 0 | 8 raw damage, 75-tick cooldown                              |
| Rift Hexer | keeps distance and retreats if crowded |     28 / 0 | hostile crystal projectile, 7 raw damage, 105-tick cooldown |
| Stonekin   | slow, durable pursuer                  |    80 / 20 | 10 raw damage, 110-tick cooldown                            |

AI iterates in sorted entity-ID order and uses only simulation state. The generated run includes one elite Stonekin with doubled health, an amber ring, and a guaranteed drop. Test scenarios can disable AI completely to isolate animation or collision.

## Loot and outcomes

Each monster has an entity-keyed loot stream derived from `run seed + monster ID`. Killing an unrelated monster first therefore cannot change another monster's drop. A drop is gold, a tonic, or a weapon in common, tempered, or relic rarity. The pickup radius is deterministic and pickup emits a typed event.

When the final monster dies, the exit unlocks once and emits `exit_unlocked`. Reaching its center emits `run_won`. Lethal damage emits `player_died` once and freezes active play into `lost`. The HUD and terminal overlay are visual projections of those states.

## Visual language and animation

The original visual identity combines deep charcoal and teal ruins, warm amber heroes and exits, crimson/magenta hostile effects, and pale cyan loot. Generated hero key art is used on character selection; runtime actors are code-rendered from explicit geometry so anchors, hitboxes, proportions, and animation frames are measurable from the first version.

Animation clips are tick-addressable: idle is 6 frames/60 ticks, walk 8/40, primary 6/26, ability 8/36, hurt 4/12, and death 8/48. Every actor is grounded at a bottom-center world anchor. Actors render in stable `(foot Y, entity ID)` order.

## Roadmap beyond the vertical slice

The lead design pass also specified room activation, three Cinder Nodes, dodge invulnerability, equipment slots, five levels, elite modifiers, and a Glass Warden boss. Those systems are intentionally deferred. Adding them before the state, render, and temporal-quality contracts are trustworthy would broaden the number of failures while weakening diagnosis. Each roadmap system should arrive with an injectable scenario, canonical checkpoint, browser control test, and representative frame strip.
