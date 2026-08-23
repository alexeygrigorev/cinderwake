import { UNITS_PER_TILE } from "./constants";
import type { DungeonMap, Vec2 } from "./types";

export type SceneryPlacementKind = "structure" | "prop" | "decal";

export interface SceneryCollisionFootprint {
  shape: "ellipse";
  center: Vec2;
  halfWidth: number;
  halfHeight: number;
}

export interface SceneryPlacement {
  id: string;
  kind: SceneryPlacementKind;
  name: string;
  collisionMode: "solid" | "passable";
  tile: Vec2;
  worldAnchor: Vec2;
  collision: SceneryCollisionFootprint | null;
}

const STRUCTURE_NAMES = [
  "chapel",
  "watchtower",
  "forge",
  "ruined-house",
  "mausoleum",
  "dead-tree",
  "well",
  "wagon",
  "obelisk",
  "rubble",
] as const;

const PROP_NAMES = [
  "ember-brazier",
  "witchlight-lantern",
  "sarcophagus",
  "grave-markers",
  "merchant-crates",
  "weapon-rack",
  "barrels",
  "saint-statue",
  "thorn-pillar",
  "chain-cage",
  "ritual-totem",
  "barricade",
] as const;

export const GROUND_DECAL_NAMES = [
  "scorch-ring",
  "blood-smear",
  "bone-pile",
  "occult-circle",
  "chain-coil",
  "broken-boards",
  "grave-rubble",
  "burnt-roots",
  "melted-candles",
  "dead-bramble",
  "discarded-armor",
  "cracked-embers",
  "banner-scrap",
  "saint-fragments",
  "claw-tracks",
  "grave-flowers",
] as const;

type StructureName = (typeof STRUCTURE_NAMES)[number];
type PropName = (typeof PROP_NAMES)[number];
type GroundDecalName = (typeof GROUND_DECAL_NAMES)[number];

interface CollisionProfile {
  halfWidth: number;
  halfHeight: number;
  offsetY: number;
}

// Footprints cover the object base, not its tall painted silhouette. This lets
// actors walk behind roofs and branches while still preventing them from
// crossing the masonry, trunk, wagon, or other solid contact surface.
const STRUCTURE_COLLISIONS: Record<StructureName, CollisionProfile | null> = {
  chapel: { halfWidth: 1_520, halfHeight: 620, offsetY: -120 },
  watchtower: { halfWidth: 1_430, halfHeight: 620, offsetY: -120 },
  forge: { halfWidth: 1_390, halfHeight: 580, offsetY: -100 },
  "ruined-house": { halfWidth: 1_480, halfHeight: 620, offsetY: -100 },
  mausoleum: { halfWidth: 1_410, halfHeight: 600, offsetY: -100 },
  "dead-tree": { halfWidth: 720, halfHeight: 430, offsetY: -80 },
  well: { halfWidth: 820, halfHeight: 440, offsetY: -60 },
  wagon: { halfWidth: 1_180, halfHeight: 500, offsetY: -70 },
  obelisk: { halfWidth: 620, halfHeight: 430, offsetY: -70 },
  // Rubble is authored as low ground clutter. It remains deliberately
  // passable so incidental decoration cannot trap an actor in a narrow route.
  rubble: null,
};

const PROP_COLLISIONS: Record<PropName, CollisionProfile> = {
  "ember-brazier": { halfWidth: 650, halfHeight: 400, offsetY: -50 },
  "witchlight-lantern": { halfWidth: 310, halfHeight: 300, offsetY: -40 },
  sarcophagus: { halfWidth: 760, halfHeight: 420, offsetY: -40 },
  "grave-markers": { halfWidth: 650, halfHeight: 370, offsetY: -40 },
  "merchant-crates": { halfWidth: 760, halfHeight: 420, offsetY: -40 },
  "weapon-rack": { halfWidth: 700, halfHeight: 360, offsetY: -40 },
  barrels: { halfWidth: 700, halfHeight: 410, offsetY: -40 },
  "saint-statue": { halfWidth: 520, halfHeight: 350, offsetY: -40 },
  "thorn-pillar": { halfWidth: 460, halfHeight: 340, offsetY: -40 },
  "chain-cage": { halfWidth: 380, halfHeight: 330, offsetY: -40 },
  "ritual-totem": { halfWidth: 560, halfHeight: 350, offsetY: -40 },
  barricade: { halfWidth: 820, halfHeight: 380, offsetY: -40 },
};

function sceneVariant(map: DungeonMap, x: number, y: number, count: number) {
  const digest = Number.parseInt(map.digest.slice(0, 8), 16) || 0;
  return Math.abs((digest ^ (x * 73_856_093) ^ (y * 19_349_663)) | 0) % count;
}

function footprint(
  worldAnchor: Vec2,
  profile: CollisionProfile | null,
): SceneryCollisionFootprint | null {
  if (!profile) return null;
  return {
    shape: "ellipse",
    center: { x: worldAnchor.x, y: worldAnchor.y + profile.offsetY },
    halfWidth: profile.halfWidth,
    halfHeight: profile.halfHeight,
  };
}

/**
 * Produces the deterministic semantic scenery layout from authoritative map
 * state. Renderers and simulations can consume this data without either layer
 * depending on the other, and restored arbitrary states reproduce the same
 * placements without serializing derived collision objects.
 */
export function buildSceneryLayout(map: DungeonMap): SceneryPlacement[] {
  const placements: SceneryPlacement[] = [];
  const decorativeRooms = map.rooms.length
    ? map.rooms
    : [
        {
          x: Math.max(1, map.spawn.x - 3),
          y: Math.max(1, map.spawn.y - 3),
          width: 7,
          height: 6,
        },
      ];

  decorativeRooms.forEach((room, roomIndex) => {
    if (roomIndex % 2 === 0 || roomIndex === decorativeRooms.length - 1) {
      const x = room.x + Math.floor(room.width / 2);
      const y = room.y + 1;
      const name: StructureName =
        roomIndex === 0
          ? "forge"
          : map.rooms.length
            ? STRUCTURE_NAMES[sceneVariant(map, x, y, STRUCTURE_NAMES.length)]!
            : "chapel";
      const worldAnchor = {
        x: x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
        y: y * UNITS_PER_TILE - UNITS_PER_TILE / 4,
      };
      placements.push({
        id: `structure:${roomIndex}:${name}`,
        kind: "structure",
        name,
        collisionMode: STRUCTURE_COLLISIONS[name] ? "solid" : "passable",
        tile: { x, y },
        worldAnchor,
        collision: footprint(worldAnchor, STRUCTURE_COLLISIONS[name]),
      });
    }

    for (let propIndex = 0; propIndex < 2; propIndex += 1) {
      const x = room.x + 1 + propIndex * Math.max(1, room.width - 3);
      const y = room.y + Math.max(1, room.height - 2);
      const name = PROP_NAMES[sceneVariant(map, x, y, PROP_NAMES.length)]!;
      const worldAnchor = {
        x: x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
        y: y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
      };
      placements.push({
        id: `prop:${roomIndex}:${propIndex}:${name}`,
        kind: "prop",
        name,
        collisionMode: "solid",
        tile: { x, y },
        worldAnchor,
        collision: footprint(worldAnchor, PROP_COLLISIONS[name]),
      });
    }

    // Explicit test arenas deliberately keep their authored floor unchanged so
    // temporal baselines continue to isolate actor motion. Generated runs get
    // the richer room dressing below.
    if (map.rooms.length === 0) return;

    const decalSlots = [
      { x: Math.floor(room.width / 2), y: 1 },
      { x: 2, y: Math.max(2, room.height - 3) },
      { x: Math.max(2, room.width - 3), y: Math.max(2, room.height - 3) },
      { x: 1, y: Math.floor(room.height / 2) },
      { x: Math.max(1, room.width - 2), y: Math.floor(room.height / 2) },
      { x: Math.floor(room.width / 2), y: Math.max(1, room.height - 2) },
    ] as const;
    const decalCount = roomIndex === 0 ? decalSlots.length : 3;
    for (let decalIndex = 0; decalIndex < decalCount; decalIndex += 1) {
      const slot = decalSlots[decalIndex]!;
      const x = room.x + slot.x;
      const y = room.y + slot.y;
      const name: GroundDecalName =
        roomIndex === 0
          ? GROUND_DECAL_NAMES[decalIndex]!
          : GROUND_DECAL_NAMES[
              sceneVariant(
                map,
                x + decalIndex * 11,
                y + roomIndex * 7,
                GROUND_DECAL_NAMES.length,
              )
            ]!;
      const driftX = sceneVariant(map, x + decalIndex, y, 7) - 3;
      const driftY = sceneVariant(map, x, y + decalIndex, 5) - 2;
      const worldAnchor = {
        x: x * UNITS_PER_TILE + UNITS_PER_TILE / 2 + driftX * 72,
        y: y * UNITS_PER_TILE + UNITS_PER_TILE / 2 + driftY * 58,
      };
      // The first mark sits under the forge and acts as its irregular ember
      // pool. It shares the visible structure anchor exactly so future layout
      // changes cannot detach the grounding mark from the building.
      if (roomIndex === 0 && decalIndex === 0) {
        worldAnchor.x = x * UNITS_PER_TILE + UNITS_PER_TILE / 2;
        worldAnchor.y = y * UNITS_PER_TILE - UNITS_PER_TILE / 4;
      }
      placements.push({
        id: `decal:${roomIndex}:${decalIndex}:${name}`,
        kind: "decal",
        name,
        collisionMode: "passable",
        tile: { x, y },
        worldAnchor,
        collision: null,
      });
    }
  });

  return placements;
}

export function overlapsScenery(
  point: Vec2,
  actorRadius: number,
  collision: SceneryCollisionFootprint,
): boolean {
  const radiusX = collision.halfWidth + actorRadius;
  const radiusY = collision.halfHeight + actorRadius;
  const normalizedX = (point.x - collision.center.x) / radiusX;
  const normalizedY = (point.y - collision.center.y) / radiusY;
  return normalizedX * normalizedX + normalizedY * normalizedY < 1;
}

export function sceneryCollisions(
  map: DungeonMap,
): SceneryCollisionFootprint[] {
  return buildSceneryLayout(map).flatMap(({ collision }) =>
    collision ? [collision] : [],
  );
}
