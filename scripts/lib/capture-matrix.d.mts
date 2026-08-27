export declare function selectMatrixEntryIds(
  entryIds: readonly string[],
  onlyValue?: string | null,
): string[];

export declare function isReusableMatrixEntry(args: {
  catalogEntry?: any;
  analysisPass: boolean;
  metadata?: any;
  requiredFilesPresent: boolean;
  expectedCaptureId: string;
  source: {
    commit: string;
    dirty: boolean;
    patchSha256: string;
  };
}): boolean;

export declare function pendingMatrixEntry(entry: {
  id: string;
  label: string;
  category: string;
  scenario: string;
  track: string;
  profile: string;
}): {
  id: string;
  label: string;
  category: string;
  scenario: string;
  trackedEntityId: string;
  profile: string;
  pass: false;
  checks: Record<string, never>;
  measurements: Record<string, never>;
  clipTransitionContract: null;
  negativeControls: never[];
  sourceCommit: null;
  report: null;
  contactSheet: null;
  metadata: string;
  analysis: string;
};

export declare function mergeMatrixEntries(
  entries: readonly any[],
  existingEntries: readonly any[] | undefined,
  capturedEntries: readonly any[],
): any[];
