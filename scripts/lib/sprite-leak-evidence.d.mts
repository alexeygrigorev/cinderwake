export declare const SPRITE_LEAK_ALPHA_THRESHOLD: 8;
export declare const SPRITE_LEAK_SIGNAL_IDS: readonly string[];
export declare const SPRITE_LEAK_FAILURE_IDS: readonly string[];

export interface SpriteLeakRectV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteLeakBorderV1 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SpriteLeakSampleV1 {
  id: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  cell: SpriteLeakRectV1;
  sourceRect: SpriteLeakRectV1;
  transparentBorder: SpriteLeakBorderV1;
}

export interface SpriteLeakAssessmentV1 {
  id: string;
  valid: boolean;
  pass: boolean;
  failures: Array<{ code: string; detail: unknown }>;
  metrics: {
    width: number | null;
    height: number | null;
    inkPixels: number;
    borderPixels: number;
    borderInkPixels: number;
    opaqueMattePixels: number;
    fringePixels: number;
    maxBorderAlpha?: number;
    sourceRectInsideCell: boolean;
    sourceRectMatchesCell: boolean;
  };
}

export declare function assessSpriteLeakSample(
  sample: SpriteLeakSampleV1,
): SpriteLeakAssessmentV1;

export declare function evaluateSpriteLeakAssessments(
  assessments: SpriteLeakAssessmentV1[],
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: unknown;
  }>;
  assessments: SpriteLeakAssessmentV1[];
};

export declare function evaluateSpriteLeakEvidence(input?: {
  samples?: SpriteLeakSampleV1[];
}): ReturnType<typeof evaluateSpriteLeakAssessments>;

export declare function runSpriteLeakNegativeControls(
  sample: SpriteLeakSampleV1,
): Array<{
  id: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  expectedSignal: string;
  failures: string[];
}>;
