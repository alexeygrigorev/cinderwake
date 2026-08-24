import { expect, test } from "@playwright/test";
import { UNITS_PER_TILE } from "../../src/game/constants";
import { isFloor } from "../../src/game/dungeon";
import {
  buildSceneryLayout,
  type SceneryCollisionFootprint,
} from "../../src/game/sceneryLayout";
import type { ProjectileState } from "../../src/game/types";
import {
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";

function segmentEllipseHitTime(
  from: { x: number; y: number },
  to: { x: number; y: number },
  collision: SceneryCollisionFootprint,
  radius: number,
): number | null {
  const horizontalRadius = collision.halfWidth + radius;
  const verticalRadius = collision.halfHeight + radius;
  const startX = (from.x - collision.center.x) / horizontalRadius;
  const startY = (from.y - collision.center.y) / verticalRadius;
  const deltaX = (to.x - from.x) / horizontalRadius;
  const deltaY = (to.y - from.y) / verticalRadius;
  const c = startX * startX + startY * startY - 1;
  if (c <= 0) return 0;
  const a = deltaX * deltaX + deltaY * deltaY;
  if (a < Number.EPSILON) return null;
  const b = 2 * (startX * deltaX + startY * deltaY);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const enter = (-b - Math.sqrt(discriminant)) / (2 * a);
  return enter >= 0 && enter <= 1 ? enter : null;
}

test("browser state records and renders a projectile impact on the solid v2 forge", async ({
  page,
}) => {
  const state = worldFromScenario(
    createRunScenario("browser-projectile-v2-forge", "vanguard"),
  );
  const layout = buildSceneryLayout(state.map);
  const structure = layout.find(({ id }) => id === "structure:0:forge")!;
  expect(structure.name).toBe("forge-workshop");
  const collision = structure.collision!;
  const radius = 120;
  const crossing = [
    {
      from: {
        x: collision.center.x - collision.halfWidth - radius - 480,
        y: collision.center.y,
      },
      to: {
        x: collision.center.x + collision.halfWidth + radius + 480,
        y: collision.center.y,
      },
    },
    {
      from: {
        x: collision.center.x,
        y: collision.center.y - collision.halfHeight - radius - 480,
      },
      to: {
        x: collision.center.x,
        y: collision.center.y + collision.halfHeight + radius + 480,
      },
    },
  ]
    .flatMap(({ from, to }) => [
      { from, to },
      { from: to, to: from },
    ])
    .map(({ from, to }) => {
      const forgeHit = segmentEllipseHitTime(from, to, collision, radius);
      const earlierOtherHit = layout.some(({ id, collision: candidate }) => {
        if (!candidate || id === structure.id) return false;
        const hit = segmentEllipseHitTime(from, to, candidate, radius);
        return hit !== null && forgeHit !== null && hit < forgeHit;
      });
      return forgeHit === null || earlierOtherHit
        ? null
        : {
            from,
            to,
            impact: {
              x: Math.round(from.x + (to.x - from.x) * forgeHit),
              y: Math.round(from.y + (to.y - from.y) * forgeHit),
            },
          };
    })
    .find(
      (candidate) =>
        candidate !== null &&
        [candidate.from, candidate.to].every((point) =>
          isFloor(
            state.map,
            Math.floor(point.x / UNITS_PER_TILE),
            Math.floor(point.y / UNITS_PER_TILE),
          ),
        ),
    );
  if (!crossing) throw new Error("V2 forge has no floor-backed crossing axis");
  const { from, to } = crossing;
  const projectile: ProjectileState = {
    id: "projectile:browser:scenery-probe",
    owner: "player",
    hostile: false,
    position: { ...from },
    previousPosition: { ...from },
    velocity: { x: to.x - from.x, y: to.y - from.y },
    radius,
    damage: 99,
    expiresAtTick: 100,
    color: "#f0a24b",
    pierce: 4,
    spawnedAtTick: 0,
    hitTargets: [],
  };
  state.monsters = [];
  state.effects = [];
  state.projectiles = [projectile];

  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const evidence = await page.evaluate(
    ({ injectedState, objectId }) => {
      window.__GAME_TEST__!.loadState(injectedState);
      const manifestedCollision = window
        .__GAME_TEST__!.renderManifest()
        .sceneSprites.find(
          ({ objectId: candidate }) => candidate === objectId,
        )?.collision;
      const snapshot = window.__GAME_TEST__!.step(2, { render: true });
      const manifest = window.__GAME_TEST__!.renderManifest();
      const impact = snapshot.effects.find(({ kind }) => kind === "impact");
      return {
        manifestedCollision,
        projectileIds: snapshot.projectiles.map(({ id }) => id),
        impact,
        impactCall: manifest.drawCalls.find(
          ({ entityId }) => entityId === impact?.id,
        ),
      };
    },
    { injectedState: state, objectId: structure.id },
  );

  expect(evidence.manifestedCollision).toMatchObject({
    mode: "solid",
    worldCenter: collision.center,
    halfWidth: collision.halfWidth,
    halfHeight: collision.halfHeight,
  });
  expect(evidence.projectileIds).toEqual([]);
  expect(evidence.impact?.position.x).toBeCloseTo(crossing.impact.x, 0);
  expect(evidence.impact?.position.y).toBeCloseTo(crossing.impact.y, 0);
  expect(evidence.impactCall).toMatchObject({
    type: "effect",
    geometryId: "effect:impact",
    worldAnchor: evidence.impact?.position,
    visible: true,
  });
});
