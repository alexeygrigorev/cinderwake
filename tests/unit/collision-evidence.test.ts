import { describe, expect, it } from "vitest";
import {
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
    support: {
      source: "alpha-mask",
      alphaPixels: 100,
      bounds: { x: 520, y: 310, width: 80, height: 80 },
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
            contacts: [
              {
                objectId: "prop:crate",
                objectName: "crate",
                radius: 20,
                collision: collision(),
                approach: {
                  from: { x: 1000, y: 1140 },
                  attemptedPosition: { x: 1000, y: 1070 },
                },
                blockedPosition: { x: 1000, y: 1121 },
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
                  from: { x: 1000, y: 1121 },
                  to: { x: 1030, y: 1121 },
                },
              },
            ],
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
    expect(controls).toHaveLength(4);
    expect(controls.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(controls.map(({ signal }) => signal)).toEqual([
      "collider-support-mismatch",
      "invisible-collision",
      "blocked-feedback-missing",
      "swept-contact-missed",
    ]);
  });

  it("reports missing coverage and overlap as actionable failures", () => {
    const value = evidence();
    value.profiles[0].scenarios[0].contacts[0].blockedPosition = {
      x: 1000,
      y: 1000,
    };
    value.profiles[0].scenarios = value.profiles[0].scenarios.slice(0, 1);
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
});
