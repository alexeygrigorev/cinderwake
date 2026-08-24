# Quarantined environment-kit experiments

This directory preserves coordinated environment-kit generations and their deterministic ingress evidence. They are candidate art, not production art. No production source, atlas, manifest, gameplay code, snapshot, or runtime test references either candidate.

## Reproduce the deterministic boundary

The image generator is nondeterministic, so each raw PNG, exact frozen prompt, artifact ID, reference hash, and generated-byte hash is immutable. Everything after that boundary is deterministic.

```bash
# Reproduce the original v1 rejection with its unchanged preparation defaults.
node scripts/prepare-environment-kit.mjs \
  --input art/generation/environment-kit/candidates/environment-kit-v1.png \
  --output art/generation/environment-kit/prepared/environment-kit-v1.png
node scripts/assess-environment-kit.mjs

# Reproduce v2's stricter prepared boundary and audit.
node scripts/prepare-environment-kit.mjs \
  --input art/generation/environment-kit/candidates/environment-kit-v2.png \
  --output art/generation/environment-kit/prepared/environment-kit-v2.png \
  --safe-inset 62 \
  --post-key-cleanup true
node scripts/assess-environment-kit.mjs \
  --record art/generation/environment-kit-v2.json \
  --output art/generation/environment-kit/evidence/environment-kit-v2
```

The assessor runs preparation twice in isolated temporary directories and requires both outputs to equal the recorded hash. It reports two separate decisions:

- **Strict raw contract** checks the 1536 × 1024 3 × 2 layout, exact and tolerant matte, six recoverable components, separation, and declared source-cell padding. Raw failures are always reported.
- **Prepared ingress** permits only explicitly declared matte and padding failures to become remediated warnings. It passes only when byte-identical preparation and every transparent-matte, spill, border, common-contact, collision, runtime-silhouette, configured wall-topology, paired-lantern-scale, and negative-control test pass.

`preparedIntegrationSafe` means only that a cell may advance to independent visual acceptance. It never means production-approved or runtime-integrated.

## v1: rejected

V1 remains reproducible with its original prepared hash `d24bb007b9401bc083ad5e69241541a168dc934c516ae9044e196a3aeecdf95d`. Its strict raw verdict and prepared-ingress verdict are both **REJECT**. The prepared raster retains transparent RGB contamination and measurable magenta spill, and the narrowed gate misses the minimum doorway-aperture proxy. The original five paired controls are still caught 5/5, and 0/6 cells are prepared-integration-safe.

## v2: mechanical prepared-ingress pass, still quarantined

V2 raw bytes hash to `b8954bf785d6da2057744c11b1c8e47084140f9458229c4cc739fe6576f2a47e`; the corrected prompt was frozen before generation at commit `53f1febde56978e3c53f57259755e4b4ac31e4ad`, and v1 raw was the sole image reference. Its strict raw verdict is **REJECT** because the generated backdrop is not literal `#ff00ff` and no raw cell retains the requested 62-pixel padding.

Those two failures are explicitly remediable at the deterministic boundary. The prepared bytes hash to `2af4efd5dad1a3b0472c7360b53851f6d329ac6254aa59024f3191a06da00210` and earn **PASS** for prepared ingress:

- 6/6 cells meet the 62-pixel prepared border, common baseline, contact, collision, and runtime-silhouette checks;
- the solid wall has zero measured central aperture and passes its broad-support collision proxy;
- the lantern height delta is 0.26%, width delta is 1.16%, and support-width delta is 8.93%, all within the frozen thresholds;
- transparent RGB contamination is zero and weighted magenta spill is 0.00000107 against a 0.00015 maximum;
- all 8/8 paired mutations are rejected, including mismatched lantern scale, a wall opening, and introduced magenta spill.

All six cells are mechanically eligible for independent visual acceptance, but v2 remains quarantined and `productionApproved` remains false. Stop here until a separate reviewer accepts the visuals and an explicitly scoped promotion is arranged.

The JSON, HTML, prepared cuts, runtime-scale sheet, and mutation sheet live under `evidence/environment-kit-v1/` and `evidence/environment-kit-v2/`.
