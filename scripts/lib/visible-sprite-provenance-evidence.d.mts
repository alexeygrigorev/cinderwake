export declare const VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS: readonly string[];
export declare const VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS: readonly string[];
export declare const VISIBLE_SPRITE_PROVENANCE_SIGNAL_IDS: readonly string[];
export declare const VISIBLE_SPRITE_PROVENANCE_FAILURE_IDS: readonly string[];

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
  }>;
  pseudoElements: Array<Record<string, unknown>>;
  cssDecorations: Array<Record<string, unknown>>;
  canvasOperations: Array<Record<string, unknown>>;
  manifestDraws: Array<Record<string, unknown>>;
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
