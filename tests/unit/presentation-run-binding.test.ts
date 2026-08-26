import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { bindPresentationRun } from "../../scripts/lib/presentation-run-binding.mjs";
import { validatePresentationChecklist } from "../../scripts/validate-presentation-checklist.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temporaryDirectories: string[] = [];

async function readJson(relativePath: string) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
}

function comparison(recipe: any) {
  return {
    comparison: {
      pass: true,
      signals: recipe.evaluator.requiredSignalIds.map((id: string) => ({
        id,
        pass: true,
        detail: { fixture: true },
      })),
    },
    negativeControls: recipe.negativeControls.map(
      ({ id, expectedSignal }: { id: string; expectedSignal: string }) => ({
        id,
        status: "DETECTED",
        signal: expectedSignal,
      }),
    ),
  };
}

async function artifactFixture(requirements: string[]) {
  const directory = await fs.mkdtemp(
    path.join(root, "quality-results/.presentation-binding-test-"),
  );
  temporaryDirectories.push(directory);
  const relativePath = path.relative(
    root,
    path.join(directory, "evidence.json"),
  );
  await fs.writeFile(path.join(directory, "evidence.json"), "fixture\n");
  return requirements.map((requirement): [string, string] => [
    requirement,
    relativePath,
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("presentation run binding", () => {
  it("binds machine evidence while preserving the city visual-review gate", async () => {
    const [template, contract, recipes] = await Promise.all([
      readJson("quality/presentation-run.v1.template.json"),
      readJson("quality/presentation-checklist.v1.json"),
      readJson("quality/presentation-recipes.v1.json"),
    ]);
    const cityRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-CITY-027",
    );
    const stateRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-STATE-028",
    );
    const cityRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-CITY-027",
      ).evidenceRequirements,
    ];
    const stateRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-STATE-028",
      ).evidenceRequirements,
    ];
    const cityArtifacts = await artifactFixture(cityRequirements);
    const stateArtifacts = await artifactFixture(stateRequirements);
    const commit = "a".repeat(40);
    const metadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait", "phone-landscape"],
    };
    const run = await bindPresentationRun({
      repoRoot: root,
      runId: "binding-fixture",
      template,
      contract,
      recipes,
      cityMetadata: metadata,
      cityComparison: comparison(cityRecipe),
      stateMetadata: metadata,
      stateComparison: comparison(stateRecipe),
      commit,
      reproduce: "npm run test:city-journey && npm run test:state-replay",
      cityArtifacts,
      stateArtifacts,
    });
    const report = validatePresentationChecklist(contract, recipes, run, {
      mode: "lint",
      repoRoot: root,
    });
    const city = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-CITY-027",
    )!;
    const state = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-STATE-028",
    )!;

    expect(report.valid).toBe(true);
    expect(city.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(city.visualReview).toMatchObject({
      mandatory: true,
      verdict: "NOT_RUN",
    });
    expect(state.result).toBe("PASS");
    expect(state.signals).toHaveLength(
      stateRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      state.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(
      state.artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)),
    ).toBe(true);
  });
});
