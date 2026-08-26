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
  profiles: readonly unknown[];
  recovery: unknown;
  requiredProfiles?: readonly string[];
  requiredScenarioIds?: readonly string[];
  requiredClasses?: readonly string[];
  deadlines?: Readonly<Record<string, number>>;
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
