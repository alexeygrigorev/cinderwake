export function gameFeedbackVerdict(results, complete, sourceStable) {
  if (!complete || results.length !== 3) return "INCOMPLETE";
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
      report?.stats?.expected >= 13 &&
      report.stats.unexpected === 0 &&
      report.stats.skipped === 0
    );
  return false;
}
