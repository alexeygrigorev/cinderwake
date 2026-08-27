export declare const TEMPORAL_PIXEL_MUTATION_IDS: readonly string[];

export interface TemporalPixelMutation {
  kind: "production-compositor-png";
  changedFrameIndices: number[];
  changedFrameCount: number;
  sourceFrameHashes: string[];
  mutatedFrameHashes: string[];
}

export declare function runTemporalProductionPixelNegativeControls(
  frames: Uint8Array[],
): Promise<
  Array<{
    id: string;
    status: "DETECTED" | "NOT_DETECTED";
    signal: string;
    expectedSignal: string;
    pixelMutation: TemporalPixelMutation;
  }>
>;
