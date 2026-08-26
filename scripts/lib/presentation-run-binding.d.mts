export interface PresentationRunEntry {
  checkId: string;
  executionRecipeId: string;
  result: "UNRUN" | "PASS" | "FAIL" | "NEEDS_VISUAL_REVIEW";
  coverageAtRun: string;
  observed: {
    scenarioIds: string[];
    deviceProfileIds: string[];
    gestureIds: string[];
  };
  firstFailingTick: number | null;
  signals: Array<Record<string, unknown>>;
  artifacts: Array<{ requirement: string; path: string; sha256: string }>;
  negativeControls: Array<{
    id: string;
    status: "UNRUN" | "DETECTED" | "NOT_DETECTED";
    signal: string;
    artifacts: Array<{ requirement: string; path: string; sha256: string }>;
  }>;
  visualReview: Record<string, unknown>;
  reproduce: string;
}

export interface PresentationRunBindingInput {
  repoRoot: string;
  runId: string;
  template: { checks: PresentationRunEntry[]; [key: string]: unknown };
  contract: any;
  recipes: any;
  cityMetadata: any;
  cityComparison: any;
  stateMetadata: any;
  stateComparison: any;
  inputMetadata: any;
  inputComparison: any;
  mobileMetadata: any;
  mobileComparison: any;
  liveMetadata: any;
  liveComparison: any;
  movementMetadata: any;
  movementComparison: any;
  spriteMetadata: any;
  spriteComparison: any;
  temporalMetadata: any;
  temporalComparison: any;
  commit: string;
  reproduce: string;
  cityArtifacts?: Array<readonly [string, string]>;
  stateArtifacts?: Array<readonly [string, string]>;
  inputArtifacts?: Array<readonly [string, string]>;
  mobileArtifacts?: Array<readonly [string, string]> | null;
  liveArtifacts?: Array<readonly [string, string]>;
  movementArtifacts?: Array<readonly [string, string]>;
  spriteArtifacts?: Array<readonly [string, string]>;
  temporalArtifacts?: Array<readonly [string, string]>;
}

export declare function bindPresentationRun(
  input: PresentationRunBindingInput,
): Promise<{
  [key: string]: unknown;
  runId: string;
  environment: { commit: string; reproduce: string };
  checks: PresentationRunEntry[];
}>;
