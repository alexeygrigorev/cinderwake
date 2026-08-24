import { expect, test } from "@playwright/test";
import { assessCombatReadability } from "../framework/combat-readability";

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=temporal-ashfang-attack");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("keeps a real Ashfang melee frame separated, depth-correct, and lightly labeled", async ({
  page,
}) => {
  const manifest = await page.evaluate(() => {
    window.__GAME_TEST__!.step(8, { render: true });
    return window.__GAME_TEST__!.renderManifest();
  });
  const assessment = assessCombatReadability(manifest);

  expect(assessment.violations).toEqual([]);
  expect(assessment.evidence.actorPairs).toEqual([
    expect.objectContaining({
      monsterId: "monster:temporal-ashfang",
      depthOrderCorrect: true,
    }),
  ]);
  expect(
    assessment.evidence.actorPairs[0]!.destinationOverlapRatio,
  ).toBeLessThanOrEqual(0.57);
  expect(
    assessment.evidence.actorPairs[0]!.anchorDistance,
  ).toBeGreaterThanOrEqual(48);
  expect(assessment.evidence.health).toEqual([
    expect.objectContaining({ ownerId: "monster:temporal-ashfang" }),
  ]);
  expect(assessment.evidence.attachedEffects).toEqual([
    expect.objectContaining({ paintsBehindActor: true }),
  ]);
});

test("rejects body stacking, dominant health UI, and foreground contact effects", async ({
  page,
}) => {
  const manifest = await page.evaluate(() => {
    window.__GAME_TEST__!.step(8, { render: true });
    return window.__GAME_TEST__!.renderManifest();
  });
  const broken = structuredClone(manifest);
  const player = broken.drawCalls.find(
    ({ entityId }) => entityId === "player",
  )!;
  const monster = broken.drawCalls.find(({ type }) => type === "monster")!;
  monster.screenAnchor = { ...player.screenAnchor };
  monster.footAnchor = { ...player.footAnchor };
  monster.destinationRect = { ...player.destinationRect };
  const health = broken.worldUi[0]!;
  health.destinationRect = {
    x: monster.destinationRect.x,
    y: health.actorInkTop - monster.destinationRect.height * 0.25,
    width: monster.destinationRect.width,
    height: monster.destinationRect.height * 0.25,
  };
  const effect = broken.drawCalls.find(({ type }) => type === "effect")!;
  effect.zOrder = monster.zOrder + 1;

  expect(assessCombatReadability(broken).violations).toEqual(
    expect.arrayContaining([
      `combat:body-overlap:${monster.entityId}`,
      `combat:anchor-separation:${monster.entityId}`,
      `combat:health-dominates-actor:${monster.entityId}`,
      `combat:health-detached:${monster.entityId}`,
      `combat:attached-effect-depth:${effect.entityId}`,
    ]),
  );
});
