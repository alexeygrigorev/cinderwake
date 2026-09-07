# Saving progress

Open **Journal · J** and choose **Save checkpoint** to preserve a manual
checkpoint, or **Save and leave** to return to character selection after saving.
The journal shows when each slot was saved and the character's level. **Continue
journey** loads the newest valid manual or automatic checkpoint.

Saves live in this browser's site storage on this device. They are not uploaded
to a server, an account, or a cloud drive. Another browser or device will not
have them. A different site address, protocol, or port has separate storage;
development and a deployed game therefore have separate saves. Clearing site
data removes them; private browsing is not durable storage.

Choose **Export save** to download the current progress as a JSON file. Keep it
in a folder or drive you back up. Move that file to another device and choose
**Import save** on character selection or in the journal. Export also works
when browser storage is denied or full. A storage failure displays **Save
unavailable** during play; the journal explains how to export. **Save and leave**
keeps the game open if its save fails.

## Checkpoint policy

- Manual and automatic checkpoints use independent slots. Writing one does not
  overwrite the other. Starting a new journey replaces the automatic slot;
  export an older journey first if you want to keep more than one.
- The opening creates a recovery checkpoint. During play, the game tries to
  autosave after 600 simulation ticks, when the character has at least half
  health, no living enemy within five tiles, and no hostile projectile or
  pending attack. If unsafe, it waits for a safe moment.
- Hiding or leaving the page also attempts a safe autosave. Browser shutdown
  cannot guarantee a final callback, so export or save manually before leaving
  when a particular point matters.
- Victory immediately creates an automatic checkpoint even if the final fight
  ended at low health. Defeat never replaces a checkpoint.
- Journal discoveries, simulation state, random state, and progression travel
  with the save. Audio settings remain separate browser preferences.
- Imports validate version, checksum, size, and the complete state before
  replacing anything. A corrupt slot cannot hide another valid checkpoint.
  A failed write preserves the previous slot. Checksums detect damage; they do
  not prove authenticity or prevent editing by the owner.

## Reuse in another game

Keep the persistence mechanism independent of the game's rules. A new game
provides a versioned state serializer, validator/migrator, and checkpoint policy.
For a puzzle that policy may be after every move; for a racing game it may be
after a race. Do not inherit combat or half-health conditions from Cinderwake.

Every game should explain where progress lives, offer an obvious resume action,
show the last successful save, preserve a recovery point on failed writes, and
provide export/import or an equivalent portable backup. Treat storage denial,
corrupt files, older versions, clearing data, and switching device as supported
user journeys. Restore meaningful progress in a fresh page and compare the
result; the presence of a file or a “Saved” label is insufficient evidence.

For this project, local storage plus portable files fits the current small save
format without a backend. If the state grows or multiple campaigns become
necessary, add a slot browser and transactional IndexedDB storage. If automatic
cross-device continuation becomes a product requirement, add authenticated
server storage with explicit local/cloud timestamps, version history, and a
conflict choice when two devices diverge. Never silently replace newer local
progress with an older server copy. Cloud hosting, identity, retention, and
offline behavior remain product choices; cloud sync is not implemented.

## Regression evidence

`tests/unit/save-game.test.ts` covers exact replay, a historical save migration,
independent slots, corruption rejection, failed replacement writes, and safe
checkpoint policy including victory. `tests/e2e/campaign.spec.ts` exercises real
download/import, storage denial, discovery restoration, and pause behavior.
`tests/e2e/save-storage.spec.ts` checks visible save location, live slot details,
failure feedback before opening the journal, and immediate victory restoration.

Run `npx vitest run tests/unit/save-game.test.ts` and
`npx playwright test tests/e2e/save-storage.spec.ts tests/e2e/campaign.spec.ts`.
