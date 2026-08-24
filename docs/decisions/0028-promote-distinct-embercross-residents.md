# 0028 — Promote one declarative idle row per Embercross resident

**Status:** accepted on 2026-08-24

## Problem

Embercross initially borrowed player hero atlases for all four service NPCs.
Mara and Tess were the same Ranger image, Oren was the Vanguard, and Ileya was
the Arcanist. The city therefore read as a duplicated test fixture rather than
a place with a merchant, tavern keeper, innkeeper, and healer.

The generated replacement arrived as a 1,254 × 1,254 RGB sheet with a baked
light checker background. Loading or evenly rounding that raw image would make
cuts drift between poses and would preserve an opaque box around every actor.
The generic actor runtime also assumes six idle frames and directional banks,
while this reviewed sheet intentionally contains one south-facing four-pose
idle loop per resident.

## Decision

Promote only prepared atlas SHA-256
`0c5e7fc390603b5958a8b5389ded0da55cc67390e2ceea475aab764b4b620f80`.
Its deterministic preparer uses exact floor-derived raw cuts, removes only
border-connected neutral matte, isolates the resident, preserves aspect, puts
all last contact pixels on Y227, and packs sixteen 256 × 256 RGBA cells. The
audit must reproduce the bytes twice and detect blank, jump, edge-leak,
duplicate, and opaque-backdrop mutations.

`art/resident-atlas-v1.json` is the reusable runtime contract. It declares the
atlas dimensions and hash, 128-pixel presentation box, 60-tick
`resident-idle` loop, pose columns, supported south view, role, sprite ID, and
row for every stable NPC ID. The catalog derives every source rectangle from
that data. The game never contains hand-copied row coordinates.

Residents use a dedicated four-frame clip rather than weakening the six-frame
actor cadence. NPCs keep a south-facing semantic bucket but do not request a
fabricated directional suffix. The renderer honors the declared source anchor
at Y228—the boundary immediately below the last Y227 contact pixel—so all four
feet share their world anchors. The 128 × 128 box is uniformly scaled; no
independent X/Y stretching is permitted.

Promotion required visual review of the runtime-scale contact sheet: all four
roles are distinct, share the same elevated painterly perspective and palette,
retain clean silhouettes, and remain grounded without pose jumps. Browser
evidence then requires the exact row/column sequence `0,1,2,3,0`, stable
destination rectangles and foot anchors, four distinct isolated mask hashes,
the resident asset on the physical production city-entry route, and refreshed
portrait/landscape screenshots.

## Consequence

Embercross no longer duplicates the player classes. Future residents follow a
documented source-grid → deterministic preparation → mutation audit →
declarative row → manifest sequence → isolated masks → in-game visual review
pipeline. A mechanical atlas pass cannot silently promote art, and a visual
approval cannot bypass reproducible cuts or executable negative controls.
