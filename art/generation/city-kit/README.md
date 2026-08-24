# Embercross city-kit candidate boundary

This directory contains an isolated, quarantined six-cell city-art generation. It is not production art and is not referenced by runtime files.

The nondeterministic boundary is the built-in generated raw PNG plus its exact prompt, reference hash, and artifact metadata. Preparation and checks after that boundary are deterministic. Semantic order is fixed and never inferred:

1. market/merchant stall;
2. large tavern building;
3. healer/infirmary building;
4. open city gate;
5. wilderness road sign;
6. bed-and-food service cluster.

The source reference is `art/generation/environment-kit/candidates/environment-kit-v2.png`, used only for camera, materials, palette, lighting, and world-scale language. Its objects and layout have no reuse authority.

Every prompt SHA-256 was recorded before its corresponding generation call. Production promotion requires a separate exact-hash visual review after the mechanical evidence. A mechanically valid cell is only safe to review; it is never automatically accepted as finished art.

## Reproduce all deterministic evidence

The image-generation calls are intentionally not described as reproducible: the prompts, tool artifact IDs, references, and immutable raw hashes reproduce their provenance, while preparation from those raw bytes is byte-identical.

```bash
# V1: four accepted cuts; gate and bed/service rejected for crossing source cells.
node art/generation/city-kit/prepare.mjs
node art/generation/city-kit/check.mjs \
  --cuts-directory art/generation/city-kit/evidence/cuts-v1

# V2: five accepted cuts; bed/service still rejected for crossing its source cell.
node art/generation/city-kit/prepare.mjs \
  --input art/generation/city-kit/raw/embercross-city-kit-v2.png \
  --output art/generation/city-kit/prepared/embercross-city-kit-v2.png \
  --report art/generation/city-kit/evidence/preparation-v2.json
node art/generation/city-kit/check.mjs \
  --record art/generation/city-kit/record-v2.json \
  --audit art/generation/city-kit/evidence/audit-v2.json \
  --runtime-sheet art/generation/city-kit/evidence/runtime-scale-contact-sheet-v2.png \
  --cuts-directory art/generation/city-kit/evidence/cuts-v2

# V3: six of six mechanically safe and visually accepted for a controlled trial.
node art/generation/city-kit/prepare.mjs \
  --input art/generation/city-kit/raw/embercross-city-kit-v3.png \
  --output art/generation/city-kit/prepared/embercross-city-kit-v3.png \
  --report art/generation/city-kit/evidence/preparation-v3.json
node art/generation/city-kit/check.mjs \
  --record art/generation/city-kit/record-v3.json \
  --audit art/generation/city-kit/evidence/audit-v3.json \
  --runtime-sheet art/generation/city-kit/evidence/runtime-scale-contact-sheet-v3.png \
  --cuts-directory art/generation/city-kit/evidence/cuts-v3
```

Expected verdicts are V1 `REJECT` with 4/6 cells, V2 `REJECT` with 5/6 cells, and V3 `PASS` with 6/6 cells. V3 prepared bytes must hash to `1f6b2fe52169c4e99dd101510e11674e4e3008f859be518ded33a0f773c61f85`.

## What the boundary proves

Preparation never infers semantic order. It processes the six declared 512 × 512 cells independently, selects the dominant connected subject and nearby meaningful fragments, discards foreign spill from neighboring subjects, removes the tolerant magenta matte, clears transparent RGB, uniformly fits without upscaling, centers horizontally, and aligns visible contact pixels to source Y 446. Width and height share one scale; the audit rejects nonuniform stretch.

The checker binds prompt, references, raw bytes, preparation report, and prepared bytes to their recorded SHA-256 values. It runs preparation twice, requires byte identity, checks exact 1536 × 1024 geometry, six fixed nonblank cells, 62-pixel prepared safety borders, common foot anchors, transparent-matte hygiene, no upscaling, aspect preservation, centered anchors, raw source-subject isolation, and a transparent central passage in the gate. It exports independently hashed 512 × 512 cuts plus a runtime-scale contact sheet.

The raw generator matte still fails the literal `#ff00ff` request. This is recorded rather than hidden; only the prepared v3 bytes may advance. V3 also failed its requested pixel-preserving edit invariant because the generator regenerated the full sheet. The audit reports this separately, and the exact v3 full sheet is reviewed as a new candidate rather than misrepresented as a surgical edit.

## Controlled integration contract

Use `prepared/embercross-city-kit-v3.png` only. Register it as a 3 × 2 atlas of 512-pixel cells, using the `sourceRect` values and per-cell hashes in `evidence/audit-v3.json`. Draw every destination with one uniform scalar; never choose independent width and height.

Initial logical heights are market 128, tavern 220, infirmary 196, gate 210, sign 86, and bed/food service 96. These are review starting points, not immutable gameplay balance.

Collision must follow visible mass:

- the market, tavern, and infirmary use compact footprints beneath their masonry/timber bases;
- the gate uses two separate solid pier/door footprints and **no collider in the transparent center passage**;
- the road sign uses a small ellipse under the stone base;
- the bed/service cluster uses one compact L-shaped or conservative elliptical footprint under the furniture, never the whole 512-pixel source cell.

Place merchant, tavern, and healer NPC actors as separate character sprites in front of their service buildings. Do not bake people or interaction UI into these environment sprites. A runtime trial still needs portrait and landscape gameplay screenshots, mobile tap targets, NPC interaction feedback, gate traversal, collision-footprint overlays or evidence, and readability review before production approval.
