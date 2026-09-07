import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value) => hash(JSON.stringify(value));
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const unique = (values) => new Set(values).size === values.length;

/** Content identity survives documentation commits but changes with runtime or art. */
export async function runtimeFingerprint(root, roots) {
  const entries = [];
  async function visit(relative) {
    const absolute = path.resolve(root, relative);
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort())
        await visit(path.join(relative, name));
    } else entries.push([relative, hash(await fs.readFile(absolute))]);
  }
  for (const relative of [...roots].sort()) await visit(relative);
  return jsonHash(entries);
}

export function validateRegistry(registry) {
  requireCondition(
    registry?.schemaVersion === 1,
    "Unsupported action registry",
  );
  requireCondition(registry.actions?.length > 0, "Action registry is empty");
  for (const key of ["actors", "profiles", "directions", "sourceRoots"])
    requireCondition(
      registry[key]?.length > 0 && unique(registry[key]),
      `Invalid ${key}`,
    );
  requireCondition(
    unique(registry.actions.map(({ id }) => id)),
    "Duplicate action",
  );
  for (const action of registry.actions) {
    requireCondition(
      typeof action.id === "string" && action.id.length > 0,
      "Missing action id",
    );
    requireCondition(
      action.checks?.length > 0 && unique(action.checks.map(({ id }) => id)),
      `Missing/duplicate checks: ${action.id}`,
    );
    requireCondition(
      action.checks.every(
        ({ id, instruction }) =>
          id && typeof instruction === "string" && instruction.length > 30,
      ),
      `Vague checks: ${action.id}`,
    );
    requireCondition(
      action.stages?.length >= 2 && unique(action.stages),
      `Missing ordered stages: ${action.id}`,
    );
  }
  return registry;
}

export function requiredCases(registry, scope = {}) {
  validateRegistry(registry);
  const select = (key, all) => {
    const selected = scope[key] ?? all;
    requireCondition(
      selected.length > 0 &&
        unique(selected) &&
        selected.every((id) => all.includes(id)),
      `Unknown/empty scope ${key}`,
    );
    return selected;
  };
  const cases = [];
  for (const action of select(
    "actions",
    registry.actions.map(({ id }) => id),
  ))
    for (const actor of select("actors", registry.actors))
      for (const profile of select("profiles", registry.profiles))
        for (const direction of select("directions", registry.directions))
          cases.push({
            id: `${actor}/${action}/${direction}/${profile}`,
            actor,
            action,
            direction,
            profile,
          });
  return cases;
}

export async function buildBundle({
  registry,
  scope,
  captures,
  sourceFingerprint,
  root,
}) {
  const cases = requiredCases(registry, scope);
  requireCondition(unique(captures.map(({ id }) => id)), "Duplicate captures");
  const current = await runtimeFingerprint(root, registry.sourceRoots);
  requireCondition(
    sourceFingerprint === current,
    "Stale capture: runtime/assets changed; record again",
  );
  const entries = [];
  for (const expected of cases) {
    const capture = captures.find(({ id }) => id === expected.id);
    requireCondition(capture, `Missing action capture: ${expected.id}`);
    requireCondition(
      capture.automatic?.pass === true,
      `Automatic checks failed: ${expected.id}`,
    );
    requireCondition(
      typeof capture.automatic.evidence === "string",
      `Missing automatic evidence: ${expected.id}`,
    );
    const automaticHash = hash(
      await fs.readFile(path.resolve(root, capture.automatic.evidence)),
    );
    const action = registry.actions.find(({ id }) => id === expected.action);
    requireCondition(
      JSON.stringify(capture.frames?.map(({ stage }) => stage)) ===
        JSON.stringify(action.stages),
      `Missing/reordered stages: ${expected.id}`,
    );
    let previous = -Infinity;
    const frames = [];
    for (const frame of capture.frames) {
      requireCondition(
        Number.isFinite(frame.tick) && frame.tick > previous,
        `Nonsequential ticks: ${expected.id}`,
      );
      previous = frame.tick;
      requireCondition(
        typeof frame.file === "string" &&
          !path.isAbsolute(frame.file) &&
          !frame.file.split(/[\\/]/).includes(".."),
        "Frame path must stay inside project",
      );
      const data = await fs.readFile(path.resolve(root, frame.file));
      requireCondition(
        data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `Not a PNG: ${frame.file}`,
      );
      requireCondition(
        hash(data) === frame.sha256,
        `Changed frame: ${frame.file}`,
      );
      frames.push(frame);
    }
    entries.push({
      ...expected,
      expectation: capture.expectation,
      automatic: { ...capture.automatic, sha256: automaticHash },
      checks: action.checks,
      frames,
    });
  }
  const body = {
    schemaVersion: 1,
    registryHash: jsonHash(registry),
    sourceFingerprint,
    scope: scope ?? {},
    reviewer: registry.reviewer,
    cases: entries,
  };
  return { ...body, bundleHash: jsonHash(body) };
}

export function reviewPrompt(bundle) {
  return `Inspect these game action images with visual tools. Preferred reviewer: ${bundle.reviewer.model}. This is a scoped visual review, not whole-game approval.
You MUST open every listed PNG at original resolution using view_image or equivalent image input. Reading filenames, source code, JSON or automatic PASS results is not image inspection. The recorded input defines expected direction; independently identify the visible tip/front and compare it to motion. Do not infer visual correctness from metadata.
For each case inspect frames in listed order: windup, release/impact, recovery (or that action's named stages). Compare adjacent frames. Zoom where needed without smoothing. If an arrow or effect is too small, obscured, absent or lacks enough consecutive flight frames to judge its heading, mark the relevant check UNCERTAIN and request a closer/denser capture. Do not guess or pass missing evidence.
For EACH check return PASS, FAIL or UNCERTAIN with a concrete observation and the exact supporting frame paths. FAIL or UNCERTAIN blocks acceptance. Mention backwards arrows, sideways flight, inconsistent flips, wrong emission points, detached effects, clipping, sliding or discontinuous recovery when present. Do not change code or images.
Return JSON only with schemaVersion:1, bundleHash:${JSON.stringify(bundle.bundleHash)}, reviewer:{model:${JSON.stringify(bundle.reviewer.model)}}, and cases:[{id, inspectedFrames:[every frame path], checks:[{id,verdict,observation,frames:[supporting paths]}]}]. Every case and check is required; no blanket verdict.
Cases and precise instructions:
${JSON.stringify(bundle.cases, null, 2)}\n`;
}

export async function validateReview({ bundle, review, registry, root }) {
  const { bundleHash, ...body } = bundle;
  requireCondition(bundleHash === jsonHash(body), "Changed bundle");
  requireCondition(
    bundle.registryHash === jsonHash(validateRegistry(registry)),
    "Stale registry; rebuild review bundle",
  );
  const required = requiredCases(registry, bundle.scope);
  requireCondition(
    unique(bundle.cases.map(({ id }) => id)) &&
      bundle.cases.length === required.length &&
      required.every(({ id }) => bundle.cases.some((entry) => entry.id === id)),
    "Missing/duplicate bundle cases",
  );
  requireCondition(
    bundle.sourceFingerprint ===
      (await runtimeFingerprint(root, registry.sourceRoots)),
    "Stale review: runtime/assets changed",
  );
  requireCondition(
    review?.schemaVersion === 1 && review.bundleHash === bundleHash,
    "Missing/stale reviewer result",
  );
  requireCondition(
    review.reviewer?.model === bundle.reviewer.model,
    "Wrong reviewer model",
  );
  requireCondition(
    Array.isArray(review.cases) &&
      unique(review.cases.map(({ id }) => id)) &&
      review.cases.length === bundle.cases.length,
    "Missing/duplicate review cases",
  );
  for (const expected of bundle.cases) {
    requireCondition(
      hash(
        await fs.readFile(path.resolve(root, expected.automatic.evidence)),
      ) === expected.automatic.sha256,
      `Changed automatic evidence: ${expected.id}`,
    );
    const actual = review.cases.find(({ id }) => id === expected.id);
    requireCondition(actual, `Missing case review: ${expected.id}`);
    const paths = expected.frames.map(({ file }) => file);
    requireCondition(
      Array.isArray(actual.inspectedFrames) &&
        unique(actual.inspectedFrames) &&
        actual.inspectedFrames.length === paths.length &&
        paths.every((file) => actual.inspectedFrames.includes(file)),
      `Images not inspected: ${expected.id}`,
    );
    for (const frame of expected.frames)
      requireCondition(
        hash(await fs.readFile(path.resolve(root, frame.file))) ===
          frame.sha256,
        `Changed frame: ${frame.file}`,
      );
    requireCondition(
      Array.isArray(actual.checks) &&
        unique(actual.checks.map(({ id }) => id)) &&
        actual.checks.length === expected.checks.length,
      `Missing/duplicate check verdicts: ${expected.id}`,
    );
    for (const check of expected.checks) {
      const result = actual.checks.find(({ id }) => id === check.id);
      requireCondition(
        result?.verdict === "PASS",
        `Visual check not passed: ${expected.id}/${check.id} (${result?.verdict ?? "missing"})`,
      );
      requireCondition(
        typeof result.observation === "string" &&
          result.observation.trim().length >= 25 &&
          result.frames?.length > 0 &&
          result.frames.every((file) => paths.includes(file)),
        `Missing visual evidence: ${expected.id}/${check.id}`,
      );
    }
  }
  return { pass: true, cases: bundle.cases.length, scope: bundle.scope };
}
