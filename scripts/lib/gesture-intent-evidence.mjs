export const GESTURE_INTENT_SCENARIO_IDS = {
  openFloor: "animation-idle-open-floor",
};

export const GESTURE_INTENT_GESTURE_IDS = [
  "tap-open-ground",
  "joystick-north",
  "joystick-east",
  "joystick-south",
  "joystick-west",
  "tap-strike",
];

export const GESTURE_INTENT_SIGNAL_IDS = [
  "movement-without-attack",
  "strike-without-route",
];

export const GESTURE_INTENT_FAILURE_IDS = [
  "gesture-intent-mismatch",
  "gesture-evidence-desynchronized",
];

const DIRECTION_GESTURES = [
  { id: "joystick-north", axis: "y", sign: -1 },
  { id: "joystick-east", axis: "x", sign: 1 },
  { id: "joystick-south", axis: "y", sign: 1 },
  { id: "joystick-west", axis: "x", sign: -1 },
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function position(capture) {
  const value = capture?.snapshot?.player?.position;
  return isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? value
    : null;
}

function attackCount(capture) {
  const events = capture?.snapshot?.eventLog;
  if (!Array.isArray(events)) return null;
  return events.filter(
    ({ type, sourceId }) => type === "attack_started" && sourceId === "player",
  ).length;
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
    position(capture) &&
    attackCount(capture) !== null,
  );
}

function timelineSynchronized(timeline) {
  return (
    Array.isArray(timeline) &&
    timeline.length > 0 &&
    timeline.every(captureSynchronized)
  );
}

function gestureMap(profile) {
  return new Map(
    (profile?.gestures ?? []).map((gesture) => [gesture.id, gesture]),
  );
}

function movementDelta(gesture) {
  const before = position(gesture?.before);
  const after = position(gesture?.after);
  if (!before || !after) return null;
  return {
    x: after.x - before.x,
    y: after.y - before.y,
    distance: Math.hypot(after.x - before.x, after.y - before.y),
  };
}

function attackDelta(gesture) {
  const before = attackCount(gesture?.before);
  const after = attackCount(gesture?.after);
  if (before === null || after === null) return null;
  return after - before;
}

function directionMatches(delta, expectation) {
  if (!delta || !expectation) return false;
  return expectation.sign * delta[expectation.axis] > 0;
}

function movementObservation(gesture, expectation = null) {
  const delta = movementDelta(gesture);
  const attacks = attackDelta(gesture);
  return {
    moved: Boolean(delta && delta.distance > 0),
    attackDelta: attacks,
    directionMatches: expectation
      ? directionMatches(delta, expectation)
      : Boolean(delta && delta.distance > 0),
    delta,
  };
}

function movementPass(gesture, expectation = null) {
  const observation = movementObservation(gesture, expectation);
  return (
    observation.moved &&
    observation.attackDelta === 0 &&
    observation.directionMatches
  );
}

function strikeObservation(gesture) {
  const delta = movementDelta(gesture);
  const attacks = attackDelta(gesture);
  return {
    moved: Boolean(delta && delta.distance > 0),
    attackDelta: attacks,
    delta,
  };
}

function strikePass(gesture) {
  const observation = strikeObservation(gesture);
  return observation.moved === false && observation.attackDelta > 0;
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * Evaluate retained physical mobile gestures. The recorder supplies browser
 * snapshots, synchronized render evidence, and gesture metadata; this module
 * owns the machine verdict and its deliberately named mutation target.
 */
export function evaluateGestureIntentEvidence({
  profiles,
  requiredProfiles = [],
  requiredScenarioIds = [GESTURE_INTENT_SCENARIO_IDS.openFloor],
}) {
  const failures = [];
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const hasAllProfiles = selectedProfiles.every(Boolean);
  const hasRequiredScenario = requiredScenarioIds.includes(
    GESTURE_INTENT_SCENARIO_IDS.openFloor,
  );
  const timelinesSynchronized = selectedProfiles.every((profile) =>
    timelineSynchronized(profile?.timeline),
  );
  if (!timelinesSynchronized) failures.push("gesture-evidence-desynchronized");

  const profileBasicsPass =
    hasAllProfiles &&
    hasRequiredScenario &&
    selectedProfiles.every(
      (profile) =>
        profile.scenarioId === GESTURE_INTENT_SCENARIO_IDS.openFloor &&
        profile.actualScenarioId === "animation-idle" &&
        profile.initial?.injectionUsed === false &&
        profile.initial?.bridgeExposed === false &&
        profile.initial?.snapshot?.scenarioId === "animation-idle",
    );

  const movementDetails = selectedProfiles.map((profile) => {
    const gestures = gestureMap(profile);
    const tap = gestures.get("tap-open-ground");
    const directions = DIRECTION_GESTURES.map(({ id, axis, sign }) => ({
      id,
      observation: movementObservation(gestures.get(id), { axis, sign }),
      pass: movementPass(gestures.get(id), { axis, sign }),
    }));
    return {
      profileId: profile?.profileId ?? null,
      tap: {
        observation: movementObservation(tap),
        pass: movementPass(tap),
      },
      directions,
    };
  });
  const movementWithoutAttack =
    profileBasicsPass &&
    selectedProfiles.every((profile) => {
      const gestures = gestureMap(profile);
      return (
        movementPass(gestures.get("tap-open-ground")) &&
        DIRECTION_GESTURES.every(({ id, axis, sign }) =>
          movementPass(gestures.get(id), { axis, sign }),
        )
      );
    });

  const strikeDetails = selectedProfiles.map((profile) => {
    const gesture = gestureMap(profile).get("tap-strike");
    return {
      profileId: profile?.profileId ?? null,
      observation: strikeObservation(gesture),
      pass: strikePass(gesture),
    };
  });
  const strikeWithoutRoute =
    profileBasicsPass &&
    selectedProfiles.every((profile) =>
      strikePass(gestureMap(profile).get("tap-strike")),
    );

  if (!movementWithoutAttack || !strikeWithoutRoute)
    failures.push("gesture-intent-mismatch");

  const signals = [
    signal("movement-without-attack", movementWithoutAttack, {
      profiles: movementDetails,
      requiredGestureIds: GESTURE_INTENT_GESTURE_IDS.slice(0, -1),
    }),
    signal("strike-without-route", strikeWithoutRoute, {
      profiles: strikeDetails,
      requiredGestureId: "tap-strike",
    }),
  ];

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals,
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    timelineSynchronized: timelinesSynchronized,
  };
}
