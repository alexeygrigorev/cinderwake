import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = fileURLToPath(
  new URL("../../scripts/build-quality-index.mjs", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];

async function git(root: string, ...args: string[]) {
  return (await run("git", args, { cwd: root })).stdout.trim();
}

async function createRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quality-index-test-"));
  temporaryRoots.push(root);
  await git(root, "init", "--quiet");
  await git(root, "config", "user.name", "Quality Index Test");
  await git(root, "config", "user.email", "quality-index@example.invalid");
  await fs.writeFile(path.join(root, "source.txt"), "initial source\n");
  await git(root, "add", "source.txt");
  await git(root, "commit", "--quiet", "-m", "initial source");
  return root;
}

async function writeSequences(root: string, sourceCommit: string) {
  const directory = path.join(root, "quality-results", "sequences");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "index.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          id: "passing-sequence",
          pass: true,
          sourceCommit,
        },
      ],
    })}\n`,
  );
}

async function copyPresentationFixtures(root: string) {
  for (const relativePath of [
    "quality/presentation-checklist.v1.json",
    "quality/presentation-recipes.v1.json",
    "quality/presentation-run.v1.template.json",
  ]) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(repositoryRoot, relativePath), destination);
  }
}

async function buildIndex(root: string, args: string[] = []) {
  await run(process.execPath, [script, ...args], { cwd: root });
  return JSON.parse(
    await fs.readFile(
      path.join(root, "quality-results", "quality-index", "index.json"),
      "utf8",
    ),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("quality-index sequence evidence binding", () => {
  it("does not count a mechanically passing stale report as passing", async () => {
    const root = await createRepository();
    const staleCommit = await git(root, "rev-parse", "HEAD");
    await fs.writeFile(path.join(root, "source.txt"), "changed source\n");
    await git(root, "add", "source.txt");
    await git(root, "commit", "--quiet", "-m", "change source");
    await writeSequences(root, staleCommit);

    const index = await buildIndex(root);
    const sequences = index.reports.find(
      ({ id }: { id: string }) => id === "sequences",
    );

    expect(sequences.status).toBe("failed");
    expect(index.sequenceEvidence.stale).toEqual([
      { id: "passing-sequence", sourceCommit: staleCommit },
    ]);
  });

  it("accepts the source parent of one evidence-only publication commit", async () => {
    const root = await createRepository();
    const sourceCommit = await git(root, "rev-parse", "HEAD");
    await writeSequences(root, sourceCommit);
    await git(root, "add", "quality-results/sequences/index.json");
    await git(root, "commit", "--quiet", "-m", "publish evidence");

    const index = await buildIndex(root);
    const sequences = index.reports.find(
      ({ id }: { id: string }) => id === "sequences",
    );

    expect(sequences.status).toBe("passed");
    expect(index.sequenceEvidence.publicationParentCommit).toBe(sourceCommit);
    expect(index.sequenceEvidence.publicationParent).toBe(1);
    expect(index.sequenceEvidence.stale).toEqual([]);
  });

  it("publishes every presentation checklist ID and its result", async () => {
    const root = await createRepository();
    await copyPresentationFixtures(root);

    const index = await buildIndex(root);
    const checklist = index.presentationChecklist;
    const contract = JSON.parse(
      await fs.readFile(
        path.join(root, "quality/presentation-checklist.v1.json"),
        "utf8",
      ),
    );

    expect(checklist).toMatchObject({
      schemaVersion: 1,
      status: "blocked",
      valid: true,
      acceptanceReady: false,
      resultCounts: {
        PASS: 0,
        FAIL: 0,
        NEEDS_VISUAL_REVIEW: 0,
        UNRUN: 28,
      },
    });
    expect(checklist.checks).toHaveLength(28);
    expect(
      checklist.checks.map(({ checkId }: { checkId: string }) => checkId),
    ).toEqual(contract.checks.map(({ id }: { id: string }) => id));
    expect(
      index.reports.find(
        ({ id }: { id: string }) => id === "presentation-checklist",
      ),
    ).toMatchObject({ status: "blocked", href: "presentation-checklist.json" });
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            root,
            "quality-results/quality-index/presentation-checklist.json",
          ),
          "utf8",
        ),
      ).checks,
    ).toEqual(checklist.checks);
  });

  it("refuses to publish a run with an omitted applicable ID", async () => {
    const root = await createRepository();
    await copyPresentationFixtures(root);
    const templatePath = path.join(
      root,
      "quality/presentation-run.v1.template.json",
    );
    const invalidRun = JSON.parse(await fs.readFile(templatePath, "utf8"));
    invalidRun.checks.pop();
    const invalidPath = path.join(
      root,
      "quality-results/presentation-runs/missing-row.json",
    );
    await fs.mkdir(path.dirname(invalidPath), { recursive: true });
    await fs.writeFile(invalidPath, `${JSON.stringify(invalidRun)}\n`);

    let error: any;
    try {
      await buildIndex(root, [
        "--presentation-run",
        "quality-results/presentation-runs/missing-row.json",
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error?.stderr).toContain(
      "Presentation checklist cannot be published",
    );
    expect(error?.stderr).toContain("run-checks-not-canonical");
  });
});
