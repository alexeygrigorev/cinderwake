import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { bindPresentationRun } from "./lib/presentation-run-binding.mjs";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

function currentCommit(repoRoot) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("git rev-parse HEAD did not return an exact commit");
  return commit;
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = path.resolve(option(args, "--repo-root", process.cwd()));
  const runId = option(args, "--run-id");
  if (!runId || !RUN_ID.test(runId))
    throw new Error(
      "Use --run-id <stable-id>; runId must contain only letters, digits, dot, underscore, or hyphen",
    );
  const outputPath = path.resolve(
    repoRoot,
    option(args, "--output", `quality-results/presentation-runs/${runId}.json`),
  );
  const cityRoot = path.resolve(
    repoRoot,
    option(args, "--city-root", "quality-results/city-journey/pres-city-027"),
  );
  const stateRoot = path.resolve(
    repoRoot,
    option(args, "--state-root", "quality-results/state-replay/pres-state-028"),
  );
  const inputRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--input-root",
      "quality-results/input-intents/pres-input-002",
    ),
  );
  const [
    template,
    contract,
    recipes,
    cityMetadata,
    cityComparison,
    stateMetadata,
    stateComparison,
    inputMetadata,
    inputComparison,
  ] = await Promise.all([
    readJson(path.join(repoRoot, "quality/presentation-run.v1.template.json")),
    readJson(path.join(repoRoot, "quality/presentation-checklist.v1.json")),
    readJson(path.join(repoRoot, "quality/presentation-recipes.v1.json")),
    readJson(path.join(cityRoot, "metadata.json")),
    readJson(path.join(cityRoot, "comparison.json")),
    readJson(path.join(stateRoot, "metadata.json")),
    readJson(path.join(stateRoot, "comparison.json")),
    readJson(path.join(inputRoot, "metadata.json")),
    readJson(path.join(inputRoot, "comparison.json")),
  ]);
  const commit = currentCommit(repoRoot);
  const reproduce =
    option(args, "--reproduce") ??
    `npm run test:city-journey && npm run test:state-replay && npm run test:input-intents && npm run quality:presentation:bind -- --run-id ${runId}-reproduced`;
  const presentationRun = await bindPresentationRun({
    repoRoot,
    runId,
    template,
    contract,
    recipes,
    cityMetadata,
    cityComparison,
    stateMetadata,
    stateComparison,
    inputMetadata,
    inputComparison,
    commit,
    reproduce,
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.writeFile(
      outputPath,
      `${JSON.stringify(presentationRun, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(`refusing to overwrite existing run: ${outputPath}`, {
        cause: error,
      });
    throw error;
  }
  console.log(`Bound P0 presentation evidence into ${outputPath}`);
  console.log("PRES-STATE-028: PASS (machine evidence)");
  console.log("PRES-INPUT-002: NEEDS_VISUAL_REVIEW");
  console.log("PRES-CITY-027: NEEDS_VISUAL_REVIEW");
  console.log(
    "Remaining checklist rows remain UNRUN; acceptance is still blocked.",
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
