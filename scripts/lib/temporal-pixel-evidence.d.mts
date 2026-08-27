export declare const TEMPORAL_PIXEL_MUTATION_IDS: readonly string[];

export declare function runTemporalProductionPixelNegativeControls(
  frames: Uint8Array[],
): Promise<
  Array<{
    id: string;
    status: "DETECTED" | "NOT_DETECTED";
    signal: string;
    expectedSignal: string;
    pixelMutation: Record<string, unknown>;
  }>
>;
