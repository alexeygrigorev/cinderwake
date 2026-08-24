import { describe, expect, it } from "vitest";
import {
  buildPaintQueue,
  buildRenderManifest,
  type PaintQueueItemV1,
} from "../../src/render/manifest";
import { createRunScenario, worldFromScenario } from "../../src/testkit/scenarios";
import { assessDepthTransition } from "../framework/depth-transition";

function productionManifest() {
  const state = worldFromScenario(createRunScenario("cinder-041", "vanguard"));
  const manifest = buildRenderManifest(state, { x: 22.5 * 48, y: 16.5 * 48, zoom: 0.9 });
  manifest.paintQueue = buildPaintQueue(manifest);
  return manifest;
}

describe("PRES-DEPTH-019 paint queue", () => {
  it("exposes the exact scene, shadow, body, and attachment paint plan", () => {
    const manifest = productionManifest();
    const queue = manifest.paintQueue;
    expect(queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paintId: "body:player", kind: "entity-body" }),
        expect.objectContaining({ paintId: "shadow:player", kind: "actor-shadow" }),
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
    [actorPropSwapped.paintQueue[bodyIndex], actorPropSwapped.paintQueue[sceneIndex]] = [
      actorPropSwapped.paintQueue[sceneIndex]!,
      actorPropSwapped.paintQueue[bodyIndex]!,
    ];
    actorPropSwapped.paintQueue.forEach((item, index) => (item.zOrder = index));
    // Force a real overlap while retaining the swapped paint order.
    const swappedBody = actorPropSwapped.paintQueue.find((item) => item.paintId === "body:player") as Extract<PaintQueueItemV1, { kind: "entity-body" }>;
    const swappedScene = actorPropSwapped.paintQueue.find(
      (item): item is Extract<PaintQueueItemV1, { kind: "scene" }> => item.kind === "scene" && item.scene.objectId === scene.scene.objectId,
    )!;
    swappedBody.call.destinationRect = { ...swappedScene.scene.destinationRect };
    const swappedBodyIndex = actorPropSwapped.paintQueue.indexOf(swappedBody);
    const swappedSceneIndex = actorPropSwapped.paintQueue.indexOf(swappedScene);
    swappedBody.call.footAnchor = {
      ...swappedScene.scene.screenAnchor,
      y: swappedScene.scene.screenAnchor.y + (swappedBodyIndex > swappedSceneIndex ? -1 : 1),
    };
    expect(assessDepthTransition(actorPropSwapped).violations.join(" ")).toContain("depth-order-mismatch");

    const duplicate = structuredClone(manifest);
    duplicate.paintQueue.push(structuredClone(body));
    expect(assessDepthTransition(duplicate).violations.join(" ")).toContain("duplicate-owner-body:player");

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
    expect(assessDepthTransition(healthBehind).violations.join(" ")).toContain("health-z-order-mismatch:player");
  });
});
