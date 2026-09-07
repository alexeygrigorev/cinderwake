import { describe, expect, it } from "vitest";
import {
  evaluateVisibleSpriteProvenanceEvidence,
  runVisibleSpriteProvenanceNegativeControls,
  nativeCampaignCopyPass,
} from "../../scripts/lib/visible-sprite-provenance-evidence.mjs";
import type {
  VisibleSpriteProfileV1,
  VisibleSpriteStateV1,
  CampaignCopyFacts,
} from "../../scripts/lib/visible-sprite-provenance-evidence.d.mts";

const scenarios = [
  "public-selection",
  "ordinary-production-launch",
  "campaign-journal",
  "outcome-win",
  "outcome-loss",
  "embercross-services",
];

function stateFixture(scenarioId: string): VisibleSpriteStateV1 {
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
      ...(scenarioId === "campaign-journal"
        ? [
            {
              id: "journal-prose",
              value: "Carry the warning to Embercross.",
              visible: true,
              titleRole: false,
              nativeCopy: {
                scope: "campaign-narrative",
                rootTag: "DIALOG",
                rootClass: "campaign-dialog",
                rootLabel: "The Last Bell journal",
                gameChild: true,
                unique: true,
                modal: true,
                tag: "P",
                fontSize: 16,
              },
            },
          ]
        : []),
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
              id: `${scenarioId}:hidden-scene-sprite`,
              visible: false,
              renderMode: "not-a-sprite",
            },
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

function evidenceFixture(): {
  profiles: VisibleSpriteProfileV1[];
  requiredProfiles: string[];
  requiredScenarioIds: string[];
  titleAllowlist: string[];
} {
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

function registeredTelegraphEvidence() {
  const evidence = evidenceFixture();
  const state = evidence.profiles[0].states.find(
    ({ scenarioId }) => scenarioId === "ordinary-production-launch",
  )!;
  state.combatState = {
    tick: 40,
    pendingAttacks: [
      {
        id: "attack:bell-keeper:ability",
        ownerId: "monster:bell-keeper",
        kind: "ability",
        impactTick: 48,
        origin: { x: 6656, y: 4608 },
        range: 2048,
      },
    ],
    monsters: [
      {
        id: "monster:bell-keeper",
        kind: "stonekin",
        elite: true,
        health: 1000,
      },
    ],
  };
  state.manifestDraws.push({
    id: "combat-telegraph:attack:bell-keeper:ability",
    visible: true,
    role: "combat-telegraph",
    paintRole: "combat-telegraph",
    layer: "effects",
    attackId: "attack:bell-keeper:ability",
    ownerId: "monster:bell-keeper",
    worldCenter: { x: 6656, y: 4608 },
    radius: 2048,
    impactTick: 48,
    projectedBounds: { x: 0, y: 0, width: 184, height: 184 },
  });
  return evidence;
}

describe("visible sprite provenance evidence", () => {
  it("requires readable semantic interface text inside the actual game root", () => {
    const copy: CampaignCopyFacts = {
      scope: "interface",
      rootTag: "MAIN",
      rootClass: "game",
      rootLabel: null,
      gameChild: false,
      interfaceRoot: true,
      nativeElement: true,
      unique: true,
      modal: false,
      tag: "SPAN",
      fontSize: 14,
    };
    expect(nativeCampaignCopyPass(copy)).toBe(true);
    for (const mutation of [
      { interfaceRoot: false },
      { nativeElement: false },
      { unique: false },
      { fontSize: 13 },
      { fontSize: Number.NaN },
    ]) {
      expect(nativeCampaignCopyPass({ ...copy, ...mutation })).toBe(false);
    }
  });
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

    expect(controls).toHaveLength(4);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "non-sprite-visible-role",
      "title-role-not-allowlisted",
      "visible-text-offender",
      "visible-draw-without-sprite-provenance",
    ]);
  });

  it("accepts semantic journal prose and rejects forged or unreadable exemptions", () => {
    const copy: CampaignCopyFacts = {
      scope: "campaign-narrative",
      rootTag: "DIALOG",
      rootClass: "campaign-dialog",
      rootLabel: "The Last Bell journal",
      gameChild: true,
      unique: true,
      modal: true,
      tag: "P",
      fontSize: 16,
    };
    expect(nativeCampaignCopyPass(copy)).toBe(true);
    expect(
      nativeCampaignCopyPass({ ...copy, tag: "STRONG", fontSize: 16 }),
    ).toBe(true);
    for (const mutation of [
      { rootTag: "DIV" },
      { modal: false },
      { gameChild: false },
      { unique: false },
      { fontSize: 15 },
      { rootLabel: "Forged" },
      { tag: "SMALL", fontSize: 12 },
      { tag: "STRONG", fontSize: 15 },
      { scope: "anything" },
    ])
      expect(nativeCampaignCopyPass({ ...copy, ...mutation })).toBe(false);
    const evidence = evidenceFixture();
    evidence.profiles[0].states[0].textNodes.push({
      id: "journal-prose",
      value: "Follow the signs to Embercross.",
      visible: true,
      titleRole: false,
      nativeCopy: copy,
    });
    expect(evaluateVisibleSpriteProvenanceEvidence(evidence).pass).toBe(true);
    copy.fontSize = 9;
    expect(
      evaluateVisibleSpriteProvenanceEvidence(evidence).failures,
    ).toContain("visible-text-offender");
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

  it("does not accept an empty journal capture as narrative coverage", () => {
    const evidence = evidenceFixture();
    const journal = evidence.profiles[0].states.find(
      (state) => state.scenarioId === "campaign-journal",
    )!;
    journal.textNodes = journal.textNodes.filter((text) => !text.nativeCopy);
    expect(
      evaluateVisibleSpriteProvenanceEvidence(evidence).failures,
    ).toContain("provenance-inventory-incomplete");
  });

  it("accepts only a manifest telegraph backed by a live radial-slam attack", () => {
    const evidence = registeredTelegraphEvidence();
    const accepted = evaluateVisibleSpriteProvenanceEvidence(evidence);
    expect(accepted.pass).toBe(true);
    expect(accepted.signals).toContainEqual(
      expect.objectContaining({
        id: "combat-telegraphs-match-live-attacks",
        pass: true,
      }),
    );

    const wrongRadius = structuredClone(evidence);
    wrongRadius.profiles[0].states[1]!.manifestDraws.at(-1)!.radius = 2047;
    const rejectedRadius = evaluateVisibleSpriteProvenanceEvidence(wrongRadius);
    expect(rejectedRadius.failures).toContain(
      "combat-telegraph-contract-mismatch",
    );

    const forged = evidenceFixture();
    forged.profiles[0].states[1]!.manifestDraws.push({
      id: "combat-telegraph:forged",
      visible: true,
      role: "combat-telegraph",
      paintRole: "combat-telegraph",
      layer: "effects",
      attackId: "attack:missing",
      ownerId: "monster:missing",
      worldCenter: { x: 1, y: 1 },
      radius: 2048,
      impactTick: 48,
      projectedBounds: { x: 0, y: 0, width: 184, height: 184 },
    });
    const rejectedForged = evaluateVisibleSpriteProvenanceEvidence(forged);
    expect(rejectedForged.failures).toContain(
      "combat-telegraph-contract-mismatch",
    );
  });
});
