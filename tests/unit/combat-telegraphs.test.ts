import { describe, expect, it } from "vitest";
import { TILE_PIXELS, UNITS_PER_TILE } from "../../src/game/constants";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type GameState } from "../../src/game/types";
import { buildCombatTelegraphs } from "../../src/render/combatTelegraphs";
import {
  buildRenderManifest,
  screenFor,
  type CameraV1,
} from "../../src/render/manifest";
import {
  worldFromScenario,
  type ScenarioMonsterV1,
  type ScenarioV1,
} from "../../src/testkit/scenarios";

const DESKTOP_CAMERA: CameraV1 = {
  x: 6 * TILE_PIXELS,
  y: 4 * TILE_PIXELS,
  zoom: 0.9,
};
const PORTRAIT_CAMERA: CameraV1 = {
  x: 6 * TILE_PIXELS,
  y: 4 * TILE_PIXELS,
  zoom: 0.5,
};

function arenaRows(): string[] {
  return Array.from({ length: 10 }, (_, y) => {
    if (y === 0 || y === 9) return "####################";
    const row: string[] = Array.from({ length: 20 }, (_, x) =>
      x === 0 || x === 19 ? "#" : ".",
    );
    if (y === 4) {
      row[4] = "P";
      row[18] = "E";
    }
    return row.join("");
  });
}

function boss(): ScenarioMonsterV1 {
  return {
    id: "monster:bell-keeper",
    kind: "stonekin",
    tile: [6, 4],
    health: 1_000,
    maxHealth: 1_000,
    armor: 0,
    attackDamage: 20,
    attackReadyTick: 10_000,
    elite: true,
  };
}

function telegraphScenario(patch: Partial<ScenarioV1> = {}): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: "combat-telegraph",
    seed: "combat-telegraph",
    classId: "vanguard",
    tick: 40,
    map: { mode: "explicit", rows: arenaRows() },
    player: { tile: [4, 4], health: 1_000, maxHealth: 1_000, armor: 0 },
    monsters: [boss()],
    pendingAttacks: [
      {
        id: "attack:bell-keeper:ability",
        ownerId: "monster:bell-keeper",
        kind: "ability",
        impactTick: 48,
        originTile: [6, 4],
        direction: [-UNITS_PER_TILE, 0],
        range: 2 * UNITS_PER_TILE,
        damage: 20,
      },
    ],
    settings: { ai: false, autoPickup: false, cameraFollow: false },
    ...patch,
  };
}

function pendingAbilityState(patch: Partial<ScenarioV1> = {}): GameState {
  return worldFromScenario(telegraphScenario(patch));
}

describe("combat telegraph presentation contract", () => {
  it("projects the stored attack center and radius on desktop and portrait cameras", () => {
    const state = pendingAbilityState();
    const attack = state.pendingAttacks[0]!;

    const desktop = buildCombatTelegraphs(state, DESKTOP_CAMERA)[0]!;
    expect(desktop).toMatchObject({
      paintId: "combat-telegraph:attack:bell-keeper:ability",
      paintRole: "combat-telegraph",
      layer: "effects",
      attackId: attack.id,
      ownerId: attack.ownerId,
      worldCenter: attack.origin,
      radius: 2 * UNITS_PER_TILE,
      impactTick: 48,
      windupTicks: 48,
    });
    expect(desktop.projectedCenter).toEqual(
      screenFor(attack.origin, DESKTOP_CAMERA),
    );
    expect(desktop.projectedRadius).toBeCloseTo(
      2 * TILE_PIXELS * DESKTOP_CAMERA.zoom,
    );
    expect(desktop.projectedBounds).toEqual({
      x: desktop.projectedCenter.x - desktop.projectedRadius,
      y: desktop.projectedCenter.y - desktop.projectedRadius,
      width: desktop.projectedRadius * 2,
      height: desktop.projectedRadius * 2,
    });

    const portrait = buildCombatTelegraphs(state, PORTRAIT_CAMERA)[0]!;
    expect(portrait.projectedCenter).toEqual(
      screenFor(attack.origin, PORTRAIT_CAMERA),
    );
    expect(portrait.projectedRadius).toBeCloseTo(
      2 * TILE_PIXELS * PORTRAIT_CAMERA.zoom,
    );
    expect(portrait.projectedRadius).not.toBe(desktop.projectedRadius);
  });

  it("keeps the warning fixed to the committed origin when the owner moves", () => {
    const state = pendingAbilityState();
    const before = buildCombatTelegraphs(state, DESKTOP_CAMERA)[0]!;
    const owner = state.monsters[0]!;
    owner.position.x += 900;
    owner.previousPosition.x += 900;

    const after = buildCombatTelegraphs(state, DESKTOP_CAMERA)[0]!;
    expect(after.worldCenter).toEqual(before.worldCenter);
    expect(after.projectedCenter).toEqual(before.projectedCenter);
    expect(after.radius).toBe(before.radius);
  });

  it("deduplicates attack paints and places them below actor bodies", () => {
    const state = pendingAbilityState();
    state.pendingAttacks.push({ ...state.pendingAttacks[0]! });
    const manifest = buildRenderManifest(state, DESKTOP_CAMERA);
    const telegraphs = manifest.paintQueue.filter(
      (item) => item.kind === "combat-telegraph",
    );
    const bodyIndex = manifest.paintQueue.findIndex(
      (item) => item.paintId === "body:monster:bell-keeper",
    );

    expect(manifest.combatTelegraphs).toHaveLength(1);
    expect(telegraphs).toHaveLength(1);
    expect(telegraphs[0]).toMatchObject({
      kind: "combat-telegraph",
      paintId: "combat-telegraph:attack:bell-keeper:ability",
    });
    expect(telegraphs[0]!.zOrder).toBeLessThan(bodyIndex);
  });

  it("rejects primary, stale, canceled, and dead-owner records", () => {
    const primary = pendingAbilityState();
    primary.pendingAttacks[0]!.kind = "primary";
    expect(buildCombatTelegraphs(primary, DESKTOP_CAMERA)).toEqual([]);

    const stale = pendingAbilityState();
    stale.pendingAttacks[0]!.impactTick = stale.tick - 1;
    expect(buildCombatTelegraphs(stale, DESKTOP_CAMERA)).toEqual([]);

    const canceled = pendingAbilityState();
    canceled.pendingAttacks[0]!.ownerId = "monster:missing";
    expect(buildCombatTelegraphs(canceled, DESKTOP_CAMERA)).toEqual([]);

    const dead = pendingAbilityState();
    dead.monsters[0]!.health = 0;
    expect(buildCombatTelegraphs(dead, DESKTOP_CAMERA)).toEqual([]);
  });

  it("keeps the warning through the pre-impact contact pose and removes it on impact", () => {
    const state = worldFromScenario({
      ...telegraphScenario(),
      id: "combat-telegraph-timing",
      tick: 0,
      pendingAttacks: undefined,
      settings: { ai: true, autoPickup: false, cameraFollow: false },
      monsters: [{ ...boss(), attackReadyTick: 0 }],
    });

    stepGame(state, EMPTY_INPUT);
    const attack = state.pendingAttacks[0]!;
    expect(attack.impactTick).toBe(48);
    while (state.tick < attack.impactTick) stepGame(state, EMPTY_INPUT);

    const beforeImpact = buildRenderManifest(state, DESKTOP_CAMERA);
    expect(beforeImpact.combatTelegraphs).toHaveLength(1);
    expect(
      beforeImpact.drawCalls.find(
        ({ entityId }) => entityId === "monster:bell-keeper",
      ),
    ).toMatchObject({ clip: "ability" });
    expect(state.player.health).toBe(1_000);

    stepGame(state, EMPTY_INPUT);
    expect(state.pendingAttacks).toHaveLength(0);
    expect(buildRenderManifest(state, DESKTOP_CAMERA).combatTelegraphs).toEqual(
      [],
    );
    expect(state.player.health).toBe(980);
  });

  it("has no warning in a loaded state without a live pending attack", () => {
    const state = pendingAbilityState({ pendingAttacks: [] });
    expect(buildRenderManifest(state, DESKTOP_CAMERA).combatTelegraphs).toEqual(
      [],
    );
  });
});
