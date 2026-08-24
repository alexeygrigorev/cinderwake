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

async function buildIndex(root: string) {
  await run(process.execPath, [script], { cwd: root });
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
});
