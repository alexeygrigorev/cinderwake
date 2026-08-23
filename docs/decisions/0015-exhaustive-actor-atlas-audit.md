# ADR 0015: Gate every actor animation bank before scenario sampling

Date: 2026-08-23

## Status

Accepted.

## Problem

The fixed atlas validator proved source presence, output hashes, nonblank cells, safe padding, and foot anchors. The browser temporal matrix proved selected real gameplay sequences. Neither layer inspected every clip, terminal recovery, or immediate authored-facing change. All existing checks could therefore pass while every actor visibly snapped from its last hurt pose to idle, Ashfang changed apparent height on an east/north or east/south run turn, and Ashfang's registered side ability jumped from a high airborne silhouette to a ground strike. Hurt and directional walk are reachable in current play; monster ability banks are part of the runtime contract but current AI does not select them.

A read-only replay against the immutable atlas bytes at commit `571909a98073de056df67078148b11ff4e708a68` made the false green concrete: only 118/144 runtime-facing banks and 708/720 authored-facing comparisons passed the new gate even though the prior source validator, unit suite, and 23-report temporal matrix were green. The public audit report retains that commit, all six atlas hashes, failure counts, reachability labels, and reproduction recipe alongside the repaired result.

## Decision

Add one deterministic atlas-wide gate between packing and curated browser capture. It must:

- inspect all six actors, six clips, and four runtime facings, including the exact west reflection used by the renderer;
- measure nonblank ink, safe crop bounds, grounding, centroid and centered body-core displacement, width/height change, mask overlap, pose diversity, loop wrap, and exact idle recovery;
- compare the same phase across authored east, north, and south idle/walk banks so an immediate facing change cannot hide a scale pop;
- retain one strip for every bank, one labeled overview per actor, a self-contained HTML report, and complete JSON evidence;
- audit registered banks even when current AI cannot reach them;
- reject four synthetic negative controls covering stale recovery, displaced action art, cell-edge clipping, and facing-scale overflow; and
- run strictly inside `npm run check` without excluding known-bad clips or weakening thresholds.

Repair art at the source recipe boundary. Hurt uses three authored recoil cells followed by the exact facing-specific idle cell. Ashfang's side ability reuses its charge cell for a one-frame hold and omits the disconnected airborne pose. Its unusually low and wide side-run uses one declared, foot-anchored `scaleX: 0.9` / `scaleY: 1.42` transform before packing. Source rasters remain immutable; the packer and actor contract contain the entire reproducible decision.

## Why this advances the testing goal

Every animation cell now has machine evidence and a reviewable sequence, regardless of whether a hand-written scenario happens to select it. The report distinguishes a real gameplay reachability bug from a registered future-path defect while holding both to the same art contract. Exact recovery reuse makes a visible seam byte-testable, and detector controls ensure a green result means the gate still recognizes representative defects.

## Rejected alternatives

- Adding only three browser scenarios was rejected because another unselected facing or clip could regress silently.
- Relaxing the facing threshold was rejected because the Ashfang turn pop was visible and reachable.
- Excluding monster abilities was rejected because the runtime atlas registers them and AI may make them reachable later.
- Editing built PNG cells was rejected because the repair would be opaque and lost on the next build.
- Generating replacement raster art was unnecessary; deterministic source reuse and a declared transform preserved identity and provenance.
- Treating metrics as final visual approval was rejected. All six actor overviews were re-reviewed after the gate passed.

## Consequences

`npm run art:animation:check` adds a roughly 13-second local pass and creates about 4.7 MiB of ignored evidence. A deliberate art change may require a recipe update, but any tolerance change is now an explicit policy decision. Browser sequences remain necessary for state timing, camera, interpolation, compositing, and input; the atlas gate covers their static animation blind spots rather than replacing them.

## Verification

Run:

```bash
npm run art:build
npm run art:check
npm run art:animation:check
npm run art:generation:check
npm run check
```

Inspect `quality-results/actor-atlas-audit/index.html`, especially the six labeled overview images and the gold-outlined loop/recovery comparison frames.
