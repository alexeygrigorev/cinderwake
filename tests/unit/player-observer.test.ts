import { describe, expect, it } from "vitest";

import type { GameState } from "../../src/game/types";
import type { RenderManifestV1 } from "../../src/render/manifest";
import { installPlayerObserver } from "../../src/testkit/playerObserver";

describe("production player observer", () => {
  it("distinguishes CSS-cropped canvas bodies from bodies visible on the device", () => {
    const state = {
      monsters: [],
      projectiles: [],
      loot: [],
      effects: [],
    } as unknown as GameState;
    const manifest = {
      tick: 0,
      presentationTick: 0,
      camera: {},
      cameraTarget: {},
      cameraMode: "smooth",
      viewport: { width: 960, height: 540 },
      sceneSprites: [],
      paintQueue: [],
      worldUi: [],
      drawCalls: [
        {
          entityId: "cropped",
          type: "monster",
          visible: true,
          destinationRect: { x: 100, y: 200, width: 100, height: 100 },
        },
        {
          entityId: "center",
          type: "monster",
          visible: true,
          destinationRect: { x: 600, y: 200, width: 100, height: 100 },
        },
        {
          entityId: "edge",
          type: "monster",
          visible: true,
          destinationRect: { x: 930, y: 200, width: 60, height: 100 },
        },
      ],
    } as unknown as RenderManifestV1;
    const target = { innerWidth: 480, innerHeight: 540 };
    const { observer, record } = installPlayerObserver(
      {
        getState: () => state,
        getManifest: () => manifest,
        getCanvas: () =>
          ({
            getBoundingClientRect: () => ({
              left: -480,
              top: 0,
              width: 960,
              height: 540,
            }),
          }) as HTMLCanvasElement,
      },
      target as Window,
    );
    record(manifest);
    expect(observer.presentationSamples()[0]).toMatchObject({
      visibleMonsterIds: ["center", "cropped", "edge"],
      deviceVisibleMonsterIds: ["center", "edge"],
      deviceViewport: {
        width: 480,
        height: 540,
        canvas: { x: -480, y: 0, width: 960, height: 540 },
      },
    });
    target.innerHeight = 100;
    record(manifest);
    expect(observer.presentationSamples()[1]!.deviceVisibleMonsterIds).toEqual(
      [],
    );
  });

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
      camera: { x: 720, y: 420, zoom: 0.9 },
      cameraTarget: { x: 728, y: 420, zoom: 0.9 },
      cameraMode: "smooth",
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
        camera: { x: 720, y: 420, zoom: 0.9 },
        cameraTarget: { x: 728, y: 420, zoom: 0.9 },
        cameraMode: "smooth",
        deviceVisibleMonsterIds: null,
        deviceViewport: null,
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
