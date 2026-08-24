import { describe, expect, it } from "vitest";
import {
  buildPaintQueue,
  buildRenderManifest,
  type PaintQueueItemV1,
} from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  worldFromScenario,
} from "../../src/testkit/scenarios";
import { assessDepthTransition } from "../framework/depth-transition";

function productionManifest() {
  const state = worldFromScenario(createRunScenario("cinder-041", "vanguard"));
  const manifest = buildRenderManifest(state, {
    x: 22.5 * 48,
    y: 16.5 * 48,
    zoom: 0.9,
  });
  return manifest;
}

function overlappingActorsManifest() {
  const state = worldFromScenario(
    BUILTIN_SCENARIOS["temporal-ashfang-attack"]!,
  );
  const manifest = buildRenderManifest(state, {
    x: 9 * 48,
    y: 7 * 48,
    zoom: 0.9,
  });
  manifest.paintQueue = buildPaintQueue(manifest);
  return manifest;
}

describe("PRES-DEPTH-019 paint queue", () => {
  it("exposes the exact scene, shadow, body, and attachment paint plan", () => {
    const manifest = productionManifest();
    const queue = manifest.paintQueue;
    expect(queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paintId: "body:player",
          kind: "entity-body",
        }),
        expect.objectContaining({
          paintId: "shadow:player",
          kind: "actor-shadow",
        }),
        expect.objectContaining({ kind: "scene" }),
      ]),
    );
    expect(queue.map(({ zOrder }) => zOrder)).toEqual(
      Array.from({ length: queue.length }, (_, index) => index),
    );
    expect(assessDepthTransition(manifest).verdict).toBe("PASS");
  });

  it("rejects each executable depth negative control", () => {
    const manifest = productionManifest();
    const body = manifest.paintQueue.find(
      (item) => item.paintId === "body:player",
    )!;
    const scene = manifest.paintQueue.find(
      (item): item is Extract<PaintQueueItemV1, { kind: "scene" }> =>
        item.kind === "scene" && item.scene.layer !== "terrain",
    )!;
    const bodyIndex = manifest.paintQueue.indexOf(body);
    const sceneIndex = manifest.paintQueue.indexOf(scene);
    const actorPropSwapped = structuredClone(manifest);
    [
      actorPropSwapped.paintQueue[bodyIndex],
      actorPropSwapped.paintQueue[sceneIndex],
    ] = [
      actorPropSwapped.paintQueue[sceneIndex]!,
      actorPropSwapped.paintQueue[bodyIndex]!,
    ];
    actorPropSwapped.paintQueue.forEach((item, index) => (item.zOrder = index));
    // Force a real overlap while retaining the swapped paint order.
    const swappedBody = actorPropSwapped.paintQueue.find(
      (item) => item.paintId === "body:player",
    ) as Extract<PaintQueueItemV1, { kind: "entity-body" }>;
    const swappedScene = actorPropSwapped.paintQueue.find(
      (item): item is Extract<PaintQueueItemV1, { kind: "scene" }> =>
        item.kind === "scene" && item.scene.objectId === scene.scene.objectId,
    )!;
    swappedBody.call.destinationRect = {
      ...swappedScene.scene.destinationRect,
    };
    const swappedBodyIndex = actorPropSwapped.paintQueue.indexOf(swappedBody);
    const swappedSceneIndex = actorPropSwapped.paintQueue.indexOf(swappedScene);
    swappedBody.call.footAnchor = {
      ...swappedScene.scene.screenAnchor,
      y:
        swappedScene.scene.screenAnchor.y +
        (swappedBodyIndex > swappedSceneIndex ? -1 : 1),
    };
    expect(
      assessDepthTransition(actorPropSwapped).violations.join(" "),
    ).toContain("depth-order-mismatch");

    const duplicate = structuredClone(manifest);
    duplicate.paintQueue.push(structuredClone(body));
    expect(assessDepthTransition(duplicate).violations.join(" ")).toContain(
      "duplicate-owner-body:player",
    );

    const healthBehind = structuredClone(manifest);
    healthBehind.paintQueue.push({
      paintId: "health-frame:player",
      kind: "health-frame",
      zOrder: 0,
      ownerId: "player",
      worldUi: {} as never,
    });
    healthBehind.paintQueue.unshift(healthBehind.paintQueue.pop()!);
    healthBehind.paintQueue.forEach((item, index) => (item.zOrder = index));
    expect(assessDepthTransition(healthBehind).violations.join(" ")).toContain(
      "health-z-order-mismatch:player",
    );

    const badZOrder = structuredClone(manifest);
    badZOrder.paintQueue[0]!.zOrder = 99;
    expect(assessDepthTransition(badZOrder).violations.join(" ")).toContain(
      "paint-z-order-mismatch",
    );
  });

  it("keeps overlapping actors in foot order and rejects a rear actor covering front", () => {
    const manifest = overlappingActorsManifest();
    const bodies = manifest.paintQueue.filter(
      (item): item is Extract<PaintQueueItemV1, { kind: "entity-body" }> =>
        item.kind === "entity-body",
    );
    expect(bodies).toHaveLength(2);
    expect(assessDepthTransition(manifest)).toMatchObject({
      verdict: "PASS",
      evidence: { actorActorIntersections: 1 },
    });

    const swapped = structuredClone(manifest);
    const [first, second] = bodies.map(({ paintId }) =>
      swapped.paintQueue.find((item) => item.paintId === paintId)!,
    );
    const firstIndex = swapped.paintQueue.indexOf(first!);
    const secondIndex = swapped.paintQueue.indexOf(second!);
    [swapped.paintQueue[firstIndex], swapped.paintQueue[secondIndex]] = [
      swapped.paintQueue[secondIndex]!,
      swapped.paintQueue[firstIndex]!,
    ];
    swapped.paintQueue.forEach((item, index) => (item.zOrder = index));
    expect(assessDepthTransition(swapped).violations.join(" ")).toContain(
      "actor-depth-inverted",
    );

    const tied = structuredClone(manifest);
    const tiedBodies = tied.paintQueue.filter(
      (item): item is Extract<PaintQueueItemV1, { kind: "entity-body" }> =>
        item.kind === "entity-body",
    );
    tiedBodies[1]!.call.footAnchor.y = tiedBodies[0]!.call.footAnchor.y;
    expect(assessDepthTransition(tied).verdict).toBe("PASS");
  });
});
