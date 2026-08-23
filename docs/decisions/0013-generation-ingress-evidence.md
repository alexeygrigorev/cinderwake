# ADR 0013: Separate generative ingress evidence from deterministic asset builds

## Status

Accepted.

## Context

The fixed actor rig makes packing and runtime animation deterministic, but it did not preserve enough evidence about how generated source images entered the repository. The accepted actor sheets still matched their original generated artifact bytes, yet historical exact prompts had not been retained. Regenerating from a remembered prompt would therefore create false provenance, and prompt preservation alone could not promise identical pixels from a nondeterministic model.

A live trial also showed that the image generator returned a 1254 × 1254 raster after an exact 1024 × 1024 request. Treating the requested dimensions as observed dimensions would make the contract inaccurate. Independent review then rejected all three raw outputs despite successful packing: almost no background pixels were literal `#ff00ff`, actors touched cell boundaries, anchors drifted, and two prompts contradicted their own identity references. This proved that a tolerant runtime packer cannot also serve as the source-art acceptance gate.

## Decision

The pipeline has three explicit evidence boundaries:

1. Before generation, commit the exact prompt contract. After generation, retain the candidate bytes, SHA-256, tool artifact ID, and hashes of every reference image. Historical sources without exact prompts instead link to an explicitly reconstructed brief.
2. At raw ingress, accept only square rasters at least 1024 pixels wide for analysis, then measure literal chroma, per-cell component bounds, edge contact, and baselines on the normalized grid. A rejected result retains machine-readable structural and visual reasons.
3. Prepare without overwriting: deterministically resize to 1024 × 1024, key chroma shades, remove boundary-connected neighbor fragments, apply one shared scale, ground every cell, and emit literal-magenta source bytes with input/output hashes plus the exact command. Preparation repairs mechanics, never missing poses or subjective art.
4. After source acceptance, treat committed source bytes as immutable build inputs. Build representative actors twice in isolated temporary directories, require byte-identical outputs, and compare them with the committed production atlases.

Fresh candidates never overwrite production art. A verifier stages a complete six-source actor set in a temporary directory, substitutes one candidate family, and passes it through the real packer. Rejected candidates may travel through this step only as labeled builder-tolerance diagnostics. Vanguard remains rejected for an incomplete gait and prompt/reference contradiction; Ranger remains rejected for its oversized effect, runtime phase mismatch, and prompt/reference contradiction. Deterministically prepared Stonekin reactions are accepted for pipeline proof because independent review found the underlying collapse coherent and preparation repaired the mechanical grid. Separately, the complete accepted six-family sets for all three actors prove the normal production path.

Automated pipeline acceptance and production-art acceptance are different verdicts. Structural checks can approve a candidate for pipeline proof. Replacing production art additionally requires independent visual review, the normal sprite validator, browser visual tests, and the complete temporal matrix. No candidate is promoted merely because it is packable.

## Rejected alternatives

- Regenerating missing historical prompts was rejected because it would present an inference as provenance.
- Treating the prompt as a reproducible output recipe was rejected because the generator is nondeterministic.
- Requiring the raw generator output to be exactly 1024 × 1024 was rejected because the tool does not honor that request and the deterministic normalization boundary is already explicit.
- Automatically promoting a structurally valid candidate was rejected because cell semantics, anatomy, style, and natural motion remain partly perceptual judgments.
- Treating successful packing as source acceptance was rejected after the first live candidates demonstrated that cleanup can conceal bad raw boundaries and baselines.
- Running the verifier against production paths was rejected because a quality command must not mutate accepted art.

## Consequences

An agent can now prove which exact bytes, prompt or honest legacy brief, references, and generated artifact produced an ingress candidate; demonstrate that it survives the real packer; and reproduce the accepted production atlas from immutable sources. The public report exposes both pass/fail evidence and the boundary of the claim. The cost is retaining candidate images and manifests and continuing independent visual review before production promotion.
