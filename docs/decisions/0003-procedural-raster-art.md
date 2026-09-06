# ADR 0003: original sprite-driven raster art

## Context

The project needs an original dark-fantasy presentation that remains inspectable in fresh clones and deterministic CI. Geometry-drawn actors and CSS/HTML decoration make it difficult to associate a temporal visual failure with a finite source frame, pivot, and clipping rectangle.

## Decision

Use local original raster atlases for all visible game/UI presentation; only titles may be text. Every asset has provenance and a versioned atlas manifest declaring source rectangles, anchors, clips, palette/tint policy, and layer. Generation happens before review and commit, never at runtime. Runtime loading, sprite selection, and render manifests are deterministic and identify the exact atlas frame/destination geometry.

### Campaign readability amendment — 2026-09-06

Campaign prose and journey controls use native text and CSS surfaces so players can read missions, save instructions, and conversations in a paused, scrollable journal. This replaces the title-only restriction for the two semantic campaign roots defined in [the testing contract](../testing-architecture.md). The provenance evaluator records their roles and font sizes separately, requires 16 CSS px for prose and 14 px for controls, and rejects forged markers. All existing sprite roles retain raster provenance requirements.

## Alternatives considered

- Runtime generative art: introduces nondeterminism and makes visual baselines opaque.
- Pure geometry/CSS placeholders: easy to start, but cannot exercise atlas clipping, authored silhouette, and sprite-frame quality.
- Text, emoji, icon-font, or remote UI decoration: varies by platform and cannot be tied to a local source frame.

## Consequences

The game retains a coherent, portable visual language while turning temporal review into finite, attributable evidence. Atlas validation, deterministic decode, source bounds, anchors, mobile integer scaling, and browser rasterization require explicit tests. The cost is maintaining provenance/manifests and reviewing regenerated frames before baseline updates; that cost is accepted because it prevents an attractive but irreproducible visual result.
