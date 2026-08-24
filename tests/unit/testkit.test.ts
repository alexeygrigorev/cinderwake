import { describe, expect, it } from "vitest";
import {
  explicitDungeon,
  generateDungeon,
  reachableFloorCount,
  tileCenter,
  totalFloorCount,
} from "../../src/game/dungeon";
import { wildernessCityLandmarkAnchor } from "../../src/game/cityWorld";
import {
  navigationPointWalkable,
  navigationSegmentWalkable,
} from "../../src/game/navigation";
import { createRngStreams, randomFloat } from "../../src/game/rng";
import {
  buildSceneryLayout,
  overlapsScenery,
  sceneryCollisions,
} from "../../src/game/sceneryLayout";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  canonicalJson,
  canonicalState,
  stateHash,
} from "../../src/testkit/canonical";
import { playReplay, type ReplayTapeV1 } from "../../src/testkit/replay";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { stateFromSnapshot } from "../../src/testkit/stateSnapshots";

describe("deterministic fixtures", () => {
  it("generates connected maps with stable digests across varied seeds", () => {
    for (let index = 0; index < 40; index += 1) {
      const first = generateDungeon(`seed-${index}`);
      const second = generateDungeon(`seed-${index}`);
      expect(first.digest).toBe(second.digest);
      expect(reachableFloorCount(first)).toBe(totalFloorCount(first));
    }
  });

  it("round-trips canonical snapshots and resets scenarios identically", () => {
    const scenario = BUILTIN_SCENARIOS["combat-loot"]!;
    const first = worldFromScenario(scenario);
    const second = worldFromScenario(JSON.parse(JSON.stringify(scenario)));
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalState(first)).toEqual(JSON.parse(canonicalJson(first)));
    expect(stateHash(first)).toBe(stateHash(second));
  });

  it("places a production fixture on a safe reproducible approach to the city sign", () => {
    const first = worldFromScenario(
      BUILTIN_SCENARIOS["production-city-route"]!,
    );
    const second = worldFromScenario(
      BUILTIN_SCENARIOS["production-city-route"]!,
    );
    const landmark = wildernessCityLandmarkAnchor(first.map);
    const distance = Math.hypot(
      landmark.x - first.player.position.x,
      landmark.y - first.player.position.y,
    );

    expect(first).toEqual(second);
    expect(first.map.rooms.length).toBeGreaterThan(0);
    expect(distance).toBeGreaterThan(720);
    expect(distance).toBeLessThan(6 * 1024);
    expect(
      buildSceneryLayout(first.map).some(
        ({ id }) => id === "landmark:embercross:road-sign",
      ),
    ).toBe(true);
  });

  it("restores an exact internal snapshot without lossy tile conversion", () => {
    const original = worldFromScenario(BUILTIN_SCENARIOS["mid-action"]!);
    original.player.position.x += 137;
    original.player.previousPosition.y -= 91;
    original.rng.ai = { state: 0x1234abcd, draws: 37 };
    const restored = stateFromSnapshot(canonicalState(original));
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
    expect(restored.player).not.toBe(original.player);
    expect(stateHash(restored)).toBe(stateHash(original));
  });

  it("rejects structurally incomplete internal snapshots", () => {
    const snapshot = structuredClone(
      worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!),
    ) as unknown as Record<string, unknown>;
    delete snapshot.rng;
    expect(() => stateFromSnapshot(snapshot)).toThrow("state.rng");
  });

  it("rejects malformed rooms before deriving scenery collision", () => {
    const original = worldFromScenario(
      createRunScenario("snapshot-invalid-room", "vanguard"),
    );
    const zeroWidth = structuredClone(original);
    zeroWidth.map.rooms[0]!.width = 0;
    expect(() => stateFromSnapshot(zeroWidth)).toThrow(
      "state.map.rooms[0] dimensions must be positive",
    );

    const offMap = structuredClone(original);
    offMap.map.rooms[0]!.x = offMap.map.width;
    expect(() => stateFromSnapshot(offMap)).toThrow(
      "state.map.rooms[0] must fit inside state.map",
    );

    const nonFinite = structuredClone(original);
    nonFinite.map.rooms[0]!.height = Number.NaN;
    expect(() => stateFromSnapshot(nonFinite)).toThrow(
      "state.map.rooms[0].height must be a safe integer",
    );
  });

  it("rejects restored actors inside or interpolating through solid art", () => {
    const original = worldFromScenario(
      createRunScenario("snapshot-solid-path", "vanguard"),
    );
    const collision = buildSceneryLayout(original.map).find(
      ({ id }) => id === "structure:0:forge",
    )!.collision!;
    const inside = structuredClone(original);
    inside.player.position = { ...collision.center };
    inside.player.previousPosition = { ...collision.center };
    expect(() => stateFromSnapshot(inside)).toThrow(
      "state.player.previousPosition→position must not cross a wall or solid object",
    );

    const scenery = sceneryCollisions(original.map);
    const lantern = buildSceneryLayout(original.map).find(
      ({ id }) => id === "architecture:opening:lantern:0",
    )!.collision!;
    const from = {
      x: lantern.center.x - 64,
      y: lantern.center.y + lantern.halfHeight + original.player.radius - 1,
    };
    const to = { x: lantern.center.x + 64, y: from.y };
    expect(
      navigationPointWalkable(
        original.map,
        scenery,
        from,
        original.player.radius,
      ),
    ).toBe(true);
    expect(
      navigationPointWalkable(
        original.map,
        scenery,
        to,
        original.player.radius,
      ),
    ).toBe(true);
    expect(
      navigationSegmentWalkable(
        original.map,
        scenery,
        from,
        to,
        original.player.radius,
      ),
    ).toBe(false);
    const crossing = structuredClone(original);
    crossing.player.previousPosition = from;
    crossing.player.position = to;
    expect(() => stateFromSnapshot(crossing)).toThrow(
      "state.player.previousPosition→position must not cross a wall or solid object",
    );
  });

  it("rejects a scenario actor whose declared tile is inside solid art", () => {
    const scenario = createRunScenario("scenario-solid-start", "vanguard");
    const baseline = worldFromScenario(scenario);
    const forge = buildSceneryLayout(baseline.map).find(
      ({ id }) => id === "structure:0:forge",
    )!;
    const blockedTile = Array.from(
      { length: baseline.map.width * baseline.map.height },
      (_, index) => ({
        x: index % baseline.map.width,
        y: Math.floor(index / baseline.map.width),
      }),
    ).find((tile) => {
      const center = tileCenter(tile);
      return (
        navigationPointWalkable(
          baseline.map,
          [],
          center,
          baseline.player.radius,
        ) && overlapsScenery(center, baseline.player.radius, forge.collision!)
      );
    });
    expect(blockedTile).toBeDefined();
    scenario.player = {
      ...scenario.player,
      tile: [blockedTile!.x, blockedTile!.y],
    };
    scenario.monsters = [];

    expect(() => worldFromScenario(scenario)).toThrow(
      "Player previousPosition→position must not cross a wall or solid object",
    );
  });

  it("constructs a complete mid-action state without playing through setup", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["mid-action"]!);
    expect(state.tick).toBe(240);
    expect(state.player.animation).toMatchObject({
      clip: "ability",
      startedAtTick: 234,
      lockedUntilTick: 270,
    });
    expect(state.pendingAttacks).toHaveLength(1);
    expect(state.projectiles).toHaveLength(1);
    expect(state.effects).toHaveLength(1);
    expect(state.monsters[0]?.animation.clip).toBe("attack");
    expect(worldFromScenario(BUILTIN_SCENARIOS["mid-action"]!)).toEqual(state);
  });

  it("rejects malformed arbitrary states before mutating a world", () => {
    const malformed = structuredClone(BUILTIN_SCENARIOS["mid-action"]!);
    malformed.projectiles![0]!.id = "monster:winding-up";
    expect(() => worldFromScenario(malformed)).toThrow("Duplicate entity id");
  });

  it.each([
    ["unknown top-level field", { typoField: true }],
    ["non-numeric player health", { player: { health: "73" } }],
    [
      "invalid monster animation",
      {
        monsters: [
          {
            id: "monster:bad",
            kind: "ashfang",
            tile: [8, 7],
            animation: { clip: "teleport" },
          },
        ],
      },
    ],
    ["non-boolean setting", { settings: { ai: "sometimes" } }],
    ["incomplete RNG stream", { rng: { combat: { state: 123 } } }],
    [
      "invalid loot kind",
      { loot: [{ id: "loot:bad", kind: "armor", tile: [8, 7] }] },
    ],
    [
      "reserved player entity ID",
      { monsters: [{ id: "player", kind: "ashfang", tile: [8, 7] }] },
    ],
    [
      "unsupported generated dimensions",
      { map: { mode: "generated", width: 8, height: 6 } },
    ],
    [
      "city landmark placement on an explicit map",
      { player: { placement: "city-landmark-approach" } },
    ],
  ])("rejects ScenarioV1 with %s", (_label, patch) => {
    const base = structuredClone(BUILTIN_SCENARIOS["animation-idle"]!) as any;
    Object.assign(base, patch);
    expect(() => worldFromScenario(base)).toThrow();
  });

  it("strictly validates explicit map symbols and unique landmarks", () => {
    expect(() => explicitDungeon(["#####", "#PPE#", "#####"])).toThrow(
      "exactly one",
    );
    expect(() => explicitDungeon(["#####", "#PXE#", "#####"])).toThrow(
      "Unknown explicit map tile",
    );
    expect(() => explicitDungeon(["#####", "#P.E#", "####"])).toThrow(
      "equal width",
    );
  });

  it("supports deterministic connected generation at accepted minimum dimensions", () => {
    const first = worldFromScenario({
      schemaVersion: 1,
      id: "minimum-generated",
      seed: "minimum-generated",
      classId: "ranger",
      map: { mode: "generated", width: 20, height: 16 },
      monsters: [],
    });
    const second = worldFromScenario({
      schemaVersion: 1,
      id: "minimum-generated",
      seed: "minimum-generated",
      classId: "ranger",
      map: { mode: "generated", width: 20, height: 16 },
      monsters: [],
    });
    expect(first.map).toEqual(second.map);
    expect(reachableFloorCount(first.map)).toBe(totalFloorCount(first.map));
  });

  it("replays an input tape with the same checkpoint hashes", () => {
    const tape: ReplayTapeV1 = {
      version: 1,
      scenarioId: "animation-walk",
      entries: [
        { tick: 0, input: { moveX: 1 } },
        { tick: 12, input: { moveY: -1 } },
        { tick: 25, input: { moveX: 0, moveY: 0 } },
      ],
    };
    const first = playReplay(
      worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!),
      tape,
      32,
    );
    tape.checkpoints = first.hashes.filter((entry) =>
      [1, 13, 32].includes(entry.tick),
    );
    const second = playReplay(
      worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!),
      tape,
      32,
    );
    expect(second.hashes).toEqual(first.hashes);
  });

  it("treats replay entries as persistent input changes like the browser bridge", () => {
    const tape: ReplayTapeV1 = {
      version: 1,
      entries: [
        { tick: 0, input: { moveX: 1 } },
        { tick: 4, input: { moveY: -1 } },
        { tick: 8, input: { moveX: 0, moveY: 0 } },
      ],
    };
    const result = playReplay(
      worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!),
      tape,
      9,
    );
    expect(result.state.metrics.distanceUnits).toBeGreaterThan(
      result.state.player.moveSpeed * 7,
    );
    expect(result.state.player.velocity).toEqual({ x: 0, y: 0 });
  });

  it("keeps named cosmetic RNG draws isolated from gameplay streams", () => {
    const streams = createRngStreams("isolation");
    const before = structuredClone(streams);
    randomFloat(streams.cosmetic);
    randomFloat(streams.cosmetic);
    expect(streams.map).toEqual(before.map);
    expect(streams.combat).toEqual(before.combat);
    expect(streams.loot).toEqual(before.loot);
    expect(streams.ai).toEqual(before.ai);
  });

  it("resolves vanguard combat on its documented impact tick and collects guaranteed loot", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["combat-loot"]!);
    stepGame(state, { ...EMPTY_INPUT, attack: true });
    expect(state.pendingAttacks).toHaveLength(1);
    for (let index = 0; index < 8; index += 1) stepGame(state, EMPTY_INPUT);
    expect(state.metrics.kills).toBe(1);
    expect(state.loot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "ashfang-pelt", amount: 1 }),
        expect.objectContaining({ kind: "gold", amount: 6 }),
      ]),
    );
    expect(state.eventLog.map((event) => event.type)).toContain("loot_dropped");
  });

  it("moves through floor but rejects a wall collision", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const start = { ...state.player.position };
    stepGame(state, { ...EMPTY_INPUT, moveX: 1 });
    expect(state.player.position.x).toBeGreaterThan(start.x);
    for (let index = 0; index < 999; index += 1)
      stepGame(state, { ...EMPTY_INPUT, moveX: -1 });
    expect(state.player.position.x).toBeGreaterThanOrEqual(state.player.radius);
  });

  it("records deterministic animation clip starts at exact input ticks", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    stepGame(state, { ...EMPTY_INPUT, moveX: 1 });
    expect(state.player.animation).toMatchObject({
      clip: "walk",
      startedAtTick: 0,
    });
    stepGame(state, EMPTY_INPUT);
    expect(state.player.animation).toMatchObject({
      clip: "idle",
      startedAtTick: 1,
    });
  });

  it("keeps an idle render foot anchor fixed while animation frames advance", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    const camera = {
      x: (state.player.position.x / 1024) * 48,
      y: (state.player.position.y / 1024) * 48,
      zoom: 1,
    };
    const first = buildRenderManifest(state, camera).drawCalls.find(
      (call) => call.entityId === "player",
    )!;
    for (let index = 0; index < 12; index += 1) stepGame(state, EMPTY_INPUT);
    const later = buildRenderManifest(state, camera).drawCalls.find(
      (call) => call.entityId === "player",
    )!;
    expect(later.footAnchor).toEqual(first.footAnchor);
    expect(later.frameIndex).not.toBe(first.frameIndex);
  });

  it("renders deterministic sub-tick positions between authoritative states", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const camera = {
      x: (state.player.position.x / 1024) * 48,
      y: (state.player.position.y / 1024) * 48,
      zoom: 1,
    };
    const startX = state.player.position.x;
    stepGame(state, { ...EMPTY_INPUT, moveX: 1 });
    const samples = [0, 0.25, 0.5, 0.75, 1].map((alpha) => {
      const manifest = buildRenderManifest(state, camera, {
        interpolationAlpha: alpha,
      });
      return {
        presentationTick: manifest.presentationTick,
        alpha: manifest.interpolationAlpha,
        x: manifest.drawCalls.find((call) => call.entityId === "player")!
          .worldAnchor.x,
      };
    });
    expect(samples).toEqual([
      { presentationTick: 0, alpha: 0, x: startX },
      { presentationTick: 0.25, alpha: 0.25, x: startX + 18 },
      { presentationTick: 0.5, alpha: 0.5, x: startX + 36 },
      { presentationTick: 0.75, alpha: 0.75, x: startX + 54 },
      { presentationTick: 1, alpha: 1, x: startX + 72 },
    ]);
  });
});
