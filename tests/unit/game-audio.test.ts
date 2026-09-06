import { describe, expect, it, vi } from "vitest";
import { GameAudio, soundForEvent } from "../../src/audio/GameAudio";
import type { GameState } from "../../src/game/types";
import { worldFromScenario } from "../../src/testkit/scenarios";

function setup(options: { fail?: boolean; muted?: boolean } = {}) {
  let time = 0;
  const sources: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended?: () => void;
  }> = [];
  const createContext = vi.fn(
    () =>
      ({
        state: "suspended",
        destination: {},
        resume: vi.fn(async () => {}),
        createGain: () => ({
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createBufferSource: () => {
          const source = {
            buffer: null,
            start: vi.fn(),
            stop: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            onended: undefined,
          };
          sources.push(source);
          return source;
        },
        decodeAudioData: vi.fn(async () => ({})),
      }) as unknown as AudioContext,
  );
  const fetcher = vi.fn(
    async () =>
      ({
        ok: !options.fail,
        arrayBuffer: async () => new ArrayBuffer(16),
      }) as Response,
  );
  const storage = {
    getItem: vi.fn(() =>
      options.muted ? '{"muted":true,"volume":0.3}' : null,
    ),
    setItem: vi.fn(),
  };
  const audio = new GameAudio("/game/", {
    createContext,
    fetch: fetcher,
    now: () => time,
    storage,
  });
  return {
    audio,
    createContext,
    fetcher,
    sources,
    storage,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
function state(): GameState {
  return worldFromScenario({
    schemaVersion: 1,
    id: "audio-test",
    seed: "audio",
    classId: "vanguard",
    map: { mode: "generated" },
  });
}

describe("game audio", () => {
  it("loads only after activation and reuses one context and one request per asset", async () => {
    const { audio, createContext, fetcher } = setup();
    audio.play("strike");
    audio.speak("quest:arrival");
    expect(createContext).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    audio.activate();
    audio.activate();
    await flush();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(fetcher).toHaveBeenCalledWith(
      "/game/assets/audio/quest-arrival.mp3",
    );
    expect(audio.snapshot().loaded).toBe(12);
  });

  it("sounds player attacks and impacts, leaving enemy windups silent", () => {
    expect(
      soundForEvent({ tick: 1, type: "attack_started", sourceId: "monster-1" }),
    ).toBeNull();
    expect(
      soundForEvent({ tick: 1, type: "attack_started", sourceId: "player" }),
    ).toBe("strike");
    expect(soundForEvent({ tick: 2, type: "damage", sourceId: "player" })).toBe(
      "hit",
    );
    expect(soundForEvent({ tick: 2, type: "loot_picked" })).toBe("loot");
  });

  it("observes skipped ticks exactly once without changing simulation state", async () => {
    const { audio, advance } = setup();
    const world = state();
    audio.activate();
    await flush();
    audio.observe(world);
    world.tick = 3;
    world.eventLog = [
      { tick: 1, type: "attack_started", sourceId: "player" },
      { tick: 2, type: "damage", sourceId: "player" },
    ];
    const before = structuredClone(world);
    audio.observe(world);
    await flush();
    expect(audio.snapshot().played).toBe(2);
    advance(1000);
    audio.observe(world);
    await flush();
    expect(audio.snapshot().played).toBe(2);
    expect(world).toEqual(before);
    world.tick = 0;
    audio.observe(world);
    expect(audio.snapshot().activeSounds).toBe(0);
  });

  it("bounds effect overlap and rate limits repeated hits", async () => {
    const { audio, advance } = setup();
    audio.activate();
    await flush();
    for (let i = 0; i < 10; i++) audio.play("hit");
    await flush();
    expect(audio.snapshot().played).toBe(1);
    for (let i = 0; i < 10; i++) {
      advance(150);
      audio.play("hit");
      await flush();
    }
    expect(audio.snapshot().activeSounds).toBe(6);
    expect(audio.snapshot().played).toBe(6);
  });

  it("persists mute and volume, stops sources, and discards pending playback", async () => {
    const { audio, storage, sources } = setup();
    audio.activate();
    await flush();
    audio.play("hit");
    await flush();
    audio.speak("quest:arrival");
    audio.setMuted(true);
    await flush();
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(audio.snapshot().played).toBe(1);
    audio.play("loot");
    audio.speak("npc:tess");
    await flush();
    expect(audio.snapshot().played).toBe(1);
    audio.setVolume(0.25);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      "cinderwake.audio.v1",
      '{"muted":true,"volume":0.25}',
    );
    expect(setup({ muted: true }).audio.snapshot()).toMatchObject({
      muted: true,
      volume: 0.3,
    });
  });

  it("keeps only the latest narration and prevents rapid dialogue repetition", async () => {
    const { audio, sources, advance } = setup();
    audio.activate();
    await flush();
    audio.speak("quest:arrival");
    audio.speak("quest:keeper");
    await flush();
    expect(audio.snapshot()).toMatchObject({
      played: 1,
      speaking: "quest:keeper",
    });
    audio.speak("quest:keeper");
    await flush();
    expect(audio.snapshot().played).toBe(1);
    advance(1000);
    audio.speak("npc:tess");
    await flush();
    expect(sources[0].stop).toHaveBeenCalledOnce();
    sources[0].onended?.();
    expect(audio.snapshot().speaking).toBe("npc:tess");
    sources[1].onended?.();
    expect(audio.snapshot().speaking).toBeNull();
  });

  it("drops stale effects and prevents sound after stop", async () => {
    const { audio, advance } = setup();
    audio.activate();
    await flush();
    audio.play("strike");
    advance(300);
    await flush();
    expect(audio.snapshot().played).toBe(0);
    audio.play("hit");
    audio.stop();
    await flush();
    expect(audio.snapshot().played).toBe(0);
  });

  it("reports unavailable assets without throwing or spamming retries", async () => {
    const { audio, fetcher } = setup({ fail: true });
    audio.activate();
    await flush();
    audio.play("hit");
    audio.speak("quest:arrival");
    await flush();
    expect(audio.snapshot()).toMatchObject({
      loaded: 0,
      played: 0,
      failed: 12,
    });
    expect(fetcher).toHaveBeenCalledTimes(12);
  });
});
