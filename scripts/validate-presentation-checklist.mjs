import crypto from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const CONTRACT_PATH = "quality/presentation-checklist.v1.json";
const RECIPES_PATH = "quality/presentation-recipes.v1.json";
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
  "PRES-CITY-027",
  "PRES-STATE-028",
];

const PRIORITIES = new Set(["P0", "P1", "P2"]);
const COVERAGE = new Set(["automatic", "partial", "missing"]);
const RECIPE_COVERAGE = new Set([
  "implemented",
  "partial",
  "missing",
  "calibration-required",
]);
const RESULTS = new Set(["UNRUN", "PASS", "FAIL", "NEEDS_VISUAL_REVIEW"]);
const CONTROL_STATUSES = new Set(["UNRUN", "DETECTED", "NOT_DETECTED"]);
const REVIEW_VERDICTS = new Set(["NOT_RUN", "ACCEPT", "REJECT", "UNCERTAIN"]);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyObject(value) {
  return isObject(value) && Object.keys(value).length > 0;
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
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value))
    return false;
  return value
    .split(/[\\/]/)
    .every((part) => part !== "" && part !== "." && part !== "..");
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateIdList(value, location, issues, code = "id-list-invalid") {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(value).size !== value.length
  ) {
    addIssue(
      issues,
      code,
      location,
      "Expected a non-empty ordered list of unique IDs.",
    );
    return [];
  }
  return value;
}

function verifyArtifactBytes(artifact, location, issues, repoRoot) {
  const candidate = path.resolve(repoRoot, artifact.path);
  if (!insideRoot(repoRoot, candidate)) {
    addIssue(
      issues,
      "artifact-path-outside-repo",
      `${location}.path`,
      "Artifact path resolves outside the repository.",
    );
    return;
  }
  if (!existsSync(candidate)) {
    addIssue(
      issues,
      "artifact-file-missing",
      `${location}.path`,
      "Claimed artifact does not exist.",
    );
    return;
  }
  const realCandidate = realpathSync(candidate);
  if (!insideRoot(repoRoot, realCandidate)) {
    addIssue(
      issues,
      "artifact-path-outside-repo",
      `${location}.path`,
      "Artifact symlink resolves outside the repository.",
    );
    return;
  }
  if (!statSync(realCandidate).isFile()) {
    addIssue(
      issues,
      "artifact-file-invalid",
      `${location}.path`,
      "Claimed artifact must be a regular file.",
    );
    return;
  }
  const actualHash = crypto
    .createHash("sha256")
    .update(readFileSync(realCandidate))
    .digest("hex");
  if (actualHash !== artifact.sha256)
    addIssue(
      issues,
      "artifact-hash-mismatch",
      `${location}.sha256`,
      "Claimed SHA-256 does not match the artifact bytes.",
    );
}

function validateArtifactList(
  artifacts,
  location,
  issues,
  { verifyBytes, repoRoot },
) {
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
    if (
      typeof artifact.requirement !== "string" ||
      artifact.requirement.length === 0
    )
      addIssue(
        issues,
        "artifact-requirement-invalid",
        `${artifactLocation}.requirement`,
        "Claimed artifacts require a non-empty requirement ID.",
      );
    const pathValid = validRelativePath(artifact.path);
    if (!pathValid)
      addIssue(
        issues,
        "artifact-path-invalid",
        `${artifactLocation}.path`,
        "Claimed artifacts require a non-empty repository-relative path without traversal.",
      );
    const hashValid =
      typeof artifact.sha256 === "string" && SHA256.test(artifact.sha256);
    if (!hashValid)
      addIssue(
        issues,
        "artifact-hash-invalid",
        `${artifactLocation}.sha256`,
        "Claimed artifacts require a lowercase 64-hex SHA-256.",
      );
    if (verifyBytes && pathValid && hashValid)
      verifyArtifactBytes(artifact, artifactLocation, issues, repoRoot);
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
  if (contract.kind !== "PresentationChecklistContractV1")
    addIssue(
      issues,
      "contract-kind-invalid",
      "contract.kind",
      "Unexpected contract kind.",
    );
  if (contract.adapterContract !== "PresentationAdapterV1")
    addIssue(
      issues,
      "adapter-contract-invalid",
      "contract.adapterContract",
      "Expected PresentationAdapterV1.",
    );
  if (contract.recipesPath !== RECIPES_PATH)
    addIssue(
      issues,
      "contract-recipes-path-invalid",
      "contract.recipesPath",
      `Expected ${RECIPES_PATH}.`,
    );
  validateIdList(
    contract.artifactRequirements,
    "contract.artifactRequirements",
    issues,
    "artifact-requirements-invalid",
  );
  const checks = Array.isArray(contract.checks) ? contract.checks : [];
  if (
    !sameOrderedValues(
      checks.map((check) => check?.id),
      EXPECTED_IDS,
    )
  )
    addIssue(
      issues,
      "check-ids-not-canonical",
      "contract.checks",
      "The 28 PRES IDs must be complete, unique, and in published execution order.",
    );
  checks.forEach((check, index) => {
    const location = `contract.checks[${index}]`;
    if (!isObject(check)) {
      addIssue(issues, "check-invalid", location, "Check must be an object.");
      return;
    }
    if (
      typeof check.executionRecipeId !== "string" ||
      check.executionRecipeId.length === 0
    )
      addIssue(
        issues,
        "execution-recipe-id-invalid",
        `${location}.executionRecipeId`,
        "Every check requires one executionRecipeId.",
      );
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
    validateIdList(
      check.evidenceRequirements,
      `${location}.evidenceRequirements`,
      issues,
      "evidenceRequirements-invalid",
    );
    validateIdList(
      check.negativeControlIds,
      `${location}.negativeControlIds`,
      issues,
      "negativeControlIds-invalid",
    );
  });
  return { issues, checks };
}

function validateRecipeSet(value, location, issues) {
  if (!isObject(value)) {
    addIssue(
      issues,
      "recipe-set-invalid",
      location,
      "Recipe set must be an object.",
    );
    return;
  }
  if (!RECIPE_COVERAGE.has(value.coverage))
    addIssue(
      issues,
      "recipe-coverage-invalid",
      `${location}.coverage`,
      "Recipe coverage must be implemented, partial, missing, or calibration-required.",
    );
  validateIdList(value.requiredIds, `${location}.requiredIds`, issues);
}

function validateRecipes(contract, catalog) {
  const issues = [];
  if (
    !isObject(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "PresentationRecipeCatalogV1"
  ) {
    addIssue(
      issues,
      "recipes-schema-invalid",
      "recipes",
      "Expected PresentationRecipeCatalogV1 schemaVersion 1.",
    );
    return { issues, recipes: [] };
  }
  if (catalog.contractPath !== CONTRACT_PATH)
    addIssue(
      issues,
      "recipes-contract-path-invalid",
      "recipes.contractPath",
      `Expected ${CONTRACT_PATH}.`,
    );
  const recipes = Array.isArray(catalog.recipes) ? catalog.recipes : [];
  if (
    !sameOrderedValues(
      recipes.map((recipe) => recipe?.id),
      contract.checks.map((check) => check.executionRecipeId),
    ) ||
    !sameOrderedValues(
      recipes.map((recipe) => recipe?.checkId),
      contract.checks.map((check) => check.id),
    )
  )
    addIssue(
      issues,
      "recipes-not-canonical",
      "recipes.recipes",
      "Recipes must match every contract check and executionRecipeId in exact order.",
    );
  recipes.forEach((recipe, index) => {
    const check = contract.checks[index];
    const location = `recipes.recipes[${index}]`;
    if (!isObject(recipe) || !check) return;
    for (const property of ["scenarioSet", "deviceProfileSet", "gestureSet"])
      validateRecipeSet(recipe[property], `${location}.${property}`, issues);
    if (!isObject(recipe.evaluator))
      addIssue(
        issues,
        "recipe-evaluator-invalid",
        `${location}.evaluator`,
        "Recipe evaluator must be an object.",
      );
    else {
      if (
        typeof recipe.evaluator.id !== "string" ||
        recipe.evaluator.id.length === 0
      )
        addIssue(
          issues,
          "recipe-evaluator-id-invalid",
          `${location}.evaluator.id`,
          "Evaluator ID must be non-empty.",
        );
      if (!RECIPE_COVERAGE.has(recipe.evaluator.coverage))
        addIssue(
          issues,
          "recipe-coverage-invalid",
          `${location}.evaluator.coverage`,
          "Evaluator coverage is invalid.",
        );
      validateIdList(
        recipe.evaluator.requiredSignalIds,
        `${location}.evaluator.requiredSignalIds`,
        issues,
      );
    }
    if (typeof recipe.reproduce !== "string" || recipe.reproduce.length === 0)
      addIssue(
        issues,
        "recipe-reproduce-invalid",
        `${location}.reproduce`,
        "Recipe requires one exact reproduction command.",
      );
    const controls = Array.isArray(recipe.negativeControls)
      ? recipe.negativeControls
      : [];
    if (
      !sameOrderedValues(
        controls.map((control) => control?.id),
        check.negativeControlIds,
      )
    )
      addIssue(
        issues,
        "recipe-controls-not-canonical",
        `${location}.negativeControls`,
        "Recipe controls must match the contract exactly and in order.",
      );
    controls.forEach((control, controlIndex) => {
      if (
        !isObject(control) ||
        typeof control.expectedSignal !== "string" ||
        control.expectedSignal.length === 0
      )
        addIssue(
          issues,
          "recipe-control-signal-invalid",
          `${location}.negativeControls[${controlIndex}].expectedSignal`,
          "Every recipe control needs one expected evaluator signal.",
        );
    });
  });
  return { issues, recipes };
}

function validateObserved(observed, recipe, location, result, issues) {
  if (!isObject(observed)) {
    addIssue(
      issues,
      "observed-matrix-invalid",
      location,
      "observed must contain structured scenario, device-profile, and gesture IDs.",
    );
    return;
  }
  const dimensions = [
    ["scenarioIds", recipe.scenarioSet.requiredIds],
    ["deviceProfileIds", recipe.deviceProfileSet.requiredIds],
    ["gestureIds", recipe.gestureSet.requiredIds],
  ];
  for (const [property, requiredIds] of dimensions) {
    const ids = observed[property];
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== "string" || id.length === 0) ||
      new Set(ids).size !== ids.length
    )
      addIssue(
        issues,
        "observed-ids-invalid",
        `${location}.${property}`,
        "Observed IDs must be an ordered list of unique non-empty IDs.",
      );
    if (result === "PASS" && !sameOrderedValues(ids, requiredIds))
      addIssue(
        issues,
        "observed-matrix-incomplete",
        `${location}.${property}`,
        "PASS must observe every recipe matrix member exactly and in order.",
      );
  }
}

function validateSignals(signals, recipe, location, result, issues) {
  if (!Array.isArray(signals)) {
    addIssue(issues, "signals-invalid", location, "signals must be an array.");
    return;
  }
  const ids = signals.map((signal) => signal?.id);
  signals.forEach((signal, index) => {
    if (
      !isObject(signal) ||
      typeof signal.id !== "string" ||
      signal.id.length === 0
    )
      addIssue(
        issues,
        "signal-invalid",
        `${location}[${index}]`,
        "Signal must have a non-empty ID.",
      );
    if (
      result === "PASS" &&
      (!nonemptyObject(signal?.actual) || !nonemptyObject(signal?.contract))
    )
      addIssue(
        issues,
        "pass-signal-evidence-incomplete",
        `${location}[${index}]`,
        "PASS signals require non-empty actual and contract observations.",
      );
  });
  if (result === "PASS" && signals.length === 0)
    addIssue(
      issues,
      "pass-signals-empty",
      location,
      "PASS requires non-empty evaluator signals.",
    );
  if (
    result === "PASS" &&
    !sameOrderedValues(ids, recipe.evaluator.requiredSignalIds)
  )
    addIssue(
      issues,
      "pass-signals-not-canonical",
      location,
      "PASS signals must match the recipe evaluator exactly and in order.",
    );
}

function validateReview(
  review,
  contractCheck,
  artifacts,
  location,
  result,
  issues,
) {
  if (!isObject(review)) {
    addIssue(
      issues,
      "review-invalid",
      location,
      "visualReview must be an object.",
    );
    return;
  }
  if (review.mandatory !== contractCheck.mandatoryReview)
    addIssue(
      issues,
      "review-mandatory-mismatch",
      `${location}.mandatory`,
      "Run review requirement must match its contract.",
    );
  if (!REVIEW_VERDICTS.has(review.verdict))
    addIssue(
      issues,
      "review-verdict-invalid",
      `${location}.verdict`,
      "Review verdict is invalid.",
    );
  const hashes = review.reviewedArtifactHashes;
  if (
    !Array.isArray(hashes) ||
    hashes.some((hash) => typeof hash !== "string" || !SHA256.test(hash)) ||
    new Set(hashes).size !== hashes.length
  )
    addIssue(
      issues,
      "review-hashes-invalid",
      `${location}.reviewedArtifactHashes`,
      "Review artifact hashes must be unique lowercase SHA-256 values.",
    );
  const artifactHashes = new Set(
    artifacts.filter(isObject).map((artifact) => artifact.sha256),
  );
  if (Array.isArray(hashes) && hashes.some((hash) => !artifactHashes.has(hash)))
    addIssue(
      issues,
      "review-hash-not-claimed-by-row",
      `${location}.reviewedArtifactHashes`,
      "Every reviewed hash must belong to an artifact claimed by this row.",
    );
  const reviewClaimed =
    contractCheck.mandatoryReview &&
    (result === "PASS" || review.verdict !== "NOT_RUN");
  if (reviewClaimed) {
    if (typeof review.reviewerId !== "string" || review.reviewerId.length === 0)
      addIssue(
        issues,
        "mandatory-reviewer-id-missing",
        `${location}.reviewerId`,
        "Mandatory review requires a non-empty reviewerId.",
      );
    if (
      !Array.isArray(review.reasons) ||
      review.reasons.length === 0 ||
      review.reasons.some(
        (reason) => typeof reason !== "string" || reason.length === 0,
      )
    )
      addIssue(
        issues,
        "mandatory-review-reasons-missing",
        `${location}.reasons`,
        "Mandatory review requires non-empty reasons.",
      );
  }
  if (
    result === "PASS" &&
    contractCheck.mandatoryReview &&
    (review.verdict !== "ACCEPT" ||
      !Array.isArray(hashes) ||
      hashes.length === 0)
  )
    addIssue(
      issues,
      "mandatory-review-incomplete",
      location,
      "A PASS needs mandatory review ACCEPT and at least one row-bound artifact hash.",
    );
}

function recipeAcceptanceReady(recipe) {
  return [
    recipe.scenarioSet.coverage,
    recipe.deviceProfileSet.coverage,
    recipe.gestureSet.coverage,
    recipe.evaluator.coverage,
  ].every((coverage) => coverage === "implemented");
}

function validateRun(contract, recipes, run, options) {
  const issues = [];
  const blockers = [];
  const artifactOptions = {
    verifyBytes: options.mode === "accept",
    repoRoot: options.repoRoot,
  };
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
  if (run.contractPath !== CONTRACT_PATH)
    addIssue(
      issues,
      "run-contract-path-invalid",
      "run.contractPath",
      `Expected ${CONTRACT_PATH}.`,
    );
  if (run.recipesPath !== RECIPES_PATH)
    addIssue(
      issues,
      "run-recipes-path-invalid",
      "run.recipesPath",
      `Expected ${RECIPES_PATH}.`,
    );
  if (run.adapterContract !== contract.adapterContract)
    addIssue(
      issues,
      "run-adapter-mismatch",
      "run.adapterContract",
      "Run must name the contract adapter.",
    );
  if (typeof run.runId !== "string" || run.runId.length === 0)
    addIssue(issues, "run-id-invalid", "run.runId", "runId must be non-empty.");
  if (!isObject(run.environment))
    addIssue(
      issues,
      "environment-invalid",
      "run.environment",
      "Run must preserve commit and exact reproduction command fields.",
    );
  else {
    if (typeof run.environment.reproduce !== "string")
      addIssue(
        issues,
        "environment-invalid",
        "run.environment.reproduce",
        "Environment reproduction command must be a string.",
      );
    if (options.mode === "accept") {
      if (
        typeof run.environment.commit !== "string" ||
        !COMMIT.test(run.environment.commit)
      )
        addIssue(
          issues,
          "environment-commit-invalid",
          "run.environment.commit",
          "Acceptance requires an exact lowercase 40-hex commit.",
        );
      if (
        typeof run.environment.reproduce !== "string" ||
        run.environment.reproduce.length === 0 ||
        run.environment.reproduce.includes("replace-with")
      )
        addIssue(
          issues,
          "environment-reproduce-invalid",
          "run.environment.reproduce",
          "Acceptance requires one exact non-placeholder reproduction command.",
        );
    }
  }
  const entries = Array.isArray(run.checks) ? run.checks : [];
  if (
    !sameOrderedValues(
      entries.map((entry) => entry?.checkId),
      contract.checks.map((check) => check.id),
    )
  )
    addIssue(
      issues,
      "run-checks-not-canonical",
      "run.checks",
      "Run must contain every contract ID exactly once and in fixed order.",
    );
  entries.forEach((entry, index) => {
    const contractCheck = contract.checks[index];
    const recipe = recipes[index];
    const location = `run.checks[${index}]`;
    if (!isObject(entry) || !contractCheck || !recipe) return;
    if (
      entry.executionRecipeId !== contractCheck.executionRecipeId ||
      entry.executionRecipeId !== recipe.id
    )
      addIssue(
        issues,
        "run-recipe-mismatch",
        `${location}.executionRecipeId`,
        "Run entry must bind the matching contract recipe.",
      );
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
    validateObserved(
      entry.observed,
      recipe,
      `${location}.observed`,
      entry.result,
      issues,
    );
    validateSignals(
      entry.signals,
      recipe,
      `${location}.signals`,
      entry.result,
      issues,
    );
    if (
      entry.result === "PASS" &&
      (typeof entry.reproduce !== "string" ||
        entry.reproduce !== recipe.reproduce)
    )
      addIssue(
        issues,
        "reproduce-command-mismatch",
        `${location}.reproduce`,
        "PASS must record the recipe's exact reproduction command.",
      );
    if (entry.result === "PASS" && !recipeAcceptanceReady(recipe))
      addIssue(
        issues,
        "recipe-not-acceptance-ready",
        location,
        "PASS is prohibited while any recipe matrix or evaluator is partial, missing, or calibration-required.",
      );
    const artifacts = validateArtifactList(
      entry.artifacts,
      `${location}.artifacts`,
      issues,
      artifactOptions,
    );
    const requirementNames = new Set(
      artifacts.filter(isObject).map((artifact) => artifact.requirement),
    );
    if (entry.result === "PASS")
      for (const requirement of [
        ...contract.artifactRequirements,
        ...contractCheck.evidenceRequirements,
      ])
        if (!requirementNames.has(requirement))
          addIssue(
            issues,
            "required-artifact-missing",
            `${location}.artifacts`,
            `PASS lacks the required ${requirement} artifact.`,
          );
    if (!Array.isArray(entry.negativeControls))
      addIssue(
        issues,
        "negative-controls-invalid",
        `${location}.negativeControls`,
        "negativeControls must be an array.",
      );
    else {
      const controlIds = entry.negativeControls.map((control) => control?.id);
      if (
        !sameOrderedValues(controlIds, contractCheck.negativeControlIds) ||
        !sameOrderedValues(
          controlIds,
          recipe.negativeControls.map((control) => control.id),
        )
      )
        addIssue(
          issues,
          "negative-controls-not-canonical",
          `${location}.negativeControls`,
          "Negative controls must match the contract and recipe exactly and in order.",
        );
      entry.negativeControls.forEach((control, controlIndex) => {
        const recipeControl = recipe.negativeControls[controlIndex];
        const controlLocation = `${location}.negativeControls[${controlIndex}]`;
        if (!isObject(control)) {
          addIssue(
            issues,
            "negative-control-invalid",
            controlLocation,
            "Negative control must be an object.",
          );
          return;
        }
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
          artifactOptions,
        );
        if (control.status === "DETECTED") {
          if (
            controlArtifacts.length === 0 ||
            typeof control.signal !== "string" ||
            control.signal.length === 0
          )
            addIssue(
              issues,
              "detected-control-evidence-incomplete",
              controlLocation,
              "A detected control needs its expected signal and hash-bound evidence.",
            );
          if (recipeControl && control.signal !== recipeControl.expectedSignal)
            addIssue(
              issues,
              "negative-control-signal-mismatch",
              `${controlLocation}.signal`,
              "Detected control signal must equal the recipe's expected signal.",
            );
        }
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
      artifacts,
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

export function validatePresentationChecklist(
  contract,
  recipes,
  run,
  options = {},
) {
  const mode = options.mode ?? "lint";
  const root = path.resolve(options.repoRoot ?? process.cwd());
  const repoRoot = existsSync(root) ? realpathSync(root) : root;
  const contractResult = validateContract(contract);
  const recipeResult =
    contractResult.issues.length === 0
      ? validateRecipes(contract, recipes)
      : { issues: [], recipes: [] };
  const prerequisiteIssues = [...contractResult.issues, ...recipeResult.issues];
  const runResult =
    prerequisiteIssues.length === 0
      ? validateRun(contract, recipeResult.recipes, run, {
          mode,
          repoRoot,
        })
      : {
          issues: [],
          blockers: [{ checkId: "contract", reason: "invalid-contract" }],
        };
  return {
    schemaVersion: 1,
    valid: prerequisiteIssues.length === 0 && runResult.issues.length === 0,
    issues: [...prerequisiteIssues, ...runResult.issues],
    acceptanceBlockers: runResult.blockers,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
  };
  const mode = option("--mode", "lint");
  const contractPath = option("--contract", CONTRACT_PATH);
  const recipesPath = option("--recipes", RECIPES_PATH);
  const runPath = option("--run", "quality/presentation-run.v1.template.json");
  if (!new Set(["lint", "accept"]).has(mode))
    throw new Error("Use --mode lint or --mode accept.");
  const [contract, recipes, run] = await Promise.all(
    [contractPath, recipesPath, runPath].map(async (file) =>
      JSON.parse(await fs.readFile(file, "utf8")),
    ),
  );
  const report = validatePresentationChecklist(contract, recipes, run, {
    mode,
    repoRoot: process.cwd(),
  });
  const accepted =
    mode === "accept" && report.valid && report.acceptanceBlockers.length === 0;
  console.log(JSON.stringify({ ...report, mode, accepted }, null, 2));
  if (!report.valid || (mode === "accept" && !accepted)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
