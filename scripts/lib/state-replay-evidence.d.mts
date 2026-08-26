export declare const STATE_REPLAY_SIGNAL_IDS: readonly string[];
export declare const STATE_REPLAY_FAILURE_IDS: readonly string[];

export declare function stableJson(value: unknown): string;
export declare function sha256(value: string | Uint8Array): string;
export declare function hashJson(value: unknown): string;

export interface StateReplayCaptureEvidence {
  tick: number;
  stateTick: number;
  manifestTick: number;
  snapshot: unknown;
  stateHash: string;
  manifestHash: string;
  frameHash: string;
}

export interface StateReplayEvidenceInput {
  initialState: unknown;
  initialStateHash?: string;
  loaded?: Partial<StateReplayCaptureEvidence>;
  reset?: Partial<StateReplayCaptureEvidence>;
  replayA?: {
    declaredTicks: number[];
    timeline: Array<Partial<StateReplayCaptureEvidence>>;
  };
  replayB?: {
    declaredTicks: number[];
    timeline: Array<Partial<StateReplayCaptureEvidence>>;
  };
}

export declare function evaluateStateReplayEvidence(
  input: StateReplayEvidenceInput,
): {
  pass: boolean;
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  failures: string[];
  timeline: {
    declaredTicks: number[];
    firstTicks: Array<number | undefined>;
    secondTicks: Array<number | undefined>;
    synchronized: boolean;
  };
};
