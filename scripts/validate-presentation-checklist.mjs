import fs from "node:fs/promises";
import path from "node:path";

const EXPECTED_IDS = [
  "PRES-LIVE-001",
  "PRES-INPUT-002",
  "PRES-MOVE-003",
  "PRES-SPRITE-004",
  "PRES-MOTION-005",
  "PRES-CRISP-006",
  "PRES-ASPECT-007",
  "PRES-COLLIDE-008",
  "PRES-SPRITE-009",
  "PRES-MOBILE-010",
  "PRES-BLANK-011",
  "PRES-LEAK-012",
  "PRES-ANCHOR-013",
  "PRES-DUP-014",
  "PRES-FACING-015",
  "PRES-CAMERA-016",
  "PRES-ZOOM-017",
  "PRES-TILE-018",
  "PRES-DEPTH-019",
  "PRES-PROP-020",
  "PRES-STYLE-021",
  "PRES-DENSITY-022",
  "PRES-PROPORTION-023",
  "PRES-FLICKER-024",
  "PRES-CROSSDEVICE-025",
  "PRES-REVIEW-026",
];

const PRIORITIES = new Set(["P0", "P1", "P2"]);
const COVERAGE = new Set(["automatic", "partial", "missing"]);
const RESULTS = new Set(["UNRUN", "PASS", "FAIL", "NEEDS_VISUAL_REVIEW"]);
const CONTROL_STATUSES = new Set(["UNRUN", "DETECTED", "NOT_DETECTED"]);
const REVIEW_VERDICTS = new Set(["NOT_RUN", "ACCEPT", "REJECT", "UNCERTAIN"]);
const SHA256 = /^[a-f0-9]{64}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameOrderedValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function addIssue(issues, code, location, message) {
  issues.push({ code, location, message });
}

function validRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value)
  ) {
    return false;
  }
  return value
    .split(/[\\/]/)
    .every((part) => part !== "" && part !== "." && part !== "..");
}

function validateArtifactList(artifacts, location, issues) {
  if (!Array.isArray(artifacts)) {
    addIssue(
      issues,
      "artifact-list-invalid",
      location,
      "Artifacts must be an array.",
    );
    return [];
  }
  artifacts.forEach((artifact, index) => {
    const artifactLocation = `${location}[${index}]`;
    if (!isObject(artifact)) {
      addIssue(
        issues,
        "artifact-invalid",
        artifactLocation,
        "Artifact must be an object.",
      );
      return;
    }
    if (!validRelativePath(artifact.path)) {
      addIssue(
        issues,
        "artifact-path-invalid",
        `${artifactLocation}.path`,
        "Claimed artifacts require a non-empty repository-relative path without traversal.",
      );
    }
    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) {
      addIssue(
        issues,
        "artifact-hash-invalid",
        `${artifactLocation}.sha256`,
        "Claimed artifacts require a lowercase 64-hex SHA-256.",
      );
    }
  });
  return artifacts;
}

function validateContract(contract) {
  const issues = [];
  if (!isObject(contract) || contract.schemaVersion !== 1) {
    addIssue(
      issues,
      "contract-schema-invalid",
      "contract",
      "Expected schemaVersion 1.",
    );
    return { issues, checks: [] };
  }
  if (contract.kind !== "PresentationChecklistContractV1") {
    addIssue(
      issues,
      "contract-kind-invalid",
      "contract.kind",
      "Unexpected contract kind.",
    );
  }
  if (contract.adapterContract !== "PresentationAdapterV1") {
    addIssue(
      issues,
      "adapter-contract-invalid",
      "contract.adapterContract",
      "Expected PresentationAdapterV1.",
    );
  }
  if (
    !Array.isArray(contract.artifactRequirements) ||
    contract.artifactRequirements.length === 0
  ) {
    addIssue(
      issues,
      "artifact-requirements-invalid",
      "contract.artifactRequirements",
      "Shared artifact requirements must be a non-empty array.",
    );
  }
  const checks = Array.isArray(contract.checks) ? contract.checks : [];
  const ids = checks.map((check) => check?.id);
  if (!sameOrderedValues(ids, EXPECTED_IDS)) {
    addIssue(
      issues,
      "check-ids-not-canonical",
      "contract.checks",
      "The 26 PRES IDs must be complete, unique, and in published execution order.",
    );
  }
  checks.forEach((check, index) => {
    const location = `contract.checks[${index}]`;
    if (!isObject(check)) {
      addIssue(issues, "check-invalid", location, "Check must be an object.");
      return;
    }
    if (!PRIORITIES.has(check.priority))
      addIssue(
        issues,
        "priority-invalid",
        `${location}.priority`,
        "Priority must be P0, P1, or P2.",
      );
    if (!COVERAGE.has(check.coverage))
      addIssue(
        issues,
        "coverage-invalid",
        `${location}.coverage`,
        "Coverage must be automatic, partial, or missing.",
      );
    if (typeof check.mandatoryReview !== "boolean")
      addIssue(
        issues,
        "mandatory-review-invalid",
        `${location}.mandatoryReview`,
        "mandatoryReview must be boolean.",
      );
    for (const property of ["evidenceRequirements", "negativeControlIds"]) {
      if (
        !Array.isArray(check[property]) ||
        check[property].length === 0 ||
        check[property].some(
          (value) => typeof value !== "string" || value.length === 0,
        )
      ) {
        addIssue(
          issues,
          `${property}-invalid`,
          `${location}.${property}`,
          `${property} must be a non-empty list of IDs.`,
        );
      }
    }
    if (
      Array.isArray(check.negativeControlIds) &&
      new Set(check.negativeControlIds).size !== check.negativeControlIds.length
    ) {
      addIssue(
        issues,
        "negative-controls-duplicated",
        `${location}.negativeControlIds`,
        "Negative control IDs must be unique per check.",
      );
    }
  });
  return { issues, checks };
}

function validateReview(review, contractCheck, location, result, issues) {
  if (!isObject(review)) {
    addIssue(
      issues,
      "review-invalid",
      location,
      "visualReview must be an object.",
    );
    return;
  }
  if (review.mandatory !== contractCheck.mandatoryReview) {
    addIssue(
      issues,
      "review-mandatory-mismatch",
      `${location}.mandatory`,
      "Run review requirement must match its contract.",
    );
  }
  if (!REVIEW_VERDICTS.has(review.verdict)) {
    addIssue(
      issues,
      "review-verdict-invalid",
      `${location}.verdict`,
      "Review verdict is invalid.",
    );
  }
  const hashes = review.reviewedArtifactHashes;
  if (
    !Array.isArray(hashes) ||
    hashes.some((hash) => typeof hash !== "string" || !SHA256.test(hash))
  ) {
    addIssue(
      issues,
      "review-hashes-invalid",
      `${location}.reviewedArtifactHashes`,
      "Review artifact hashes must be lowercase SHA-256 values.",
    );
  }
  if (
    result === "PASS" &&
    contractCheck.mandatoryReview &&
    (review.verdict !== "ACCEPT" || hashes.length === 0)
  ) {
    addIssue(
      issues,
      "mandatory-review-incomplete",
      location,
      "A PASS needs mandatory review ACCEPT and at least one hash-bound artifact.",
    );
  }
}

function validateRun(contract, run) {
  const issues = [];
  const blockers = [];
  if (
    !isObject(run) ||
    run.schemaVersion !== 1 ||
    run.kind !== "PresentationRunV1"
  ) {
    addIssue(
      issues,
      "run-schema-invalid",
      "run",
      "Expected PresentationRunV1 schemaVersion 1.",
    );
    return { issues, blockers };
  }
  if (run.adapterContract !== contract.adapterContract)
    addIssue(
      issues,
      "run-adapter-mismatch",
      "run.adapterContract",
      "Run must name the contract adapter.",
    );
  if (typeof run.runId !== "string" || run.runId.length === 0)
    addIssue(issues, "run-id-invalid", "run.runId", "runId must be non-empty.");
  if (
    !isObject(run.environment) ||
    typeof run.environment.commit !== "string" ||
    typeof run.environment.reproduce !== "string"
  )
    addIssue(
      issues,
      "environment-invalid",
      "run.environment",
      "Run must preserve commit and exact reproduction command fields.",
    );
  const entries = Array.isArray(run.checks) ? run.checks : [];
  const ids = entries.map((entry) => entry?.checkId);
  const contractIds = contract.checks.map((check) => check.id);
  if (!sameOrderedValues(ids, contractIds))
    addIssue(
      issues,
      "run-checks-not-canonical",
      "run.checks",
      "Run must contain every contract ID exactly once and in fixed order.",
    );

  entries.forEach((entry, index) => {
    const contractCheck = contract.checks[index];
    const location = `run.checks[${index}]`;
    if (!isObject(entry) || !contractCheck) return;
    if (!RESULTS.has(entry.result))
      addIssue(
        issues,
        "result-invalid",
        `${location}.result`,
        "Result must be UNRUN, PASS, FAIL, or NEEDS_VISUAL_REVIEW.",
      );
    if (entry.coverageAtRun !== contractCheck.coverage)
      addIssue(
        issues,
        "coverage-at-run-mismatch",
        `${location}.coverageAtRun`,
        "coverageAtRun must equal the versioned contract coverage label.",
      );
    const artifacts = validateArtifactList(
      entry.artifacts,
      `${location}.artifacts`,
      issues,
    );
    const requirementNames = new Set(
      artifacts.filter(isObject).map((artifact) => artifact.requirement),
    );
    if (entry.result === "PASS") {
      for (const requirement of [
        ...contract.artifactRequirements,
        ...contractCheck.evidenceRequirements,
      ]) {
        if (!requirementNames.has(requirement))
          addIssue(
            issues,
            "required-artifact-missing",
            `${location}.artifacts`,
            `PASS lacks the required ${requirement} artifact.`,
          );
      }
    }
    if (!Array.isArray(entry.negativeControls)) {
      addIssue(
        issues,
        "negative-controls-invalid",
        `${location}.negativeControls`,
        "negativeControls must be an array.",
      );
    } else {
      const controlIds = entry.negativeControls.map((control) => control?.id);
      if (!sameOrderedValues(controlIds, contractCheck.negativeControlIds))
        addIssue(
          issues,
          "negative-controls-not-canonical",
          `${location}.negativeControls`,
          "Negative controls must match the contract exactly and in order.",
        );
      entry.negativeControls.forEach((control, controlIndex) => {
        const controlLocation = `${location}.negativeControls[${controlIndex}]`;
        if (!isObject(control))
          return addIssue(
            issues,
            "negative-control-invalid",
            controlLocation,
            "Negative control must be an object.",
          );
        if (!CONTROL_STATUSES.has(control.status))
          addIssue(
            issues,
            "negative-control-status-invalid",
            `${controlLocation}.status`,
            "Control status must be UNRUN, DETECTED, or NOT_DETECTED.",
          );
        const controlArtifacts = validateArtifactList(
          control.artifacts,
          `${controlLocation}.artifacts`,
          issues,
        );
        if (
          control.status === "DETECTED" &&
          (controlArtifacts.length === 0 ||
            typeof control.signal !== "string" ||
            control.signal.length === 0)
        )
          addIssue(
            issues,
            "detected-control-evidence-incomplete",
            controlLocation,
            "A detected control needs a named signal and hash-bound evidence.",
          );
        if (entry.result === "PASS" && control.status !== "DETECTED")
          addIssue(
            issues,
            "required-control-not-detected",
            controlLocation,
            "PASS requires every named negative control to be detected.",
          );
      });
    }
    validateReview(
      entry.visualReview,
      contractCheck,
      `${location}.visualReview`,
      entry.result,
      issues,
    );
    if (entry.result !== "PASS")
      blockers.push({
        checkId: contractCheck.id,
        reason: entry.result === "UNRUN" ? "unrun" : "not-pass",
      });
    if (contractCheck.priority === "P0" && entry.result !== "PASS")
      blockers.push({ checkId: contractCheck.id, reason: "p0-incomplete" });
  });
  return { issues, blockers };
}

export function validatePresentationChecklist(contract, run) {
  const contractResult = validateContract(contract);
  const runResult =
    contractResult.issues.length === 0
      ? validateRun(contract, run)
      : {
          issues: [],
          blockers: [{ checkId: "contract", reason: "invalid-contract" }],
        };
  return {
    schemaVersion: 1,
    valid: contractResult.issues.length === 0 && runResult.issues.length === 0,
    issues: [...contractResult.issues, ...runResult.issues],
    acceptanceBlockers: runResult.blockers,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
  };
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex === -1 ? "lint" : args[modeIndex + 1];
  const contractPath = option(
    "--contract",
    "quality/presentation-checklist.v1.json",
  );
  const runPath = option("--run", "quality/presentation-run.v1.template.json");
  if (!new Set(["lint", "accept"]).has(mode))
    throw new Error("Use --mode lint or --mode accept.");
  const [contract, run] = await Promise.all(
    [contractPath, runPath].map(async (file) =>
      JSON.parse(await fs.readFile(file, "utf8")),
    ),
  );
  const report = validatePresentationChecklist(contract, run);
  console.log(
    JSON.stringify(
      {
        ...report,
        mode,
        accepted:
          mode === "accept" &&
          report.valid &&
          report.acceptanceBlockers.length === 0,
      },
      null,
      2,
    ),
  );
  if (
    !report.valid ||
    (mode === "accept" && report.acceptanceBlockers.length > 0)
  )
    process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
