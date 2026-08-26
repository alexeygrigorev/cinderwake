export declare const MOBILE_SCREEN_PROFILE_IDS: readonly [
  "phone-portrait",
  "phone-landscape",
];
export declare const MOBILE_SCREEN_SCENARIO_IDS: readonly [
  "public-selection",
  "ordinary-production-launch",
  "embercross-services",
];
export declare const MOBILE_SCREEN_GESTURE_IDS: readonly [
  "touch-select-begin",
  "touch-move",
  "touch-strike",
  "rotate",
  "open-city-service",
];
export declare const MOBILE_SCREEN_SIGNAL_IDS: readonly [
  "targets-contained",
  "subject-contained",
  "hud-and-controls-contained",
  "phone-text-legible",
  "pressed-feedback-live",
];
export declare const MOBILE_SCREEN_FAILURE_IDS: readonly string[];
export declare function evaluateMobileScreenEvidence(input: {
  profiles: any[];
  requiredProfiles?: readonly string[];
  requiredScenarioIds?: readonly string[];
}): {
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
