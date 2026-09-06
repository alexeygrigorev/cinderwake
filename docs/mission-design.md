# The Last Bell

Embercross's bell keeper tried to call his daughter back from the dead. The
rift answered with a host of creatures. Sister Ileya's sealed letter gives the
traveler a purpose on arrival: silence the host and carry the warning home.
The first chapter ends when the traveler returns to Embercross's south gate
and seals the rift.

This is an original short action RPG chapter using the existing ruin, elite,
road sign, city, and service residents. Its duration should be measured in a
normal playthrough; the mission count is not evidence of ten minutes of play.

| Beat                    | Required action                               | Direction and payoff                                                                     |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Break the ambush        | Defeat the two arrival attackers              | The letter explains travel and combat; the marker points to a live threat.               |
| Silence the Bell Keeper | Defeat the elite and every remaining follower | The named elite gives the hunt a focus; kills yield experience and supplies.             |
| Carry the warning       | Reach the road sign, then enter the open gate | The marker changes from enemies to the sign, then to the gate.                           |
| Seal the night          | Return to Embercross's south gate             | Residents offer context and optional services; sealing the rift gives a definite ending. |

Mara explains pelts and tonics. Oren points toward Tess. Tess describes rest
and saving. Ileya explains why the bell keeper opened the rift and directs the
player to the south gate. Buying a service, receiving a particular loot roll,
or opening a dialogue is never required to finish the chapter. A penniless
traveler can win.

The arrival letter occupies the safe spawn anchor. The sign and residents
reuse their existing world positions. These are readable journal discoveries;
the mission module does not invent scenery collision or a separate map.

## Implementation contract

`src/game/missions.ts` exports `missionJournal(state)`,
`missionLandmarks(state)`, and `missionNpcDialogue(npcId, state)`. All positions
are integer world units. Cue IDs identify existing actors, landmarks, gates,
or the arrival letter. The nearest living enemy supplies the combat direction;
equal distances use stable actor IDs. The client can route toward that world
target using the normal navigation system.

Progress is derived from authoritative simulation state. Opening deaths use
`monster:00` and `monster:01` death records, including retained corpses. Missing
actors alone do not count as kills. The full clear flag and city map establish
later progress, so removing dead actors or restoring a snapshot does not
restart a completed objective. Victory is required to complete the final beat;
death supplies recovery copy without completing unfinished objectives.

The mission module is pure and adds no fields to `GameState`. Save envelopes
can store journal read IDs alongside an exact state snapshot. Save/load UI and
storage are owned by the client. The chapter does not require a paid inn stay
to save.

Six stable voice IDs and their exact scripts live in `MISSION_VOICE_LINES`.
The audio runtime maps those IDs to generated assets. Reading the same text
should not repeatedly interrupt combat with the same voice line; the client
controls replay and mute behavior.

## Feedback requirements

Unit coverage verifies observed opening kills, despawn and snapshot
persistence, sign-to-gate directions, a reachable zero-gold victory, and pure
world-space cues. Browser feedback must additionally prove a player can read
the letter, follow objectives, save and resume, interact with a resident, and
reach the final gate using real controls. Passing these checks establishes the
chapter's reachable behavior; combat pacing, directional clarity, and visual
quality still need rendered playthrough evidence.
