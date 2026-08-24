import type { GameState } from "../game/types";
import type { RenderManifestV1 } from "../render/manifest";
import { canonicalState } from "./canonical";

export interface LivePresentationSampleV1 {
  observedAtMs: number;
  tick: number;
  presentationTick: number;
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
  visibleMonsterIds: string[];
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
    presentationSamples: () => samples.map((sample) => structuredClone(sample)),
    clearPresentationSamples: () => samples.splice(0),
  };
  const record = (manifest: RenderManifestV1): void => {
    const player = manifest.drawCalls.find(
      ({ entityId }) => entityId === "player",
    );
    const referenceScene = manifest.sceneSprites.find(
      ({ objectId, visible }) => objectId === "structure:0:forge" && visible,
    );
    samples.push({
      observedAtMs: performance.now(),
      tick: manifest.tick,
      presentationTick: manifest.presentationTick,
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
