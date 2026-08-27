import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  bindPresentationRun,
  cameraMotionArtifactSpecifications,
  flickerArtifactSpecifications,
  renderResolutionArtifactSpecifications,
} from "./lib/presentation-run-binding.mjs";

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
  const mobileRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--mobile-root",
      "quality-results/mobile-screen/pres-mobile-010",
    ),
  );
  const liveRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--live-root",
      "quality-results/production-liveness/pres-live-001",
    ),
  );
  const flickerRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--flicker-root",
      "quality-results/compositor/pres-flicker-024",
    ),
  );
  const crispnessRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--crispness-root",
      "quality-results/render-resolution/pres-crisp-006",
    ),
  );
  const movementRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--movement-root",
      "quality-results/directional-motion/pres-move-003",
    ),
  );
  const cameraRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--camera-root",
      "quality-results/camera-motion/pres-camera-016",
    ),
  );
  const spriteRoot = path.resolve(
    repoRoot,
    option(args, "--sprite-root", "quality-results/actor-atlas-audit"),
  );
  const temporalRoot = path.resolve(
    repoRoot,
    option(args, "--temporal-root", "quality-results/temporal-sequence-audit"),
  );
  const depthRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--depth-root",
      "quality-results/depth-transition/pres-depth-019",
    ),
  );
  const collisionRoot = path.resolve(
    repoRoot,
    option(
      args,
      "--collision-root",
      "quality-results/collision/pres-collide-008",
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
    mobileMetadata,
    mobileComparison,
    liveMetadata,
    liveComparison,
    flickerMetadata,
    flickerComparison,
    crispnessMetadata,
    crispnessComparison,
    movementMetadata,
    movementComparison,
    cameraMetadata,
    cameraComparison,
    spriteMetadata,
    spriteComparison,
    temporalMetadata,
    temporalComparison,
    depthMetadata,
    depthComparison,
    collisionMetadata,
    collisionComparison,
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
    readJson(path.join(mobileRoot, "metadata.json")),
    readJson(path.join(mobileRoot, "comparison.json")),
    readJson(path.join(liveRoot, "metadata.json")),
    readJson(path.join(liveRoot, "comparison.json")),
    readJson(path.join(flickerRoot, "metadata.json")),
    readJson(path.join(flickerRoot, "comparison.json")),
    readJson(path.join(crispnessRoot, "metadata.json")),
    readJson(path.join(crispnessRoot, "comparison.json")),
    readJson(path.join(movementRoot, "metadata.json")),
    readJson(path.join(movementRoot, "comparison.json")),
    readJson(path.join(cameraRoot, "metadata.json")),
    readJson(path.join(cameraRoot, "comparison.json")),
    readJson(path.join(spriteRoot, "metadata.json")),
    readJson(path.join(spriteRoot, "report.json")),
    readJson(path.join(temporalRoot, "metadata.json")),
    readJson(path.join(temporalRoot, "comparison.json")),
    readJson(path.join(depthRoot, "metadata.json")),
    readJson(path.join(depthRoot, "comparison.json")),
    readJson(path.join(collisionRoot, "metadata.json")),
    readJson(path.join(collisionRoot, "comparison.json")),
  ]);
  const commit = currentCommit(repoRoot);
  const reproduce =
    option(args, "--reproduce") ??
    `npm run art:animation:check && npm run test:flicker && npm run capture:matrix && npm run quality:temporal:check && npm run test:city-journey && npm run test:state-replay && npm run test:input-intents && npm run test:directional-motion && npm run test:camera-motion && npm run test:production-liveness && npm run test:mobile-screen && npm run test:depth-transition && npm run test:collision && npm run test:crispness && npm run quality:presentation:bind -- --run-id ${runId}-reproduced`;
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
    mobileMetadata,
    mobileComparison,
    liveMetadata,
    liveComparison,
    flickerMetadata,
    flickerComparison,
    crispnessMetadata,
    crispnessComparison,
    movementMetadata,
    movementComparison,
    cameraMetadata,
    cameraComparison,
    spriteMetadata,
    spriteComparison,
    temporalMetadata,
    temporalComparison,
    depthMetadata,
    depthComparison,
    collisionMetadata,
    collisionComparison,
    flickerArtifacts: await flickerArtifactSpecifications(repoRoot),
    crispnessArtifacts: await renderResolutionArtifactSpecifications(repoRoot),
    cameraArtifacts: cameraMotionArtifactSpecifications(
      path.relative(repoRoot, cameraRoot),
    ),
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
  console.log(`Bound presentation evidence into ${outputPath}`);
  console.log("PRES-STATE-028: PASS (machine evidence)");
  console.log("PRES-INPUT-002: NEEDS_VISUAL_REVIEW");
  console.log("PRES-MOBILE-010: NEEDS_VISUAL_REVIEW");
  console.log("PRES-MOVE-003: NEEDS_VISUAL_REVIEW");
  console.log("PRES-CAMERA-016: NEEDS_VISUAL_REVIEW");
  console.log("PRES-SPRITE-004: NEEDS_VISUAL_REVIEW");
  console.log("PRES-MOTION-005: NEEDS_VISUAL_REVIEW");
  console.log("PRES-DEPTH-019: NEEDS_VISUAL_REVIEW");
  console.log("PRES-COLLIDE-008: NEEDS_VISUAL_REVIEW");
  console.log("PRES-FLICKER-024: NEEDS_VISUAL_REVIEW");
  console.log("PRES-CRISP-006: NEEDS_VISUAL_REVIEW");
  console.log("PRES-LIVE-001: NEEDS_VISUAL_REVIEW");
  console.log("PRES-CITY-027: NEEDS_VISUAL_REVIEW");
  console.log(
    "Remaining checklist rows remain UNRUN; acceptance is still blocked.",
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
