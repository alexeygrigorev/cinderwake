import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

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
  ];
}

function runCapture(entry) {
  const child = spawn(process.execPath, captureArguments(entry), {
    stdio: "inherit",
  });
  return new Promise((resolve) => child.on("exit", resolve));
}

const outputRoot = path.resolve("quality-results/sequences");
await fs.mkdir(outputRoot, { recursive: true });
const results = [];
for (const entry of entries) {
  console.log(`\n[quality matrix] ${entry.id}`);
  const exitCode = await runCapture(entry);
  const directory = path.join(outputRoot, entry.id);
  let analysis = null;
  let metadata = null;
  try {
    analysis = JSON.parse(
      await fs.readFile(
        path.join(directory, "animation-analysis.json"),
        "utf8",
      ),
    );
    metadata = JSON.parse(
      await fs.readFile(path.join(directory, "metadata.json"), "utf8"),
    );
  } catch {
    // The entry below remains a useful explicit failure in the catalog.
  }
  results.push({
    id: entry.id,
    label: entry.label,
    category: entry.category,
    scenario: entry.scenario,
    trackedEntityId: entry.track,
    profile: entry.profile,
    pass: exitCode === 0 && analysis?.pass === true,
    checks: analysis?.checks ?? {},
    measurements: analysis?.measurements ?? {},
    sourceCommit: metadata?.sourceCommit ?? null,
    report: `${entry.id}/report.html`,
    contactSheet: `${entry.id}/contact-sheet.png`,
    metadata: `${entry.id}/metadata.json`,
    analysis: `${entry.id}/animation-analysis.json`,
  });
}

const catalog = {
  schemaVersion: 1,
  project: "Cinderwake",
  pass: results.every(({ pass }) => pass),
  total: results.length,
  passed: results.filter(({ pass }) => pass).length,
  entries: results,
};
await fs.writeFile(
  path.join(outputRoot, "index.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
console.log(
  `\n[quality matrix] ${catalog.passed}/${catalog.total} sequences passed`,
);
if (!catalog.pass) process.exitCode = 1;
