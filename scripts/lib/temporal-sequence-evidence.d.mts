export const TEMPORAL_SEQUENCE_ENTRY_IDS: readonly string[];

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
