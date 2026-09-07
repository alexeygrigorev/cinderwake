import type { GameEvent, GameState } from "../game/types";
import { monsterAttackProfile } from "../game/monsterAttackProfile";

export const VOICE_CUES = [
  "quest:arrival",
  "quest:keeper",
  "quest:road",
  "npc:ileya",
  "npc:tess",
  "quest:complete",
] as const;
export type VoiceCue = (typeof VOICE_CUES)[number];
export type SoundCue =
  "strike" | "hit" | "loot" | "quest" | "danger" | "ability";
type Cue = SoundCue | VoiceCue | "music";
const SOUND_CUES: SoundCue[] = [
  "strike",
  "hit",
  "loot",
  "quest",
  "danger",
  "ability",
];
const STORAGE_KEY = "cinderwake.audio.v1";
const COOLDOWNS: Record<SoundCue, number> = {
  strike: 100,
  hit: 100,
  loot: 180,
  quest: 1200,
  danger: 450,
  ability: 250,
};
const LEVELS: Record<SoundCue, number> = {
  strike: 0.42,
  hit: 0.55,
  loot: 0.45,
  quest: 0.5,
  danger: 0.55,
  ability: 0.48,
};

function isBellKeeperWarning(state: GameState, attackId: string): boolean {
  const attack = state.pendingAttacks.find(({ id }) => id === attackId);
  if (!attack || attack.kind !== "ability") return false;
  const owner = state.monsters.find(({ id }) => id === attack.ownerId);
  if (!owner) return false;
  return (
    owner.health > 0 &&
    owner.elite &&
    owner.kind === "stonekin" &&
    monsterAttackProfile(owner).pattern === "radial-slam"
  );
}

export interface AudioSnapshot {
  activated: boolean;
  muted: boolean;
  volume: number;
  loaded: number;
  activeSounds: number;
  speaking: VoiceCue | null;
  played: number;
  failed: number;
  lastCue: Cue | null;
  contextState: AudioContextState | "inactive";
  musicPlaying: boolean;
  outputRms: number;
}

export function soundForEvent(event: GameEvent): SoundCue | null {
  switch (event.type) {
    case "attack_started":
      return event.sourceId === "player" ? "strike" : null;
    case "ability_started":
      return event.sourceId === "player" ? "ability" : null;
    case "damage":
      return event.sourceId === "player" ? "hit" : null;
    case "player_damaged":
    case "player_died":
      return "danger";
    case "loot_picked":
      return "loot";
    case "exit_unlocked":
    case "run_won":
      return "quest";
    default:
      return null;
  }
}

/** Presentation-only observer. It never writes game state or consumes game RNG. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private effects?: GainNode;
  private musicGain?: GainNode;
  private music?: AudioBufferSourceNode;
  private musicWanted = false;
  private analyser?: AnalyserNode;
  private samples = new Float32Array(256);
  private buffers = new Map<Cue, AudioBuffer>();
  private loading = new Map<Cue, Promise<AudioBuffer | undefined>>();
  private active = new Set<AudioBufferSourceNode>();
  private voice?: AudioBufferSourceNode;
  private speaking: VoiceCue | null = null;
  private voiceRequest = 0;
  private generation = 0;
  private lastSounds = new Map<Cue, number>();
  private lastTick?: number;
  private world = "";
  private observedState?: GameState;
  private observedWarningAttacks = new Set<string>();
  private muted = false;
  private volume = 0.65;
  private played = 0;
  private failed = 0;
  private lastCue: Cue | null = null;
  private storage?: Pick<Storage, "getItem" | "setItem">;

  constructor(
    private readonly assetBase = "/",
    private readonly options: {
      createContext?: () => AudioContext;
      fetch?: typeof fetch;
      now?: () => number;
      storage?: Pick<Storage, "getItem" | "setItem">;
    } = {},
  ) {
    try {
      this.storage = options.storage ?? globalThis.localStorage;
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "null");
      if (saved && typeof saved.muted === "boolean") this.muted = saved.muted;
      if (
        saved &&
        typeof saved.volume === "number" &&
        Number.isFinite(saved.volume)
      )
        this.volume = Math.max(0, Math.min(1, saved.volume));
    } catch {
      /* Storage may be disabled; sound still works. */
    }
  }

  /** Call directly from a pointer/key gesture; browser autoplay policy is respected. */
  activate(): void {
    try {
      if (!this.context) {
        this.context = this.options.createContext?.() ?? new AudioContext();
        this.master = this.context.createGain();
        this.effects = this.context.createGain();
        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = 0.4;
        this.musicGain.connect(this.master);
        this.effects.connect(this.master);
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 256;
        this.master.connect(this.analyser);
        this.analyser.connect(this.context.destination);
        this.updateVolume();
        for (const cue of [...SOUND_CUES, ...VOICE_CUES, "music"] as Cue[])
          void this.load(cue);
      }
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {
          this.failed++;
        });
      this.ensureMusic();
    } catch {
      this.failed++;
    }
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (value) {
      this.stopEffects();
      this.stopMusicSource();
    }
    this.updateVolume();
    this.ensureMusic();
    this.persist();
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.volume === 0) {
      this.stopEffects();
      this.stopMusicSource();
    }
    this.updateVolume();
    this.ensureMusic();
    this.persist();
  }

  observe(state: GameState): void {
    const world = `${state.scenarioId}:${state.seed}:${state.map.digest}`;
    if (
      this.lastTick === undefined ||
      world !== this.world ||
      state.tick < this.lastTick ||
      (this.observedState !== undefined && this.observedState !== state)
    ) {
      this.stopEffects();
      this.world = world;
      this.lastTick = state.tick;
      this.observedState = state;
      this.observedWarningAttacks = new Set(
        state.pendingAttacks
          .filter(({ id }) => isBellKeeperWarning(state, id))
          .map(({ id }) => id),
      );
      return;
    }
    if (state.tick === this.lastTick) return;
    // The log covers simulation ticks skipped between rendered frames.
    for (const event of state.eventLog) {
      if (event.tick <= this.lastTick || event.tick > state.tick) continue;
      const cue = soundForEvent(event);
      if (cue) this.play(cue);
    }
    for (const attack of state.pendingAttacks) {
      if (
        !isBellKeeperWarning(state, attack.id) ||
        this.observedWarningAttacks.has(attack.id)
      )
        continue;
      this.observedWarningAttacks.add(attack.id);
      // danger is the existing low warning impact selected for this readable
      // radial threat; this remains presentation-only and never gates combat.
      this.play("danger");
    }
    this.observedState = state;
    this.lastTick = state.tick;
  }

  play(cue: SoundCue): void {
    if (!this.canPlay()) return;
    const now = this.now();
    if (now - (this.lastSounds.get(cue) ?? -Infinity) < COOLDOWNS[cue]) return;
    this.lastSounds.set(cue, now);
    const generation = this.generation;
    void this.load(cue)
      .then((buffer) => {
        if (
          !buffer ||
          !this.canPlay() ||
          generation !== this.generation ||
          this.now() - now > 250 ||
          this.active.size >= 6
        )
          return;
        const source = this.context!.createBufferSource();
        const gain = this.context!.createGain();
        source.buffer = buffer;
        gain.gain.value = LEVELS[cue];
        source.connect(gain);
        gain.connect(this.effects!);
        source.onended = () => {
          this.active.delete(source);
          source.disconnect();
          gain.disconnect();
        };
        this.active.add(source);
        source.start();
        this.record(cue);
      })
      .catch(() => {
        this.failed++;
      });
  }

  /** Latest dialogue replaces older dialogue; repeated interactions are rate-limited. */
  speak(cue: VoiceCue): void {
    if (!this.canPlay()) return;
    const now = this.now();
    if (now - (this.lastSounds.get(cue) ?? -Infinity) < 8000) return;
    this.lastSounds.set(cue, now);
    const request = ++this.voiceRequest;
    void this.load(cue)
      .then((buffer) => {
        if (!buffer || !this.canPlay() || request !== this.voiceRequest) return;
        this.voice?.stop();
        const source = this.context!.createBufferSource();
        source.buffer = buffer;
        source.connect(this.master!);
        this.voice = source;
        this.speaking = cue;
        this.effects!.gain.value = 0.4;
        this.musicGain!.gain.value = 0.16;
        source.onended = () => {
          source.disconnect();
          if (this.voice !== source) return;
          this.voice = undefined;
          this.speaking = null;
          this.effects!.gain.value = 1;
          this.musicGain!.gain.value = 0.4;
        };
        source.start();
        this.record(cue);
      })
      .catch(() => {
        this.failed++;
      });
  }

  stop(): void {
    this.musicWanted = false;
    this.stopMusicSource();
    this.stopEffects();
  }

  /** Called when entering/resuming a game. Activation must still come from a gesture. */
  startMusic(): void {
    this.musicWanted = true;
    this.ensureMusic();
  }

  private ensureMusic(): void {
    if (!this.musicWanted || this.music || !this.canPlay()) return;
    void this.load("music")
      .then((buffer) => {
        if (!buffer || !this.musicWanted || this.music || !this.canPlay())
          return;
        const source = this.context!.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(this.musicGain!);
        this.music = source;
        source.onended = () => {
          source.disconnect();
          if (this.music === source) this.music = undefined;
        };
        source.start();
      })
      .catch(() => {
        this.failed++;
      });
  }

  private stopMusicSource(): void {
    this.music?.stop();
    this.music = undefined;
  }

  private stopEffects(): void {
    this.generation++;
    this.voiceRequest++;
    for (const source of this.active) source.stop();
    this.active.clear();
    this.voice?.stop();
    this.voice = undefined;
    this.speaking = null;
    this.lastSounds.clear();
    if (this.effects) this.effects.gain.value = 1;
    if (this.musicGain) this.musicGain.gain.value = 0.4;
  }

  snapshot(): AudioSnapshot {
    this.analyser?.getFloatTimeDomainData(this.samples);
    const outputRms = Math.sqrt(
      this.samples.reduce((sum, sample) => sum + sample * sample, 0) /
        this.samples.length,
    );
    return {
      activated: !!this.context,
      muted: this.muted,
      volume: this.volume,
      loaded: this.buffers.size,
      activeSounds: this.active.size,
      speaking: this.speaking,
      played: this.played,
      failed: this.failed,
      lastCue: this.lastCue,
      contextState: this.context?.state ?? "inactive",
      musicPlaying:
        !!this.music && this.canPlay() && this.context?.state === "running",
      outputRms,
    };
  }

  private canPlay(): boolean {
    return !!this.context && !this.muted && this.volume > 0;
  }
  private now(): number {
    return this.options.now?.() ?? performance.now();
  }
  private updateVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }
  private persist(): void {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ muted: this.muted, volume: this.volume }),
      );
    } catch {
      /* Optional persistence. */
    }
  }
  private record(cue: Cue): void {
    this.played++;
    this.lastCue = cue;
  }
  private load(cue: Cue): Promise<AudioBuffer | undefined> {
    const buffer = this.buffers.get(cue);
    if (buffer) return Promise.resolve(buffer);
    const pending = this.loading.get(cue);
    if (pending) return pending;
    const request = (async () => {
      try {
        const response = await (this.options.fetch ?? fetch)(
          `${this.assetBase}assets/audio/${cue.replaceAll(":", "-")}.mp3`,
        );
        if (!response.ok) throw new Error("Audio unavailable");
        const decoded = await this.context!.decodeAudioData(
          await response.arrayBuffer(),
        );
        this.buffers.set(cue, decoded);
        return decoded;
      } catch {
        this.failed++;
        return undefined;
      }
    })();
    this.loading.set(cue, request);
    return request;
  }
}
