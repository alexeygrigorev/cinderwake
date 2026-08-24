import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { stepGame } from "../../src/game/simulation";
import { EMPTY_INPUT, type InputState } from "../../src/game/types";
import { buildRenderManifest } from "../../src/render/manifest";
import {
  BUILTIN_SCENARIOS,
  worldFromScenario,
} from "../../src/testkit/scenarios";

const run = promisify(execFile);
const assessor = fileURLToPath(
  new URL("../../scripts/assess-sequence.mjs", import.meta.url),
);
const capture = fileURLToPath(
  new URL("../../scripts/capture-sequence.mjs", import.meta.url),
);

interface CommandFixture {
  entries: Array<{ tick: number; input: Partial<InputState> }>;
  clipTransitionContract: {
    facingBucket: string;
    expectedDisposition?: "REJECT_CURRENT_CALIBRATION";
    phases: Array<{
      clip: string;
      clipStartedAtTick: number;
      firstObservedTick: number;
      lastObservedTick: number;
      requiredFrameIndices: number[];
    }>;
  };
}

type StartStopId =
  | "ashfang-start-stop-east"
  | "arcanist-start-stop-east"
  | "vanguard-start-stop-east"
  | "vanguard-start-stop-west"
  | "vanguard-start-stop-north"
  | "vanguard-start-stop-south";

async function commandFixture(id: string): Promise<CommandFixture> {
  const file = fileURLToPath(
    new URL(`../fixtures/sequences/${id}.commands.json`, import.meta.url),
  );
  return JSON.parse(await fs.readFile(file, "utf8")) as CommandFixture;
}

function capturedPhases(id: StartStopId, fixture: CommandFixture) {
  const state = worldFromScenario(BUILTIN_SCENARIOS[id]!);
  if (!id.startsWith("vanguard")) {
    const generatedOpening = worldFromScenario(
      BUILTIN_SCENARIOS["generated-run"]!,
    );
    expect(state.map).toEqual(generatedOpening.map);
    expect(state.player.position).toEqual({ x: 23040, y: 16896 });
  }

  const entityId = id.startsWith("ashfang")
    ? "monster:start-stop-ashfang"
    : "player";
  const commands = new Map(fixture.entries.map((entry) => [entry.tick, entry]));
  let input: InputState = { ...EMPTY_INPUT };
  const samples: Array<{
    tick: number;
    clip: string;
    clipStartedAtTick: number;
    frameIndex: number;
    facingBucket: string;
  }> = [];

  while (state.tick <= 180) {
    if (state.tick % 5 === 0) {
      const actor = buildRenderManifest(state, {
        x: 0,
        y: 0,
        zoom: 1,
      }).drawCalls.find((call) => call.entityId === entityId)!;
      samples.push({
        tick: state.tick,
        clip: actor.clip,
        clipStartedAtTick: actor.clipStartedAtTick,
        frameIndex: actor.frameIndex,
        facingBucket: actor.facingBucket,
      });
    }
    const command = commands.get(state.tick);
    if (command) input = { ...input, ...command.input };
    stepGame(state, input);
  }

  const phases: Array<{
    clip: string;
    clipStartedAtTick: number;
    firstObservedTick: number;
    lastObservedTick: number;
    frameIndices: number[];
  }> = [];
  for (const sample of samples) {
    let phase = phases.at(-1);
    if (!phase || phase.clip !== sample.clip) {
      phase = {
        clip: sample.clip,
        clipStartedAtTick: sample.clipStartedAtTick,
        firstObservedTick: sample.tick,
        lastObservedTick: sample.tick,
        frameIndices: [],
      };
      phases.push(phase);
    }
    phase.lastObservedTick = sample.tick;
    if (!phase.frameIndices.includes(sample.frameIndex))
      phase.frameIndices.push(sample.frameIndex);
  }
  return { phases, samples };
}

describe("current-runtime start/stop sequence fixtures", () => {
  it.each(["ashfang-start-stop-east", "arcanist-start-stop-east"] as const)(
    "%s follows its exact idle/walk/idle contract on the generated opening",
    async (id) => {
      const fixture = await commandFixture(id);
      const { phases, samples } = capturedPhases(id, fixture);

      expect(samples.every(({ facingBucket }) => facingBucket === "east")).toBe(
        true,
      );
      expect(phases).toHaveLength(3);
      for (const [
        index,
        expected,
      ] of fixture.clipTransitionContract.phases.entries()) {
        const observed = phases[index]!;
        expect(observed).toMatchObject({
          clip: expected.clip,
          clipStartedAtTick: expected.clipStartedAtTick,
          firstObservedTick: expected.firstObservedTick,
          lastObservedTick: expected.lastObservedTick,
        });
        expect(
          expected.requiredFrameIndices.every((frameIndex) =>
            observed.frameIndices.includes(frameIndex),
          ),
        ).toBe(true);
      }
    },
  );

  it.each([
    "vanguard-start-stop-east",
    "vanguard-start-stop-west",
    "vanguard-start-stop-north",
    "vanguard-start-stop-south",
  ] as const)(
    "%s reproduces its cardinal idle/walk/idle tape without claiming visual acceptance",
    async (id) => {
      const fixture = await commandFixture(id);
      const { phases, samples } = capturedPhases(id, fixture);

      expect(fixture.clipTransitionContract.expectedDisposition).toBe(
        "REJECT_CURRENT_CALIBRATION",
      );
      expect(
        samples.every(
          ({ facingBucket }) =>
            facingBucket === fixture.clipTransitionContract.facingBucket,
        ),
      ).toBe(true);
      expect(phases).toHaveLength(3);
      for (const [
        index,
        expected,
      ] of fixture.clipTransitionContract.phases.entries()) {
        const observed = phases[index]!;
        expect(observed).toMatchObject({
          clip: expected.clip,
          clipStartedAtTick: expected.clipStartedAtTick,
          firstObservedTick: expected.firstObservedTick,
          lastObservedTick: expected.lastObservedTick,
        });
        expect(
          expected.requiredFrameIndices.every((frameIndex) =>
            observed.frameIndices.includes(frameIndex),
          ),
        ).toBe(true);
      }
    },
  );

  it("rejects a paired walk-height mutation through the production detector", async () => {
    const { stdout } = await run(process.execPath, [
      assessor,
      "--self-test-start-stop-height-pop",
    ]);
    const control = JSON.parse(stdout);

    expect(control.baseline.pass).toBe(true);
    expect(control.mutated.pass).toBe(false);
    expect(control.mutated.difference).toBe(9);
    expect(control.detected).toBe(true);
  });

  it("rejects an evaluator that omits camera zoom from manifest projection", async () => {
    const { stdout } = await run(process.execPath, [
      assessor,
      "--self-test-zoom-projection",
    ]);
    const control = JSON.parse(stdout);

    expect(control.baseline.pass).toBe(true);
    expect(control.mutated.pass).toBe(false);
    expect(control.mutated.values.dimensions.width).toBe(118);
    expect(control.baseline.values.dimensions.width).toBeCloseTo(106.2);
    expect(control.detected).toBe(true);
  });

  it("rejects a glyph that moves opposite its simulated world direction", async () => {
    const { stdout } = await run(process.execPath, [
      assessor,
      "--self-test-directional-screen-motion",
    ]);
    const control = JSON.parse(stdout);

    expect(control.baseline.pass).toBe(true);
    expect(control.mutated.pass).toBe(false);
    expect(control.mutated.opposingSteps).toBe(2);
    expect(control.detected).toBe(true);
  });

  it("rejects logical close-up coordinates used directly on a physical backing", async () => {
    const { stdout } = await run(process.execPath, [
      capture,
      "--self-test-logical-crop",
    ]);
    const control = JSON.parse(stdout);

    expect(control.baseline.pass).toBe(true);
    expect(control.mutated.pass).toBe(false);
    expect(control.baseline.sourceRect.width).toBe(390);
    expect(control.mutated.sourceRect.width).toBe(260);
    expect(control.detected).toBe(true);
  });
});
