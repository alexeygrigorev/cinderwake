export declare const COMPOSITOR_SIGNAL_IDS: readonly string[];
export declare const COMPOSITOR_FAILURE_IDS: readonly string[];

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
