# ADR 0011: Attached effects do not weaken pose continuity

## Status

Accepted.

## Context

An attack frame can legitimately gain width when a shield spark, hand flash, or ground pulse appears. Treating every silhouette expansion as a body jump rejects good contact frames. Raising the ordinary dimension tolerance, however, would hide the exact animation pops the quality framework exists to catch.

## Decision

Locomotion and ordinary pose bounds keep their existing dimension limit. A one-shot action may use the larger attached-effect envelope only when both width and height remain within the effect limit and the measured raster centroid step and acceleration remain substantially below the ordinary pose-continuity limits. The report publishes both threshold families and a dedicated check. Independent visual review retains veto authority over every baseline update.

Projectile lifetime metadata is assessed against its real spawn/expiry ticks rather than the static-entity defaults. Quarter-tick mobile captures use a separately declared acceleration ceiling because repeated subframes intentionally hold one discrete authored pose between atlas boundaries; full-tick captures keep the tighter ceiling.

## Consequences

Contact VFX can read clearly without converting the assessor into a permissive width gate. A detached effect, off-center body jump, or unstable recovery still fails centroid, acceleration, lifecycle, or visual review. The exception remains profile-specific, machine-readable, reproducible from the saved masks, and documented whenever it changes.
