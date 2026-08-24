import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { validateDepthEvidenceCorpus } from "./write-depth-evidence-manifest.mjs";

const sourceRoot = path.resolve(
  "quality/evidence/depth-transition-thorn-pillar",
);
const tapePath = path.resolve(
  "tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json",
);
const temporaryParent = await fs.mkdtemp(
  path.join(os.tmpdir(), "cinderwake-depth-evidence-"),
);
const corpus = path.join(temporaryParent, "corpus");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readManifest() {
  return JSON.parse(
    await fs.readFile(path.join(corpus, "manifest.v1.json"), "utf8"),
  );
}

async function writeManifest(manifest) {
  await fs.writeFile(
    path.join(corpus, "manifest.v1.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function replaceArtifact(relative, bytes, manifest) {
  await fs.writeFile(path.join(corpus, relative), bytes);
  const artifact = manifest.artifacts.find(
    ({ path: itemPath }) => itemPath === relative,
  );
  if (!artifact) throw new Error(`test artifact ${relative} is not manifested`);
  artifact.bytes = bytes.length;
  artifact.sha256 = sha256(bytes);
  if (relative.endsWith(".png")) {
    try {
      const metadata = await sharp(bytes).metadata();
      artifact.width = metadata.width;
      artifact.height = metadata.height;
    } catch {
      // The validator, not the fixture helper, owns malformed-PNG rejection.
    }
  }
}

async function mutateEvidence(relative, change, manifest) {
  const file = path.join(corpus, relative);
  const evidence = JSON.parse(await fs.readFile(file, "utf8"));
  change(evidence);
  await replaceArtifact(
    relative,
    Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    manifest,
  );
}

async function expectReject(id, expectedMessage, mutation) {
  await fs.rm(corpus, { recursive: true, force: true });
  await fs.cp(sourceRoot, corpus, { recursive: true });
  const manifest = await readManifest();
  await mutation(manifest);
  await writeManifest(manifest);
  let rejected = false;
  try {
    await validateDepthEvidenceCorpus({ root: corpus, tapePath });
  } catch (error) {
    rejected = String(error).includes(`depth evidence: ${expectedMessage}`);
  }
  if (!rejected) throw new Error(`negative control escaped: ${id}`);
  console.log(`PASS negative control ${id}`);
}

try {
  await fs.cp(sourceRoot, corpus, { recursive: true });
  const positive = await validateDepthEvidenceCorpus({
    root: corpus,
    tapePath,
  });
  console.log(`PASS retained corpus (${positive.artifacts} artifacts)`);

  const controls = [
    [
      "missing-artifact",
      "missing artifact desktop/0000-page.png",
      async () => fs.unlink(path.join(corpus, "desktop/0000-page.png")),
    ],
    [
      "bad-hash",
      "desktop/0000-page.png hash changed",
      async (manifest) => {
        manifest.artifacts[0].sha256 = "0".repeat(64);
      },
    ],
    [
      "bad-byte-count",
      "desktop/0000-page.png byte count changed",
      async (manifest) => {
        manifest.artifacts[0].bytes += 1;
      },
    ],
    [
      "duplicate-role",
      "profile, role/sample, or artifact-kind order is not exact",
      async (manifest) => {
        manifest.roleSamples[1] = { ...manifest.roleSamples[0] };
      },
    ],
    [
      "omitted-role",
      "profile, role/sample, or artifact-kind order is not exact",
      async (manifest) => {
        manifest.roleSamples.pop();
      },
    ],
    [
      "swapped-role",
      "profile, role/sample, or artifact-kind order is not exact",
      async (manifest) => {
        [manifest.roleSamples[1], manifest.roleSamples[2]] = [
          manifest.roleSamples[2],
          manifest.roleSamples[1],
        ];
      },
    ],
    [
      "wrong-dimensions",
      "desktop/0000-player.png is not a 960x540 logical mask",
      async (manifest) => {
        const bytes = await sharp({
          create: {
            width: 959,
            height: 540,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .png()
          .toBuffer();
        await replaceArtifact("desktop/0000-player.png", bytes, manifest);
      },
    ],
    [
      "malformed-png",
      `${path.join(corpus, "desktop/0000-player.png")} is not a decodable PNG`,
      async (manifest) => {
        await replaceArtifact(
          "desktop/0000-player.png",
          Buffer.from("not a png"),
          manifest,
        );
      },
    ],
    [
      "stale-tape",
      "desktop/0000 is bound to a stale command tape",
      async (manifest) => {
        await mutateEvidence(
          "desktop/0000-evidence.json",
          (evidence) => (evidence.tapeSha256 = "0".repeat(64)),
          manifest,
        );
      },
    ],
    [
      "stale-source",
      "desktop/0000.pagePlayerSource is stale or does not match its profile binding",
      async (manifest) => {
        await mutateEvidence(
          "desktop/0000-evidence.json",
          (evidence) =>
            (evidence.captureSources.pagePlayer.sourceCommit = "0".repeat(40)),
          manifest,
        );
      },
    ],
    [
      "path-escape",
      "artifact path escapes corpus: ../outside.png",
      async (manifest) => {
        manifest.artifacts[0].path = "../outside.png";
      },
    ],
    [
      "queue-order-inversion",
      "desktop/0000 queue order contradicts its ordered role",
      async (manifest) => {
        await mutateEvidence(
          "desktop/0000-evidence.json",
          (evidence) => {
            [evidence.playerOrder, evidence.propOrder] = [
              evidence.propOrder,
              evidence.playerOrder,
            ];
            evidence.paintQueue.reverse();
          },
          manifest,
        );
      },
    ],
    [
      "zero-alpha-intersection",
      "desktop/0000 has no alpha intersection",
      async (manifest) => {
        await mutateEvidence(
          "desktop/0000-evidence.json",
          (evidence) => (evidence.alphaIntersection = 0),
          manifest,
        );
      },
    ],
  ];
  for (const [id, expectedMessage, mutation] of controls)
    await expectReject(id, expectedMessage, mutation);
  console.log(
    `PASS depth evidence validator self-test (${controls.length} controls)`,
  );
} finally {
  await fs.rm(temporaryParent, { recursive: true, force: true });
}
