# Player experience requirements for every game

This contract preserves the user's feedback from 7 September 2026. Apply it to
each new game adapter, including puzzle, platform, strategy, racing and action
games. The examples below describe Cinderwake defects; the requirements concern
what players can understand and do in any game.

| Requirement                                | Automatic evidence                                                                                                                                                 | Separate review task                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The next action is obvious                 | Launch from the public route; verify accessible button names, selected state, visible bounds, readable text and live input                                         | Identify what to press without reading implementation notes. Flag decoration that resembles controls, ambiguous wording, hidden controls or competing primary actions.                                                |
| Controls are readable on supported screens | Measure text at least 14 CSS px, primary action at least 18 px, actionable touch bounds at least 44 px, overflow and overlap; exercise keyboard and touch          | Inspect desktop, portrait and landscape at actual size. Read the labels, explain movement and actions, and locate the current objective.                                                                              |
| Audio actually plays                       | On the first Start/Continue gesture require a running context and nonzero signal after master gain; decode each asset, exercise cues, mute and restore preferences | Listen to music and effects in real play. Check whether cues match actions, music fits the game, repetition is tolerable and important sounds remain distinct. A visual agent cannot certify listening from PNGs.     |
| Scene objects communicate their role       | Decode assets; scan cell boundaries and pale alpha fringes; join visible obstacles to collision geometry                                                           | Inspect scene context and closeups over light/dark backgrounds. Identify barriers and openings without filenames. Flag white fringes, checkerboards, detached debris and floor markings mistaken for walls or fences. |
| Actions face and move correctly            | Join input, aim, position, velocity, source-art direction, rendered rotation/reflection, collision and effect lifecycle                                            | Use ordered frames to identify the painted front/tip, emission point, travel, contact and recovery. Check all supported directions. Ask for denser flight frames when the result cannot be judged.                    |
| Progress can be recovered                  | Save, reload a fresh page, compare restored state; test unavailable storage, bad import, export/import and completed state                                         | Find Continue, Save and Download without instructions. Read where progress is stored, last-save status and failure messages. Do not imply cloud sync when only local storage exists.                                  |

The current browser regression examples are `interface-readability.spec.ts`,
`audio-playback.spec.ts`, `save-storage.spec.ts` and `ui-text-contract.spec.ts` in
`tests/e2e`. Directional capture and review use the commands and generic format
in [action-visual-review.md](action-visual-review.md). Saving behavior and storage
tradeoffs are in [game-saving.md](game-saving.md).

New adapters must enumerate their own actions and meaningful directions. A
platformer jump may need left/right plus takeoff, apex and landing. A puzzle
rotation may need clockwise/counterclockwise, before/after and undo. A racing
game may need steering, braking and collisions at multiple speeds. Use each
game's authoritative action registry to check coverage instead of copying RPG
action names.

Every review prompt names the intended input, expected visible outcome, ordered
frames, exact questions and failure criteria. Reviewers return PASS, FAIL or
UNCERTAIN per case and cite the frames they inspected. Fix failures, improve
uncertain captures, then recapture and review. Keep automatic checks separate:
neither an aesthetic judgment nor a numeric PASS can replace the other.

The former rule that all interface copy must be raster artwork is superseded.
Use semantic text and clear CSS button surfaces for interface copy. Keep raster
provenance checks for game artwork. Validate legibility and input behavior as
their own requirements; a decorative asset hash does not establish either.
