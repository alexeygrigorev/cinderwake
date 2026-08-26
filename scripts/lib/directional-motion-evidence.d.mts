export declare const DIRECTIONAL_MOTION_SCENARIO_IDS: {
  readonly fixedCamera: "fixed-camera-open-floor";
  readonly followCamera: "follow-camera-open-floor";
};
export declare const DIRECTIONAL_MOTION_ACTOR_IDS: readonly [
  "vanguard",
  "ranger",
  "arcanist",
];
export declare const DIRECTIONAL_MOTION_DIRECTION_IDS: readonly [
  "move-north",
  "move-east",
  "move-south",
  "move-west",
];
export declare const DIRECTIONAL_MOTION_SIGNAL_IDS: readonly [
  "world-direction-matches",
  "screen-direction-matches",
  "facing-and-walk-match",
];
export declare const DIRECTIONAL_MOTION_FAILURE_IDS: readonly [
  "world-direction",
  "screen-direction",
  "facing-mismatch",
  "walk-frozen",
  "directional-evidence-desynchronized",
];

export interface DirectionalMotionEvidenceInput {
  profiles: unknown[];
  requiredProfiles?: string[];
  requiredActorIds?: string[];
  requiredScenarioIds?: string[];
  requiredDirectionIds?: string[];
}

export declare function evaluateDirectionalMotionEvidence(
  input: DirectionalMotionEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  profiles: Array<string | null>;
  actors: string[];
  scenarios: string[];
  directions: string[];
  coverage: {
    hasAllProfiles: boolean;
    hasAllRuns: boolean;
    expectedRuns: number;
    actualRuns: number;
    timelinesSynchronized: boolean;
    knownProfileIds: string[];
  };
};
