import { expect, test } from "@playwright/test";
import { buildSceneryLayout } from "../../src/game/sceneryLayout";
import type { ProjectileState } from "../../src/game/types";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

test("browser state records and renders a projectile impact on solid scenery", async ({
  page,
}) => {
  const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
  const structure = buildSceneryLayout(state.map).find(
    ({ kind, collision }) => kind === "structure" && collision,
  )!;
  const collision = structure.collision!;
  const radius = 120;
  const from = {
    x: collision.center.x - collision.halfWidth - radius - 480,
    y: collision.center.y,
  };
  const to = {
    x: collision.center.x + collision.halfWidth + radius + 480,
    y: collision.center.y,
  };
  const projectile: ProjectileState = {
    id: "projectile:browser:scenery-probe",
    owner: "player",
    hostile: false,
    position: { ...from },
    previousPosition: { ...from },
    velocity: { x: to.x - from.x, y: 0 },
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
  expect(evidence.impact?.position).toEqual({
    x: collision.center.x - collision.halfWidth - radius,
    y: collision.center.y,
  });
  expect(evidence.impactCall).toMatchObject({
    type: "effect",
    geometryId: "effect:impact",
    worldAnchor: evidence.impact?.position,
    visible: true,
  });
});
