import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("quality/evidence/depth-transition-thorn-pillar");
const files = (await Promise.all(["desktop", "phone"].map(async (profile) =>
  Promise.all((await fs.readdir(path.join(root, profile))).filter((name) => name.endsWith(".png")).map(async (name) => {
    const bytes = await fs.readFile(path.join(root, profile, name));
    const [sample, kind] = name.replace(".png", "").split("-");
    return { path: `${profile}/${name}`, profile, sample: sample ?? "contact", kind: kind ?? "sheet", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  })),
))).flat();
const tape = await fs.readFile("tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json");
await fs.writeFile(path.join(root, "manifest.v1.json"), `${JSON.stringify({ schemaVersion: 1, status: "REQUIRES_INDEPENDENT_REVIEW", sourceCommit: "c1620cd00000000000000000000000000000000", tapeSha256: createHash("sha256").update(tape).digest("hex"), viewports: { desktop: [1440, 900], phone: [390, 844] }, roles: ["behind", "boundary-before", "boundary-after", "front"], artifacts: files.sort((a,b) => a.path.localeCompare(b.path)) }, null, 2)}\n`);
