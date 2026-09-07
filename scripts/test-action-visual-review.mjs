import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import {
  buildBundle,
  hash,
  requiredCases,
  reviewPrompt,
  runtimeFingerprint,
  validateRegistry,
  validateReview,
} from "./lib/action-visual-review.mjs";

const registry = JSON.parse(
  await fs.readFile("quality/action-review.v1.json", "utf8"),
);

test("every runtime animation and boolean input action declares a review contract", async () => {
  const source = ts.createSourceFile(
    "types.ts",
    await fs.readFile("src/game/types.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const clips = source.statements.find(
    (node) =>
      ts.isTypeAliasDeclaration(node) && node.name.text === "AnimationClip",
  );
  assert.ok(
    clips && ts.isUnionTypeNode(clips.type),
    "Runtime animation union must be discoverable",
  );
  const runtimeClips = clips.type.types.map((node) => node.literal.text).sort();
  assert.deepEqual(
    registry.actions
      .flatMap(({ runtimeClip }) => (runtimeClip ? [runtimeClip] : []))
      .sort(),
    runtimeClips,
  );
  const input = source.statements.find(
    (node) =>
      ts.isInterfaceDeclaration(node) && node.name.text === "InputState",
  );
  assert.ok(input, "Runtime inputs must be discoverable");
  const actions = input.members
    .filter((member) => member.type?.kind === ts.SyntaxKind.BooleanKeyword)
    .map((member) => member.name.text)
    .sort();
  assert.deepEqual(
    registry.actions
      .flatMap(({ runtimeInput }) => (runtimeInput ? [runtimeInput] : []))
      .sort(),
    actions,
  );
  assert.equal(requiredCases(registry).length, 7 * 3 * 2 * 4);
});

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "action-visual-review-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/runtime.txt"), "runtime-v1");
  await fs.writeFile(path.join(root, "automatic.json"), '{"pass":true}');
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const localRegistry = { ...structuredClone(registry), sourceRoots: ["src"] };
  const scope = {
    actions: ["attack"],
    actors: ["ranger"],
    profiles: ["desktop"],
    directions: ["east"],
  };
  const frames = [];
  for (const [index, stage] of ["windup", "impact", "recovery"].entries()) {
    const file = `${stage}.png`;
    await fs.writeFile(path.join(root, file), image);
    frames.push({ stage, tick: index + 1, file, sha256: hash(image) });
  }
  const captures = [
    {
      id: "ranger/attack/east/desktop",
      expectation: "Arrowhead points right and follows rightward travel",
      automatic: { pass: true, evidence: "automatic.json" },
      frames,
    },
  ];
  const input = {
    root,
    registry: localRegistry,
    scope,
    captures,
    sourceFingerprint: await runtimeFingerprint(
      root,
      localRegistry.sourceRoots,
    ),
  };
  const bundle = await buildBundle(input);
  const review = {
    schemaVersion: 1,
    bundleHash: bundle.bundleHash,
    reviewer: bundle.reviewer,
    cases: bundle.cases.map((entry) => ({
      id: entry.id,
      inspectedFrames: entry.frames.map(({ file }) => file),
      checks: entry.checks.map(({ id }) => ({
        id,
        verdict: "PASS",
        observation:
          "Visible arrowhead points right through release and recovery.",
        frames: entry.frames.map(({ file }) => file),
      })),
    })),
  };
  return { input, bundle, review, root, registry: localRegistry };
}

test("builds an ordered, hash-bound image prompt and accepts specific visual evidence", async (t) => {
  const current = await fixture(t);
  assert.equal((await validateReview(current)).pass, true);
  const prompt = reviewPrompt(current.bundle);
  assert.match(prompt, /MUST open every listed PNG/);
  assert.match(prompt, /gpt-5\.6-luna/);
  assert.match(prompt, /actual visible arrowhead/);
  assert.match(prompt, /UNCERTAIN/);
  assert.ok(prompt.indexOf('"windup"') < prompt.indexOf('"impact"'));
});

test("requires every newly declared action and rejects narrowed unknown scopes", async (t) => {
  const { input } = await fixture(t);
  input.registry.actions.push({ ...input.registry.actions[2], id: "jump" });
  await assert.rejects(
    buildBundle({
      ...input,
      scope: { ...input.scope, actions: ["attack", "jump"] },
    }),
    /Missing action capture/,
  );
  assert.throws(
    () => requiredCases(registry, { directions: ["northwest"] }),
    /Unknown/,
  );
});

test("rejects missing or duplicate cases and failed automatic checks", async (t) => {
  const { input } = await fixture(t);
  await assert.rejects(
    buildBundle({ ...input, captures: [] }),
    /Missing action capture/,
  );
  await assert.rejects(
    buildBundle({ ...input, captures: [...input.captures, ...input.captures] }),
    /Duplicate captures/,
  );
  input.captures[0].automatic.pass = false;
  await assert.rejects(buildBundle(input), /Automatic checks failed/);
});

test("rejects reordered stages, nonsequential ticks and missing image files", async (t) => {
  const { input } = await fixture(t);
  const changed = structuredClone(input);
  changed.captures[0].frames.reverse();
  await assert.rejects(buildBundle(changed), /Missing\/reordered stages/);
  changed.captures[0].frames.reverse();
  changed.captures[0].frames[1].tick = 1;
  await assert.rejects(buildBundle(changed), /Nonsequential ticks/);
  await fs.unlink(path.join(input.root, "impact.png"));
  await assert.rejects(buildBundle(input), /ENOENT/);
});

test("rejects stale runtime at bundle construction and acceptance", async (t) => {
  const current = await fixture(t);
  await fs.writeFile(path.join(current.root, "src/runtime.txt"), "runtime-v2");
  await assert.rejects(buildBundle(current.input), /Stale capture/);
  await assert.rejects(validateReview(current), /Stale review/);
});

test("rejects changed images and changed automatic evidence after review", async (t) => {
  const current = await fixture(t);
  await fs.appendFile(path.join(current.root, "impact.png"), "changed");
  await assert.rejects(validateReview(current), /Changed frame/);
  await fs.writeFile(
    path.join(current.root, "automatic.json"),
    '{"pass":false}',
  );
  await assert.rejects(validateReview(current), /Changed automatic evidence/);
});

test("rejects uninspected images, omitted checks and blanket observations", async (t) => {
  const current = await fixture(t);
  const original = structuredClone(current.review);
  current.review.cases[0].inspectedFrames.pop();
  await assert.rejects(validateReview(current), /Images not inspected/);
  current.review = structuredClone(original);
  current.review.cases[0].checks.pop();
  await assert.rejects(validateReview(current), /Missing\/duplicate check/);
  current.review = structuredClone(original);
  current.review.cases[0].checks[0].observation = "Looks good";
  await assert.rejects(validateReview(current), /Missing visual evidence/);
});

test("FAIL and UNCERTAIN block acceptance; invalid frame references cannot pass", async (t) => {
  const current = await fixture(t);
  for (const verdict of ["FAIL", "UNCERTAIN", "unknown"]) {
    current.review.cases[0].checks[0].verdict = verdict;
    await assert.rejects(validateReview(current), /Visual check not passed/);
  }
  current.review.cases[0].checks[0].verdict = "PASS";
  current.review.cases[0].checks[0].frames = ["unseen.png"];
  await assert.rejects(validateReview(current), /Missing visual evidence/);
});

test("rejects stale registry, missing review and wrong reviewer identity", async (t) => {
  const current = await fixture(t);
  await assert.rejects(
    validateReview({ ...current, review: null }),
    /Missing\/stale reviewer/,
  );
  current.review.reviewer = { model: "unrequested-model" };
  await assert.rejects(validateReview(current), /Wrong reviewer/);
  current.registry.actions[0].checks[0].instruction +=
    " Updated review instructions.";
  await assert.rejects(validateReview(current), /Stale registry/);
});

test("rejects vague contracts before any reviewer is dispatched", () => {
  const changed = structuredClone(registry);
  changed.actions[0].checks[0].instruction = "Looks good?";
  assert.throws(() => validateRegistry(changed), /Vague checks/);
});

test("requires inspection and hashes for every extra flight frame and native closeup", async (t) => {
  const current = await fixture(t);
  const source = current.input.captures[0].frames[1];
  await fs.copyFile(
    path.join(current.root, source.file),
    path.join(current.root, "flight.png"),
  );
  await fs.copyFile(
    path.join(current.root, source.file),
    path.join(current.root, "flight-closeup.png"),
  );
  current.input.captures[0].additionalFrames = [
    { ...source, stage: "flight+1", tick: 2.5, file: "flight.png" },
  ];
  current.input.captures[0].closeups = [
    {
      ...source,
      stage: "native-closeup",
      tick: 2.5,
      file: "flight-closeup.png",
      sourceFrame: "flight.png",
    },
  ];
  current.bundle = await buildBundle(current.input);
  current.review.bundleHash = current.bundle.bundleHash;
  await assert.rejects(validateReview(current), /Images not inspected/);
  current.review.cases[0].inspectedFrames.push(
    "flight.png",
    "flight-closeup.png",
  );
  assert.equal((await validateReview(current)).pass, true);
  await fs.appendFile(path.join(current.root, "flight.png"), "changed");
  await assert.rejects(validateReview(current), /Changed frame/);
});

test("rejects closeups not bound to the same-tick scene and out-of-order flight", async (t) => {
  const { input } = await fixture(t);
  const source = input.captures[0].frames[1];
  input.captures[0].closeups = [
    { ...source, tick: 99, file: "crop.png", sourceFrame: source.file },
  ];
  await assert.rejects(buildBundle(input), /Detached closeup/);
  input.captures[0].closeups = [];
  input.captures[0].additionalFrames = [
    { ...source, tick: 5 },
    { ...source, tick: 4 },
  ];
  await assert.rejects(buildBundle(input), /Nonsequential ticks/);
});
