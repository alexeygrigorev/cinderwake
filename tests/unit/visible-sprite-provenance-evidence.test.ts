import { describe, expect, it } from "vitest";
import {
  evaluateVisibleSpriteProvenanceEvidence,
  runVisibleSpriteProvenanceNegativeControls,
} from "../../scripts/lib/visible-sprite-provenance-evidence.mjs";

const scenarios = [
  "public-selection",
  "ordinary-production-launch",
  "outcome-win",
  "outcome-loss",
  "embercross-services",
];

function stateFixture(scenarioId: string) {
  return {
    scenarioId,
    stateId: `${scenarioId}:visible`,
    visibleRoles: [
      {
        id: `${scenarioId}:button`,
        visible: true,
        role: "sprite",
        provenance: {
          kind: "decoded-raster",
          assetUrl: "/assets/sprites/ui.png",
        },
      },
      {
        id: `${scenarioId}:layout`,
        visible: true,
        role: "layout",
      },
    ],
    textNodes: [
      {
        id: `${scenarioId}:title`,
        value: "Cinderwake",
        visible: true,
        titleRole: true,
      },
    ],
    pseudoElements: [
      {
        id: `${scenarioId}:legibility-mask`,
        visible: true,
        provenance: { kind: "declared-composition", allowed: true },
      },
    ],
    cssDecorations: [],
    canvasOperations:
      scenarioId === "public-selection"
        ? []
        : [
            {
              id: `${scenarioId}:draw-image`,
              visible: true,
              operation: "drawImage",
              provenance: {
                kind: "manifest-sprite",
                renderMode: "sprite",
                spriteId: "hero:vanguard",
                assetId: "atlas:actor:vanguard",
              },
            },
          ],
    manifestDraws:
      scenarioId === "public-selection"
        ? []
        : [
            {
              id: `${scenarioId}:player`,
              visible: true,
              renderMode: "sprite",
              spriteId: "hero:vanguard",
              assetId: "atlas:actor:vanguard",
            },
          ],
  };
}

function evidenceFixture() {
  return {
    profiles: [
      {
        profileId: "desktop",
        decodedAssets: [
          {
            assetId: "atlas:ui",
            url: "/assets/sprites/ui.png",
            width: 1024,
            height: 1024,
            decoded: true,
          },
          {
            assetId: "atlas:actor:vanguard",
            url: "/assets/sprites/actor-vanguard.png",
            width: 1024,
            height: 5120,
            decoded: true,
          },
        ],
        states: scenarios.map(stateFixture),
      },
      {
        profileId: "phone-portrait",
        decodedAssets: [
          {
            assetId: "atlas:ui",
            url: "/assets/sprites/ui.png",
            width: 1024,
            height: 1024,
            decoded: true,
          },
          {
            assetId: "atlas:actor:vanguard",
            url: "/assets/sprites/actor-vanguard.png",
            width: 1024,
            height: 5120,
            decoded: true,
          },
        ],
        states: scenarios.map(stateFixture),
      },
    ],
    requiredProfiles: ["desktop", "phone-portrait"],
    requiredScenarioIds: scenarios,
    titleAllowlist: ["Cinderwake"],
  };
}

describe("visible sprite provenance evidence", () => {
  it("accepts a complete decoded-role and canvas manifest inventory", () => {
    const evidence = evidenceFixture();
    const result = evaluateVisibleSpriteProvenanceEvidence(evidence);

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
  });

  it("detects every named role, title, and CSS decoration mutation", () => {
    const controls =
      runVisibleSpriteProvenanceNegativeControls(evidenceFixture());

    expect(controls).toHaveLength(3);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "non-sprite-visible-role",
      "title-role-not-allowlisted",
      "visible-draw-without-sprite-provenance",
    ]);
  });

  it("rejects missing required states and decoded assets", () => {
    const evidence = evidenceFixture();
    evidence.profiles[0].states = evidence.profiles[0].states.slice(0, 1);
    const result = evaluateVisibleSpriteProvenanceEvidence(evidence);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("provenance-inventory-incomplete");

    const complete = evidenceFixture();
    complete.profiles[0].decodedAssets[0].decoded = false;
    const missingAsset = evaluateVisibleSpriteProvenanceEvidence(complete);
    expect(missingAsset.failures).toContain("non-sprite-visible-role");
    expect(missingAsset.failures).toContain("decoded-asset-missing");
  });
});
