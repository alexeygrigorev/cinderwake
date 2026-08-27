export declare const COMPOSITOR_SIGNAL_IDS: readonly string[];
export declare const COMPOSITOR_FAILURE_IDS: readonly string[];
export declare const LIVE_COMPOSITOR_SIGNAL_IDS: readonly string[];
export declare const LIVE_COMPOSITOR_FAILURE_IDS: readonly string[];

export interface PngResidualV1 {
  width: number;
  height: number;
  differingPixels: number;
  maxChannelDelta: number;
  changedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export declare function measurePngResidual(
  firstPng: Uint8Array,
  secondPng: Uint8Array,
): Promise<PngResidualV1>;

export interface CompositorEvidenceInput {
  repeat?: {
    firstFrameHash?: string;
    secondFrameHash?: string;
  };
  transition?: {
    afterFrameHash?: string;
    freshFrameHash?: string;
  };
  ownerPaints?: Array<{
    ownerId: string;
    bodyPaintCount: number;
  }>;
}

export declare function evaluateCompositorEvidence(
  input: CompositorEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
};

export declare function runCompositorNegativeControls(
  input: CompositorEvidenceInput,
): Array<{
  id: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  expectedSignal: string;
  failures: string[];
}>;

export interface LiveCompositorEvidenceInput {
  segments?: Array<{
    id: string;
    expectedTicks: number[];
    frames: Array<{
      tick: number;
      expectedOwnerIds: string[];
      observedOwnerIds: string[];
      ownerPaints: Array<{
        ownerId: string;
        bodyPaintCount: number;
      }>;
    }>;
  }>;
  residuals?: Array<{
    differingPixels: number;
    maxChannelDelta: number;
    changedBounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
  }>;
  effects?: Array<{
    effectId: string;
    observedBefore: boolean;
    observedAfter: boolean;
  }>;
}

export declare function evaluateLiveCompositorEvidence(
  input: LiveCompositorEvidenceInput,
): {
  pass: boolean;
  failures: string[];
  signals: Array<{
    id: string;
    pass: boolean;
    detail: Record<string, unknown>;
  }>;
};

export declare function runLiveCompositorNegativeControls(
  input: LiveCompositorEvidenceInput,
): Array<{
  id: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  expectedSignal: string;
  failures: string[];
}>;
