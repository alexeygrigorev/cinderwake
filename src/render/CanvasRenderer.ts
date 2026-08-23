import {
  TILE_PIXELS,
  UNITS_PER_TILE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "../game/constants";
import type { GameState, Vec2 } from "../game/types";
import {
  buildRenderManifest,
  screenFor,
  type CameraMode,
  type CameraV1,
  type DrawCallV1,
  type EntityMaskV1,
  type RenderManifestV1,
} from "./manifest";

const FLOOR_COLORS = ["#20272a", "#252d2f", "#1c2327"];

function line(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  width: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function animationProgress(call: DrawCallV1, frameCount: number): number {
  return frameCount <= 1 ? 0 : call.frameIndex / (frameCount - 1);
}

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  camera: CameraV1 = { x: 0, y: 0, zoom: 1 };
  previousCamera: CameraV1 = { x: 0, y: 0, zoom: 1 };
  displayCamera: CameraV1 = { x: 0, y: 0, zoom: 1 };
  private manifest?: RenderManifestV1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
  }

  cameraTarget(state: GameState): CameraV1 {
    const targetX = (state.player.position.x / UNITS_PER_TILE) * TILE_PIXELS;
    const targetY = (state.player.position.y / UNITS_PER_TILE) * TILE_PIXELS;
    const mapWidth = state.map.width * TILE_PIXELS;
    const mapHeight = state.map.height * TILE_PIXELS;
    const clampedX =
      mapWidth <= VIEW_WIDTH
        ? mapWidth / 2
        : Math.max(
            VIEW_WIDTH / 2,
            Math.min(mapWidth - VIEW_WIDTH / 2, targetX),
          );
    const clampedY =
      mapHeight <= VIEW_HEIGHT
        ? mapHeight / 2
        : Math.max(
            VIEW_HEIGHT / 2,
            Math.min(mapHeight - VIEW_HEIGHT / 2, targetY),
          );

    return { x: clampedX, y: clampedY, zoom: 1 };
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
    // Easing is applied once per simulation tick, not once per display frame.
    // It therefore behaves identically on 60, 120, and 144 Hz displays.
    this.camera.x += (target.x - this.camera.x) * 0.13;
    this.camera.y += (target.y - this.camera.y) * 0.13;
  }

  render(
    state: GameState,
    interpolationAlpha = 1,
    cameraMode: CameraMode = "smooth",
  ): RenderManifestV1 {
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
    const context = this.context;
    context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    context.fillStyle = "#111619";
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    this.drawMap(context, state, camera);

    const exit = screenFor(
      {
        x: (state.map.exit.x + 0.5) * UNITS_PER_TILE,
        y: (state.map.exit.y + 0.5) * UNITS_PER_TILE,
      },
      camera,
    );
    this.drawExit(context, exit, state.exitUnlocked, state.tick);

    const manifest = buildRenderManifest(state, camera, {
      interpolationAlpha: alpha,
      cameraTarget: this.cameraTarget(state),
      cameraMode,
    });
    this.manifest = manifest;
    for (const call of manifest.drawCalls) {
      if (call.visible) this.drawEntity(context, call, state);
    }
    for (const effect of state.effects) {
      this.drawEffect(
        context,
        screenFor(effect.position, camera),
        effect,
        manifest.presentationTick,
      );
    }
    this.drawVignette(context);
    return manifest;
  }

  captureEntityMask(state: GameState, entityId: string): EntityMaskV1 {
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
    const dx = anchor.x - call.screenAnchor.x;
    const dy = anchor.y - call.screenAnchor.y;
    const isolated: DrawCallV1 = {
      ...call,
      screenAnchor: { ...anchor },
      footAnchor: { ...anchor },
      bounds: {
        ...call.bounds,
        x: call.bounds.x + dx,
        y: call.bounds.y + dy,
      },
      visible: true,
    };
    this.drawEntity(context, isolated, state, false, false);
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
        const alpha = pixels[offset + 3]!;
        for (let channel = 0; channel < 4; channel += 1) {
          hash ^= pixels[offset + channel]!;
          hash = Math.imul(hash, 0x01000193);
        }
        if (alpha === 0) continue;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
          maskInternalClipping = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        alphaPixels += 1;
        alphaWeight += alpha;
        weightedX += x * alpha;
        weightedY += y * alpha;
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

  private drawMap(
    context: CanvasRenderingContext2D,
    state: GameState,
    camera: CameraV1,
  ): void {
    const { map } = state;
    const startX = Math.max(
      0,
      Math.floor((camera.x - VIEW_WIDTH / 2) / TILE_PIXELS) - 1,
    );
    const startY = Math.max(
      0,
      Math.floor((camera.y - VIEW_HEIGHT / 2) / TILE_PIXELS) - 1,
    );
    const endX = Math.min(
      map.width,
      startX + Math.ceil(VIEW_WIDTH / TILE_PIXELS) + 3,
    );
    const endY = Math.min(
      map.height,
      startY + Math.ceil(VIEW_HEIGHT / TILE_PIXELS) + 3,
    );
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        this.drawTile(
          context,
          x,
          y,
          map.tiles[y * map.width + x] === 1,
          camera,
        );
      }
    }
  }

  private drawTile(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    wall: boolean,
    camera: CameraV1,
  ): void {
    const screenX = Math.round(VIEW_WIDTH / 2 + x * TILE_PIXELS - camera.x);
    const screenY = Math.round(VIEW_HEIGHT / 2 + y * TILE_PIXELS - camera.y);
    if (!wall) {
      context.fillStyle = FLOOR_COLORS[(x * 7 + y * 11) % FLOOR_COLORS.length]!;
      context.fillRect(screenX, screenY, TILE_PIXELS, TILE_PIXELS);
      context.strokeStyle = "#30383b";
      context.globalAlpha = 0.45;
      context.strokeRect(
        screenX + 0.5,
        screenY + 0.5,
        TILE_PIXELS - 1,
        TILE_PIXELS - 1,
      );
      if ((x * 17 + y * 29) % 11 === 0) {
        line(
          context,
          { x: screenX + 10, y: screenY + 19 },
          { x: screenX + 22, y: screenY + 23 },
          1,
          "#465052",
        );
        line(
          context,
          { x: screenX + 22, y: screenY + 23 },
          { x: screenX + 27, y: screenY + 31 },
          1,
          "#465052",
        );
      }
      context.globalAlpha = 1;
      return;
    }

    context.fillStyle = "#30363b";
    context.fillRect(screenX, screenY, TILE_PIXELS, TILE_PIXELS);
    context.fillStyle = "#4a4d50";
    context.fillRect(screenX + 3, screenY + 3, TILE_PIXELS - 6, 11);
    context.fillStyle = "#252a2e";
    context.fillRect(screenX, screenY + 17, TILE_PIXELS, TILE_PIXELS - 17);
    context.fillStyle = "#34393d";
    context.fillRect(screenX + 4, screenY + 21, TILE_PIXELS - 8, 3);
    context.strokeStyle = "#555b5e";
    context.strokeRect(
      screenX + 0.5,
      screenY + 0.5,
      TILE_PIXELS - 1,
      TILE_PIXELS - 1,
    );
  }

  private drawExit(
    context: CanvasRenderingContext2D,
    point: Vec2,
    unlocked: boolean,
    tick: number,
  ): void {
    context.save();
    const pulse = 1 + Math.sin(tick / 8) * 0.08;
    context.translate(point.x, point.y + 8);
    context.scale(pulse, pulse);
    context.fillStyle = unlocked ? "#66d8c4" : "#8f4e5b";
    context.globalAlpha = 0.2;
    context.beginPath();
    context.arc(0, 0, 25, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = unlocked ? "#b5ffdf" : "#d2868b";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 0, 14, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#171d20";
    context.fillRect(-8, -11, 16, 22);
    context.fillStyle = unlocked ? "#79e6cf" : "#6e3843";
    context.fillRect(-3, -6, 6, 12);
    context.restore();
  }

  private drawEntity(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
    state: GameState,
    drawHealth = true,
    drawShadow = true,
  ): void {
    if (call.type === "projectile") {
      this.drawProjectile(context, call);
      return;
    }
    if (call.type === "loot") {
      this.drawLoot(context, call);
      return;
    }

    const actor =
      call.type === "player"
        ? state.player
        : state.monsters.find((monster) => monster.id === call.entityId);
    if (!actor) return;
    context.save();
    context.translate(call.screenAnchor.x, call.screenAnchor.y);
    context.scale(call.scale, call.scale);
    if (drawShadow) {
      context.fillStyle = "rgba(0, 0, 0, 0.42)";
      context.beginPath();
      context.ellipse(
        0,
        1,
        call.type === "player" ? 16 : 18,
        5,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    if (call.type === "player") this.drawHero(context, call, state);
    else this.drawMonster(context, call, state);
    context.restore();
    if (drawHealth && actor.health > 0)
      this.drawHealthBar(
        context,
        call,
        actor.health / actor.maxHealth,
        call.type === "player",
      );
  }

  private drawHero(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
    state: GameState,
  ): void {
    const frame = call.frameIndex;
    const clip = call.clip;
    const facingLeft = call.facing.x < 0;
    const verticalFacing = Math.abs(call.facing.y) > Math.abs(call.facing.x);
    const facingAway = verticalFacing && call.facing.y < 0;
    const walkCycle = Math.sin((frame / 8) * Math.PI * 2);
    const bodyBob =
      clip === "walk"
        ? -Math.abs(walkCycle) * 1.4
        : clip === "idle"
          ? -Math.sin((frame / 6) * Math.PI * 2) * 0.6
          : 0;
    const hurtOffset =
      clip === "hurt" ? -3 * (1 - animationProgress(call, 4)) : 0;
    const deathAngle =
      clip === "death" ? -animationProgress(call, 8) * Math.PI * 0.48 : 0;
    const attackProgress = clip === "attack" ? animationProgress(call, 6) : 0;
    const abilityProgress = clip === "ability" ? animationProgress(call, 8) : 0;
    const attackPose = clip === "attack" ? attackProgress : -1;
    const abilityPose = clip === "ability" ? abilityProgress : -1;

    context.save();
    context.scale(facingLeft ? -1 : 1, 1);
    if (verticalFacing) context.scale(0.94, 1);
    context.rotate(deathAngle);
    context.translate(hurtOffset, 0);

    const leftFoot = clip === "walk" ? Math.round(walkCycle * 5) : 0;
    const rightFoot = clip === "walk" ? -Math.round(walkCycle * 5) : 0;
    line(
      context,
      { x: -5, y: -14 + bodyBob },
      { x: -6 + leftFoot, y: -2 },
      6,
      "#252b2d",
    );
    line(
      context,
      { x: 5, y: -14 + bodyBob },
      { x: 6 + rightFoot, y: -2 },
      6,
      "#31383a",
    );
    line(
      context,
      { x: -8 + leftFoot, y: -1 },
      { x: -3 + leftFoot, y: -1 },
      4,
      "#111719",
    );
    line(
      context,
      { x: 4 + rightFoot, y: -1 },
      { x: 9 + rightFoot, y: -1 },
      4,
      "#111719",
    );

    context.save();
    context.translate(0, bodyBob);
    context.fillStyle = clip === "hurt" ? "#ffe0c9" : call.tint;
    context.beginPath();
    context.moveTo(-12, -34);
    context.lineTo(11, -34);
    context.lineTo(14, -13);
    context.lineTo(-11, -13);
    context.closePath();
    context.fill();
    context.fillStyle = "#20292c";
    context.fillRect(-12, -17, 26, 5);

    if (state.player.classId === "vanguard")
      this.drawVanguardEquipment(context, attackPose, abilityPose);
    else if (state.player.classId === "ranger")
      this.drawRangerEquipment(context, attackPose, abilityPose);
    else this.drawArcanistEquipment(context, attackPose, abilityPose);

    context.fillStyle = clip === "hurt" ? "#fff0de" : "#edc8a6";
    context.beginPath();
    context.arc(2, -41, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle =
      state.player.classId === "arcanist" ? "#17272e" : "#302a25";
    context.beginPath();
    context.arc(1, -43, 7, Math.PI, Math.PI * 2);
    context.fill();
    if (facingAway) {
      context.fillStyle =
        state.player.classId === "arcanist" ? "#17272e" : "#302a25";
      context.fillRect(-4, -43, 12, 6);
    } else {
      context.fillStyle = "#172024";
      if (verticalFacing) {
        context.fillRect(-2, -41, 2, 2);
        context.fillRect(5, -41, 2, 2);
      } else context.fillRect(5, -41, 2, 2);
    }
    context.restore();
    context.restore();
  }

  private drawVanguardEquipment(
    context: CanvasRenderingContext2D,
    attack: number,
    ability: number,
  ): void {
    context.fillStyle = "#6f513b";
    context.strokeStyle = "#d0a068";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(-12, -25, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(-12, -25, 3, 0, Math.PI * 2);
    context.stroke();

    const attackAngles = [0.35, -1, -0.1, 0.75, 0.5, 0.35];
    const abilityAngles = [0.35, -1.3, -0.85, -0.25, 0.5, 1.05, 0.6, 0.35];
    const swing =
      attack >= 0
        ? attackAngles[Math.round(attack * (attackAngles.length - 1))]!
        : ability >= 0
          ? abilityAngles[Math.round(ability * (abilityAngles.length - 1))]!
          : 0.35;
    const hand = { x: 9, y: -25 };
    const tip = {
      x: hand.x + Math.cos(swing) * 27,
      y: hand.y + Math.sin(swing) * 27,
    };
    line(context, { x: 6, y: -29 }, hand, 5, "#d3a17f");
    line(context, hand, tip, 4, "#d9d1ba");
    line(
      context,
      { x: hand.x - 4, y: hand.y + 2 },
      { x: hand.x + 4, y: hand.y - 2 },
      3,
      "#3b2921",
    );
  }

  private drawRangerEquipment(
    context: CanvasRenderingContext2D,
    attack: number,
    ability: number,
  ): void {
    const attackDraw = [0.8, 0, 0.15, 0, 0, 0];
    const abilityDraw = [0.85, 0.2, 0.8, 0.15, 0.75, 0.1, 0, 0];
    const draw =
      attack >= 0
        ? attackDraw[Math.round(attack * (attackDraw.length - 1))]!
        : ability >= 0
          ? abilityDraw[Math.round(ability * (abilityDraw.length - 1))]!
          : 0;
    line(context, { x: -8, y: -29 }, { x: 8 - draw * 5, y: -25 }, 5, "#d3a17f");
    context.strokeStyle = "#a87a49";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(12, -43);
    context.quadraticCurveTo(22, -26, 12, -9);
    context.stroke();
    context.strokeStyle = "#d8d1b6";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(12, -43);
    context.lineTo(12 - draw * 9, -26);
    context.lineTo(12, -9);
    context.stroke();
    line(context, { x: 1 - draw * 4, y: -26 }, { x: 24, y: -26 }, 2, "#d6cfb3");
    context.fillStyle = "#9fc96d";
    context.beginPath();
    context.moveTo(25, -26);
    context.lineTo(20, -30);
    context.lineTo(20, -22);
    context.closePath();
    context.fill();
  }

  private drawArcanistEquipment(
    context: CanvasRenderingContext2D,
    attack: number,
    ability: number,
  ): void {
    line(context, { x: 9, y: -31 }, { x: 15, y: -5 }, 3, "#6e513b");
    const activeProgress = Math.max(0, attack, ability);
    const glow = 1 + Math.sin(activeProgress * Math.PI) * 0.4;
    context.save();
    context.translate(9, -35);
    context.scale(glow, glow);
    context.fillStyle = "#8bf4ea";
    context.shadowColor = "#54d4c7";
    context.shadowBlur = 12;
    context.beginPath();
    context.moveTo(0, -8);
    context.lineTo(6, 0);
    context.lineTo(0, 7);
    context.lineTo(-6, 0);
    context.closePath();
    context.fill();
    context.restore();
    if (ability >= 0) {
      context.strokeStyle = "#8bf4ea";
      context.globalAlpha = 1 - ability;
      context.beginPath();
      context.arc(0, -24, 14 + ability * 8, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  private drawMonster(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
    state: GameState,
  ): void {
    const monster = state.monsters.find((entry) => entry.id === call.entityId);
    if (!monster) return;
    const facingLeft = monster.facing.x < 0;
    const hurtOffset =
      call.clip === "hurt" ? -4 * (1 - animationProgress(call, 4)) : 0;
    const deathCollapse =
      call.clip === "death" ? animationProgress(call, 8) : 0;
    context.save();
    context.scale(facingLeft ? -1 : 1, 1);
    context.translate(hurtOffset, 0);
    context.scale(1 + deathCollapse * 0.08, 1 - deathCollapse * 0.68);
    if (monster.elite) {
      context.strokeStyle = "#f0a24b";
      context.lineWidth = 2;
      context.globalAlpha = 0.7;
      context.beginPath();
      context.ellipse(0, 1, 24, 7, 0, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
    if (monster.kind === "ashfang") this.drawAshfang(context, call);
    else if (monster.kind === "hexer") this.drawHexer(context, call);
    else this.drawStonekin(context, call);
    context.restore();
  }

  private drawAshfang(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
  ): void {
    const gait =
      call.clip === "walk"
        ? Math.sin((call.frameIndex / 8) * Math.PI * 2) * 4
        : 0;
    const lungeFrames = [-3, 10, 7, 4, 1, 0];
    const lunge = call.clip === "attack" ? lungeFrames[call.frameIndex]! : 0;
    const biteFrames = [0, 8, 6, 4, 2, 0];
    const bite = call.clip === "attack" ? biteFrames[call.frameIndex]! : 0;
    context.save();
    context.translate(lunge, 0);
    for (const [x, offset] of [
      [-12, gait],
      [-3, -gait],
      [8, -gait],
      [15, gait],
    ] as const) {
      line(context, { x, y: -12 }, { x: x + offset, y: -1 }, 4, "#532d2b");
    }
    context.fillStyle = call.tint;
    context.beginPath();
    context.ellipse(-1, -17, 20, 12, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(12, -22);
    context.lineTo(25 + bite, -18);
    context.lineTo(14, -11);
    context.closePath();
    context.fill();
    context.fillStyle = "#f6d46f";
    context.fillRect(17 + bite, -20, 3, 2);
    context.strokeStyle = "#3b2022";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-17, -22);
    context.lineTo(-24, -31);
    context.stroke();
    if (call.clip === "attack" && call.frameIndex === 1) {
      line(context, { x: 22, y: -25 }, { x: 34, y: -29 }, 2, "#f4b16c");
      line(context, { x: 23, y: -17 }, { x: 36, y: -14 }, 2, "#f4b16c");
    }
    context.restore();
  }

  private drawHexer(context: CanvasRenderingContext2D, call: DrawCallV1): void {
    const float =
      call.clip === "attack"
        ? Math.sin(animationProgress(call, 6) * Math.PI) * 1.5
        : Math.sin((call.frameIndex / 6) * Math.PI * 2) * 1.5;
    context.save();
    context.translate(0, float);
    context.fillStyle = "#3b2947";
    context.beginPath();
    context.moveTo(0, -42);
    context.lineTo(20, -5);
    context.lineTo(0, -9);
    context.lineTo(-20, -5);
    context.closePath();
    context.fill();
    context.fillStyle = call.tint;
    context.beginPath();
    context.arc(0, -35, 11, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#160f1d";
    context.beginPath();
    context.arc(0, -35, 6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f2a4ff";
    context.fillRect(2, -37, 3, 3);
    if (call.clip === "attack") {
      const progress = animationProgress(call, 6);
      context.strokeStyle = "#e38df1";
      context.globalAlpha = 1 - progress;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(14, -28, 5 + call.frameIndex, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
    }
    context.restore();
  }

  private drawStonekin(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
  ): void {
    const gait =
      call.clip === "walk"
        ? Math.sin((call.frameIndex / 8) * Math.PI * 2) * 3
        : 0;
    const attackFrame = call.clip === "attack" ? call.frameIndex : 5;
    const bodyX = [-2, -3, 5, 3, 1, 0][attackFrame]!;
    const bodyY = [0, -5, 1, 1, 0, 0][attackFrame]!;
    const armReach = [-2, -5, 13, 9, 4, 0][attackFrame]!;
    const armLift = [3, 14, 0, 0, 0, 0][attackFrame]!;
    line(context, { x: -11, y: -19 }, { x: -12 + gait, y: -2 }, 10, "#55423a");
    line(context, { x: 10, y: -19 }, { x: 11 - gait, y: -2 }, 10, "#624a3e");
    context.save();
    context.translate(bodyX, bodyY);
    context.fillStyle = call.tint;
    context.beginPath();
    context.moveTo(-20, -46);
    context.lineTo(17, -43);
    context.lineTo(21, -17);
    context.lineTo(-18, -16);
    context.closePath();
    context.fill();
    line(
      context,
      { x: -18, y: -36 },
      { x: -27 + armReach, y: -14 - armLift },
      11,
      "#8f6652",
    );
    line(
      context,
      { x: 17, y: -35 },
      { x: 29 + armReach, y: -13 - armLift },
      11,
      "#a47459",
    );
    context.fillStyle = "#41342f";
    context.beginPath();
    context.moveTo(-9, -49);
    context.lineTo(10, -48);
    context.lineTo(13, -36);
    context.lineTo(-12, -36);
    context.closePath();
    context.fill();
    context.fillStyle = "#ffc16e";
    context.fillRect(4, -44, 4, 3);
    if (call.clip === "attack" && call.frameIndex === 2) {
      line(context, { x: 26, y: -6 }, { x: 43, y: -1 }, 3, "#f0b26e");
      line(context, { x: 30, y: -9 }, { x: 39, y: -15 }, 2, "#c98958");
    }
    context.restore();
  }

  private drawProjectile(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
  ): void {
    context.save();
    context.translate(call.screenAnchor.x, call.screenAnchor.y);
    context.rotate(Math.atan2(call.facing.y, call.facing.x));
    context.fillStyle = call.tint;
    context.shadowColor = call.tint;
    context.shadowBlur = 12;
    context.beginPath();
    context.moveTo(9, 0);
    context.lineTo(-6, -4);
    context.lineTo(-3, 0);
    context.lineTo(-6, 4);
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawLoot(context: CanvasRenderingContext2D, call: DrawCallV1): void {
    const bob = Math.sin(call.visualPhase * Math.PI * 2) * 3;
    context.save();
    context.translate(call.screenAnchor.x, call.screenAnchor.y - 8 + bob);
    context.scale(call.scale, call.scale);
    context.fillStyle = call.tint;
    context.shadowColor = call.tint;
    context.shadowBlur = call.geometryId.endsWith(":relic") ? 17 : 10;
    context.beginPath();
    if (call.geometryId.startsWith("loot:tonic:")) {
      context.roundRect(-6, -8, 12, 16, 3);
    } else if (call.geometryId.startsWith("loot:weapon:")) {
      context.moveTo(0, -11);
      context.lineTo(5, -1);
      context.lineTo(2, 10);
      context.lineTo(-3, 3);
      context.lineTo(-5, -3);
    } else {
      context.moveTo(0, -9);
      context.lineTo(8, 0);
      context.lineTo(0, 9);
      context.lineTo(-8, 0);
    }
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawHealthBar(
    context: CanvasRenderingContext2D,
    call: DrawCallV1,
    health: number,
    player: boolean,
  ): void {
    const width = player ? 34 : 30;
    const y = call.bounds.y + 2;
    context.fillStyle = "rgba(8, 10, 12, 0.84)";
    context.fillRect(call.screenAnchor.x - width / 2 - 1, y - 1, width + 2, 5);
    context.fillStyle = player ? "#77d491" : "#e06b61";
    context.fillRect(
      call.screenAnchor.x - width / 2,
      y,
      width * Math.max(0, health),
      3,
    );
  }

  private drawEffect(
    context: CanvasRenderingContext2D,
    point: Vec2,
    effect: GameState["effects"][number],
    tick: number,
  ): void {
    const progress =
      (tick - effect.startedAtTick) /
      (effect.expiresAtTick - effect.startedAtTick);
    context.save();
    context.strokeStyle = effect.color;
    context.globalAlpha = 1 - progress;
    context.lineWidth = 3;
    context.translate(point.x, point.y);
    context.beginPath();
    if (effect.kind === "slash")
      context.arc(0, 0, 14 + (effect.radius / 1024) * 18 * progress, -1.1, 1.1);
    else if (effect.kind === "impact") {
      const radius = 7 + (effect.radius / 1024) * 14 * progress;
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        context.moveTo(
          Math.cos(angle) * radius * 0.35,
          Math.sin(angle) * radius * 0.35,
        );
        context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
    } else
      context.arc(
        0,
        0,
        8 + (effect.radius / 1024) * 22 * progress,
        0,
        Math.PI * 2,
      );
    context.stroke();
    context.restore();
  }

  private drawVignette(context: CanvasRenderingContext2D): void {
    const gradient = context.createRadialGradient(
      VIEW_WIDTH / 2,
      VIEW_HEIGHT / 2,
      150,
      VIEW_WIDTH / 2,
      VIEW_HEIGHT / 2,
      560,
    );
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(4, 6, 8, 0.68)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  }
}
