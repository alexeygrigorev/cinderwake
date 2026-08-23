# ADR 0014: Mobile selection art and real launch-path testing

Date: 2026-08-23

## Status

Accepted.

## Problem

The first sprite-backed character selector was mechanically valid but visibly poor on a physical mobile browser. It repeated one terrain atlas across the page, cropped tiny idle cells from runtime animation sheets, clipped the title, spaced glyph copy into fragments, and made three large ornamental cards feel empty. Browser input tests also started scenarios through query parameters, so they did not prove that a player could select a hero, press the real start button, finish asset loading, and operate the resulting touch controls.

## Decision

- Give each playable class one production 2:3 selection scene with a full-height hero, constructed gothic scenery, buildings, and foreground props. Preserve the exact prompt, reference hashes, original PNG, generated artifact ID, review verdict, deterministic WebP recipe, and public bytes.
- Use the selected scene as the viewport art and as the source for three compact portrait tabs. Keep the complete selection flow within one mobile viewport; remove the long descriptive copy and oversized framed rows.
- Treat selection names as the only DOM titles. Seed, action, progress, and testing labels remain glyph sprites with accessible labels.
- Report atlas load progress. If any atlas fails, replace the indefinite loading view with explicit Retry and Back actions.
- Exercise the actual selection route with `?testMode=1&selection=1`. The browser test must tap a class, observe its scene, press Start, reach a canvas, prove the selected class entered state, move through the touch pad, and prove ability, attack, and tonic buttons change state. A separate negative control aborts an atlas request and requires the retryable error screen.

## Why this advances the testing goal

The visual baseline now represents what a mobile player sees rather than a diagnostic sheet. The real launch test closes the gap between deterministic scenario injection and ordinary product behavior: both paths reach the same observable state bridge, so a green engine suite cannot hide a broken selection or loading screen.

## Rejected alternatives

- Keeping the failed screen because the asset pipeline correctly rejected its source confuses diagnostic correctness with product quality.
- Using runtime atlas cells as marketing portraits optimizes reuse at the expense of focal scale and composition.
- Adding only a loading timeout still leaves the real buttons and selected-class handoff unproved.
- Encoding the entire selector into one generated screenshot would look polished but destroy accessible, testable interaction surfaces.

## Verification

Run:

```bash
npm run art:selection:check
npx playwright test tests/e2e/mobile.spec.ts tests/e2e/ui-text-contract.spec.ts
```

Review both committed selection baselines. Production acceptance requires title containment, decoded local sprites, portrait-filled touch targets, no viewport overflow, successful selection-to-canvas launch, state-changing touch controls, and a visible recovery path for asset failure.
