import { describe, expect, it } from "vitest";
import {
  combatantReadabilityDistance,
  stepGame,
} from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  assessCombatReadability,
  destinationOverlapRatio,
} from "../framework/combat-readability";
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

function combatantDistance(state: ReturnType<typeof worldFromScenario>) {
  const monster = state.monsters[0]!;
  return Math.hypot(
    monster.position.x - state.player.position.x,
    monster.position.y - state.player.position.y,
  );
}

describe("combat readability mechanics", () => {
  it("repairs a fully stacked arbitrary state without losing Ashfang reach", () => {
    const state = worldFromScenario(meleeScenario([9, 7]));
    const monster = state.monsters[0]!;

    stepGame(state, EMPTY_INPUT);

    const minimum = combatantReadabilityDistance(state.player.radius, monster);
    expect(combatantDistance(state)).toBeGreaterThanOrEqual(minimum - 1);
    expect(combatantDistance(state)).toBeLessThanOrEqual(monster.attackRange);
    expect(
      state.pendingAttacks.some(({ ownerId }) => ownerId === monster.id),
    ).toBe(true);
    const manifest = buildRenderManifest(state, CAMERA);
    const player = manifest.drawCalls.find(
      ({ entityId }) => entityId === "player",
    )!;
    const monsterCall = manifest.drawCalls.find(
      ({ entityId }) => entityId === monster.id,
    )!;
    expect(
      destinationOverlapRatio(
        player.destinationRect,
        monsterCall.destinationRect,
      ),
    ).toBeLessThanOrEqual(0.57);
    expect(assessCombatReadability(manifest).violations).toEqual([]);
  });

  it("stops direct player movement at the readable contact ring", () => {
    const state = worldFromScenario(meleeScenario([10.5, 7]));
    state.settings.ai = false;
    state.monsters[0]!.attackReadyTick = 10_000;
    const startX = state.player.position.x;
    for (let tick = 0; tick < 30; tick += 1)
      stepGame(state, { ...EMPTY_INPUT, moveX: 1 });

    expect(state.player.position.x).toBeGreaterThan(startX);
    expect(combatantDistance(state)).toBeGreaterThanOrEqual(
      combatantReadabilityDistance(state.player.radius, state.monsters[0]!) - 1,
    );
    expect(state.player.position.x).toBeLessThan(state.monsters[0]!.position.x);
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
    expect(
      assessCombatReadability(manifest).evidence.attachedEffects,
    ).toContainEqual(
      expect.objectContaining({
        effectId: impact.entityId,
        actorId: "player",
        paintsBehindActor: true,
      }),
    );
  });
});
