export const TEMPORAL_SEQUENCE_ENTRY_IDS: readonly string[];
export const TEMPORAL_LIVE_PROFILE_IDS: readonly string[];
export const TEMPORAL_LIVE_ACTOR_IDS: readonly string[];
export const TEMPORAL_LIVE_STRIP_LABELS: readonly string[];

export declare function validateOrdinaryRouteTemporalStrips(evidence: any): {
  pass: boolean;
  failures: Array<{ code: string; detail: unknown }>;
  signal: Record<string, unknown>;
  summary: Record<string, unknown>;
};

export declare function validateTemporalSequenceCatalog(catalog: any): {
  pass: boolean;
  failures: Array<{ code: string; detail: unknown }>;
  signals: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
};

export declare function runTemporalSequenceNegativeControls(): Array<{
  id: string;
  expectedSignal: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  detected: boolean;
}>;
