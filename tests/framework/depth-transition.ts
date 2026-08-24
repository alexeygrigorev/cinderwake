import type {
  DestinationRectV1,
  PaintQueueItemV1,
  RenderManifestV1,
} from "../../src/render/manifest";

export interface DepthTransitionAssessment {
  verdict: "PASS" | "FAIL";
  violations: string[];
  evidence: {
    paintCount: number;
    actorPropIntersections: number;
    actorActorIntersections: number;
  };
}

function intersects(first: DestinationRectV1, second: DestinationRectV1): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function indexByPaintId(queue: readonly PaintQueueItemV1[]): Map<string, number> {
  return new Map(queue.map((item, index) => [item.paintId, index]));
}

/** Pure paint-queue oracle for PRES-DEPTH-019. */
export function assessDepthTransition(
  manifest: RenderManifestV1,
): DepthTransitionAssessment {
  const violations: string[] = [];
  const { paintQueue: queue } = manifest;
  const indexes = indexByPaintId(queue);
  const bodies = queue.filter(
    (item): item is Extract<PaintQueueItemV1, { kind: "entity-body" }> =>
      item.kind === "entity-body",
  );
  const scenes = queue.filter(
    (item): item is Extract<PaintQueueItemV1, { kind: "scene" }> =>
      item.kind === "scene" && item.scene.layer !== "terrain",
  );
  for (const body of bodies) {
    const copies = bodies.filter(({ ownerId }) => ownerId === body.ownerId);
    if (copies.length !== 1)
      violations.push(`duplicate-owner-body:${body.ownerId}`);
    const bodyIndex = indexes.get(body.paintId)!;
    const shadowIndex = indexes.get(`shadow:${body.ownerId}`);
    if (shadowIndex !== undefined && shadowIndex >= bodyIndex)
      violations.push(`shadow-z-order-mismatch:${body.ownerId}`);
    const healthFrame = indexes.get(`health-frame:${body.ownerId}`);
    const healthFill = indexes.get(`health-fill:${body.ownerId}`);
    if (healthFrame !== undefined && healthFrame <= bodyIndex)
      violations.push(`health-z-order-mismatch:${body.ownerId}`);
    if (healthFrame !== undefined && healthFill !== undefined && healthFill <= healthFrame)
      violations.push(`health-fill-z-order-mismatch:${body.ownerId}`);
  }
  let actorPropIntersections = 0;
  for (const body of bodies) {
    for (const scene of scenes) {
      if (!intersects(body.call.destinationRect, scene.scene.destinationRect)) continue;
      actorPropIntersections += 1;
      const bodyIndex = indexes.get(body.paintId)!;
      const sceneIndex = indexes.get(scene.paintId)!;
      const actorIsSouth = body.call.footAnchor.y >= scene.scene.screenAnchor.y;
      const correct = actorIsSouth ? bodyIndex > sceneIndex : bodyIndex < sceneIndex;
      if (!correct)
        violations.push(`depth-order-mismatch:${body.ownerId}:${scene.scene.objectId}`);
    }
  }
  let actorActorIntersections = 0;
  for (const rear of bodies) {
    for (const front of bodies) {
      if (rear.ownerId >= front.ownerId) continue;
      if (!intersects(rear.call.destinationRect, front.call.destinationRect)) continue;
      actorActorIntersections += 1;
      const rearIsNorth = rear.call.footAnchor.y < front.call.footAnchor.y;
      const rearIndex = indexes.get(rear.paintId)!;
      const frontIndex = indexes.get(front.paintId)!;
      if (rearIsNorth ? rearIndex >= frontIndex : frontIndex >= rearIndex)
        violations.push(`actor-depth-inverted:${rear.ownerId}:${front.ownerId}`);
    }
  }
  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    violations: [...new Set(violations)],
    evidence: { paintCount: queue.length, actorPropIntersections, actorActorIntersections },
  };
}
