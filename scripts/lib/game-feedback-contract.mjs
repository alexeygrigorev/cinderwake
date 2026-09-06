import path from "node:path";

export const GAME_FEEDBACK_COMPONENTS = Object.freeze([
  "rules",
  "controls",
  "campaign",
  "browser",
]);

export const CONTROL_CASE_IDS = Object.freeze([
  "vanguard-combat",
  "vanguard-desktop-controls",
  "vanguard-phone-controls",
  "ranger-combat",
  "ranger-desktop-controls",
  "ranger-phone-controls",
  "arcanist-combat",
  "arcanist-desktop-controls",
  "arcanist-phone-controls",
]);

export const CAMPAIGN_SEEDS = Object.freeze([
  "cinder-041",
  "ember-road",
  "last-bell",
]);

export const CAMPAIGN_CLASSES = Object.freeze([
  "vanguard",
  "ranger",
  "arcanist",
]);

export const CAMPAIGN_CASES = Object.freeze(
  CAMPAIGN_SEEDS.flatMap((seed) =>
    CAMPAIGN_CLASSES.map((classId) => Object.freeze({ seed, classId })),
  ),
);

export const BROWSER_TEST_FILES = Object.freeze([
  "tests/e2e/combat-controls.spec.ts",
  "tests/e2e/campaign.spec.ts",
  "tests/e2e/combat-readability.spec.ts",
]);

export function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function repositoryRelativePath(file, rootDir, repositoryRoot) {
  if (typeof file !== "string" || !file) return null;
  const portableFile = normalizePath(file);
  const resolved = path.isAbsolute(portableFile)
    ? path.resolve(portableFile)
    : path.resolve(rootDir ?? repositoryRoot, portableFile);
  return normalizePath(path.relative(repositoryRoot, resolved));
}

export function browserCaseIdentity({
  projectName,
  projectId,
  file,
  titlePath,
  rootDir,
  repositoryRoot = process.cwd(),
}) {
  const project = projectName ?? projectId;
  const repositoryFile = repositoryRelativePath(file, rootDir, repositoryRoot);
  const titles = Array.isArray(titlePath)
    ? titlePath.filter((title) => typeof title === "string" && title)
    : [];
  if (!project || !repositoryFile || !titles.length) return null;
  return {
    id: `${project} :: ${repositoryFile} :: ${titles.join(" > ")}`,
    project,
    file: repositoryFile,
    titlePath: titles,
  };
}

export function browserCaseKey(identity) {
  return JSON.stringify([
    identity?.project,
    normalizePath(identity?.file ?? ""),
    identity?.titlePath,
  ]);
}

export function collectBrowserCases(
  report,
  { repositoryRoot = process.cwd() } = {},
) {
  if (!report || !Array.isArray(report.suites)) return [];
  const rootDir = report.config?.rootDir ?? repositoryRoot;
  const cases = [];

  function visitSuite(suite, ancestors, inheritedFile) {
    if (!suite || typeof suite !== "object") return;
    const file = suite.file ?? inheritedFile;
    const suiteTitles = suite.file
      ? ancestors
      : typeof suite.title === "string" && suite.title
        ? [...ancestors, suite.title]
        : ancestors;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!spec || typeof spec !== "object") continue;
      const identity = browserCaseIdentity({
        projectName: spec.tests?.[0]?.projectName,
        projectId: spec.tests?.[0]?.projectId,
        file: spec.file ?? file,
        titlePath: [...suiteTitles, spec.title],
        rootDir,
        repositoryRoot,
      });
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        const testIdentity = browserCaseIdentity({
          projectName: test.projectName,
          projectId: test.projectId,
          file: spec.file ?? file,
          titlePath: [...suiteTitles, spec.title],
          rootDir,
          repositoryRoot,
        });
        if (testIdentity) {
          cases.push({
            ...testIdentity,
            spec,
            test,
          });
        }
      }
      if (!spec.tests?.length && identity) {
        cases.push({ ...identity, spec, test: null });
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : [])
      visitSuite(child, suiteTitles, file);
  }

  for (const suite of report.suites) visitSuite(suite, [], null);
  return cases;
}

function exactStrings(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const values = actual.filter((value) => typeof value === "string");
  return (
    values.length === actual.length &&
    new Set(values).size === values.length &&
    expected.every((value) => values.includes(value))
  );
}

function exactCampaignCases(actual) {
  if (!Array.isArray(actual) || actual.length !== CAMPAIGN_CASES.length)
    return false;
  const values = actual.map((result) =>
    result &&
    typeof result.seed === "string" &&
    typeof result.classId === "string"
      ? `${result.seed}\u0000${result.classId}`
      : null,
  );
  const expected = CAMPAIGN_CASES.map(
    ({ seed, classId }) => `${seed}\u0000${classId}`,
  );
  return (
    values.every((value) => value !== null) &&
    new Set(values).size === values.length &&
    expected.every((value) => values.includes(value))
  );
}

function rulesReportValid(report) {
  if (!report || report.success !== true || !Array.isArray(report.testResults))
    return false;
  if (!report.testResults.length) return false;
  const suites = report.testResults;
  const assertions = suites.flatMap((suite) =>
    Array.isArray(suite?.assertionResults) ? suite.assertionResults : [],
  );
  if (assertions.length !== report.numTotalTests || assertions.length === 0)
    return false;
  const assertionCounts = {
    passed: assertions.filter((assertion) => assertion?.status === "passed")
      .length,
    failed: assertions.filter((assertion) => assertion?.status === "failed")
      .length,
    pending: assertions.filter(
      (assertion) =>
        assertion?.status === "pending" || assertion?.status === "skipped",
    ).length,
    todo: assertions.filter((assertion) => assertion?.status === "todo").length,
  };
  const todoTests = report.numTodoTests ?? 0;
  const suiteSummary = [
    report.numTotalTestSuites,
    report.numPassedTestSuites,
    report.numFailedTestSuites,
    report.numPendingTestSuites,
  ];
  if (
    !suiteSummary.every(Number.isSafeInteger) ||
    !Number.isSafeInteger(report.numTotalTests) ||
    !Number.isSafeInteger(report.numPassedTests) ||
    !Number.isSafeInteger(report.numFailedTests) ||
    !Number.isSafeInteger(report.numPendingTests) ||
    !Number.isSafeInteger(todoTests)
  )
    return false;
  return (
    suites.every(
      (suite) =>
        suite?.status === "passed" &&
        Array.isArray(suite?.assertionResults) &&
        suite.assertionResults.length > 0,
    ) &&
    assertions.every((assertion) => assertion?.status === "passed") &&
    report.numTotalTestSuites > 0 &&
    report.numPassedTestSuites +
      report.numFailedTestSuites +
      report.numPendingTestSuites ===
      report.numTotalTestSuites &&
    report.numFailedTestSuites === 0 &&
    report.numPendingTestSuites === 0 &&
    report.numPassedTests === assertionCounts.passed &&
    report.numFailedTests === assertionCounts.failed &&
    report.numPendingTests === assertionCounts.pending &&
    todoTests === assertionCounts.todo &&
    report.numPassedTests === report.numTotalTests &&
    report.numFailedTests === 0 &&
    report.numPendingTests === 0 &&
    todoTests === 0
  );
}

function controlsReportValid(report) {
  if (
    !report ||
    report.verdict !== "PASS" ||
    report.complete !== true ||
    !Array.isArray(report.failures) ||
    report.failures.length !== 0 ||
    !exactStrings(report.plannedCases, CONTROL_CASE_IDS) ||
    !Array.isArray(report.cases) ||
    !exactStrings(
      report.cases.map((entry) => entry?.id),
      CONTROL_CASE_IDS,
    )
  )
    return false;
  return report.cases.every(
    (entry) =>
      entry &&
      (!Object.hasOwn(entry, "complete") || entry.complete === true) &&
      Array.isArray(entry.checks) &&
      entry.checks.length > 0 &&
      entry.checks.every((check) => check?.pass === true),
  );
}

function campaignReportValid(report) {
  if (
    !report ||
    report.complete !== true ||
    report.pass !== true ||
    report.runtimeError != null ||
    !exactCampaignCases(report.results)
  )
    return false;
  return report.results.every(
    (result) =>
      result.pass === true &&
      result.phase === "won" &&
      result.replayMatched === true &&
      result.snapshotMatched === true &&
      result.saveResumeMatched === true &&
      Array.isArray(result.validationErrors) &&
      result.validationErrors.length === 0,
  );
}

function browserReportValid(
  report,
  expectedCases,
  repositoryRoot = process.cwd(),
) {
  if (!report || !Array.isArray(expectedCases) || !expectedCases.length)
    return false;
  if (!Array.isArray(report.errors) || report.errors.length !== 0) return false;
  const actualCases = collectBrowserCases(report, { repositoryRoot });
  const expectedKeys = expectedCases.map(browserCaseKey);
  const actualKeys = actualCases.map(browserCaseKey);
  if (
    actualKeys.length !== expectedKeys.length ||
    new Set(actualKeys).size !== actualKeys.length ||
    new Set(expectedKeys).size !== expectedKeys.length ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  )
    return false;
  const stats = report.stats;
  if (
    !stats ||
    !Number.isSafeInteger(stats.expected) ||
    !Number.isSafeInteger(stats.skipped) ||
    !Number.isSafeInteger(stats.unexpected) ||
    !Number.isSafeInteger(stats.flaky) ||
    stats.expected !== actualCases.length ||
    stats.skipped !== 0 ||
    stats.unexpected !== 0 ||
    stats.flaky !== 0
  )
    return false;
  return actualCases.every(
    ({ spec, test }) =>
      spec?.ok === true &&
      test?.status === "expected" &&
      test.expectedStatus === "passed" &&
      Array.isArray(test.results) &&
      test.results.length > 0 &&
      test.results.every(
        (result) =>
          result.status === "passed" &&
          (!Array.isArray(result.errors) || result.errors.length === 0),
      ),
  );
}

export function componentReportValid(id, report, context = {}) {
  if (id === "rules") return rulesReportValid(report);
  if (id === "controls") return controlsReportValid(report);
  if (id === "campaign") return campaignReportValid(report);
  if (id === "browser")
    return browserReportValid(
      report,
      context.expectedBrowserCases,
      context.repositoryRoot,
    );
  return false;
}
