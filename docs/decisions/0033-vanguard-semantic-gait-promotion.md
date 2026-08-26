# 0033: Require semantic gait evidence before Vanguard promotion

## Problem

The current Vanguard atlas passes the generic bank checks because its cells are
grounded, nonblank, hash-distinct, and locally continuous. Those facts do not
make the motion believable. The east and west walk banks crouch roughly 15.5
atlas pixels below idle at start and stop. Every directional walk repeats its
first four raster cells as its second half-cycle. North and south move so little
that their maximum centroid steps are below four pixels. A different hash can
therefore preserve the same support leg and still look like animation to a
raster-only detector.

No reviewed anatomical landmark sidecar exists for the current production art.
Inventing coordinates after the fact would turn the failing bank into false
green evidence.

## Decision

Keep the idle↔walk median-height ceiling at **8 pixels** and evaluate it for all
four runtime facings. Bind the current atlas and both source images by SHA-256
as `KNOWN_REJECTED_CALIBRATION`. That narrow waiver keeps the unrelated generic
actor audit usable while documenting the current failure. It cannot transfer to
changed bytes.

A changed Vanguard bank is promotion-eligible only when:

1. all four idle↔walk comparisons stay within 8 pixels at the fixed foot anchor;
2. the eight-cell bank is not a duplicated half-cycle and has enough measurable
   raster articulation;
3. every facing supplies reviewed `leftFoot`, `rightFoot`, `leftKnee`,
   `rightKnee`, `torso`, and `root` landmarks bound to alpha ≥192 in that exact
   cell;
4. declared support identity alternates, phase order never reverses, both feet
   and knees travel far enough, the anchor moves at most one pixel, and the
   torso/root scale ratio stays at or below 1.08.

The accepted synthetic fixture proves that the evaluator can accept a real
alternating bank. Seven paired mutations prove detection of hash-distinct
same-support cells, missing alternation, weak articulation, off-alpha
landmarks, reversed phases, shifted anchors, and vertical stretch. Synthetic
fixtures calibrate the evaluator; they never approve production art.

Four cardinal `vanguard-start-stop-*` scenarios and command tapes exercise the
production state machine. Their recipes remain outside the green default
capture matrix while the source is rejected. East/west are expected to fail
the unchanged height threshold; north/south can pass that narrow threshold but
remain rejected by the semantic gait contract. Capturing a tape successfully
must never be reported as visual approval.

## Consequences

An artist or generator can no longer promote a shallow same-leg bank by adding
pixel noise or renaming frames. New bytes invalidate the calibration waiver and
must arrive with reviewed landmark evidence for every cardinal bank. The
current visual debt stays explicit and reproducible instead of either breaking
unrelated checks or disappearing behind a green hash test.

## Vanguard v3 staged-candidate result

The surgical v3 atlas is not production art. Its exact atlas hash
`a59e9ecdf1765523d523e0aa4115c797266fadfcdf29609798fd6daeb0469d4c`
is bound to
`art/motion-landmarks/candidates/vanguard-walk-v3-staged.rejection.json`.
For east, reflected west, north, and south, runtime frames 0–3 are
byte-identical to frames 4–7 respectively. The candidate therefore fails the
existing `duplicate-half-cycle` gate before semantic landmark review can make
it promotion-eligible.

The candidate source splice first normalizes the 1254-pixel raw bases onto the
1024-pixel source grid. Its full atlas build is retained as evidence, but the
shared six-sheet scale changes when the candidate cells are present. The final
staged atlas is therefore a hash-bound runtime splice from the accepted
production atlas, copying only rows 1, 7, and 9;
`art/generation/prepared/vanguard-walk-v3-staged/atlas/atlas-splice-report.json`
records that base, full candidate, output, and row boundary. Untouched runtime
rows remain byte-identical after decode.

The rejection sidecar intentionally contains no root, torso, foot, knee,
support, phase, or anchor coordinates. Coordinates cannot repair that raster
failure, and recording them would falsely imply a completed anatomical review.
It instead preserves all 32 observed runtime-cell hashes, the four duplicate
pairs, staged source hashes, and the exact reproduction command. The candidate
can be replayed without changing production by passing both `--atlas-dir` and
`--landmark-sidecar` to `scripts/audit-actor-atlases.mjs`; the audit rejects a
sidecar whose declared atlas or per-frame hashes do not match the bytes under
test. A future attempt must first author eight non-duplicated runtime frames in
every facing, then supply all required alpha-bound landmarks.
