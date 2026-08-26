export interface DepthTransitionSignal {
  id: string;
  pass: boolean;
  detail: Record<string, unknown>;
}

export interface DepthTransitionAssessment {
  pass: boolean;
  signals: DepthTransitionSignal[];
  failures: string[];
  summary: Record<string, number>;
}

export declare const DEPTH_TRANSITION_SIGNAL_IDS: string[];
export declare const DEPTH_TRANSITION_FAILURE_IDS: string[];
export declare const DEPTH_TRANSITION_LIMITS: Record<string, number>;
export declare function evaluateDepthTransitionEvidence(
  evidence: unknown,
): DepthTransitionAssessment;
