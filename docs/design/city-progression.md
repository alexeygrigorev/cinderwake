# Embercross: wilderness-to-city progression

Status: domain contract, deterministic city runtime, and mobile service UI implemented.

## Player experience

The run begins in the wilderness. Embercross is neither visible on the map nor available as a fast-travel destination. The first path through the game is:

1. Survive the opening wilderness encounter.
2. Follow environmental clues to `landmark:embercross:road-sign`.
3. Discover Embercross and reveal its direction, without teleporting there.
4. Travel to `gate:embercross:south` through a second wilderness section.
5. Enter a safe, persistent city scene.
6. Walk to a visible NPC and interact by tapping the NPC or a context button.

This makes the city something the player earns and finds. Discovery, gate arrival, and entry are separate facts so tests can begin at any one of those boundaries.

## Why the city starts as a pure domain model

`src/game/city.ts` does not read the DOM, render sprites, consult wall-clock time, or draw randomness. Given the same JSON state and command it returns the same next state and receipt. That separation contributes directly to the project goal: an agent can construct “the player is at the merchant with two pelts” without replaying the wilderness, execute a transaction, and inspect a complete machine-readable result.

Expected gameplay rejections are also results, not exceptions. A rejected transaction returns the original state object and a stable error code. Malformed snapshots do throw during restoration, because accepting incomplete state would make scenario tests misleading.

## Stable content

City: `city:embercross` (Embercross)

Buildings and residents:

| Building                        | NPC                                   | Role          | Actions                        |
| ------------------------------- | ------------------------------------- | ------------- | ------------------------------ |
| `building:embercross:market`    | `npc:embercross:mara` (Mara Vale)     | Merchant      | Buy tonics, sell Ashfang pelts |
| `building:embercross:tavern`    | `npc:embercross:oren` (Oren)          | Tavern keeper | Eat stew                       |
| `building:embercross:tavern`    | `npc:embercross:tess` (Tess)          | Innkeeper     | Sleep until dawn               |
| `building:embercross:infirmary` | `npc:embercross:ileya` (Sister Ileya) | Healer        | Restore health                 |

The IDs are persistence and test contracts. Display names can change without invalidating saved state; IDs must not be silently renamed.

Every NPC includes coarse tile placement and the same mobile interaction contract:

- 48 CSS pixel minimum tap target;
- tap the NPC or a context button;
- an approach stop distance smaller than the interaction radius;
- a thumb-reachable bottom sheet;
- explicit confirmation for anything that spends gold or time.

The context button is important when a character sprite is partly occluded by a crowd or building. It must identify the nearby NPC with a portrait sprite and action, rather than relying on tiny text alone.

## Progression state machine

```text
undiscovered
  -- road-sign discovery --> discovered
  -- no direct transition --> inside

discovered
  -- reach south gate --> at_gate

at_gate
  -- enter south gate --> inside
```

Each accepted transition records its simulation tick and appends a stable event. A command with a tick older than the city state is rejected. The timestamps make progression observable in replays and prevent state from appearing to travel backward in time.

The runtime should derive progression signals from deterministic trigger footprints:

- overlap with the road-sign discovery trigger;
- overlap with the south-gate arrival trigger;
- explicit tap/confirm at the gate, followed by scene transition.

Walking near the city boundary must not implicitly discover or enter it. The landmark and gate should both be visually unmistakable sprite compositions, with trigger areas contained inside the visible footprint.

## Service rules

All services require the traveler to be inside the city, close to the correct NPC, and not currently threatened. Quantities are integral and bounded to 1–20. Tavern, inn, and healer actions have quantity one.

| Action ID                    | Cost / proceeds                         | Preconditions                      | State change                                                                           |
| ---------------------------- | --------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `merchant:buy-tonic`         | 18 gold each                            | Player funds and merchant stock    | Player gold decreases, tonic count increases, merchant cash increases, stock decreases |
| `merchant:sell-ashfang-pelt` | 9 gold each to player                   | Player inventory and merchant cash | Pelt quantity decreases, player gold increases, merchant cash decreases                |
| `tavern:eat-stew`            | 6 gold                                  | Hunger above zero                  | Hunger drops by up to 45; health restores by up to 15                                  |
| `inn:sleep-until-dawn`       | 20 gold                                 | Fatigued or injured                | Health and fatigue restore; hunger rises by 25; world time advances to the next 07:00  |
| `healer:restore-health`      | max(6, 3 per started 10 missing health) | Health below maximum               | Health restores to maximum                                                             |

Each accepted service appends a receipt with a deterministic sequence ID, the exact unit and total price, and every state delta. Receipts are intended for UI confirmation, replay assertions, economy audits, and future save migrations.

## Scenario and reproducibility contract

`CityStateV1` is composed only of JSON data. `restoreCityState` validates and clones an exact state; it does not fill omitted values. This supports precise scenarios such as:

- city undiscovered with the player at the road sign;
- city discovered but gate not yet reached;
- player inside and near Mara with specified stock, funds, and inventory;
- player threatened while a service panel is open;
- player injured beside the healer;
- player at the inn at an arbitrary time of day.

A scenario runner should store the city state beside `GameState`, not hide it in UI state. State capture should include the current city location phase, interaction context, NPC stock, traveler needs, events, and receipts. Replaying a command from a captured snapshot must produce byte-equivalent JSON.

## Runtime integration points

The pure domain is integrated into versioned shared state. Remaining runtime work uses these focused integration points:

1. **Save/scenario schema (complete):** GameState v2 requires `city: CityStateV1`; ScenarioV1 accepts an exact override; canonical capture, hashes, replay restoration, and the documented legacy-v1 migration include it.
2. **World progression (complete):** deterministic road-sign and gate overlaps emit `transitionCityProgression` signals and load Embercross after entry.
3. **Player adapter (complete):** `GameHost.executeNearbyCityAction` copies player gold, health, maximum health, and tonics into the city traveler, executes the atomic receipt, then mirrors those fields back to the live player.
4. **Proximity adapter (complete):** each simulation tick, loaded state, and service action derives `nearbyNpcId` from the configured interaction circles with distance/ID tie-breaking. Active monsters mark services unsafe.
5. **Input/UI (complete):** an explicit sprite-glyph context action is shown for the nearby resident. Its mobile bottom sheet has 48 CSS pixel minimum buttons and retains deterministic completion or rejection feedback.
6. **Rendering (controlled integration complete):** the exact reviewed V3 atlas supplies the market, tavern, infirmary, open gate, road sign, and bed/food cluster. Compatible authored props build the square and service approaches; four residents use the directional actor system. Every city footprint is projected inside its tight sprite ink, and the gate uses two pier footprints with no center collider. Distinct resident art remains later polish, not a hidden acceptance claim.

## Test and visual acceptance criteria

The unit suite covers state progression, each service, rejection without mutation, stable mobile affordances, strict restoration, and identical commands from JSON-restored arbitrary state.

Runtime integration is not accepted until browser and temporal tests add the following evidence:

- A production input sequence discovers the sign, reaches the gate, and enters the city; observer state and frames agree at every transition.
- Ground tap, NPC tap, and service confirmation are distinct mobile gestures. Tapping empty ground never attacks or opens a service.
- Every action button changes the expected state or returns a visible rejection; no inert controls.
- NPC approach stops inside interaction range without walking through the NPC, counter, doorway, or building.
- The service panel remains usable in portrait and landscape with at least 48 CSS pixel targets and no clipped confirm button.
- City sprites render at uniform aspect ratio and sufficient device-pixel backing resolution. No NPC, building, or prop is stretched.
- Walking characters face and animate in their movement direction while the camera and city scenery scroll coherently.
- A frame sequence shows stable NPC feet and building anchors with no one-frame jumps, crop changes, or sprite-cell leakage.
- Each solid footprint is legible from the visible sprite. A blocked movement attempt shows immediate sprite-based contact feedback at the visible obstacle.
- Tavern eating, inn sleep, healing, buying, and selling each have before/action/after frame sequences plus machine-readable receipts.

Visual captures should use stable city scenarios rather than replaying discovery for every assertion. The complete wilderness-to-city route remains one end-to-end production-gesture test; narrower service tests start from exact city JSON states.

The current browser boundary covers all five service buttons from restored JSON, exact receipts and live-player synchronization, 48-pixel targets, rejected transactions, portrait/landscape containment, reviewed sprite asset IDs, three idle-animation samples, fixed building/NPC destinations, and deterministic screenshot baselines. A separate observe-only DPR-3 mobile journey now uses physical taps and joystick streams to discover the solid road sign, update the objective, reach the gate, swap maps, and retain ordered frames at all three boundaries. NPC-tap auto-approach remains open.
