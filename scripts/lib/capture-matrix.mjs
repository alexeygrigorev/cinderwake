export function selectMatrixEntryIds(entryIds, onlyValue) {
  if (!onlyValue) return [...entryIds];

  const requestedIds = onlyValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unknownIds = requestedIds.filter((id) => !entryIds.includes(id));
  const duplicateIds = requestedIds.filter(
    (id, index) => requestedIds.indexOf(id) !== index,
  );

  if (requestedIds.length === 0)
    throw new Error("--only requires at least one matrix entry ID");
  if (unknownIds.length > 0)
    throw new Error(
      `Unknown --only matrix entry ID(s): ${[...new Set(unknownIds)].join(", ")}`,
    );
  if (duplicateIds.length > 0)
    throw new Error(
      `Duplicate --only matrix entry ID(s): ${[...new Set(duplicateIds)].join(", ")}`,
    );

  return requestedIds;
}

export function isReusableMatrixEntry({
  catalogEntry,
  analysisPass,
  metadata,
  requiredFilesPresent,
  source,
  expectedCaptureId,
}) {
  return (
    catalogEntry?.pass === true &&
    analysisPass === true &&
    metadata?.captureId === expectedCaptureId &&
    metadata?.sourceCommit === source.commit &&
    metadata?.sourceDirty === source.dirty &&
    metadata?.sourcePatchSha256 === source.patchSha256 &&
    requiredFilesPresent === true
  );
}

export function pendingMatrixEntry(entry) {
  return {
    id: entry.id,
    label: entry.label,
    category: entry.category,
    scenario: entry.scenario,
    trackedEntityId: entry.track,
    profile: entry.profile,
    pass: false,
    checks: {},
    measurements: {},
    clipTransitionContract: null,
    negativeControls: [],
    sourceCommit: null,
    report: null,
    contactSheet: null,
    metadata: `${entry.id}/metadata.json`,
    analysis: `${entry.id}/animation-analysis.json`,
  };
}

export function mergeMatrixEntries(entries, existingEntries, capturedEntries) {
  const byId = new Map(
    (existingEntries ?? []).map((entry) => [entry.id, entry]),
  );
  for (const entry of capturedEntries) byId.set(entry.id, entry);
  return entries.map(
    (entry) => byId.get(entry.id) ?? pendingMatrixEntry(entry),
  );
}
