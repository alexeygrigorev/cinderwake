export const DIRECTIONAL_MOTION_SCENARIO_IDS = {
  fixedCamera: "fixed-camera-open-floor",
  followCamera: "follow-camera-open-floor",
};

export const DIRECTIONAL_MOTION_ACTOR_IDS = ["vanguard", "ranger", "arcanist"];

export const DIRECTIONAL_MOTION_DIRECTION_IDS = [
  "move-north",
  "move-east",
  "move-south",
  "move-west",
];

export const DIRECTIONAL_MOTION_SIGNAL_IDS = [
  "world-direction-matches",
  "screen-direction-matches",
  "facing-and-walk-match",
];

export const DIRECTIONAL_MOTION_FAILURE_IDS = [
  "world-direction",
  "screen-direction",
  "facing-mismatch",
  "walk-frozen",
  "directional-evidence-desynchronized",
];

const DIRECTIONS = [
  { id: "move-north", axis: "y", sign: -1, facing: "north" },
  { id: "move-east", axis: "x", sign: 1, facing: "east" },
  { id: "move-south", axis: "y", sign: 1, facing: "south" },
  { id: "move-west", axis: "x", sign: -1, facing: "west" },
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finitePosition(value) {
  return (
    isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
  );
}

function playerCall(capture) {
  const calls = capture?.manifest?.drawCalls;
  if (!Array.isArray(calls)) return null;
  return calls.find(({ entityId }) => entityId === "player") ?? null;
}

function referenceScene(capture) {
  const value = capture?.referenceScene;
  return isObject(value) && finitePosition(value.screenAnchor) ? value : null;
}

function playerPosition(capture) {
  const value = capture?.snapshot?.player?.position;
  return finitePosition(value) ? value : null;
}

function playerScreenAnchor(capture) {
  const call = playerCall(capture);
  return finitePosition(call?.screenAnchor) ? call.screenAnchor : null;
}

function captureSynchronized(capture) {
  const call = playerCall(capture);
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
    playerPosition(capture) &&
    playerScreenAnchor(capture) &&
    call?.clip &&
    call?.facingBucket,
  );
}

function sampleSynchronized(sample) {
  return Boolean(
    sample &&
    Number.isInteger(sample.tick) &&
    Number.isFinite(sample.presentationTick) &&
    finitePosition(sample.playerWorldAnchor) &&
    finitePosition(sample.playerScreenAnchor) &&
    typeof sample.playerFrameIdentity === "string" &&
    sample.playerFrameIdentity.length > 0 &&
    typeof sample.playerClip === "string" &&
    typeof sample.playerFacingBucket === "string",
  );
}

function gestureMap(run) {
  return new Map((run?.gestures ?? []).map((gesture) => [gesture.id, gesture]));
}

function delta(before, after, property) {
  const first = before?.[property];
  const second = after?.[property];
  if (!finitePosition(first) || !finitePosition(second)) return null;
  return { x: second.x - first.x, y: second.y - first.y };
}

function direction(id) {
  return DIRECTIONS.find((entry) => entry.id === id) ?? null;
}

function worldObservation(gesture, expected) {
  const movement = delta(
    gesture?.before?.snapshot?.player,
    gesture?.after?.snapshot?.player,
    "position",
  );
  return {
    delta: movement,
    matches: Boolean(
      movement && expected && expected.sign * movement[expected.axis] > 0,
    ),
  };
}

function fixedScreenObservation(gesture, expected) {
  const movement = delta(
    { screen: playerScreenAnchor(gesture?.before) },
    { screen: playerScreenAnchor(gesture?.after) },
    "screen",
  );
  return {
    delta: movement,
    matches: Boolean(
      movement && expected && expected.sign * movement[expected.axis] > 0,
    ),
  };
}

function followReferenceObservation(gesture, expected) {
  const movement = delta(
    referenceScene(gesture?.before),
    referenceScene(gesture?.after),
    "screenAnchor",
  );
  return {
    delta: movement,
    matches: Boolean(
      movement && expected && expected.sign * movement[expected.axis] < 0,
    ),
  };
}

function gaitObservation(gesture, expected) {
  const samples = gesture?.samples ?? [];
  const walking = samples.filter(
    (sample) =>
      sample.playerClip === "walk" &&
      sample.playerFacingBucket === expected?.facing,
  );
  return {
    sampleCount: samples.length,
    walkingSampleCount: walking.length,
    facingBuckets: [
      ...new Set(samples.map(({ playerFacingBucket }) => playerFacingBucket)),
    ],
    frameIdentities: [
      ...new Set(walking.map(({ playerFrameIdentity }) => playerFrameIdentity)),
    ],
    matches: Boolean(
      walking.length > 0 &&
      new Set(walking.map(({ playerFrameIdentity }) => playerFrameIdentity))
        .size >= 2,
    ),
  };
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

function runBasicsPass(run, expectedScenarioId, actorId) {
  return Boolean(
    run &&
    run.actorId === actorId &&
    run.scenarioId === expectedScenarioId &&
    run.initial?.injectionUsed === false &&
    run.initial?.bridgeExposed === false &&
    run.initial?.mode === "observe-only" &&
    run.initial?.snapshot?.player?.classId === actorId &&
    captureSynchronized(run.initial?.capture),
  );
}

function runTimelinePass(run) {
  return Boolean(
    Array.isArray(run?.timeline) &&
    run.timeline.length > 0 &&
    run.timeline.every(captureSynchronized) &&
    (run.gestures ?? []).every(
      (gesture) =>
        captureSynchronized(gesture.before) &&
        captureSynchronized(gesture.after) &&
        Array.isArray(gesture.samples) &&
        gesture.samples.length > 0 &&
        gesture.samples.every(sampleSynchronized),
    ),
  );
}

function allRuns(
  profiles,
  requiredProfiles,
  requiredActors,
  requiredScenarios,
) {
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const runs = [];
  for (const profile of selectedProfiles) {
    for (const run of profile?.runs ?? []) runs.push({ profile, run });
  }
  const expected = [];
  for (const profileId of requiredProfiles) {
    for (const actorId of requiredActors) {
      for (const scenarioId of requiredScenarios) {
        expected.push({ profileId, actorId, scenarioId });
      }
    }
  }
  return { profileMap, selectedProfiles, runs, expected };
}

/**
 * Evaluate production directional-motion evidence. The recorder supplies
 * observe-only snapshots, manifests, presentation samples, and PNG hashes;
 * this module owns the machine verdict and named mutation targets.
 */
export function evaluateDirectionalMotionEvidence({
  profiles,
  requiredProfiles = [],
  requiredActorIds = DIRECTIONAL_MOTION_ACTOR_IDS,
  requiredScenarioIds = Object.values(DIRECTIONAL_MOTION_SCENARIO_IDS),
  requiredDirectionIds = DIRECTIONAL_MOTION_DIRECTION_IDS,
}) {
  const failures = [];
  const { profileMap, selectedProfiles, runs, expected } = allRuns(
    profiles,
    requiredProfiles,
    requiredActorIds,
    requiredScenarioIds,
  );
  const hasAllProfiles = selectedProfiles.every(Boolean);
  const actualRuns = new Map(
    runs.map(({ profile, run }) => [
      `${profile.profileId}:${run.actorId}:${run.scenarioId}`,
      { profile, run },
    ]),
  );
  const hasAllRuns = expected.every(({ profileId, actorId, scenarioId }) =>
    actualRuns.has(`${profileId}:${actorId}:${scenarioId}`),
  );
  const timelinesSynchronized = selectedProfiles.every((profile) =>
    (profile?.runs ?? []).every(runTimelinePass),
  );
  if (!timelinesSynchronized)
    failures.push("directional-evidence-desynchronized");

  const basicsPass =
    hasAllProfiles &&
    hasAllRuns &&
    expected.every(({ profileId, actorId, scenarioId }) =>
      runBasicsPass(
        actualRuns.get(`${profileId}:${actorId}:${scenarioId}`)?.run,
        scenarioId,
        actorId,
      ),
    );

  const directionDetails = [];
  for (const { profileId, actorId, scenarioId } of expected) {
    const run = actualRuns.get(`${profileId}:${actorId}:${scenarioId}`)?.run;
    const gestures = gestureMap(run);
    for (const directionId of requiredDirectionIds) {
      const expectedDirection = direction(directionId);
      const gesture = gestures.get(directionId);
      const world = worldObservation(gesture, expectedDirection);
      const fixedScreen = fixedScreenObservation(gesture, expectedDirection);
      const followReference = followReferenceObservation(
        gesture,
        expectedDirection,
      );
      const gait = gaitObservation(gesture, expectedDirection);
      directionDetails.push({
        profileId,
        actorId,
        scenarioId,
        directionId,
        world,
        fixedScreen,
        followReference,
        gait,
        pass: Boolean(
          gesture &&
          world.matches &&
          (scenarioId === DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera
            ? fixedScreen.matches
            : followReference.matches) &&
          gait.matches,
        ),
      });
    }
  }

  const worldPass =
    basicsPass &&
    directionDetails.length > 0 &&
    directionDetails.every(({ world }) => world.matches);
  const screenPass =
    basicsPass &&
    directionDetails.length > 0 &&
    directionDetails.every(({ scenarioId, fixedScreen, followReference }) =>
      scenarioId === DIRECTIONAL_MOTION_SCENARIO_IDS.fixedCamera
        ? fixedScreen.matches
        : followReference.matches,
    );
  const gaitPass =
    basicsPass &&
    directionDetails.length > 0 &&
    directionDetails.every(({ gait }) => gait.matches);

  if (!worldPass) failures.push("world-direction");
  if (!screenPass) failures.push("screen-direction");
  if (!gaitPass) {
    if (
      directionDetails.some(
        ({ gait }) =>
          gait.walkingSampleCount > 0 && gait.frameIdentities.length < 2,
      )
    )
      failures.push("walk-frozen");
    failures.push("facing-mismatch");
  }

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals: [
      signal("world-direction-matches", worldPass, {
        directions: directionDetails,
      }),
      signal("screen-direction-matches", screenPass, {
        directions: directionDetails,
      }),
      signal("facing-and-walk-match", gaitPass, {
        directions: directionDetails,
      }),
    ],
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    actors: [...requiredActorIds],
    scenarios: [...requiredScenarioIds],
    directions: [...requiredDirectionIds],
    coverage: {
      hasAllProfiles,
      hasAllRuns,
      expectedRuns: expected.length,
      actualRuns: runs.length,
      timelinesSynchronized,
      knownProfileIds: [...profileMap.keys()],
    },
  };
}
