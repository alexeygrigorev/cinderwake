import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validatePresentationChecklist } from "../../scripts/validate-presentation-checklist.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contractPath = fileURLToPath(
  new URL("../../quality/presentation-checklist.v1.json", import.meta.url),
);
const recipesPath = fileURLToPath(
  new URL("../../quality/presentation-recipes.v1.json", import.meta.url),
);
const templatePath = fileURLToPath(
  new URL("../../quality/presentation-run.v1.template.json", import.meta.url),
);
const packagePath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

interface Fixture {
  contract: any;
  recipes: any;
  run: any;
}

async function fixture(): Promise<Fixture> {
  const [contractText, recipesText, templateText] = await Promise.all([
    fs.readFile(contractPath, "utf8"),
    fs.readFile(recipesPath, "utf8"),
    fs.readFile(templatePath, "utf8"),
  ]);
  return {
    contract: JSON.parse(contractText),
    recipes: JSON.parse(recipesText),
    run: JSON.parse(templateText),
  };
}

function issueCodes(report: ReturnType<typeof validatePresentationChecklist>) {
  return report.issues.map(({ code }) => code);
}

function artifact(requirement: string, sha256: string) {
  return { requirement, path: "package.json", sha256 };
}

async function fixtureWithReadyPass(): Promise<Fixture> {
  const value = await fixture();
  const index = value.contract.checks.findIndex(
    ({ id }: { id: string }) => id === "PRES-SPRITE-004",
  );
  const check = value.contract.checks[index];
  const recipe = value.recipes.recipes[index];
  const entry = value.run.checks[index];
  const sha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(packagePath))
    .digest("hex");
  entry.result = "PASS";
  entry.observed = {
    scenarioIds: [...recipe.scenarioSet.requiredIds],
    deviceProfileIds: [...recipe.deviceProfileSet.requiredIds],
    gestureIds: [...recipe.gestureSet.requiredIds],
  };
  entry.signals = recipe.evaluator.requiredSignalIds.map((id: string) => ({
    id,
    actual: { pass: true },
    contract: { expected: true },
  }));
  entry.artifacts = [
    ...value.contract.artifactRequirements,
    ...check.evidenceRequirements,
  ].map((requirement: string) => artifact(requirement, sha256));
  entry.negativeControls = recipe.negativeControls.map(
    ({ id, expectedSignal }: { id: string; expectedSignal: string }) => ({
      id,
      status: "DETECTED",
      signal: expectedSignal,
      artifacts: [artifact("negative-control-evidence", sha256)],
    }),
  );
  entry.visualReview = {
    mandatory: true,
    verdict: "ACCEPT",
    reviewerId: "independent-reviewer:test-fixture",
    reasons: ["Exact package artifact reviewed for schema test."],
    reviewedArtifactHashes: [sha256],
  };
  entry.reproduce = recipe.reproduce;
  value.run.runId = "presentation-contract-test";
  value.run.environment = {
    commit: "a".repeat(40),
    reproduce:
      "npm run quality:presentation:accept -- --run quality-results/presentation-runs/presentation-contract-test.json",
  };
  return value;
}

function validate(
  { contract, recipes, run }: Fixture,
  mode: "lint" | "accept" = "lint",
) {
  return validatePresentationChecklist(contract, recipes, run, {
    mode,
    repoRoot: root,
  });
}

describe("presentation checklist contract", () => {
  it("keeps the complete ordered blank template lintable but never acceptable", async () => {
    const value = await fixture();
    const lint = validate(value);
    const acceptance = validate(value, "accept");

    expect(lint.valid).toBe(true);
    expect(lint.acceptanceBlockers).toContainEqual({
      checkId: "PRES-LIVE-001",
      reason: "unrun",
    });
    expect(lint.acceptanceBlockers).toContainEqual({
      checkId: "PRES-LIVE-001",
      reason: "p0-incomplete",
    });
    expect(acceptance.valid).toBe(false);
    expect(issueCodes(acceptance)).toContain("environment-commit-invalid");
    expect(issueCodes(acceptance)).toContain("environment-reproduce-invalid");
  });

  it("binds every ordered contract row to one recipe and one run entry", async () => {
    const { contract, recipes, run } = await fixture();
    expect(
      contract.checks.map(
        ({
          id,
          executionRecipeId,
        }: {
          id: string;
          executionRecipeId: string;
        }) => `${id}:${executionRecipeId}`,
      ),
    ).toEqual(
      recipes.recipes.map(
        ({ checkId, id }: { checkId: string; id: string }) =>
          `${checkId}:${id}`,
      ),
    );
    expect(
      run.checks.map(
        ({
          checkId,
          executionRecipeId,
        }: {
          checkId: string;
          executionRecipeId: string;
        }) => `${checkId}:${executionRecipeId}`,
      ),
    ).toEqual(
      recipes.recipes.map(
        ({ checkId, id }: { checkId: string; id: string }) =>
          `${checkId}:${id}`,
      ),
    );
    expect(validate({ contract, recipes, run }).valid).toBe(true);
  });

  it("keeps the complete city journey and arbitrary-state replay as explicit P0 gates", async () => {
    const { contract, recipes, run } = await fixture();
    const expected = [
      {
        checkId: "PRES-CITY-027",
        recipeId: "recipe:pres-city-027",
        signals: [
          "city-route-discoverable",
          "gate-transition-completes",
          "all-service-intents-live",
          "all-service-outcomes-visible",
        ],
      },
      {
        checkId: "PRES-STATE-028",
        recipeId: "recipe:pres-state-028",
        signals: [
          "loaded-state-matches",
          "reset-isolates-runs",
          "replay-state-hashes-match",
          "replay-manifest-frame-hashes-match",
        ],
      },
    ];

    for (const item of expected) {
      const index = contract.checks.findIndex(
        ({ id }: { id: string }) => id === item.checkId,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(contract.checks[index]).toMatchObject({
        id: item.checkId,
        executionRecipeId: item.recipeId,
        priority: "P0",
      });
      expect(recipes.recipes[index]).toMatchObject({
        id: item.recipeId,
        checkId: item.checkId,
        evaluator: { requiredSignalIds: item.signals },
      });
      expect(run.checks[index]).toMatchObject({
        checkId: item.checkId,
        executionRecipeId: item.recipeId,
        result: "UNRUN",
      });
    }
  });

  it("adds liveness intent-registry evidence and both listener controls", async () => {
    const { contract, recipes, run } = await fixture();
    const check = contract.checks[0];
    expect(check.evidenceRequirements).toContain("control-intent-registry");
    expect(check.negativeControlIds).toEqual([
      "begin-listener-removed",
      "action-listener-removed",
      "required-asset-stalled",
      "atlas-load-aborted",
    ]);
    expect(
      recipes.recipes[0].negativeControls.map(({ id }: { id: string }) => id),
    ).toEqual(check.negativeControlIds);
    expect(
      run.checks[0].negativeControls.map(({ id }: { id: string }) => id),
    ).toEqual(check.negativeControlIds);
  });

  it("accepts a completely populated acceptance-ready row while the overall run remains blocked", async () => {
    const value = await fixtureWithReadyPass();
    const report = validate(value, "accept");

    expect(report.valid, JSON.stringify(report.issues)).toBe(true);
    expect(report.acceptanceBlockers).toContainEqual({
      checkId: "PRES-LIVE-001",
      reason: "unrun",
    });
  });

  it("rejects omitted or reordered contract, recipe, run, and control IDs", async () => {
    const omittedRun = await fixture();
    omittedRun.run.checks.splice(8, 1);
    expect(issueCodes(validate(omittedRun))).toContain(
      "run-checks-not-canonical",
    );

    const reorderedRecipe = await fixture();
    reorderedRecipe.recipes.recipes.reverse();
    expect(issueCodes(validate(reorderedRecipe))).toContain(
      "recipes-not-canonical",
    );

    const reorderedControl = await fixture();
    reorderedControl.run.checks[0].negativeControls.reverse();
    expect(issueCodes(validate(reorderedControl))).toContain(
      "negative-controls-not-canonical",
    );

    const wrongRecipe = await fixture();
    wrongRecipe.run.checks[0].executionRecipeId = "recipe:pres-input-002";
    expect(issueCodes(validate(wrongRecipe))).toContain("run-recipe-mismatch");
  });

  it("rejects empty PASS signals, incomplete matrices, and reproduction drift", async () => {
    const emptySignals = await fixtureWithReadyPass();
    emptySignals.run.checks[3].signals = [];
    expect(issueCodes(validate(emptySignals))).toContain("pass-signals-empty");

    const omittedMatrixMember = await fixtureWithReadyPass();
    omittedMatrixMember.run.checks[3].observed.scenarioIds.pop();
    expect(issueCodes(validate(omittedMatrixMember))).toContain(
      "observed-matrix-incomplete",
    );

    const emptySignalEvidence = await fixtureWithReadyPass();
    emptySignalEvidence.run.checks[3].signals[0].actual = {};
    expect(issueCodes(validate(emptySignalEvidence))).toContain(
      "pass-signal-evidence-incomplete",
    );

    const wrongCommand = await fixtureWithReadyPass();
    wrongCommand.run.checks[3].reproduce = "npm test";
    expect(issueCodes(validate(wrongCommand))).toContain(
      "reproduce-command-mismatch",
    );
  });

  it("rejects the wrong expected negative-control signal", async () => {
    const value = await fixtureWithReadyPass();
    value.run.checks[3].negativeControls[0].signal = "some-other-signal";
    expect(issueCodes(validate(value))).toContain(
      "negative-control-signal-mismatch",
    );
  });

  it("prohibits PASS while a recipe remains partial, missing, or calibration-required", async () => {
    const value = await fixtureWithReadyPass();
    value.recipes.recipes[3].evaluator.coverage = "calibration-required";
    expect(issueCodes(validate(value))).toContain(
      "recipe-not-acceptance-ready",
    );
  });

  it.each([
    {
      name: "unbound review hash",
      expected: "review-hash-not-claimed-by-row",
      mutate(value: Fixture) {
        value.run.checks[3].visualReview.reviewedArtifactHashes = [
          "f".repeat(64),
        ];
      },
    },
    {
      name: "missing reviewer",
      expected: "mandatory-reviewer-id-missing",
      mutate(value: Fixture) {
        value.run.checks[3].visualReview.reviewerId = "";
      },
    },
    {
      name: "missing review reason",
      expected: "mandatory-review-reasons-missing",
      mutate(value: Fixture) {
        value.run.checks[3].visualReview.reasons = [];
      },
    },
  ])("rejects $name", async ({ expected, mutate }) => {
    const value = await fixtureWithReadyPass();
    mutate(value);
    expect(issueCodes(validate(value))).toContain(expected);
  });

  it("verifies claimed artifact existence and bytes in accept mode", async () => {
    const missing = await fixtureWithReadyPass();
    missing.run.checks[3].artifacts[0].path =
      "quality-results/does-not-exist.json";
    expect(issueCodes(validate(missing, "accept"))).toContain(
      "artifact-file-missing",
    );

    const forged = await fixtureWithReadyPass();
    forged.run.checks[3].artifacts[0].sha256 = "0".repeat(64);
    expect(issueCodes(validate(forged, "accept"))).toContain(
      "artifact-hash-mismatch",
    );

    const traversal = await fixtureWithReadyPass();
    traversal.run.checks[3].artifacts[0].path = "../package.json";
    expect(issueCodes(validate(traversal, "accept"))).toContain(
      "artifact-path-invalid",
    );
  });

  it("rejects a bad commit or contract/catalog path in accept mode", async () => {
    const badCommit = await fixtureWithReadyPass();
    badCommit.run.environment.commit = "main";
    expect(issueCodes(validate(badCommit, "accept"))).toContain(
      "environment-commit-invalid",
    );

    const badContractPath = await fixtureWithReadyPass();
    badContractPath.run.contractPath = "quality/other-contract.json";
    expect(issueCodes(validate(badContractPath, "accept"))).toContain(
      "run-contract-path-invalid",
    );

    const badRecipesPath = await fixtureWithReadyPass();
    badRecipesPath.run.recipesPath = "quality/other-recipes.json";
    expect(issueCodes(validate(badRecipesPath, "accept"))).toContain(
      "run-recipes-path-invalid",
    );
  });

  it("rejects absolute, traversing, and unhashed claimed artifacts during lint", async () => {
    const value = await fixture();
    value.run.checks[0].artifacts.push({
      requirement: "environment-metadata",
      path: "../outside.png",
      sha256: "not-a-hash",
    });
    const codes = issueCodes(validate(value));
    expect(codes).toContain("artifact-path-invalid");
    expect(codes).toContain("artifact-hash-invalid");
  });
});
