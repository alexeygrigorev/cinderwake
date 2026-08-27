export declare const DIRECTIONAL_BANK_ACTOR_IDS: readonly [
  "vanguard",
  "ranger",
  "arcanist",
];
export declare const DIRECTIONAL_BANK_DIRECTION_IDS: readonly [
  "move-north",
  "move-east",
  "move-south",
  "move-west",
];
export declare const DIRECTIONAL_BANK_SIGNAL_IDS: readonly [
  "facing-follows-intent",
  "bank-and-reflection-match",
  "target-aim-follows-intent",
  "action-origin-mirrors",
  "ability-recovery-is-contiguous",
];
export declare const DIRECTIONAL_BANK_FAILURE_IDS: readonly [
  "sprite-bank-mismatch",
  "east-reflection-missing",
  "stale-facing-bank",
  "target-aim-not-mirrored",
  "attack-origin-not-mirrored",
  "ability-recovery-mismatch",
  "directional-bank-evidence-desynchronized",
];

export interface DirectionalBankEvidenceInput {
  profiles: unknown[];
  requiredProfiles?: string[];
  requiredActorIds?: string[];
  requiredDirectionIds?: string[];
}

export declare function evaluateDirectionalBankEvidence(
  input: DirectionalBankEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  actors: string[];
  directions: string[];
  profiles: Array<string | null>;
  coverage: {
    hasAllProfiles: boolean;
    hasAllRuns: boolean;
    hasAllDirections: boolean;
    expectedRuns: number;
    actualRuns: number;
    timelinesSynchronized: boolean;
    knownProfileIds: string[];
  };
};
