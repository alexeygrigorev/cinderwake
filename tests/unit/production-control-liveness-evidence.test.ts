import { describe, expect, it } from "vitest";
import {
  PRODUCTION_LIVENESS_DEADLINES_MS,
  PRODUCTION_LIVENESS_SCENARIO_IDS,
  evaluateProductionControlLiveness,
} from "../../scripts/lib/production-control-liveness-evidence.mjs";

function capture(tick: number, classId = "vanguard", attacks = 0) {
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}-${classId}-${attacks}`,
    manifestHash: `manifest-${tick}-${classId}-${attacks}`,
    frameHash: `frame-${tick}-${classId}-${attacks}`,
    snapshot: {
      scenarioId: `run:test-${classId}`,
      tick,
      player: {
        classId,
        position: { x: tick, y: 10 },
        tonics: attacks ? 1 : 2,
        health: attacks ? 80 : 50,
      },
      eventLog: Array.from({ length: attacks }, (_, index) => ({
        type: "attack_started",
        sourceId: "player",
        id: `attack-${index}`,
      })),
    },
    bridgeExposed: false,
    mode: "observe-only",
  };
}

function activation(
  controlId: string,
  intentId: string,
  before: ReturnType<typeof capture>,
  after: ReturnType<typeof capture>,
  postcondition: Record<string, unknown>,
) {
  return {
    controlId,
    intentId,
    completed: true,
    before,
    after,
    postcondition,
    elapsedMs: 20,
    deadlineKey: "control",
    deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.control,
  };
}

function profile(profileId: string) {
  const classes = ["vanguard", "ranger", "arcanist"];
  const selectionActivations = classes.map((classId, index) => ({
    controlId: `class-${classId}`,
    intentId: `select-${classId}`,
    completed: true,
    beforeClass: index === 0 ? "vanguard" : classes[index - 1],
    afterClass: classId,
    postcondition: { kind: "selected-class", classId },
    elapsedMs: 20,
    deadlineKey: "selection",
    deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.selection,
  }));
  const seed = {
    controlId: "seed-input",
    intentId: "edit-seed",
    completed: true,
    beforeValue: "default",
    afterValue: "live-seed",
    postcondition: { kind: "seed-changed" },
    elapsedMs: 20,
    deadlineKey: "selection",
    deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.selection,
  };
  const beginActivations = classes.map((classId, index) => ({
    controlId: "begin",
    intentId: "begin-run",
    completed: true,
    after: capture(20 + index, classId),
    postcondition: { kind: "started-scenario", classId },
    elapsedMs: 100,
    deadlineKey: "begin",
    deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.begin,
  }));
  const before = capture(30);
  const afterAttack = capture(31, "vanguard", 1);
  const gameplayActivations = [
    activation("action-attack", "attack", before, afterAttack, {
      kind: "event",
      eventType: "attack_started",
    }),
    activation("action-ability", "ability", before, afterAttack, {
      kind: "event",
      eventType: "attack_started",
    }),
    activation(
      "action-tonic",
      "tonic",
      capture(32),
      capture(33, "vanguard", 1),
      { kind: "tonic-consumed" },
    ),
  ];
  if (profileId === "phone-portrait")
    gameplayActivations.push(
      activation("move-pad", "movement", capture(34), capture(35), {
        kind: "moved",
      }),
    );
  const selectionVisibleControls = [
    ...classes.map((classId) => ({
      controlId: `class-${classId}`,
      visible: true,
      enabled: true,
    })),
    { controlId: "seed-input", visible: true, enabled: true },
    { controlId: "begin", visible: true, enabled: true },
  ];
  const gameplayVisibleControls = [
    { controlId: "action-attack", visible: true, enabled: true },
    { controlId: "action-ability", visible: true, enabled: true },
    { controlId: "action-tonic", visible: true, enabled: true },
    ...(profileId === "phone-portrait"
      ? [{ controlId: "move-pad", visible: true, enabled: true }]
      : []),
  ];
  const registry = [
    ...selectionActivations.map(({ controlId, intentId, postcondition }) => ({
      controlId,
      intentId,
      postcondition,
    })),
    {
      controlId: seed.controlId,
      intentId: seed.intentId,
      postcondition: seed.postcondition,
    },
    {
      controlId: "begin",
      intentId: "begin-run",
      postcondition: { kind: "started-scenario" },
    },
    ...gameplayActivations.map(({ controlId, intentId, postcondition }) => ({
      controlId,
      intentId,
      postcondition,
    })),
  ];
  return {
    profileId,
    selection: {
      gestureId:
        profileId === "desktop" ? "mouse-select-begin" : "touch-select-begin",
      visibleControls: selectionVisibleControls,
      activations: [...selectionActivations, seed, ...beginActivations],
      launches: classes.map((classId, index) => ({
        classId,
        selectedClass: classId,
        selectionActivation: selectionActivations[index],
        beginActivation: beginActivations[index],
      })),
      transitions: [...selectionActivations, seed, ...beginActivations],
    },
    gameplay: {
      visibleControls: gameplayVisibleControls,
      activations: gameplayActivations,
      transitions: gameplayActivations,
    },
    controlIntentRegistry: registry,
    timeline: [capture(30), capture(31, "vanguard", 1)],
  };
}

function fixture() {
  return {
    requiredProfiles: ["desktop", "phone-portrait"],
    requiredScenarioIds: PRODUCTION_LIVENESS_SCENARIO_IDS,
    profiles: [profile("desktop"), profile("phone-portrait")],
    recovery: {
      abort: {
        failure: { visible: true, kind: "atlas-aborted" },
        retry: {
          clicked: true,
          recovered: true,
          after: { canvasVisible: true },
        },
      },
      stall: {
        failure: { visible: true, kind: "atlas-stalled" },
        back: { clicked: true, selectionVisible: true },
      },
      transitions: [
        {
          completed: true,
          elapsedMs: 100,
          deadlineKey: "recovery",
          deadlineMs: PRODUCTION_LIVENESS_DEADLINES_MS.recovery,
        },
      ],
    },
  };
}

describe("production control liveness evaluator", () => {
  it("accepts complete launch, census, control, recovery, and deadline evidence", () => {
    const result = evaluateProductionControlLiveness(fixture());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.every(({ pass }) => pass)).toBe(true);
  });

  it.each([
    [
      "inert Begin",
      "launch-inert",
      (value: any) => {
        value.profiles[0].selection.launches[0].beginActivation.completed = false;
      },
    ],
    [
      "inert action",
      "control-inert",
      (value: any) => {
        value.profiles[0].gameplay.activations[0].completed = false;
      },
    ],
    [
      "missing abort recovery",
      "asset-recovery-visible",
      (value: any) => {
        value.recovery.abort.failure.visible = false;
      },
    ],
    [
      "missing visible intent",
      "visible-control-missing-intent",
      (value: any) => {
        value.profiles[0].controlIntentRegistry.pop();
      },
    ],
    [
      "unbound deadline",
      "transition-deadline-unbound",
      (value: any) => {
        value.profiles[0].selection.transitions[0].elapsedMs = 2_000;
      },
    ],
  ])("detects %s", (_name, expectedFailure, mutate) => {
    const value = fixture();
    mutate(value);

    const result = evaluateProductionControlLiveness(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain(expectedFailure);
  });
});
