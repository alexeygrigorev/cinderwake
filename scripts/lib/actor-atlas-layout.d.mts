export const ACTOR_ATLAS_LAYOUT_FAILURE_IDS: readonly string[];

export interface ActorAtlasLayoutInput {
  catalog: any;
  spec: any;
  contract: any;
}

export declare function validateActorAtlasLayout(
  input: ActorAtlasLayoutInput,
): {
  pass: boolean;
  failures: Array<{ code: string; detail: unknown }>;
  summary: Record<string, number>;
  mappings: Array<Record<string, unknown>>;
};

export declare function runActorAtlasLayoutNegativeControls(
  input: ActorAtlasLayoutInput,
): Array<{
  id: string;
  expectedSignal: string;
  status: "DETECTED" | "NOT_DETECTED";
  signal: string;
  detected: boolean;
  failures: Array<{ code: string; detail: unknown }>;
}>;
