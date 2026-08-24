# City service presentation evidence

Embercross service panels use two deterministic tight crops from the committed
UI atlas. The full derivation chain is recorded in
`art/generation/ui-service-components-v1.json` and repeated in
`public/assets/sprites/build-manifest.json`: raw legacy source hash, runtime
atlas hash, exact source rectangle, output hash, generation-record status, and
review status. The record deliberately says that historical generation details
are unavailable instead of inventing a tool, prompt, or artifact ID.

Run the structural and pixel-provenance checks with:

```sh
npm run art:build
npm run art:check
npx vitest run tests/unit/sprite-contract.test.ts
```

`tests/e2e/city-service-presentation.spec.ts` is the permanent phone evidence
matrix for `PRES-SPRITE-009`, `PRES-MOBILE-010`, and `PRES-CITY-027`. It restores
Mara, Oren, Tess, and Ileya in both 390×844 portrait and 844×390 landscape
profiles. Every resident has four ordered panel crops:

1. before activation, with a successful dry-run preview;
2. physical pointer-down, while the raster button has its pressed treatment;
3. after success, with the actual receipt deltas required to equal the preview;
4. after a rejected attempt, with no receipt and the exact rejection message.

The fixtures exercise capped food healing and hunger, overnight health,
fatigue, hunger, and minutes-to-dawn changes, dynamic healer pricing, merchant
stock, tonic and pelt inventory, and unaffordable/already-sated/already-rested/
full-health rejection states. The browser oracle also requires every glyph run
to be at least 13 CSS pixels, every action target to be at least 48×48 CSS
pixels, the panel to remain inside the viewport, and the portrait vitality HUD
to be explicitly hidden while a service sheet is open.

Reproduce and update the immutable candidates with:

```sh
npx playwright test tests/e2e/city-service-presentation.spec.ts
npx playwright test tests/e2e/city-service-presentation.spec.ts --update-snapshots
```

Passing these machine checks does not grant visual acceptance. Review the
ordered crops at their original size and keep the generation record's
`visualReviewStatus` as `candidate-requires-current-independent-review` until a
current independent reviewer accepts the exact hashes.
