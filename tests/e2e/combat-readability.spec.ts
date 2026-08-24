import { expect, test } from "@playwright/test";
import {
  assessCombatReadability,
  assessCombatSequence,
  type CombatSequenceFrame,
} from "../framework/combat-readability";

test.beforeEach(async ({ page }) => {
  await page.goto("/?testMode=1&scenario=temporal-ashfang-attack");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
});

test("gates ordered Ashfang windup, contact, and recovery without moving simulation actors", async ({
  page,
}) => {
  const captures = await page.evaluate(() =>
    window.__GAME_TEST__!.captureSequence([0, 1, 8, 22], { render: true }),
  );
  const frames: CombatSequenceFrame[] = captures.map((capture, index) => ({
    id: ["windup", "windup-next", "contact", "recovery"][index]!,
    manifest: capture.manifest,
    requiredEffectOwnerIds: capture.tick === 8 ? ["player"] : [],
  }));
  const assessment = assessCombatSequence(frames);

  expect(assessment.violations).toEqual([]);
  const initialPlayer = captures[0]!.snapshot.player.position;
  const initialMonster = captures[0]!.snapshot.monsters[0]!.position;
  for (const capture of captures) {
    expect(capture.snapshot.player.position).toEqual(initialPlayer);
    expect(capture.snapshot.monsters[0]!.position).toEqual(initialMonster);
    const monster = capture.manifest.drawCalls.find(
      ({ type }) => type === "monster",
    )!;
    expect(monster.worldAnchor).toEqual(initialMonster);
  }
  expect(
    assessment.frames[2]!.assessment.evidence.attachedEffects,
  ).toContainEqual(
    expect.objectContaining({
      actorId: "player",
      attached: true,
      paintsBehindActor: true,
    }),
  );
});

test("keeps Ashfang contact readable in all four cardinal presentations", async ({
  page,
}) => {
  const manifests = await page.evaluate(() => {
    const bridge = window.__GAME_TEST__!;
    bridge.step(8, { render: true });
    const base = bridge.snapshot();
    const directions = [
      { id: "east", dx: 614, dy: 0, fx: -1024, fy: 0 },
      { id: "west", dx: -614, dy: 0, fx: 1024, fy: 0 },
      { id: "north", dx: 0, dy: -614, fx: 0, fy: 1024 },
      { id: "south", dx: 0, dy: 614, fx: 0, fy: -1024 },
    ];
    return directions.map((direction) => {
      const state = structuredClone(base);
      const monster = state.monsters[0]!;
      monster.position = {
        x: state.player.position.x + direction.dx,
        y: state.player.position.y + direction.dy,
      };
      monster.previousPosition = { ...monster.position };
      monster.facing = { x: direction.fx, y: direction.fy };
      bridge.loadState(state);
      return { id: direction.id, manifest: bridge.render() };
    });
  });

  for (const { id, manifest } of manifests) {
    const assessment = assessCombatReadability(manifest, {
      requiredEffectOwnerIds: ["player"],
    });
    expect(assessment.violations, id).toEqual([]);
    expect(
      assessment.evidence.actorPairs[0]!.anchorDistance,
      id,
    ).toBeGreaterThanOrEqual(50);
  }
});

test("uses the same presentation-only contract for Stonekin and mobile play", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ashfang = await page.evaluate(() => {
    window.__GAME_TEST__!.step(8, { render: true });
    return window.__GAME_TEST__!.renderManifest();
  });
  expect(
    assessCombatReadability(ashfang, {
      requiredEffectOwnerIds: ["player"],
    }).violations,
  ).toEqual([]);
  await page.evaluate(() =>
    window.__GAME_TEST__!.loadScenario("temporal-stonekin-attack"),
  );
  const stonekin = await page.evaluate(() => {
    window.__GAME_TEST__!.step(11, { render: true });
    return window.__GAME_TEST__!.renderManifest();
  });
  expect(
    assessCombatReadability(stonekin, {
      requiredEffectOwnerIds: ["player"],
    }).violations,
  ).toEqual([]);
  const mobileLayout = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage")!;
    const controls = document.querySelector<HTMLElement>(".mobile-controls")!;
    const stageBox = stage.getBoundingClientRect();
    const controlsBox = controls.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      stageLeft: stageBox.left,
      stageRight: stageBox.right,
      controlsBottom: controlsBox.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(
    mobileLayout.viewportWidth,
  );
  expect(mobileLayout.stageLeft).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.stageRight).toBeLessThanOrEqual(
    mobileLayout.viewportWidth,
  );
  expect(mobileLayout.controlsBottom).toBeLessThanOrEqual(
    mobileLayout.viewportHeight,
  );
});

test("rejects missing or detached evidence, stacking, dominant UI, foreground effects, and visual snaps", async ({
  page,
}) => {
  const captures = await page.evaluate(() =>
    window.__GAME_TEST__!.captureSequence([0, 1, 8], { render: true }),
  );
  const contact = structuredClone(captures[2]!.manifest);
  const player = contact.drawCalls.find(
    ({ entityId }) => entityId === "player",
  )!;
  const monster = contact.drawCalls.find(({ type }) => type === "monster")!;
  const effect = contact.drawCalls.find(({ type }) => type === "effect")!;

  const stacked = structuredClone(contact);
  const stackedMonster = stacked.drawCalls.find(
    ({ entityId }) => entityId === monster.entityId,
  )!;
  stackedMonster.screenAnchor = { ...player.screenAnchor };
  stackedMonster.footAnchor = { ...player.footAnchor };
  stackedMonster.destinationRect = { ...player.destinationRect };
  expect(assessCombatReadability(stacked).violations).toEqual(
    expect.arrayContaining([
      `combat:body-overlap:${monster.entityId}`,
      `combat:anchor-separation:${monster.entityId}`,
    ]),
  );

  const missingHealth = structuredClone(contact);
  missingHealth.worldUi = [];
  expect(assessCombatReadability(missingHealth).violations).toContain(
    `combat:health-missing:${monster.entityId}`,
  );

  const dominantHealth = structuredClone(contact);
  dominantHealth.worldUi[0]!.destinationRect = {
    x: monster.destinationRect.x,
    y:
      dominantHealth.worldUi[0]!.actorInkTop -
      monster.destinationRect.height * 0.25,
    width: monster.destinationRect.width,
    height: monster.destinationRect.height * 0.25,
  };
  expect(assessCombatReadability(dominantHealth).violations).toEqual(
    expect.arrayContaining([
      `combat:health-dominates-actor:${monster.entityId}`,
      `combat:health-detached:${monster.entityId}`,
    ]),
  );

  const missingEffect = structuredClone(contact);
  missingEffect.drawCalls = missingEffect.drawCalls.filter(
    ({ type }) => type !== "effect",
  );
  expect(
    assessCombatReadability(missingEffect, {
      requiredEffectOwnerIds: ["player"],
    }).violations,
  ).toContain("combat:attached-effect-missing:player");

  const detachedEffect = structuredClone(contact);
  const detached = detachedEffect.drawCalls.find(
    ({ entityId }) => entityId === effect.entityId,
  )!;
  detached.screenAnchor.x += 12;
  detached.footAnchor.x += 12;
  detached.destinationRect.x += 12;
  expect(
    assessCombatReadability(detachedEffect, {
      requiredEffectOwnerIds: ["player"],
    }).violations,
  ).toContain(`combat:attached-effect-detached:${effect.entityId}`);

  const foregroundEffect = structuredClone(contact);
  foregroundEffect.drawCalls.find(
    ({ entityId }) => entityId === effect.entityId,
  )!.zOrder = monster.zOrder + 1;
  expect(assessCombatReadability(foregroundEffect).violations).toContain(
    `combat:attached-effect-depth:${effect.entityId}`,
  );

  const snapped = structuredClone(captures.slice(0, 2));
  const snappedMonster = snapped[1]!.manifest.drawCalls.find(
    ({ entityId }) => entityId === monster.entityId,
  )!;
  snappedMonster.presentationOffset = {
    x: (snappedMonster.presentationOffset?.x ?? 0) + 10,
    y: snappedMonster.presentationOffset?.y ?? 0,
  };
  expect(
    assessCombatSequence(
      snapped.map((capture, index) => ({
        id: `snap-${index}`,
        manifest: capture.manifest,
      })),
    ).violations,
  ).toContain(`snap-1:combat:presentation-snap:${monster.entityId}`);
});
