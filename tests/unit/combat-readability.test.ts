import { describe, expect, it } from "vitest";
import { MONSTERS } from "../../src/game/content";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import { destinationOverlapRatio } from "../framework/combat-readability";
import {
  worldFromScenario,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

const CAMERA = { x: 9 * 48, y: 7 * 48, zoom: 0.9 };

function arenaRows(): string[] {
  return Array.from({ length: 15 }, (_, y) => {
    if (y === 0 || y === 14) return "#".repeat(30);
    const row: string[] = Array.from({ length: 30 }, (_, x) =>
      x === 0 || x === 29 ? "#" : ".",
    );
    if (y === 7) row[9] = "P";
    if (y === 2) row[27] = "E";
    return row.join("");
  });
}

function meleeScenario(monsterTile: [number, number]): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: "combat-readability",
    seed: "combat-readability",
    classId: "vanguard",
    map: { mode: "explicit", rows: arenaRows() },
    monsters: [
      {
        id: "monster:readability",
        kind: "ashfang",
        tile: monsterTile,
        health: 1_000,
        maxHealth: 1_000,
        attackReadyTick: 0,
      },
    ],
    settings: { ai: true, autoPickup: false, cameraFollow: false },
  };
}

describe("presentation-only combat readability", () => {
  it("preserves original melee reach and a stacked state's simulation coordinates", () => {
    const state = worldFromScenario(meleeScenario([9, 7]));
    const monster = state.monsters[0]!;
    const playerBefore = { ...state.player.position };
    const monsterBefore = { ...monster.position };

    stepGame(state, EMPTY_INPUT);

    expect(MONSTERS.ashfang.attackRange).toBe(850);
    expect(MONSTERS.stonekin.attackRange).toBe(1050);
    expect(state.player.position).toEqual(playerBefore);
    expect(monster.position).toEqual(monsterBefore);
    expect(
      state.pendingAttacks.some(({ ownerId }) => ownerId === monster.id),
    ).toBe(true);
    const manifest = buildRenderManifest(state, CAMERA);
    const monsterCall = manifest.drawCalls.find(
      ({ entityId }) => entityId === monster.id,
    )!;
    expect(monsterCall.worldAnchor).toEqual(monster.position);
    expect(monsterCall.presentationOffset).toBeDefined();
    expect(
      Math.hypot(
        monsterCall.presentationOffset!.x,
        monsterCall.presentationOffset!.y,
      ),
    ).toBeGreaterThan(0);
  });

  it("does not add an invisible player/monster collision ring", () => {
    const state = worldFromScenario(meleeScenario([10.5, 7]));
    state.settings.ai = false;
    state.monsters[0]!.attackReadyTick = 10_000;
    const monsterX = state.monsters[0]!.position.x;
    for (let tick = 0; tick < 30; tick += 1)
      stepGame(state, { ...EMPTY_INPUT, moveX: 1 });

    expect(state.player.position.x).toBeGreaterThan(monsterX);
    expect(
      state.eventLog.filter(({ type }) => type === "movement_blocked"),
    ).toEqual([]);
  });

  it("keeps presented bodies legible while simulation anchors remain untouched", () => {
    const state = worldFromScenario(meleeScenario([9.6, 7]));
    const before = structuredClone(state);
    const manifest = buildRenderManifest(state, CAMERA);
    const player = manifest.drawCalls.find(
      ({ entityId }) => entityId === "player",
    )!;
    const monster = manifest.drawCalls.find(
      ({ entityId }) => entityId === "monster:readability",
    )!;

    expect(state).toEqual(before);
    expect(monster.worldAnchor).toEqual(state.monsters[0]!.position);
    expect(
      Math.hypot(
        monster.screenAnchor.x - player.screenAnchor.x,
        monster.screenAnchor.y - player.screenAnchor.y,
      ),
    ).toBeGreaterThanOrEqual(50);
    expect(
      destinationOverlapRatio(player.destinationRect, monster.destinationRect),
    ).toBeLessThanOrEqual(0.57);
  });

  it("binds effect zOrder to the same depth queue used by canvas painting", () => {
    const state = worldFromScenario(meleeScenario([9.6, 7]));
    for (let tick = 0; tick < 8; tick += 1) stepGame(state, EMPTY_INPUT);
    const manifest = buildRenderManifest(state, CAMERA);
    const player = manifest.drawCalls.find(
      ({ entityId }) => entityId === "player",
    )!;
    const impact = manifest.drawCalls.find(
      ({ type, screenAnchor }) =>
        type === "effect" &&
        screenAnchor.x === player.screenAnchor.x &&
        screenAnchor.y === player.screenAnchor.y,
    )!;

    expect(impact).toBeDefined();
    expect(impact.zOrder).toBeLessThan(player.zOrder);
  });
});
