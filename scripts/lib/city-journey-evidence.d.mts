export declare const CITY_JOURNEY_SIGNAL_IDS: readonly string[];
export declare const CITY_JOURNEY_FAILURE_IDS: readonly string[];
export declare const CITY_SERVICE_EXPECTATIONS: readonly {
  npcId: string;
  actionId: string;
}[];

export interface CityJourneyEvidenceInput {
  profiles: unknown[];
  requiredProfiles?: string[];
  serviceExpectations?: readonly { npcId: string; actionId: string }[];
}

export declare function evaluateCityJourneyEvidence(
  input: CityJourneyEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  profiles: Array<string | null | undefined>;
  timelineSynchronized: boolean;
};
