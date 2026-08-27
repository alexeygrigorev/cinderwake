export const DIRECTIONAL_BANK_ACTOR_IDS = ["vanguard", "ranger", "arcanist"];

export const DIRECTIONAL_BANK_DIRECTION_IDS = [
  "move-north",
  "move-east",
  "move-south",
  "move-west",
];

export const DIRECTIONAL_BANK_SIGNAL_IDS = [
  "facing-follows-intent",
  "bank-and-reflection-match",
  "target-aim-follows-intent",
  "action-origin-mirrors",
  "ability-recovery-is-contiguous",
];

export const DIRECTIONAL_BANK_FAILURE_IDS = [
  "sprite-bank-mismatch",
  "west-reflection-missing",
  "stale-facing-bank",
  "target-aim-not-mirrored",
  "attack-origin-not-mirrored",
  "ability-recovery-mismatch",
  "directional-bank-evidence-desynchronized",
];

const DIRECTIONS = [
  {
    id: "move-north",
    x: 0,
    y: -1,
    axis: "y",
    sign: -1,
    facing: "north",
    opposite: "move-south",
  },
  {
    id: "move-east",
    x: 1,
    y: 0,
    axis: "x",
    sign: 1,
    facing: "east",
    opposite: "move-west",
  },
  {
    id: "move-south",
    x: 0,
    y: 1,
    axis: "y",
    sign: 1,
    facing: "south",
    opposite: "move-north",
  },
  {
    id: "move-west",
    x: -1,
    y: 0,
    axis: "x",
    sign: -1,
    facing: "west",
    opposite: "move-east",
  },
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteVector(value) {
  return (
    isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
  );
}

function equalVector(first, second) {
  return (
    finiteVector(first) &&
    finiteVector(second) &&
    first.x === second.x &&
    first.y === second.y
  );
}

function playerCall(capture) {
  const calls = capture?.manifest?.drawCalls;
  if (!Array.isArray(calls)) return null;
  return calls.find(({ entityId }) => entityId === "player") ?? null;
}

function playerState(capture) {
  const player = capture?.snapshot?.player;
  return isObject(player) ? player : null;
}

function facingBucket(vector) {
  if (!finiteVector(vector) || (vector.x === 0 && vector.y === 0)) return null;
  if (Math.abs(vector.x) >= Math.abs(vector.y))
    return vector.x < 0 ? "west" : "east";
  return vector.y < 0 ? "north" : "south";
}

function captureSynchronized(capture) {
  const player = playerState(capture);
  const call = playerCall(capture);
  return Boolean(
    capture &&
    Number.isInteger(capture.tick) &&
    capture.tick === capture.stateTick &&
    capture.tick === capture.manifestTick &&
    Number.isInteger(capture.snapshot?.tick) &&
    capture.snapshot.tick === capture.tick &&
    Number.isInteger(capture.manifest?.tick) &&
    capture.manifest.tick === capture.tick &&
    player &&
    finiteVector(player.position) &&
    finiteVector(player.facing) &&
    call &&
    typeof call.geometryId === "string" &&
    call.geometryId.length > 0 &&
    typeof call.spriteId === "string" &&
    call.spriteId.length > 0 &&
    typeof call.facingBucket === "string" &&
    typeof call.flipX === "boolean" &&
    finiteVector(call.facing) &&
    equalVector(call.facing, player.facing),
  );
}

function direction(id) {
  return DIRECTIONS.find((entry) => entry.id === id) ?? null;
}

function delta(before, after) {
  const first = playerState(before)?.position;
  const second = playerState(after)?.position;
  if (!finiteVector(first) || !finiteVector(second)) return null;
  return { x: second.x - first.x, y: second.y - first.y };
}

function expectedSprite(call, expectedFacing) {
  if (!call || !expectedFacing) return null;
  return {
    spriteId:
      expectedFacing === "north" || expectedFacing === "south"
        ? `${call.geometryId}:${expectedFacing}`
        : call.geometryId,
    flipX: expectedFacing === "west",
  };
}

function bankObservation(capture, expectedFacing) {
  const call = playerCall(capture);
  const expected = expectedSprite(call, expectedFacing);
  return {
    actual: call
      ? {
          spriteId: call.spriteId,
          facingBucket: call.facingBucket,
          flipX: call.flipX,
        }
      : null,
    expected: expected
      ? {
          spriteId: expected.spriteId,
          facingBucket: expectedFacing,
          flipX: expected.flipX,
        }
      : null,
    matches: Boolean(
      call &&
      expected &&
      call.spriteId === expected.spriteId &&
      call.facingBucket === expectedFacing &&
      call.flipX === expected.flipX,
    ),
    spriteMatches: Boolean(
      call && expected && call.spriteId === expected.spriteId,
    ),
    reflectionMatches: Boolean(
      call && expected && call.flipX === expected.flipX,
    ),
  };
}

function actionAttack(action) {
  const expectedKind = action?.kind;
  if (typeof expectedKind !== "string") return null;
  if (isObject(action?.pendingAttack)) return action.pendingAttack;
  const attacks = action?.after?.snapshot?.pendingAttacks;
  if (!Array.isArray(attacks)) return null;
  return (
    attacks.find(
      ({ ownerId, kind }) => ownerId === "player" && kind === expectedKind,
    ) ?? null
  );
}

function producedOriginPass(actorId, action, attack) {
  const produced = Array.isArray(action?.produced) ? action.produced : [];
  if (!attack || !finiteVector(attack.origin)) return false;
  if (
    actorId === "vanguard" ||
    (actorId === "arcanist" && action?.kind === "ability")
  ) {
    return produced.some(
      (entry) =>
        entry?.type === "effect" &&
        entry.ownerId === "player" &&
        equalVector(entry.position, attack.origin),
    );
  }
  return produced.some(
    (entry) =>
      entry?.type === "projectile" &&
      entry.ownerId === "player" &&
      equalVector(entry.position, attack.origin) &&
      finiteVector(entry.velocity) &&
      entry.velocity.x * attack.direction.x +
        entry.velocity.y * attack.direction.y >
        0,
  );
}

function targetAimPass(action, expectedFacing) {
  const before = playerState(action?.before);
  const aim = action?.input?.aim;
  if (!before || !finiteVector(before.position) || !finiteVector(aim))
    return false;
  return (
    !equalVector(aim, before.position) &&
    facingBucket({
      x: aim.x - before.position.x,
      y: aim.y - before.position.y,
    }) === expectedFacing
  );
}

function recoveryPass(action, expectedFacing) {
  const recoveryPlayer = playerState(action?.recovery);
  const recoveryBank = bankObservation(action?.recovery, expectedFacing);
  const recoveryClip = recoveryPlayer?.animation?.clip;
  const expectedActionClip = action?.kind === "ability" ? "ability" : "attack";
  return Boolean(
    recoveryPlayer &&
    recoveryClip &&
    recoveryClip !== expectedActionClip &&
    ["idle", "walk"].includes(recoveryClip) &&
    recoveryBank.matches,
  );
}

function actionObservation(actorId, action, expectedFacing) {
  const beforePlayer = playerState(action?.before);
  const afterPlayer = playerState(action?.after);
  const afterFacing = facingBucket(afterPlayer?.facing);
  const expectedActionClip = action?.kind === "ability" ? "ability" : "attack";
  const afterClip = afterPlayer?.animation?.clip ?? null;
  const attack = actionAttack(action);
  const originPass = Boolean(
    beforePlayer &&
    afterPlayer &&
    attack &&
    equalVector(attack.origin, beforePlayer.position) &&
    equalVector(attack.direction, afterPlayer.facing) &&
    producedOriginPass(actorId, action, attack),
  );
  const aimPass = targetAimPass(action, expectedFacing);
  const recovery = {
    clip: playerState(action?.recovery)?.animation?.clip ?? null,
    bank: bankObservation(action?.recovery, expectedFacing),
    pass: recoveryPass(action, expectedFacing),
  };
  return {
    kind: action?.kind ?? null,
    beforeFacing: facingBucket(beforePlayer?.facing),
    afterFacing,
    input: action?.input ?? null,
    aimPass,
    clip: afterClip,
    clipPass: afterClip === expectedActionClip,
    pendingAttack: attack
      ? {
          origin: attack.origin,
          direction: attack.direction,
          kind: attack.kind,
        }
      : null,
    producedCount: Array.isArray(action?.produced) ? action.produced.length : 0,
    originPass,
    recovery,
    pass: Boolean(
      aimPass &&
      afterFacing === expectedFacing &&
      afterClip === expectedActionClip &&
      originPass &&
      recovery.pass,
    ),
  };
}

function directionObservation(runDirection, expected, actorId) {
  const movement = runDirection?.movement;
  const action = runDirection?.action;
  const ability = runDirection?.ability;
  const turnExpected =
    direction(runDirection?.turnDirectionId) ?? direction(expected?.opposite);
  const movementDelta = delta(movement?.before, movement?.after);
  const afterPlayer = playerState(movement?.after);
  const turnPlayer = playerState(movement?.turn);
  const actionBeforePlayer = playerState(action?.before);
  const afterFacing = facingBucket(afterPlayer?.facing);
  const turnFacing = facingBucket(turnPlayer?.facing);
  const actionBeforeFacing = facingBucket(actionBeforePlayer?.facing);
  const movementBank = bankObservation(movement?.after, expected?.facing);
  const turnBank = bankObservation(movement?.turn, turnExpected?.facing);
  const actionBeforeBank = bankObservation(action?.before, expected?.facing);
  const actionAfterBank = bankObservation(action?.after, expected?.facing);
  const abilityBeforeBank = bankObservation(ability?.before, expected?.facing);
  const abilityAfterBank = bankObservation(ability?.after, expected?.facing);
  const actionObservationValue = actionObservation(
    actorId,
    action,
    expected?.facing,
  );
  const abilityObservationValue = actionObservation(
    actorId,
    ability,
    expected?.facing,
  );
  const movementPass = Boolean(
    expected &&
    turnExpected &&
    movementDelta &&
    expected.sign * movementDelta[expected.axis] > 0 &&
    afterFacing === expected.facing &&
    turnFacing === turnExpected.facing &&
    runDirection?.turnDirectionId === turnExpected?.id,
  );
  const bankPass = Boolean(
    movementBank.matches &&
    turnBank.matches &&
    actionBeforeFacing === expected?.facing &&
    actionBeforeBank.matches &&
    actionAfterBank.matches &&
    actionObservationValue.recovery.bank.matches &&
    abilityBeforeBank.matches &&
    abilityAfterBank.matches &&
    abilityObservationValue.recovery.bank.matches,
  );
  const aimPass = Boolean(
    actionObservationValue.aimPass && abilityObservationValue.aimPass,
  );
  const abilityRecoveryPass = abilityObservationValue.recovery.pass;
  return {
    directionId: runDirection?.directionId ?? null,
    turnDirectionId: runDirection?.turnDirectionId ?? null,
    expected: expected
      ? {
          facing: expected.facing,
          vector: { x: expected.x, y: expected.y },
          opposite: expected.opposite,
        }
      : null,
    movement: {
      delta: movementDelta,
      afterFacing,
      turnFacing,
      pass: movementPass,
    },
    banks: {
      movement: movementBank,
      turn: turnBank,
      actionBefore: actionBeforeBank,
      actionAfter: actionAfterBank,
      abilityBefore: abilityBeforeBank,
      abilityAfter: abilityAfterBank,
      pass: bankPass,
    },
    action: {
      ...actionObservationValue,
      pass: actionObservationValue.pass,
    },
    ability: {
      ...abilityObservationValue,
      pass: abilityObservationValue.pass,
    },
    aim: {
      pass: aimPass,
      primary: actionObservationValue.aimPass,
      ability: abilityObservationValue.aimPass,
    },
    recovery: {
      pass: abilityRecoveryPass,
      ability: abilityObservationValue.recovery,
    },
    synchronized: [
      movement?.before,
      movement?.after,
      movement?.turn,
      action?.before,
      action?.after,
      action?.impact,
      action?.recovery,
      ability?.before,
      ability?.after,
      ability?.impact,
      ability?.recovery,
    ].every(captureSynchronized),
  };
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

function profileCoverage(
  profiles,
  requiredProfiles,
  requiredActors,
  requiredDirections,
) {
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile?.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const expectedRuns = requiredProfiles.length * requiredActors.length;
  const actualRuns = selectedProfiles.flatMap((profile) => profile?.runs ?? []);
  const runsByKey = new Map(
    actualRuns.map((run) => [
      `${run?.profileId ?? ""}:${run?.actorId ?? ""}`,
      run,
    ]),
  );
  const expectedKeys = requiredProfiles.flatMap((profileId) =>
    requiredActors.map((actorId) => `${profileId}:${actorId}`),
  );
  const hasAllRuns = expectedKeys.every((key) => runsByKey.has(key));
  const hasAllDirections = expectedKeys.every((key) => {
    const run = runsByKey.get(key);
    const directionIds = new Set(
      (run?.directions ?? []).map(({ directionId }) => directionId),
    );
    return requiredDirections.every((id) => directionIds.has(id));
  });
  const timelinesSynchronized = actualRuns.every((run) =>
    requiredDirections.every((directionId) => {
      const entry = (run?.directions ?? []).find(
        ({ directionId: actualDirectionId }) =>
          actualDirectionId === directionId,
      );
      return Boolean(
        entry &&
        [
          entry.movement?.before,
          entry.movement?.after,
          entry.movement?.turn,
          entry.action?.before,
          entry.action?.after,
          entry.action?.impact,
          entry.action?.recovery,
          entry.ability?.before,
          entry.ability?.after,
          entry.ability?.impact,
          entry.ability?.recovery,
        ].every(captureSynchronized),
      );
    }),
  );
  return {
    profileMap,
    selectedProfiles,
    actualRuns,
    runsByKey,
    hasAllProfiles: selectedProfiles.every(Boolean),
    hasAllRuns,
    hasAllDirections,
    timelinesSynchronized,
    expectedRuns,
    actualRunCount: actualRuns.length,
  };
}

/**
 * Evaluate exact directional sprite-bank, reflection, target-aim, authored
 * action-origin, and recovery evidence. The recorder supplies synchronized
 * bridge captures; this module owns the directional oracle and named mutation
 * verdicts.
 */
export function evaluateDirectionalBankEvidence({
  profiles,
  requiredProfiles = [],
  requiredActorIds = DIRECTIONAL_BANK_ACTOR_IDS,
  requiredDirectionIds = DIRECTIONAL_BANK_DIRECTION_IDS,
}) {
  const failures = [];
  const coverage = profileCoverage(
    profiles,
    requiredProfiles,
    requiredActorIds,
    requiredDirectionIds,
  );
  if (
    !coverage.hasAllProfiles ||
    !coverage.hasAllRuns ||
    !coverage.hasAllDirections ||
    !coverage.timelinesSynchronized
  )
    failures.push("directional-bank-evidence-desynchronized");

  const directions = [];
  for (const profile of coverage.selectedProfiles) {
    for (const actorId of requiredActorIds) {
      const run = coverage.runsByKey.get(
        `${profile?.profileId ?? ""}:${actorId}`,
      );
      for (const directionId of requiredDirectionIds) {
        const expected = direction(directionId);
        const runDirection = (run?.directions ?? []).find(
          ({ directionId: actualDirectionId }) =>
            actualDirectionId === directionId,
        );
        const observation = directionObservation(
          runDirection,
          expected,
          actorId,
        );
        directions.push({
          profileId: profile?.profileId ?? null,
          actorId,
          ...observation,
        });
      }
    }
  }

  const complete =
    coverage.hasAllProfiles &&
    coverage.hasAllRuns &&
    coverage.hasAllDirections &&
    coverage.timelinesSynchronized &&
    directions.length > 0;
  const facingPass =
    complete && directions.every(({ movement }) => movement.pass);
  const bankPass = complete && directions.every(({ banks }) => banks.pass);
  const aimPass = complete && directions.every(({ aim }) => aim.pass);
  const actionPass =
    complete &&
    directions.every(
      ({ action, ability }) => action.originPass && ability.originPass,
    );
  const recoveryPass =
    complete && directions.every(({ recovery }) => recovery.pass);

  if (!facingPass) failures.push("stale-facing-bank");
  if (!bankPass) {
    if (directions.some(({ banks }) => !banks.movement.spriteMatches))
      failures.push("sprite-bank-mismatch");
    if (
      directions.some(
        ({ expected, banks }) =>
          expected?.facing === "west" && !banks.movement.reflectionMatches,
      )
    )
      failures.push("west-reflection-missing");
    if (directions.some(({ banks }) => !banks.turn.matches))
      failures.push("stale-facing-bank");
    if (
      directions.some(
        ({ banks }) =>
          !banks.actionBefore.matches || !banks.actionAfter.matches,
      )
    )
      failures.push("sprite-bank-mismatch");
  }
  if (!aimPass) failures.push("target-aim-not-mirrored");
  if (!actionPass) failures.push("attack-origin-not-mirrored");
  if (!recoveryPass) failures.push("ability-recovery-mismatch");

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    signals: [
      signal("facing-follows-intent", facingPass, { directions }),
      signal("bank-and-reflection-match", bankPass, { directions }),
      signal("target-aim-follows-intent", aimPass, { directions }),
      signal("action-origin-mirrors", actionPass, { directions }),
      signal("ability-recovery-is-contiguous", recoveryPass, { directions }),
    ],
    actors: [...requiredActorIds],
    directions: [...requiredDirectionIds],
    profiles: coverage.selectedProfiles.map(
      (profile) => profile?.profileId ?? null,
    ),
    coverage: {
      hasAllProfiles: coverage.hasAllProfiles,
      hasAllRuns: coverage.hasAllRuns,
      hasAllDirections: coverage.hasAllDirections,
      expectedRuns: coverage.expectedRuns,
      actualRuns: coverage.actualRunCount,
      timelinesSynchronized: coverage.timelinesSynchronized,
      knownProfileIds: [...coverage.profileMap.keys()],
    },
  };
}
