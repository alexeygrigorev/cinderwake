import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const output = path.join(root, "quality-results", "quality-index");

async function readJson(relativePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function gitValue(args, fallback) {
  try {
    return (await run("git", args, { cwd: root })).stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function evidencePublicationParent() {
  const parent = await gitValue(["rev-parse", "HEAD^"], "");
  if (!parent) return null;
  const changedPaths = (
    await gitValue(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      "",
    )
  )
    .split("\n")
    .filter(Boolean);
  return changedPaths.length > 0 &&
    changedPaths.every((name) =>
      /^(quality-results\/(sequences|quality-index)\/)/.test(name),
    )
    ? parent
    : null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const [
  screens,
  sequences,
  actors,
  generation,
  environment,
  candidate,
  presentation,
  pose,
] = await Promise.all([
  readJson("quality-results/screens/index.json"),
  readJson("quality-results/sequences/index.json"),
  readJson("quality-results/actor-atlas-audit/report.json"),
  readJson("quality-results/generation-pipeline/report.json"),
  readJson("quality-results/environment-composition/report.json"),
  readJson(
    "quality-results/actor-candidate-calibration/ashfang-primary-trial-v9/report.json",
  ),
  readJson(
    "quality-results/actor-presentation/ashfang-uniform-transform-v1/report.json",
  ),
  readJson("quality-results/actor-pose/ashfang-idle-master-v1/report.json"),
]);

const sourceCommit = await gitValue(["rev-parse", "HEAD"], "unavailable");
const sourceStatus = await gitValue(["status", "--short"], "");
const publicationParentCommit = await evidencePublicationParent();
const sequenceProfiles = Array.isArray(sequences?.profiles)
  ? sequences.profiles
  : Array.isArray(sequences?.entries)
    ? sequences.entries
    : [];
const sequenceBindingRule =
  "Every retained sequence entry must record the current quality-index source commit (HEAD when this index is generated). The sole publication exception is HEAD's first parent when HEAD changes only quality-results/sequences/ or quality-results/quality-index/; this lets generated evidence and its index be committed together without requiring a report to contain its own future commit hash. The exception is one commit deep and ends after any non-evidence commit.";
const acceptedSequenceCommits = new Set(
  [sourceCommit, publicationParentCommit].filter(Boolean),
);
const staleSequenceProfiles = sequenceProfiles.filter(
  ({ sourceCommit: entryCommit }) =>
    !entryCommit || !acceptedSequenceCommits.has(entryCommit),
);
const sequenceMechanicsPass = sequenceProfiles.every(
  (entry) => entry.pass !== false && entry.status !== "failed",
);
const sequenceEvidenceFresh = staleSequenceProfiles.length === 0;
const candidateExpectedRejectionVerified = Boolean(
  candidate &&
  candidate.status === "fail" &&
  candidate.verificationStatus === "pass" &&
  candidate.expectation?.met === true &&
  candidate.expectation?.negativeControlsMet === true &&
  candidate.expectation?.recordedPreparationMet === true &&
  candidate.expectation?.visualReviewMet === true &&
  candidate.recordedPreparationVerdict === "rejected" &&
  candidate.recordedVisualReview?.verdict === "REJECT" &&
  candidate.recordedVisualReview?.reviewedPreparedSha256 ===
    candidate.candidate?.sha256 &&
  candidate.negativeControls?.every(({ detected }) => detected),
);

const reports = [
  {
    id: "screens",
    title: "Responsive screen acceptance",
    href: "screens/",
    status: screens?.status ?? "missing",
    summary:
      screens?.status === "rejected"
        ? "Machine checks pass, but an independent review rejects the exact hash-bound screen set."
        : (screens?.note ?? "No responsive screen report was generated."),
  },
  {
    id: "presentation",
    title: "Ashfang presentation transform search",
    href: "actor-presentation/ashfang-uniform-transform-v1/",
    status: presentation?.status ?? "missing",
    summary: presentation
      ? `${presentation.search.candidatesChecked} consistent foot-anchored transform envelopes searched, ${presentation.search.passingCandidates} passed, and ${presentation.negativeControls.filter(({ detected }) => detected).length}/${presentation.negativeControls.length} bad transforms were rejected. Production remains unchanged.`
      : "No actor-presentation transform report was generated.",
  },
  {
    id: "sequences",
    title: "Temporal scenario matrix",
    href: "sequences/",
    status:
      sequences && sequenceProfiles.length > 0
        ? sequenceMechanicsPass && sequenceEvidenceFresh
          ? "passed"
          : "failed"
        : "missing",
    summary:
      staleSequenceProfiles.length > 0
        ? `${sequenceProfiles.length} retained bundles; ${staleSequenceProfiles.length} cannot count as passing because their source commit is outside the current binding rule.`
        : `${sequenceProfiles.length} reproducible state, command, frame, mask, and manifest bundles are bound to the current source.`,
  },
  {
    id: "actors",
    title: "Complete actor atlas audit",
    href: "actor-atlas-audit/",
    status: actors ? (actors.pass ? "passed" : "failed") : "missing",
    summary: actors?.summary
      ? `${actors.summary.passingBanks}/${actors.summary.totalBanks} runtime banks and ${actors.summary.passingFacingComparisons}/${actors.summary.totalFacingComparisons} authored-facing comparisons pass; ${actors.summary.detectedNegativeControls}/${actors.summary.negativeControls} mutations are detected.`
      : "No actor atlas audit was generated.",
  },
  {
    id: "environment",
    title: "Environment composition",
    href: "environment-composition/",
    status:
      environment?.status === "pass"
        ? "passed"
        : (environment?.status ?? "missing"),
    summary: environment
      ? `${environment.negativeControls?.length ?? 0} paired mutations exercise real floor, decal, and gameplay-screen pixels.`
      : "No environment composition report was generated.",
  },
  {
    id: "generation",
    title: "Generation ingress provenance",
    href: "generation-pipeline/",
    status:
      generation?.status === "pass"
        ? "passed"
        : (generation?.status ?? "missing"),
    summary: generation?.summary
      ? `${generation.summary.rawRejected} raw trials are honestly rejected, ${generation.summary.preparedAcceptedForPipelineProof} prepared trial is accepted for pipeline proof, and ${generation.summary.freshProductionApproved} generated replacements are production-approved.`
      : "No generation ingress report was generated.",
  },
  {
    id: "candidate",
    title: "Ashfang candidate calibration",
    href: "actor-candidate-calibration/ashfang-primary-trial-v9/",
    status: candidate
      ? candidateExpectedRejectionVerified
        ? "rejected"
        : "failed"
      : "missing",
    summary: candidate
      ? `V9 ${candidateExpectedRejectionVerified ? "reproduces" : "does not reproduce"} the exact named ${candidate.expectation?.violations?.join(", ") || "mechanical"} rejection at a ${((candidate.assessment?.projectedRuntimeWithoutActorOverrides?.walkSupportContact?.persistentContactRatio ?? 0) * 100).toFixed(2)}% persistent-contact ratio against the ${((candidate.thresholds?.maximumPersistentWalkContactRatio ?? 0) * 100).toFixed(0)}% maximum, with ${candidate.negativeControls.filter(({ detected }) => detected).length}/${candidate.negativeControls.length} fixture-bound mutations and a matching exact-hash visual veto.`
      : "No actor-candidate calibration report was generated.",
  },
  {
    id: "pose",
    title: "Ashfang isolated idle-pose audit",
    href: "actor-pose/ashfang-idle-master-v1/",
    status: pose?.status === "rejected" ? "rejected" : "missing",
    summary: pose
      ? "REJECTED isolated-pose evidence: this single master is diagnostic only and cannot seed follow-up poses or count as production approval."
      : "No isolated Ashfang pose-audit report was generated.",
  },
  {
    id: "browser",
    title: "Browser interaction suite",
    href: "playwright/",
    status: "published-by-ci",
    summary:
      "Launch, touch, keyboard, navigation, collision, liveness, and rendering tests from the same commit.",
  },
];

const report = {
  schemaVersion: 2,
  project: "cinderwake",
  sourceCommit,
  sourceDirty: Boolean(sourceStatus),
  generatedAt: new Date().toISOString(),
  completionClaim: `${
    screens?.status === "accepted"
      ? "The exact responsive screen set is independently accepted; individual report limits still apply."
      : "No 10/10 or visual-completion claim: the current responsive screen set is not independently accepted."
  } Rejected isolated-pose evidence is diagnostic only and never production approval.`,
  sequenceEvidence: {
    bindingRule: sequenceBindingRule,
    currentCommit: sourceCommit,
    publicationParentCommit,
    total: sequenceProfiles.length,
    current: sequenceProfiles.filter(
      ({ sourceCommit: entryCommit }) => entryCommit === sourceCommit,
    ).length,
    publicationParent: publicationParentCommit
      ? sequenceProfiles.filter(
          ({ sourceCommit: entryCommit }) =>
            entryCommit === publicationParentCommit,
        ).length
      : 0,
    stale: staleSequenceProfiles.map(({ id, sourceCommit: entryCommit }) => ({
      id: id ?? "unnamed",
      sourceCommit: entryCommit ?? null,
    })),
  },
  reports,
};

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(output, "index.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const cards = reports
  .map(
    ({
      title,
      href,
      status,
      summary,
    }) => `<article data-status="${escapeHtml(status)}">
      <div class="status">${escapeHtml(status)}</div>
      <h2><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></h2>
      <p>${escapeHtml(summary)}</p>
    </article>`,
  )
  .join("\n");
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cinderwake quality evidence</title>
    <style>
      :root { color: #f3eadb; background: #090c0d; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { max-width: 1120px; margin: 0 auto; padding: 42px 20px 80px; }
      h1 { margin: 0 0 10px; font: 400 clamp(2.5rem, 7vw, 5.5rem) Georgia, serif; }
      .lead { max-width: 820px; color: #aebbb7; line-height: 1.65; }
      code { color: #d4b77b; }
      main { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr)); gap: 16px; margin-top: 32px; }
      article { min-height: 150px; padding: 20px; background: #121719; border: 1px solid #35413e; }
      article[data-status="rejected"], article[data-status="failed"] { border-color: #914e44; }
      article[data-status="passed"], article[data-status="accepted"] { border-color: #3f765f; }
      h2 { margin: 8px 0; font: 400 1.35rem Georgia, serif; }
      a { color: #f0c77d; }
      p { color: #aebbb7; line-height: 1.5; }
      .status { color: #dba35f; font: 700 .72rem ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
      footer { margin-top: 32px; color: #71817d; }
    </style>
  </head>
  <body>
    <h1>Quality evidence</h1>
    <p class="lead">${escapeHtml(report.completionClaim)} Each card links to the inspectable report produced from commit <code>${escapeHtml(sourceCommit)}</code>${sourceStatus ? "; this local index was built from a dirty worktree" : ""}. Passing mechanics never overrides a hash-matched visual rejection.</p>
    <p class="lead"><strong>Temporal evidence binding:</strong> ${escapeHtml(sequenceBindingRule)}</p>
    <main>${cards}</main>
    <footer><a href="../">Play Cinderwake</a> · <a href="index.json">Machine-readable index</a></footer>
  </body>
</html>`;
await fs.writeFile(path.join(output, "index.html"), html);
console.log(
  `Built public quality index with ${reports.length} evidence sections (${report.completionClaim})`,
);
