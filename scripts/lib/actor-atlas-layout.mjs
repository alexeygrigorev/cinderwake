const LAYOUT_FAILURES = [
  "registered-bank-missing",
  "clip-facing-cell-map-mismatch",
  "character-layout-schema-mismatch",
];

export const ACTOR_ATLAS_LAYOUT_FAILURE_IDS = LAYOUT_FAILURES;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function sameRect(first, second) {
  return (
    isObject(first) &&
    isObject(second) &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function sameValues(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function pushFailure(failures, code, detail) {
  failures.push({ code, detail });
}

function expectedSpriteId(actor, facing) {
  const base = `${actor.role}:${actor.id}`;
  return `${base}${facing.spriteSuffix}`;
}

function expectedSourceKey(facing, clip) {
  return facing.sourceGroup === "clips"
    ? clip.id
    : `${facing.sourceKeyPrefix}${capitalize(clip.id)}`;
}

function expectedSourceEntry(spec, facing, clip) {
  return spec[facing.sourceGroup]?.[expectedSourceKey(facing, clip)];
}

function expectedFrameRect(spec, row, frameIndex) {
  return {
    x: frameIndex * spec.atlas.cellWidth,
    y: row * spec.atlas.cellHeight,
    width: spec.atlas.cellWidth,
    height: spec.atlas.cellHeight,
  };
}

function contractSchemaFailures(spec, contract) {
  const failures = [];
  const expectedAtlas = contract.atlas ?? {};
  for (const key of [
    "pixelWidth",
    "pixelHeight",
    "columns",
    "rows",
    "cellWidth",
    "cellHeight",
  ])
    if (spec.atlas?.[key] !== expectedAtlas[key])
      pushFailure(failures, "character-layout-schema-mismatch", {
        area: "atlas",
        key,
        expected: expectedAtlas[key],
        actual: spec.atlas?.[key],
      });

  const specClips = Object.entries(spec.clips ?? {}).map(([id, clip]) => ({
    id,
    frameCount: clip.sourceFrames?.length,
    durationTicks: clip.durationTicks,
    looping: clip.looping,
  }));
  if (JSON.stringify(specClips) !== JSON.stringify(contract.clips))
    pushFailure(failures, "character-layout-schema-mismatch", {
      area: "clips",
      expected: contract.clips,
      actual: specClips,
    });

  const actorIds = (contract.actors ?? []).map(({ id }) => id);
  if (new Set(actorIds).size !== actorIds.length)
    pushFailure(failures, "character-layout-schema-mismatch", {
      area: "actors",
      reason: "duplicate-actor-id",
    });
  const facingIds = (contract.facings ?? []).map(({ id }) => id);
  if (new Set(facingIds).size !== facingIds.length)
    pushFailure(failures, "character-layout-schema-mismatch", {
      area: "facings",
      reason: "duplicate-facing-id",
    });
  return failures;
}

function expectedActorSpriteIds(contract) {
  return (contract.actors ?? []).flatMap((actor) =>
    (contract.facings ?? []).map((facing) => expectedSpriteId(actor, facing)),
  );
}

function actorSpriteIds(catalog, contract) {
  const actorPrefixes = new Set(
    (contract.actors ?? []).map(({ role }) => `${role}:`),
  );
  return Object.keys(catalog?.sprites ?? {}).filter((id) =>
    [...actorPrefixes].some((prefix) => id.startsWith(prefix)),
  );
}

/**
 * Validate the production actor registry against the canonical atlas layout.
 * The catalog is the actual runtime registry; the art spec is the source-row
 * contract; and the versioned layout contract freezes the family schema.
 */
export function validateActorAtlasLayout({ catalog, spec, contract }) {
  const failures = contractSchemaFailures(spec, contract);
  const mappings = [];
  const expectedIds = expectedActorSpriteIds(contract);
  const expectedIdSet = new Set(expectedIds);
  const actualIds = actorSpriteIds(catalog, contract);
  const actualIdSet = new Set(actualIds);

  for (const spriteId of expectedIdSet)
    if (!actualIdSet.has(spriteId))
      pushFailure(failures, "registered-bank-missing", { spriteId });
  for (const spriteId of actualIds)
    if (!expectedIdSet.has(spriteId))
      pushFailure(failures, "character-layout-schema-mismatch", {
        spriteId,
        reason: "unlisted-actor-sprite",
      });

  const clips = contract.clips ?? [];
  for (const actor of contract.actors ?? []) {
    const expectedAssetId = `atlas:actor:${actor.id}`;
    const asset = catalog?.assets?.[expectedAssetId];
    if (!asset)
      pushFailure(failures, "registered-bank-missing", {
        actorId: actor.id,
        assetId: expectedAssetId,
      });
    else if (
      asset.pixelWidth !== contract.atlas.pixelWidth ||
      asset.pixelHeight !== contract.atlas.pixelHeight
    )
      pushFailure(failures, "character-layout-schema-mismatch", {
        actorId: actor.id,
        assetId: expectedAssetId,
        expected: {
          width: contract.atlas.pixelWidth,
          height: contract.atlas.pixelHeight,
        },
        actual: { width: asset.pixelWidth, height: asset.pixelHeight },
      });

    for (const facing of contract.facings ?? []) {
      const spriteId = expectedSpriteId(actor, facing);
      const sprite = catalog?.sprites?.[spriteId];
      if (!sprite) continue;
      if (sprite.assetId !== expectedAssetId)
        pushFailure(failures, "character-layout-schema-mismatch", {
          spriteId,
          expectedAssetId,
          actualAssetId: sprite.assetId,
        });

      const actualClipIds = Object.keys(sprite.clips ?? {});
      const expectedClipIds = clips.map(({ id }) => id);
      if (!sameValues(actualClipIds, expectedClipIds))
        pushFailure(failures, "character-layout-schema-mismatch", {
          spriteId,
          area: "clip-set",
          expected: expectedClipIds,
          actual: actualClipIds,
        });

      for (const clip of clips) {
        const actualClip = sprite.clips?.[clip.id];
        const source = expectedSourceEntry(spec, facing, clip);
        const row = source?.atlasRow;
        const expectedFrameIdentities = Array.from(
          { length: clip.frameCount },
          (_, index) => `${spriteId}:${clip.id}:${index}`,
        );
        const mapping = {
          actorId: actor.id,
          role: actor.role,
          facing: facing.id,
          clip: clip.id,
          spriteId,
          assetId: expectedAssetId,
          sourceGroup: facing.sourceGroup,
          sourceKey: expectedSourceKey(facing, clip),
          atlasRow: row ?? null,
          frameCount: clip.frameCount,
          frameIdentities: expectedFrameIdentities,
          frameRects: [],
        };
        mappings.push(mapping);
        if (!source || !Number.isInteger(row)) {
          pushFailure(failures, "clip-facing-cell-map-mismatch", {
            spriteId,
            facing: facing.id,
            clip: clip.id,
            reason: "missing-source-row",
          });
          continue;
        }
        if (!actualClip) {
          pushFailure(failures, "clip-facing-cell-map-mismatch", {
            spriteId,
            facing: facing.id,
            clip: clip.id,
            reason: "missing-runtime-clip",
          });
          continue;
        }
        if (
          actualClip.durationTicks !== clip.durationTicks ||
          actualClip.looping !== clip.looping ||
          !sameValues(actualClip.frameIdentities, expectedFrameIdentities)
        )
          pushFailure(failures, "character-layout-schema-mismatch", {
            spriteId,
            clip: clip.id,
            expected: clip,
            actual: actualClip,
          });

        for (let frameIndex = 0; frameIndex < clip.frameCount; frameIndex++) {
          const expectedRect = expectedFrameRect(spec, row, frameIndex);
          mapping.frameRects.push(expectedRect);
          const frameIdentity = expectedFrameIdentities[frameIndex];
          if (!sameRect(sprite.frames?.[frameIdentity], expectedRect))
            pushFailure(failures, "clip-facing-cell-map-mismatch", {
              spriteId,
              facing: facing.id,
              clip: clip.id,
              frameIndex,
              expectedRect,
              actualRect: sprite.frames?.[frameIdentity] ?? null,
            });
        }
      }
      const expectedFrameIds = expectedFrameIdsForSprite(sprite, clips);
      const expectedFrameSet = new Set(expectedFrameIds);
      const actualFrameIds = Object.keys(sprite.frames ?? {});
      if (
        actualFrameIds.length !== expectedFrameIds.length ||
        actualFrameIds.some((frameId) => !expectedFrameSet.has(frameId))
      )
        pushFailure(failures, "clip-facing-cell-map-mismatch", {
          spriteId,
          reason: "orphan-frame-identity",
        });
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    summary: {
      expectedActors: (contract.actors ?? []).length,
      expectedFacings: (contract.facings ?? []).length,
      expectedClips: clips.length,
      expectedSpriteCount: expectedIdSet.size,
      actualActorSpriteCount: actualIds.length,
      expectedBankCount: expectedIds.length * clips.length,
      mappedBankCount: mappings.length,
      expectedFrameCount: expectedIds.reduce(
        (total) =>
          total + clips.reduce((count, clip) => count + clip.frameCount, 0),
        0,
      ),
    },
    mappings,
  };
}

function expectedFrameIdsForSprite(sprite, clips) {
  return clips.flatMap(({ id, frameCount }) =>
    Array.from(
      { length: frameCount },
      (_, index) => `${sprite.id}:${id}:${index}`,
    ),
  );
}

export function runActorAtlasLayoutNegativeControls(input) {
  const definitions = [
    {
      id: "registered-bank-omitted",
      expectedSignal: "registered-bank-missing",
      mutate(value) {
        const actor = value.contract.actors[0];
        const facing = value.contract.facings[2];
        delete value.catalog.sprites[expectedSpriteId(actor, facing)];
      },
    },
    {
      id: "clip-facing-map-swapped",
      expectedSignal: "clip-facing-cell-map-mismatch",
      mutate(value) {
        const actor = value.contract.actors[0];
        const facing = value.contract.facings[2];
        const clip = value.contract.clips.find(({ id }) => id === "walk");
        const spriteId = expectedSpriteId(actor, facing);
        const identity = `${spriteId}:walk:0`;
        const source = expectedSourceEntry(
          value.spec,
          value.contract.facings[3],
          clip,
        );
        value.catalog.sprites[spriteId].frames[identity].y =
          source.atlasRow * value.spec.atlas.cellHeight;
      },
    },
    {
      id: "playable-layout-schema-diverged",
      expectedSignal: "character-layout-schema-mismatch",
      mutate(value) {
        delete value.catalog.sprites["hero:vanguard"].clips.ability;
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const candidate = {
      catalog: structuredClone(input.catalog),
      spec: input.spec,
      contract: input.contract,
    };
    mutate(candidate);
    const assessment = validateActorAtlasLayout(candidate);
    const detected = assessment.failures.some(
      ({ code }) => code === expectedSignal,
    );
    return {
      id,
      expectedSignal,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      detected,
      failures: assessment.failures,
    };
  });
}
