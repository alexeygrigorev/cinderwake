export declare const VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS: readonly string[];
export declare const VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS: readonly string[];
export declare const VISIBLE_SPRITE_PROVENANCE_SIGNAL_IDS: readonly string[];
export declare const VISIBLE_SPRITE_PROVENANCE_FAILURE_IDS: readonly string[];
export interface CampaignCopyFacts {
  scope: string | null;
  rootTag: string;
  rootClass: string;
  rootLabel: string | null;
  gameChild: boolean;
  interfaceRoot?: boolean;
  nativeElement?: boolean;
  unique: boolean;
  modal: boolean;
  tag: string;
  fontSize: number;
  metadata?: boolean;
  control?: boolean;
}
export declare function collectCampaignCopyFacts(): Record<
  number,
  CampaignCopyFacts
>;
export declare function nativeCampaignCopyPass(
  copy?: CampaignCopyFacts,
): boolean;

export interface DecodedRasterAssetV1 {
  assetId?: string;
  url: string;
  width: number;
  height: number;
  decoded: boolean;
}

export interface VisibleSpriteRoleV1 {
  id: string;
  visible: boolean;
  role: "sprite" | "layout" | "title";
  provenance?: {
    kind: "decoded-raster" | string;
    assetUrl?: string;
  };
}

export interface VisibleSpriteStateV1 {
  scenarioId: string;
  stateId: string;
  visibleRoles: VisibleSpriteRoleV1[];
  textNodes: Array<{
    id: string;
    value: string;
    visible: boolean;
    titleRole: boolean;
    nativeCopy?: CampaignCopyFacts;
  }>;
  pseudoElements: Array<Record<string, unknown>>;
  cssDecorations: Array<Record<string, unknown>>;
  canvasOperations: Array<Record<string, unknown>>;
  manifestDraws: Array<Record<string, unknown>>;
  combatState?: {
    tick: number;
    pendingAttacks: Array<{
      id: string;
      ownerId: string;
      kind: "primary" | "ability";
      impactTick: number;
      origin: { x: number; y: number };
      range: number;
    }>;
    monsters: Array<{
      id: string;
      kind: string;
      elite: boolean;
      health: number;
    }>;
  } | null;
}

export interface VisibleSpriteProfileV1 {
  profileId: string;
  decodedAssets: DecodedRasterAssetV1[];
  states: VisibleSpriteStateV1[];
}

export declare function evaluateVisibleSpriteProvenanceEvidence(input?: {
  profiles?: VisibleSpriteProfileV1[];
  requiredProfiles?: string[];
  requiredScenarioIds?: string[];
  titleAllowlist?: string[];
}): {
  pass: boolean;
  failures: string[];
  scenarioCoverage: boolean;
  signals: Array<{ id: string; pass: boolean; detail: unknown }>;
  profiles: Array<string | null>;
  inventories: unknown[];
};

export declare function runVisibleSpriteProvenanceNegativeControls(evidence: {
  profiles: VisibleSpriteProfileV1[];
}): Array<{
  id: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  expectedSignal: string;
  failures: string[];
}>;
