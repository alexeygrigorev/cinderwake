export interface CollisionEvidenceAssessment {
  pass: boolean;
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  failures: string[];
  summary: Record<string, unknown>;
}

export declare const COLLISION_SCENARIO_IDS: string[];
export declare const COLLISION_GESTURE_IDS: string[];
export declare const COLLISION_SIDE_IDS: string[];
export declare const COLLISION_TOPOLOGY_EXEMPTION: string;
export declare const COLLISION_SIGNAL_IDS: string[];
export declare const COLLISION_FAILURE_IDS: string[];
export declare const COLLISION_LIMITS: Record<string, unknown>;
export declare function isMapBlockedBoundaryObjectId(
  objectId: unknown,
): boolean;
export declare function evaluateCollisionEvidence(
  evidence: unknown,
): CollisionEvidenceAssessment;
export declare function runCollisionNegativeControls(evidence: unknown): Array<{
  id: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  expectedSignal: string;
  failures: string[];
}>;
