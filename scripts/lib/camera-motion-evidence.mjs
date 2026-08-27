export const CAMERA_MOTION_SCENARIO_IDS = {
  edgeReversal: "map-edge-reversal",
  diagonalCorner: "camera-diagonal-corner",
  stopCenter: "camera-stop-center",
  fixed: "fixed-camera-open-floor-arcanist",
  snap: "snap-camera-open-floor-arcanist",
};

export const CAMERA_MOTION_PROFILE_IDS = ["desktop", "phone-portrait"];

export const CAMERA_MOTION_GESTURE_IDS = [
  "approach-map-edge",
  "reverse-west",
  "reverse-east",
  "diagonal-north-west",
  "stop-after-diagonal",
  "stop-center",
  "fixed-travel",
  "snap-travel",
];

export const CAMERA_MOTION_RUN_SPECS = [
  {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.edgeReversal,
    cameraMode: "smooth",
    artifactPrefix: "edge",
    boundaryRequired: true,
    gestureIds: ["approach-map-edge", "reverse-west", "reverse-east"],
  },
  {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.diagonalCorner,
    cameraMode: "smooth",
    artifactPrefix: "diagonal-corner",
    boundaryRequired: true,
    gestureIds: ["diagonal-north-west", "stop-after-diagonal"],
  },
  {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.stopCenter,
    cameraMode: "smooth",
    artifactPrefix: "stop-center",
    boundaryRequired: false,
    gestureIds: ["stop-center"],
  },
  {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.fixed,
    cameraMode: "fixed",
    artifactPrefix: "fixed",
    boundaryRequired: false,
    gestureIds: ["fixed-travel"],
  },
  {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.snap,
    cameraMode: "snap",
    artifactPrefix: "snap",
    boundaryRequired: false,
    gestureIds: ["snap-travel"],
  },
];

export const CAMERA_MOTION_SIGNAL_IDS = [
  "camera-converges",
  "camera-clamps",
  "camera-delta-continuous",
  "camera-mode-contract",
];

export const CAMERA_MOTION_FAILURE_IDS = [
  "camera-speed-doubled",
  "camera-snap-detected",
  "camera-overshoot-detected",
  "camera-clamp-mismatch",
  "camera-axis-jitter",
  "camera-evidence-desynchronized",
  "camera-mode-contract",
];

const CAMERA_DEAD_ZONE_PIXELS = 56;
const CAMERA_FINAL_DEAD_ZONE_EXCESS = 2;
const CAMERA_MAX_STEP_PER_TICK = 80;
const EPSILON = 0.001;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteCamera(value) {
  return (
    isObject(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.zoom) &&
    value.zoom > 0
  );
}

function cameraFromCapture(capture) {
  const camera = capture?.manifest?.camera;
  return finiteCamera(camera) ? camera : null;
}

function targetFromCapture(capture) {
  const target = capture?.manifest?.cameraTarget;
  return finiteCamera(target) ? target : null;
}

function cameraFromSample(sample) {
  return finiteCamera(sample?.camera) ? sample.camera : null;
}

function targetFromSample(sample) {
  return finiteCamera(sample?.cameraTarget) ? sample.cameraTarget : null;
}

function captureSynchronized(capture) {
  return Boolean(
    capture &&
    Number.isInteger(capture.tick) &&
    capture.tick === capture.stateTick &&
    capture.tick === capture.manifestTick &&
    typeof capture.stateHash === "string" &&
    capture.stateHash.length > 0 &&
    typeof capture.manifestHash === "string" &&
    capture.manifestHash.length > 0 &&
    typeof capture.frameHash === "string" &&
    capture.frameHash.length > 0 &&
    ["fixed", "snap", "smooth"].includes(capture.manifest?.cameraMode) &&
    cameraFromCapture(capture) &&
    targetFromCapture(capture),
  );
}

function sampleSynchronized(sample, expectedMode) {
  return Boolean(
    sample &&
    Number.isInteger(sample.tick) &&
    Number.isFinite(sample.presentationTick) &&
    cameraFromSample(sample) &&
    targetFromSample(sample) &&
    ["fixed", "snap", "smooth"].includes(sample.cameraMode) &&
    (!expectedMode || sample.cameraMode === expectedMode),
  );
}

function cameraError(camera, target) {
  return Math.max(Math.abs(camera.x - target.x), Math.abs(camera.y - target.y));
}

function deadZone(target) {
  return CAMERA_DEAD_ZONE_PIXELS / target.zoom;
}

function deadZoneExcess(camera, target) {
  return Math.max(0, cameraError(camera, target) - deadZone(target));
}

function endpointObservation(gesture) {
  const camera = cameraFromCapture(gesture?.after);
  const target = targetFromCapture(gesture?.after);
  return {
    camera,
    target,
    deadZone: target ? deadZone(target) : null,
    excess: camera && target ? deadZoneExcess(camera, target) : Infinity,
    pass:
      camera !== null &&
      target !== null &&
      deadZoneExcess(camera, target) <= CAMERA_FINAL_DEAD_ZONE_EXCESS,
  };
}

function boundsFor(run) {
  const bounds = run?.cameraBounds;
  return isObject(bounds) &&
    ["minX", "maxX", "minY", "maxY"].every((key) =>
      Number.isFinite(bounds[key]),
    ) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY
    ? bounds
    : null;
}

function insideBounds(camera, bounds) {
  return Boolean(
    camera &&
    bounds &&
    camera.x >= bounds.minX - EPSILON &&
    camera.x <= bounds.maxX + EPSILON &&
    camera.y >= bounds.minY - EPSILON &&
    camera.y <= bounds.maxY + EPSILON,
  );
}

function boundaryTouch(value, minimum, maximum) {
  return (
    Math.abs(value - minimum) <= EPSILON || Math.abs(value - maximum) <= EPSILON
  );
}

function runEntries(run) {
  const entries = [];
  if (run?.initial?.capture) entries.push(run.initial.capture);
  for (const gesture of run?.gestures ?? []) {
    if (gesture.before) entries.push(gesture.before);
    if (gesture.after) entries.push(gesture.after);
  }
  return entries;
}

function runSamples(run) {
  return (run?.gestures ?? []).flatMap((gesture) => gesture.samples ?? []);
}

function gestureMap(run) {
  return new Map((run?.gestures ?? []).map((gesture) => [gesture.id, gesture]));
}

function runBasicsPass(run, expectedScenarioId, expectedMode) {
  return Boolean(
    run &&
    run.scenarioId === expectedScenarioId &&
    run.cameraMode === expectedMode &&
    run.initial?.bridgeExposed === false &&
    run.initial?.mode === "observe-only" &&
    captureSynchronized(run.initial?.capture),
  );
}

function runTimelinePass(run, expectedMode, requiredGestureIds) {
  const gestures = gestureMap(run);
  return Boolean(
    Array.isArray(run?.timeline) &&
    run.timeline.length > 0 &&
    run.timeline.every((capture) => captureSynchronized(capture)) &&
    requiredGestureIds.every((id) => gestures.has(id)) &&
    (run.gestures ?? []).every(
      (gesture) =>
        captureSynchronized(gesture.before) &&
        captureSynchronized(gesture.after) &&
        Array.isArray(gesture.samples) &&
        gesture.samples.length > 0 &&
        gesture.samples.every((sample) =>
          sampleSynchronized(sample, expectedMode),
        ),
    ),
  );
}

function allRuns(profiles, requiredProfiles, requiredRunSpecs) {
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const runs = [];
  for (const profile of selectedProfiles)
    for (const run of profile?.runs ?? []) runs.push({ profile, run });
  const expected = [];
  for (const profileId of requiredProfiles)
    for (const spec of requiredRunSpecs) expected.push({ profileId, ...spec });
  return { profileMap, selectedProfiles, runs, expected };
}

function convergenceObservation(run, requiredGestureIds, expectedMode) {
  const gestures = gestureMap(run);
  const details = requiredGestureIds.map((id) => {
    const gesture = gestures.get(id);
    const endpoint = endpointObservation(gesture);
    return {
      id,
      sampleCount: gesture?.samples?.length ?? 0,
      ...endpoint,
    };
  });
  return {
    gestures: details,
    pass:
      expectedMode !== "smooth" ||
      (details.length > 0 &&
        details.every(({ pass: endpointPass }) => endpointPass)),
  };
}

function cameraEqual(first, second) {
  return Boolean(
    first &&
    second &&
    Math.abs(first.x - second.x) <= EPSILON &&
    Math.abs(first.y - second.y) <= EPSILON &&
    Math.abs(first.zoom - second.zoom) <= EPSILON,
  );
}

function modeObservation(run, expectedMode) {
  const captures = runEntries(run);
  const samples = runSamples(run);
  const captureModes = captures.map((capture) => capture.manifest?.cameraMode);
  const sampleModes = samples.map((sample) => sample.cameraMode);
  const modesMatch =
    captures.length > 0 &&
    samples.length > 0 &&
    [...captureModes, ...sampleModes].every((mode) => mode === expectedMode);
  const cameras = [
    ...captures.map(cameraFromCapture),
    ...samples.map(cameraFromSample),
  ];
  const targets = [
    ...captures.map(targetFromCapture),
    ...samples.map(targetFromSample),
  ];
  const fixedCamera =
    expectedMode !== "fixed" ||
    (cameras.length > 0 &&
      cameras.every((camera) => cameraEqual(camera, cameras[0])));
  const snappedCamera =
    expectedMode !== "snap" ||
    (cameras.length > 0 &&
      cameras.length === targets.length &&
      captures.every((capture) =>
        cameraEqual(cameraFromCapture(capture), targetFromCapture(capture)),
      ) &&
      samples.every((sample) => {
        const camera = cameraFromSample(sample);
        const target = targetFromSample(sample);
        return (
          camera !== null &&
          target !== null &&
          cameraError(camera, target) <= CAMERA_MAX_STEP_PER_TICK + EPSILON
        );
      }));
  return {
    expectedMode,
    captureModes,
    sampleModes,
    modesMatch,
    fixedCamera,
    snappedCamera,
    pass: modesMatch && fixedCamera && snappedCamera,
  };
}

function resolveRunSpecs({
  requiredRunSpecs,
  requiredScenarioIds,
  requiredGestureIds,
}) {
  if (requiredRunSpecs) return requiredRunSpecs;
  if (requiredScenarioIds) {
    return requiredScenarioIds.map((scenarioId) => ({
      scenarioId,
      cameraMode: "smooth",
      artifactPrefix: scenarioId,
      gestureIds: requiredGestureIds ?? CAMERA_MOTION_GESTURE_IDS,
    }));
  }
  return CAMERA_MOTION_RUN_SPECS;
}

function clampObservation(run, boundaryRequired) {
  const bounds = boundsFor(run);
  const captures = runEntries(run);
  const samples = runSamples(run);
  const observations = [
    ...captures.map((capture) => ({
      source: capture.label ?? "capture",
      camera: cameraFromCapture(capture),
      target: targetFromCapture(capture),
    })),
    ...samples.map((sample) => ({
      source: `sample:${sample.tick}`,
      camera: cameraFromSample(sample),
      target: targetFromSample(sample),
    })),
  ];
  const inside = observations.every(
    ({ camera, target }) =>
      insideBounds(camera, bounds) && insideBounds(target, bounds),
  );
  const targetAtBoundary = observations.some(
    ({ target }) =>
      target &&
      (boundaryTouch(target.x, bounds?.minX, bounds?.maxX) ||
        boundaryTouch(target.y, bounds?.minY, bounds?.maxY)),
  );
  return {
    bounds,
    observationCount: observations.length,
    inside,
    targetAtBoundary,
    boundaryRequired,
    pass: Boolean(
      bounds &&
      observations.length > 0 &&
      inside &&
      (!boundaryRequired || targetAtBoundary),
    ),
  };
}

function continuousObservation(run) {
  const samples = runSamples(run);
  let speedViolations = 0;
  let snapDetections = 0;
  let overshoots = 0;
  let axisJitter = 0;
  const steps = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousCamera = cameraFromSample(previous);
    const currentCamera = cameraFromSample(current);
    const previousTarget = targetFromSample(previous);
    const currentTarget = targetFromSample(current);
    if (!previousCamera || !currentCamera || !previousTarget || !currentTarget)
      continue;
    const tickDelta = Math.max(1, current.tick - previous.tick);
    const delta = {
      x: currentCamera.x - previousCamera.x,
      y: currentCamera.y - previousCamera.y,
    };
    steps.push({
      fromTick: previous.tick,
      toTick: current.tick,
      delta,
      perTick: {
        x: delta.x / tickDelta,
        y: delta.y / tickDelta,
      },
    });
    if (
      Math.abs(delta.x) > CAMERA_MAX_STEP_PER_TICK * tickDelta + EPSILON ||
      Math.abs(delta.y) > CAMERA_MAX_STEP_PER_TICK * tickDelta + EPSILON
    )
      speedViolations += 1;
    if (
      current.cameraMode === "smooth" &&
      cameraError(currentCamera, currentTarget) <= EPSILON &&
      cameraError(previousCamera, currentTarget) > EPSILON
    )
      snapDetections += 1;
    for (const axis of ["x", "y"]) {
      const targetStable =
        Math.abs(currentTarget[axis] - previousTarget[axis]) <= EPSILON;
      if (!targetStable) continue;
      const previousSide = previousTarget[axis] - previousCamera[axis];
      const currentSide = currentTarget[axis] - currentCamera[axis];
      if (
        Math.abs(previousSide) > EPSILON &&
        Math.abs(currentSide) > EPSILON &&
        previousSide * currentSide < -EPSILON
      )
        overshoots += 1;
      if (index < 2) continue;
      const prior = samples[index - 2];
      const priorCamera = cameraFromSample(prior);
      const priorTarget = targetFromSample(prior);
      if (!priorCamera || !priorTarget) continue;
      if (
        Math.abs(priorTarget[axis] - previousTarget[axis]) <= EPSILON &&
        (previousCamera[axis] - priorCamera[axis]) * delta[axis] < -1
      )
        axisJitter += 1;
    }
  }
  return {
    sampleCount: samples.length,
    steps,
    speedViolations,
    snapDetections,
    overshoots,
    axisJitter,
    pass:
      samples.length > 1 &&
      speedViolations === 0 &&
      snapDetections === 0 &&
      overshoots === 0 &&
      axisJitter === 0,
  };
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * Evaluate a real-time smooth-camera strip. The recorder supplies the
 * production observer's synchronized captures and rAF samples; this module
 * owns only camera semantics and mutation verdicts.
 */
export function evaluateCameraMotionEvidence({
  profiles,
  requiredProfiles = CAMERA_MOTION_PROFILE_IDS,
  requiredRunSpecs,
  requiredScenarioIds,
  requiredGestureIds,
}) {
  const failures = [];
  const runSpecs = resolveRunSpecs({
    requiredRunSpecs,
    requiredScenarioIds,
    requiredGestureIds,
  });
  const { profileMap, selectedProfiles, runs, expected } = allRuns(
    profiles,
    requiredProfiles,
    runSpecs,
  );
  const actualRuns = new Map(
    runs.map(({ profile, run }) => [
      `${profile.profileId}:${run.scenarioId}`,
      { profile, run },
    ]),
  );
  const hasAllProfiles = selectedProfiles.every(Boolean);
  const hasAllRuns = expected.every(({ profileId, scenarioId }) =>
    actualRuns.has(`${profileId}:${scenarioId}`),
  );
  const timelinesSynchronized = selectedProfiles.every((profile) =>
    (profile?.runs ?? []).every((run) => {
      const spec = runSpecs.find(
        ({ scenarioId }) => scenarioId === run.scenarioId,
      );
      return spec
        ? runTimelinePass(run, spec.cameraMode, spec.gestureIds)
        : false;
    }),
  );
  if (!timelinesSynchronized) failures.push("camera-evidence-desynchronized");

  const basicsPass =
    hasAllProfiles &&
    hasAllRuns &&
    expected.every(({ profileId, scenarioId, cameraMode }) =>
      runBasicsPass(
        actualRuns.get(`${profileId}:${scenarioId}`)?.run,
        scenarioId,
        cameraMode,
      ),
    );
  const runsDetails = expected.map(
    ({ profileId, scenarioId, cameraMode, gestureIds, boundaryRequired }) => {
      const run = actualRuns.get(`${profileId}:${scenarioId}`)?.run;
      const convergence = convergenceObservation(run, gestureIds, cameraMode);
      const clamps = clampObservation(run, boundaryRequired);
      const continuous = continuousObservation(run);
      const mode = modeObservation(run, cameraMode);
      return {
        profileId,
        scenarioId,
        cameraMode,
        convergence,
        clamps,
        continuous,
        mode,
      };
    },
  );
  const converges =
    basicsPass &&
    runsDetails.length > 0 &&
    runsDetails.every(({ convergence }) => convergence.pass);
  const clamps =
    basicsPass &&
    runsDetails.length > 0 &&
    runsDetails.every(({ clamps: observation }) => observation.pass);
  const continuous =
    basicsPass &&
    runsDetails.length > 0 &&
    runsDetails.every(({ continuous: observation }) => observation.pass);
  const modes =
    basicsPass &&
    runsDetails.length > 0 &&
    runsDetails.every(({ mode }) => mode.pass);
  if (!converges) failures.push("camera-convergence");
  if (!clamps) failures.push("camera-clamp-mismatch");
  if (!modes) failures.push("camera-mode-contract");
  if (!continuous) {
    if (
      runsDetails.some(
        ({ continuous: observation }) => observation.speedViolations > 0,
      )
    )
      failures.push("camera-speed-doubled");
    if (
      runsDetails.some(
        ({ continuous: observation }) => observation.snapDetections > 0,
      )
    )
      failures.push("camera-snap-detected");
    if (
      runsDetails.some(
        ({ continuous: observation }) => observation.overshoots > 0,
      )
    )
      failures.push("camera-overshoot-detected");
    if (
      runsDetails.some(
        ({ continuous: observation }) => observation.axisJitter > 0,
      )
    )
      failures.push("camera-axis-jitter");
    if (
      !runsDetails.some(
        ({ continuous: observation }) =>
          observation.speedViolations > 0 ||
          observation.snapDetections > 0 ||
          observation.overshoots > 0 ||
          observation.axisJitter > 0,
      )
    )
      failures.push("camera-delta-continuity");
  }

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals: [
      signal("camera-converges", converges, { runs: runsDetails }),
      signal("camera-clamps", clamps, { runs: runsDetails }),
      signal("camera-delta-continuous", continuous, { runs: runsDetails }),
      signal("camera-mode-contract", modes, { runs: runsDetails }),
    ],
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    scenarios: [...new Set(runSpecs.map(({ scenarioId }) => scenarioId))],
    gestures: [...new Set(runSpecs.flatMap(({ gestureIds }) => gestureIds))],
    coverage: {
      hasAllProfiles,
      hasAllRuns,
      expectedRuns: expected.length,
      actualRuns: runs.length,
      timelinesSynchronized,
      knownProfileIds: [...profileMap.keys()],
      requiredRunSpecs: runSpecs,
    },
  };
}

function cameraFixture() {
  const camera = (x) => ({ x, y: 150, zoom: 1 });
  const sample = (tick, x, targetX) => ({
    tick,
    presentationTick: tick,
    camera: camera(x),
    cameraTarget: camera(targetX),
    cameraMode: "smooth",
  });
  const capture = (tick, x, targetX, label) => ({
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}`,
    manifestHash: `manifest-${tick}`,
    frameHash: `frame-${tick}`,
    label,
    manifest: {
      camera: camera(x),
      cameraTarget: camera(targetX),
      cameraMode: "smooth",
    },
  });
  const gesture = (id, startTick, samples, afterX, afterTargetX) => ({
    id,
    before: capture(
      startTick,
      samples[0].camera.x,
      samples[0].cameraTarget.x,
      `${id}-before`,
    ),
    after: capture(
      startTick + samples.length,
      afterX,
      afterTargetX,
      `${id}-after`,
    ),
    samples,
  });
  const run = {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.edgeReversal,
    cameraMode: "smooth",
    cameraBounds: { minX: 100, maxX: 300, minY: 100, maxY: 200 },
    initial: {
      bridgeExposed: false,
      mode: "observe-only",
      capture: capture(0, 100, 300, "initial"),
    },
    gestures: [
      gesture(
        "approach-map-edge",
        1,
        [
          sample(1, 100, 300),
          sample(2, 160, 300),
          sample(3, 210, 300),
          sample(4, 244, 300),
        ],
        244,
        300,
      ),
      gesture(
        "reverse-west",
        5,
        [sample(5, 244, 100), sample(6, 190, 100), sample(7, 144, 100)],
        144,
        100,
      ),
      gesture(
        "reverse-east",
        8,
        [sample(8, 144, 300), sample(9, 200, 300), sample(10, 244, 300)],
        244,
        300,
      ),
    ],
  };
  run.timeline = [
    run.initial.capture,
    ...run.gestures.flatMap(({ before, after }) => [before, after]),
  ];
  return run;
}

/** Exercise each named camera detector against a deterministic passing tape. */
export function runCameraMotionNegativeControls(evidence) {
  const baseline = evidence ?? {
    requiredProfiles: ["desktop"],
    requiredScenarioIds: [CAMERA_MOTION_SCENARIO_IDS.edgeReversal],
    requiredGestureIds: CAMERA_MOTION_RUN_SPECS[0].gestureIds,
    profiles: [{ profileId: "desktop", runs: [cameraFixture()] }],
  };
  const definitions = [
    {
      id: "camera-updated-twice",
      expectedSignal: "camera-speed-doubled",
      mutate(value) {
        const sample = value.profiles[0].runs[0].gestures[0].samples[1];
        sample.camera.x += 2_000;
      },
    },
    {
      id: "smooth-camera-snapped",
      expectedSignal: "camera-snap-detected",
      mutate(value) {
        const sample = value.profiles[0].runs[0].gestures[0].samples[1];
        sample.camera = { ...sample.cameraTarget };
      },
    },
    {
      id: "camera-overshot",
      expectedSignal: "camera-overshoot-detected",
      mutate(value) {
        const sample = value.profiles[0].runs[0].gestures[0].samples[1];
        sample.camera.x = sample.cameraTarget.x + 20;
      },
    },
    {
      id: "zoom-clamp-wrong",
      expectedSignal: "camera-clamp-mismatch",
      mutate(value) {
        value.profiles[0].runs[0].cameraBounds.maxX -= 1;
      },
    },
    {
      id: "axis-jitter",
      expectedSignal: "camera-axis-jitter",
      mutate(value) {
        const samples = value.profiles[0].runs[0].gestures[0].samples;
        samples[1].camera.y += 20;
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const value = structuredClone(baseline);
    mutate(value);
    const result = evaluateCameraMotionEvidence(value);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      expectedSignal,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      failures: result.failures,
    };
  });
}
