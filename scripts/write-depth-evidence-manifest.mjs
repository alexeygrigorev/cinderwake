import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import sharp from "sharp";

export const PROFILES = ["desktop", "phone"];
export const ROLE_SAMPLES = [
  { sample: "0000", role: "behind", tick: 0 },
  { sample: "0013", role: "boundary-before", tick: 26 },
  { sample: "0014", role: "boundary-after", tick: 28 },
  { sample: "0027", role: "front", tick: 54 },
];
export const ARTIFACT_KINDS = ["page", "player", "prop", "evidence"];
const PAGE_VIEWPORTS = {
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
  phone: { width: 390, height: 844, dpr: 1, mobile: true },
};
const LOGICAL_MASK = { width: 960, height: 540 };
const PROP_PAINT_ID = "scene:prop:3:0:thorn-pillar";
const PLAYER_PAINT_ID = "body:player";
const NARROW_REVIEW = {
  schemaVersion: 1,
  reviewerId: "/root/thorn_depth_exact_review",
  verdict: "ACCEPT",
  scope: "THORN_PILLAR_BEHIND_TO_FRONT_JOURNEY_ONLY",
  reviewedCommit: "be36b4acb9c3db2c1932de09092aaabd0087ec74",
  reviewedManifestSha256:
    "d37065d8eccfe652dc0ed48657f9b1e9d7b7f8196ca210abcebf7fe4d9145622",
  reviewedTapeSha256:
    "6a8a8426b4f79cf92badca29134289b5a449db6b59b2b4d134a98ef62f6c9022",
  reviewedProfiles: ["desktop", "phone"],
  reviewedRoles: ["behind", "boundary-before", "boundary-after", "front"],
  reviewedRoleRecords: 8,
  reviewedArtifactCount: 34,
  reviewedMutationControlCount: 13,
  reasons: [
    "Both physical profiles clearly show the same actor crossing from behind the thorn pillar to its front without a blocked movement event.",
    "All four ordered roles per profile have intersecting actor/prop alpha masks and the paint queue flips on the exact boundary pair.",
    "The retained frames, masks, evidence records, sources, reproduction commands, and tape are hash-bound and the focused validator rejects all 13 required corpus mutations.",
  ],
  invalidation: [
    "reviewed-manifest-projection-hash-changes",
    "command-tape-hash-changes",
    "profile-role-or-artifact-matrix-changes",
    "capture-source-or-reproduction-binding-changes",
    "validator-or-13-mutation-matrix-no-longer-passes",
  ],
};
const DEFAULT_ROOT = path.resolve(
  "quality/evidence/depth-transition-thorn-pillar",
);
const DEFAULT_TAPE = path.resolve(
  "tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json",
);

function fail(message) {
  throw new Error(`depth evidence: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function jsonFile(value) {
  return format(JSON.stringify(value), { parser: "json" });
}

async function reviewSubjectHash(manifest) {
  const subject = structuredClone(manifest);
  subject.status = "REQUIRES_INDEPENDENT_REVIEW";
  delete subject.review;
  return sha256(await jsonFile(subject));
}

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    fail(`${label} has unexpected or missing fields`);
}

function safeArtifactPath(root, relative) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes("\\")
  )
    fail(`unsafe artifact path ${String(relative)}`);
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`))
    fail(`artifact path escapes corpus: ${relative}`);
  return resolved;
}

function expectedArtifactPaths() {
  const expected = [];
  for (const profile of PROFILES) {
    for (const { sample } of ROLE_SAMPLES)
      for (const kind of ARTIFACT_KINDS)
        expected.push(
          `${profile}/${sample}-${kind}.${kind === "evidence" ? "json" : "png"}`,
        );
    expected.push(`${profile}/contact-sheet.png`);
  }
  return expected;
}

async function pngPixels(file) {
  try {
    return await sharp(file).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
  } catch {
    fail(`${file} is not a decodable PNG`);
  }
}

async function pngMetadata(file) {
  let metadata;
  try {
    metadata = await sharp(file).metadata();
  } catch {
    fail(`${file} is not a decodable PNG`);
  }
  if (metadata.format !== "png" || !metadata.width || !metadata.height)
    fail(`${file} is not a dimensioned PNG`);
  return { width: metadata.width, height: metadata.height };
}

function compactPaint(item) {
  return {
    paintId: item.paintId,
    kind: item.kind,
    zOrder: item.zOrder,
    frameIdentity: item.call?.frameIdentity ?? item.scene?.frameIdentity,
  };
}

function sourceBinding(metadata) {
  return {
    sourceCommit: metadata.sourceCommit,
    sourceDirty: metadata.sourceDirty,
    sourcePatchSha256: metadata.sourcePatchSha256,
    trackedWorktreeHash: metadata.trackedWorktreeHash,
    sourceStatus: metadata.sourceStatus,
  };
}

function propReproduction(metadata) {
  return `${metadata.reproductionCommand} --paint-mask '${PROP_PAINT_ID}'`;
}

async function captureInputs(profile) {
  const bodyName = `depth-thorn-${profile}-body`;
  const propName = `depth-thorn-${profile}-prop`;
  const outputRoot = path.resolve("quality-results/sequences");
  const bodyRoot = path.join(outputRoot, bodyName);
  const propRoot = path.join(outputRoot, propName);
  const [timeline, bodyMetadata, propMetadata] = await Promise.all([
    fs
      .readFile(path.join(bodyRoot, "render-manifest-timeline.json"), "utf8")
      .then(JSON.parse),
    fs.readFile(path.join(bodyRoot, "metadata.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(propRoot, "metadata.json"), "utf8").then(JSON.parse),
  ]);
  return { timeline, bodyMetadata, propMetadata };
}

async function evidenceFor(root, profile, item, inputs, tapeSha256) {
  const frame = inputs.timeline.frames[Number(item.sample)];
  if (!frame || frame.tick !== item.tick)
    fail(`${profile}/${item.sample} is absent from its retained timeline`);
  const queue = frame.manifest.paintQueue;
  const playerOrder = queue.findIndex(
    ({ paintId }) => paintId === PLAYER_PAINT_ID,
  );
  const propOrder = queue.findIndex(({ paintId }) => paintId === PROP_PAINT_ID);
  if (playerOrder < 0 || propOrder < 0)
    fail(`${profile}/${item.sample} is missing required paint operations`);
  const relevant = [queue[playerOrder], queue[propOrder]]
    .sort((left, right) => left.zOrder - right.zOrder)
    .map(compactPaint);
  const player = await pngPixels(
    path.join(root, profile, `${item.sample}-player.png`),
  );
  const prop = await pngPixels(
    path.join(root, profile, `${item.sample}-prop.png`),
  );
  let alphaIntersection = 0;
  for (let index = 3; index < player.data.length; index += 4)
    if (player.data[index] > 8 && prop.data[index] > 8) alphaIntersection += 1;
  const blocked = [
    ...(frame.snapshot.events ?? []),
    ...(frame.snapshot.eventLog ?? []),
  ].filter(({ type }) => type === "movement_blocked");
  return {
    schemaVersion: 2,
    profile,
    sample: item.sample,
    role: item.role,
    tick: frame.tick,
    playerPosition: frame.snapshot.player.position,
    playerStart: inputs.timeline.frames[0].snapshot.player.position,
    playerFinal: inputs.timeline.frames.at(-1).snapshot.player.position,
    movementBlockedEvents: blocked,
    pageViewport: inputs.bodyMetadata.viewport,
    logicalMask: LOGICAL_MASK,
    camera: frame.manifest.camera,
    playerOrder,
    propOrder,
    alphaIntersection,
    playerPaintHash: fnv1a(player.data),
    propPaintHash: fnv1a(prop.data),
    paintQueue: relevant,
    tapeSha256,
    captureSources: {
      pagePlayer: sourceBinding(inputs.bodyMetadata),
      prop: sourceBinding(inputs.propMetadata),
    },
    reproduction: {
      pagePlayer: inputs.bodyMetadata.reproductionCommand,
      prop: propReproduction(inputs.propMetadata),
    },
  };
}

async function artifactRecord(root, relative) {
  const file = safeArtifactPath(root, relative);
  const bytes = await fs.readFile(file);
  const [profile, filename] = relative.split("/");
  if (filename === "contact-sheet.png") {
    const dimensions = await pngMetadata(file);
    return {
      path: relative,
      profile,
      sample: "contact",
      kind: "sheet",
      bytes: bytes.length,
      sha256: sha256(bytes),
      ...dimensions,
    };
  }
  const match = /^(\d{4})-(page|player|prop|evidence)\.(png|json)$/.exec(
    filename,
  );
  if (!match) fail(`unexpected artifact name ${relative}`);
  const record = {
    path: relative,
    profile,
    sample: match[1],
    kind: match[2],
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  if (match[3] === "png") Object.assign(record, await pngMetadata(file));
  return record;
}

export async function writeDepthEvidenceCorpus({
  root = DEFAULT_ROOT,
  tapePath = DEFAULT_TAPE,
} = {}) {
  const tape = await fs.readFile(tapePath);
  const tapeSha256 = sha256(tape);
  const captureProfiles = {};
  for (const profile of PROFILES) {
    const inputs = await captureInputs(profile);
    captureProfiles[profile] = {
      pageViewport: inputs.bodyMetadata.viewport,
      logicalMask: LOGICAL_MASK,
      pagePlayerSource: sourceBinding(inputs.bodyMetadata),
      propSource: sourceBinding(inputs.propMetadata),
      reproduction: {
        pagePlayer: inputs.bodyMetadata.reproductionCommand,
        prop: propReproduction(inputs.propMetadata),
      },
    };
    for (const item of ROLE_SAMPLES) {
      const evidence = await evidenceFor(
        root,
        profile,
        item,
        inputs,
        tapeSha256,
      );
      await fs.writeFile(
        path.join(root, profile, `${item.sample}-evidence.json`),
        await jsonFile(evidence),
      );
    }
  }
  const artifacts = await Promise.all(
    expectedArtifactPaths().map((relative) => artifactRecord(root, relative)),
  );
  const manifest = {
    schemaVersion: 2,
    status: "ACCEPTED_NARROW_JOURNEY",
    scenarioId: "depth-transition-thorn-pillar",
    propPaintId: PROP_PAINT_ID,
    playerPaintId: PLAYER_PAINT_ID,
    tapePath:
      "tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json",
    tapeSha256,
    profiles: PROFILES,
    roleSamples: ROLE_SAMPLES,
    artifactKinds: ARTIFACT_KINDS,
    captureProfiles,
    artifacts,
    review: NARROW_REVIEW,
  };
  await fs.writeFile(
    path.join(root, "manifest.v1.json"),
    await jsonFile(manifest),
  );
  return manifest;
}

function assertSourceBinding(actual, expected, label) {
  assertExactKeys(
    actual,
    [
      "sourceCommit",
      "sourceDirty",
      "sourcePatchSha256",
      "trackedWorktreeHash",
      "sourceStatus",
    ],
    label,
  );
  if (!/^[0-9a-f]{40}$/.test(actual.sourceCommit))
    fail(`${label}.sourceCommit is invalid`);
  for (const field of ["sourcePatchSha256", "trackedWorktreeHash"])
    if (!/^[0-9a-f]{64}$/.test(actual[field]))
      fail(`${label}.${field} is invalid`);
  if (
    typeof actual.sourceDirty !== "boolean" ||
    !Array.isArray(actual.sourceStatus)
  )
    fail(`${label} dirty-state fields are invalid`);
  if (actual.sourceDirty !== actual.sourceStatus.length > 0)
    fail(`${label} dirty flag disagrees with sourceStatus`);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(`${label} is stale or does not match its profile binding`);
}

function assertViewport(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(`${label} does not match the exact capture profile`);
}

function assertPosition(actual, expected, label) {
  if (
    !actual ||
    actual.x !== expected.x ||
    actual.y !== expected.y ||
    !Number.isInteger(actual.x) ||
    !Number.isInteger(actual.y)
  )
    fail(`${label} does not match the command tape`);
}

async function validateEvidenceFile({ root, manifest, profile, item, tape }) {
  const file = path.join(root, profile, `${item.sample}-evidence.json`);
  let evidence;
  try {
    evidence = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    fail(`${profile}/${item.sample} evidence is not valid JSON`);
  }
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "profile",
      "sample",
      "role",
      "tick",
      "playerPosition",
      "playerStart",
      "playerFinal",
      "movementBlockedEvents",
      "pageViewport",
      "logicalMask",
      "camera",
      "playerOrder",
      "propOrder",
      "alphaIntersection",
      "playerPaintHash",
      "propPaintHash",
      "paintQueue",
      "tapeSha256",
      "captureSources",
      "reproduction",
    ],
    `${profile}/${item.sample}`,
  );
  if (
    evidence.schemaVersion !== 2 ||
    evidence.profile !== profile ||
    evidence.sample !== item.sample ||
    evidence.role !== item.role ||
    evidence.tick !== item.tick
  )
    fail(`${profile}/${item.sample} role/sample order is stale or swapped`);
  assertPosition(
    evidence.playerStart,
    tape.expected.playerStart,
    `${profile}/${item.sample}.playerStart`,
  );
  assertPosition(
    evidence.playerFinal,
    tape.expected.playerFinal,
    `${profile}/${item.sample}.playerFinal`,
  );
  if (item.role === "behind")
    assertPosition(
      evidence.playerPosition,
      tape.expected.playerStart,
      `${profile}/${item.sample}.playerPosition`,
    );
  if (item.role === "front")
    assertPosition(
      evidence.playerPosition,
      tape.expected.playerFinal,
      `${profile}/${item.sample}.playerPosition`,
    );
  if (
    !Array.isArray(evidence.movementBlockedEvents) ||
    evidence.movementBlockedEvents.length !== 0
  )
    fail(`${profile}/${item.sample} contains blocked movement`);
  const profileBinding = manifest.captureProfiles[profile];
  assertViewport(
    evidence.pageViewport,
    PAGE_VIEWPORTS[profile],
    `${profile}/${item.sample}.pageViewport`,
  );
  assertViewport(
    profileBinding.pageViewport,
    PAGE_VIEWPORTS[profile],
    `${profile}.pageViewport`,
  );
  assertViewport(
    evidence.logicalMask,
    LOGICAL_MASK,
    `${profile}/${item.sample}.logicalMask`,
  );
  assertViewport(
    profileBinding.logicalMask,
    LOGICAL_MASK,
    `${profile}.logicalMask`,
  );
  if (evidence.tapeSha256 !== manifest.tapeSha256)
    fail(`${profile}/${item.sample} is bound to a stale command tape`);
  assertExactKeys(
    evidence.captureSources,
    ["pagePlayer", "prop"],
    `${profile}/${item.sample}.captureSources`,
  );
  assertSourceBinding(
    evidence.captureSources.pagePlayer,
    profileBinding.pagePlayerSource,
    `${profile}/${item.sample}.pagePlayerSource`,
  );
  assertSourceBinding(
    evidence.captureSources.prop,
    profileBinding.propSource,
    `${profile}/${item.sample}.propSource`,
  );
  if (
    JSON.stringify(evidence.reproduction) !==
      JSON.stringify(profileBinding.reproduction) ||
    !evidence.reproduction.pagePlayer.includes(
      "--commands-file 'quality-results/sequences/depth-thorn-",
    ) ||
    !evidence.reproduction.prop.includes(`--paint-mask '${PROP_PAINT_ID}'`) ||
    !evidence.reproduction.pagePlayer.includes(
      `--viewport-width ${PAGE_VIEWPORTS[profile].width}`,
    ) ||
    !evidence.reproduction.pagePlayer.includes(
      `--viewport-height ${PAGE_VIEWPORTS[profile].height}`,
    )
  )
    fail(`${profile}/${item.sample} reproduction binding is stale`);
  if (
    !Number.isInteger(evidence.playerOrder) ||
    !Number.isInteger(evidence.propOrder) ||
    evidence.playerOrder < 0 ||
    evidence.propOrder < 0 ||
    evidence.playerOrder === evidence.propOrder
  )
    fail(`${profile}/${item.sample} paint indices are invalid`);
  const playerBeforeProp = evidence.playerOrder < evidence.propOrder;
  const mustBeBefore = new Set(["behind", "boundary-before"]).has(item.role);
  if (playerBeforeProp !== mustBeBefore)
    fail(`${profile}/${item.sample} queue order contradicts its ordered role`);
  if (
    !Number.isInteger(evidence.alphaIntersection) ||
    evidence.alphaIntersection <= 0
  )
    fail(`${profile}/${item.sample} has no alpha intersection`);
  if (!Array.isArray(evidence.paintQueue) || evidence.paintQueue.length !== 2)
    fail(
      `${profile}/${item.sample} compact paint queue must contain two operations`,
    );
  const ids = evidence.paintQueue.map(({ paintId }) => paintId);
  const expectedIds = playerBeforeProp
    ? [PLAYER_PAINT_ID, PROP_PAINT_ID]
    : [PROP_PAINT_ID, PLAYER_PAINT_ID];
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds))
    fail(
      `${profile}/${item.sample} compact paint queue is inverted or incomplete`,
    );
  for (const paint of evidence.paintQueue) {
    assertExactKeys(
      paint,
      ["paintId", "kind", "zOrder", "frameIdentity"],
      `${profile}/${item.sample}.paintQueue`,
    );
    const expectedOrder =
      paint.paintId === PLAYER_PAINT_ID
        ? evidence.playerOrder
        : evidence.propOrder;
    if (
      paint.zOrder !== expectedOrder ||
      typeof paint.frameIdentity !== "string"
    )
      fail(`${profile}/${item.sample} compact paint queue is not exact`);
  }
  const [player, prop] = await Promise.all([
    pngPixels(path.join(root, profile, `${item.sample}-player.png`)),
    pngPixels(path.join(root, profile, `${item.sample}-prop.png`)),
  ]);
  if (
    player.info.width !== LOGICAL_MASK.width ||
    player.info.height !== LOGICAL_MASK.height ||
    prop.info.width !== LOGICAL_MASK.width ||
    prop.info.height !== LOGICAL_MASK.height
  )
    fail(`${profile}/${item.sample} masks are not 960x540`);
  let intersection = 0;
  for (let index = 3; index < player.data.length; index += 4)
    if (player.data[index] > 8 && prop.data[index] > 8) intersection += 1;
  if (
    fnv1a(player.data) !== evidence.playerPaintHash ||
    fnv1a(prop.data) !== evidence.propPaintHash
  )
    fail(`${profile}/${item.sample} paint hash does not match decoded pixels`);
  if (intersection !== evidence.alphaIntersection)
    fail(
      `${profile}/${item.sample} alpha intersection does not match decoded masks`,
    );
}

export async function validateDepthEvidenceCorpus({
  root = DEFAULT_ROOT,
  tapePath = DEFAULT_TAPE,
  manifestOverride,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const manifest =
    manifestOverride ??
    JSON.parse(
      await fs.readFile(path.join(resolvedRoot, "manifest.v1.json"), "utf8"),
    );
  assertExactKeys(
    manifest,
    [
      "schemaVersion",
      "status",
      "scenarioId",
      "propPaintId",
      "playerPaintId",
      "tapePath",
      "tapeSha256",
      "profiles",
      "roleSamples",
      "artifactKinds",
      "captureProfiles",
      "artifacts",
      "review",
    ],
    "manifest",
  );
  if (
    manifest.schemaVersion !== 2 ||
    manifest.status !== "ACCEPTED_NARROW_JOURNEY" ||
    manifest.scenarioId !== "depth-transition-thorn-pillar" ||
    manifest.propPaintId !== PROP_PAINT_ID ||
    manifest.playerPaintId !== PLAYER_PAINT_ID ||
    manifest.tapePath !==
      "tests/fixtures/sequences/depth-transition-thorn-pillar.commands.json"
  )
    fail("manifest identity is invalid");
  if (JSON.stringify(manifest.review) !== JSON.stringify(NARROW_REVIEW))
    fail("independent narrow review identity or verdict is stale");
  if (manifest.review.reviewedTapeSha256 !== manifest.tapeSha256)
    fail("independent narrow review is bound to a stale command tape");
  if (
    manifest.review.reviewedRoleRecords !== 8 ||
    manifest.review.reviewedArtifactCount !== 34 ||
    manifest.review.reviewedMutationControlCount !== 13 ||
    JSON.stringify(manifest.review.reviewedProfiles) !==
      JSON.stringify(PROFILES) ||
    JSON.stringify(manifest.review.reviewedRoles) !==
      JSON.stringify(ROLE_SAMPLES.map(({ role }) => role))
  )
    fail("independent narrow review matrix is incomplete");
  if (
    JSON.stringify(manifest.profiles) !== JSON.stringify(PROFILES) ||
    JSON.stringify(manifest.roleSamples) !== JSON.stringify(ROLE_SAMPLES) ||
    JSON.stringify(manifest.artifactKinds) !== JSON.stringify(ARTIFACT_KINDS)
  )
    fail("profile, role/sample, or artifact-kind order is not exact");
  const tapeBytes = await fs.readFile(tapePath);
  const tape = JSON.parse(tapeBytes);
  if (sha256(tapeBytes) !== manifest.tapeSha256)
    fail("manifest is bound to a stale command tape");
  if (
    tape.scenarioId !== manifest.scenarioId ||
    tape.expected.propId !== PROP_PAINT_ID.replace(/^scene:/, "")
  )
    fail("command tape identity does not match the evidence route");
  assertExactKeys(manifest.captureProfiles, PROFILES, "captureProfiles");
  const expectedPaths = expectedArtifactPaths();
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 34)
    fail("manifest must contain exactly 34 retained artifacts");
  for (const artifact of manifest.artifacts)
    safeArtifactPath(resolvedRoot, artifact.path);
  if (
    JSON.stringify(manifest.artifacts.map(({ path: itemPath }) => itemPath)) !==
    JSON.stringify(expectedPaths)
  )
    fail("artifact order is missing, duplicated, swapped, or unsafe");
  const uniquePaths = new Set(
    manifest.artifacts.map(({ path: itemPath }) => itemPath),
  );
  if (uniquePaths.size !== 34) fail("artifact paths are duplicated");
  for (const artifact of manifest.artifacts) {
    const expectedKeys = [
      "path",
      "profile",
      "sample",
      "kind",
      "bytes",
      "sha256",
      ...(artifact.kind === "evidence" ? [] : ["width", "height"]),
    ];
    assertExactKeys(artifact, expectedKeys, `artifact ${artifact.path}`);
    const file = safeArtifactPath(resolvedRoot, artifact.path);
    let bytes;
    try {
      bytes = await fs.readFile(file);
    } catch {
      fail(`missing artifact ${artifact.path}`);
    }
    if (bytes.length !== artifact.bytes)
      fail(`${artifact.path} byte count changed`);
    if (sha256(bytes) !== artifact.sha256)
      fail(`${artifact.path} hash changed`);
    if (artifact.kind !== "evidence") {
      const dimensions = await pngMetadata(file);
      if (
        dimensions.width !== artifact.width ||
        dimensions.height !== artifact.height
      )
        fail(`${artifact.path} decoded dimensions changed`);
      if (artifact.kind === "page") {
        const expected = PAGE_VIEWPORTS[artifact.profile];
        if (
          artifact.width !== expected.width ||
          artifact.height !== expected.height
        )
          fail(`${artifact.path} does not match its page viewport`);
      }
      if (
        new Set(["player", "prop"]).has(artifact.kind) &&
        (artifact.width !== LOGICAL_MASK.width ||
          artifact.height !== LOGICAL_MASK.height)
      )
        fail(`${artifact.path} is not a 960x540 logical mask`);
    }
  }
  for (const profile of PROFILES)
    for (const item of ROLE_SAMPLES)
      await validateEvidenceFile({
        root: resolvedRoot,
        manifest,
        profile,
        item,
        tape,
      });
  if (
    (await reviewSubjectHash(manifest)) !==
    manifest.review.reviewedManifestSha256
  )
    fail("accepted narrow review was invalidated by a corpus change");
  return {
    profiles: 2,
    roles: 8,
    artifacts: 34,
    semanticAssertions: 8,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!process.argv.includes("--check")) await writeDepthEvidenceCorpus();
  const result = await validateDepthEvidenceCorpus();
  console.log(
    `PASS depth evidence manifest (${result.profiles} profiles, ${result.roles} ordered roles, ${result.artifacts} artifacts)`,
  );
}
