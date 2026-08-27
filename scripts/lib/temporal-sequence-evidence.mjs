const TEMPORAL_SEQUENCE_IDS = [
  "locomotion-east",
  "locomotion-west",
  "locomotion-north",
  "locomotion-south",
  "locomotion-mobile-interpolated",
  "ashfang-start-stop-east",
  "arcanist-start-stop-east",
  "hero-vanguard-primary",
  "hero-vanguard-ability",
  "hero-ranger-primary",
  "hero-ranger-ability",
  "hero-arcanist-primary",
  "hero-arcanist-ability",
  "hero-ranger-primary-north",
  "hero-arcanist-ability-south",
  "enemy-ashfang-attack",
  "enemy-stonekin-attack",
  "enemy-hexer-attack",
  "enemy-death-lifecycle",
  "friendly-projectile-travel",
  "friendly-projectile-impact",
  "loot-bob-cycle",
  "camera-smooth-follow",
  "city-entry",
  "outcome-win",
  "outcome-loss",
];

export const TEMPORAL_SEQUENCE_ENTRY_IDS = TEMPORAL_SEQUENCE_IDS;
export const TEMPORAL_LIVE_PROFILE_IDS = ["desktop-60hz", "phone-portrait-rAF"];
export const TEMPORAL_LIVE_ACTOR_IDS = ["vanguard", "ranger", "arcanist"];
export const TEMPORAL_LIVE_STRIP_LABELS = [
  "initial",
  "after-sustained-movement-and-turn",
  "after-first-attack",
  "after-second-attack",
  "after-ability",
];

function sameValues(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function group(entries, predicate) {
  return entries.filter(predicate);
}

function groupPass(entries, predicate, checks) {
  const selected = group(entries, predicate);
  return {
    count: selected.length,
    passing: selected.filter((entry) =>
      checks.every((check) => entry.checks?.[check] === true),
    ).length,
    total: selected.length,
    pass:
      selected.length > 0 &&
      selected.every((entry) =>
        checks.every((check) => entry.checks?.[check] === true),
      ),
  };
}

function scenarioCoverage(entries) {
  const groups = [
    {
      id: "animation-walk",
      entries: group(entries, ({ scenario }) => scenario === "animation-walk"),
    },
    {
      id: "all-temporal-hero-actions",
      entries: group(
        entries,
        ({ category }) =>
          category === "hero actions" ||
          category === "hero directional actions",
      ),
    },
    {
      id: "all-temporal-enemy-actions",
      entries: group(entries, ({ category }) => category === "enemy actions"),
    },
    {
      id: "temporal-enemy-death",
      entries: group(
        entries,
        ({ scenario }) => scenario === "temporal-enemy-death",
      ),
    },
  ];
  return groups.map(({ id, entries: selected }) => ({
    id,
    count: selected.length,
    pass: selected.length > 0,
    entryIds: selected.map(({ id: entryId }) => entryId),
  }));
}

function deviceProfiles(entries) {
  const profiles = new Set(
    entries.map((entry) =>
      entry.id === "locomotion-mobile-interpolated"
        ? "phone-portrait"
        : "desktop",
    ),
  );
  return [...profiles];
}

/**
 * Validate the ordinary public-route strips retained by the compositor
 * recorder. These are intentionally separate from the deterministic matrix:
 * the matrix proves exact state/clip contracts, while these strips prove that
 * each playable actor is actually presented by the live browser route.
 */
export function validateOrdinaryRouteTemporalStrips(evidence) {
  const failures = [];
  const profiles = Array.isArray(evidence?.profiles) ? evidence.profiles : [];
  const profileIds = profiles.map(({ id }) => id);
  if (
    TEMPORAL_LIVE_PROFILE_IDS.some((id) => !profileIds.includes(id)) ||
    new Set(profileIds).size !== profileIds.length
  )
    failures.push({
      code: "ordinary-route-profile-set-mismatch",
      detail: {
        expected: TEMPORAL_LIVE_PROFILE_IDS,
        actual: profileIds,
      },
    });

  const profileDetails = profiles.map((profile) => {
    const actors = Array.isArray(profile?.actors) ? profile.actors : [];
    const actorIds = actors.map(({ actorId }) => actorId);
    const actorDetails = TEMPORAL_LIVE_ACTOR_IDS.map((actorId) => {
      const actor = actors.find((candidate) => candidate.actorId === actorId);
      const frameArtifacts = Array.isArray(actor?.frameArtifacts)
        ? actor.frameArtifacts
        : [];
      const labels = frameArtifacts.map(({ label }) => label);
      const labelsMatch = TEMPORAL_LIVE_STRIP_LABELS.every(
        (label, index) => labels[index] === label,
      );
      const ticks = frameArtifacts.map(({ tick }) => tick);
      const ticksOrdered = ticks.every(
        (tick, index) => index === 0 || tick > ticks[index - 1],
      );
      const samples = Array.isArray(actor?.samples) ? actor.samples : [];
      const hasNormalVideo =
        typeof actor?.videoArtifacts?.normal?.file === "string";
      const pass =
        Boolean(actor) &&
        frameArtifacts.length === TEMPORAL_LIVE_STRIP_LABELS.length &&
        labelsMatch &&
        ticksOrdered &&
        samples.length >= 30 &&
        hasNormalVideo;
      if (!pass)
        failures.push({
          code: "ordinary-route-strip-incomplete",
          detail: {
            profileId: profile?.id ?? null,
            actorId,
            frameCount: frameArtifacts.length,
            labels,
            ticks,
            sampleCount: samples.length,
            hasNormalVideo,
          },
        });
      return {
        actorId,
        frameCount: frameArtifacts.length,
        sampleCount: samples.length,
        labelsMatch,
        ticksOrdered,
        hasNormalVideo,
        pass,
      };
    });
    if (
      actorIds.length !== TEMPORAL_LIVE_ACTOR_IDS.length ||
      TEMPORAL_LIVE_ACTOR_IDS.some((id) => !actorIds.includes(id)) ||
      new Set(actorIds).size !== actorIds.length
    )
      failures.push({
        code: "ordinary-route-actor-set-mismatch",
        detail: {
          profileId: profile?.id ?? null,
          expected: TEMPORAL_LIVE_ACTOR_IDS,
          actual: actorIds,
        },
      });
    return {
      id: profile?.id ?? "",
      required: profile?.required !== false,
      actors: actorDetails,
      pass:
        actorDetails.every(({ pass }) => pass) &&
        actorIds.length === TEMPORAL_LIVE_ACTOR_IDS.length &&
        TEMPORAL_LIVE_ACTOR_IDS.every((id) => actorIds.includes(id)),
    };
  });
  const expectedProfilesPresent = TEMPORAL_LIVE_PROFILE_IDS.every((id) =>
    profileDetails.some(({ id: actual }) => actual === id),
  );
  const pass = failures.length === 0 && expectedProfilesPresent;
  return {
    pass,
    failures,
    signal: {
      id: "ordinary-route-temporal-strips",
      pass,
      detail: {
        profiles: profileDetails,
        expectedProfileIds: TEMPORAL_LIVE_PROFILE_IDS,
        expectedActorIds: TEMPORAL_LIVE_ACTOR_IDS,
        expectedStripLabels: TEMPORAL_LIVE_STRIP_LABELS,
      },
    },
    summary: {
      profileIds,
      actorIds: TEMPORAL_LIVE_ACTOR_IDS,
      strips: profileDetails.reduce(
        (total, { actors }) =>
          total + actors.filter(({ pass: ok }) => ok).length,
        0,
      ),
      expectedStrips:
        TEMPORAL_LIVE_PROFILE_IDS.length * TEMPORAL_LIVE_ACTOR_IDS.length,
    },
  };
}

/**
 * Evaluate the retained capture-matrix catalog for the temporal presentation
 * contract. The matrix's individual assessors remain authoritative for pixel
 * measurements; this layer proves that the complete retained catalog is
 * present, passing, and covers the named action/lifecycle groups.
 */
export function validateTemporalSequenceCatalog(catalog) {
  const failures = [];
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  if (catalog?.schemaVersion !== 1)
    failures.push({
      code: "catalog-schema-mismatch",
      detail: { expected: 1, actual: catalog?.schemaVersion ?? null },
    });
  if (
    !sameValues(
      catalog?.entries?.map(({ id }) => id),
      TEMPORAL_SEQUENCE_IDS,
    )
  )
    failures.push({
      code: "catalog-entry-set-mismatch",
      detail: {
        expected: TEMPORAL_SEQUENCE_IDS,
        actual: entries.map(({ id }) => id),
      },
    });
  if (catalog?.pass !== true)
    failures.push({
      code: "catalog-not-passing",
      detail: catalog?.pass ?? null,
    });

  const entryPass = {
    count: entries.length,
    passing: entries.filter(({ pass }) => pass === true).length,
    total: entries.length,
    pass: entries.length > 0 && entries.every(({ pass }) => pass === true),
  };
  const cadence = groupPass(entries, () => true, [
    "semanticFrameExact",
    "semanticFrameCadence",
    "stateManifestContract",
    "renderSignatureDeterministic",
  ]);
  const transitions = groupPass(
    entries,
    ({ category }) =>
      [
        "clip transitions",
        "hero actions",
        "hero directional actions",
        "enemy actions",
        "lifecycles",
      ].includes(category),
    ["actualPoseContinuous", "attachedEffectBloomIsContinuous"],
  );
  const terminal = groupPass(
    entries,
    ({ category }) =>
      ["hero actions", "hero directional actions", "enemy actions"].includes(
        category,
      ),
    ["oneShotLifecycle", "oneShotFrameOrder"],
  );
  const death = groupPass(entries, ({ id }) => id === "enemy-death-lifecycle", [
    "deathLifecycle",
    "semanticFrameCadence",
  ]);
  const scenarios = scenarioCoverage(entries);
  const signals = [
    {
      id: "catalog-complete-and-passing",
      pass:
        entryPass.pass &&
        failures.length === 0 &&
        entries.length === TEMPORAL_SEQUENCE_IDS.length,
      detail: entryPass,
    },
    {
      id: "cadence-continuity",
      pass: cadence.pass,
      detail: cadence,
    },
    {
      id: "transition-continuity",
      pass: transitions.pass,
      detail: transitions,
    },
    {
      id: "terminal-pose-retained",
      pass: terminal.pass && death.pass,
      detail: { actionLifecycles: terminal, deathLifecycle: death },
    },
  ];
  for (const scenario of scenarios)
    if (!scenario.pass)
      failures.push({
        code: "scenario-coverage-missing",
        detail: scenario,
      });

  return {
    pass: failures.length === 0 && signals.every(({ pass }) => pass),
    failures,
    signals,
    summary: {
      expectedEntries: TEMPORAL_SEQUENCE_IDS.length,
      actualEntries: entries.length,
      passingEntries: entryPass.passing,
      deviceProfiles: deviceProfiles(entries),
      scenarioCoverage: scenarios,
    },
  };
}

function temporalFixture() {
  return {
    frames: [
      {
        frameIndex: 0,
        frameHash: "walk-0",
        crop: { x: 100, y: 120, width: 40, height: 40 },
        centroid: { x: 200, y: 300 },
        scale: 1,
      },
      {
        frameIndex: 1,
        frameHash: "walk-1",
        crop: { x: 101, y: 120, width: 40, height: 40 },
        centroid: { x: 204, y: 300 },
        scale: 1.01,
      },
      {
        frameIndex: 2,
        frameHash: "walk-2",
        crop: { x: 102, y: 121, width: 40, height: 40 },
        centroid: { x: 208, y: 301 },
        scale: 1.02,
      },
      {
        frameIndex: 3,
        frameHash: "idle-terminal",
        crop: { x: 103, y: 121, width: 40, height: 40 },
        centroid: { x: 209, y: 301 },
        scale: 1.02,
      },
    ],
    recoveryHash: "idle-terminal",
    terminalFramePresent: true,
  };
}

function frameDiversityPass(evidence) {
  return new Set(evidence.frames.map(({ frameHash }) => frameHash)).size >= 3;
}

function frameOrderPass(evidence) {
  return evidence.frames.every(({ frameIndex }, index) => frameIndex === index);
}

function cropContinuityPass(evidence) {
  return evidence.frames.slice(1).every((frame, index) => {
    const previous = evidence.frames[index].crop;
    return (
      Math.abs(frame.crop.x - previous.x) <= 4 &&
      Math.abs(frame.crop.y - previous.y) <= 4 &&
      Math.abs(frame.crop.width - previous.width) <= 1 &&
      Math.abs(frame.crop.height - previous.height) <= 1
    );
  });
}

function transformContinuityPass(evidence) {
  return evidence.frames.slice(1).every((frame, index) => {
    const previous = evidence.frames[index];
    return (
      Math.abs(frame.scale - previous.scale) <= 0.1 &&
      Math.hypot(
        frame.centroid.x - previous.centroid.x,
        frame.centroid.y - previous.centroid.y,
      ) <= 12
    );
  });
}

function recoveryContinuityPass(evidence) {
  return evidence.frames.at(-1)?.frameHash === evidence.recoveryHash;
}

function terminalPosePass(evidence) {
  return evidence.terminalFramePresent === true;
}

/** Exercise every named temporal detector against a small deterministic tape. */
export function runTemporalSequenceNegativeControls() {
  const definitions = [
    {
      id: "frame-duplicated-or-frozen",
      expectedSignal: "frame-diversity-failed",
      mutate(evidence) {
        for (const frame of evidence.frames) frame.frameHash = "frozen";
        return !frameDiversityPass(evidence);
      },
    },
    {
      id: "frames-reordered",
      expectedSignal: "frame-order-failed",
      mutate(evidence) {
        [evidence.frames[1].frameIndex, evidence.frames[2].frameIndex] = [
          evidence.frames[2].frameIndex,
          evidence.frames[1].frameIndex,
        ];
        return !frameOrderPass(evidence);
      },
    },
    {
      id: "crop-offset",
      expectedSignal: "crop-continuity-failed",
      mutate(evidence) {
        evidence.frames[2].crop.x += 20;
        return !cropContinuityPass(evidence);
      },
    },
    {
      id: "one-frame-scale-or-centroid-pop",
      expectedSignal: "transform-continuity-failed",
      mutate(evidence) {
        evidence.frames[2].scale += 0.8;
        evidence.frames[2].centroid.x += 40;
        return !transformContinuityPass(evidence);
      },
    },
    {
      id: "stale-recovery",
      expectedSignal: "recovery-continuity-failed",
      mutate(evidence) {
        evidence.recoveryHash = "stale-recoil";
        return !recoveryContinuityPass(evidence);
      },
    },
    {
      id: "terminal-pose-skipped",
      expectedSignal: "terminal-pose-failed",
      mutate(evidence) {
        evidence.terminalFramePresent = false;
        return !terminalPosePass(evidence);
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const evidence = structuredClone(temporalFixture());
    const detected = mutate(evidence);
    return {
      id,
      expectedSignal,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      detected,
    };
  });
}
