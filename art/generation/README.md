# Character generation pipeline

This directory is the reproducible boundary between nondeterministic image generation and Cinderwake’s deterministic actor build. It preserves what was asked for, what references were supplied, what exact bytes came back, how a raw image was prepared, and what the real packer did with it. It does not claim that running the same prompt again will reproduce the same pixels.

## Fixed spatial contract

Every source is a square 4 × 4 semantic sheet. The raw generator output may be larger than requested; ingress resizes it to 1024 × 1024 before cutting these exact 256-pixel cells:

| Cell index | Normalized source rectangle     |
| ---------- | ------------------------------- |
| 0–3        | `(column × 256, 0, 256, 256)`   |
| 4–7        | `(column × 256, 256, 256, 256)` |
| 8–11       | `(column × 256, 512, 256, 256)` |
| 12–15      | `(column × 256, 768, 256, 256)` |

All figures use a bottom-center ground anchor. The packer keys magenta, removes boundary-connected fragments, computes one normalization envelope over all six sheets of an actor, and places the result into fixed 128 × 128 runtime cells with foot anchor `(64, 116)` and safe ink rectangle `(5, 4, 118, 112)`.

The six interchangeable source families are:

| Family               | Required cell semantics                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `primary`            | east idle, east walk, legacy attack, legacy ability rows                           |
| `directions`         | north idle, north walk, south idle, south walk rows                                |
| `actions`            | east attack motion 0–4, review reserve 5, recovery reserves 6–7, east ability 8–15 |
| `reactions`          | east hurt 0–3, east collapse 4–11, grounded reserve 12–15                          |
| `directionActions`   | north attack, north ability, south attack, south ability rows                      |
| `directionReactions` | north hurt, north collapse, south hurt, south collapse rows                        |

West is the only runtime mirror and is derived from east. North and south are always authored.

## Create a candidate

1. Choose one actor identity reference and one source family. Start from [prompt-template.md](prompt-template.md), retain its camera, material, lighting, palette, scale, anchor, and exclusion contract, and change only the character-specific identity and selected family semantics. The rejected first-pass trial prompts remain evidence, not templates to copy.
2. Save the final exact prompt under `prompts/` **before** calling the generator.
3. Generate or edit using only original Cinderwake reference images. Leave the tool’s original artifact in its generated-image store and copy the output to `candidates/`; never overwrite a production source.
4. Audit the raw output. Record structural and visual reasons rather than hiding prompt noncompliance. The first live trials demonstrated useful rejection cases: gradient rather than literal chroma, cell-edge contact, baseline drift, semantic phase mistakes, and prompt/reference contradictions.
5. Create a non-destructive prepared source. The command normalizes size, chroma, boundary fragments, shared scale, and ground anchor; it deliberately does not make subjective art changes:

   ```bash
   node scripts/prepare-actor-source.mjs \
     --input art/generation/candidates/<trial>.png \
     --output art/generation/prepared/<trial>.png
   ```

6. Add the raw and prepared hashes, exact preparation command/tool, every reference path/hash, tool artifact ID, raw dimensions, and separate verdicts to `trials.json`. `accepted-for-pipeline-proof` means structurally and visually usable as test input, not production-approved.
7. Run the complete verifier:

   ```bash
   npm run art:generation:check
   ```

8. Open `quality-results/generation-pipeline/index.html` and inspect the raw normalized cells, prepared source, and packed runtime preview. Mechanical PASS cannot settle identity, anatomy, pose order, natural weight, or style.
9. To promote a candidate, obtain independent visual acceptance, replace only the intended production source in a focused commit, then run `npm run art:build`, `npm run art:check`, browser visual tests, and `npm run capture:matrix`. Review changed temporal strips before updating any baseline.

For a prepared primary candidate, run the reusable calibration gate as well:

```bash
node scripts/assess-actor-candidate.mjs \
  --actor <actor-id> \
  --family primary \
  --profile <calibration-profile> \
  --candidate art/generation/prepared/<trial>.png \
  --output quality-results/actor-candidate-calibration/<trial>
```

It measures every one of the sixteen keyed cells, ink bounds, source-space
ground anchor, the shared six-family runtime scale, and idle/walk loop height
and centroid continuity. It writes a guided 4×4 contact sheet, a same-scale
actor comparison, JSON, and HTML. Thresholds live in
`art/actor-calibration-v1.json`, so a new actor profile does not require a new
assessor. Three paired mutations must be rejected: a
bad edge cut, one oversized frame that shrinks the complete rig, and a raised
walk frame that would jump in motion. This remains a mechanical gate; it cannot
approve anatomy, camera, material style, or action meaning.

## What the verifier proves

- trial prompts, references, candidates, legacy briefs, and manifests exist and have current hashes;
- raw candidate images are square and at least 1024 pixels, then are analyzed on the declared normalized grid with literal-chroma ratio, per-cell component bounds, edge contact, and baseline evidence;
- machine-readable rejection reasons exist for rejected raw candidates, so a permissive packer cannot relabel them as good source art;
- prepared candidates reproduce from the exact raw hash and command, use literal chroma, keep all sixteen cells inside safe bounds, and retain an independent visual verdict;
- every trial, including intentionally rejected art, can pass through the real packer as an explicitly labeled tolerance diagnostic;
- complete Vanguard, Ranger, and Stonekin six-family source sets build twice to byte-identical atlases;
- those isolated atlas bytes equal the committed production atlases;
- negative fixtures reject missing prompt records, stale hashes, undersized rasters, and blank cells.

The report is regenerated and published by CI. `quality-results/` is intentionally ignored because reports are derived evidence; prompts, candidate bytes, immutable hashes, and verifier code are the committed reproducible inputs.

## Current representative proof

- Vanguard `directions`: raw and prepared art are rejected because preparation cannot repair the incomplete gait or identity-contract mistake.
- Ranger `actions`: raw and prepared art are rejected because preparation cannot repair the oversized effect or action-cell semantic mismatch.
- Stonekin `reactions`: raw art is mechanically rejected; its prepared source is accepted only for pipeline proof because shared-scale grounding repairs the raster contract while preserving the visually coherent collapse.
- Ashfang `primary` v2: its prepared idle/walk cut passes the measurable scale and continuity window (78.5-pixel median idle height), but raw and prepared art remain rejected. Independent review found a glossy style mismatch, a still-lateral camera, an airborne attack, and an oversized ground burst; preparation cannot repair those authored decisions.

`accepted-production.json` covers all six accepted source families for those same actors. Exact historical prompts were not retained, so those entries point to `legacy-briefs/` marked `reconstructed-after-generation`; they preserve source hashes and generated artifact IDs without fabricating history.

## Mobile selection scenes

Selection key art is a separate raster contract from animated actor sheets. It may use a straight-on cinematic camera and a composed environment because it never supplies gameplay frames, anchors, or collisions. The shared requirements are still original Cinderwake identity, charcoal/ember/cyan palette, realistic anatomy, readable equipment, and prompt/reference provenance.

[`selection-v2.json`](selection-v2.json) records the three exact prompts, shared and actor-specific reference hashes, built-in generation artifact IDs, immutable source PNG hashes, review verdicts, and deterministic public WebP hashes. Rebuild or verify them with:

```bash
npm run art:selection:build
npm run art:selection:check
```

Each scene reserves a quiet title region and a dark lower control region, contains exactly one grounded hero, and supplies real buildings and props rather than a repeated texture. `accepted-for-selection` never implies that the raster is valid animation-source art.
