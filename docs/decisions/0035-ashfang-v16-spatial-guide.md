# 0035: Freeze a sparse v16 Ashfang idle spatial guide

## Status

Accepted — 2026-08-24

## Decision

Ashfang v16 begins from `ashfang-idle-sparse-layout-v3.png`, a deterministic,
hash-bound 1024px guide with exactly four open limb chains and a literal
`#ff00ff` background. It is spatial-only; Stonekin remains style-only. V15
pixels, silhouette, image reference, and seed are prohibited.

The contract fixes the near support baseline at y=765 and its midpoint at
x=520, while requiring a 55px minimum far-fore/near-fore separation below the
elbows. It deliberately omits torso contours, closed marks, and rendered
surfaces so it cannot prescribe anatomy or become production art.

## Consequences

The artifact may condition one fresh idle generation but cannot approve its
pixels. Candidate review must separately enforce four traceable chains, living
raised posture, source-scale height and occupancy, belly clearance, and matte
surface discipline. The PNG is reproducible only through its builder and is
never promoted into an atlas.
