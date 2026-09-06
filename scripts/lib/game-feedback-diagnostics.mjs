import fs from "node:fs";
import path from "node:path";
import {
  CAMPAIGN_CASES,
  CONTROL_CASE_IDS,
  browserCaseKey,
  collectBrowserCases,
} from "./game-feedback-contract.mjs";

export const DIAGNOSTIC_CATEGORIES = Object.freeze([
  "behavior",
  "evidence",
  "runtime",
  "transport",
  "unknown",
]);

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function safeValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function displayValue(value) {
  const normalized = safeValue(value);
  if (typeof normalized === "string") return normalized;
  try {
    return JSON.stringify(normalized);
  } catch {
    return String(normalized);
  }
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function mapValue(source, key) {
  if (source instanceof Map) return source.get(key);
  return source?.[key];
}

function safeRelativeEvidence(outputDirectory, candidate) {
  if (typeof candidate !== "string" || !candidate) return null;
  const normalizedCandidate = normalizePath(candidate);
  const resolved = path.resolve(outputDirectory, normalizedCandidate);
  const relative = normalizePath(path.relative(outputDirectory, resolved));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  )
    return null;
  return relative;
}

function evidencePaths(outputDirectory, candidates, pending = []) {
  const pendingSet = new Set(pending.map(normalizePath));
  const paths = [];
  for (const candidate of candidates) {
    const relative = safeRelativeEvidence(outputDirectory, candidate);
    if (!relative || paths.includes(relative)) continue;
    if (
      fs.existsSync(path.resolve(outputDirectory, relative)) ||
      pendingSet.has(relative)
    )
      paths.push(relative);
  }
  return paths;
}

function issue({
  component,
  caseId = null,
  category,
  code,
  expected = null,
  actual = null,
  evidence = [],
  reproduceCommand = null,
  outputDirectory,
  pendingEvidence = [],
}) {
  return {
    component: component ?? null,
    caseId: caseId ?? null,
    category: DIAGNOSTIC_CATEGORIES.includes(category) ? category : "unknown",
    code: code ?? "unknown",
    expected: safeValue(expected),
    actual: safeValue(actual),
    evidencePaths: evidencePaths(outputDirectory, evidence, pendingEvidence),
    reproduceCommand:
      typeof reproduceCommand === "string" && reproduceCommand
        ? reproduceCommand
        : null,
  };
}

function componentCommand(entry) {
  if (!entry?.command || !Array.isArray(entry.args)) return null;
  return [entry.command, ...entry.args].map(shellQuote).join(" ");
}

function commandFor(entry, outputDirectory, caseId = null, extra = {}) {
  if (!entry) return null;
  if (entry.id === "controls" && caseId) {
    const plan = path.join(outputDirectory, "controls", "replay-plan.json");
    if (fs.existsSync(plan))
      return [
        process.execPath,
        "scripts/feedback.mjs",
        "--plan",
        plan,
        "--only",
        caseId,
      ]
        .map(shellQuote)
        .join(" ");
  }
  if (entry.id === "campaign" && extra.tape) {
    const tape = path.join(outputDirectory, "campaign", extra.tape);
    if (fs.existsSync(tape))
      return [
        process.execPath,
        "scripts/test-campaign-journey.mjs",
        "--replay",
        tape,
      ]
        .map(shellQuote)
        .join(" ");
  }
  return componentCommand(entry);
}

function componentEvidence(entry, extra = []) {
  return [
    entry?.json,
    entry?.evidence,
    `${entry?.id ?? "component"}.log`,
    ...extra,
  ].filter(Boolean);
}

function controlEvidence(entry, result, check) {
  const caseId = result?.id;
  const checkEvidence = check?.evidence;
  const casePath =
    caseId && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(caseId) && checkEvidence
      ? path.join("controls", caseId, checkEvidence)
      : null;
  return componentEvidence(entry, [casePath]);
}

function campaignEvidence(entry, result) {
  const artifactNames = [
    result?.finalState,
    result?.tape,
    result?.checkpoints,
  ].filter((value) => typeof value === "string" && !value.includes(".."));
  return componentEvidence(
    entry,
    artifactNames.map((name) => path.join("campaign", name)),
  );
}

function firstRulesIssue(report, entry, outputDirectory) {
  if (!report || typeof report !== "object") return null;
  const suite = Array.isArray(report.testResults)
    ? report.testResults.find(
        (candidate) =>
          candidate?.status !== "passed" ||
          candidate?.assertionResults?.some(
            (assertion) => assertion?.status !== "passed",
          ),
      )
    : null;
  const assertion = suite?.assertionResults?.find(
    (candidate) => candidate?.status !== "passed",
  );
  if (assertion || suite) {
    const caseId =
      assertion?.fullName ?? assertion?.title ?? suite?.name ?? "rules";
    return issue({
      component: "rules",
      caseId,
      category: "behavior",
      code: "rules-assertion-failed",
      expected: "all discovered assertions pass",
      actual: assertion
        ? {
            status: assertion.status ?? null,
            failureMessages: assertion.failureMessages ?? [],
          }
        : { status: suite.status ?? null },
      evidence: componentEvidence(entry),
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  return null;
}

function firstControlsIssue(report, entry, outputDirectory) {
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const ids = cases.map((candidate) => candidate?.id).filter(Boolean);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) {
    return issue({
      component: "controls",
      caseId: duplicate,
      category: "evidence",
      code: "control-case-duplicate",
      expected: "each declared control case appears exactly once",
      actual: ids,
      evidence: componentEvidence(entry),
      reproduceCommand: commandFor(entry, outputDirectory, duplicate),
      outputDirectory,
    });
  }
  const missing = CONTROL_CASE_IDS.find((id) => !ids.includes(id));
  if (missing) {
    return issue({
      component: "controls",
      caseId: missing,
      category: "evidence",
      code: "control-case-missing",
      expected: "declared control case is present",
      actual: null,
      evidence: componentEvidence(entry),
      reproduceCommand: commandFor(entry, outputDirectory, missing),
      outputDirectory,
    });
  }
  const failedCase = cases.find((candidate) =>
    candidate?.checks?.some((check) => check?.pass !== true),
  );
  const failedCheck = failedCase?.checks?.find((check) => check?.pass !== true);
  if (failedCase && failedCheck) {
    return issue({
      component: "controls",
      caseId: `${failedCase.id}/${failedCheck.id ?? "check"}`,
      category: "behavior",
      code: "control-check-failed",
      expected: {
        op: failedCheck.op ?? null,
        value: failedCheck.value ?? failedCheck.expected ?? null,
      },
      actual: failedCheck.actual ?? null,
      evidence: controlEvidence(entry, failedCase, failedCheck),
      reproduceCommand: commandFor(entry, outputDirectory, failedCase.id),
      outputDirectory,
    });
  }
  if (report?.complete !== true) {
    return issue({
      component: "controls",
      caseId: null,
      category: "evidence",
      code: "control-run-incomplete",
      expected: "complete=true",
      actual: report?.complete ?? null,
      evidence: componentEvidence(entry),
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  if (Array.isArray(report?.failures) && report.failures.length) {
    return issue({
      component: "controls",
      caseId: null,
      category: "behavior",
      code: "control-failure-recorded",
      expected: [],
      actual: report.failures,
      evidence: componentEvidence(entry),
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  return null;
}

function campaignPair(result) {
  return result &&
    typeof result.seed === "string" &&
    typeof result.classId === "string"
    ? `${result.seed}\u0000${result.classId}`
    : null;
}

function firstCampaignIssue(report, entry, outputDirectory) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const actualPairs = new Set(results.map(campaignPair).filter(Boolean));
  const missing = CAMPAIGN_CASES.find(
    ({ seed, classId }) => !actualPairs.has(`${seed}\u0000${classId}`),
  );
  if (missing) {
    const caseId = `${missing.seed}/${missing.classId}`;
    return issue({
      component: "campaign",
      caseId,
      category: "evidence",
      code: "campaign-case-missing",
      expected: missing,
      actual: null,
      evidence: componentEvidence(entry),
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  const failed = results.find(
    (result) => result?.pass !== true || result?.phase !== "won",
  );
  if (failed) {
    return issue({
      component: "campaign",
      caseId: `${failed.seed ?? "unknown"}/${failed.classId ?? "unknown"}`,
      category: "behavior",
      code: "campaign-not-won",
      expected: { phase: "won", pass: true },
      actual: {
        phase: failed.phase ?? null,
        pass: failed.pass ?? null,
        blocker: failed.blocker ?? null,
        diagnostic: failed.diagnostic ?? null,
      },
      evidence: campaignEvidence(entry, failed),
      reproduceCommand: commandFor(entry, outputDirectory, null, {
        tape: failed.tape,
      }),
      outputDirectory,
    });
  }
  const proof = results.find((result) =>
    ["replayMatched", "snapshotMatched", "saveResumeMatched"].some(
      (field) => result?.[field] !== true,
    ),
  );
  if (proof) {
    const field = [
      "replayMatched",
      "snapshotMatched",
      "saveResumeMatched",
    ].find((candidate) => proof[candidate] !== true);
    return issue({
      component: "campaign",
      caseId: `${proof.seed ?? "unknown"}/${proof.classId ?? "unknown"}`,
      category: "evidence",
      code: `campaign-${field}-failed`,
      expected: true,
      actual: proof[field] ?? null,
      evidence: campaignEvidence(entry, proof),
      reproduceCommand: commandFor(entry, outputDirectory, null, {
        tape: proof.tape,
      }),
      outputDirectory,
    });
  }
  const invalid = results.find(
    (result) =>
      !Array.isArray(result?.validationErrors) ||
      result.validationErrors.length > 0,
  );
  if (invalid) {
    return issue({
      component: "campaign",
      caseId: `${invalid.seed ?? "unknown"}/${invalid.classId ?? "unknown"}`,
      category: "evidence",
      code: "campaign-validation-error",
      expected: [],
      actual: invalid.validationErrors ?? null,
      evidence: campaignEvidence(entry, invalid),
      reproduceCommand: commandFor(entry, outputDirectory, null, {
        tape: invalid.tape,
      }),
      outputDirectory,
    });
  }
  return null;
}

function firstBrowserIssue(
  report,
  entry,
  outputDirectory,
  expectedCases,
  component = "browser",
) {
  const manifest =
    entry?.browserManifest ??
    (component === "browser" ? "browser-list.json" : `${component}-list.json`);
  const log = `${component}.log`;
  if (Array.isArray(report?.errors) && report.errors.length) {
    return issue({
      component,
      category: "runtime",
      code: "browser-top-level-error",
      expected: [],
      actual: report.errors,
      evidence: [entry?.json, entry?.evidence, manifest, log],
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  const actualCases = collectBrowserCases(report);
  const expected = Array.isArray(expectedCases) ? expectedCases : [];
  const actualKeys = new Set(actualCases.map(browserCaseKey));
  const expectedKeys = new Set(expected.map(browserCaseKey));
  const missing = expected.find(
    (candidate) => !actualKeys.has(browserCaseKey(candidate)),
  );
  if (missing) {
    return issue({
      component,
      caseId: missing.id ?? null,
      category: "evidence",
      code: "browser-case-missing",
      expected: missing,
      actual: null,
      evidence: [entry?.json, entry?.evidence, manifest, log],
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  const extra = actualCases.find(
    (candidate) => !expectedKeys.has(browserCaseKey(candidate)),
  );
  if (extra) {
    return issue({
      component,
      caseId: extra.id,
      category: "evidence",
      code: "browser-case-unexpected",
      expected: expected.map((candidate) => candidate.id),
      actual: extra,
      evidence: [entry?.json, entry?.evidence, log],
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  const failed = actualCases.find(
    ({ test }) =>
      test?.status !== "expected" ||
      test.expectedStatus !== "passed" ||
      !Array.isArray(test.results) ||
      !test.results.length ||
      test.results.some((result) => result?.status !== "passed"),
  );
  if (failed) {
    return issue({
      component,
      caseId: failed.id,
      category: "evidence",
      code: "browser-case-not-passing",
      expected: { status: "expected", result: "passed" },
      actual: {
        status: failed.test?.status ?? null,
        expectedStatus: failed.test?.expectedStatus ?? null,
        results: failed.test?.results ?? null,
      },
      evidence: [entry?.json, entry?.evidence, log],
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  if (
    report?.stats &&
    (report.stats.skipped !== 0 ||
      report.stats.unexpected !== 0 ||
      report.stats.flaky !== 0 ||
      report.stats.expected !== actualCases.length)
  ) {
    return issue({
      component,
      category: "evidence",
      code: "browser-summary-mismatch",
      expected: {
        expected: actualCases.length,
        skipped: 0,
        unexpected: 0,
        flaky: 0,
      },
      actual: report.stats,
      evidence: [entry?.json, entry?.evidence, manifest, log],
      reproduceCommand: componentCommand(entry),
      outputDirectory,
    });
  }
  return null;
}

function reportIssue(component, report, entry, outputDirectory, context) {
  if (component === "rules")
    return firstRulesIssue(report, entry, outputDirectory);
  if (component === "controls")
    return firstControlsIssue(report, entry, outputDirectory);
  if (component === "campaign")
    return firstCampaignIssue(report, entry, outputDirectory);
  if (component === "browser" || component === "campaign-browser")
    return firstBrowserIssue(
      report,
      entry,
      outputDirectory,
      context.expectedBrowserCases,
      component,
    );
  return null;
}

function processIssue(result, entry, outputDirectory) {
  const timeout = /exceeded (?:five-minute|\d+ ms) limit/.test(
    String(result?.error ?? ""),
  );
  const category = timeout
    ? "unknown"
    : result?.exitCode === null
      ? "runtime"
      : "runtime";
  const code = timeout
    ? "component-timeout"
    : result?.error?.startsWith("Stopped by")
      ? "component-interrupted"
      : "component-process-failed";
  return issue({
    component: entry?.id ?? result?.id,
    category,
    code,
    expected: "component exits with code 0 before the declared limit",
    actual: {
      exitCode: result?.exitCode ?? null,
      error: result?.error ?? null,
    },
    evidence: [entry?.json, entry?.evidence, `${entry?.id ?? result?.id}.log`],
    reproduceCommand: componentCommand(entry),
    outputDirectory,
  });
}

export function buildIssues({
  results = [],
  complete = false,
  sourceStable = true,
  componentDefinitions = [],
  reports = new Map(),
  reportErrors = new Map(),
  outputDirectory = process.cwd(),
  expectedBrowserCases = [],
} = {}) {
  const issues = [];
  if (!sourceStable) {
    issues.push(
      issue({
        component: "aggregate",
        caseId: "source",
        category: "evidence",
        code: "source-changed",
        expected: "source fingerprint remains stable for the entire run",
        actual: false,
        evidence: ["feedback.json"],
        reproduceCommand: null,
        outputDirectory,
        pendingEvidence: ["feedback.json"],
      }),
    );
  }
  for (const entry of componentDefinitions) {
    const result = results.find((candidate) => candidate?.id === entry.id);
    if (!result) {
      if (!complete) {
        issues.push(
          issue({
            component: entry.id,
            category: "evidence",
            code: "component-not-run",
            expected: "component produces a retained report",
            actual: null,
            evidence: [entry.json, entry.evidence, `${entry.id}.log`],
            reproduceCommand: componentCommand(entry),
            outputDirectory,
          }),
        );
      }
      continue;
    }
    const parseError = mapValue(reportErrors, entry.id);
    if (parseError) {
      const missing = parseError.kind === "missing";
      const code = missing
        ? "report-missing"
        : parseError.kind === "malformed"
          ? "report-malformed"
          : "report-unreadable";
      issues.push(
        issue({
          component: entry.id,
          category: "evidence",
          code,
          expected: "a readable JSON component report",
          actual: parseError.message ?? null,
          evidence: [entry.json, entry.evidence, `${entry.id}.log`],
          reproduceCommand: componentCommand(entry),
          outputDirectory,
        }),
      );
      continue;
    }
    if (result.exitCode !== 0 || result.error) {
      issues.push(processIssue(result, entry, outputDirectory));
      continue;
    }
    if (result.reportValid !== true) {
      const diagnosed = reportIssue(
        entry.id,
        mapValue(reports, entry.id),
        entry,
        outputDirectory,
        {
          expectedBrowserCases:
            entry.expectedBrowserCases ?? expectedBrowserCases,
        },
      );
      issues.push(
        diagnosed ??
          issue({
            component: entry.id,
            category: "evidence",
            code: "component-report-invalid",
            expected:
              "nested component evidence satisfies its declared contract",
            actual: { reportValid: false },
            evidence: [entry.json, entry.evidence, `${entry.id}.log`],
            reproduceCommand: componentCommand(entry),
            outputDirectory,
          }),
      );
    }
  }
  return issues;
}

function markdownText(value) {
  return displayValue(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("\r", "")
    .replaceAll("\n", " ");
}

function markdownLink(relativePath, outputDirectory) {
  const safe = safeRelativeEvidence(outputDirectory, relativePath);
  if (!safe || !fs.existsSync(path.resolve(outputDirectory, safe))) return null;
  return `[${markdownText(safe)}](<${safe}>)`;
}

export function renderNextAction({
  verdict = "INCOMPLETE",
  complete = false,
  sourceStable = true,
  issues = [],
  outputDirectory = process.cwd(),
} = {}) {
  const lines = [
    "# Next action",
    "",
    `- Verdict: ${markdownText(verdict)}`,
    `- Completion: ${complete ? "complete" : "incomplete"}`,
    `- Source: ${sourceStable ? "stable" : "changed during the run"}`,
  ];
  const first = issues[0];
  if (!first) {
    lines.push(
      "- First failing case: none recorded.",
      "- Missing evidence: no diagnostic issue was recorded in the retained run.",
    );
  } else {
    const caseLabel = first.caseId
      ? `${first.component}/${first.caseId}`
      : first.component;
    lines.push(
      `- First failing case: ${markdownText(caseLabel)}`,
      `- Category/code: ${markdownText(`${first.category}/${first.code}`)}`,
      `- Expected: \`${markdownText(first.expected)}\``,
      `- Actual: \`${markdownText(first.actual)}\``,
    );
    const links = first.evidencePaths
      .slice(0, 5)
      .map((relativePath) => markdownLink(relativePath, outputDirectory))
      .filter(Boolean);
    lines.push(
      links.length
        ? `- Evidence: ${links.join(", ")}`
        : "- Evidence: none of the expected local evidence paths is available.",
    );
    lines.push(
      first.reproduceCommand
        ? `- Reproduce: \`${markdownText(first.reproduceCommand)}\``
        : "- Reproduce: unavailable; no exact command was retained.",
    );
    if (!links.length)
      lines.push(
        "- Missing evidence: the failing component did not retain a usable local artifact.",
      );
  }
  lines.push(
    "",
    "This file is an evidence handoff. It does not recommend a patch or turn an unknown cause into a transport diagnosis.",
  );
  return `${lines.slice(0, 120).join("\n")}\n`;
}
