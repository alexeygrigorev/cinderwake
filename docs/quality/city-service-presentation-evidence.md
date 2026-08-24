# City service presentation evidence

Embercross service panels use three deterministic tight crops from the committed
UI atlas: the outer panel, the ornamental action frame, and an opaque quiet
leather reading field that masks the frame's bright central skull beneath action
copy. The full derivation chain is recorded in
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
to be explicitly hidden while a service sheet is open. It additionally proves
that every action glyph is contained by the quiet field, the field covers the
ornament center, longest action/stock/feedback copy uses at most two lines, and
no wrapped final line contains a single orphan word. The asset validator freezes
the field at full opacity, mean luminance `<= 0.10`, and maximum luminance
`<= 0.25`, so a bright ornamental crop cannot silently replace it.

Reproduce and update the immutable candidates with:

```sh
npx playwright test tests/e2e/city-service-presentation.spec.ts
npx playwright test tests/e2e/city-service-presentation.spec.ts --update-snapshots
```

Passing these machine checks does not grant visual acceptance. Independent
reviewer `/root/city_ui_exact_review` inspected all 32 ordered crops at their
original resolution and recorded **ACCEPT** for exact implementation commit
`0c391469ff63e27213ce69efd94d52d04f19b0b9`. The accepted filename-ordered
snapshot set has SHA-256
`c31e10f70f50a424a45b17ece9b2868be3cd3052accdada3d54775508d29059c`;
reproduce it with:

```sh
sha256sum tests/e2e/city-service-presentation.spec.ts-snapshots/*.png \
  | sort -k2 \
  | sha256sum
```

The reviewer found that the opaque sprite-backed reading field keeps copy off
the bright skull/crossbar ornament; Tess's longest preview is compact rather
than a laborious three-line wrap; reduced letter spacing avoids Mara's orphaned
`held` and wall-like rejection copy; and all resident success/rejection sheets
remain readable and contained at original portrait and landscape phone scale.
Pointer-down feedback was visibly distinct throughout the matrix, with
normalized before-to-down RMSE from `0.0531` to `0.0801`.

The exact Tess reference hashes are:

| Profile/state          | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| Portrait before        | `1ce752f843c2fa1cdc7d53bebec65a5e99681ab3d0db921eae64b141fd3fe3df` |
| Portrait pointer-down  | `e5aec4b9634760d1f1828334f5dea5241ac2df13c2a0708e308f762fa8597d35` |
| Landscape before       | `5fce335c7cd028c58f1c8634e695f5c301cfbbe1989c1f918d83180cc98f61da` |
| Landscape pointer-down | `59cc87c77d79c2ed448cfafe453acf05dc0b88daf7b1dfb8d7439e2570dbae6f` |

This acceptance is hash-bound to the atlas, three extracted components, and
the complete 32-crop set recorded in
`art/generation/ui-service-components-v1.json`. A change to the implementation
commit or any accepted asset/evidence hash invalidates the acceptance and
requires a new original-resolution independent review.
