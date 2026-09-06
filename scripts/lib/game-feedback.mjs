export function gameFeedbackVerdict(results, complete, sourceStable) {
  if (
    !complete ||
    results.length !== 4 ||
    !["rules", "controls", "campaign", "browser"].every((id) =>
      results.some((result) => result.id === id),
    )
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

export function componentReportValid(id, report) {
  if (id === "rules")
    return (
      report?.success === true &&
      report.numTotalTests > 0 &&
      report.numFailedTests === 0 &&
      report.numPendingTests === 0
    );
  if (id === "controls")
    return (
      report?.verdict === "PASS" &&
      report?.complete === true &&
      report?.plannedCases?.length === 9
    );
  if (id === "campaign")
    return (
      report?.complete === true &&
      report?.pass === true &&
      Array.isArray(report?.results) &&
      report.results.length === 9 &&
      report.results.every((result) => result.pass === true)
    );
  if (id === "browser")
    return (
      report?.stats?.expected >= 16 &&
      report.stats.unexpected === 0 &&
      report.stats.skipped === 0
    );
  return false;
}
