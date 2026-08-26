import { describe, expect, it } from "vitest";
import {
  DEPTH_TRANSITION_SIGNAL_IDS,
  evaluateDepthTransitionEvidence,
} from "../../scripts/lib/depth-transition-evidence.mjs";

const CAMERA = { x: 0, y: 0, zoom: 1 };

function stateFor(playerY: number) {
  return {
    player: {
      id: "player",
      position: { x: 0, y: playerY },
      previousPosition: { x: 0, y: playerY },
    },
    monsters: [
      {
        id: "monster:depth",
        position: { x: 2_560, y: 640 },
        previousPosition: { x: 2_560, y: 640 },
      },
    ],
    effects: [
      {
        id: "effect:slash",
        ownerId: "player",
        position: { x: 0, y: playerY },
      },
    ],
  };
}

function actor(
  entityId: string,
  type: "player" | "monster",
  screenAnchor: { x: number; y: number },
  destinationRect: { x: number; y: number; width: number; height: number },
  footY: number,
  clip = "idle",
  frameIndex = 0,
) {
  return {
    entityId,
    type,
    worldAnchor:
      entityId === "player"
        ? { x: 0, y: (screenAnchor.y - 270) * (1024 / 48) }
        : { x: 2_560, y: 640 },
    screenAnchor,
    presentationOffset: { x: 0, y: 0 },
    destinationRect,
    footAnchor: { x: screenAnchor.x, y: footY },
    clip,
    frameIndex,
    visible: true,
    opacity: 1,
  };
}

function scene() {
  return {
    objectId: "prop:tree",
    worldAnchor: { x: 0, y: 0 },
    screenAnchor: { x: 480, y: 270 },
    destinationRect: { x: 420, y: 220, width: 160, height: 120 },
    layer: "props",
    visible: true,
    opacity: 1,
  };
}

function health() {
  return {
    id: "health:monster:depth",
    type: "monster-health",
    ownerId: "monster:depth",
    destinationRect: { x: 585, y: 210, width: 30, height: 10 },
    actorInkTop: 224,
    healthRatio: 0.7,
    frameOpacity: 0.8,
    fillOpacity: 0.7,
    visible: true,
  };
}

function queueFor(
  player: ReturnType<typeof actor>,
  monster: ReturnType<typeof actor>,
  effect: any,
  prop: ReturnType<typeof scene>,
  ui: ReturnType<typeof health>,
  front: boolean,
): any[] {
  const entries: any[] = front
    ? [
        {
          paintId: "scene:prop:tree",
          kind: "scene",
          scene: prop,
        },
        {
          paintId: "body:effect:slash",
          kind: "entity-body",
          ownerId: "effect:slash",
          call: effect,
        },
        {
          paintId: "shadow:player",
          kind: "actor-shadow",
          ownerId: "player",
          call: player,
        },
        {
          paintId: "body:player",
          kind: "entity-body",
          ownerId: "player",
          call: player,
        },
      ]
    : [
        {
          paintId: "body:effect:slash",
          kind: "entity-body",
          ownerId: "effect:slash",
          call: effect,
        },
        {
          paintId: "shadow:player",
          kind: "actor-shadow",
          ownerId: "player",
          call: player,
        },
        {
          paintId: "body:player",
          kind: "entity-body",
          ownerId: "player",
          call: player,
        },
        {
          paintId: "scene:prop:tree",
          kind: "scene",
          scene: prop,
        },
      ];
  entries.push(
    {
      paintId: "shadow:monster:depth",
      kind: "actor-shadow",
      ownerId: "monster:depth",
      call: monster,
    },
    {
      paintId: "body:monster:depth",
      kind: "entity-body",
      ownerId: "monster:depth",
      call: monster,
    },
    {
      paintId: "health-frame:monster:depth",
      kind: "health-frame",
      ownerId: "monster:depth",
      worldUi: ui,
    },
    {
      paintId: "health-fill:monster:depth",
      kind: "health-fill",
      ownerId: "monster:depth",
      worldUi: ui,
    },
  );
  return entries.map((item, zOrder) => ({ ...item, zOrder }));
}

function frame(
  id: string,
  tick: number,
  front: boolean,
  frameIndex: number,
): any {
  const playerY = front ? 426.6666666666667 : -426.6666666666667;
  const playerScreen = { x: 480, y: front ? 290 : 250 };
  const player = actor(
    "player",
    "player",
    playerScreen,
    {
      x: 430,
      y: front ? 240 : 200,
      width: 100,
      height: 100,
    },
    front ? 290 : 250,
  );
  const monster = actor(
    "monster:depth",
    "monster",
    { x: 600, y: 300 },
    { x: 550, y: 230, width: 100, height: 100 },
    300,
    "attack",
    frameIndex,
  );
  const effect = {
    ...actor(
      "effect:slash",
      "player",
      playerScreen,
      player.destinationRect,
      front ? 290 : 250,
    ),
    type: "effect",
    ownerId: "player",
    worldAnchor: { x: 0, y: playerY },
    opacity: 0.4,
  };
  const prop = scene();
  const ui = health();
  const manifest = {
    interpolationAlpha: 1,
    tick,
    camera: CAMERA,
    drawCalls: [player, monster, effect],
    sceneSprites: [prop],
    worldUi: [ui],
    paintQueue: queueFor(player, monster, effect, prop, ui, front),
  };
  return {
    id,
    tick,
    stateTick: tick,
    manifestTick: tick,
    snapshot: stateFor(playerY),
    manifest,
    depth: {
      actorId: "player",
      occluderId: "prop:tree",
      actorPaintId: "body:player",
      occluderPaintId: "scene:prop:tree",
      alphaIntersection: 42,
    },
    masks: [
      { paintId: "health-frame:monster:depth", alphaPixels: 200 },
      { paintId: "health-fill:monster:depth", alphaPixels: 150 },
    ],
    healthMetrics: [
      {
        ownerId: "monster:depth",
        framePaintId: "health-frame:monster:depth",
        fillPaintId: "health-fill:monster:depth",
        ownerAlphaPixels: 1_000,
        frameOverlapPixels: 10,
        fillOverlapPixels: 5,
      },
    ],
    effectMetrics: [
      {
        effectId: "effect:slash",
        ownerAlphaPixels: 1_000,
        overlapPixels: 100,
        opacity: 0.4,
      },
    ],
  };
}

function evidence(): any {
  return {
    frames: [frame("behind", 10, false, 0), frame("front", 11, true, 1)],
    transitions: [
      {
        behindFrameId: "behind",
        frontFrameId: "front",
        actorId: "player",
        occluderId: "prop:tree",
      },
    ],
    requiredEffectOwnerIds: ["player"],
    combatLifecycle: [
      {
        frameId: "behind",
        actorId: "monster:depth",
        clip: "attack",
        frameIndex: 0,
      },
      {
        frameId: "front",
        actorId: "monster:depth",
        clip: "attack",
        frameIndex: 1,
      },
    ],
  };
}

function reindex(frameValue: any) {
  frameValue.manifest.paintQueue.forEach(
    (item: any, index: number) => (item.zOrder = index),
  );
}

function swapPaint(
  frameValue: any,
  firstPaintId: string,
  secondPaintId: string,
) {
  const queue = frameValue.manifest.paintQueue;
  const first = queue.findIndex(({ paintId }: any) => paintId === firstPaintId);
  const second = queue.findIndex(
    ({ paintId }: any) => paintId === secondPaintId,
  );
  [queue[first], queue[second]] = [queue[second], queue[first]];
  reindex(frameValue);
}

describe("depth transition evidence", () => {
  it("passes the bounded transition, attachment, health, and lifecycle bundle", () => {
    const result = evaluateDepthTransitionEvidence(evidence());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.map(({ id }) => id)).toEqual(
      DEPTH_TRANSITION_SIGNAL_IDS,
    );
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
    expect(result.summary).toMatchObject({
      frameCount: 2,
      transitions: 1,
      depthSamples: 2,
      attachments: 2,
      health: 2,
      combatFrames: 2,
    });
  });

  it.each([
    [
      "actor-prop-z-swapped",
      "depth-order-mismatch:prop:tree",
      (value: any) => {
        swapPaint(value.frames[0], "body:player", "scene:prop:tree");
      },
    ],
    [
      "health-behind-owner",
      "health-z-order-mismatch:monster:depth",
      (value: any) => {
        swapPaint(
          value.frames[0],
          "body:monster:depth",
          "health-frame:monster:depth",
        );
      },
    ],
    [
      "effect-detached",
      "effect-owner-detached:effect:slash",
      (value: any) => {
        value.frames[0].manifest.drawCalls.find(
          ({ entityId }: any) => entityId === "effect:slash",
        ).ownerId = "monster:missing";
      },
    ],
    [
      "actor-drawn-twice",
      "duplicate-owner-body:player",
      (value: any) => {
        const body = value.frames[0].manifest.paintQueue.find(
          ({ paintId }: any) => paintId === "body:player",
        );
        value.frames[0].manifest.paintQueue.push({ ...body });
        reindex(value.frames[0]);
      },
    ],
    [
      "rear-actor-covers-front",
      "actor-depth-inverted:player:monster:depth",
      (value: any) => {
        const current = value.frames[0];
        const monster = current.manifest.drawCalls.find(
          ({ entityId }: any) => entityId === "monster:depth",
        );
        monster.destinationRect = { x: 450, y: 210, width: 100, height: 100 };
        monster.footAnchor.y = 260;
        swapPaint(current, "body:player", "body:monster:depth");
      },
    ],
    [
      "health-enlarged-or-opaque",
      "health-occlusion-ratio-exceeded:monster:depth",
      (value: any) => {
        const ui = value.frames[0].manifest.worldUi[0];
        ui.destinationRect.width = 50;
        ui.frameOpacity = 1;
        ui.fillOpacity = 1;
      },
    ],
    [
      "effect-covers-owner",
      "effect-owner-occlusion-ratio-exceeded:effect:slash",
      (value: any) => {
        const metric = value.frames[0].effectMetrics[0];
        metric.overlapPixels = 500;
        metric.opacity = 1;
      },
    ],
  ])("detects %s", (_id, failure, mutate) => {
    const value = evidence();
    mutate(value);

    expect(evaluateDepthTransitionEvidence(value).failures).toContain(failure);
  });

  it("detects a state/manifest projection drift and an unordered combat lifecycle", () => {
    const anchorDrift = evidence();
    anchorDrift.frames[0].manifest.drawCalls.find(
      ({ entityId }: any) => entityId === "player",
    ).screenAnchor.x += 2;
    expect(evaluateDepthTransitionEvidence(anchorDrift).failures).toContain(
      "presentation-offset-mismatch:player",
    );

    const lifecycleDrift = evidence();
    lifecycleDrift.combatLifecycle[1].frameIndex = 0;
    expect(evaluateDepthTransitionEvidence(lifecycleDrift).failures).toContain(
      "combat-sequence-mismatch:front",
    );
  });
});
