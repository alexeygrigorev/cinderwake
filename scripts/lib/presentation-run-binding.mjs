import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CITY_PROFILE_IDS = ["desktop", "phone-portrait", "phone-landscape"];
const INPUT_PROFILE_IDS = ["phone-portrait", "phone-landscape"];
const CITY_FRAME_FILES = [
  "frame-0000-ordinary-wilderness.png",
  "frame-0001-ordinary-city-discovered.png",
  "frame-0002-ordinary-city-entered.png",
  "frame-0003-wilderness.png",
  "frame-0004-city-discovered.png",
  "frame-0005-city-entered.png",
  "frame-0006-merchant:buy-tonic-before.png",
  "frame-0007-merchant:buy-tonic-after.png",
  "frame-0008-merchant:sell-ashfang-pelt-before.png",
  "frame-0009-merchant:sell-ashfang-pelt-after.png",
  "frame-0010-tavern:eat-stew-before.png",
  "frame-0011-tavern:eat-stew-after.png",
  "frame-0012-healer:restore-health-before.png",
  "frame-0013-healer:restore-health-after.png",
  "frame-0014-inn:sleep-until-dawn-before.png",
  "frame-0015-inn:sleep-until-dawn-after.png",
];
const INPUT_FRAME_FILES = [
  "frame-0000-initial.png",
  "frame-0001-tap-open-ground-before.png",
  "frame-0002-tap-open-ground-after.png",
  "frame-0003-joystick-north-before.png",
  "frame-0004-joystick-north-after.png",
  "frame-0005-joystick-east-before.png",
  "frame-0006-joystick-east-after.png",
  "frame-0007-joystick-south-before.png",
  "frame-0008-joystick-south-after.png",
  "frame-0009-joystick-west-before.png",
  "frame-0010-joystick-west-after.png",
  "frame-0011-tap-strike-before.png",
  "frame-0012-tap-strike-after.png",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function artifact(repoRoot, requirement, relativePath) {
  const candidate = path.resolve(repoRoot, relativePath);
  const bytes = await fs.readFile(candidate);
  return { requirement, path: relativePath, sha256: sha256(bytes) };
}

async function artifacts(repoRoot, specifications) {
  return Promise.all(
    specifications.map(([requirement, relativePath]) =>
      artifact(repoRoot, requirement, relativePath),
    ),
  );
}

function addProfileFiles(specifications, requirement, filename, profileIds) {
  const filenames = Array.isArray(filename) ? filename : [filename];
  for (const profileId of profileIds)
    for (const currentFilename of filenames)
      specifications.push([
        requirement,
        `quality-results/city-journey/pres-city-027/${profileId}/${currentFilename}`,
      ]);
}

function cityArtifactSpecifications() {
  const specifications = [
    [
      "environment-metadata",
      "quality-results/city-journey/pres-city-027/metadata.json",
    ],
    [
      "semantic-snapshot-timeline",
      "quality-results/city-journey/pres-city-027/journey.json",
    ],
    [
      "negative-control-evidence",
      "quality-results/city-journey/pres-city-027/comparison.json",
    ],
    [
      "production-city-journey-timeline",
      "quality-results/city-journey/pres-city-027/journey.json",
    ],
    [
      "gate-and-service-affordance-frames",
      "quality-results/city-journey/pres-city-027/journey.json",
    ],
    [
      "service-intent-state-deltas",
      "quality-results/city-journey/pres-city-027/desktop/service-deltas.json",
    ],
  ];
  addProfileFiles(
    specifications,
    "gesture-or-command-tape",
    "gesture-log.json",
    CITY_PROFILE_IDS,
  );
  addProfileFiles(
    specifications,
    "render-manifest-timeline",
    "render-manifest-timeline.json",
    CITY_PROFILE_IDS,
  );
  addProfileFiles(
    specifications,
    "ordered-frame-sequence",
    "states.json",
    CITY_PROFILE_IDS,
  );
  addProfileFiles(
    specifications,
    "gate-and-service-affordance-frames",
    "ordinary-route.json",
    CITY_PROFILE_IDS,
  );
  addProfileFiles(
    specifications,
    "service-intent-state-deltas",
    "service-deltas.json",
    CITY_PROFILE_IDS,
  );
  addProfileFiles(
    specifications,
    "ordered-frame-sequence",
    CITY_FRAME_FILES,
    CITY_PROFILE_IDS,
  );
  for (const profileId of ["phone-portrait", "phone-landscape"])
    specifications.push([
      "mobile-city-journey-video",
      `quality-results/city-journey/pres-city-027/${profileId}/city-journey.webm`,
    ]);
  return specifications;
}

function stateArtifactSpecifications() {
  const specifications = [
    [
      "environment-metadata",
      "quality-results/state-replay/pres-state-028/metadata.json",
    ],
    [
      "semantic-snapshot-timeline",
      "quality-results/state-replay/pres-state-028/initial-state.json",
    ],
    [
      "semantic-snapshot-timeline",
      "quality-results/state-replay/pres-state-028/replay-a/states.json",
    ],
    [
      "semantic-snapshot-timeline",
      "quality-results/state-replay/pres-state-028/replay-b/states.json",
    ],
    [
      "gesture-or-command-tape",
      "quality-results/state-replay/pres-state-028/commands.json",
    ],
    [
      "render-manifest-timeline",
      "quality-results/state-replay/pres-state-028/replay-a/render-manifest-timeline.json",
    ],
    [
      "render-manifest-timeline",
      "quality-results/state-replay/pres-state-028/replay-b/render-manifest-timeline.json",
    ],
    [
      "ordered-frame-sequence",
      "quality-results/state-replay/pres-state-028/loaded-state.png",
    ],
    [
      "ordered-frame-sequence",
      "quality-results/state-replay/pres-state-028/reset-state.png",
    ],
    [
      "negative-control-evidence",
      "quality-results/state-replay/pres-state-028/comparison.json",
    ],
    [
      "serialized-initial-state",
      "quality-results/state-replay/pres-state-028/initial-state.json",
    ],
    [
      "reset-isolation-record",
      "quality-results/state-replay/pres-state-028/load-reset.json",
    ],
    [
      "replay-state-hash-timeline",
      "quality-results/state-replay/pres-state-028/replay-a/states.json",
    ],
    [
      "replay-state-hash-timeline",
      "quality-results/state-replay/pres-state-028/replay-b/states.json",
    ],
    [
      "synchronized-manifest-frame-hashes",
      "quality-results/state-replay/pres-state-028/replay-a/render-manifest-timeline.json",
    ],
    [
      "synchronized-manifest-frame-hashes",
      "quality-results/state-replay/pres-state-028/replay-b/render-manifest-timeline.json",
    ],
  ];
  for (const replay of ["replay-a", "replay-b"])
    for (let index = 0; index < 5; index += 1)
      specifications.push([
        "ordered-frame-sequence",
        `quality-results/state-replay/pres-state-028/${replay}/frame-${String(index).padStart(4, "0")}.png`,
      ]);
  return specifications;
}

function inputArtifactSpecifications() {
  const specifications = [
    [
      "environment-metadata",
      "quality-results/input-intents/pres-input-002/metadata.json",
    ],
    [
      "semantic-snapshot-timeline",
      "quality-results/input-intents/pres-input-002/input-intents.json",
    ],
    [
      "gesture-or-command-tape",
      "quality-results/input-intents/pres-input-002/input-intents.json",
    ],
    [
      "negative-control-evidence",
      "quality-results/input-intents/pres-input-002/comparison.json",
    ],
    [
      "mobile-gesture-log",
      "quality-results/input-intents/pres-input-002/input-intents.json",
    ],
    [
      "intent-state-deltas",
      "quality-results/input-intents/pres-input-002/input-intents.json",
    ],
    [
      "pressed-control-frames",
      "quality-results/input-intents/pres-input-002/input-intents.json",
    ],
  ];
  for (const profileId of INPUT_PROFILE_IDS) {
    for (const filename of [
      "gesture-log.json",
      "states.json",
      "render-manifest-timeline.json",
    ])
      specifications.push([
        filename === "gesture-log.json"
          ? "mobile-gesture-log"
          : filename === "states.json"
            ? "intent-state-deltas"
            : "render-manifest-timeline",
        `quality-results/input-intents/pres-input-002/${profileId}/${filename}`,
      ]);
    for (const filename of INPUT_FRAME_FILES)
      specifications.push([
        "ordered-frame-sequence",
        `quality-results/input-intents/pres-input-002/${profileId}/${filename}`,
      ]);
    specifications.push([
      "pressed-control-frames",
      `quality-results/input-intents/pres-input-002/${profileId}/input-intents.webm`,
    ]);
  }
  return specifications;
}

function sourceCommit(metadata, name) {
  const commit = metadata?.source?.commit;
  if (
    typeof commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    metadata.source.dirty !== false
  )
    throw new Error(`${name} evidence must be a clean exact-commit bundle`);
  return commit;
}

function comparisonData(value, name) {
  const comparison = value?.comparison;
  if (!isObject(comparison) || comparison.pass !== true)
    throw new Error(`${name} evaluator did not pass`);
  if (
    !Array.isArray(value.negativeControls) ||
    value.negativeControls.some(({ status }) => status !== "DETECTED")
  )
    throw new Error(`${name} evaluator did not detect every negative control`);
  return value;
}

function signalEvidence(recipe, comparison) {
  const actualSignals = new Map(
    comparison.comparison.signals.map((signal) => [signal.id, signal]),
  );
  return recipe.evaluator.requiredSignalIds.map((id) => {
    const actual = actualSignals.get(id);
    if (!actual) throw new Error(`Missing evaluator signal ${id}`);
    return {
      id,
      actual: { pass: actual.pass, detail: actual.detail ?? {} },
      contract: { expected: true },
    };
  });
}

function controls(recipe, comparison, negativeControlArtifact) {
  const actualControls = new Map(
    comparison.negativeControls.map((control) => [control.id, control]),
  );
  return recipe.negativeControls.map(({ id, expectedSignal }) => {
    const actual = actualControls.get(id);
    if (!actual || actual.status !== "DETECTED")
      throw new Error(`Missing detected negative control ${id}`);
    if (actual.signal !== expectedSignal)
      throw new Error(`Negative control ${id} reported ${actual.signal}`);
    return {
      id,
      status: "DETECTED",
      signal: actual.signal,
      artifacts: [negativeControlArtifact],
    };
  });
}

async function rowArtifacts(repoRoot, specifications) {
  const values = await artifacts(repoRoot, specifications);
  const negativeControlArtifact = values.find(
    ({ requirement }) => requirement === "negative-control-evidence",
  );
  if (!negativeControlArtifact)
    throw new Error("Row has no negative-control evidence artifact");
  return { values, negativeControlArtifact };
}

async function bindRow({
  repoRoot,
  contractCheck,
  recipe,
  metadata,
  comparison,
  artifactSpecifications,
  result,
  deviceProfileIds,
}) {
  const { values, negativeControlArtifact } = await rowArtifacts(
    repoRoot,
    artifactSpecifications,
  );
  sourceCommit(metadata, contractCheck.id);
  return {
    checkId: contractCheck.id,
    executionRecipeId: recipe.id,
    result,
    coverageAtRun: contractCheck.coverage,
    observed: {
      scenarioIds: [...recipe.scenarioSet.requiredIds],
      deviceProfileIds,
      gestureIds: [...recipe.gestureSet.requiredIds],
    },
    firstFailingTick: null,
    signals: signalEvidence(recipe, comparison),
    artifacts: values,
    negativeControls: controls(recipe, comparison, negativeControlArtifact),
    visualReview: {
      mandatory: contractCheck.mandatoryReview,
      verdict: "NOT_RUN",
      reviewerId: "",
      reasons: [],
      reviewedArtifactHashes: [],
    },
    reproduce: recipe.reproduce,
  };
}

export async function bindPresentationRun({
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
  cityArtifacts = cityArtifactSpecifications(),
  stateArtifacts = stateArtifactSpecifications(),
  inputArtifacts = inputArtifactSpecifications(),
}) {
  const cityCheck = contract.checks.find(({ id }) => id === "PRES-CITY-027");
  const stateCheck = contract.checks.find(({ id }) => id === "PRES-STATE-028");
  const inputCheck = contract.checks.find(({ id }) => id === "PRES-INPUT-002");
  const cityRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-CITY-027",
  );
  const stateRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-STATE-028",
  );
  const inputRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-INPUT-002",
  );
  if (
    !cityCheck ||
    !stateCheck ||
    !inputCheck ||
    !cityRecipe ||
    !stateRecipe ||
    !inputRecipe
  )
    throw new Error("P0 city/state/input contract recipes are incomplete");

  const citySource = sourceCommit(cityMetadata, "PRES-CITY-027");
  const stateSource = sourceCommit(stateMetadata, "PRES-STATE-028");
  const inputSource = sourceCommit(inputMetadata, "PRES-INPUT-002");
  if (
    citySource !== stateSource ||
    citySource !== inputSource ||
    citySource !== commit
  )
    throw new Error("P0 evidence bundles do not bind to the current commit");

  const checks = structuredClone(template.checks);
  const cityIndex = contract.checks.findIndex(
    ({ id }) => id === "PRES-CITY-027",
  );
  const stateIndex = contract.checks.findIndex(
    ({ id }) => id === "PRES-STATE-028",
  );
  const inputIndex = contract.checks.findIndex(
    ({ id }) => id === "PRES-INPUT-002",
  );
  const cityComparisonData = comparisonData(cityComparison, "PRES-CITY-027");
  const stateComparisonData = comparisonData(stateComparison, "PRES-STATE-028");
  const inputComparisonData = comparisonData(inputComparison, "PRES-INPUT-002");
  checks[cityIndex] = await bindRow({
    repoRoot,
    contractCheck: cityCheck,
    recipe: cityRecipe,
    metadata: cityMetadata,
    comparison: cityComparisonData,
    artifactSpecifications: cityArtifacts,
    result: "NEEDS_VISUAL_REVIEW",
    deviceProfileIds: cityMetadata.profileIds,
  });
  checks[stateIndex] = await bindRow({
    repoRoot,
    contractCheck: stateCheck,
    recipe: stateRecipe,
    metadata: stateMetadata,
    comparison: stateComparisonData,
    artifactSpecifications: stateArtifacts,
    result: "PASS",
    deviceProfileIds: ["deterministic-960x540"],
  });
  checks[inputIndex] = await bindRow({
    repoRoot,
    contractCheck: inputCheck,
    recipe: inputRecipe,
    metadata: inputMetadata,
    comparison: inputComparisonData,
    artifactSpecifications: inputArtifacts,
    result: "NEEDS_VISUAL_REVIEW",
    deviceProfileIds: inputMetadata.profileIds,
  });
  return {
    ...structuredClone(template),
    runId,
    environment: { commit, reproduce },
    checks,
  };
}
