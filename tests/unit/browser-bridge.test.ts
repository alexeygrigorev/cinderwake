import { describe, expect, it } from "vitest";
import { EMPTY_INPUT, type InputState } from "../../src/game/types";
import { stepGame } from "../../src/game/simulation";
import { MAX_ADVANCE_TICKS } from "../../src/testkit/inputValidation";
import {
  inputAtTick,
  playReplay,
  type ReplayTapeV1,
} from "../../src/testkit/replay";
import {
  installGameTestBridge,
  type TestHost,
} from "../../src/testkit/browserBridge";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

function testBridge() {
  let state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
  let manifest = { tick: state.tick };
  const sampledInputs: InputState[] = [];
  const host: TestHost = {
    getState: () => state,
    startScenario: (scenario) => {
      state = worldFromScenario(scenario);
    },
    startState: (snapshot) => {
      state = structuredClone(snapshot);
    },
    setInput: () => undefined,
    step: (_ticks, input = EMPTY_INPUT, options = {}) => {
      sampledInputs.push(structuredClone(input));
      stepGame(state, input);
      if (options.render ?? true) manifest = { tick: state.tick };
    },
    render: () => {
      manifest = { tick: state.tick };
    },
    getManifest: () => manifest as ReturnType<TestHost["getManifest"]>,
    getCanvas: () => null,
    captureLogicalFrame: () => `frame:${manifest.tick}`,
    captureEntityMask: () => ({}) as ReturnType<TestHost["captureEntityMask"]>,
    capturePaintMask: () => ({}) as ReturnType<TestHost["capturePaintMask"]>,
    setCamera: () => undefined,
    setCameraMode: () => undefined,
    getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
  };
  const bridge = installGameTestBridge(host, {} as Window);
  bridge.loadScenario("animation-walk");
  return { bridge, sampledInputs };
}

describe("browser test bridge", () => {
  it.each([-1, 1.5, NaN, Infinity, MAX_ADVANCE_TICKS + 1])(
    "rejects invalid advance %s before changing state or consuming input",
    (ticks) => {
      const { bridge, sampledInputs } = testBridge();
      bridge.queueInputs([{ tick: 0, input: { moveX: 1 } }]);
      const before = bridge.snapshot();
      expect(() => bridge.step(ticks)).toThrow(/ticks/);
      expect(bridge.snapshot()).toEqual(before);
      bridge.step();
      expect(sampledInputs[0]!.moveX).toBe(1);
    },
  );

  it.each([
    { moveX: 0.5 },
    { moveY: Infinity },
    { attack: "true" },
    { aim: { x: NaN, y: 1 } },
    { aim: { x: 1 } },
    { attackk: true },
    null,
    [],
  ])(
    "rejects malformed live input %j without replacing prior input",
    (patch) => {
      const { bridge, sampledInputs } = testBridge();
      bridge.setInput({ moveX: 1 });
      expect(() => bridge.setInput(patch as Partial<InputState>)).toThrow();
      bridge.step();
      expect(sampledInputs[0]!.moveX).toBe(1);
    },
  );

  it("owns queued patches and aim points after accepting them", () => {
    const { bridge, sampledInputs } = testBridge();
    const patch: Partial<InputState> = { moveX: 1, aim: { x: 20, y: 30 } };
    bridge.queueInputs([{ tick: 0, input: patch }]);
    patch.moveX = -1;
    patch.aim!.x = 999;
    bridge.step();
    expect(sampledInputs[0]).toMatchObject({ moveX: 1, aim: { x: 20, y: 30 } });
  });

  it("validates an entire queue before adding any commands", () => {
    const { bridge, sampledInputs } = testBridge();
    bridge.queueInputs([{ tick: 0, input: { moveX: 1 } }]);
    expect(() =>
      bridge.queueInputs([
        { tick: 0, input: { moveX: -1 } },
        { tick: 1, input: { ability: "yes" } as any },
      ]),
    ).toThrow();
    bridge.step();
    expect(sampledInputs[0]!.moveX).toBe(1);
    expect(() => bridge.queueInputs([{ tick: 0, input: {} }])).toThrow(
      /past tick/,
    );
  });

  it("rejects an invalid capture schedule before advancing its first tick", () => {
    const { bridge } = testBridge();
    const before = bridge.snapshot();
    expect(() => bridge.captureSequence([2, 1])).toThrow(/past tick/);
    expect(() => bridge.captureSequence([2, Infinity])).toThrow(/integer/);
    expect(bridge.snapshot()).toEqual(before);
  });

  it("synchronizes capture pixels when intermediate renders are disabled", () => {
    const { bridge } = testBridge();
    bridge.step(1, { render: false });
    const captures = bridge.captureSequence([1, 3], { render: false });
    for (const capture of captures) {
      expect(capture.snapshot.tick).toBe(capture.tick);
      expect(capture.manifest.tick).toBe(capture.tick);
      expect(capture.frame).toBe(`frame:${capture.tick}`);
    }
  });

  it("replays unsorted commands in the same order as the browser bridge", () => {
    const { bridge } = testBridge();
    const tape: ReplayTapeV1 = {
      version: 1,
      entries: [
        { tick: 4, input: { moveX: -1 } },
        { tick: 0, input: { moveX: 1 } },
        { tick: 4, input: { moveY: 1 } },
        { tick: 4, input: { moveX: 0 } },
      ],
    };
    const before = structuredClone(tape);
    bridge.queueInputs(tape.entries);
    bridge.step(6);
    const replay = playReplay(
      worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!),
      tape,
      6,
    );
    expect(replay.hashes.at(-1)!.hash).toBe(bridge.stateHash());
    expect(inputAtTick(tape, 5)).toMatchObject({ moveX: 0, moveY: 1 });
    expect(tape).toEqual(before);
  });

  it.each([-1, 1.5, NaN, Infinity, MAX_ADVANCE_TICKS + 1])(
    "rejects invalid replay duration %s without mutating the initial state",
    (ticks) => {
      const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
      const before = structuredClone(state);
      expect(() =>
        playReplay(state, { version: 1, entries: [] }, ticks),
      ).toThrow(/ticks/);
      expect(state).toEqual(before);
    },
  );

  it("validates later replay input before consuming an earlier valid command", () => {
    const state = worldFromScenario(BUILTIN_SCENARIOS["animation-walk"]!);
    const before = structuredClone(state);
    expect(() =>
      playReplay(
        state,
        {
          version: 1,
          entries: [
            { tick: 0, input: { moveX: 1 } },
            { tick: 2, input: { aim: { x: Infinity, y: 0 } } },
          ],
        },
        3,
      ),
    ).toThrow(/aim/);
    expect(state).toEqual(before);
  });

  it("passes the render preference to each host tick without rendering twice", () => {
    let state = worldFromScenario(BUILTIN_SCENARIOS["animation-idle"]!);
    const hostSteps: Array<{ ticks: number; render: boolean }> = [];
    let explicitRenderCalls = 0;
    const host: TestHost = {
      getState: () => state,
      startScenario: (scenario) => {
        state = worldFromScenario(scenario);
      },
      startState: (snapshot) => {
        state = structuredClone(snapshot);
      },
      setInput: () => undefined,
      step: (ticks = 1, _input, options = {}) => {
        hostSteps.push({ ticks, render: options.render ?? true });
        state.tick += ticks;
      },
      sampleInput: () => ({ ...EMPTY_INPUT }),
      render: () => {
        explicitRenderCalls += 1;
      },
      getManifest: () => ({}) as ReturnType<TestHost["getManifest"]>,
      getCanvas: () => null,
      captureEntityMask: () =>
        ({}) as ReturnType<TestHost["captureEntityMask"]>,
      capturePaintMask: () => ({}) as ReturnType<TestHost["capturePaintMask"]>,
      setCamera: () => undefined,
      setCameraMode: () => undefined,
      getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
    };
    const target = {} as Window;
    const bridge = installGameTestBridge(host, target);

    bridge.loadScenario("animation-idle");
    bridge.step(3, { render: true });
    bridge.step(2, { render: false });

    expect(hostSteps).toEqual([
      { ticks: 1, render: true },
      { ticks: 1, render: true },
      { ticks: 1, render: true },
      { ticks: 1, render: false },
      { ticks: 1, render: false },
    ]);
    expect(explicitRenderCalls).toBe(0);
  });
});
