import {
  GAME_FEEDBACK_COMPONENTS,
  componentReportValid as validateComponentReport,
} from "./game-feedback-contract.mjs";

export function gameFeedbackVerdict(
  results,
  complete,
  sourceStable,
  requiredComponents = GAME_FEEDBACK_COMPONENTS,
) {
  const ids = Array.isArray(results) ? results.map((result) => result?.id) : [];
  if (
    !complete ||
    !Array.isArray(requiredComponents) ||
    ids.length !== requiredComponents.length ||
    new Set(ids).size !== ids.length ||
    !requiredComponents.every((id) => ids.includes(id))
  )
    return "INCOMPLETE";
  if (
    !sourceStable ||
    results.some(
      (result) => result.exitCode !== 0 || result.reportValid !== true,
    )
  )
    return "FAIL";
  return "PASS";
}

export function componentReportValid(id, report, context = {}) {
  return validateComponentReport(id, report, context);
}
