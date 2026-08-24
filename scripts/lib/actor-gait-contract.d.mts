export interface GaitPoint {
  x: number;
  y: number;
}

export interface GaitFrame {
  rasterHash: string;
  phase: number;
  support: string;
  anchorY: number;
  landmarks: Record<string, GaitPoint>;
  opaquePixels?: string[];
}

export interface GaitBank {
  frames: GaitFrame[];
}

export interface GaitThresholds {
  expectedFrames: number;
  minimumLandmarkAlpha: number;
  minimumSupportSwitches: number;
  maximumAnchorShift: number;
  maximumVerticalScaleRatio: number;
  minimumFootTravel: number;
  minimumKneeTravel: number;
  phaseSequence: number[];
}

export interface GaitAssessment {
  pass: boolean;
  failures: Array<{ code: string; detail: unknown }>;
  measurements: Record<string, number>;
}

export function assessLandmarkGaitBank(
  bank: GaitBank,
  thresholds: GaitThresholds,
  alphaAt: (frameIndex: number, x: number, y: number) => number,
): GaitAssessment;

export function fixtureAlphaReader(
  fixture: GaitBank & { frames: Array<GaitFrame & { opaquePixels: string[] }> },
): (frameIndex: number, x: number, y: number) => number;

export function mutateFixture<T>(fixture: T, mutation: (candidate: T) => T): T;
