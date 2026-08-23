import { expect, test } from "@playwright/test";
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
    const state = window.__GAME_TEST__!.step(1, { render: true });
    const manifest = window.__GAME_TEST__!.renderManifest();
    return {
      monsters: state.monsters.map(({ id, position, radius }) => ({
        id,
        position,
        radius,
      })),
      anchors: manifest.drawCalls
        .filter(({ type }) => type === "monster")
        .map(({ entityId, worldAnchor }) => ({ entityId, worldAnchor })),
    };
  }, browserPursuitScenario());

  expect(evidence.monsters).toHaveLength(3);
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
      ).toBeGreaterThanOrEqual(first.radius + second.radius - 2);
    }
  }
});
