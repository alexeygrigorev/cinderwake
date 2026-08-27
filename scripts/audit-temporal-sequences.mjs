import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  TEMPORAL_LIVE_ACTOR_IDS,
  TEMPORAL_LIVE_PROFILE_IDS,
  runTemporalSequenceNegativeControls,
  validateOrdinaryRouteTemporalStrips,
  validateTemporalSequenceCatalog,
} from "./lib/temporal-sequence-evidence.mjs";
import { runTemporalProductionPixelNegativeControls } from "./lib/temporal-pixel-evidence.mjs";

const ROOT = process.cwd();
const SEQUENCE_ROOT = path.join(ROOT, "quality-results", "sequences");
const FLICKER_ROOT = path.join(
  ROOT,
  "quality-results",
  "compositor",
  "pres-flicker-024",
);
const REPORT_ROOT = path.join(
  ROOT,
  "quality-results",
  "temporal-sequence-audit",
);
const EMPTY_PATCH_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function currentSource() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const patch = execFileSync("git", ["diff", "--binary", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    commit,
    dirty: status.trim().length > 0,
    patchSha256: sha256(patch),
    status: status.trim().split("\n").filter(Boolean),
  };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function inspectEntry(entry, source) {
  const directory = path.join(SEQUENCE_ROOT, entry.id);
  const metadata = await readJson(path.join(directory, "metadata.json"));
  const requiredFiles = [
    "commands.json",
    "states.json",
    "render-manifest-timeline.json",
    "animation-analysis.json",
    "contact-sheet.png",
    "report.html",
  ];
  const missingFiles = [];
  for (const file of requiredFiles) {
    try {
      await fs.access(path.join(directory, file));
    } catch {
      missingFiles.push(file);
    }
  }
  const sourceMatches =
    metadata.sourceCommit === source.commit &&
    metadata.sourceDirty === false &&
    metadata.sourcePatchSha256 === EMPTY_PATCH_SHA256;
  return {
    id: entry.id,
    sourceCommit: metadata.sourceCommit ?? null,
    sourceDirty: metadata.sourceDirty ?? null,
    sourcePatchSha256: metadata.sourcePatchSha256 ?? null,
    sourceMatches,
    missingFiles,
    pass: entry.pass === true && sourceMatches && missingFiles.length === 0,
  };
}

async function inspectOrdinaryRoute(source) {
  const metadata = await readJson(path.join(FLICKER_ROOT, "metadata.json"));
  const timeline = await readJson(path.join(FLICKER_ROOT, "timeline.json"));
  const sourceMatches =
    metadata.source?.commit === source.commit &&
    metadata.source?.dirty === false &&
    metadata.source?.patchSha256 === EMPTY_PATCH_SHA256;
  const validation = validateOrdinaryRouteTemporalStrips({
    profiles: timeline.liveProfiles,
  });
  const artifactIntegrityErrors = [];
  const selectedFrames = [];
  for (const profile of timeline.liveProfiles ?? []) {
    for (const actor of profile.actors ?? []) {
      for (const artifact of actor.frameArtifacts ?? []) {
        const file = path.join(FLICKER_ROOT, artifact.file);
        try {
          const bytes = await fs.readFile(file);
          const actualHash = sha256(bytes);
          if (actualHash !== artifact.sha256)
            artifactIntegrityErrors.push({
              profileId: profile.id,
              actorId: actor.actorId,
              file: artifact.file,
              expected: artifact.sha256,
              actual: actualHash,
            });
          if (profile.id === "desktop-60hz" && actor.actorId === "vanguard")
            selectedFrames.push(bytes);
        } catch {
          artifactIntegrityErrors.push({
            profileId: profile.id,
            actorId: actor.actorId,
            file: artifact.file,
            missing: true,
          });
        }
      }
      for (const artifact of Object.values(actor.videoArtifacts ?? {})) {
        const file = path.join(FLICKER_ROOT, artifact.file);
        try {
          const bytes = await fs.readFile(file);
          const actualHash = sha256(bytes);
          if (actualHash !== artifact.sha256)
            artifactIntegrityErrors.push({
              profileId: profile.id,
              actorId: actor.actorId,
              file: artifact.file,
              expected: artifact.sha256,
              actual: actualHash,
            });
        } catch {
          artifactIntegrityErrors.push({
            profileId: profile.id,
            actorId: actor.actorId,
            file: artifact.file,
            missing: true,
          });
        }
      }
    }
  }
  if (selectedFrames.length !== 5)
    artifactIntegrityErrors.push({
      profileId: "desktop-60hz",
      actorId: "vanguard",
      expectedFrameCount: 5,
      actualFrameCount: selectedFrames.length,
    });
  return {
    sourceMatches,
    validation,
    artifactIntegrityErrors,
    selectedFrames,
    pass:
      sourceMatches && validation.pass && artifactIntegrityErrors.length === 0,
    expectedProfileIds: TEMPORAL_LIVE_PROFILE_IDS,
    expectedActorIds: TEMPORAL_LIVE_ACTOR_IDS,
  };
}

function reportHtml(report) {
  const signals = report.comparison.signals
    .map(
      ({ id, pass, detail }) =>
        `<li class="${pass ? "pass" : "fail"}"><strong>${pass ? "PASS" : "FAIL"}</strong> · ${htmlEscape(id)} · ${htmlEscape(JSON.stringify(detail))}</li>`,
    )
    .join("\n");
  const controls = report.negativeControls
    .map(
      ({ id, signal, status }) =>
        `<li class="${status === "DETECTED" ? "pass" : "fail"}"><strong>${htmlEscape(status)}</strong> · ${htmlEscape(id)} · ${htmlEscape(signal)}</li>`,
    )
    .join("\n");
  const entries = report.entries
    .map(
      (entry) =>
        `<li class="${entry.pass ? "pass" : "fail"}"><strong>${entry.pass ? "PASS" : "FAIL"}</strong> · <a href="../sequences/${htmlEscape(entry.id)}/contact-sheet.png">${htmlEscape(entry.id)}</a> · source ${htmlEscape(entry.sourceCommit ?? "missing")}</li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cinderwake temporal sequence audit</title>
<style>:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111719;color:#e9e0d1}body{max-width:1200px;margin:auto;padding:24px}h1,h2{color:#f3c889}.summary{padding:14px;border-left:4px solid #e0a85b;background:#272218}.pass{color:#83d39a}.fail{color:#ed796f}li{margin:6px 0}code{overflow-wrap:anywhere;color:#c9e6ed}a{color:#9fd6e4}</style></head>
<body><h1>Real-time animation and compositing audit</h1><p class="summary"><strong class="${report.pass ? "pass" : "fail"}">${report.pass ? "PASS" : "FAIL"}</strong> · ${report.summary.passingEntries}/${report.summary.expectedEntries} retained matrix entries pass · ${report.negativeControls.length}/${report.negativeControls.length} mutation controls detected.</p>
<p>Commit <code>${htmlEscape(report.source.commit)}</code> · source dirty <code>${htmlEscape(report.source.dirty)}</code> · catalog <code>${htmlEscape(report.summary.catalogSha256)}</code>. The matrix remains a machine gate; the linked strips and reports retain independent visual-review authority.</p>
<h2>Evaluator signals</h2><ul>${signals}</ul><h2>Negative controls</h2><ul>${controls}</ul><h2>Retained sequence matrix</h2><ul>${entries}</ul>
<p>Reproduce with <code>npm run capture:matrix &amp;&amp; npm run quality:temporal:check</code>. <a href="comparison.json">comparison JSON</a> · <a href="report.json">complete report JSON</a>.</p></body></html>
`;
}

const source = currentSource();
const catalog = await readJson(path.join(SEQUENCE_ROOT, "index.json"));
const assessment = validateTemporalSequenceCatalog(catalog);
const semanticNegativeControls = runTemporalSequenceNegativeControls();
const ordinaryRoute = await inspectOrdinaryRoute(source);
const negativeControls = await runTemporalProductionPixelNegativeControls(
  ordinaryRoute.selectedFrames,
);
const entries = await Promise.all(
  (catalog.entries ?? []).map((entry) => inspectEntry(entry, source)),
);
const sourcePass =
  source.dirty === false &&
  source.patchSha256 === EMPTY_PATCH_SHA256 &&
  entries.every(
    ({ sourceMatches, missingFiles }) =>
      sourceMatches && missingFiles.length === 0,
  );
const comparison = {
  pass:
    assessment.pass &&
    sourcePass &&
    ordinaryRoute.pass &&
    semanticNegativeControls.every(({ status }) => status === "DETECTED") &&
    negativeControls.every(({ status }) => status === "DETECTED"),
  signals: [
    ...assessment.signals,
    {
      ...ordinaryRoute.validation.signal,
      pass: ordinaryRoute.pass,
      detail: {
        ...ordinaryRoute.validation.signal.detail,
        sourceMatches: ordinaryRoute.sourceMatches,
        artifactIntegrityErrors: ordinaryRoute.artifactIntegrityErrors,
      },
    },
    {
      id: "production-compositor-pixel-mutations",
      pass: negativeControls.every(({ status }) => status === "DETECTED"),
      detail: {
        controls: negativeControls,
        sourceFrameCount: ordinaryRoute.selectedFrames.length,
      },
    },
  ],
};
const report = {
  schemaVersion: 1,
  checkId: "PRES-MOTION-005",
  recipeId: "recipe:pres-motion-005",
  evaluator: "temporal-sequence-assessor-v1",
  pass: comparison.pass,
  source,
  summary: {
    expectedEntries: assessment.summary.expectedEntries,
    actualEntries: assessment.summary.actualEntries,
    passingEntries: entries.filter(({ pass }) => pass).length,
    catalogSha256: sha256(
      await fs.readFile(path.join(SEQUENCE_ROOT, "index.json")),
    ),
    deviceProfiles: assessment.summary.deviceProfiles,
    scenarioCoverage: assessment.summary.scenarioCoverage,
    ordinaryRoute: {
      pass: ordinaryRoute.pass,
      expectedProfileIds: ordinaryRoute.expectedProfileIds,
      expectedActorIds: ordinaryRoute.expectedActorIds,
      strips: ordinaryRoute.validation.summary,
      artifactIntegrityErrors: ordinaryRoute.artifactIntegrityErrors,
    },
  },
  comparison,
  negativeControls,
  semanticNegativeControls,
  ordinaryRoute: {
    pass: ordinaryRoute.pass,
    validation: ordinaryRoute.validation,
    artifactIntegrityErrors: ordinaryRoute.artifactIntegrityErrors,
  },
  entries,
  catalog: {
    path: "quality-results/sequences/index.json",
    pass: catalog.pass,
    total: catalog.total,
    passed: catalog.passed,
  },
};
const metadata = {
  schemaVersion: 1,
  checkId: report.checkId,
  recipeId: report.recipeId,
  evaluator: report.evaluator,
  scenarioIds: [
    ...TEMPORAL_LIVE_ACTOR_IDS.map(
      (actorId) => `ordinary-live-idle-move-turn-attack:${actorId}`,
    ),
    "animation-walk",
    "all-temporal-hero-actions",
    "all-temporal-enemy-actions",
    "temporal-enemy-death",
  ],
  profileIds: ["desktop", "phone-portrait"],
  gestureIds: [
    "capture-matrix-command-tapes",
    "ordinary-live-idle-move-turn-attack",
  ],
  source,
  environment: { catalogSha256: report.summary.catalogSha256 },
  reproductionCommand:
    "npm run test:flicker && npm run capture:matrix && npm run quality:temporal:check",
};
await fs.mkdir(REPORT_ROOT, { recursive: true });
await Promise.all([
  fs.writeFile(
    path.join(REPORT_ROOT, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  ),
  fs.writeFile(
    path.join(REPORT_ROOT, "comparison.json"),
    `${JSON.stringify({ ...report, metadata }, null, 2)}\n`,
  ),
  fs.writeFile(
    path.join(REPORT_ROOT, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  fs.writeFile(path.join(REPORT_ROOT, "index.html"), reportHtml(report)),
]);
console.log(
  `${report.pass ? "PASS" : "FAIL"} ${report.summary.passingEntries}/${report.summary.expectedEntries} temporal entries, ${negativeControls.length}/${negativeControls.length} negative controls; quality-results/temporal-sequence-audit`,
);
if (!report.pass) process.exitCode = 1;
