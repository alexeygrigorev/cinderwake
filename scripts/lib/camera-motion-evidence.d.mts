export declare const CAMERA_MOTION_SCENARIO_IDS: {
  readonly edgeReversal: "map-edge-reversal";
  readonly diagonalCorner: "camera-diagonal-corner";
  readonly stopCenter: "camera-stop-center";
  readonly fixed: "fixed-camera-open-floor-arcanist";
  readonly snap: "snap-camera-open-floor-arcanist";
};
export declare const CAMERA_MOTION_PROFILE_IDS: readonly [
  "desktop",
  "phone-portrait",
];
export declare const CAMERA_MOTION_GESTURE_IDS: readonly [
  "approach-map-edge",
  "reverse-west",
  "reverse-east",
  "diagonal-north-west",
  "stop-after-diagonal",
  "stop-center",
  "fixed-travel",
  "snap-travel",
];
export declare const CAMERA_MOTION_RUN_SPECS: readonly [
  {
    readonly scenarioId: "map-edge-reversal";
    readonly cameraMode: "smooth";
    readonly artifactPrefix: "edge";
    readonly boundaryRequired: true;
    readonly gestureIds: readonly [
      "approach-map-edge",
      "reverse-west",
      "reverse-east",
    ];
  },
  {
    readonly scenarioId: "camera-diagonal-corner";
    readonly cameraMode: "smooth";
    readonly artifactPrefix: "diagonal-corner";
    readonly boundaryRequired: true;
    readonly gestureIds: readonly [
      "diagonal-north-west",
      "stop-after-diagonal",
    ];
  },
  {
    readonly scenarioId: "camera-stop-center";
    readonly cameraMode: "smooth";
    readonly artifactPrefix: "stop-center";
    readonly boundaryRequired: false;
    readonly gestureIds: readonly ["stop-center"];
  },
  {
    readonly scenarioId: "fixed-camera-open-floor-arcanist";
    readonly cameraMode: "fixed";
    readonly artifactPrefix: "fixed";
    readonly boundaryRequired: false;
    readonly gestureIds: readonly ["fixed-travel"];
  },
  {
    readonly scenarioId: "snap-camera-open-floor-arcanist";
    readonly cameraMode: "snap";
    readonly artifactPrefix: "snap";
    readonly boundaryRequired: false;
    readonly gestureIds: readonly ["snap-travel"];
  },
];
export declare const CAMERA_MOTION_SIGNAL_IDS: readonly [
  "camera-converges",
  "camera-clamps",
  "camera-delta-continuous",
  "camera-mode-contract",
];
export declare const CAMERA_MOTION_FAILURE_IDS: readonly [
  "camera-speed-doubled",
  "camera-snap-detected",
  "camera-overshoot-detected",
  "camera-clamp-mismatch",
  "camera-axis-jitter",
  "camera-evidence-desynchronized",
  "camera-mode-contract",
];

export interface CameraMotionEvidenceInput {
  profiles: unknown[];
  requiredProfiles?: string[];
  requiredRunSpecs?: Array<{
    scenarioId: string;
    cameraMode: "fixed" | "snap" | "smooth";
    artifactPrefix?: string;
    boundaryRequired?: boolean;
    gestureIds: string[];
  }>;
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
    requiredRunSpecs: Array<Record<string, unknown>>;
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
