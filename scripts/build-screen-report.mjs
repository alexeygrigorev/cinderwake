import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const snapshotRoot = path.join(
  root,
  "tests",
  "e2e",
  "screen-contract.spec.ts-snapshots",
);
const outputRoot = path.join(root, "quality-results", "screens");
const contractPath = path.join(root, "quality", "screen-contract.v1.json");
const reviewPath = path.join(root, "quality", "screen-review.v1.json");
const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function gitValue(args, fallback) {
  try {
    return (await run("git", args, { cwd: root })).stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

const names = (await fs.readdir(snapshotRoot))
  .filter((name) => name.endsWith("-chromium-linux.png"))
  .sort();
const expectedCount = contract.profiles.length * 4;
if (names.length !== expectedCount)
  throw new Error(
    `Screen report expected ${expectedCount} PNGs, found ${names.length}`,
  );

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "images"), { recursive: true });
const entries = [];
for (const name of names) {
  const source = path.join(snapshotRoot, name);
  const bytes = await fs.readFile(source);
  const cleanName = name.replace("-chromium-linux", "");
  await fs.copyFile(source, path.join(outputRoot, "images", cleanName));
  const profile = contract.profiles.find(({ id }) => name.startsWith(`${id}-`));
  if (!profile) throw new Error(`No screen profile matches ${name}`);
  const suffix = name.slice(profile.id.length + 1);
  const screen = suffix.startsWith("game-") ? "game" : "selection";
  const subject =
    screen === "game"
      ? "initial public run"
      : suffix.replace("selection-", "").replace("-chromium-linux.png", "");
  entries.push({
    profile: profile.id,
    viewport: profile.viewport,
    touch: profile.touch,
    screen,
    subject,
    file: `images/${cleanName}`,
    sha256: sha256(bytes),
  });
}

const sourceCommit = await gitValue(["rev-parse", "HEAD"], "unavailable");
const sourceStatus = await gitValue(["status", "--short"], "");
const contractSha256 = sha256(await fs.readFile(contractPath));
const snapshotSetSha256 = sha256(
  Buffer.from(
    JSON.stringify(
      entries.map(({ file, sha256: imageSha256 }) => ({
        file,
        sha256: imageSha256,
      })),
    ),
  ),
);
let review = null;
try {
  review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const reviewMatches = Boolean(
  review &&
  review.schemaVersion === 1 &&
  review.project === contract.project &&
  review.verdict === "ACCEPT" &&
  review.contractSha256 === contractSha256 &&
  review.snapshotSetSha256 === snapshotSetSha256,
);
const status = reviewMatches ? "accepted" : "candidate";
const report = {
  schemaVersion: 1,
  project: contract.project,
  status,
  note: reviewMatches
    ? "Machine checks and the hash-bound independent visual review accepted this exact screen set."
    : "Machine checks passed; screenshot candidates still require a matching independent visual review.",
  contractSha256,
  snapshotSetSha256,
  sourceCommit,
  sourceDirty: Boolean(sourceStatus),
  review: review
    ? {
        ...review,
        hashesMatch: reviewMatches,
      }
    : null,
  entries,
};
await fs.writeFile(
  path.join(outputRoot, "index.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (review)
  await fs.writeFile(
    path.join(outputRoot, "review.json"),
    `${JSON.stringify(report.review, null, 2)}\n`,
  );

const cards = entries
  .map(
    (entry) => `
      <figure>
        <a href="${escapeHtml(entry.file)}"><img src="${escapeHtml(entry.file)}" alt="${escapeHtml(`${entry.profile} ${entry.screen} ${entry.subject}`)}"></a>
        <figcaption><strong>${escapeHtml(entry.profile)}</strong> · ${escapeHtml(entry.screen)} · ${escapeHtml(entry.subject)}<small>${entry.viewport.width} × ${entry.viewport.height} · ${entry.touch ? "touch" : "pointer"}<br><code>${entry.sha256.slice(0, 16)}</code></small></figcaption>
      </figure>`,
  )
  .join("");
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cinderwake screen candidates</title>
    <style>
      :root { color: #f4ead6; background: #080b0d; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0 auto; max-width: 1500px; padding: 40px 20px 80px; }
      h1 { margin-bottom: 8px; font: 400 clamp(2.4rem, 7vw, 5rem) Georgia, serif; }
      p { max-width: 850px; color: #aebbb7; line-height: 1.65; }
      .status { color: #e3b760; font: 700 0.78rem ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
      main { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 18px; margin-top: 32px; align-items: start; }
      figure { margin: 0; padding: 8px; background: #111719; border: 1px solid #34413e; }
      img { display: block; width: 100%; height: auto; background: #000; }
      figcaption { padding: 10px 4px 4px; color: #c7d0cc; }
      strong { color: #f0c77d; }
      small { display: block; margin-top: 5px; color: #788984; line-height: 1.5; }
      code { color: #9bb5ad; }
    </style>
  </head>
  <body>
    <div class="status">${reviewMatches ? "Accepted · independent review matched" : "Candidate · never auto-promoted"}</div>
    <h1>Screen acceptance matrix</h1>
    <p>These are the exact PNG candidates exercised by the public-route screen contract: four viewport/input profiles, every hero selection, and initial gameplay. Geometry, decode, hit testing, console errors, stage coverage, authored character landmarks, real-canvas terrain pixels, and paired assessor mutations pass before this gallery is produced. ${reviewMatches ? "An independent reviewer accepted these exact image and contract hashes at actual play size." : "Appearance still requires a matching independent review at actual size."}</p>
    <p>Commit <code>${escapeHtml(sourceCommit)}</code>${sourceStatus ? " · dirty source was bundled by the local generator" : " · clean CI source"} · contract <code>${report.contractSha256.slice(0, 16)}</code> · screen set <code>${snapshotSetSha256.slice(0, 16)}</code>${review ? ' · <a href="review.json">review record</a>' : ""}</p>
    <main>${cards}
    </main>
  </body>
</html>
`;
await fs.writeFile(path.join(outputRoot, "index.html"), html);
console.log(`Built ${status} screen report with ${entries.length} images.`);
