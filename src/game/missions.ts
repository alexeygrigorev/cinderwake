import { CITY_GATE_ID, type CityNpcId } from "./city";
import {
  CITY_DISCOVERY_LANDMARK_ID,
  cityNpcWorldAnchor,
  isEmbercrossMap,
  wildernessCityLandmarkAnchor,
} from "./cityWorld";
import { tileCenter } from "./dungeon";
import type { GameState, MonsterState, Vec2 } from "./types";

export type MissionId =
  "break-ambush" | "silence-bell" | "carry-warning" | "seal-night";

export interface MissionObjective {
  id: MissionId;
  title: string;
  description: string;
  current: number;
  total: number;
  complete: boolean;
}

/** Positions are authoritative world units, never map tiles or screen pixels. */
export interface MissionCue {
  id: string;
  kind: "scroll" | "sign" | "npc" | "gate" | "enemy";
  title: string;
  text: string;
  position: Vec2;
  voiceId?: string;
}

export interface MissionJournal {
  chapter: string;
  title: string;
  summary: string;
  activeId: MissionId;
  objectives: MissionObjective[];
  cue: MissionCue;
  ending: string | null;
}

/** Stable IDs shared by the journal and the generated voice asset manifest. */
export const MISSION_VOICE_LINES = {
  "quest:arrival":
    "The dead have taken the road. Break their ranks, then find what calls them.",
  "quest:keeper":
    "That stone giant was our bell keeper. Silence him. Let the road remember peace.",
  "quest:road":
    "The bell is silent. Follow the old road sign. Embercross still holds.",
  "npc:ileya":
    "You brought the warning home. Return to the south gate and seal the rift.",
  "npc:tess":
    "Your room is ready. Rest here. We will keep a light for your return.",
  "quest:complete":
    "For one more dawn, the dead are silent. Embercross remembers your name.",
} as const;

const OPENING_IDS = ["monster:00", "monster:01"] as const;

function distanceSquared(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function nearestThreat(state: GameState): MonsterState | undefined {
  return state.monsters
    .filter((monster) => monster.health > 0)
    .sort(
      (a, b) =>
        distanceSquared(a.position, state.player.position) -
          distanceSquared(b.position, state.player.position) ||
        a.id.localeCompare(b.id),
    )[0];
}

function roadSign(state: GameState): MissionCue {
  return {
    id: CITY_DISCOVERY_LANDMARK_ID,
    kind: "sign",
    title: "Embercross road sign",
    text: "EMBERCROSS — shelter beyond the old gate. Follow the marker to this sign, then continue to the gate. The dead must be cleared before the road opens.",
    position: wildernessCityLandmarkAnchor(state.map),
    voiceId: "quest:road",
  };
}

export function missionNpcDialogue(
  npcId: CityNpcId,
  state: GameState,
): MissionCue {
  const lines: Record<
    CityNpcId,
    Pick<MissionCue, "title" | "text" | "voiceId">
  > = {
    "npc:embercross:mara": {
      title: "Mara Vale · Cinder Market",
      text: "Ashfang hides buy another day of provisions. Sell your pelts here, or buy a tonic. The south gate is your way back to seal the rift.",
    },
    "npc:embercross:oren": {
      title: "Oren · The Lantern and Ladle",
      text: "We heard the bell stop. There is hot stew here if you need it. Tess keeps the rooms just east of my counter.",
    },
    "npc:embercross:tess": {
      title: "Tess · A light until dawn",
      text: "There is a bed here if you can pay for a night's rest. You can also save your journey from the journal at any time. Return to the south gate when you are ready.",
      voiceId: "npc:tess",
    },
    "npc:embercross:ileya": {
      title: "Sister Ileya · The last bell",
      text:
        state.phase === "won"
          ? "The ward holds. Tonight the people of Embercross can sleep. Carry their thanks with you."
          : "The bell keeper opened the rift to call his daughter home. Something else answered. You have broken its hold. Return to the south gate to seal the rift; my healing is here if you need it.",
      voiceId: "npc:ileya",
    },
  };
  return {
    id: npcId,
    kind: "npc",
    ...lines[npcId],
    position: cityNpcWorldAnchor(npcId),
  };
}

/** Readable discoveries; callers persist read IDs separately from simulation. */
export function missionLandmarks(state: GameState): MissionCue[] {
  if (isEmbercrossMap(state.map)) {
    return (
      [
        "npc:embercross:mara",
        "npc:embercross:oren",
        "npc:embercross:tess",
        "npc:embercross:ileya",
      ] as const
    ).map((id) => missionNpcDialogue(id, state));
  }
  return [
    {
      id: "scroll:ileya:warning",
      kind: "scroll",
      title: "Ileya's sealed letter",
      text: "To whoever still walks this road: the bell keeper has called the dead. Break the ambush, silence the Bell Keeper and his followers, then carry this warning to Embercross. Click clear ground to travel. Follow the direction marker through the ruin to the old road sign.",
      position: tileCenter(state.map.spawn),
      voiceId: "quest:arrival",
    },
    roadSign(state),
  ];
}

/**
 * Mission progress is derived from replayable facts. Actor disappearance alone
 * never counts as a kill: death records survive corpse removal and snapshots.
 */
export function missionJournal(state: GameState): MissionJournal {
  const inCity = isEmbercrossMap(state.map);
  const won = state.phase === "won";
  const cleared = state.exitUnlocked || inCity || won;
  const deadIds = new Set(
    state.eventLog
      .filter((event) => event.type === "monster_died")
      .map((event) => event.targetId),
  );
  for (const monster of state.monsters)
    if (monster.deathTick !== null && monster.health <= 0)
      deadIds.add(monster.id);
  const openingKills = cleared
    ? OPENING_IDS.length
    : OPENING_IDS.filter((id) => deadIds.has(id)).length;
  const remaining = state.monsters.filter(
    (monster) => monster.health > 0,
  ).length;
  const totalThreats = Math.max(1, state.metrics.kills + remaining);
  const objectives: MissionObjective[] = [
    {
      id: "break-ambush",
      title: "Break the ambush",
      description:
        "Defeat the two attackers on the arrival road. Hold Strike to attack; use your ability against a group.",
      current: openingKills,
      total: OPENING_IDS.length,
      complete: openingKills === OPENING_IDS.length,
    },
    {
      id: "silence-bell",
      title: "Silence the Bell Keeper",
      description:
        "Hunt the Bell Keeper and his remaining followers. Gather their spoils to strengthen your weapon and replenish supplies.",
      current: cleared
        ? totalThreats
        : Math.min(state.metrics.kills, totalThreats),
      total: totalThreats,
      complete: cleared,
    },
    {
      id: "carry-warning",
      title: "Carry the warning",
      description:
        "Follow the old road sign, then enter Embercross through the open gate.",
      current: inCity || won ? 1 : 0,
      total: 1,
      complete: inCity || won,
    },
    {
      id: "seal-night",
      title: "Seal the night",
      description:
        "Speak with the townsfolk if you wish, then return to the south gate to seal the rift. Services are optional.",
      current: won ? 1 : 0,
      total: 1,
      complete: won,
    },
  ];
  const active =
    objectives.find((objective) => !objective.complete) ?? objectives[3]!;
  const threat = nearestThreat(state);
  let cue: MissionCue;
  if (!cleared && threat) {
    cue = {
      id: threat.id,
      kind: "enemy",
      title: threat.elite ? "The Bell Keeper" : "Bell Keeper's followers",
      text: `${remaining} enemies remain. Follow the marker to the nearest threat.`,
      position: { ...threat.position },
      voiceId: active.id === "break-ambush" ? "quest:arrival" : "quest:keeper",
    };
  } else if (!inCity && state.city.locationPhase === "undiscovered" && !won) {
    cue = roadSign(state);
  } else {
    cue = {
      id: inCity ? CITY_GATE_ID : "exit:rift-gate",
      kind: "gate",
      title: inCity ? "Embercross south gate" : "Gate to Embercross",
      text: inCity
        ? "Return to the south gate to seal the rift. The townsfolk offer optional supplies and shelter."
        : "The road is open. Enter the gate to reach Embercross.",
      position: tileCenter(state.map.exit),
      voiceId: won ? "quest:complete" : inCity ? "npc:ileya" : "quest:road",
    };
  }
  return {
    chapter: "The Last Bell",
    title: won ? "The rift is sealed" : active.title,
    summary:
      "Embercross's bell keeper called into the dark for his lost daughter. The dead answered. Silence his host and bring the warning home before another night falls.",
    activeId: active.id,
    objectives,
    cue,
    ending: won
      ? MISSION_VOICE_LINES["quest:complete"]
      : state.phase === "lost"
        ? "The road has claimed another traveler. Load your saved journey, or begin again."
        : null,
  };
}
