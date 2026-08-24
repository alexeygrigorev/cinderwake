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

6. Add the raw and prepared hashes, exact preparation command/tool, every reference path/hash, tool artifact ID, raw dimensions, and separate verdicts to `trials.json`. `accepted-for-pipeline-proof` means structurally usable as diagnostic packer input; it is never production approval and cannot override a recorded exact-hash visual rejection.
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
assessor. Four paired mutations must be rejected: a
bad edge cut, one oversized frame that shrinks the complete rig, a raised walk
frame that would jump in motion, and a repeated planted walk frame whose
bottom-band support mask remains stuck across all four phases. This remains a
mechanical gate; it cannot approve anatomy, camera, material style, or action
meaning.

For a known rejected candidate, CI must reproduce the exact named failure—not
merely accept any nonzero exit. Declare both the outcome and every expected
violation:

```bash
node scripts/assess-actor-candidate.mjs \
  --actor ashfang \
  --family primary \
  --profile ashfang-primary-v1 \
  --candidate art/generation/prepared/ashfang-primary-trial-v9.png \
  --output quality-results/actor-candidate-calibration/ashfang-primary-trial-v9 \
  --expect-assessment fail \
  --expect-violation walk-support-contact-persistent
```

The command succeeds only when the actual violation set exactly equals the
declared set, all independent mutations are caught, preparation is recorded as
rejected, and the independent review hash matches the candidate bytes.

Conversely, `--expect-assessment pass` is a promotion gate rather than a way to
print a mechanically green report. It also requires recorded art and prepared
status `accepted`, an independent `ACCEPT` verdict bound to the candidate hash,
at least one accepted review axis, and no rejected axes. A candidate such as
Ashfang v2 can therefore remain useful mechanically without being mislabeled as
promotable.

## What the verifier proves

- trial prompts, references, candidates, legacy briefs, and manifests exist and have current hashes;
- raw candidate images are square and at least 1024 pixels, then are analyzed on the declared normalized grid with literal-chroma ratio, per-cell component bounds, edge contact, and baseline evidence;
- machine-readable rejection reasons exist for rejected raw candidates, so a permissive packer cannot relabel them as good source art;
- prepared candidates reproduce from the exact raw hash and command, use literal chroma, keep all sixteen cells inside safe bounds, and bind any independent visual verdict to the exact prepared SHA-256;
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
- Ashfang `primary` v9: the 80.5/77-pixel idle/walk medians repair the earlier height failure, but 18 of 94 occupied bottom-band columns persist through every walk phase (`19.15% > 12%`). Exact-hash review of `4030c6a856a1d6da812fcf79d70b3c980af1d97809359d4d1e26339534bd3b06` independently rejects the same sliding support paw, untrackable fourth limb, excessive walk width, and fitness to seed later families. Preparation is explicitly rejected; CI reproduces the named rejection with all four mutations caught.

`accepted-production.json` covers all six accepted source families for those same actors. Exact historical prompts were not retained, so those entries point to `legacy-briefs/` marked `reconstructed-after-generation`; they preserve source hashes and generated artifact IDs without fabricating history.

## Pose-isolated ingress

When a complete generated sheet collapses row semantics, test one identity
master before requesting more poses. Save the exact prompt first, generate
exactly one non-action pose, preserve the raw bytes and artifact ID, then place
it non-destructively into one 256 × 256 source cell:

```bash
node scripts/prepare-actor-pose.mjs \
  --input art/generation/candidates/<pose>.png \
  --output art/generation/prepared/<pose>.png \
  --preserve-framing
```

The pose normalizer keys the raw background, removes boundary residue, applies
one aspect-preserving scale, and uses the declared bottom-center foot anchor.
Fresh identity masters use `--preserve-framing`: the scale is capped at the
canonical 1024→256 factor and only shrinks further to respect the safe box, so
the generator's declared canvas occupancy remains measurable. Historical v1/v2
records omit the flag and retain their exact legacy safe-fit bytes. Neither
mode stretches a wide creature to manufacture the desired height. Fresh poses
are aligned from the final keyed pixels rather than their pre-key placement
box: the visible bottom lands at source Y 231 and the alpha-weighted centroid of
the lowest eight source pixels lands within half a pixel of source X 128. If
that contact translation would leave the safe box, preparation shrinks the pose
rather than rejecting an otherwise valid framing. The isolated assembler
repeats the same operation at one shared scale over the whole generated row,
preventing matte cleanup or asymmetrical paws from introducing a hidden pivot
jump. Audit a recorded trial with:

```bash
npm run art:pose:audit
```

The audit reproduces the prepared bytes twice, projects the cell to 128-pixel
runtime scale, emits raw/prepared/runtime/alpha and same-scale actor evidence,
and runs paired cut, anchor, aspect, height, and contact-footprint controls. The
lowest support band must remain centered on the fixed actor anchor closely
enough to represent the shared collision disc; a visually planted sprite whose
contact point sits beside its gameplay body is rejected.

The five detector mutations never derive their green fixture from the current
candidate. They use one deterministic centered synthetic body/support image,
then inject edge cut, floating anchor, overwide shape, undersized shape, and
contact offset. This prevents an already-asymmetric candidate from making the
supposed control fixture red before mutations are applied.

Ashfang east-idle master v1 proved that isolation prevents sheet-level phase
collapse, but it is still rejected. Its runtime ink is 118 × 63 at aspect
1.873, and its lowest support center is 16.07 logical pixels right of the rig
anchor. It also remains too lateral, prone, glossy, orange-heavy, and poorly
padded. Do not generate follow-up frames from a rejected identity master.

Ashfang east-idle master v2 preserves the exact frozen prompt and generated
artifact, and materially improves the compact living posture and centered
support base. It is still rejected at both boundaries. The deterministic audit
measures 118 × 99 runtime ink against the 72–86 height window plus a one-pixel
visible-foot miss, with 5/5 fixture-bound defects caught. Independent review of
the exact raw, prepared, pose-evidence, and runtime-comparison hashes also sees
only three trackable paws, a side-dominant camera, oversized gameplay scale,
and glossy detail noise. Those findings prohibit generating walk phases from
v2; the assembler is not a license to multiply a rejected identity master.

Ashfang east-idle master v3 separates those two boundaries explicitly. At the
canonical 0.25 canvas scale, keyed-pixel alignment yields 78 × 78 runtime ink,
exact visible-bottom grounding, an alpha-weighted runtime contact offset of
-0.03 pixels, no mechanical violations, and 5/5 detected controls. That green
geometry cannot authorize art. Independent exact-hash review still rejects the
shallow camera, narrow mass, noisy plate highlights, missing far forepaw, and
ambiguous diagonal support ownership. The mechanically green/no-review mutation
must fail, so a manifest claim alone cannot convert v3 into a reviewed
rejection or a walk-generation seed.

Ashfang east-idle master v4 improves again without being rounded up. It keeps
canonical scale and measures 84 × 81 runtime ink with exact grounding, centered
support, no mechanical violations, and 5/5 controls. The source visibly contains
four paws and the runtime mass matches the cast more closely. Exact-hash review
still vetoes it: the far forepaw exists, but its leg merges beneath the chest at
actual runtime scale, so a reviewer cannot trace four limb chains or assign
diagonal support ownership. The camera also remains too low and the bright
plate edges muddy internal anatomy. Source-scale paw count is therefore not a
substitute for runtime-scale gait-seed readability.

Ashfang east-idle master v5 deliberately asks for a source-canvas separation
channel, but the generator moves only the paw and leaves the upper far-side limb
under the belly. Its 82 × 84 mechanical envelope, grounding, contact, and 5/5
controls pass. Exact-hash review still cannot trace the far-side limb chain at
runtime or label the diagonal supports; it also rejects the side-dominant
camera, lighter dragon-like mass, and glossy highlight density. The result
demonstrates why the pipeline records connected limb readability rather than
merely counting terminal paw shapes.

Ashfang east-idle master v6 intentionally stops editing the glossy lineage and
regenerates from production cast sheets. It restores a broad species mass, but
the keyed source spans 879 × 538 normalized pixels and safe-width fitting must
shrink it to 0.222513 scale. Runtime ink is consequently 98 × 59 at aspect
1.661, reproducing the exact `runtime-height` and `runtime-aspect` rejection
with 5/5 controls. Independent exact-hash review also rejects the low stalking
posture, side camera, merged upper limbs, baked shadow/graded chroma, and glossy
plate noise. A fresh reference set alone is not a pose-layout contract.

The reusable `quadruped-pose-layout.png` makes that missing contract explicit.
Its deterministic builder locks a 1024-pixel literal-magenta canvas, 62.1% ×
59.0% occupied envelope, 78.0% contact baseline, perspective-ordered paw
regions, and three negative-space corridors, then rebuilds twice and compares
exact bytes. A hash-bound independent review accepts its diagonal elevated
composition while recording that its limb colors are depth codes and its long
corridors are not anatomy. V7 may use it only for topology, camera, framing,
and support placement; accepted cast images remain the style and identity
authority.

Guide-driven Ashfang east-idle master v7 transfers head/tail direction and a
raised living stance, but not the guide's critical envelope or support topology.
Its 784 × 483 normalized ink becomes 98 × 60 runtime ink at aspect 1.6333 and
reproduces exact `runtime-height` plus `runtime-aspect` rejection with 5/5
controls. Independent review sees only three paws and cannot trace a fourth
limb chain or diagonal support pair. V8 therefore separates anatomy topology
from identity styling instead of allowing a side-view species reference to
override both in one generation step.

The first anatomy blockout proves that structural success can still fail raster
ingress. Independent raw-pixel review accepts its elevated camera, broad raised
body, four complete limb chains, separation gaps, diagonal ownership, and safe
framing only as an internal edit reference. The model illuminated the neutral
mannequin entirely inside the magenta-key family, so deterministic preparation
reproduces `isolated pose is blank` and leaves no partial output. The exact raw,
prompt, references, generation artifact, internal-only review, and error are
committed; v2 may recolor those pixels but may not claim v1 was a usable atlas
source.

An exact recolor edit produces anatomy blockout v2 without changing the four
reviewed chains. Canonical preparation now passes at 81 × 82 runtime pixels,
exact grounding and centered support, with 5/5 controls. Independent exact-hash
review accepts camera, mass, four chains/paws, gaps, near/far ordering,
diagonals, framing, and runtime structural readability only. It still rejects
production readiness, species surface identity, natural anatomy, paws/joints,
and final material. The next edit may naturalize the mannequin around locked
limb centerlines and paw contacts but may not move or merge any accepted chain.

Anatomy blockout v3 naturalizes shoulders, elbows, hocks, tapered lower limbs,
and three-claw paws while retaining all four chains, gaps, camera, and diagonal
ownership. It is still rejected. The near forepaw becomes the sole lowest
contact and reaches too far outward, so contact-aware safe fitting drops from
canonical 0.25 scale to 0.207534 and runtime height falls from 82 to 71 pixels.
Exact-hash review permits one baseline-only edit: restore v2's two-near-paw
contact row and compact centered footprint without changing v3's improved
anatomy.

Anatomy blockout v4 performs only that baseline repair. Its 74 × 79 runtime
silhouette, exact grounding, centered two-near-paw support, aspect, safe bounds,
and all 5/5 controls pass. Independent exact-hash review also confirms that the
organic joints, four body-connected chains and terminals, gaps, elevated
camera, near/far order, and both diagonals survive at runtime. That acceptance
is limited to an internal topology seed: preparation still shrinks to 0.231122,
the source matte is not uniformly literal, and the mannequin has neither
Ashfang identity nor production material/value design. One identity/style edit
may use v4 only with its camera, joints, paw positions, gaps, diagonals, and
support row locked; the result starts unreviewed and must pass the full gates.

Isolated identity master v8 uses v4 as the sole spatial authority and limits
production Ashfang plus Stonekin to identity and cast-rendering roles. It keeps
four runtime-readable chains, both diagonals, the elevated living stance, a
75 × 79 envelope, centered support, and 5/5 controls. Exact-hash review still
rejects it as a phase-generation seed. The authoritative alpha-24 oracle finds
969 exact prepared-cell mask differences: 463 expected pixels are missing and
506 candidate pixels are extra. Best one-pixel alignment leaves 253 differences
and is diagnostic only. Dense stone grain, fine borders, silver rims, and claw
detail also collapse into dark runtime noise that would vary across phases. A
prompt claim that a stencil is immutable is not evidence.

Use `npm run art:topology:check` to test both boundaries. The topology oracle
compares exact prepared-cell keyed masks and emits `topology-diff.png`; a best
alignment can explain drift but never excuse it. The opt-in preparer mode:

```bash
node scripts/prepare-actor-pose.mjs \
  --input <candidate.png> \
  --output <prepared.png> \
  --preserve-framing \
  --topology-mask <reviewed-raw-topology.png> \
  --prepared-topology-mask <reviewed-prepared-topology.png>
```

clips extra candidate ink, fills missing reference foreground from the nearest
candidate foreground with a fixed Manhattan/tie order, preserves the reviewed
source alpha mask, and reports all changed pixels. Resampling and color keying
can still perturb the 256-cell contour, so the prepared-space option performs a
second exact alpha-field lock after scale/contact placement and republishes
final bounds and support evidence. It encodes that effective alpha through an
opaque literal-magenta prepared cell rather than leaving transparent margins.
A manifest records both exact files/hashes
under `preparation.topologyMask` and `preparation.preparedTopologyMask`; a
separate `topologyLock` proves the committed output against the reviewed
prepared reference. Enforcement establishes silhouette identity, not artistic
quality.

Finished surfaces also opt into `quality/actor-detail-contract.v1.json`.
`npm run art:detail:check` keys and projects the exact 128-pixel frame, erodes
two silhouette pixels, and measures Rec.709 high-pass detail after a 3 × 3
binomial blur. Frozen Vanguard, Ranger, and Stonekin fixtures establish the
current strong-detail/readability envelope. Exact v8 reproduces
`runtime-detail-collapse`; candidate-independent blur, seeded grain, and dense
internal-rim mutations prove both collapse and overload codes. The metric
cannot approve material, lighting, anatomy, or style, so exact-hash visual
review remains required.

Identity master v9 demonstrates why exact topology and reduced noise are still
insufficient. Two-stage preparation restores v4's exact final alpha field,
148 × 156 prepared envelope, grounding, and contact; its 74 × 79 runtime pose
has four readable chains and zero topology differences. The surface metric
rejects strong occupancy `0.106996` and readability `0.268595`. Independent
exact-hash review agrees: a single tan dorsal fill, flat dark cylinders, and
orange joint bracelets read as an unfinished generic blockout rather than a
heavy Ashfang. V9 is accepted only as the input for one internal-value edit:
three or four broad dorsal plates, one cool flank plane, a few filled ember
vents, and no bracelets, grain, rim network, new contour, or motion phase.

Identity master v10 proves that the blockout-derived silhouette itself is the
remaining ceiling. It removes bracelets and adds a cool flank, dorsal split,
and filled chest vent, but native-runtime strong occupancy falls further to
`0.090535` and readability to `0.185497`. Exact review rejects every v10 value
axis and retires v4–v10 as a visual lineage: exact topology also freezes
cylindrical segments, ring joints, paddle tail, block horns, shell torso, and
stilt proportions. Preserve those pixels only as non-rendered test evidence.
The next natural master may use a new silhouette, but it must still satisfy the
quantified camera, runtime size, grounding, gap, paw-order, diagonal, detail,
and exact-hash review contracts before motion generation.

Identity master v11 is the first fresh natural silhouette after retiring that
lineage. The generator receives only the accepted Stonekin source for cast
rendering language; the production Ashfang sheet, guide, blockout, and v4–v10
pixels are excluded because v6/v7 proved they force the old prone side view.
V11 materially repairs animal anatomy, elevated camera, Ashfang identity, and
broad painterly materials, but it remains an exact rejection: normalized ink
occupies 868 × 712 pixels, runtime ink is 109 × 90, only three complete limb
chains/paws are visible, the raw literal-magenta ratio is zero, and surface
strong/readability scores are `0.253306` / `0.349696`. Independent review
allows one v12 correction to use v11 only for identity, natural anatomy
quality, camera intent, palette, and material treatment. Its silhouette,
framing, support, paw layout, scale, and phase pixels have no authority.

Identity master v12 proves that role text does not override attached-pixel
conditioning. Although the prompt explicitly denied v11 silhouette authority,
v12 repeats the same three-chain composition. Its deterministic 102 × 85
runtime envelope, aspect, contact, and all five pose controls pass, while exact
review still rejects the missing far-hind route, diagonals, two-near-paw
support, raw chroma, and surface `0.276965` / `0.373394` near miss. V11 and v12
are therefore both forbidden as future image references. Their useful identity,
natural-anatomy, camera, and material findings continue only as text and test
criteria. A mechanically green prepared pose remains rejected art.

Natural master v13 removes every Ashfang image reference and keeps only
Stonekin as cast-style evidence. This escapes inherited silhouette pixels and
passes the finished-surface gate at `0.308391` strong occupancy and `0.401811`
readability, but text alone still produces realistic occlusion: only three
complete routes/paws are visible. Its 110 × 103 runtime body is also oversized
and the raw literal-magenta ratio remains zero. Exact review rejects all v13
pixels as future references despite the attractive rendering; otherwise the
three-chain silhouette would become self-reinforcing. It authorizes the
reviewed four-corridor guide plus Stonekin, with no Ashfang pixels and no exact
contour lock, as the next spatial-conditioning experiment.

Guided master v14 attaches that reviewed corridor guide plus Stonekin and no
Ashfang pixels. It is the first fresh rendered candidate with four complete
routes, four paws, both diagonals, open gaps, and two near paws contributing to
the contact band. It also passes surface detail at `0.350681` strong occupancy
and `0.451546` readability. Exact review still rejects the raster: right-biased
support forces contact-aware scale down to `0.200785`, producing a 73 × 69
runtime body whose visual centroid sits far left of the anchor, while spherical
joints, bands, columns, loop tail, and regular plates copy guide/golem
construction. V14 pixels cannot be attached again. Only its measured route
coordinates may inform one new sparse, rebalanced guide with no surface or
silhouette authority.

## Mobile selection scenes

Selection key art is a separate raster contract from animated actor sheets. It may use a straight-on cinematic camera and a composed environment because it never supplies gameplay frames, anchors, or collisions. The shared requirements are still original Cinderwake identity, charcoal/ember/cyan palette, realistic anatomy, readable equipment, and prompt/reference provenance.

[`selection-v2.json`](selection-v2.json) records the three exact prompts, shared and actor-specific reference hashes, built-in generation artifact IDs, immutable source PNG hashes, review verdicts, and deterministic public WebP hashes. Rebuild or verify them with:

```bash
npm run art:selection:build
npm run art:selection:check
```

Each scene reserves a quiet title region and a dark lower control region, contains exactly one grounded hero, and supplies real buildings and props rather than a repeated texture. `accepted-for-selection` never implies that the raster is valid animation-source art.
