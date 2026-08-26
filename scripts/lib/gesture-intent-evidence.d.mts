export declare const GESTURE_INTENT_SCENARIO_IDS: {
  readonly openFloor: string;
};
export declare const GESTURE_INTENT_GESTURE_IDS: readonly string[];
export declare const GESTURE_INTENT_SIGNAL_IDS: readonly string[];
export declare const GESTURE_INTENT_FAILURE_IDS: readonly string[];

export interface GestureIntentEvidenceInput {
  profiles: unknown[];
  requiredProfiles?: string[];
  requiredScenarioIds?: string[];
}

export declare function evaluateGestureIntentEvidence(
  input: GestureIntentEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  profiles: Array<string | null>;
  timelineSynchronized: boolean;
};
