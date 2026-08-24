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
// Effect ownership/detachment remains deliberately covered by
// assessCombatReadability: effects carry combat-only owner semantics, while
// this gate owns generic actor/prop/body/shadow/health paint ordering.
export function assessDepthTransition(
  manifest: RenderManifestV1,
): DepthTransitionAssessment {
  const violations: string[] = [];
  const { paintQueue: queue } = manifest;
  const indexes = indexByPaintId(queue);
  for (const [index, item] of queue.entries()) {
    if (item.zOrder !== index)
      violations.push(`paint-z-order-mismatch:${item.paintId}`);
  }
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
  for (const first of bodies) {
    for (const second of bodies) {
      if (first.ownerId >= second.ownerId) continue;
      if (!intersects(first.call.destinationRect, second.call.destinationRect)) continue;
      actorActorIntersections += 1;
      const firstIndex = indexes.get(first.paintId)!;
      const secondIndex = indexes.get(second.paintId)!;
      const footDelta = first.call.footAnchor.y - second.call.footAnchor.y;
      const correct =
        Math.abs(footDelta) < 0.01
          ? firstIndex < secondIndex
          : footDelta < 0
            ? firstIndex < secondIndex
            : firstIndex > secondIndex;
      if (!correct)
        violations.push(`actor-depth-inverted:${first.ownerId}:${second.ownerId}`);
    }
  }
  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    violations: [...new Set(violations)],
    evidence: { paintCount: queue.length, actorPropIntersections, actorActorIntersections },
  };
}
