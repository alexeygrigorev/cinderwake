import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validatePresentationChecklist } from "../../scripts/validate-presentation-checklist.mjs";

const contractPath = fileURLToPath(
  new URL("../../quality/presentation-checklist.v1.json", import.meta.url),
);
const templatePath = fileURLToPath(
  new URL("../../quality/presentation-run.v1.template.json", import.meta.url),
);

async function fixture() {
  const [contractText, templateText] = await Promise.all([
    fs.readFile(contractPath, "utf8"),
    fs.readFile(templatePath, "utf8"),
  ]);
  return {
    contract: JSON.parse(contractText),
    run: JSON.parse(templateText),
  };
}

describe("presentation checklist contract", () => {
  it("keeps the complete ordered blank template lintable without claiming acceptance", async () => {
    const { contract, run } = await fixture();
    const report = validatePresentationChecklist(contract, run);

    expect(report.valid).toBe(true);
    expect(report.acceptanceBlockers).toContainEqual({
      checkId: "PRES-LIVE-001",
      reason: "unrun",
    });
    expect(report.acceptanceBlockers).toContainEqual({
      checkId: "PRES-LIVE-001",
      reason: "p0-incomplete",
    });
  });

  it("rejects an omitted or reordered check instead of silently accepting a partial run", async () => {
    const { contract, run } = await fixture();
    run.checks.splice(8, 1);

    const report = validatePresentationChecklist(contract, run);

    expect(report.valid).toBe(false);
    expect(
      report.issues.some(
        (issue: { code: string }) => issue.code === "run-checks-not-canonical",
      ),
    ).toBe(true);
  });

  it("requires each PASS control, evidence requirement, and mandatory hash-bound review", async () => {
    const { contract, run } = await fixture();
    const entry = run.checks[0];
    entry.result = "PASS";
    entry.negativeControls.forEach((control: { status: string }) => {
      control.status = "DETECTED";
    });
    entry.visualReview.verdict = "ACCEPT";

    const report = validatePresentationChecklist(contract, run);
    const codes = report.issues.map((issue: { code: string }) => issue.code);

    expect(codes).toContain("required-artifact-missing");
    expect(codes).toContain("detected-control-evidence-incomplete");
    expect(codes).toContain("mandatory-review-incomplete");
  });

  it("rejects absolute, traversing, and unhashed claimed artifacts", async () => {
    const { contract, run } = await fixture();
    run.checks[0].artifacts.push({
      requirement: "environment-metadata",
      path: "../outside.png",
      sha256: "not-a-hash",
    });

    const report = validatePresentationChecklist(contract, run);
    const codes = report.issues.map((issue: { code: string }) => issue.code);

    expect(codes).toContain("artifact-path-invalid");
    expect(codes).toContain("artifact-hash-invalid");
  });
});
