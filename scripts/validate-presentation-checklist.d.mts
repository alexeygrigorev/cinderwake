export interface PresentationChecklistIssue {
  code: string;
  location: string;
  message: string;
}

export interface PresentationAcceptanceBlocker {
  checkId: string;
  reason: string;
}

export interface PresentationChecklistValidation {
  schemaVersion: 1;
  valid: boolean;
  issues: PresentationChecklistIssue[];
  acceptanceBlockers: PresentationAcceptanceBlocker[];
}

export interface PresentationChecklistValidationOptions {
  mode?: "lint" | "accept";
  repoRoot?: string;
}

export function validatePresentationChecklist(
  contract: unknown,
  recipes: unknown,
  run: unknown,
  options?: PresentationChecklistValidationOptions,
): PresentationChecklistValidation;
