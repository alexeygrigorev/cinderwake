import { describe, expect, it } from "vitest";

import type { GameState } from "../../src/game/types";
import type { RenderManifestV1 } from "../../src/render/manifest";
import { installPlayerObserver } from "../../src/testkit/playerObserver";

describe("production player observer", () => {
  it("records state owners, manifest owners, body paints, and effects per sample", () => {
    const state = {
      monsters: [{ id: "monster:ashfang" }],
      projectiles: [{ id: "projectile:0" }],
      loot: [],
      effects: [
        {
          id: "effect:impact",
          kind: "impact",
          ownerId: "monster:ashfang",
          startedAtTick: 9,
          expiresAtTick: 17,
        },
      ],
    } as unknown as GameState;
    const manifest = {
      tick: 9,
      presentationTick: 9.5,
      sceneSprites: [],
      drawCalls: [
        { entityId: "player", type: "player", visible: true },
        { entityId: "monster:ashfang", type: "monster", visible: false },
        { entityId: "projectile:0", type: "projectile", visible: false },
        {
          entityId: "effect:impact",
          type: "effect",
          geometryId: "effect:impact",
          ownerId: "monster:ashfang",
          visible: true,
        },
      ],
      paintQueue: [
        {
          kind: "entity-body",
          ownerId: "player",
          call: { visible: true },
        },
        {
          kind: "entity-body",
          ownerId: "effect:impact",
          call: { visible: true },
        },
      ],
      worldUi: [],
    } as unknown as RenderManifestV1;
    const host = {
      getState: () => state,
      getManifest: () => manifest,
      getCanvas: () =>
        ({ toDataURL: () => "data:image/png;base64," }) as HTMLCanvasElement,
    };

    const { observer, record } = installPlayerObserver(host, {} as Window);
    record(manifest);

    expect(observer.presentationSamples()).toMatchObject([
      {
        tick: 9,
        presentationTick: 9.5,
        expectedOwnerIds: [
          "effect:impact",
          "monster:ashfang",
          "player",
          "projectile:0",
        ],
        observedOwnerIds: [
          "effect:impact",
          "monster:ashfang",
          "player",
          "projectile:0",
        ],
        ownerPaints: [
          { ownerId: "effect:impact", bodyPaintCount: 1 },
          { ownerId: "player", bodyPaintCount: 1 },
        ],
        effectDetails: [
          {
            effectId: "effect:impact",
            kind: "impact",
            ownerId: "monster:ashfang",
            startedAtTick: 9,
            expectedDespawnStateTick: 18,
          },
        ],
        expectedEffects: [
          {
            effectId: "effect:impact",
            kind: "impact",
            ownerId: "monster:ashfang",
            startedAtTick: 9,
            expectedDespawnStateTick: 18,
          },
        ],
      },
    ]);
  });
});
