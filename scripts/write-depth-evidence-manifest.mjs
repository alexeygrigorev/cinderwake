import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("quality/evidence/depth-transition-thorn-pillar");
const checking = process.argv.includes("--check");
const files = (await Promise.all(["desktop", "phone"].map(async (profile) =>
  Promise.all((await fs.readdir(path.join(root, profile))).filter((name) => name.endsWith(".png")).map(async (name) => {
    const bytes = await fs.readFile(path.join(root, profile, name));
    const [sample, kind] = name.replace(".png", "").split("-");
    return { path: `${profile}/${name}`, profile, sample: sample ?? "contact", kind: kind ?? "sheet", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  })),
))).flat();
const tape = await fs.readFile("tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json");
const expected = { schemaVersion: 1, status: "REQUIRES_INDEPENDENT_REVIEW", sourceCommit: "c1620cd0e596905107d7bf5a7e39df3ed09a6448", tapeSha256: createHash("sha256").update(tape).digest("hex"), viewports: { desktop: [1440, 900], phone: [390, 844] }, roles: ["behind", "boundary-before", "boundary-after", "front"], artifacts: files.sort((a,b) => a.path.localeCompare(b.path)) };
if (checking) {
  const actual = JSON.parse(await fs.readFile(path.join(root, "manifest.v1.json"), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("depth evidence manifest is stale, incomplete, altered, or unsafe");
  const required = 2 * 4 * 3 + 2;
  if (actual.artifacts.length !== required || new Set(actual.artifacts.map((item) => item.path)).size !== required) throw new Error("depth evidence roles are missing or duplicated");
  console.log("PASS depth evidence manifest");
} else await fs.writeFile(path.join(root, "manifest.v1.json"), `${JSON.stringify(expected, null, 2)}\n`);
