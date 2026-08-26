import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CITY_PROFILE_IDS = ["desktop", "phone-portrait", "phone-landscape"];
const INPUT_PROFILE_IDS = ["phone-portrait", "phone-landscape"];
const LIVE_PROFILE_IDS = ["desktop", "phone-portrait"];
const MOTION_PROFILE_IDS = ["desktop", "phone-portrait"];
const MOTION_ACTOR_IDS = ["vanguard", "ranger", "arcanist"];
const MOTION_CAMERA_MODES = ["fixed", "follow"];
const MOTION_DIRECTION_IDS = [
  "move-north",
  "move-east",
  "move-south",
  "move-west",
];
const ACTOR_ATLAS_ACTOR_IDS = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];
const ACTOR_ATLAS_FACING_IDS = ["east", "west", "north", "south"];
const ACTOR_ATLAS_CLIP_IDS = [
  "idle",
  "walk",
  "attack",
  "ability",
  "hurt",
  "death",
];
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
const LIVE_FRAME_FILES = {
  desktop: [
    "frame-0000-selection-ranger-before.png",
    "frame-0001-selection-ranger-after.png",
    "frame-0002-ranger-gameplay.png",
    "frame-0003-selection-arcanist-before.png",
    "frame-0004-selection-arcanist-after.png",
    "frame-0005-arcanist-gameplay.png",
    "frame-0006-selection-vanguard-before.png",
    "frame-0007-selection-vanguard-after.png",
    "frame-0008-vanguard-gameplay.png",
    "frame-0009-attack-before.png",
    "frame-0010-attack-after.png",
    "frame-0011-ability-before.png",
    "frame-0012-ability-after.png",
    "frame-0013-tonic-before.png",
    "frame-0014-tonic-after.png",
  ],
  "phone-portrait": [
    "frame-0000-selection-ranger-before.png",
    "frame-0001-selection-ranger-after.png",
    "frame-0002-ranger-gameplay.png",
    "frame-0003-selection-arcanist-before.png",
    "frame-0004-selection-arcanist-after.png",
    "frame-0005-arcanist-gameplay.png",
    "frame-0006-selection-vanguard-before.png",
    "frame-0007-selection-vanguard-after.png",
    "frame-0008-vanguard-gameplay.png",
    "frame-0009-move-pad-before.png",
    "frame-0010-move-pad-after.png",
    "frame-0011-attack-before.png",
    "frame-0012-attack-after.png",
    "frame-0013-ability-before.png",
    "frame-0014-ability-after.png",
    "frame-0015-tonic-before.png",
    "frame-0016-tonic-after.png",
  ],
};

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

function liveArtifactSpecifications() {
  const root = "quality-results/production-liveness/pres-live-001";
  const specifications = [
    ["environment-metadata", `${root}/metadata.json`],
    ["semantic-snapshot-timeline", `${root}/liveness.json`],
    ["negative-control-evidence", `${root}/comparison.json`],
    ["production-control-route", `${root}/liveness.json`],
    ["recovery-frame-sequence", `${root}/recovery.json`],
  ];
  for (const profileId of LIVE_PROFILE_IDS) {
    specifications.push(
      ["production-control-route", `${root}/${profileId}/selection.json`],
      ["control-intent-registry", `${root}/${profileId}/control-census.json`],
      [
        "visible-control-census-to-intent-map",
        `${root}/${profileId}/control-census.json`,
      ],
      ["gesture-or-command-tape", `${root}/${profileId}/gesture-log.json`],
      ["semantic-snapshot-timeline", `${root}/${profileId}/states.json`],
      ["transition-deadline-contract", `${root}/${profileId}/states.json`],
      [
        "render-manifest-timeline",
        `${root}/${profileId}/render-manifest-timeline.json`,
      ],
      ["ordered-frame-sequence", `${root}/${profileId}/frames.json`],
      ["transition-deadline-contract", `${root}/${profileId}/selection.json`],
      [
        "production-control-route",
        `${root}/${profileId}/production-liveness.webm`,
      ],
    );
    for (const filename of LIVE_FRAME_FILES[profileId])
      specifications.push([
        "ordered-frame-sequence",
        `${root}/${profileId}/${filename}`,
      ]);
  }
  for (const filename of [
    "abort-failed.png",
    "abort-retry.png",
    "stall-failed.png",
    "stall-back.png",
  ])
    specifications.push([
      "recovery-frame-sequence",
      `${root}/recovery/${filename}`,
    ]);
  specifications.push(
    ["recovery-frame-sequence", `${root}/recovery/recovery.webm`],
    ["transition-deadline-contract", `${root}/recovery.json`],
  );
  return specifications;
}

function directionalMotionFrameFiles() {
  const files = [];
  let index = 0;
  const frame = (label) =>
    `frame-${String(index++).padStart(4, "0")}-${label}.png`;
  for (const actorId of MOTION_ACTOR_IDS)
    for (const cameraMode of MOTION_CAMERA_MODES) {
      files.push(frame(`${actorId}-${cameraMode}-initial`));
      for (const directionId of MOTION_DIRECTION_IDS) {
        files.push(
          frame(`${actorId}-${cameraMode}-${directionId}-before`),
          frame(`${actorId}-${cameraMode}-${directionId}-after`),
        );
      }
    }
  return files;
}

function directionalMotionArtifactSpecifications() {
  const root = "quality-results/directional-motion/pres-move-003";
  const specifications = [
    ["environment-metadata", `${root}/metadata.json`],
    ["cardinal-input-timeline", `${root}/movement.json`],
    ["world-screen-camera-anchors", `${root}/movement.json`],
    ["negative-control-evidence", `${root}/comparison.json`],
  ];
  for (const profileId of MOTION_PROFILE_IDS) {
    specifications.push(
      ["cardinal-input-timeline", `${root}/${profileId}/gesture-log.json`],
      ["world-screen-camera-anchors", `${root}/${profileId}/states.json`],
      [
        "world-screen-camera-anchors",
        `${root}/${profileId}/render-manifest-timeline.json`,
      ],
      ["walk-mask-contact-sheet", `${root}/${profileId}/contact-sheet.png`],
      [
        "walk-mask-contact-sheet",
        `${root}/${profileId}/directional-motion.webm`,
      ],
    );
    for (const filename of directionalMotionFrameFiles())
      specifications.push([
        "ordered-frame-sequence",
        `${root}/${profileId}/${filename}`,
      ]);
  }
  return specifications;
}

function actorAtlasArtifactSpecifications() {
  const root = "quality-results/actor-atlas-audit";
  const specifications = [
    ["environment-metadata", `${root}/metadata.json`],
    ["negative-control-evidence", `${root}/report.json`],
    ["atlas-catalog-hashes", `${root}/metadata.json`],
    ["all-bank-cell-masks", `${root}/report.json`],
    ["atlas-audit-report", `${root}/report.json`],
    ["canonical-character-layout-contract", `${root}/report.json`],
    ["clip-facing-cell-map", `${root}/report.json`],
    ["registry-completeness-report", `${root}/report.json`],
    ["production-decode-evidence", `${root}/report.json`],
    ["actor-atlas-audit-html", `${root}/index.html`],
  ];
  for (const actorId of ACTOR_ATLAS_ACTOR_IDS) {
    specifications.push(["actor-overview", `${root}/overviews/${actorId}.png`]);
    for (const facingId of ACTOR_ATLAS_FACING_IDS)
      for (const clipId of ACTOR_ATLAS_CLIP_IDS)
        specifications.push([
          "all-bank-cell-masks",
          `${root}/strips/${actorId}/${facingId}-${clipId}.png`,
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
  liveMetadata,
  liveComparison,
  movementMetadata,
  movementComparison,
  spriteMetadata,
  spriteComparison,
  commit,
  reproduce,
  cityArtifacts = cityArtifactSpecifications(),
  stateArtifacts = stateArtifactSpecifications(),
  inputArtifacts = inputArtifactSpecifications(),
  liveArtifacts = liveArtifactSpecifications(),
  movementArtifacts = directionalMotionArtifactSpecifications(),
  spriteArtifacts = actorAtlasArtifactSpecifications(),
}) {
  const cityCheck = contract.checks.find(({ id }) => id === "PRES-CITY-027");
  const stateCheck = contract.checks.find(({ id }) => id === "PRES-STATE-028");
  const inputCheck = contract.checks.find(({ id }) => id === "PRES-INPUT-002");
  const liveCheck = contract.checks.find(({ id }) => id === "PRES-LIVE-001");
  const movementCheck = contract.checks.find(
    ({ id }) => id === "PRES-MOVE-003",
  );
  const spriteCheck = contract.checks.find(
    ({ id }) => id === "PRES-SPRITE-004",
  );
  const cityRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-CITY-027",
  );
  const stateRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-STATE-028",
  );
  const inputRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-INPUT-002",
  );
  const liveRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-LIVE-001",
  );
  const movementRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-MOVE-003",
  );
  const spriteRecipe = recipes.recipes.find(
    ({ checkId }) => checkId === "PRES-SPRITE-004",
  );
  if (
    !cityCheck ||
    !stateCheck ||
    !inputCheck ||
    !liveCheck ||
    !cityRecipe ||
    !stateRecipe ||
    !inputRecipe ||
    !liveRecipe ||
    !movementCheck ||
    !movementRecipe ||
    !spriteCheck ||
    !spriteRecipe
  )
    throw new Error(
      "P0 live/city/state/input/movement/sprite contract recipes are incomplete",
    );

  const citySource = sourceCommit(cityMetadata, "PRES-CITY-027");
  const stateSource = sourceCommit(stateMetadata, "PRES-STATE-028");
  const inputSource = sourceCommit(inputMetadata, "PRES-INPUT-002");
  const liveSource = sourceCommit(liveMetadata, "PRES-LIVE-001");
  const movementSource = sourceCommit(movementMetadata, "PRES-MOVE-003");
  const spriteSource = sourceCommit(spriteMetadata, "PRES-SPRITE-004");
  if (
    citySource !== stateSource ||
    citySource !== inputSource ||
    citySource !== liveSource ||
    citySource !== movementSource ||
    citySource !== spriteSource ||
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
  const liveIndex = contract.checks.findIndex(
    ({ id }) => id === "PRES-LIVE-001",
  );
  const movementIndex = contract.checks.findIndex(
    ({ id }) => id === "PRES-MOVE-003",
  );
  const spriteIndex = contract.checks.findIndex(
    ({ id }) => id === "PRES-SPRITE-004",
  );
  const cityComparisonData = comparisonData(cityComparison, "PRES-CITY-027");
  const stateComparisonData = comparisonData(stateComparison, "PRES-STATE-028");
  const inputComparisonData = comparisonData(inputComparison, "PRES-INPUT-002");
  const liveComparisonData = comparisonData(liveComparison, "PRES-LIVE-001");
  const movementComparisonData = comparisonData(
    movementComparison,
    "PRES-MOVE-003",
  );
  const spriteComparisonData = comparisonData(
    spriteComparison,
    "PRES-SPRITE-004",
  );
  checks[liveIndex] = await bindRow({
    repoRoot,
    contractCheck: liveCheck,
    recipe: liveRecipe,
    metadata: liveMetadata,
    comparison: liveComparisonData,
    artifactSpecifications: liveArtifacts,
    result: "NEEDS_VISUAL_REVIEW",
    deviceProfileIds: liveMetadata.profileIds,
  });
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
  checks[movementIndex] = await bindRow({
    repoRoot,
    contractCheck: movementCheck,
    recipe: movementRecipe,
    metadata: movementMetadata,
    comparison: movementComparisonData,
    artifactSpecifications: movementArtifacts,
    result: "NEEDS_VISUAL_REVIEW",
    deviceProfileIds: movementMetadata.profileIds,
  });
  checks[spriteIndex] = await bindRow({
    repoRoot,
    contractCheck: spriteCheck,
    recipe: spriteRecipe,
    metadata: spriteMetadata,
    comparison: spriteComparisonData,
    artifactSpecifications: spriteArtifacts,
    result: "NEEDS_VISUAL_REVIEW",
    deviceProfileIds: spriteMetadata.profileIds,
  });
  return {
    ...structuredClone(template),
    runId,
    environment: { commit, reproduce },
    checks,
  };
}
