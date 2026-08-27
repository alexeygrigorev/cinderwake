export declare const CAMERA_MOTION_SCENARIO_IDS: {
  readonly edgeReversal: "map-edge-reversal";
};
export declare const CAMERA_MOTION_PROFILE_IDS: readonly [
  "desktop",
  "phone-portrait",
];
export declare const CAMERA_MOTION_GESTURE_IDS: readonly [
  "approach-map-edge",
  "reverse-west",
  "reverse-east",
];
export declare const CAMERA_MOTION_SIGNAL_IDS: readonly [
  "camera-converges",
  "camera-clamps",
  "camera-delta-continuous",
];
export declare const CAMERA_MOTION_FAILURE_IDS: readonly [
  "camera-speed-doubled",
  "camera-snap-detected",
  "camera-overshoot-detected",
  "camera-clamp-mismatch",
  "camera-axis-jitter",
  "camera-evidence-desynchronized",
];

export interface CameraMotionEvidenceInput {
  profiles: unknown[];
  requiredProfiles?: string[];
  requiredScenarioIds?: string[];
  requiredGestureIds?: string[];
}

export declare function evaluateCameraMotionEvidence(
  input: CameraMotionEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  profiles: Array<string | null>;
  scenarios: string[];
  gestures: string[];
  coverage: {
    hasAllProfiles: boolean;
    hasAllRuns: boolean;
    expectedRuns: number;
    actualRuns: number;
    timelinesSynchronized: boolean;
    knownProfileIds: string[];
  };
};

export declare function runCameraMotionNegativeControls(
  evidence?: CameraMotionEvidenceInput,
): Array<{
  id: string;
  expectedSignal: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  failures: string[];
}>;
