export declare const RENDER_RESOLUTION_SIGNAL_IDS: readonly string[];
export declare const RENDER_RESOLUTION_FAILURE_IDS: readonly string[];
export declare const RENDER_RESOLUTION_DETAIL_METRIC: string;
export declare const RENDER_RESOLUTION_BLUR_MUTATION: string;

export interface RenderResolutionGeometrySampleV1 {
  profileId: string;
  logicalViewport?: { width: number; height: number };
  css: { width: number; height: number };
  backing: { width: number; height: number };
  devicePixelRatio: number;
  manifestDpr: number;
}

export declare function expectedBackingStore(
  sample: RenderResolutionGeometrySampleV1,
): {
  width: number;
  height: number;
  renderScale: number;
  cssScale: number;
  targetCssDpr: number;
  targetScale: number;
} | null;

export interface RenderResolutionMetricV1 {
  metric: string;
  width: number;
  height: number;
  sampleCount: number;
  meanAbsLaplacian: number;
  highResidualRatio: number;
}

export interface RenderResolutionCropSampleV1 {
  id: string;
  profileId: string;
  role: "player" | "terrain";
  scenarioId: string;
  captureMode: "physical-canvas";
  frameSize: { width: number; height: number };
  crop: { x: number; y: number; width: number; height: number };
  blurMutation: string;
  sharpness: RenderResolutionMetricV1;
  blurredSharpness: RenderResolutionMetricV1;
}

export interface RenderResolutionEvidenceInputV1 {
  geometrySamples?: RenderResolutionGeometrySampleV1[];
  cropSamples?: RenderResolutionCropSampleV1[];
}

export declare function evaluateRenderResolutionEvidence(
  input?: RenderResolutionEvidenceInputV1,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
  calibration: Record<string, unknown>;
};

export declare function runRenderResolutionNegativeControls(
  input: RenderResolutionEvidenceInputV1,
): Array<{
  id: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  expectedSignal: string;
  failures: string[];
}>;

export declare function measurePngSharpness(
  png: Uint8Array,
): Promise<RenderResolutionMetricV1>;

export declare function measurePngCropSharpness(
  png: Uint8Array,
  request: { x: number; y: number; width: number; height: number },
): Promise<{
  crop: { x: number; y: number; width: number; height: number };
  frameSize: { width: number; height: number };
  cropPng: Uint8Array;
  blurredPng: Uint8Array;
  sharpness: RenderResolutionMetricV1;
  blurredSharpness: RenderResolutionMetricV1;
}>;
