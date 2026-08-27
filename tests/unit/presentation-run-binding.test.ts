import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  bindPresentationRun,
  visibleSpriteArtifactSpecifications,
} from "../../scripts/lib/presentation-run-binding.mjs";
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
  it("enumerates visible sprite artifacts under a configured root", async () => {
    const directory = await fs.mkdtemp(
      path.join(root, "quality-results/.presentation-binding-test-"),
    );
    temporaryDirectories.push(directory);
    const relativeRoot = path.relative(root, directory);
    await fs.mkdir(path.join(directory, "desktop"));
    await fs.writeFile(
      path.join(directory, "metadata.json"),
      JSON.stringify({ profileIds: ["desktop"] }),
    );
    await fs.writeFile(path.join(directory, "desktop", "states.json"), "{}\n");
    await fs.writeFile(path.join(directory, "desktop", "frame.png"), "png\n");

    const specifications = await visibleSpriteArtifactSpecifications(
      root,
      relativeRoot,
    );

    expect(specifications).toContainEqual([
      "environment-metadata",
      `${relativeRoot}/metadata.json`,
    ]);
    expect(specifications).toContainEqual([
      "semantic-snapshot-timeline",
      `${relativeRoot}/desktop/states.json`,
    ]);
    expect(specifications).toContainEqual([
      "ordered-frame-sequence",
      `${relativeRoot}/desktop/frame.png`,
    ]);
  });

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
    const inputRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-INPUT-002",
    );
    const mobileRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-MOBILE-010",
    );
    const liveRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-LIVE-001",
    );
    const flickerRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-FLICKER-024",
    );
    const crispnessRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-CRISP-006",
    );
    const movementRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-MOVE-003",
    );
    const facingRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-FACING-015",
    );
    const cameraRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-CAMERA-016",
    );
    const spriteRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-SPRITE-004",
    );
    const visibleSpriteRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-SPRITE-009",
    );
    const temporalRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-MOTION-005",
    );
    const depthRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-DEPTH-019",
    );
    const collisionRecipe = recipes.recipes.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-COLLIDE-008",
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
    const inputRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-INPUT-002",
      ).evidenceRequirements,
    ];
    const mobileRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-MOBILE-010",
      ).evidenceRequirements,
    ];
    const liveRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-LIVE-001",
      ).evidenceRequirements,
    ];
    const flickerRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-FLICKER-024",
      ).evidenceRequirements,
    ];
    const crispnessRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-CRISP-006",
      ).evidenceRequirements,
    ];
    const movementRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-MOVE-003",
      ).evidenceRequirements,
    ];
    const facingRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-FACING-015",
      ).evidenceRequirements,
    ];
    const cameraRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-CAMERA-016",
      ).evidenceRequirements,
    ];
    const spriteRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-SPRITE-004",
      ).evidenceRequirements,
    ];
    const visibleSpriteRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-SPRITE-009",
      ).evidenceRequirements,
    ];
    const temporalRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-MOTION-005",
      ).evidenceRequirements,
    ];
    const depthRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-DEPTH-019",
      ).evidenceRequirements,
    ];
    const collisionRequirements = [
      ...contract.artifactRequirements,
      ...contract.checks.find(
        ({ id }: { id: string }) => id === "PRES-COLLIDE-008",
      ).evidenceRequirements,
    ];
    const cityArtifacts = await artifactFixture(cityRequirements);
    const stateArtifacts = await artifactFixture(stateRequirements);
    const inputArtifacts = await artifactFixture(inputRequirements);
    const mobileArtifacts = await artifactFixture(mobileRequirements);
    const liveArtifacts = await artifactFixture(liveRequirements);
    const flickerArtifacts = await artifactFixture(flickerRequirements);
    const crispnessArtifacts = await artifactFixture(crispnessRequirements);
    const movementArtifacts = await artifactFixture(movementRequirements);
    const facingArtifacts = await artifactFixture(facingRequirements);
    const cameraArtifacts = await artifactFixture(cameraRequirements);
    const spriteArtifacts = await artifactFixture(spriteRequirements);
    const visibleSpriteArtifacts = await artifactFixture(
      visibleSpriteRequirements,
    );
    const temporalArtifacts = await artifactFixture(temporalRequirements);
    const depthArtifacts = await artifactFixture(depthRequirements);
    const collisionArtifacts = await artifactFixture(collisionRequirements);
    const commit = "a".repeat(40);
    const metadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait", "phone-landscape"],
    };
    const inputMetadata = {
      source: { commit, dirty: false },
      profileIds: ["phone-portrait", "phone-landscape"],
    };
    const mobileMetadata = {
      source: { commit, dirty: false },
      profileIds: ["phone-portrait", "phone-landscape"],
    };
    const liveMetadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait"],
    };
    const flickerMetadata = {
      source: { commit, dirty: false },
      scenarioIds: [
        "ordinary-live-idle-move-turn-attack",
        "effect-despawn",
        "effect-kind-corpus",
        "asset-state-transition",
      ],
      deviceProfileIds: ["desktop-60hz", "phone-portrait-rAF"],
      gestureIds: ["sustained-movement", "repeated-attacks"],
    };
    const crispnessMetadata = {
      source: { commit, dirty: false },
      scenarioIds: [
        "ordinary-production-launch",
        "animation-idle",
        "animation-walk",
      ],
      deviceProfileIds: ["desktop-dpr1", "phone-portrait-high-dpr"],
      gestureIds: ["begin", "move-east"],
    };
    const movementMetadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait"],
    };
    const facingMetadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait"],
      scenarioIds: facingRecipe.scenarioSet.requiredIds,
    };
    const cameraMetadata = {
      source: { commit, dirty: false },
      scenarioIds: [
        "temporal-camera-track",
        "map-edge-reversal",
        "camera-west-south-edge",
        "camera-diagonal-corner",
        "camera-stop-center",
        "fixed-camera-open-floor-arcanist",
        "snap-camera-open-floor-arcanist",
      ],
      profileIds: ["desktop", "phone-portrait"],
      gestureIds: [
        "approach-map-edge",
        "reverse-west",
        "reverse-east",
        "edge-west",
        "edge-south",
        "diagonal-north-west",
        "stop-after-diagonal",
        "stop-center",
        "fixed-travel",
        "snap-travel",
      ],
    };
    const spriteMetadata = {
      source: { commit, dirty: false },
      profileIds: ["runtime-atlas-native-resolution"],
    };
    const visibleSpriteMetadata = {
      source: { commit, dirty: false },
      scenarioIds: visibleSpriteRecipe.scenarioSet.requiredIds,
      profileIds: visibleSpriteRecipe.deviceProfileSet.requiredIds,
    };
    const temporalMetadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait"],
    };
    const depthMetadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait"],
    };
    const collisionMetadata = {
      source: { commit, dirty: false },
      profileIds: ["desktop", "phone-portrait"],
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
      inputMetadata,
      inputComparison: comparison(inputRecipe),
      mobileMetadata,
      mobileComparison: comparison(mobileRecipe),
      liveMetadata,
      liveComparison: comparison(liveRecipe),
      flickerMetadata,
      flickerComparison: comparison(flickerRecipe),
      crispnessMetadata,
      crispnessComparison: comparison(crispnessRecipe),
      movementMetadata,
      movementComparison: comparison(movementRecipe),
      facingMetadata,
      facingComparison: comparison(facingRecipe),
      cameraMetadata,
      cameraComparison: comparison(cameraRecipe),
      spriteMetadata,
      spriteComparison: comparison(spriteRecipe),
      visibleSpriteMetadata,
      visibleSpriteComparison: comparison(visibleSpriteRecipe),
      temporalMetadata,
      temporalComparison: comparison(temporalRecipe),
      depthMetadata,
      depthComparison: comparison(depthRecipe),
      collisionMetadata,
      collisionComparison: comparison(collisionRecipe),
      commit,
      reproduce:
        "npm run test:city-journey && npm run test:state-replay && npm run test:input-intents",
      cityArtifacts,
      stateArtifacts,
      inputArtifacts,
      mobileArtifacts,
      liveArtifacts,
      flickerArtifacts,
      crispnessArtifacts,
      movementArtifacts,
      facingArtifacts,
      cameraArtifacts,
      spriteArtifacts,
      visibleSpriteArtifacts,
      temporalArtifacts,
      depthArtifacts,
      collisionArtifacts,
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
    const input = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-INPUT-002",
    )!;
    const mobile = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-MOBILE-010",
    )!;
    const live = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-LIVE-001",
    )!;
    const flicker = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-FLICKER-024",
    )!;
    const crispness = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-CRISP-006",
    )!;
    const movement = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-MOVE-003",
    )!;
    const facing = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-FACING-015",
    )!;
    const camera = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-CAMERA-016",
    )!;
    const sprite = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-SPRITE-004",
    )!;
    const temporal = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-MOTION-005",
    )!;
    const depth = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-DEPTH-019",
    )!;
    const collision = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-COLLIDE-008",
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
    expect(input.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(input.signals).toHaveLength(
      inputRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      input.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(mobile.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(mobile.observed.deviceProfileIds).toEqual([
      "phone-portrait",
      "phone-landscape",
    ]);
    expect(mobile.signals).toHaveLength(
      mobileRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      mobile.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(live.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(live.observed.deviceProfileIds).toEqual([
      "desktop",
      "phone-portrait",
    ]);
    expect(live.signals).toHaveLength(
      liveRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      live.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(flicker.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(flicker.observed).toEqual({
      scenarioIds: flickerMetadata.scenarioIds,
      deviceProfileIds: flickerMetadata.deviceProfileIds,
      gestureIds: flickerMetadata.gestureIds,
    });
    expect(flicker.signals).toHaveLength(
      flickerRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      flicker.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(crispness.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(crispness.observed).toEqual({
      scenarioIds: crispnessMetadata.scenarioIds,
      deviceProfileIds: crispnessMetadata.deviceProfileIds,
      gestureIds: crispnessMetadata.gestureIds,
    });
    expect(crispness.signals).toHaveLength(
      crispnessRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      crispness.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(movement.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(movement.observed.deviceProfileIds).toEqual([
      "desktop",
      "phone-portrait",
    ]);
    expect(movement.signals).toHaveLength(
      movementRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      movement.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(facing.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(facing.observed).toEqual({
      scenarioIds: facingMetadata.scenarioIds,
      deviceProfileIds: facingMetadata.profileIds,
      gestureIds: [
        "move-north",
        "move-east",
        "move-south",
        "move-west",
        "attack-each-facing",
        "ability-each-facing",
      ],
    });
    expect(facing.signals).toHaveLength(
      facingRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      facing.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(camera.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(camera.observed).toEqual({
      scenarioIds: cameraMetadata.scenarioIds,
      deviceProfileIds: cameraMetadata.profileIds,
      gestureIds: cameraMetadata.gestureIds,
    });
    expect(camera.signals).toHaveLength(
      cameraRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      camera.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(sprite.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(sprite.observed.deviceProfileIds).toEqual([
      "runtime-atlas-native-resolution",
    ]);
    expect(sprite.signals).toHaveLength(
      spriteRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      sprite.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    const visibleSprite = run.checks.find(
      ({ checkId }: { checkId: string }) => checkId === "PRES-SPRITE-009",
    )!;
    expect(visibleSprite.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(visibleSprite.observed).toEqual({
      scenarioIds: visibleSpriteMetadata.scenarioIds,
      deviceProfileIds: visibleSpriteMetadata.profileIds,
      gestureIds: ["select", "begin", "trigger-outcome"],
    });
    expect(visibleSprite.signals).toHaveLength(
      visibleSpriteRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      visibleSprite.negativeControls.every(
        ({ status }) => status === "DETECTED",
      ),
    ).toBe(true);
    expect(temporal.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(temporal.observed.deviceProfileIds).toEqual([
      "desktop",
      "phone-portrait",
    ]);
    expect(temporal.signals).toHaveLength(
      temporalRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      temporal.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(depth.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(depth.observed.deviceProfileIds).toEqual([
      "desktop",
      "phone-portrait",
    ]);
    expect(depth.signals).toHaveLength(
      depthRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      depth.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
    expect(collision.result).toBe("NEEDS_VISUAL_REVIEW");
    expect(collision.observed.deviceProfileIds).toEqual([
      "desktop",
      "phone-portrait",
    ]);
    expect(collision.signals).toHaveLength(
      collisionRecipe.evaluator.requiredSignalIds.length,
    );
    expect(
      collision.negativeControls.every(({ status }) => status === "DETECTED"),
    ).toBe(true);
  });
});
