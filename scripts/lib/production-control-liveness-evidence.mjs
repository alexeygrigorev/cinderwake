export const PRODUCTION_LIVENESS_SCENARIO_IDS = [
  "ordinary-production-launch",
  "asset-load-recovery",
  "visible-control-census",
];

export const PRODUCTION_LIVENESS_GESTURE_IDS = [
  "mouse-select-begin",
  "touch-select-begin",
  "activate-every-visible-control",
  "retry-and-back",
];

export const PRODUCTION_LIVENESS_SIGNAL_IDS = [
  "launch-and-controls-live",
  "failure-route-recovers",
  "control-intents-registered",
  "visible-controls-bijective",
  "transition-deadlines-bound",
];

export const PRODUCTION_LIVENESS_FAILURE_IDS = [
  "launch-inert",
  "control-inert",
  "asset-recovery-visible",
  "visible-control-missing-intent",
  "transition-deadline-unbound",
];

export const PRODUCTION_LIVENESS_DEADLINES_MS = {
  selection: 1_500,
  begin: 30_000,
  control: 2_000,
  recovery: 3_000,
};

const REQUIRED_CLASSES = ["vanguard", "ranger", "arcanist"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function eventCount(capture, eventType) {
  return (capture?.snapshot?.eventLog ?? []).filter(
    ({ type, sourceId }) => type === eventType && sourceId === "player",
  ).length;
}

function position(capture) {
  const value = capture?.snapshot?.player?.position;
  return isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? value
    : null;
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
    position(capture),
  );
}

function timelineSynchronized(timeline) {
  return (
    Array.isArray(timeline) &&
    timeline.length > 0 &&
    timeline.every(captureSynchronized)
  );
}

function positionDelta(before, after) {
  const first = position(before);
  const second = position(after);
  if (!first || !second) return null;
  return {
    x: second.x - first.x,
    y: second.y - first.y,
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

function postconditionPass(activation) {
  const kind = activation?.postcondition?.kind;
  if (kind === "selected-class")
    return activation.afterClass === activation.postcondition.classId;
  if (kind === "seed-changed")
    return (
      typeof activation.beforeValue === "string" &&
      typeof activation.afterValue === "string" &&
      activation.beforeValue !== activation.afterValue
    );
  if (kind === "started-scenario")
    return Boolean(
      activation.after?.snapshot?.scenarioId?.startsWith("run:") &&
      activation.after.snapshot.player?.classId ===
        activation.postcondition.classId &&
      activation.after.bridgeExposed === false &&
      activation.after.mode === "observe-only",
    );
  if (kind === "event")
    return (
      eventCount(activation.after, activation.postcondition.eventType) >
      eventCount(activation.before, activation.postcondition.eventType)
    );
  if (kind === "tonic-consumed") {
    const before = activation.before?.snapshot?.player;
    const after = activation.after?.snapshot?.player;
    return Boolean(
      before &&
      after &&
      after.tonics === before.tonics - 1 &&
      after.health > before.health,
    );
  }
  if (kind === "moved") {
    const delta = positionDelta(activation.before, activation.after);
    return Boolean(delta && delta.distance > 0);
  }
  return false;
}

function activationPass(activation) {
  return Boolean(
    activation?.completed === true &&
    typeof activation.intentId === "string" &&
    activation.intentId.length > 0 &&
    isObject(activation.postcondition) &&
    postconditionPass(activation),
  );
}

function profileCensus(profile) {
  return [
    ...(profile?.selection?.visibleControls ?? []),
    ...(profile?.gameplay?.visibleControls ?? []),
  ];
}

function registryBijection(profile) {
  const census = profileCensus(profile).filter(
    ({ visible, enabled }) => visible === true && enabled === true,
  );
  const registry = profile?.controlIntentRegistry ?? [];
  const censusIds = census.map(({ controlId }) => controlId);
  const registryIds = registry.map(({ controlId }) => controlId);
  const unique = (values) =>
    values.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(values).size === values.length;
  const sameIds =
    unique(censusIds) &&
    unique(registryIds) &&
    censusIds.length === registryIds.length &&
    censusIds.every((id) => registryIds.includes(id));
  const completeEntries = registry.every(
    ({ controlId, intentId, postcondition }) =>
      typeof controlId === "string" &&
      typeof intentId === "string" &&
      intentId.length > 0 &&
      isObject(postcondition),
  );
  return {
    pass: sameIds && completeEntries,
    censusIds,
    registryIds,
  };
}

function classLaunches(profile) {
  const launches = profile?.selection?.launches ?? [];
  return REQUIRED_CLASSES.map((classId) =>
    launches.find(({ classId: candidate }) => candidate === classId),
  );
}

function launchPass(launch) {
  return Boolean(
    launch?.selectedClass === launch?.classId &&
    activationPass(launch?.selectionActivation) &&
    activationPass(launch?.beginActivation),
  );
}

function transitions(profile, recovery) {
  return [
    ...(profile?.selection?.transitions ?? []),
    ...(profile?.gameplay?.transitions ?? []),
    ...(recovery?.transitions ?? []),
  ];
}

function transitionPass(transition, deadlines) {
  return Boolean(
    transition?.completed === true &&
    typeof transition.deadlineKey === "string" &&
    deadlines[transition.deadlineKey] === transition.deadlineMs &&
    Number.isFinite(transition.elapsedMs) &&
    transition.elapsedMs >= 0 &&
    transition.elapsedMs <= transition.deadlineMs,
  );
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

function everyProfile(profiles, callback) {
  return profiles.length > 0 && profiles.every(callback);
}

/**
 * Evaluate the retained production launch/control/recovery bundle. Browser
 * recording supplies DOM census, observer captures, and physical gestures;
 * this module derives postconditions and owns the named mutation signals.
 */
export function evaluateProductionControlLiveness({
  profiles,
  recovery,
  requiredProfiles = [],
  requiredScenarioIds = PRODUCTION_LIVENESS_SCENARIO_IDS,
  requiredClasses = REQUIRED_CLASSES,
  deadlines = PRODUCTION_LIVENESS_DEADLINES_MS,
}) {
  const failures = [];
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const hasAllProfiles = selectedProfiles.every(Boolean);
  const hasRequiredScenarios = PRODUCTION_LIVENESS_SCENARIO_IDS.every((id) =>
    requiredScenarioIds.includes(id),
  );
  const timelineIsSynchronized = everyProfile(selectedProfiles, (profile) =>
    timelineSynchronized(profile?.timeline),
  );
  if (!timelineIsSynchronized) failures.push("transition-deadline-unbound");

  const launchDetails = selectedProfiles.map((profile) => {
    const launches = classLaunches(profile);
    return {
      profileId: profile?.profileId ?? null,
      classes: launches.map((launch, index) => ({
        classId: REQUIRED_CLASSES[index],
        pass: launchPass(launch),
      })),
    };
  });
  const launchesLive =
    hasAllProfiles &&
    hasRequiredScenarios &&
    selectedProfiles.every((profile) => {
      const launches = classLaunches(profile);
      return (
        profile?.selection?.gestureId ===
          (profile.profileId === "desktop"
            ? "mouse-select-begin"
            : "touch-select-begin") &&
        launches.length === requiredClasses.length &&
        requiredClasses.every((classId) =>
          launchPass(
            launches.find(({ classId: candidate }) => candidate === classId),
          ),
        )
      );
    });
  if (!launchesLive) failures.push("launch-inert");

  const controlDetails = selectedProfiles.map((profile) => {
    const activations = profile?.gameplay?.activations ?? [];
    return {
      profileId: profile?.profileId ?? null,
      controls: activations.map((activation) => ({
        controlId: activation.controlId ?? null,
        intentId: activation.intentId ?? null,
        pass: activationPass(activation),
      })),
    };
  });
  const controlsLive =
    hasAllProfiles &&
    selectedProfiles.every((profile) =>
      (profile?.gameplay?.activations ?? []).every(activationPass),
    );
  if (!controlsLive) failures.push("control-inert");

  const censusDetails = selectedProfiles.map((profile) => {
    const result = registryBijection(profile);
    return { profileId: profile?.profileId ?? null, ...result };
  });
  const visibleControlsBijective =
    hasAllProfiles &&
    selectedProfiles.every((profile) => registryBijection(profile).pass);
  if (!visibleControlsBijective)
    failures.push("visible-control-missing-intent");

  const registeredControls =
    hasAllProfiles &&
    selectedProfiles.every((profile) => {
      const registry = new Map(
        (profile.controlIntentRegistry ?? []).map((entry) => [
          entry.controlId,
          entry,
        ]),
      );
      return profileCensus(profile)
        .filter(({ visible, enabled }) => visible && enabled)
        .every(({ controlId }) => {
          const entry = registry.get(controlId);
          const activation = (profile.gameplay?.activations ?? [])
            .concat(profile.selection?.activations ?? [])
            .find(({ controlId: candidate }) => candidate === controlId);
          return Boolean(
            entry &&
            activation &&
            entry.intentId === activation.intentId &&
            entry.postcondition?.kind === activation.postcondition?.kind &&
            activationPass(activation),
          );
        });
    });
  if (!registeredControls) failures.push("control-inert");

  const recoveryPass = Boolean(
    hasRequiredScenarios &&
    recovery?.abort?.failure?.visible === true &&
    recovery.abort.failure.kind === "atlas-aborted" &&
    recovery.abort.retry?.clicked === true &&
    recovery.abort.retry.recovered === true &&
    recovery.abort.retry.after?.canvasVisible === true &&
    recovery?.stall?.failure?.visible === true &&
    recovery.stall.failure.kind === "atlas-stalled" &&
    recovery.stall.back?.clicked === true &&
    recovery.stall.back.selectionVisible === true,
  );
  if (!recoveryPass) failures.push("asset-recovery-visible");

  const allTransitions = selectedProfiles.flatMap((profile) =>
    transitions(profile, null),
  );
  allTransitions.push(...transitions(null, recovery));
  const deadlinesBound =
    allTransitions.length > 0 &&
    allTransitions.every((transition) => transitionPass(transition, deadlines));
  if (!deadlinesBound) failures.push("transition-deadline-unbound");

  const signals = [
    signal("launch-and-controls-live", launchesLive && controlsLive, {
      launches: launchDetails,
      controls: controlDetails,
    }),
    signal("failure-route-recovers", recoveryPass, {
      abort: recovery?.abort ?? null,
      stall: recovery?.stall ?? null,
    }),
    signal("control-intents-registered", registeredControls, {
      profiles: controlDetails,
    }),
    signal("visible-controls-bijective", visibleControlsBijective, {
      profiles: censusDetails,
    }),
    signal("transition-deadlines-bound", deadlinesBound, {
      transitionCount: allTransitions.length,
      deadlines,
    }),
  ];

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals,
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    timelineSynchronized: timelineIsSynchronized,
  };
}
