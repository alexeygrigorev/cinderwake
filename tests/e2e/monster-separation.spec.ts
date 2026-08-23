import { expect, test } from "@playwright/test";
import { MONSTER_PERSONAL_SPACE_PADDING } from "../../src/game/simulation";
import type { ScenarioV1 } from "../../src/testkit/scenarios";

function browserPursuitScenario(): ScenarioV1 {
  const width = 30;
  const rows = Array.from({ length: 15 }, (_, y) => {
    if (y === 0 || y === 14) return "#".repeat(width);
    const row: string[] = Array.from({ length: width }, (_, x) =>
      x === 0 || x === width - 1 ? "#" : ".",
    );
    if (y === 7) row[15] = "P";
    if (y === 2) row[width - 3] = "E";
    return row.join("");
  });
  return {
    schemaVersion: 1,
    id: "browser-monster-separation",
    seed: "browser-monster-separation",
    classId: "vanguard",
    map: { mode: "explicit", rows },
    monsters: ["alpha", "beta", "gamma"].map((suffix) => ({
      id: `monster:${suffix}`,
      kind: "ashfang" as const,
      tile: [9, 7] as [number, number],
      attackReadyTick: 10_000,
    })),
    settings: { ai: true, autoPickup: false, cameraFollow: true },
  };
}

test("browser simulation and render manifest keep a pursuing pack separated", async ({
  page,
}) => {
  await page.goto("/?testMode=1&scenario=animation-idle");
  await page.waitForFunction(() => Boolean(window.__GAME_TEST__?.ready));
  const evidence = await page.evaluate((scenario) => {
    window.__GAME_TEST__!.loadScenario(scenario);
    const initialManifest = window.__GAME_TEST__!.renderManifest();
    const state = window.__GAME_TEST__!.step(1, { render: true });
    const manifest = window.__GAME_TEST__!.renderManifest();
    return {
      initialTick: initialManifest.tick,
      laterTick: manifest.tick,
      initialAnchors: initialManifest.drawCalls
        .filter(({ type }) => type === "monster")
        .map(({ entityId, worldAnchor }) => ({ entityId, worldAnchor })),
      monsters: state.monsters.map(({ id, position, radius }) => ({
        id,
        position,
        radius,
      })),
      anchors: manifest.drawCalls
        .filter(({ type }) => type === "monster")
        .map(({ entityId, worldAnchor, destinationRect }) => ({
          entityId,
          worldAnchor,
          destinationRect,
        })),
    };
  }, browserPursuitScenario());

  expect(evidence.initialTick).toBe(0);
  expect(evidence.laterTick).toBe(1);
  expect(evidence.monsters).toHaveLength(3);
  expect(
    new Set(
      evidence.initialAnchors.map(
        ({ worldAnchor }) => `${worldAnchor.x}:${worldAnchor.y}`,
      ),
    ).size,
  ).toBe(1);
  for (
    let firstIndex = 0;
    firstIndex < evidence.monsters.length;
    firstIndex += 1
  ) {
    const first = evidence.monsters[firstIndex]!;
    expect(
      evidence.anchors.find(({ entityId }) => entityId === first.id)
        ?.worldAnchor,
    ).toEqual(first.position);
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < evidence.monsters.length;
      secondIndex += 1
    ) {
      const second = evidence.monsters[secondIndex]!;
      expect(
        Math.hypot(
          first.position.x - second.position.x,
          first.position.y - second.position.y,
        ),
      ).toBeGreaterThanOrEqual(
        first.radius + second.radius + MONSTER_PERSONAL_SPACE_PADDING * 2 - 2,
      );

      const firstRect = evidence.anchors.find(
        ({ entityId }) => entityId === first.id,
      )!.destinationRect;
      const secondRect = evidence.anchors.find(
        ({ entityId }) => entityId === second.id,
      )!.destinationRect;
      const intersectionWidth = Math.max(
        0,
        Math.min(
          firstRect.x + firstRect.width,
          secondRect.x + secondRect.width,
        ) - Math.max(firstRect.x, secondRect.x),
      );
      const intersectionHeight = Math.max(
        0,
        Math.min(
          firstRect.y + firstRect.height,
          secondRect.y + secondRect.height,
        ) - Math.max(firstRect.y, secondRect.y),
      );
      expect(
        (intersectionWidth * intersectionHeight) /
          Math.min(
            firstRect.width * firstRect.height,
            secondRect.width * secondRect.height,
          ),
      ).toBeLessThanOrEqual(0.2);
    }
  }
});
