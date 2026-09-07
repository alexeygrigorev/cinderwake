import fs from "node:fs/promises";
import path from "node:path";
import {
  buildBundle,
  reviewPrompt,
  validateRegistry,
  validateReview,
} from "./lib/action-visual-review.mjs";

const args = process.argv.slice(2);
const command = args.shift();
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const root = process.cwd();
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const registry = validateRegistry(
  await read(option("registry", "quality/action-review.v1.json")),
);
const output = path.resolve(
  option("output", "quality-results/action-review/ranger"),
);

if (command === "lint") {
  console.log(
    `Action registry: ${registry.actions.length} actions; ${registry.reviewer.model} visual reviewer`,
  );
} else if (command === "build") {
  const evidenceDirectory = path.resolve(
    option(
      "directional-bank",
      "quality-results/directional-bank/pres-facing-015",
    ),
  );
  const scope = args.includes("--full")
    ? {}
    : {
        actors: option("actors", "ranger").split(","),
        actions: option("actions", "attack,ability").split(","),
        profiles: option("profiles", "desktop").split(","),
        directions: option("directions", "north,east,south,west").split(","),
      };
  let captures, sourceFingerprint;
  if (option("captures", null)) {
    ({ captures, sourceFingerprint } = await read(option("captures")));
  } else {
    const evidence = await read(path.join(evidenceDirectory, "evidence.json"));
    const metadata = await read(path.join(evidenceDirectory, "metadata.json"));
    const automatic = await read(
      path.join(evidenceDirectory, "comparison.json"),
    );
    sourceFingerprint = metadata.runtimeFingerprint;
    captures = evidence.profiles.flatMap((profile) =>
      profile.runs.flatMap((run) =>
        run.directions.flatMap((direction) =>
          ["attack", "ability"].map((action) => {
            const sequence =
              action === "attack" ? direction.action : direction.ability;
            return {
              id: `${run.actorId}/${action}/${direction.directionId.replace("move-", "")}/${profile.profileId}`,
              expectation: {
                intendedDirection: direction.directionId.replace("move-", ""),
                input: sequence.input,
                produced: sequence.produced,
                note: "Screen north is up, east right, south down, west left. Evaluate actual painted tips; direction metadata alone cannot establish them.",
              },
              automatic: {
                pass:
                  automatic.comparison.pass &&
                  automatic.negativeControls.every(
                    ({ status }) => status === "DETECTED",
                  ),
                evidence: path.relative(
                  root,
                  path.join(evidenceDirectory, "comparison.json"),
                ),
              },
              frames: [
                ["windup", sequence.after],
                ["impact", sequence.impact],
                ["recovery", sequence.recovery],
              ].map(([stage, frame]) => ({
                stage,
                tick: frame.tick,
                file: path.relative(
                  root,
                  path.join(
                    evidenceDirectory,
                    profile.profileId,
                    frame.frameFile,
                  ),
                ),
                sha256: frame.frameHash,
              })),
            };
          }),
        ),
      ),
    );
  }
  const bundle = await buildBundle({
    registry,
    scope,
    captures,
    sourceFingerprint,
    root,
  });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, "bundle.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(output, "reviewer-prompt.md"),
    reviewPrompt(bundle),
  );
  // Deliberately no fabricated review.json: only an image reviewer writes verdicts.
  console.log(
    `Prepared ${bundle.cases.length} cases for ${bundle.reviewer.model}: ${output}`,
  );
} else if (command === "validate") {
  const bundle = await read(path.join(output, "bundle.json"));
  const review = await read(option("review", path.join(output, "review.json")));
  const result = await validateReview({ bundle, review, registry, root });
  console.log(
    `SCOPED VISUAL PASS: ${result.cases} cases ${JSON.stringify(result.scope)}`,
  );
} else
  throw new Error(
    "Usage: node scripts/action-visual-review.mjs lint|build|validate [--registry file] [--output directory] [--captures generic.json] [--actors ranger] [--actions attack,ability] [--profiles desktop] [--directions north,east,south,west]",
  );
