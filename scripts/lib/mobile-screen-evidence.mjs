export const MOBILE_SCREEN_PROFILE_IDS = ["phone-portrait", "phone-landscape"];

export const MOBILE_SCREEN_SCENARIO_IDS = [
  "public-selection",
  "ordinary-production-launch",
  "embercross-services",
];

export const MOBILE_SCREEN_GESTURE_IDS = [
  "touch-select-begin",
  "touch-move",
  "touch-strike",
  "rotate",
  "open-city-service",
];

export const MOBILE_SCREEN_SIGNAL_IDS = [
  "targets-contained",
  "subject-contained",
  "hud-and-controls-contained",
  "phone-text-legible",
  "pressed-feedback-live",
];

export const MOBILE_SCREEN_FAILURE_IDS = [
  "touch-target-invalid",
  "subject-containment-failed",
  "hud-containment-failed",
  "pressed-feedback-missing",
  "orientation-overlap-detected",
  "phone-text-size-below-contract",
  "phone-text-contrast-below-contract",
  "copy-quiet-field-violated",
  "phone-copy-wrap-invalid",
  "mobile-evidence-desynchronized",
];

const PROFILE_CONTRACT = {
  "phone-portrait": {
    viewport: { width: 390, height: 844 },
    minTargetPixels: 44,
    maxControlHeightRatio: 0.2,
    maxHudClusterDistance: 24,
  },
  "phone-landscape": {
    viewport: { width: 844, height: 390 },
    minTargetPixels: 44,
    maxControlHeightRatio: 0.28,
    maxHudClusterDistance: 24,
  },
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function profileContract(profileId) {
  return PROFILE_CONTRACT[profileId] ?? null;
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
    capture.frameHash.length > 0,
  );
}

function profileTimeline(profile) {
  return [
    ...(profile?.timeline ?? []),
    ...(profile?.gestures ?? []).flatMap((gesture) => [
      gesture.before,
      gesture.pressed,
      gesture.after,
    ]),
  ].filter(Boolean);
}

function timelineSynchronized(profile) {
  const timeline = profileTimeline(profile);
  return timeline.length > 0 && timeline.every(captureSynchronized);
}

function targetFailures(profile) {
  const minimum = profileContract(profile?.profileId)?.minTargetPixels ?? 44;
  const targets = [
    ...(profile?.selection?.targets ?? []),
    ...(profile?.game?.targets ?? []),
    ...(profile?.city?.targets ?? []),
  ];
  if (targets.length === 0) return ["targets:missing"];
  return targets.flatMap((target) => {
    const failures = [];
    if (!finite(target.width) || !finite(target.height))
      failures.push(`${target.id ?? "unknown"}:missing-size`);
    else if (target.width < minimum || target.height < minimum)
      failures.push(`${target.id ?? "unknown"}:undersized`);
    if (target.contained !== true)
      failures.push(`${target.id ?? "unknown"}:outside-viewport`);
    if (target.hit !== true)
      failures.push(`${target.id ?? "unknown"}:not-hit-testable`);
    if (target.occluded === true)
      failures.push(`${target.id ?? "unknown"}:occluded`);
    return failures;
  });
}

function subjectPass(subject) {
  return Boolean(
    subject?.contained === true &&
    (!Array.isArray(subject.landmarks) ||
      (subject.landmarks.length > 0 &&
        subject.landmarks.every(({ contained }) => contained === true))),
  );
}

function subjectFailures(profile) {
  const subjects = [
    profile?.selection?.subject,
    profile?.game?.subject,
    profile?.city?.subject,
  ].filter(Boolean);
  if (subjects.length === 0) return ["subject:missing"];
  return subjects.flatMap((subject) => {
    const failures = [];
    if (!subjectPass(subject)) failures.push(subject.id ?? "subject");
    for (const landmark of subject.landmarks ?? [])
      if (landmark.contained !== true)
        failures.push(`${subject.id ?? "subject"}:${landmark.id}:outside`);
    return failures;
  });
}

function safeAreaPass(safeArea) {
  return Boolean(
    safeArea?.emulated === true &&
    safeArea?.applied === true &&
    isObject(safeArea.insets) &&
    ["top", "right", "bottom", "left"].every((side) =>
      finite(safeArea.insets[side]),
    ) &&
    safeArea?.contentContained === true,
  );
}

function layoutPass(profile) {
  const contract = profileContract(profile?.profileId);
  const layouts = [profile?.selection?.layout, profile?.game?.layout].filter(
    Boolean,
  );
  if (!contract || layouts.length < 2) return false;
  const layoutBoundsPass = layouts.every(
    (layout) =>
      layout.overflowX === false &&
      layout.overflowY === false &&
      layout.rootContained === true &&
      layout.stageContained === true,
  );
  const gameLayout = profile.game.layout;
  const controlsPass =
    gameLayout.controlsVisible === true &&
    gameLayout.controlsContained === true &&
    finite(gameLayout.controlHeightRatio) &&
    gameLayout.controlHeightRatio <= contract.maxControlHeightRatio &&
    finite(gameLayout.hudClusterDistance) &&
    gameLayout.hudClusterDistance <= contract.maxHudClusterDistance &&
    Array.isArray(gameLayout.worldOverlapIds) &&
    gameLayout.worldOverlapIds.length === 0;
  const orientationPass =
    profile.orientation?.overlap === false &&
    profile.orientation?.targetsContained === true;
  return (
    layoutBoundsPass &&
    controlsPass &&
    orientationPass &&
    safeAreaPass(profile.safeArea)
  );
}

function textFailures(profile) {
  const entries = profile?.textMetrics;
  if (!Array.isArray(entries) || entries.length === 0) return ["text:missing"];
  return entries.flatMap((entry) => {
    const failures = [];
    const id = entry.id ?? "text";
    if (!finite(entry.fontSize) || entry.fontSize < 8)
      failures.push(`${id}:size`);
    if (!finite(entry.contrastRatio) || entry.contrastRatio < 3)
      failures.push(`${id}:contrast`);
    if (entry.quietField !== true) failures.push(`${id}:quiet-field`);
    if (entry.wrapValid !== true || entry.orphanToken !== false)
      failures.push(`${id}:wrap`);
    return failures;
  });
}

function gestureMap(profile) {
  return new Map(
    (profile?.gestures ?? []).map((gesture) => [gesture.id, gesture]),
  );
}

function pressedFeedbackPass(profile) {
  const gestures = gestureMap(profile);
  return MOBILE_SCREEN_GESTURE_IDS.every((id) => {
    const gesture = gestures.get(id);
    if (!gesture) return false;
    if (id === "rotate")
      return (
        gesture.orientationChanged === true &&
        gesture.after?.orientation === gesture.toOrientation
      );
    return (
      gesture.pressed?.visualChanged === true &&
      gesture.pressed?.frameHash &&
      gesture.before?.frameHash !== gesture.pressed.frameHash &&
      gesture.after?.frameHash &&
      gesture.after?.semanticOutcome === true
    );
  });
}

function baselinePass(profile, requiredScenarioIds) {
  const contract = profileContract(profile?.profileId);
  const scenarios = new Set(profile?.scenarioIds ?? []);
  return Boolean(
    contract &&
    profile?.viewport?.width === contract.viewport.width &&
    profile?.viewport?.height === contract.viewport.height &&
    requiredScenarioIds.every((id) => scenarios.has(id)) &&
    profile?.bridgeExposed === false &&
    profile?.mode === "observe-only" &&
    timelineSynchronized(profile),
  );
}

/**
 * Evaluate retained production mobile evidence. Browser recording is kept
 * outside this module; this function owns the contract verdict and its
 * deliberately named mutation targets.
 */
export function evaluateMobileScreenEvidence({
  profiles,
  requiredProfiles = MOBILE_SCREEN_PROFILE_IDS,
  requiredScenarioIds = MOBILE_SCREEN_SCENARIO_IDS,
}) {
  const failures = [];
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const profilesPresent = selectedProfiles.every(Boolean);
  if (!profilesPresent) failures.push("mobile-evidence-desynchronized");

  const baselineDetails = selectedProfiles.map((profile) => ({
    profileId: profile?.profileId ?? null,
    pass: baselinePass(profile, requiredScenarioIds),
    timelineSynchronized: timelineSynchronized(profile),
  }));
  if (baselineDetails.some(({ pass }) => !pass))
    failures.push("mobile-evidence-desynchronized");

  const targetDetails = selectedProfiles.map((profile) => ({
    profileId: profile?.profileId ?? null,
    failures: targetFailures(profile),
  }));
  const targetsContained =
    profilesPresent &&
    targetDetails.every(({ failures: items }) => items.length === 0);
  if (!targetsContained) failures.push("touch-target-invalid");

  const subjectDetails = selectedProfiles.map((profile) => ({
    profileId: profile?.profileId ?? null,
    failures: subjectFailures(profile),
  }));
  const subjectsContained =
    profilesPresent &&
    subjectDetails.every(({ failures: items }) => items.length === 0);
  if (!subjectsContained) failures.push("subject-containment-failed");

  const layoutDetails = selectedProfiles.map((profile) => ({
    profileId: profile?.profileId ?? null,
    pass: layoutPass(profile),
    selection: profile?.selection?.layout ?? null,
    game: profile?.game?.layout ?? null,
    safeArea: profile?.safeArea ?? null,
    orientation: profile?.orientation ?? null,
  }));
  const hudAndControlsContained =
    profilesPresent && layoutDetails.every(({ pass }) => pass);
  if (!hudAndControlsContained) failures.push("hud-containment-failed");

  const textDetails = selectedProfiles.map((profile) => ({
    profileId: profile?.profileId ?? null,
    failures: textFailures(profile),
  }));
  const phoneTextLegible =
    profilesPresent &&
    textDetails.every(({ failures: items }) => items.length === 0);
  if (!phoneTextLegible) {
    if (
      textDetails.some(({ failures: items }) =>
        items.some((id) => id.endsWith(":size")),
      )
    )
      failures.push("phone-text-size-below-contract");
    if (
      textDetails.some(({ failures: items }) =>
        items.some((id) => id.endsWith(":contrast")),
      )
    )
      failures.push("phone-text-contrast-below-contract");
    if (
      textDetails.some(({ failures: items }) =>
        items.some((id) => id.endsWith(":quiet-field")),
      )
    )
      failures.push("copy-quiet-field-violated");
    if (
      textDetails.some(({ failures: items }) =>
        items.some((id) => id.endsWith(":wrap")),
      )
    )
      failures.push("phone-copy-wrap-invalid");
  }

  const pressedDetails = selectedProfiles.map((profile) => ({
    profileId: profile?.profileId ?? null,
    pass: pressedFeedbackPass(profile),
  }));
  const pressedFeedbackLive =
    profilesPresent && pressedDetails.every(({ pass }) => pass);
  if (!pressedFeedbackLive) failures.push("pressed-feedback-missing");
  if (
    selectedProfiles.some(
      (profile) =>
        profile?.orientation?.overlap !== false ||
        profile?.orientation?.targetsContained !== true,
    )
  )
    failures.push("orientation-overlap-detected");

  const signals = [
    {
      id: "targets-contained",
      pass: targetsContained,
      detail: { profiles: targetDetails },
    },
    {
      id: "subject-contained",
      pass: subjectsContained,
      detail: { profiles: subjectDetails },
    },
    {
      id: "hud-and-controls-contained",
      pass: hudAndControlsContained,
      detail: { profiles: layoutDetails },
    },
    {
      id: "phone-text-legible",
      pass: phoneTextLegible,
      detail: { profiles: textDetails },
    },
    {
      id: "pressed-feedback-live",
      pass: pressedFeedbackLive,
      detail: { profiles: pressedDetails },
    },
  ];

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals,
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    timelineSynchronized: selectedProfiles.every((profile) =>
      timelineSynchronized(profile),
    ),
  };
}
