import { ARCHETYPES, MONSTERS } from "./content";
import {
  CLIP_DURATIONS,
  DIAGONAL_SCALE,
  DIRECTION_SCALE,
  UNITS_PER_TILE,
} from "./constants";
import { isFloor, tileCenter } from "./dungeon";
import { navigationDirection } from "./navigation";
import { createRng, randomFloat } from "./rng";
import {
  overlapsScenery,
  sceneryCollisions,
  type SceneryCollisionFootprint,
} from "./sceneryLayout";
import type {
  AnimationClip,
  GameEvent,
  GameState,
  InputState,
  LootState,
  MonsterState,
  PendingAttack,
  ProjectileState,
  Vec2,
} from "./types";

function emit(state: GameState, event: Omit<GameEvent, "tick">): void {
  const complete = { tick: state.tick, ...event };
  state.events.push(complete);
  state.eventLog.push(complete);
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function normalized(from: Vec2, to: Vec2, scale = DIRECTION_SCALE): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { x: scale, y: 0 };
  return {
    x: Math.round((dx / length) * scale),
    y: Math.round((dy / length) * scale),
  };
}

function pointWalkable(
  state: GameState,
  point: Vec2,
  radius: number,
  scenery: SceneryCollisionFootprint[],
): boolean {
  const offsets = [
    [-radius, -radius],
    [radius, -radius],
    [-radius, radius],
    [radius, radius],
  ] as const;
  return (
    offsets.every(([dx, dy]) =>
      isFloor(
        state.map,
        Math.floor((point.x + dx) / UNITS_PER_TILE),
        Math.floor((point.y + dy) / UNITS_PER_TILE),
      ),
    ) &&
    scenery.every((collision) => !overlapsScenery(point, radius, collision))
  );
}

function moveActor(
  state: GameState,
  position: Vec2,
  velocity: Vec2,
  radius: number,
  scenery: SceneryCollisionFootprint[],
): Vec2 {
  const next = { ...position };
  const candidateX = { x: position.x + velocity.x, y: position.y };
  if (pointWalkable(state, candidateX, radius, scenery)) next.x = candidateX.x;
  const candidateY = { x: next.x, y: position.y + velocity.y };
  if (pointWalkable(state, candidateY, radius, scenery)) next.y = candidateY.y;
  return next;
}

/**
 * Extra world-space breathing room claimed by each living monster. Collision
 * radii describe feet/contact only; this semantic padding keeps the much
 * broader painted bodies readable without coupling simulation to sprite or
 * manifest dimensions. 740 units is a little under one floor tile per side.
 */
export const MONSTER_PERSONAL_SPACE_PADDING = 740;
// Combatants compress their formation near attack range so a crowd can still
// surround and reach its target, while retaining substantially more space than
// bare collision discs. This remains gameplay semantics, not sprite geometry.
const ENGAGED_MONSTER_PERSONAL_SPACE_PADDING = 400;
const MONSTER_SEPARATION_GAP = 8;
const MONSTER_SEPARATION_PASSES = 24;

function stablePairDirection(firstId: string, secondId: string): Vec2 {
  let hash = 2_166_136_261;
  for (const character of `${firstId}\0${secondId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  const directions = [
    { x: 1024, y: 0 },
    { x: 724, y: 724 },
    { x: 0, y: 1024 },
    { x: -724, y: 724 },
    { x: -1024, y: 0 },
    { x: -724, y: -724 },
    { x: 0, y: -1024 },
    { x: 724, y: -724 },
  ] as const;
  return directions[(hash >>> 0) % directions.length]!;
}

function separationCandidate(
  position: Vec2,
  direction: Vec2,
  distance: number,
): Vec2 {
  return {
    x: Math.round(position.x + direction.x * distance),
    y: Math.round(position.y + direction.y * distance),
  };
}

/**
 * Resolves crowd penetration after navigation has produced each monster's
 * intended movement. Pair order and the fallback axis are derived only from
 * stable entity IDs, so identical state/input histories remain reproducible.
 * Candidate positions still pass through the same wall/scenery predicate as
 * ordinary actor movement.
 */
function separateLivingMonsters(
  state: GameState,
  scenery: SceneryCollisionFootprint[],
): void {
  const living = state.monsters
    .filter((monster) => monster.health > 0)
    .sort((first, second) => first.id.localeCompare(second.id));
  const personalSpace = (monster: MonsterState): number =>
    distanceSquared(monster.position, state.player.position) <=
    (monster.attackRange + MONSTER_PERSONAL_SPACE_PADDING) ** 2
      ? ENGAGED_MONSTER_PERSONAL_SPACE_PADDING
      : MONSTER_PERSONAL_SPACE_PADDING;
  for (let pass = 0; pass < MONSTER_SEPARATION_PASSES; pass += 1) {
    let adjusted = false;
    for (let firstIndex = 0; firstIndex < living.length; firstIndex += 1) {
      const first = living[firstIndex]!;
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < living.length;
        secondIndex += 1
      ) {
        const second = living[secondIndex]!;
        const dx = second.position.x - first.position.x;
        const dy = second.position.y - first.position.y;
        const distance = Math.hypot(dx, dy);
        const minimumDistance =
          first.radius +
          second.radius +
          personalSpace(first) +
          personalSpace(second) +
          MONSTER_SEPARATION_GAP;
        if (distance >= minimumDistance) continue;

        const fallback = stablePairDirection(first.id, second.id);
        const direction =
          distance < 1
            ? { x: fallback.x / 1024, y: fallback.y / 1024 }
            : { x: dx / distance, y: dy / distance };
        const penetration = minimumDistance - distance;
        const firstDistance = Math.ceil(penetration / 2);
        const secondDistance = penetration - firstDistance;
        const firstHalf = separationCandidate(
          first.position,
          direction,
          -firstDistance,
        );
        const secondHalf = separationCandidate(
          second.position,
          direction,
          secondDistance,
        );
        const firstHalfWalkable = pointWalkable(
          state,
          firstHalf,
          first.radius,
          scenery,
        );
        const secondHalfWalkable = pointWalkable(
          state,
          secondHalf,
          second.radius,
          scenery,
        );
        if (firstHalfWalkable && secondHalfWalkable) {
          first.position = firstHalf;
          second.position = secondHalf;
          adjusted = true;
          continue;
        }

        // If scenery pins one participant, give the full correction to the
        // other. The lower-ID actor receives the first deterministic attempt.
        const firstFull = separationCandidate(
          first.position,
          direction,
          -penetration,
        );
        if (pointWalkable(state, firstFull, first.radius, scenery)) {
          first.position = firstFull;
          adjusted = true;
          continue;
        }
        const secondFull = separationCandidate(
          second.position,
          direction,
          penetration,
        );
        if (pointWalkable(state, secondFull, second.radius, scenery)) {
          second.position = secondFull;
          adjusted = true;
          continue;
        }
        // A narrow pocket may allow only a partial correction. It is still
        // better to reduce penetration than to tunnel either actor through a
        // wall or a scenery footprint.
        if (firstHalfWalkable) {
          first.position = firstHalf;
          adjusted = true;
        } else if (secondHalfWalkable) {
          second.position = secondHalf;
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }

  for (const monster of living) {
    monster.velocity = {
      x: monster.position.x - monster.previousPosition.x,
      y: monster.position.y - monster.previousPosition.y,
    };
    if (
      state.tick >= monster.animation.lockedUntilTick &&
      ["idle", "walk"].includes(monster.animation.clip)
    )
      setAnimation(
        monster,
        monster.velocity.x !== 0 || monster.velocity.y !== 0 ? "walk" : "idle",
        state.tick,
      );
  }
}

function setAnimation(
  actor: {
    animation: {
      clip: AnimationClip;
      startedAtTick: number;
      lockedUntilTick: number;
    };
  },
  clip: AnimationClip,
  tick: number,
  lock = 0,
): void {
  if (
    actor.animation.clip !== clip ||
    clip === "attack" ||
    clip === "ability" ||
    clip === "hurt"
  ) {
    actor.animation = {
      clip,
      startedAtTick: tick,
      lockedUntilTick: tick + lock,
    };
  }
}

function applyDamageToMonster(
  state: GameState,
  monster: MonsterState,
  rawDamage: number,
  sourceId: string,
): void {
  if (monster.health <= 0) return;
  const damage = Math.max(
    1,
    Math.floor((rawDamage * 100) / (100 + monster.armor)),
  );
  monster.health -= damage;
  state.metrics.damageDealt += damage;
  setAnimation(
    monster,
    monster.health <= 0 ? "death" : "hurt",
    state.tick,
    monster.health <= 0 ? CLIP_DURATIONS.death : CLIP_DURATIONS.hurt,
  );
  state.effects.push({
    id: `effect:${state.nextEntityId}`,
    kind: "impact",
    position: { ...monster.position },
    color:
      sourceId === "player"
        ? ARCHETYPES[state.player.classId].accent
        : MONSTERS[monster.kind].color,
    startedAtTick: state.tick,
    expiresAtTick: state.tick + 8,
    radius: 900,
  });
  state.nextEntityId += 1;
  emit(state, {
    type: "damage",
    sourceId,
    targetId: monster.id,
    amount: damage,
  });
}

function spawnLoot(state: GameState, monster: MonsterState): void {
  const rng = createRng(`${state.seed}:loot:${monster.id}`);
  const shouldDrop = monster.guaranteedLoot || randomFloat(rng) < 0.7;
  if (!shouldDrop) return;
  const kindRoll = randomFloat(rng);
  const rarityRoll = randomFloat(rng);
  const kind = kindRoll < 0.55 ? "gold" : kindRoll < 0.8 ? "tonic" : "weapon";
  const rarity =
    rarityRoll < 0.7 ? "common" : rarityRoll < 0.95 ? "tempered" : "relic";
  const amount =
    kind === "gold"
      ? rarity === "relic"
        ? 18
        : rarity === "tempered"
          ? 10
          : 6
      : kind === "weapon"
        ? rarity === "relic"
          ? 6
          : rarity === "tempered"
            ? 3
            : 1
        : 1;
  const loot: LootState = {
    id: `loot:${monster.id}:0`,
    kind,
    rarity,
    position: { ...monster.position },
    amount,
    sourceId: monster.id,
    bobOffset: Math.floor(randomFloat(rng) * 72),
  };
  state.nextEntityId += 1;
  state.loot.push(loot);
  emit(state, {
    type: "loot_dropped",
    sourceId: monster.id,
    targetId: loot.id,
    amount,
    detail: `${rarity} ${kind}`,
  });
}

function resolveDeaths(state: GameState): void {
  const newlyDead = state.monsters
    .filter((monster) => monster.health <= 0 && monster.deathTick === null)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const monster of newlyDead) {
    monster.deathTick = state.tick;
    monster.removeAtTick = state.tick + CLIP_DURATIONS.death;
    monster.velocity = { x: 0, y: 0 };
    state.metrics.kills += 1;
    state.player.xp += MONSTERS[monster.kind].xp;
    emit(state, {
      type: "monster_died",
      sourceId: "player",
      targetId: monster.id,
    });
    spawnLoot(state, monster);
  }
  state.monsters = state.monsters.filter(
    (monster) =>
      monster.removeAtTick === null || monster.removeAtTick > state.tick,
  );
  if (
    !state.exitUnlocked &&
    state.monsters.every((monster) => monster.health <= 0)
  ) {
    state.exitUnlocked = true;
    emit(state, { type: "exit_unlocked", detail: "The rift gate is open" });
  }
}

function hitCone(
  state: GameState,
  attack: PendingAttack,
  threshold: number,
): void {
  const rangeSquared = attack.range * attack.range;
  for (const monster of [...state.monsters].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (monster.health <= 0) continue;
    if (distanceSquared(attack.origin, monster.position) > rangeSquared)
      continue;
    const direction = normalized(attack.origin, monster.position);
    const dot =
      (direction.x * attack.direction.x + direction.y * attack.direction.y) /
      DIRECTION_SCALE;
    if (dot >= threshold)
      applyDamageToMonster(state, monster, attack.damage, attack.ownerId);
  }
}

function createProjectile(
  state: GameState,
  attack: PendingAttack,
  direction = attack.direction,
  pierce = 0,
): ProjectileState {
  const definition = ARCHETYPES[state.player.classId];
  const speed = state.player.classId === "ranger" ? 220 : 175;
  const projectile: ProjectileState = {
    id: `projectile:${state.nextEntityId}`,
    owner: "player",
    hostile: false,
    position: { ...attack.origin },
    previousPosition: { ...attack.origin },
    velocity: {
      x: Math.round((direction.x * speed) / DIRECTION_SCALE),
      y: Math.round((direction.y * speed) / DIRECTION_SCALE),
    },
    radius: state.player.classId === "ranger" ? 110 : 155,
    damage: attack.damage,
    expiresAtTick: state.tick + Math.ceil(definition.attackRange / speed),
    color: definition.accent,
    pierce,
    spawnedAtTick: state.tick,
    hitTargets: [],
  };
  state.nextEntityId += 1;
  return projectile;
}

function rotateDirection(direction: Vec2, sine: number): Vec2 {
  const cosine = Math.sqrt(1 - sine * sine);
  return {
    x: Math.round(direction.x * cosine - direction.y * sine),
    y: Math.round(direction.x * sine + direction.y * cosine),
  };
}

function resolvePendingAttacks(state: GameState): void {
  const due = state.pendingAttacks
    .filter((attack) => attack.impactTick <= state.tick)
    .sort((a, b) => a.id.localeCompare(b.id));
  state.pendingAttacks = state.pendingAttacks.filter(
    (attack) => attack.impactTick > state.tick,
  );
  for (const attack of due) {
    if (attack.ownerId !== "player") {
      const monster = state.monsters.find(
        (entry) => entry.id === attack.ownerId && entry.health > 0,
      );
      if (!monster) continue;
      if (monster.kind === "hexer") {
        state.projectiles.push({
          id: `projectile:${state.nextEntityId}`,
          owner: monster.id,
          hostile: true,
          position: { ...monster.position },
          previousPosition: { ...monster.position },
          velocity: {
            x: Math.round((attack.direction.x * 120) / DIRECTION_SCALE),
            y: Math.round((attack.direction.y * 120) / DIRECTION_SCALE),
          },
          radius: 130,
          damage: attack.damage,
          expiresAtTick: state.tick + 100,
          color: "#d36de7",
          pierce: 0,
          spawnedAtTick: state.tick,
          hitTargets: [],
        });
        state.nextEntityId += 1;
      } else {
        const inRange =
          distanceSquared(attack.origin, state.player.position) <=
          attack.range * attack.range;
        const towardPlayer = normalized(attack.origin, state.player.position);
        const dot =
          (towardPlayer.x * attack.direction.x +
            towardPlayer.y * attack.direction.y) /
          DIRECTION_SCALE;
        if (inRange && dot >= 384)
          damagePlayer(state, attack.damage, attack.ownerId);
      }
      continue;
    }
    const classId = state.player.classId;
    if (classId === "vanguard") {
      hitCone(state, attack, attack.kind === "ability" ? 512 : 724);
      state.effects.push({
        id: `effect:${attack.id}`,
        kind: attack.kind === "ability" ? "nova" : "slash",
        position: { ...attack.origin },
        color: ARCHETYPES.vanguard.accent,
        startedAtTick: state.tick,
        expiresAtTick: state.tick + 12,
        radius: attack.range,
      });
    } else if (classId === "ranger") {
      if (attack.kind === "ability") {
        state.projectiles.push(
          createProjectile(
            state,
            attack,
            rotateDirection(attack.direction, -0.18),
            2,
          ),
          createProjectile(state, attack, attack.direction, 2),
          createProjectile(
            state,
            attack,
            rotateDirection(attack.direction, 0.18),
            2,
          ),
        );
      } else state.projectiles.push(createProjectile(state, attack));
    } else if (attack.kind === "ability") {
      for (const monster of state.monsters) {
        if (
          monster.health > 0 &&
          distanceSquared(attack.origin, monster.position) <=
            attack.range * attack.range
        ) {
          applyDamageToMonster(state, monster, attack.damage, "player");
        }
      }
      state.effects.push({
        id: `effect:${attack.id}`,
        kind: "nova",
        position: { ...attack.origin },
        color: ARCHETYPES.arcanist.accent,
        startedAtTick: state.tick,
        expiresAtTick: state.tick + 18,
        radius: attack.range,
      });
    } else state.projectiles.push(createProjectile(state, attack));
  }
}

function queuePlayerAttack(
  state: GameState,
  kind: "primary" | "ability",
): void {
  const definition = ARCHETYPES[state.player.classId];
  const isAbility = kind === "ability";
  const impactDelay =
    state.player.classId === "ranger"
      ? isAbility
        ? 10
        : 6
      : isAbility
        ? 12
        : 8;
  const range = isAbility
    ? state.player.classId === "vanguard"
      ? 2355
      : state.player.classId === "arcanist"
        ? 2816
        : definition.attackRange
    : definition.attackRange;
  state.pendingAttacks.push({
    id: `attack:${state.nextEntityId}`,
    ownerId: "player",
    kind,
    impactTick: state.tick + impactDelay,
    origin: { ...state.player.position },
    direction: { ...state.player.facing },
    range,
    damage:
      (isAbility ? state.player.abilityDamage : state.player.attackDamage) +
      state.player.power,
  });
  state.nextEntityId += 1;
  setAnimation(
    state.player,
    isAbility ? "ability" : "attack",
    state.tick,
    isAbility ? 36 : 26,
  );
  emit(state, {
    type: isAbility ? "ability_started" : "attack_started",
    sourceId: "player",
    detail: state.player.classId,
  });
  if (isAbility)
    state.player.abilityReadyTick = state.tick + definition.abilityCooldown;
  else state.player.attackReadyTick = state.tick + definition.attackCooldown;
}

function updatePlayer(
  state: GameState,
  input: InputState,
  scenery: SceneryCollisionFootprint[],
): void {
  const player = state.player;
  player.previousPosition = { ...player.position };
  let moveX = input.moveX * player.moveSpeed;
  let moveY = input.moveY * player.moveSpeed;
  if (input.moveX !== 0 && input.moveY !== 0) {
    moveX = Math.round((moveX * DIAGONAL_SCALE) / DIRECTION_SCALE);
    moveY = Math.round((moveY * DIAGONAL_SCALE) / DIRECTION_SCALE);
  }
  if (input.aim) player.facing = normalized(player.position, input.aim);
  else if (moveX !== 0 || moveY !== 0)
    player.facing = normalized({ x: 0, y: 0 }, { x: moveX, y: moveY });
  player.position = moveActor(
    state,
    player.position,
    { x: moveX, y: moveY },
    player.radius,
    scenery,
  );
  player.velocity = {
    x: player.position.x - player.previousPosition.x,
    y: player.position.y - player.previousPosition.y,
  };
  state.metrics.distanceUnits += Math.round(
    Math.hypot(
      player.position.x - player.previousPosition.x,
      player.position.y - player.previousPosition.y,
    ),
  );

  if (input.useTonic && player.tonics > 0 && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + 45);
    player.tonics -= 1;
  }
  if (input.attack && state.tick >= player.attackReadyTick)
    queuePlayerAttack(state, "primary");
  else if (input.ability && state.tick >= player.abilityReadyTick)
    queuePlayerAttack(state, "ability");
  else if (state.tick >= player.animation.lockedUntilTick)
    setAnimation(
      player,
      player.velocity.x !== 0 || player.velocity.y !== 0 ? "walk" : "idle",
      state.tick,
    );
}

function damagePlayer(
  state: GameState,
  rawDamage: number,
  sourceId: string,
): void {
  if (
    state.tick < state.player.invulnerableUntilTick ||
    state.phase !== "playing"
  )
    return;
  const damage = Math.max(
    1,
    Math.floor((rawDamage * 100) / (100 + state.player.armor)),
  );
  state.player.health -= damage;
  state.metrics.damageTaken += damage;
  emit(state, {
    type: "player_damaged",
    sourceId,
    targetId: "player",
    amount: damage,
  });
  const source = state.monsters.find((monster) => monster.id === sourceId);
  state.effects.push({
    id: `effect:${state.nextEntityId}`,
    kind: "impact",
    position: { ...state.player.position },
    color: source ? MONSTERS[source.kind].color : "#ef7868",
    startedAtTick: state.tick,
    expiresAtTick: state.tick + 8,
    radius: 900,
  });
  state.nextEntityId += 1;
  if (state.player.health <= 0) {
    state.player.health = 0;
    state.phase = "lost";
    setAnimation(state.player, "death", state.tick, 48);
    emit(state, { type: "player_died", sourceId, targetId: "player" });
  } else setAnimation(state.player, "hurt", state.tick, 8);
}

function updateMonsters(
  state: GameState,
  scenery: SceneryCollisionFootprint[],
): void {
  for (const monster of [...state.monsters].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    monster.previousPosition = { ...monster.position };
    if (monster.health <= 0) {
      monster.velocity = { x: 0, y: 0 };
      continue;
    }
    if (!state.settings.ai) continue;
    if (
      ["attack", "hurt"].includes(monster.animation.clip) &&
      state.tick < monster.animation.lockedUntilTick
    ) {
      monster.velocity = { x: 0, y: 0 };
      continue;
    }
    const definition = MONSTERS[monster.kind];
    const distance = Math.sqrt(
      distanceSquared(monster.position, state.player.position),
    );
    const direction = normalized(monster.position, state.player.position);
    monster.facing = direction;
    monster.velocity = { x: 0, y: 0 };
    if (monster.kind === "hexer" && distance < 3 * UNITS_PER_TILE) {
      const retreatTarget = {
        x: monster.position.x - direction.x * 4,
        y: monster.position.y - direction.y * 4,
      };
      const retreat = navigationDirection(
        state.map,
        scenery,
        monster.position,
        retreatTarget,
        monster.radius,
      );
      if (retreat) {
        monster.facing = retreat;
        monster.velocity = {
          x: Math.round((retreat.x * monster.moveSpeed) / 1024),
          y: Math.round((retreat.y * monster.moveSpeed) / 1024),
        };
      }
    } else if (
      distance > monster.attackRange * 0.85 &&
      distance < 9 * UNITS_PER_TILE
    ) {
      const pursuit = navigationDirection(
        state.map,
        scenery,
        monster.position,
        state.player.position,
        monster.radius,
      );
      if (pursuit) {
        monster.facing = pursuit;
        monster.velocity = {
          x: Math.round((pursuit.x * monster.moveSpeed) / 1024),
          y: Math.round((pursuit.y * monster.moveSpeed) / 1024),
        };
      }
    }
    monster.position = moveActor(
      state,
      monster.position,
      monster.velocity,
      monster.radius,
      scenery,
    );
    monster.velocity = {
      x: monster.position.x - monster.previousPosition.x,
      y: monster.position.y - monster.previousPosition.y,
    };
    if (
      distance <= monster.attackRange &&
      state.tick >= monster.attackReadyTick
    ) {
      monster.attackReadyTick = state.tick + definition.attackCooldown;
      setAnimation(monster, "attack", state.tick, CLIP_DURATIONS.attack);
      const impactDelay =
        monster.kind === "ashfang" ? 7 : monster.kind === "stonekin" ? 10 : 12;
      state.pendingAttacks.push({
        id: `attack:${state.nextEntityId}`,
        ownerId: monster.id,
        kind: "primary",
        impactTick: state.tick + impactDelay,
        origin: { ...monster.position },
        direction: { ...direction },
        range: monster.attackRange,
        damage: monster.attackDamage,
      });
      state.nextEntityId += 1;
      emit(state, {
        type: "attack_started",
        sourceId: monster.id,
        targetId: "player",
        detail: monster.kind,
      });
    } else if (state.tick >= monster.animation.lockedUntilTick) {
      setAnimation(
        monster,
        monster.velocity.x !== 0 || monster.velocity.y !== 0 ? "walk" : "idle",
        state.tick,
      );
    }
  }
  if (state.settings.ai) separateLivingMonsters(state, scenery);
}

function updateProjectiles(state: GameState): void {
  const survivors: ProjectileState[] = [];
  for (const projectile of [...state.projectiles].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (projectile.spawnedAtTick === state.tick) {
      survivors.push(projectile);
      continue;
    }
    projectile.previousPosition = { ...projectile.position };
    projectile.position.x += projectile.velocity.x;
    projectile.position.y += projectile.velocity.y;
    const tileX = Math.floor(projectile.position.x / UNITS_PER_TILE);
    const tileY = Math.floor(projectile.position.y / UNITS_PER_TILE);
    if (
      state.tick >= projectile.expiresAtTick ||
      !isFloor(state.map, tileX, tileY)
    )
      continue;
    let consumed = false;
    if (projectile.hostile) {
      const radius = projectile.radius + state.player.radius;
      if (
        distanceSquared(projectile.position, state.player.position) <=
        radius * radius
      ) {
        damagePlayer(state, projectile.damage, projectile.owner);
        consumed = true;
      }
    } else {
      for (const monster of [...state.monsters].sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        if (monster.health <= 0 || projectile.hitTargets.includes(monster.id))
          continue;
        const radius = projectile.radius + monster.radius;
        if (
          distanceSquared(projectile.position, monster.position) <=
          radius * radius
        ) {
          applyDamageToMonster(state, monster, projectile.damage, "player");
          projectile.hitTargets.push(monster.id);
          projectile.pierce -= 1;
          if (projectile.pierce < 0) consumed = true;
          if (consumed) break;
        }
      }
    }
    if (!consumed) survivors.push(projectile);
  }
  state.projectiles = survivors;
}

function collectLoot(state: GameState): void {
  if (!state.settings.autoPickup) return;
  const remaining: LootState[] = [];
  for (const loot of state.loot) {
    if (distanceSquared(loot.position, state.player.position) > 700 * 700) {
      remaining.push(loot);
      continue;
    }
    if (loot.kind === "gold") state.player.gold += loot.amount;
    else if (loot.kind === "tonic") state.player.tonics += loot.amount;
    else state.player.power += loot.amount;
    state.metrics.lootCollected += 1;
    emit(state, {
      type: "loot_picked",
      sourceId: "player",
      targetId: loot.id,
      amount: loot.amount,
      detail: loot.kind,
    });
  }
  state.loot = remaining;
}

function checkExit(state: GameState): void {
  if (!state.exitUnlocked || state.phase !== "playing") return;
  const exit = tileCenter(state.map.exit);
  if (distanceSquared(exit, state.player.position) <= 650 * 650) {
    state.phase = "won";
    emit(state, { type: "run_won", sourceId: "player", detail: state.seed });
  }
}

export function stepGame(state: GameState, input: InputState): GameState {
  if (state.phase !== "playing") {
    state.events = [];
    state.effects = state.effects.filter(
      (effect) => effect.expiresAtTick > state.tick,
    );
    state.tick += 1;
    return state;
  }
  state.events = [];
  const scenery = sceneryCollisions(state.map);
  updatePlayer(state, input, scenery);
  updateMonsters(state, scenery);
  resolvePendingAttacks(state);
  updateProjectiles(state);
  resolveDeaths(state);
  collectLoot(state);
  checkExit(state);
  state.effects = state.effects.filter(
    (effect) => effect.expiresAtTick > state.tick,
  );
  state.tick += 1;
  return state;
}

export function advanceGame(
  state: GameState,
  ticks: number,
  input: InputState,
): GameState {
  for (let index = 0; index < ticks; index += 1) stepGame(state, input);
  return state;
}
