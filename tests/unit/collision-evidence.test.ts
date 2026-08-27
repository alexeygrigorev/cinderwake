import { describe, expect, it } from "vitest";
import {
  COLLISION_TOPOLOGY_EXEMPTION,
  evaluateCollisionEvidence,
  runCollisionNegativeControls,
} from "../../scripts/lib/collision-evidence.mjs";

function collision(center = { x: 1000, y: 1000 }) {
  return {
    mode: "solid",
    shape: "ellipse",
    worldCenter: center,
    halfWidth: 120,
    halfHeight: 100,
  };
}

function solid() {
  return {
    objectId: "prop:crate",
    objectName: "crate",
    visible: true,
    camera: { x: 0, y: 0, zoom: 1 },
    collision: collision(),
    contactCoverage: {
      principalSides: ["north", "east", "south", "west"],
      requiredSides: ["north", "east", "south", "west"],
      skippedSides: {},
      selected: true,
      scope: "exhaustive-cardinal-matrix",
    },
    support: {
      source: "alpha-mask",
      alphaPixels: 100,
      bounds: { x: 520, y: 310, width: 80, height: 80 },
    },
  };
}

function contact(side: "north" | "east" | "south" | "west") {
  const values = {
    north: {
      from: { x: 1000, y: 860 },
      attemptedPosition: { x: 1000, y: 930 },
      blockedPosition: { x: 1000, y: 879 },
      slideTo: { x: 1030, y: 879 },
    },
    east: {
      from: { x: 1160, y: 1000 },
      attemptedPosition: { x: 1090, y: 1000 },
      blockedPosition: { x: 1141, y: 1000 },
      slideTo: { x: 1141, y: 1030 },
    },
    south: {
      from: { x: 1000, y: 1140 },
      attemptedPosition: { x: 1000, y: 1070 },
      blockedPosition: { x: 1000, y: 1121 },
      slideTo: { x: 1030, y: 1121 },
    },
    west: {
      from: { x: 840, y: 1000 },
      attemptedPosition: { x: 910, y: 1000 },
      blockedPosition: { x: 859, y: 1000 },
      slideTo: { x: 859, y: 1030 },
    },
  }[side];
  return {
    objectId: "prop:crate",
    objectName: "crate",
    side,
    radius: 20,
    collision: collision(),
    approach: {
      from: values.from,
      attemptedPosition: values.attemptedPosition,
    },
    blockedPosition: values.blockedPosition,
    feedback: {
      event: {
        type: "movement_blocked",
        sourceId: "player",
        targetId: "prop:crate",
        detail: "crate",
      },
      impactVisible: true,
      log: "Blocked: crate",
    },
    slide: {
      from: values.blockedPosition,
      to: values.slideTo,
    },
  };
}

function evidence() {
  return {
    schemaVersion: 1,
    profiles: [
      {
        profileId: "desktop",
        scenarios: [
          {
            id: "scenery-contact",
            gestureIds: ["walk-into-solid", "tap-route-into-solid"],
            solids: [solid()],
            contacts: (["north", "east", "south", "west"] as const).map(
              contact,
            ),
          },
          {
            id: "projectile-scenery-contact",
            gestureIds: ["fire-through-solid"],
            solids: [],
            projectiles: [
              {
                projectileId: "projectile:probe",
                objectId: "prop:crate",
                from: { x: 700, y: 1000 },
                to: { x: 1300, y: 1000 },
                radius: 20,
                endpointsFloorBacked: true,
                removed: true,
                projectileIdsAfter: [],
                impact: {
                  position: { x: 900, y: 1000 },
                  t: 1 / 3,
                  visible: true,
                },
                damageThroughSolid: false,
              },
            ],
          },
          {
            id: "embercross-solid-objects",
            gestureIds: [],
            solids: [],
          },
        ],
      },
      {
        profileId: "phone-portrait",
        scenarios: [],
      },
    ],
  };
}

describe("PRES-COLLIDE-008 evidence oracle", () => {
  it("passes complete visible-contact and swept-projectile evidence", () => {
    const result = evaluateCollisionEvidence(evidence());
    expect(result).toMatchObject({ pass: true, failures: [] });
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "solid-support-blocks", pass: true }),
        expect.objectContaining({ id: "blocked-object-visible", pass: true }),
        expect.objectContaining({ id: "swept-contact-holds", pass: true }),
      ]),
    );
  });

  it("detects every named collision negative control", () => {
    const controls = runCollisionNegativeControls(evidence());
    expect(controls).toHaveLength(5);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "collider-support-mismatch",
      "invisible-collision",
      "blocked-feedback-missing",
      "swept-contact-missed",
      "contact-side-coverage-missing",
    ]);
  });

  it("reports an omitted principal side for a retained solid", () => {
    const value = evidence();
    const scenario = value.profiles[0]!.scenarios[0]!;
    if (!Array.isArray(scenario.contacts))
      throw new Error("fixture must include contacts");
    scenario.contacts = scenario.contacts.filter(
      (current) => current.side !== "north",
    );
    const result = evaluateCollisionEvidence(value);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain(
      "contact-side-coverage-missing:prop:crate:north",
    );
  });

  it("does not borrow a cardinal contact from another profile", () => {
    const value = evidence();
    value.profiles[1] = structuredClone(value.profiles[0]);
    value.profiles[1]!.profileId = "phone-landscape";
    value.profiles[1]!.scenarios[0]!.contacts = [];
    const result = evaluateCollisionEvidence(value);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain(
      "contact-side-coverage-missing:prop:crate:north",
    );
  });

  it("reports missing coverage and overlap as actionable failures", () => {
    const value = evidence();
    const profile = value.profiles.at(0);
    if (!profile) throw new Error("fixture must include a profile");
    const contact = profile.scenarios.at(0)?.contacts?.at(0);
    if (!contact) throw new Error("fixture must include a contact");
    contact.blockedPosition = {
      x: 1000,
      y: 1000,
    };
    profile.scenarios = profile.scenarios.slice(0, 1);
    const result = evaluateCollisionEvidence(value);
    expect(result.pass).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "scenario-coverage-missing:projectile-scenery-contact",
        "scenario-coverage-missing:embercross-solid-objects",
        "gesture-coverage-missing:fire-through-solid",
        "solid-overlap:prop:crate",
      ]),
    );
  });

  it("accepts only declared map-blocked boundary exemptions", () => {
    const value = evidence();
    const scenario = value.profiles[0]!.scenarios[0]!;
    const exempt = structuredClone(solid());
    exempt.objectId = "architecture:opening:north-wall";
    exempt.objectName = "north-wall-solid";
    exempt.contactCoverage = {
      principalSides: ["north", "east", "south", "west"],
      requiredSides: [],
      skippedSides: {
        north: "outside-map-boundary",
        east: "outside-map-boundary",
        south: "outside-map-boundary",
        west: "outside-map-boundary",
      },
      selected: false,
      scope: "exhaustive-cardinal-matrix",
      exemption: COLLISION_TOPOLOGY_EXEMPTION,
    };
    scenario.solids.push(exempt);
    expect(evaluateCollisionEvidence(value)).toMatchObject({
      pass: true,
      failures: [],
    });

    const invalid = structuredClone(value);
    const invalidSolid = invalid.profiles[0]!.scenarios[0]!.solids[1]!;
    invalidSolid.objectId = "prop:unreachable-crate";
    const result = evaluateCollisionEvidence(invalid);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain(
      "contact-side-exemption-invalid:prop:unreachable-crate:exemption",
    );
  });
});
