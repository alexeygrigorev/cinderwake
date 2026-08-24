import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TEMPLATE_PATH = "quality/presentation-run.v1.template.json";
const DEFAULT_REPRODUCTION =
  "npm run check && npm run test:e2e && npm run report:screens && npm run capture:matrix && npm run report:quality";
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

async function currentCommit(repoRoot) {
  const value = (
    await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
  if (!COMMIT.test(value))
    throw new Error(
      "git rev-parse HEAD did not return an exact 40-character commit",
    );
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = path.resolve(option(args, "--repo-root", process.cwd()));
  const runId = option(args, "--run-id");
  if (!runId)
    throw new Error(
      "Use --run-id <stable-id>; for example --run-id 2026-08-24-mobile-audit",
    );
  if (!RUN_ID.test(runId))
    throw new Error(
      "runId must begin with a letter or digit and contain only letters, digits, dot, underscore, or hyphen",
    );

  const outputOption = option(
    args,
    "--output",
    `quality-results/presentation-runs/${runId}.json`,
  );
  const outputPath = path.resolve(repoRoot, outputOption);
  const reproduce = option(args, "--reproduce", DEFAULT_REPRODUCTION);
  const template = JSON.parse(
    await fs.readFile(path.join(repoRoot, TEMPLATE_PATH), "utf8"),
  );
  const commit = await currentCommit(repoRoot);

  if (
    template.kind !== "PresentationRunV1" ||
    !Array.isArray(template.checks) ||
    template.checks.length !== 28 ||
    template.checks.some(({ result }) => result !== "UNRUN")
  )
    throw new Error(
      "canonical presentation-run template is not an ordered blank 28-row run",
    );

  template.runId = runId;
  template.environment = { commit, reproduce };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(`refusing to overwrite existing run: ${outputPath}`, {
        cause: error,
      });
    throw error;
  }

  console.log(`Initialized presentation run ${runId}`);
  console.log(`Path: ${outputPath}`);
  console.log(`Commit: ${commit}`);
  console.log("Rows: 28 UNRUN in canonical order");
  console.log(`Environment reproduction: ${reproduce}`);
  console.log(
    "This command initializes a record only; it does not execute recipes, evidence, mutations, or visual review.",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
