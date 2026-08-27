import { describe, expect, it } from "vitest";
import {
  CAMERA_MOTION_PROFILE_IDS,
  CAMERA_MOTION_RUN_SPECS,
  CAMERA_MOTION_SCENARIO_IDS,
  evaluateCameraMotionEvidence,
  runCameraMotionNegativeControls,
} from "../../scripts/lib/camera-motion-evidence.mjs";

function camera(x: number, y = 150) {
  return { x, y, zoom: 1 };
}

function sample(tick: number, x: number, targetX: number) {
  return {
    tick,
    presentationTick: tick,
    camera: camera(x),
    cameraTarget: camera(targetX),
    cameraMode: "smooth",
  };
}

function capture(tick: number, x: number, targetX: number, label: string) {
  return {
    tick,
    stateTick: tick,
    manifestTick: tick,
    stateHash: `state-${tick}`,
    manifestHash: `manifest-${tick}`,
    frameHash: `frame-${tick}`,
    label,
    manifest: {
      camera: camera(x),
      cameraTarget: camera(targetX),
      cameraMode: "smooth",
    },
  };
}

function gesture(
  id: string,
  startTick: number,
  samples: Array<{
    tick: number;
    camera: { x: number };
    cameraTarget: { x: number };
  }>,
  afterX: number,
  afterTargetX: number,
) {
  return {
    id,
    before: capture(
      startTick,
      samples[0]!.camera.x,
      samples[0]!.cameraTarget.x,
      `${id}-before`,
    ),
    after: capture(
      startTick + samples.length,
      afterX,
      afterTargetX,
      `${id}-after`,
    ),
    samples,
  };
}

function run() {
  const gestures = [
    gesture(
      "approach-map-edge",
      1,
      [
        sample(1, 100, 300),
        sample(2, 160, 300),
        sample(3, 210, 300),
        sample(4, 244, 300),
      ],
      244,
      300,
    ),
    gesture(
      "reverse-west",
      5,
      [sample(5, 244, 100), sample(6, 190, 100), sample(7, 144, 100)],
      144,
      100,
    ),
    gesture(
      "reverse-east",
      8,
      [sample(8, 144, 300), sample(9, 200, 300), sample(10, 244, 300)],
      244,
      300,
    ),
  ];
  return {
    scenarioId: CAMERA_MOTION_SCENARIO_IDS.edgeReversal,
    cameraMode: "smooth",
    cameraBounds: { minX: 100, maxX: 300, minY: 100, maxY: 200 },
    initial: {
      bridgeExposed: false,
      mode: "observe-only",
      capture: capture(0, 100, 300, "initial"),
    },
    gestures,
    timeline: [
      capture(0, 100, 300, "initial"),
      ...gestures.flatMap(({ before, after }) => [before, after]),
    ],
  };
}

function evidence() {
  return {
    requiredProfiles: [...CAMERA_MOTION_PROFILE_IDS],
    requiredScenarioIds: [CAMERA_MOTION_SCENARIO_IDS.edgeReversal],
    requiredGestureIds: [...CAMERA_MOTION_RUN_SPECS[0]!.gestureIds],
    profiles: CAMERA_MOTION_PROFILE_IDS.map((profileId) => ({
      profileId,
      runs: [run()],
    })),
  };
}

function modeRun(
  mode: "fixed" | "snap",
  scenarioId: string,
  gestureId: string,
) {
  const value = structuredClone(run()) as any;
  value.scenarioId = scenarioId;
  value.cameraMode = mode;
  value.gestures = [value.gestures[0]!];
  value.gestures[0]!.id = gestureId;
  const captures = [
    value.initial.capture,
    ...value.gestures.flatMap(
      ({ before, after }: { before: any; after: any }) => [before, after],
    ),
  ];
  for (const capture of captures) {
    capture.manifest.cameraMode = mode;
    if (mode === "fixed") capture.manifest.camera = camera(100);
    else capture.manifest.camera = { ...capture.manifest.cameraTarget };
  }
  for (const sampleValue of value.gestures[0]!.samples) {
    sampleValue.cameraMode = mode;
    if (mode === "fixed") sampleValue.camera = camera(100);
    else sampleValue.camera = { ...sampleValue.cameraTarget };
  }
  value.timeline = [
    value.initial.capture,
    ...value.gestures.flatMap(
      ({ before, after }: { before: any; after: any }) => [before, after],
    ),
  ];
  return value;
}

describe("camera motion evidence evaluator", () => {
  it("accepts a bounded smooth edge approach and reversal tape", () => {
    const result = evaluateCameraMotionEvidence(evidence());

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.signals.map(({ pass }) => pass)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(result.coverage).toMatchObject({
      hasAllProfiles: true,
      hasAllRuns: true,
      expectedRuns: 2,
      actualRuns: 2,
      timelinesSynchronized: true,
    });
  });

  it("detects every named camera mutation", () => {
    const results = runCameraMotionNegativeControls({
      ...evidence(),
      requiredProfiles: ["desktop"],
      profiles: [evidence().profiles[0]!],
    });

    expect(results).toHaveLength(5);
    expect(results.every(({ status }) => status === "DETECTED")).toBe(true);
    expect(results.map(({ signal }) => signal)).toEqual([
      "camera-speed-doubled",
      "camera-snap-detected",
      "camera-overshoot-detected",
      "camera-clamp-mismatch",
      "camera-axis-jitter",
    ]);
  });

  it("rejects a missing camera sample contract", () => {
    const value = evidence();
    delete (value.profiles[0]!.runs[0]!.gestures[0]!.samples[1] as any).camera;

    const result = evaluateCameraMotionEvidence(value);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("camera-evidence-desynchronized");
  });

  it("checks fixed and snap camera modes as distinct run contracts", () => {
    const requiredRunSpecs = [
      {
        scenarioId: CAMERA_MOTION_SCENARIO_IDS.fixed,
        cameraMode: "fixed" as const,
        gestureIds: ["fixed-travel"],
      },
      {
        scenarioId: CAMERA_MOTION_SCENARIO_IDS.snap,
        cameraMode: "snap" as const,
        gestureIds: ["snap-travel"],
      },
    ];
    const result = evaluateCameraMotionEvidence({
      requiredProfiles: ["desktop"],
      requiredRunSpecs,
      profiles: [
        {
          profileId: "desktop",
          runs: [
            modeRun("fixed", CAMERA_MOTION_SCENARIO_IDS.fixed, "fixed-travel"),
            modeRun("snap", CAMERA_MOTION_SCENARIO_IDS.snap, "snap-travel"),
          ],
        },
      ],
    });

    expect(result.pass).toBe(true);
    expect(
      result.signals.find(({ id }) => id === "camera-mode-contract"),
    ).toMatchObject({ pass: true });
  });

  it("rejects a moving fixed camera", () => {
    const value = modeRun(
      "fixed",
      CAMERA_MOTION_SCENARIO_IDS.fixed,
      "fixed-travel",
    );
    value.gestures[0]!.samples[1]!.camera.x += 1;

    const result = evaluateCameraMotionEvidence({
      requiredProfiles: ["desktop"],
      requiredRunSpecs: [
        {
          scenarioId: CAMERA_MOTION_SCENARIO_IDS.fixed,
          cameraMode: "fixed",
          gestureIds: ["fixed-travel"],
        },
      ],
      profiles: [{ profileId: "desktop", runs: [value] }],
    });

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("camera-mode-contract");
  });
});
