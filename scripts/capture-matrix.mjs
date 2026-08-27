import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isReusableMatrixEntry,
  mergeMatrixEntries,
  pendingMatrixEntry,
  selectMatrixEntryIds,
} from "./lib/capture-matrix.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

const entries = [
  {
    id: "locomotion-east",
    label: "Ranger locomotion · east · full cycle",
    category: "locomotion",
    scenario: "animation-walk",
    action: "move-east",
    track: "player",
    profile: "anchored-motion",
    frames: 21,
    step: 2,
  },
  ...[
    ["west", "move-west"],
    ["north", "move-north"],
    ["south", "move-south"],
  ].map(([direction, action]) => ({
    id: `locomotion-${direction}`,
    label: `Ranger locomotion · ${direction}`,
    category: "locomotion",
    scenario: "animation-walk",
    action,
    track: "player",
    profile: "anchored-motion",
    frames: 9,
    step: 3,
  })),
  {
    id: "locomotion-mobile-interpolated",
    label: "Mobile locomotion · quarter-tick presentation",
    category: "mobile and interpolation",
    scenario: "animation-walk",
    action: "move-east",
    track: "player",
    profile: "anchored-motion",
    frames: 9,
    step: 1,
    subframes: 4,
    viewportWidth: 390,
    viewportHeight: 844,
    mobile: true,
  },
  ...[
    {
      id: "ashfang-start-stop-east",
      label: "Ashfang · idle, east walk loop, idle recovery",
      scenario: "ashfang-start-stop-east",
      track: "monster:start-stop-ashfang",
    },
    {
      id: "arcanist-start-stop-east",
      label: "Arcanist · idle, east walk loop, idle recovery",
      scenario: "arcanist-start-stop-east",
      track: "player",
    },
  ].map((entry) => ({
    ...entry,
    category: "clip transitions",
    action: "idle",
    profile: "start-stop",
    frames: 37,
    step: 5,
    commandsFile: `tests/fixtures/sequences/${entry.id}.commands.json`,
  })),
  ...[
    ["vanguard-primary", "attack", 16],
    ["vanguard-ability", "ability", 20],
    ["ranger-primary", "attack", 16],
    ["ranger-ability", "ability", 20],
    ["arcanist-primary", "attack", 16],
    ["arcanist-ability", "ability", 20],
  ].map(([name, action, frames]) => ({
    id: `hero-${name}`,
    label: `Hero action · ${name}`,
    category: "hero actions",
    scenario: `temporal-${name}`,
    action,
    track: "player",
    profile: "one-shot",
    frames,
    step: 2,
  })),
  {
    id: "hero-ranger-primary-north",
    label: "Hero action · Ranger primary · authored north",
    category: "hero directional actions",
    scenario: "temporal-ranger-primary-north",
    action: "attack",
    track: "player",
    profile: "one-shot",
    frames: 16,
    step: 2,
  },
  {
    id: "hero-arcanist-ability-south",
    label: "Hero action · Arcanist ability · authored south",
    category: "hero directional actions",
    scenario: "temporal-arcanist-ability-south",
    action: "ability",
    track: "player",
    profile: "one-shot",
    frames: 20,
    step: 2,
  },
  {
    id: "enemy-ashfang-attack",
    label: "Ashfang · wind-up, contact, recovery",
    category: "enemy actions",
    scenario: "temporal-ashfang-attack",
    action: "idle",
    track: "monster:temporal-ashfang",
    profile: "one-shot",
    frames: 20,
    step: 2,
  },
  {
    id: "enemy-stonekin-attack",
    label: "Stonekin · wind-up, contact, recovery",
    category: "enemy actions",
    scenario: "temporal-stonekin-attack",
    action: "idle",
    track: "monster:temporal-stonekin",
    profile: "one-shot",
    frames: 20,
    step: 2,
  },
  {
    id: "enemy-hexer-attack",
    label: "Hexer · floating wind-up, contact, recovery",
    category: "enemy actions",
    scenario: "temporal-hexer-attack",
    action: "idle",
    track: "monster:temporal-hexer",
    profile: "one-shot-floating",
    frames: 36,
    step: 2,
  },
  {
    id: "enemy-death-lifecycle",
    label: "Enemy death · terminal frame and despawn",
    category: "lifecycles",
    scenario: "temporal-enemy-death",
    action: "idle",
    track: "monster:temporal-death",
    profile: "death",
    presence: "present-until",
    frames: 26,
    step: 2,
  },
  {
    id: "friendly-projectile-travel",
    label: "Friendly projectile · continuous travel",
    category: "world dynamics",
    scenario: "temporal-friendly-projectile",
    action: "idle",
    track: "projectile:temporal-friendly",
    profile: "projectile",
    frames: 31,
    step: 2,
  },
  {
    id: "friendly-projectile-impact",
    label: "Friendly projectile · hit effect and despawn",
    category: "world dynamics",
    scenario: "temporal-friendly-projectile-impact",
    action: "idle",
    track: "projectile:temporal-friendly-impact",
    profile: "projectile",
    presence: "present-until",
    frames: 22,
    step: 1,
  },
  {
    id: "loot-bob-cycle",
    label: "Loot · complete 48-tick bob cycle",
    category: "world dynamics",
    scenario: "temporal-loot-bob",
    action: "idle",
    track: "loot:temporal-gold",
    profile: "loop",
    frames: 25,
    step: 2,
  },
  {
    id: "camera-smooth-follow",
    label: "Camera · deterministic smooth convergence",
    category: "camera",
    scenario: "temporal-camera-track",
    action: "idle",
    track: "player",
    profile: "camera-smooth",
    frames: 31,
    step: 2,
  },
  {
    id: "city-entry",
    label: "World transition · wilderness gate into Embercross",
    category: "world transitions",
    scenario: "temporal-city-entry",
    action: "idle",
    track: "player",
    profile: "static-pose",
    frames: 6,
    step: 2,
  },
  {
    id: "outcome-win",
    label: "Outcome · win overlay and frozen state",
    category: "outcomes",
    scenario: "temporal-run-win",
    action: "idle",
    track: "player",
    profile: "static-pose",
    frames: 6,
    step: 2,
  },
  {
    id: "outcome-loss",
    label: "Outcome · loss overlay and death presentation",
    category: "outcomes",
    scenario: "temporal-run-loss",
    action: "idle",
    track: "player",
    profile: "static-pose",
    frames: 14,
    step: 4,
    // The loss overlay retains the defeated player's terminal body; the
    // present-until contract belongs to despawning enemy/projectile strips.
    presence: "always",
  },
];

function captureArguments(entry) {
  return [
    "scripts/capture-sequence.mjs",
    "--id",
    entry.id,
    "--scenario",
    entry.scenario,
    "--action",
    entry.action,
    "--track",
    entry.track,
    "--profile",
    entry.profile,
    "--presence",
    entry.presence ?? "always",
    "--frames",
    String(entry.frames),
    "--step",
    String(entry.step),
    "--subframes",
    String(entry.subframes ?? 1),
    "--viewport-width",
    String(entry.viewportWidth ?? 1440),
    "--viewport-height",
    String(entry.viewportHeight ?? 900),
    ...(entry.mobile ? ["--mobile", "true"] : []),
    ...(entry.commandsFile ? ["--commands-file", entry.commandsFile] : []),
  ];
}

function runCapture(entry) {
  const child = spawn(process.execPath, captureArguments(entry), {
    stdio: "inherit",
  });
  return new Promise((resolve) => child.on("exit", resolve));
}

function currentSource() {
  const commit =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  });
  const patch = execFileSync("git", ["diff", "--binary", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    commit,
    dirty: status.trim().length > 0,
    patchSha256: createHash("sha256").update(patch).digest("hex"),
  };
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function hasRequiredArtifacts(directory) {
  for (const file of [
    "metadata.json",
    "commands.json",
    "states.json",
    "render-manifest-timeline.json",
    "animation-analysis.json",
    "contact-sheet.png",
    "report.html",
  ]) {
    try {
      await fs.access(path.join(directory, file));
    } catch {
      return false;
    }
  }
  return true;
}

async function retainedHref(directory, fileName, href) {
  try {
    await fs.access(path.join(directory, fileName));
    return href;
  } catch {
    return null;
  }
}

const outputRoot = path.resolve("quality-results/sequences");
await fs.mkdir(outputRoot, { recursive: true });
const source = currentSource();
const onlyValue = option("only", null);
const resume = process.argv.includes("--resume");
const selectedIds = new Set(
  selectMatrixEntryIds(
    entries.map(({ id }) => id),
    onlyValue,
  ),
);
const previousCatalog = await readJsonIfPresent(
  path.join(outputRoot, "index.json"),
);
const previousEntries = previousCatalog?.entries ?? [];
const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
const reusableIds = new Set();
if (resume) {
  for (const entry of entries) {
    if (!selectedIds.has(entry.id)) continue;
    const directory = path.join(outputRoot, entry.id);
    const analysis = await readJsonIfPresent(
      path.join(directory, "animation-analysis.json"),
    );
    const metadata = await readJsonIfPresent(
      path.join(directory, "metadata.json"),
    );
    if (
      isReusableMatrixEntry({
        catalogEntry: previousById.get(entry.id),
        analysisPass: analysis?.pass === true,
        metadata,
        requiredFilesPresent: await hasRequiredArtifacts(directory),
        expectedCaptureId: entry.id,
        source,
      })
    )
      reusableIds.add(entry.id);
  }
}

const initialEntries = entries.map((entry) => {
  const previous = previousById.get(entry.id);
  if (!selectedIds.has(entry.id)) return previous ?? pendingMatrixEntry(entry);
  if (reusableIds.has(entry.id)) return previous;
  return pendingMatrixEntry(entry);
});
const resultById = new Map(initialEntries.map((entry) => [entry.id, entry]));
const writeCatalog = async () => {
  const results = mergeMatrixEntries(entries, [], [...resultById.values()]);
  const catalog = {
    schemaVersion: 1,
    project: "Cinderwake",
    pass: results.every(({ pass }) => pass),
    total: results.length,
    passed: results.filter(({ pass }) => pass).length,
    entries: results,
  };
  const temporaryFile = path.join(outputRoot, "index.json.tmp");
  await fs.writeFile(temporaryFile, `${JSON.stringify(catalog, null, 2)}\n`);
  await fs.rename(temporaryFile, path.join(outputRoot, "index.json"));
  return catalog;
};
await writeCatalog();

for (const entry of entries) {
  if (!selectedIds.has(entry.id)) continue;
  if (reusableIds.has(entry.id)) {
    console.log(`\n[quality matrix] ${entry.id} (retained)`);
    continue;
  }
  console.log(`\n[quality matrix] ${entry.id}`);
  const exitCode = await runCapture(entry);
  const directory = path.join(outputRoot, entry.id);
  const analysis = await readJsonIfPresent(
    path.join(directory, "animation-analysis.json"),
  );
  const metadata = await readJsonIfPresent(
    path.join(directory, "metadata.json"),
  );
  const report = await retainedHref(
    directory,
    "report.html",
    `${entry.id}/report.html`,
  );
  const contactSheet = await retainedHref(
    directory,
    "contact-sheet.png",
    `${entry.id}/contact-sheet.png`,
  );
  resultById.set(entry.id, {
    id: entry.id,
    label: entry.label,
    category: entry.category,
    scenario: entry.scenario,
    trackedEntityId: entry.track,
    profile: entry.profile,
    pass: exitCode === 0 && analysis?.pass === true,
    checks: analysis?.checks ?? {},
    measurements: analysis?.measurements ?? {},
    clipTransitionContract: analysis?.clipTransitionContract ?? null,
    negativeControls: analysis?.negativeControls ?? [],
    sourceCommit: metadata?.sourceCommit ?? null,
    report,
    contactSheet,
    metadata: `${entry.id}/metadata.json`,
    analysis: `${entry.id}/animation-analysis.json`,
  });
  const progress = await writeCatalog();
  console.log(
    `[quality matrix] progress ${progress.passed}/${progress.total} sequences passed`,
  );
}

const catalog = await writeCatalog();
console.log(
  `\n[quality matrix] ${catalog.passed}/${catalog.total} sequences passed`,
);
if (!catalog.pass) process.exitCode = 1;
