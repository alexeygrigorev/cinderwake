import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../game/constants";
import type { GameState } from "../game/types";
import { openingRoomThreshold } from "../game/sceneryLayout";
import {
  buildRenderManifest,
  type CameraMode,
  type CameraV1,
  type DestinationRectV1,
  type DrawCallV1,
  type EntityMaskV1,
  type RenderManifestV1,
  type SceneSpriteV2,
  type SpriteReferenceV2,
  type WorldUiCallV1,
} from "./manifest";
import { SPRITE_CATALOG, spriteImage, type SourceRectV1 } from "./sprites";

interface ImageBackedReference {
  assetId: string;
  sourceRect: SourceRectV1;
}

export const DEFAULT_CAMERA_ZOOM = 0.9;
const CAMERA_DEAD_ZONE_PIXELS = 56;

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  camera: CameraV1 = { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM };
  previousCamera: CameraV1 = { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM };
  displayCamera: CameraV1 = { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM };
  private manifest?: RenderManifestV1;
  private readonly sourceInkBounds = new Map<
    string,
    { top: number; bottom: number }
  >();
  private readonly drawFullContract: boolean;
  private renderScale = 1;

  constructor(canvas: HTMLCanvasElement, drawFullContract = false) {
    this.canvas = canvas;
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.imageSmoothingEnabled = true;
    this.context = context;
    this.drawFullContract = drawFullContract;
  }

  private syncBackingStore(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssScale = Math.max(
      rect.width > 0 ? rect.width / VIEW_WIDTH : 1,
      rect.height > 0 ? rect.height / VIEW_HEIGHT : 1,
    );
    // Two physical samples per CSS pixel retain painterly detail on modern
    // phones without asking the 2D renderer to maintain an unbounded 4K+
    // backing surface. The logical canvas remains exactly 960x540.
    const targetCssDpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const targetScale = Math.min(3, Math.max(1, cssScale * targetCssDpr));
    // Keeping the backing width divisible by 16 preserves exact 16:9 storage
    // and one uniform transform on both axes.
    const backingWidth = Math.ceil((VIEW_WIDTH * targetScale) / 16) * 16;
    const backingHeight = (backingWidth * 9) / 16;
    if (
      this.canvas.width !== backingWidth ||
      this.canvas.height !== backingHeight
    ) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }
    this.renderScale = backingWidth / VIEW_WIDTH;
    this.context.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    this.context.imageSmoothingEnabled = true;
  }

  cameraTarget(state: GameState): CameraV1 {
    const zoom = DEFAULT_CAMERA_ZOOM;
    const targetX = (state.player.position.x / UNITS_PER_TILE) * TILE_PIXELS;
    const targetY = (state.player.position.y / UNITS_PER_TILE) * TILE_PIXELS;
    const threshold = openingRoomThreshold(state.map);
    const openingRoom = state.map.rooms[0];
    const playerTileX = state.player.position.x / UNITS_PER_TILE;
    const playerTileY = state.player.position.y / UNITS_PER_TILE;
    const distanceOutsideOpening = openingRoom
      ? Math.hypot(
          Math.max(
            openingRoom.x - playerTileX,
            playerTileX - (openingRoom.x + openingRoom.width),
            0,
          ),
          Math.max(
            openingRoom.y - playerTileY,
            playerTileY - (openingRoom.y + openingRoom.height),
            0,
          ),
        )
      : 4;
    const openingBiasStrength = Math.max(0, 1 - distanceOutsideOpening / 4);
    const openingHorizontalBias =
      (threshold?.side === "east" ? 4 : threshold?.side === "west" ? -4 : 0) *
      openingBiasStrength;
    // Cover-fit landscape viewports trim the top and bottom of the 16:9
    // render. Frame the opening slightly north so its full forge roof remains
    // in the shared safe area, then fade the bias after leaving room zero.
    const openingVerticalBias = -20 * openingBiasStrength;
    const mapWidth = state.map.width * TILE_PIXELS;
    const mapHeight = state.map.height * TILE_PIXELS;
    const visibleHalfWidth = VIEW_WIDTH / (2 * zoom);
    const visibleHalfHeight = VIEW_HEIGHT / (2 * zoom);
    const clampedX =
      mapWidth <= VIEW_WIDTH / zoom
        ? mapWidth / 2
        : Math.max(
            visibleHalfWidth,
            Math.min(
              mapWidth - visibleHalfWidth,
              targetX + openingHorizontalBias,
            ),
          );
    const clampedY =
      mapHeight <= VIEW_HEIGHT / zoom
        ? mapHeight / 2
        : Math.max(
            visibleHalfHeight,
            Math.min(
              mapHeight - visibleHalfHeight,
              targetY + openingVerticalBias,
            ),
          );
    return { x: clampedX, y: clampedY, zoom };
  }

  resetCamera(state: GameState, camera?: CameraV1): void {
    this.camera = camera ? { ...camera } : this.cameraTarget(state);
    this.previousCamera = { ...this.camera };
    this.displayCamera = { ...this.camera };
  }

  setCamera(camera: CameraV1): void {
    this.camera = { ...camera };
    this.previousCamera = { ...camera };
    this.displayCamera = { ...camera };
  }

  advanceCamera(state: GameState, mode: CameraMode): void {
    this.previousCamera = { ...this.camera };
    if (mode === "fixed" || !state.settings.cameraFollow) return;
    const target = this.cameraTarget(state);
    if (mode === "snap") {
      this.camera = target;
      return;
    }
    const deadZone = CAMERA_DEAD_ZONE_PIXELS / target.zoom;
    const desiredAxis = (current: number, next: number): number => {
      const delta = next - current;
      if (Math.abs(delta) <= deadZone) return current;
      return next - Math.sign(delta) * deadZone;
    };
    const desiredX = desiredAxis(this.camera.x, target.x);
    const desiredY = desiredAxis(this.camera.y, target.y);
    this.camera.x += (desiredX - this.camera.x) * 0.2;
    this.camera.y += (desiredY - this.camera.y) * 0.2;
    this.camera.zoom += (target.zoom - this.camera.zoom) * 0.2;
  }

  render(
    state: GameState,
    interpolationAlpha = 1,
    cameraMode: CameraMode = "smooth",
  ): RenderManifestV1 {
    this.syncBackingStore();
    const alpha = Math.max(0, Math.min(1, interpolationAlpha));
    const camera = {
      x:
        this.previousCamera.x + (this.camera.x - this.previousCamera.x) * alpha,
      y:
        this.previousCamera.y + (this.camera.y - this.previousCamera.y) * alpha,
      zoom:
        this.previousCamera.zoom +
        (this.camera.zoom - this.previousCamera.zoom) * alpha,
    };
    this.displayCamera = camera;
    const manifest = buildRenderManifest(state, camera, {
      interpolationAlpha: alpha,
      cameraTarget: this.cameraTarget(state),
      cameraMode,
      dpr: this.renderScale,
    });
    manifest.worldUi = this.buildWorldUi(manifest, state);
    this.manifest = manifest;
    const context = this.context;
    context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    // Terrain is a base pass. Every raised world sprite then shares one
    // bottom-anchor depth queue, so actors can pass behind roofs/props and in
    // front of objects south of them. Test mode still draws offscreen records
    // so the browser gate can prove manifest completeness.
    for (const scene of manifest.sceneSprites.filter(
      ({ layer }) => layer === "terrain",
    )) {
      if (this.drawFullContract || scene.visible)
        this.drawSceneSprite(context, scene);
    }
    const raised = [
      ...manifest.sceneSprites
        .filter(({ layer }) => layer !== "terrain")
        .map((sprite) => ({
          kind: "scene" as const,
          depth: sprite.screenAnchor.y,
          priority: 0,
          stableId: sprite.objectId,
          sprite,
        })),
      ...manifest.drawCalls.map((call) => ({
        kind: "entity" as const,
        depth: call.screenAnchor.y,
        priority:
          call.layer === "effects"
            ? -2
            : call.layer === "items"
              ? -1
              : call.layer === "actors"
                ? 1
                : 2,
        stableId: call.entityId,
        call,
      })),
    ].sort(
      (first, second) =>
        first.depth - second.depth ||
        first.priority - second.priority ||
        first.stableId.localeCompare(second.stableId),
    );
    for (const item of raised) {
      if (item.kind === "scene") {
        if (this.drawFullContract || item.sprite.visible)
          this.drawSceneSprite(context, item.sprite);
      } else if (this.drawFullContract || item.call.visible) {
        this.drawEntitySprite(
          context,
          item.call,
          state,
          manifest.worldUi.find(
            ({ ownerId }) => ownerId === item.call.entityId,
          ),
        );
      }
    }
    return manifest;
  }

  captureEntityMask(_state: GameState, entityId: string): EntityMaskV1 {
    const call = this.manifest?.drawCalls.find(
      (entry) => entry.entityId === entityId,
    );
    if (!call) throw new Error(`Render entity ${entityId} is unavailable`);
    const width = 220;
    const height = 180;
    const anchor = { x: width / 2, y: height - 28 };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Entity-mask Canvas 2D is unavailable");
    const normalizedDestination = {
      x: Math.round(anchor.x - call.destinationRect.width / 2),
      y: Math.round(anchor.y - (232 / 256) * call.destinationRect.height),
      width: call.destinationRect.width,
      height: call.destinationRect.height,
    };
    const isolated: DrawCallV1 = {
      ...call,
      screenAnchor: { ...anchor },
      footAnchor: { ...anchor },
      destinationRect: normalizedDestination,
      bounds: { ...normalizedDestination },
      visible: true,
    };
    this.drawImageReference(
      context,
      isolated,
      isolated.destinationRect,
      isolated.flipX,
      isolated.opacity,
      this.rotationFor(isolated),
    );
    const pixels = context.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let alphaPixels = 0;
    let weightedX = 0;
    let weightedY = 0;
    let alphaWeight = 0;
    let maskInternalClipping = false;
    let hash = 0x811c9dc5;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const pixelAlpha = pixels[offset + 3]!;
        for (let channel = 0; channel < 4; channel += 1) {
          hash ^= pixels[offset + channel]!;
          hash = Math.imul(hash, 0x01000193);
        }
        if (pixelAlpha === 0) continue;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
          maskInternalClipping = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        alphaPixels += 1;
        alphaWeight += pixelAlpha;
        weightedX += x * pixelAlpha;
        weightedY += y * pixelAlpha;
      }
    }
    if (alphaPixels === 0)
      throw new Error(`Render entity ${entityId} is blank`);
    return {
      entityId,
      mode: "isolated-draw-call",
      renderVisible: call.visible,
      width,
      height,
      anchor,
      inkBounds: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
      centroid: {
        x: Math.round((weightedX / alphaWeight) * 1000) / 1000,
        y: Math.round((weightedY / alphaWeight) * 1000) / 1000,
      },
      alphaPixels,
      bottomOffset: maxY - anchor.y,
      maskInternalClipping,
      pixelHash: (hash >>> 0).toString(16).padStart(8, "0"),
      image: canvas.toDataURL("image/png"),
    };
  }

  /**
   * Return a deterministic logical-resolution frame for exact visual tests.
   * The live canvas backing store is deliberately responsive and may be larger
   * than 960x540 for crisp high-DPI presentation; snapshot dimensions must not
   * silently inherit that device-dependent storage choice.
   */
  captureLogicalFrame(): string {
    const logical = document.createElement("canvas");
    logical.width = VIEW_WIDTH;
    logical.height = VIEW_HEIGHT;
    const context = logical.getContext("2d");
    if (!context) throw new Error("Logical capture Canvas 2D is unavailable");
    context.imageSmoothingEnabled = true;
    context.drawImage(
      this.canvas,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      0,
      VIEW_WIDTH,
      VIEW_HEIGHT,
    );
    return logical.toDataURL("image/png");
  }

  private drawSceneSprite(
    context: CanvasRenderingContext2D,
    scene: SceneSpriteV2,
  ): void {
    this.drawImageReference(
      context,
      scene,
      scene.destinationRect,
      false,
      scene.opacity,
      scene.rotation ?? 0,
    );
  }

  private drawEntitySprite(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
    state: GameState,
    worldUi: WorldUiCallV1 | undefined,
  ): void {
    if (
      call.type === "player" ||
      call.type === "monster" ||
      call.type === "npc"
    ) {
      this.drawWorldSprite(
        context,
        "world-ui:shadow",
        "static",
        {
          x: call.screenAnchor.x - call.destinationRect.width * 0.26,
          y: call.screenAnchor.y - 7,
          width: call.destinationRect.width * 0.52,
          height: 14,
        },
        0.3,
      );
    }
    this.drawImageReference(
      context,
      call,
      call.destinationRect,
      call.flipX,
      call.opacity,
      this.rotationFor(call),
    );
    if (
      call.type !== "player" &&
      call.type !== "monster" &&
      call.type !== "npc"
    )
      return;
    const actor = state.monsters.find(
      (monster) => monster.id === call.entityId,
    );
    if (call.type === "monster" && actor && actor.health > 0 && worldUi)
      this.drawHealthBar(context, worldUi);
  }

  private alphaBounds(reference: ImageBackedReference): {
    top: number;
    bottom: number;
  } {
    const { sourceRect } = reference;
    const key = `${reference.assetId}:${sourceRect.x}:${sourceRect.y}:${sourceRect.width}:${sourceRect.height}`;
    const cached = this.sourceInkBounds.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = sourceRect.width;
    canvas.height = sourceRect.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Sprite alpha inspection is unavailable");
    context.drawImage(
      spriteImage(reference.assetId),
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      0,
      0,
      sourceRect.width,
      sourceRect.height,
    );
    const pixels = context.getImageData(
      0,
      0,
      sourceRect.width,
      sourceRect.height,
    ).data;
    let top = sourceRect.height;
    let bottom = -1;
    for (let y = 0; y < sourceRect.height; y += 1) {
      for (let x = 0; x < sourceRect.width; x += 1) {
        if (pixels[(y * sourceRect.width + x) * 4 + 3]! <= 8) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    const bounds =
      bottom >= 0 ? { top, bottom } : { top: 0, bottom: sourceRect.height - 1 };
    this.sourceInkBounds.set(key, bounds);
    return bounds;
  }

  private buildWorldUi(
    manifest: RenderManifestV1,
    state: GameState,
  ): WorldUiCallV1[] {
    return state.monsters.flatMap((monster) => {
      if (monster.health <= 0) return [];
      const call = manifest.drawCalls.find(
        ({ entityId }) => entityId === monster.id,
      );
      if (!call) return [];
      const ink = this.alphaBounds(call);
      const actorInkTop =
        call.destinationRect.y +
        (ink.top / call.sourceRect.height) * call.destinationRect.height;
      const width = Math.round(
        Math.max(
          52,
          Math.min(
            76 * manifest.camera.zoom,
            call.destinationRect.width * 0.54,
          ),
        ),
      );
      const height = Math.round((width * 82) / 197);
      const destinationRect = {
        x: Math.round(call.screenAnchor.x - width / 2),
        y: Math.round(actorInkTop - height - 3),
        width,
        height,
      };
      const frame = this.worldUiSpriteReference("world-ui:health-frame");
      const fillBase = this.worldUiSpriteReference("world-ui:health-fill");
      const healthRatio = Math.max(
        0,
        Math.min(1, monster.health / monster.maxHealth),
      );
      const horizontalInset = Math.round(width * 0.09);
      const fillHeight = Math.max(1, Math.round(height * (48 / 82)));
      const fillWidth = Math.max(
        1,
        Math.round((width - horizontalInset * 2) * healthRatio),
      );
      return [
        {
          id: `health:${monster.id}`,
          type: "monster-health" as const,
          ownerId: monster.id,
          destinationRect,
          actorInkTop,
          healthRatio,
          frame: { ...frame, destinationRect: { ...destinationRect } },
          fill: {
            ...fillBase,
            sourceRect: {
              ...fillBase.sourceRect,
              width: Math.max(
                1,
                Math.round(fillBase.sourceRect.width * healthRatio),
              ),
            },
            destinationRect: {
              x: destinationRect.x + horizontalInset,
              y: destinationRect.y + Math.round((height - fillHeight) / 2),
              width: fillWidth,
              height: fillHeight,
            },
          },
          visible:
            call.visible &&
            destinationRect.x + destinationRect.width >= 0 &&
            destinationRect.y + destinationRect.height >= 0 &&
            destinationRect.x <= manifest.viewport.width &&
            destinationRect.y <= manifest.viewport.height,
        },
      ];
    });
  }

  private worldUiSpriteReference(spriteId: string): SpriteReferenceV2 {
    const sprite = SPRITE_CATALOG.sprites[spriteId]!;
    const frameIdentity = sprite.clips.static!.frameIdentities[0]!;
    return {
      renderMode: "sprite",
      spriteId,
      assetId: sprite.assetId,
      sourceRect: { ...sprite.frames[frameIdentity]! },
      frameIdentity,
    };
  }

  private rotationFor(call: DrawCallV1): number {
    if (call.type !== "projectile") return 0;
    return Math.atan2(call.facing.y, call.facing.x);
  }

  private drawWorldSprite(
    context: CanvasRenderingContext2D,
    spriteId: string,
    clip: string,
    destination: DestinationRectV1,
    opacity = 1,
  ): void {
    const sprite = SPRITE_CATALOG.sprites[spriteId]!;
    const frameIdentity = sprite.clips[clip]!.frameIdentities[0]!;
    this.drawImageReference(
      context,
      { assetId: sprite.assetId, sourceRect: sprite.frames[frameIdentity]! },
      destination,
      false,
      opacity,
      0,
    );
  }

  private drawHealthBar(
    context: CanvasRenderingContext2D,
    worldUi: WorldUiCallV1,
  ): void {
    this.drawImageReference(
      context,
      {
        assetId: worldUi.frame.assetId,
        sourceRect: worldUi.frame.sourceRect,
      },
      worldUi.frame.destinationRect,
      false,
      1,
      0,
    );
    this.drawImageReference(
      context,
      {
        assetId: worldUi.fill.assetId,
        sourceRect: worldUi.fill.sourceRect,
      },
      worldUi.fill.destinationRect,
      false,
      0.95,
      0,
    );
  }

  private drawImageReference(
    context: CanvasRenderingContext2D,
    reference: ImageBackedReference,
    destination: DestinationRectV1,
    flipX: boolean,
    opacity: number,
    rotation: number,
  ): void {
    const source = reference.sourceRect;
    const image = spriteImage(reference.assetId);
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, opacity));
    const centerX = destination.x + destination.width / 2;
    const centerY = destination.y + destination.height / 2;
    context.translate(centerX, centerY);
    if (rotation !== 0) context.rotate(rotation);
    if (flipX) context.scale(-1, 1);
    context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      -destination.width / 2,
      -destination.height / 2,
      destination.width,
      destination.height,
    );
    context.restore();
  }
}
