import { describe, expect, it } from "vitest";
import { EMPTY_INPUT } from "../../src/game/types";
import {
  installGameTestBridge,
  type TestHost,
} from "../../src/testkit/browserBridge";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

describe("browser test bridge", () => {
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
