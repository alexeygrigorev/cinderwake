import fs from "node:fs/promises";
import path from "node:path";
import { validatePresentationChecklist } from "./validate-presentation-checklist.mjs";

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = path.resolve(option(args, "--repo-root", process.cwd()));
  const runOption = option(args, "--run");
  if (!runOption) throw new Error("Use --run <presentation-run.json>");

  const [contract, recipes, presentationRun] = await Promise.all([
    readJson(path.join(repoRoot, "quality/presentation-checklist.v1.json")),
    readJson(path.join(repoRoot, "quality/presentation-recipes.v1.json")),
    readJson(path.resolve(repoRoot, runOption)),
  ]);
  const report = validatePresentationChecklist(
    contract,
    recipes,
    presentationRun,
    { mode: "lint", repoRoot },
  );
  const blockers = new Map();
  for (const blocker of report.acceptanceBlockers) {
    const reasons = blockers.get(blocker.checkId) ?? [];
    if (!reasons.includes(blocker.reason)) reasons.push(blocker.reason);
    blockers.set(blocker.checkId, reasons);
  }
  const counts = { PASS: 0, FAIL: 0, NEEDS_VISUAL_REVIEW: 0, UNRUN: 0 };

  console.log(
    `Presentation run ${presentationRun.runId ?? "<missing-run-id>"} @ ${presentationRun.environment?.commit ?? "<missing-commit>"}`,
  );
  for (const [index, check] of contract.checks.entries()) {
    const entry = presentationRun.checks?.[index];
    const result = entry?.result ?? "MISSING";
    if (Object.hasOwn(counts, result)) counts[result] += 1;
    const reasons = blockers.get(check.id) ?? [];
    console.log(
      `${String(index + 1).padStart(2, "0")} ${check.id} ${check.priority} ${result}${reasons.length > 0 ? ` [${reasons.join(", ")}]` : ""}`,
    );
  }
  console.log(
    `Summary: ${counts.PASS}/28 PASS, ${counts.FAIL} FAIL, ${counts.NEEDS_VISUAL_REVIEW} NEEDS_VISUAL_REVIEW, ${counts.UNRUN} UNRUN`,
  );
  console.log(
    `Acceptance: ${report.valid && report.acceptanceBlockers.length === 0 ? "READY FOR FINAL VALIDATOR" : `BLOCKED (${report.acceptanceBlockers.length} blockers)`}`,
  );
  console.log(
    "Progress is record validation only; it does not execute recipes or approve visual quality.",
  );
  if (!report.valid) {
    for (const issue of report.issues)
      console.error(`${issue.code} ${issue.location}: ${issue.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
