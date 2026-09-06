export const SLAM_ESCAPE_MARGIN = 128;

/** Stable clockwise order used for radial candidate evaluation and tie breaks. */
export const SLAM_ESCAPE_DIRECTIONS = [
  { id: "north", x: 0, y: -1 },
  { id: "northeast", x: 1, y: -1 },
  { id: "east", x: 1, y: 0 },
  { id: "southeast", x: 1, y: 1 },
  { id: "south", x: 0, y: 1 },
  { id: "southwest", x: -1, y: 1 },
  { id: "west", x: -1, y: 0 },
  { id: "northwest", x: -1, y: -1 },
];

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function normalizedDirection(direction) {
  const length = Math.hypot(direction.x, direction.y);
  return { x: direction.x / length, y: direction.y / length };
}

function isLiveRadialSlam(state, attack) {
  if (!attack || attack.kind !== "ability" || attack.impactTick < state.tick)
    return false;
  const owner = state.monsters.find(({ id }) => id === attack.ownerId);
  return Boolean(
    owner &&
    owner.health > 0 &&
    owner.elite === true &&
    owner.kind === "stonekin",
  );
}

export function liveSlamThreats(state) {
  return state.pendingAttacks
    .filter((attack) => isLiveRadialSlam(state, attack))
    .filter(
      (attack) =>
        distance(state.player.position, attack.origin) <= attack.range,
    )
    .sort(
      (first, second) =>
        first.impactTick - second.impactTick ||
        first.id.localeCompare(second.id),
    );
}

function candidateFor(attack, direction) {
  const unit = normalizedDirection(direction);
  const radius = attack.range + SLAM_ESCAPE_MARGIN;
  return {
    x: Math.round(attack.origin.x + unit.x * radius),
    y: Math.round(attack.origin.y + unit.y * radius),
  };
}

/**
 * Select a legal destination outside the stored slam boundary. This helper
 * never changes state or invents movement: every candidate is checked with
 * the caller's authoritative navigation and collision functions.
 */
export function chooseSlamEscape(state, navigation, scenery) {
  const player = state.player;
  const attacks = liveSlamThreats(state);
  const candidates = [];
  for (const attack of attacks) {
    for (const [
      directionIndex,
      direction,
    ] of SLAM_ESCAPE_DIRECTIONS.entries()) {
      const target = candidateFor(attack, direction);
      if (distance(target, attack.origin) <= attack.range) continue;
      if (
        !navigation.navigationPointWalkable(
          state.map,
          scenery,
          target,
          player.radius,
        )
      )
        continue;
      const route = navigation.findNavigationRoute(
        state.map,
        scenery,
        player.position,
        target,
        player.radius,
      );
      const routeEnd = route.at(-1) ?? player.position;
      if (distance(routeEnd, target) > 1) continue;
      candidates.push({
        attack,
        direction,
        directionIndex,
        target,
        route,
        routeLength: route.length,
        targetDistance: distance(player.position, target),
      });
    }
  }
  candidates.sort(
    (first, second) =>
      first.attack.impactTick - second.attack.impactTick ||
      first.routeLength - second.routeLength ||
      first.targetDistance - second.targetDistance ||
      first.directionIndex - second.directionIndex ||
      first.attack.id.localeCompare(second.attack.id),
  );
  const selected = candidates[0];
  if (!selected) return null;
  return {
    attackId: selected.attack.id,
    ownerId: selected.attack.ownerId,
    impactTick: selected.attack.impactTick,
    origin: { ...selected.attack.origin },
    range: selected.attack.range,
    target: { ...selected.target },
    direction: selected.direction.id,
    route: selected.route.map((waypoint) => ({ ...waypoint })),
    routeLength: selected.routeLength,
  };
}
