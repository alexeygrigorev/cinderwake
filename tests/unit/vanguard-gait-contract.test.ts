import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assessLandmarkGaitBank,
  fixtureAlphaReader,
  mutateFixture,
} from "../../scripts/lib/actor-gait-contract.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const audit = path.join(root, "scripts", "audit-actor-atlases.mjs");
const contract = JSON.parse(
  await fs.readFile(
    path.join(root, "quality", "vanguard-motion-contract.v1.json"),
    "utf8",
  ),
);
const acceptedFixture = JSON.parse(
  await fs.readFile(
    path.join(
      root,
      "tests",
      "fixtures",
      "actor-motion",
      "vanguard-gait-accepted.v1.json",
    ),
    "utf8",
  ),
);

function assess(fixture: typeof acceptedFixture) {
  return assessLandmarkGaitBank(
    fixture,
    contract.policy,
    fixtureAlphaReader(fixture),
  );
}

describe("Vanguard semantic gait promotion contract", () => {
  it("accepts a landmark-bound alternating-support fixture", () => {
    const assessment = assess(acceptedFixture);
    expect(assessment.pass).toBe(true);
    expect(assessment.failures).toEqual([]);
    expect(assessment.measurements.supportSwitches).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [
      "hash-distinct-same-support",
      (fixture: typeof acceptedFixture) => {
        for (const frame of fixture.frames) frame.support = "left";
      },
    ],
    [
      "insufficient-articulation",
      (fixture: typeof acceptedFixture) => {
        for (const frame of fixture.frames) {
          frame.landmarks.leftFoot.x = 5;
          frame.landmarks.rightFoot.x = 11;
          frame.landmarks.leftKnee.x = 6;
          frame.landmarks.rightKnee.x = 10;
        }
      },
    ],
    [
      "invalid-landmark-alpha-binding",
      (fixture: typeof acceptedFixture) => {
        fixture.frames[2].landmarks.leftKnee = { x: 0, y: 0 };
      },
    ],
    [
      "phase-reversal",
      (fixture: typeof acceptedFixture) => {
        [fixture.frames[2].phase, fixture.frames[3].phase] = [
          fixture.frames[3].phase,
          fixture.frames[2].phase,
        ];
      },
    ],
    [
      "anchor-shift",
      (fixture: typeof acceptedFixture) => {
        fixture.frames[4].anchorY += 2;
      },
    ],
    [
      "vertical-stretch",
      (fixture: typeof acceptedFixture) => {
        fixture.frames[3].landmarks.torso.y = 3;
        fixture.frames[3].opaquePixels.push("8,3");
      },
    ],
  ] as const)("rejects %s", (failureCode, mutate) => {
    const fixture = mutateFixture(acceptedFixture, (candidate) => {
      mutate(candidate);
      return candidate;
    });
    const assessment = assess(fixture);
    expect(assessment.pass).toBe(false);
    expect(
      assessment.failures.map(({ code }: { code: string }) => code),
    ).toContain(failureCode);
  });

  it("records the exact current atlas as rejected calibration while keeping the detector green", async () => {
    const reportDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "cinderwake-vanguard-audit-"),
    );
    try {
      await run(
        process.execPath,
        [audit, "--report-only", "--report-dir", reportDirectory],
        { cwd: root },
      );
      const report = JSON.parse(
        await fs.readFile(path.join(reportDirectory, "report.json"), "utf8"),
      );
      const calibration = report.vanguardMotionCalibration;
      expect(calibration.disposition).toBe("KNOWN_REJECTED_CALIBRATION");
      expect(calibration.exactRejectedCalibration).toBe(true);
      expect(calibration.candidatePromotionPass).toBe(false);
      expect(calibration.transitions).toHaveLength(4);
      expect(
        calibration.transitions.map(
          ({ facing, pass }: { facing: string; pass: boolean }) => [
            facing,
            pass,
          ],
        ),
      ).toEqual([
        ["east", false],
        ["west", false],
        ["north", true],
        ["south", true],
      ]);
      expect(
        calibration.failures.map(({ code }: { code: string }) => code),
      ).toEqual(contract.productionRejectedCalibration.expectedFailureCodes);
      expect(report.vanguardGaitNegativeControls.controls).toHaveLength(7);
      expect(
        report.vanguardGaitNegativeControls.controls.every(
          ({ detected }: { detected: boolean }) => detected,
        ),
      ).toBe(true);
    } finally {
      await fs.rm(reportDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
