import { createHash } from "node:crypto";

export const STATE_REPLAY_SIGNAL_IDS = [
  "loaded-state-matches",
  "reset-isolates-runs",
  "replay-state-hashes-match",
  "replay-manifest-frame-hashes-match",
];

export const STATE_REPLAY_FAILURE_IDS = [
  "loaded-state-mismatch",
  "reset-isolation-failed",
  "replay-state-hash-mismatch",
  "replay-manifest-hash-mismatch",
  "replay-frame-hash-mismatch",
  "evidence-timeline-desynchronized",
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

/** JSON encoding with object-key order removed as a source of evidence drift. */
export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value) {
  return sha256(stableJson(value));
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function timelineTicks(timeline) {
  return timeline.map((entry) => entry.tick);
}

function timelineIsSynchronized(timeline, declaredTicks) {
  if (!Array.isArray(timeline) || !Array.isArray(declaredTicks)) return false;
  if (timeline.length !== declaredTicks.length) return false;
  return timeline.every(
    (entry, index) =>
      Number.isInteger(entry.tick) &&
      entry.tick === entry.stateTick &&
      entry.tick === entry.manifestTick &&
      entry.tick === declaredTicks[index],
  );
}

function sameHashes(first, second, property) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every((entry, index) => entry[property] === second[index]?.[property])
  );
}

function firstHashMismatch(first, second, property) {
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    if (first[index]?.[property] !== second[index]?.[property])
      return first[index]?.tick ?? second[index]?.tick ?? null;
  }
  return null;
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * Compare the complete browser evidence bundle for PRES-STATE-028.
 *
 * The function intentionally accepts hashes rather than image bytes so that
 * the same decision logic can run in the recorder and in cheap unit tests.
 */
export function evaluateStateReplayEvidence({
  initialState,
  initialStateHash,
  loaded,
  reset,
  replayA,
  replayB,
}) {
  const failures = [];
  const loadedStateMatches = sameJson(initialState, loaded?.snapshot);
  if (!loadedStateMatches) failures.push("loaded-state-mismatch");
  if (initialStateHash && loaded?.stateHash !== initialStateHash)
    failures.push("loaded-state-mismatch");

  const resetIsolated =
    sameJson(loaded?.snapshot, reset?.snapshot) &&
    loaded?.stateHash === reset?.stateHash &&
    loaded?.manifestHash === reset?.manifestHash &&
    loaded?.frameHash === reset?.frameHash;
  if (!resetIsolated) failures.push("reset-isolation-failed");

  const declaredTicks = replayA?.declaredTicks ?? [];
  const firstTimeline = replayA?.timeline ?? [];
  const secondTimeline = replayB?.timeline ?? [];
  const timelineSynchronized =
    timelineIsSynchronized(firstTimeline, declaredTicks) &&
    timelineIsSynchronized(secondTimeline, declaredTicks) &&
    sameJson(timelineTicks(firstTimeline), timelineTicks(secondTimeline));
  if (!timelineSynchronized) failures.push("evidence-timeline-desynchronized");

  const stateHashesMatch =
    timelineSynchronized &&
    sameHashes(firstTimeline, secondTimeline, "stateHash");
  if (!stateHashesMatch) failures.push("replay-state-hash-mismatch");

  const manifestHashesMatch =
    timelineSynchronized &&
    sameHashes(firstTimeline, secondTimeline, "manifestHash");
  if (!manifestHashesMatch) failures.push("replay-manifest-hash-mismatch");

  const frameHashesMatch =
    timelineSynchronized &&
    sameHashes(firstTimeline, secondTimeline, "frameHash");
  if (!frameHashesMatch) failures.push("replay-frame-hash-mismatch");

  const signals = [
    signal("loaded-state-matches", loadedStateMatches, {
      expectedStateHash: initialStateHash ?? null,
      actualStateHash: loaded?.stateHash ?? null,
    }),
    signal("reset-isolates-runs", resetIsolated, {
      loadedTick: loaded?.snapshot?.tick ?? null,
      resetTick: reset?.snapshot?.tick ?? null,
    }),
    signal("replay-state-hashes-match", stateHashesMatch, {
      firstMismatchTick: firstHashMismatch(
        firstTimeline,
        secondTimeline,
        "stateHash",
      ),
    }),
    signal(
      "replay-manifest-frame-hashes-match",
      manifestHashesMatch && frameHashesMatch,
      {
        firstManifestMismatchTick: firstHashMismatch(
          firstTimeline,
          secondTimeline,
          "manifestHash",
        ),
        firstFrameMismatchTick: firstHashMismatch(
          firstTimeline,
          secondTimeline,
          "frameHash",
        ),
      },
    ),
  ];

  return {
    pass: failures.length === 0,
    signals,
    failures: [...new Set(failures)],
    timeline: {
      declaredTicks,
      firstTicks: timelineTicks(firstTimeline),
      secondTicks: timelineTicks(secondTimeline),
      synchronized: timelineSynchronized,
    },
  };
}
