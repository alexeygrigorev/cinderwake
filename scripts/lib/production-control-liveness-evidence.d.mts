export declare const PRODUCTION_LIVENESS_SCENARIO_IDS: readonly string[];
export declare const PRODUCTION_LIVENESS_GESTURE_IDS: readonly string[];
export declare const PRODUCTION_LIVENESS_SIGNAL_IDS: readonly string[];
export declare const PRODUCTION_LIVENESS_FAILURE_IDS: readonly string[];
export declare const PRODUCTION_LIVENESS_DEADLINES_MS: {
  readonly selection: number;
  readonly begin: number;
  readonly control: number;
  readonly recovery: number;
};

export interface ProductionControlLivenessEvidenceInput {
  profiles: unknown[];
  recovery: unknown;
  requiredProfiles?: string[];
  requiredScenarioIds?: string[];
  requiredClasses?: string[];
  deadlines?: Record<string, number>;
}

export declare function evaluateProductionControlLiveness(
  input: ProductionControlLivenessEvidenceInput,
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
