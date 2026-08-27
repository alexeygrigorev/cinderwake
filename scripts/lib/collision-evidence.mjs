export const COLLISION_SCENARIO_IDS = [
  "scenery-contact",
  "projectile-scenery-contact",
  "embercross-solid-objects",
];

export const COLLISION_GESTURE_IDS = [
  "walk-into-solid",
  "tap-route-into-solid",
  "fire-through-solid",
];

export const COLLISION_SIDE_IDS = ["north", "east", "south", "west"];

export const COLLISION_TOPOLOGY_EXEMPTION = "map-blocked-boundary";

const MAP_BLOCKED_BOUNDARY_OBJECT_ID =
  /^architecture:opening:(?:north-wall|backdrop:[0-2]:(?:gatehouse|chapel|watchtower))$/;

export function isMapBlockedBoundaryObjectId(objectId) {
  return (
    typeof objectId === "string" &&
    MAP_BLOCKED_BOUNDARY_OBJECT_ID.test(objectId)
  );
}

export const COLLISION_SIGNAL_IDS = [
  "solid-support-blocks",
  "blocked-object-visible",
  "swept-contact-holds",
  "principal-sides-covered",
];

export const COLLISION_FAILURE_IDS = [
  "scenario-coverage-missing",
  "gesture-coverage-missing",
  "solid-inventory-missing",
  "contact-evidence-missing",
  "contact-started-inside-solid",
  "solid-overlap",
  "contact-did-not-enter-solid",
  "contact-side-invalid",
  "contact-side-coverage-missing",
  "contact-side-exemption-invalid",
  "blocked-feedback-missing",
  "slide-stalled",
  "collider-support-mismatch",
  "invisible-collision",
  "projectile-evidence-missing",
  "projectile-endpoint-not-floor-backed",
  "swept-contact-missed",
  "projectile-damaged-through-solid",
];

export const COLLISION_LIMITS = {
  supportAllowancePixels: 15,
  verticalSupportAllowancePixels: 24,
  minimumSlideDistance: 8,
  minimumImpactFraction: 0.01,
  maximumImpactFraction: 0.99,
  maximumImpactPositionError: 4,
  unitsPerTile: 1024,
  pixelsPerTile: 48,
  logicalCenter: { x: 480, y: 270 },
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function point(value) {
  return object(value) && finite(value.x) && finite(value.y) ? value : null;
}

function bounds(value) {
  return object(value) &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    finite(value.height) &&
    value.width > 0 &&
    value.height > 0
    ? value
    : null;
}

function collision(value) {
  return object(value) &&
    value.mode === "solid" &&
    value.shape === "ellipse" &&
    point(value.worldCenter) &&
    finite(value.halfWidth) &&
    finite(value.halfHeight) &&
    value.halfWidth > 0 &&
    value.halfHeight > 0
    ? value
    : null;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function profilesFor(evidence) {
  if (Array.isArray(evidence?.profiles)) return evidence.profiles;
  return evidence ? [evidence] : [];
}

function scenariosFor(profile) {
  return Array.isArray(profile?.scenarios) ? profile.scenarios : [];
}

function solidsFor(profile) {
  return scenariosFor(profile).flatMap((scenario) =>
    Array.isArray(scenario?.solids)
      ? scenario.solids.map((solid) => ({
          ...solid,
          scenarioId: scenario.id,
          profileId: profile.profileId,
        }))
      : [],
  );
}

function contactsFor(profile) {
  return scenariosFor(profile).flatMap((scenario) =>
    Array.isArray(scenario?.contacts)
      ? scenario.contacts.map((contact) => ({
          ...contact,
          scenarioId: scenario.id,
          profileId: profile.profileId,
        }))
      : [],
  );
}

function projectilesFor(profile) {
  return scenariosFor(profile).flatMap((scenario) =>
    Array.isArray(scenario?.projectiles)
      ? scenario.projectiles.map((projectile) => ({
          ...projectile,
          scenarioId: scenario.id,
          profileId: profile.profileId,
        }))
      : [],
  );
}

function overlap(pointValue, radius, footprint) {
  if (!point(pointValue) || !finite(radius) || radius < 0) return null;
  const horizontal = footprint.halfWidth + radius;
  const vertical = footprint.halfHeight + radius;
  if (horizontal <= 0 || vertical <= 0) return null;
  const x = (pointValue.x - footprint.worldCenter.x) / horizontal;
  const y = (pointValue.y - footprint.worldCenter.y) / vertical;
  return x * x + y * y <= 1 + 1e-9;
}

function screenPoint(world, camera) {
  if (
    !point(world) ||
    !object(camera) ||
    !finite(camera.x) ||
    !finite(camera.y)
  )
    return null;
  const zoom = finite(camera.zoom) ? camera.zoom : 1;
  return {
    x:
      COLLISION_LIMITS.logicalCenter.x +
      ((world.x / COLLISION_LIMITS.unitsPerTile) *
        COLLISION_LIMITS.pixelsPerTile -
        camera.x) *
        zoom,
    y:
      COLLISION_LIMITS.logicalCenter.y +
      ((world.y / COLLISION_LIMITS.unitsPerTile) *
        COLLISION_LIMITS.pixelsPerTile -
        camera.y) *
        zoom,
  };
}

function projectedBounds(solid) {
  const camera = solid.camera;
  const parts = [solid.collision, ...(solid.collisionParts ?? [])]
    .map((part) => collision(part))
    .filter(Boolean);
  if (!object(camera) || parts.length === 0) return null;
  const zoom = finite(camera.zoom) ? camera.zoom : 1;
  const values = parts.map((part) => {
    const center = screenPoint(part.worldCenter, camera);
    const scale =
      (COLLISION_LIMITS.pixelsPerTile / COLLISION_LIMITS.unitsPerTile) * zoom;
    return {
      left: center.x - part.halfWidth * scale,
      top: center.y - part.halfHeight * scale,
      right: center.x + part.halfWidth * scale,
      bottom: center.y + part.halfHeight * scale,
    };
  });
  return {
    x: Math.min(...values.map(({ left }) => left)),
    y: Math.min(...values.map(({ top }) => top)),
    width:
      Math.max(...values.map(({ right }) => right)) -
      Math.min(...values.map(({ left }) => left)),
    height:
      Math.max(...values.map(({ bottom }) => bottom)) -
      Math.min(...values.map(({ top }) => top)),
  };
}

function supportPass(solid) {
  const support = object(solid.support);
  const alphaBounds = bounds(support?.bounds);
  const projected = projectedBounds(solid);
  if (solid.visible !== true || !alphaBounds || !projected) {
    return {
      pass: false,
      failure:
        solid.visible === true
          ? "collider-support-mismatch"
          : "invisible-collision",
      detail: { objectId: solid.objectId ?? null },
    };
  }
  if (
    support.source !== "alpha-mask" ||
    !finite(support.alphaPixels) ||
    support.alphaPixels <= 0
  ) {
    return {
      pass: false,
      failure: "invisible-collision",
      detail: { objectId: solid.objectId ?? null },
    };
  }
  const horizontalAllowance = COLLISION_LIMITS.supportAllowancePixels;
  const verticalAllowance = COLLISION_LIMITS.verticalSupportAllowancePixels;
  const pass =
    projected.x >= alphaBounds.x - horizontalAllowance &&
    projected.y >= alphaBounds.y - verticalAllowance &&
    projected.x + projected.width <=
      alphaBounds.x + alphaBounds.width + horizontalAllowance &&
    projected.y + projected.height <=
      alphaBounds.y + alphaBounds.height + verticalAllowance;
  return {
    pass,
    failure: pass ? null : "collider-support-mismatch",
    detail: {
      objectId: solid.objectId ?? null,
      alphaBounds,
      projectedBounds: projected,
      horizontalAllowancePixels: horizontalAllowance,
      verticalAllowancePixels: verticalAllowance,
    },
  };
}

function contactCollision(contact, solids) {
  const direct = collision(contact.collision);
  if (direct) return direct;
  return solids.find(
    (solid) =>
      solid.objectId === contact.objectId && collision(solid.collision),
  )?.collision;
}

function contactPass(contact, solids) {
  const footprint = contactCollision(contact, solids);
  const radius = contact.radius;
  const approach = object(contact.approach);
  const slide = object(contact.slide);
  const before = point(approach?.from ?? contact.beforePosition);
  const attempted = point(approach?.attemptedPosition);
  const blocked = point(contact.blockedPosition ?? contact.afterPosition);
  const slideFrom = point(slide?.from);
  const slideTo = point(slide?.to);
  if (!footprint || !finite(radius) || !before || !attempted || !blocked) {
    return {
      failures: ["contact-evidence-missing"],
      detail: { objectId: contact.objectId ?? null },
    };
  }
  const failures = [];
  if (!COLLISION_SIDE_IDS.includes(contact.side))
    failures.push("contact-side-invalid");
  if (overlap(before, radius, footprint))
    failures.push("contact-started-inside-solid");
  if (overlap(blocked, radius, footprint))
    failures.push(`solid-overlap:${contact.objectId ?? "unknown"}`);
  if (!overlap(attempted, radius, footprint))
    failures.push(
      `contact-did-not-enter-solid:${contact.objectId ?? "unknown"}`,
    );

  const feedback = object(contact.feedback);
  const event = feedback?.event;
  const expectedName = contact.objectName ?? contact.name;
  const eventPass =
    object(event)?.type === "movement_blocked" &&
    event.sourceId === "player" &&
    event.targetId === contact.objectId &&
    typeof event.detail === "string" &&
    event.detail === expectedName;
  const logPass =
    typeof feedback?.log === "string" &&
    feedback.log.includes(`Blocked: ${expectedName}`);
  if (eventPass !== true || feedback?.impactVisible !== true || !logPass)
    failures.push("blocked-feedback-missing");

  if (!slideFrom || !slideTo) failures.push("slide-stalled");
  else if (
    Math.hypot(slideTo.x - slideFrom.x, slideTo.y - slideFrom.y) <
    COLLISION_LIMITS.minimumSlideDistance
  )
    failures.push("slide-stalled");
  else if (overlap(slideTo, radius, footprint))
    failures.push(`solid-overlap:${contact.objectId ?? "unknown"}`);

  return {
    failures,
    detail: {
      objectId: contact.objectId ?? null,
      attemptedPosition: attempted,
      blockedPosition: blocked,
      slideDistance:
        slideFrom && slideTo
          ? Math.hypot(slideTo.x - slideFrom.x, slideTo.y - slideFrom.y)
          : 0,
    },
  };
}

function sideCoveragePass(solid, contacts) {
  const declaration = object(solid.contactCoverage);
  const principalSides = unique(declaration?.principalSides ?? []);
  const requiredSides = unique(declaration?.requiredSides ?? []).filter(
    (side) => COLLISION_SIDE_IDS.includes(side),
  );
  const skippedSides = object(declaration?.skippedSides) ?? {};
  const selected = declaration?.selected === true;
  const topologyExemption = declaration?.exemption;
  const mapBlockedBoundary = isMapBlockedBoundaryObjectId(solid.objectId);
  const validTopologyExemption =
    mapBlockedBoundary && topologyExemption === COLLISION_TOPOLOGY_EXEMPTION;
  const failures = [];
  if (!declaration) {
    failures.push(
      `contact-side-coverage-missing:${solid.objectId ?? "unknown"}:declaration`,
    );
  }
  if (!COLLISION_SIDE_IDS.every((side) => principalSides.includes(side)))
    failures.push(
      `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:principal-sides`,
    );
  if (
    topologyExemption !== undefined &&
    (!mapBlockedBoundary || topologyExemption !== COLLISION_TOPOLOGY_EXEMPTION)
  )
    failures.push(
      `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:exemption`,
    );
  if (!selected && !validTopologyExemption)
    failures.push(
      `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:selection`,
    );
  if (validTopologyExemption && selected)
    failures.push(
      `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:selection`,
    );
  if (validTopologyExemption && requiredSides.length > 0)
    failures.push(
      `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:required-sides`,
    );
  if (selected && requiredSides.length === 0)
    failures.push(
      `contact-side-coverage-missing:${solid.objectId ?? "unknown"}:no-recorded-side`,
    );
  const belongsToSolid = (contact) =>
    contact.objectId === solid.objectId &&
    contact.profileId === solid.profileId &&
    contact.scenarioId === solid.scenarioId;
  for (const side of COLLISION_SIDE_IDS) {
    const hasContact = contacts.some(
      (contact) => belongsToSolid(contact) && contact.side === side,
    );
    const skipped = skippedSides[side];
    if (hasContact && (!requiredSides.includes(side) || skipped !== undefined))
      failures.push(
        `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:${side}`,
      );
    else if (!hasContact && !requiredSides.includes(side)) {
      if (typeof skipped !== "string" || skipped.length === 0)
        failures.push(
          `contact-side-coverage-missing:${solid.objectId ?? "unknown"}:${side}`,
        );
    }
    if (
      skipped !== undefined &&
      (typeof skipped !== "string" || skipped.length === 0)
    )
      failures.push(
        `contact-side-exemption-invalid:${solid.objectId ?? "unknown"}:${side}`,
      );
  }
  for (const side of requiredSides) {
    if (
      !contacts.some(
        (contact) => belongsToSolid(contact) && contact.side === side,
      )
    )
      failures.push(
        `contact-side-coverage-missing:${solid.objectId ?? "unknown"}:${side}`,
      );
  }
  return {
    failures: [...new Set(failures)],
    detail: {
      objectId: solid.objectId ?? null,
      principalSides: COLLISION_SIDE_IDS,
      requiredSides,
      skippedSides,
      observedSides: COLLISION_SIDE_IDS.filter((side) =>
        contacts.some(
          (contact) => belongsToSolid(contact) && contact.side === side,
        ),
      ),
      selected,
      topologyExemption: topologyExemption ?? null,
      mapBlockedBoundary,
    },
  };
}

function projectilePass(projectile) {
  const from = point(projectile.from);
  const to = point(projectile.to);
  const impact = object(projectile.impact);
  const impactPosition = point(impact?.position);
  const failures = [];
  if (
    !from ||
    !to ||
    !finite(projectile.radius) ||
    !impact ||
    !impactPosition
  ) {
    return { failures: ["projectile-evidence-missing"], detail: {} };
  }
  if (projectile.endpointsFloorBacked !== true)
    failures.push("projectile-endpoint-not-floor-backed");
  if (
    projectile.removed !== true ||
    (Array.isArray(projectile.projectileIdsAfter) &&
      projectile.projectileIdsAfter.includes(projectile.projectileId))
  )
    failures.push("swept-contact-missed");
  const t = impact.t;
  const pathLength = Math.hypot(to.x - from.x, to.y - from.y);
  const expected =
    finite(t) && t >= 0 && t <= 1
      ? { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
      : null;
  if (
    !finite(t) ||
    t < COLLISION_LIMITS.minimumImpactFraction ||
    t > COLLISION_LIMITS.maximumImpactFraction ||
    !expected ||
    Math.hypot(impactPosition.x - expected.x, impactPosition.y - expected.y) >
      COLLISION_LIMITS.maximumImpactPositionError ||
    pathLength <= 0
  )
    failures.push("swept-contact-missed");
  if (impact.visible !== true) failures.push("swept-contact-missed");
  const beforeHealth = projectile.targetHealthBefore;
  const afterHealth = projectile.targetHealthAfter;
  if (
    projectile.damageThroughSolid === true ||
    (finite(beforeHealth) && finite(afterHealth) && afterHealth < beforeHealth)
  )
    failures.push("projectile-damaged-through-solid");
  return {
    failures,
    detail: {
      projectileId: projectile.projectileId ?? null,
      objectId: projectile.objectId ?? null,
      impactFraction: finite(t) ? t : null,
      travelDistance: pathLength,
    },
  };
}

function coverage(evidence, profiles) {
  const scenarioIds = unique(
    profiles.flatMap((profile) => scenariosFor(profile).map(({ id }) => id)),
  );
  const gestureIds = unique(
    profiles.flatMap((profile) =>
      scenariosFor(profile).flatMap((scenario) => scenario.gestureIds ?? []),
    ),
  );
  const failures = [];
  for (const id of COLLISION_SCENARIO_IDS)
    if (!scenarioIds.includes(id))
      failures.push(`scenario-coverage-missing:${id}`);
  for (const id of COLLISION_GESTURE_IDS)
    if (!gestureIds.includes(id))
      failures.push(`gesture-coverage-missing:${id}`);
  return { failures, scenarioIds, gestureIds };
}

/** Pure evidence oracle for PRES-COLLIDE-008. */
export function evaluateCollisionEvidence(evidence) {
  const profiles = profilesFor(evidence);
  const solids = profiles.flatMap(solidsFor);
  const contacts = profiles.flatMap(contactsFor);
  const projectiles = profiles.flatMap(projectilesFor);
  const failures = coverage(evidence, profiles).failures;
  const supportDetails = [];
  if (solids.length === 0) failures.push("solid-inventory-missing");
  for (const solid of solids) {
    const result = supportPass(solid);
    supportDetails.push({
      profileId: solid.profileId ?? null,
      scenarioId: solid.scenarioId ?? null,
      ...result,
    });
    if (result.failure) failures.push(result.failure);
  }
  const contactDetails = [];
  if (contacts.length === 0) failures.push("contact-evidence-missing");
  for (const contact of contacts) {
    const result = contactPass(contact, solids);
    contactDetails.push({
      profileId: contact.profileId ?? null,
      scenarioId: contact.scenarioId ?? null,
      ...result,
    });
    failures.push(...result.failures);
  }
  const sideCoverageDetails = solids.map((solid) => {
    const result = sideCoveragePass(solid, contacts);
    failures.push(...result.failures);
    return {
      profileId: solid.profileId ?? null,
      scenarioId: solid.scenarioId ?? null,
      ...result,
    };
  });
  const projectileDetails = [];
  if (projectiles.length === 0) failures.push("projectile-evidence-missing");
  for (const projectile of projectiles) {
    const result = projectilePass(projectile);
    projectileDetails.push({
      profileId: projectile.profileId ?? null,
      scenarioId: projectile.scenarioId ?? null,
      ...result,
    });
    failures.push(...result.failures);
  }

  const distinctFailures = [...new Set(failures)];
  const hasFailure = (prefix) =>
    distinctFailures.some(
      (failure) => failure === prefix || failure.startsWith(`${prefix}:`),
    );
  const signals = [
    {
      id: "solid-support-blocks",
      pass:
        contacts.length > 0 &&
        contactDetails.every(({ failures: current }) =>
          current.every(
            (failure) =>
              ![
                "contact-evidence-missing",
                "contact-started-inside-solid",
                "blocked-feedback-missing",
                "slide-stalled",
              ].includes(failure) &&
              !failure.startsWith("solid-overlap:") &&
              !failure.startsWith("contact-did-not-enter-solid:"),
          ),
        ),
      detail: {
        contacts: contactDetails,
        count: contacts.length,
      },
    },
    {
      id: "blocked-object-visible",
      pass:
        solids.length > 0 &&
        supportDetails.every(({ pass }) => pass === true) &&
        !hasFailure("solid-inventory-missing"),
      detail: {
        solids: supportDetails,
        count: solids.length,
        supportAllowancePixels: COLLISION_LIMITS.supportAllowancePixels,
        verticalSupportAllowancePixels:
          COLLISION_LIMITS.verticalSupportAllowancePixels,
      },
    },
    {
      id: "swept-contact-holds",
      pass:
        projectiles.length > 0 &&
        projectileDetails.every(
          ({ failures: current }) => current.length === 0,
        ),
      detail: {
        projectiles: projectileDetails,
        count: projectiles.length,
      },
    },
    {
      id: "principal-sides-covered",
      pass:
        solids.length > 0 &&
        sideCoverageDetails.every(
          ({ failures: current }) => current.length === 0,
        ),
      detail: {
        solids: sideCoverageDetails,
        count: sideCoverageDetails.length,
        principalSides: COLLISION_SIDE_IDS,
      },
    },
  ];
  return {
    pass:
      distinctFailures.length === 0 &&
      signals.every(({ pass }) => pass === true),
    signals,
    failures: distinctFailures,
    summary: {
      profiles: profiles.map(({ profileId }) => profileId ?? null),
      scenarioIds: coverage(evidence, profiles).scenarioIds,
      gestureIds: coverage(evidence, profiles).gestureIds,
      solidCount: solids.length,
      contactCount: contacts.length,
      projectileCount: projectiles.length,
      principalSideCount: sideCoverageDetails.reduce(
        (count, detail) => count + detail.detail.observedSides.length,
        0,
      ),
    },
  };
}

function firstValue(evidence, selector) {
  for (const profile of profilesFor(evidence)) {
    for (const scenario of scenariosFor(profile)) {
      const value = selector(scenario);
      if (value) return value;
    }
  }
  return null;
}

/** Exercise every named PRES-COLLIDE-008 detector against retained evidence. */
export function runCollisionNegativeControls(evidence) {
  const definitions = [
    {
      id: "collider-enlarged-or-offset",
      expectedSignal: "collider-support-mismatch",
      mutate(value) {
        const solid = firstValue(value, (scenario) => scenario.solids?.[0]);
        if (!solid) return;
        solid.collision.halfWidth *= 4;
      },
    },
    {
      id: "collision-without-visible-sprite",
      expectedSignal: "invisible-collision",
      mutate(value) {
        const solid = firstValue(value, (scenario) => scenario.solids?.[0]);
        if (solid) solid.visible = false;
      },
    },
    {
      id: "blocked-feedback-removed",
      expectedSignal: "blocked-feedback-missing",
      mutate(value) {
        const contact = firstValue(value, (scenario) => scenario.contacts?.[0]);
        if (contact) contact.feedback = { impactVisible: false, log: "" };
      },
    },
    {
      id: "endpoint-only-collision",
      expectedSignal: "swept-contact-missed",
      mutate(value) {
        const projectile = firstValue(
          value,
          (scenario) => scenario.projectiles?.[0],
        );
        if (projectile) projectile.impact.t = 1;
      },
    },
    {
      id: "principal-side-omitted",
      expectedSignal: "contact-side-coverage-missing",
      mutate(value) {
        for (const profile of profilesFor(value)) {
          for (const scenario of scenariosFor(profile)) {
            const solid = scenario.solids?.find(
              (candidate) =>
                Array.isArray(candidate.contactCoverage?.requiredSides) &&
                candidate.contactCoverage.requiredSides.length > 0,
            );
            const side = solid?.contactCoverage?.requiredSides?.[0];
            if (!solid || !side) continue;
            scenario.contacts = (scenario.contacts ?? []).filter(
              (contact) =>
                !(contact.objectId === solid.objectId && contact.side === side),
            );
            return;
          }
        }
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateCollisionEvidence(mutated);
    const detected = result.failures.some(
      (failure) =>
        failure === expectedSignal || failure.startsWith(`${expectedSignal}:`),
    );
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: result.failures,
    };
  });
}
