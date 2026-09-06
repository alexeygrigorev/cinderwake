import type { EffectState, GameState, Vec2 } from "../game/types";
import { findStateNavigationRoute } from "../game/navigation";
import type {
  CameraMode,
  CameraV1,
  RenderManifestV1,
} from "../render/manifest";
import { canonicalState } from "./canonical";

export interface LivePresentationSampleV1 {
  observedAtMs: number;
  tick: number;
  presentationTick: number;
  /** Camera used by this presentation sample after display interpolation. */
  camera: CameraV1;
  /** Camera target derived from the same authoritative game state. */
  cameraTarget: CameraV1;
  cameraMode: CameraMode;
  playerFrameIdentity: string | null;
  playerFrameIndex: number | null;
  playerClip: string | null;
  playerFacingBucket: string | null;
  playerWorldAnchor: { x: number; y: number } | null;
  playerScreenAnchor: { x: number; y: number } | null;
  referenceScene: {
    objectId: string;
    screenAnchor: { x: number; y: number };
  } | null;
  /** Bodies intersecting the logical render canvas, including CSS-cropped ones. */
  visibleMonsterIds: string[];
  /** Bodies intersecting the physical page viewport; HUD occlusion is separate. */
  deviceVisibleMonsterIds: string[] | null;
  /** Sampled CSS geometry used for device visibility; null outside a browser. */
  deviceViewport: {
    width: number;
    height: number;
    canvas: { x: number; y: number; width: number; height: number };
  } | null;
  /** Every state entity expected to have a render-manifest owner. */
  expectedOwnerIds: string[];
  /** Every dynamic draw-call owner, including off-screen calls. */
  observedOwnerIds: string[];
  /** Visible entity-body paints grouped by their manifest owner. */
  ownerPaints: Array<{
    ownerId: string;
    bodyPaintCount: number;
  }>;
  /** Visible effect draw calls with state-backed lifecycle metadata. */
  effectDetails: Array<{
    effectId: string;
    kind: string;
    ownerId: string | null;
    startedAtTick: number;
    expectedDespawnStateTick: number;
  }>;
  /** State-backed effect lifecycle metadata for this presentation sample. */
  expectedEffects: Array<{
    effectId: string;
    kind: EffectState["kind"];
    ownerId: string | null;
    startedAtTick: number;
    expectedDespawnStateTick: number;
  }>;
  visibleMonsters: Array<{
    entityId: string;
    destinationRect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  monsterHealth: Array<{
    ownerId: string;
    destinationRect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    actorInkTop: number;
    frame: RenderManifestV1["worldUi"][number]["frame"];
    fill: RenderManifestV1["worldUi"][number]["fill"];
  }>;
}

export interface PlayerObserverV1 {
  readonly ready: true;
  readonly mode: "observe-only";
  snapshot(): ReturnType<typeof canonicalState>;
  renderManifest(): RenderManifestV1;
  captureFrame(): string;
  navigationRoute(target: Vec2): Vec2[];
  presentationSamples(): LivePresentationSampleV1[];
  clearPresentationSamples(): void;
}

interface ObservableHost {
  getState(): GameState;
  getManifest(): RenderManifestV1;
  getCanvas(): HTMLCanvasElement;
}

declare global {
  interface Window {
    __GAME_OBSERVE__?: PlayerObserverV1;
  }
}

/**
 * Installs a production-safe observability boundary. It returns cloned state,
 * manifests, pixels, and recent rAF presentation samples, but deliberately
 * exposes no input, stepping, reset, scenario, or state-mutation methods.
 */
export function installPlayerObserver(
  host: ObservableHost,
  target: Window = window,
): {
  observer: PlayerObserverV1;
  record(manifest: RenderManifestV1): void;
} {
  const samples: LivePresentationSampleV1[] = [];
  const observer: PlayerObserverV1 = {
    ready: true,
    mode: "observe-only",
    snapshot: () => canonicalState(host.getState()),
    renderManifest: () => structuredClone(host.getManifest()),
    captureFrame: () => host.getCanvas().toDataURL("image/png"),
    navigationRoute: (target) => {
      const state = host.getState();
      return findStateNavigationRoute(
        state,
        state.player.position,
        target,
        state.player.radius,
      ).map((point) => ({ ...point }));
    },
    presentationSamples: () => samples.map((sample) => structuredClone(sample)),
    clearPresentationSamples: () => samples.splice(0),
  };
  const record = (manifest: RenderManifestV1): void => {
    const state = host.getState();
    const canvasRect = host.getCanvas().getBoundingClientRect?.();
    const deviceViewport =
      canvasRect &&
      canvasRect.width > 0 &&
      canvasRect.height > 0 &&
      target.innerWidth > 0 &&
      target.innerHeight > 0 &&
      manifest.viewport
        ? {
            width: target.innerWidth,
            height: target.innerHeight,
            canvas: {
              x: canvasRect.left,
              y: canvasRect.top,
              width: canvasRect.width,
              height: canvasRect.height,
            },
          }
        : null;
    const visibleMonsters = manifest.drawCalls.filter(
      ({ type, visible }) => type === "monster" && visible,
    );
    const deviceVisibleMonsterIds = deviceViewport
      ? visibleMonsters
          .filter(({ destinationRect: rect }) => {
            const left =
              deviceViewport.canvas.x +
              (rect.x / manifest.viewport.width) * deviceViewport.canvas.width;
            const top =
              deviceViewport.canvas.y +
              (rect.y / manifest.viewport.height) *
                deviceViewport.canvas.height;
            const right =
              left +
              (rect.width / manifest.viewport.width) *
                deviceViewport.canvas.width;
            const bottom =
              top +
              (rect.height / manifest.viewport.height) *
                deviceViewport.canvas.height;
            return (
              right > 0 &&
              bottom > 0 &&
              left < deviceViewport.width &&
              top < deviceViewport.height
            );
          })
          .map(({ entityId }) => entityId)
          .sort()
      : null;
    const player = manifest.drawCalls.find(
      ({ entityId }) => entityId === "player",
    );
    const referenceScene =
      manifest.sceneSprites.find(
        ({ objectId, visible }) => objectId === "structure:0:forge" && visible,
      ) ??
      // Explicit directional-motion arenas have no generated forge. A stable
      // floor tile still gives the follow-camera oracle a scene anchor without
      // adding a test-only prop or changing the rendered world.
      manifest.sceneSprites.find(({ objectId }) => objectId === "tile:14:4");
    const expectedOwnerIds = [
      "player",
      ...state.monsters.map(({ id }) => id),
      ...state.projectiles.map(({ id }) => id),
      ...state.loot.map(({ id }) => id),
      ...state.effects.map(({ id }) => id),
    ].sort();
    const observedOwnerIds = manifest.drawCalls
      .map(({ entityId }) => entityId)
      .sort();
    const ownerPaintCounts = new Map<string, number>();
    for (const paint of manifest.paintQueue) {
      if (
        paint.kind !== "entity-body" ||
        !paint.call.visible ||
        typeof paint.ownerId !== "string"
      )
        continue;
      ownerPaintCounts.set(
        paint.ownerId,
        (ownerPaintCounts.get(paint.ownerId) ?? 0) + 1,
      );
    }
    samples.push({
      observedAtMs: performance.now(),
      tick: manifest.tick,
      presentationTick: manifest.presentationTick,
      camera: { ...manifest.camera },
      cameraTarget: { ...manifest.cameraTarget },
      cameraMode: manifest.cameraMode,
      playerFrameIdentity: player?.frameIdentity ?? null,
      playerFrameIndex: player?.frameIndex ?? null,
      playerClip: player?.clip ?? null,
      playerFacingBucket: player?.facingBucket ?? null,
      playerWorldAnchor: player ? { ...player.worldAnchor } : null,
      playerScreenAnchor: player ? { ...player.screenAnchor } : null,
      referenceScene: referenceScene
        ? {
            objectId: referenceScene.objectId,
            screenAnchor: { ...referenceScene.screenAnchor },
          }
        : null,
      visibleMonsterIds: manifest.drawCalls
        .filter(({ type, visible }) => type === "monster" && visible)
        .map(({ entityId }) => entityId)
        .sort(),
      deviceVisibleMonsterIds,
      deviceViewport,
      expectedOwnerIds,
      observedOwnerIds,
      ownerPaints: [...ownerPaintCounts]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([ownerId, bodyPaintCount]) => ({ ownerId, bodyPaintCount })),
      effectDetails: manifest.drawCalls
        .filter(({ type, visible }) => type === "effect" && visible)
        .map(({ entityId, geometryId, ownerId }) => {
          const expected = state.effects.find(({ id }) => id === entityId);
          return {
            effectId: entityId,
            kind: geometryId.startsWith("effect:")
              ? geometryId.slice("effect:".length)
              : "",
            ownerId: ownerId ?? null,
            startedAtTick: expected?.startedAtTick ?? -1,
            expectedDespawnStateTick: expected
              ? expected.expiresAtTick + 1
              : -1,
          };
        })
        .sort((first, second) => first.effectId.localeCompare(second.effectId)),
      expectedEffects: state.effects
        .map((effect) => ({
          effectId: effect.id,
          kind: effect.kind,
          ownerId: effect.ownerId ?? null,
          startedAtTick: effect.startedAtTick,
          expectedDespawnStateTick: effect.expiresAtTick + 1,
        }))
        .sort((first, second) => first.effectId.localeCompare(second.effectId)),
      visibleMonsters: manifest.drawCalls
        .filter(({ type, visible }) => type === "monster" && visible)
        .map(({ entityId, destinationRect }) => ({
          entityId,
          destinationRect: { ...destinationRect },
        }))
        .sort((first, second) => first.entityId.localeCompare(second.entityId)),
      monsterHealth: manifest.worldUi
        .filter(({ type }) => type === "monster-health")
        .map(({ ownerId, destinationRect, actorInkTop, frame, fill }) => ({
          ownerId,
          destinationRect: { ...destinationRect },
          actorInkTop,
          frame: structuredClone(frame),
          fill: structuredClone(fill),
        }))
        .sort((first, second) => first.ownerId.localeCompare(second.ownerId)),
    });
    if (samples.length > 1_800) samples.splice(0, samples.length - 1_800);
  };
  target.__GAME_OBSERVE__ = observer;
  return { observer, record };
}
