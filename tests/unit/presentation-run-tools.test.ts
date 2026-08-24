import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const initializer = fileURLToPath(
  new URL("../../scripts/init-presentation-run.mjs", import.meta.url),
);
const progress = fileURLToPath(
  new URL("../../scripts/report-presentation-progress.mjs", import.meta.url),
);
const temporaryRoots: string[] = [];

async function temporaryRunPath() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cinderwake-presentation-run-"),
  );
  temporaryRoots.push(directory);
  return path.join(directory, "run.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("presentation-run initializer and progress", () => {
  it("creates an exact-commit canonical blank run and refuses overwrite", async () => {
    const output = await temporaryRunPath();
    const first = await run(
      process.execPath,
      [initializer, "--run-id", "mobile-audit-001", "--output", output],
      { cwd: root },
    );
    const value = JSON.parse(await fs.readFile(output, "utf8"));
    const commit = (
      await run("git", ["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();

    expect(first.stdout).toContain(
      "does not execute recipes, evidence, mutations, or visual review",
    );
    expect(value.runId).toBe("mobile-audit-001");
    expect(value.environment.commit).toBe(commit);
    expect(value.environment.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(value.environment.reproduce).toContain("npm run check");
    expect(value.checks).toHaveLength(28);
    expect(
      value.checks.every(
        ({ result }: { result: string }) => result === "UNRUN",
      ),
    ).toBe(true);

    await expect(
      run(
        process.execPath,
        [initializer, "--run-id", "mobile-audit-001", "--output", output],
        { cwd: root },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("refusing to overwrite"),
    });
  });

  it("reports all ordered validator blockers without claiming execution", async () => {
    const output = await temporaryRunPath();
    await run(
      process.execPath,
      [initializer, "--run-id", "progress-audit-001", "--output", output],
      { cwd: root },
    );
    const result = await run(process.execPath, [progress, "--run", output], {
      cwd: root,
    });

    expect(result.stdout).toContain(
      "01 PRES-LIVE-001 P0 UNRUN [unrun, p0-incomplete]",
    );
    expect(result.stdout).toContain("28 PRES-STATE-028 P0 UNRUN");
    expect(result.stdout).toContain("Summary: 0/28 PASS");
    expect(result.stdout).toContain("Acceptance: BLOCKED (40 blockers)");
    expect(result.stdout).toContain(
      "does not execute recipes or approve visual quality",
    );
  });
});
