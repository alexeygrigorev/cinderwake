import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const executeFile = promisify(execFile);
const ROOT = process.cwd();
const ASSEMBLER = path.join(ROOT, "scripts", "assemble-actor-source.mjs");
const CONTRACT_FILE = "art/actor-atlas-v1.json";
const STYLE_FILE = "art/style-bible.md";
const BASE_FILE = "art/source/actors/stonekin-source.png";
const REFERENCE_FILES = [
  {
    file: BASE_FILE,
    role: "immutable actor identity, palette, equipment, and rendering style",
  },
  {
    file: "art/source/actors/ashfang-source.png",
    role: "shared Cinderwake camera, grounding, and gameplay-scale reference",
  },
];
const ISOLATED_INDEXES = [4, 5, 6, 7];
const REQUIRED_VISUAL_AXES = [
  "identity-and-style",
  "anatomy-and-proportion",
  "pose-semantics",
  "animation-continuity",
  "grounding-and-contact",
  "raster-cleanliness",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function fileSha256(relativePath) {
  return sha256(await fs.readFile(path.resolve(ROOT, relativePath)));
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function clone(value) {
  return structuredClone(value);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runAssembler(directory, name, manifest) {
  const manifestPath = path.join(directory, `${name}.json`);
  const outputPath = path.join(directory, `${name}.png`);
  const reportPath = path.join(directory, `${name}-report.json`);
  await writeJson(manifestPath, manifest);
  const result = await executeFile(process.execPath, [
    ASSEMBLER,
    "--manifest",
    manifestPath,
    "--output",
    outputPath,
    "--report",
    reportPath,
  ]);
  return {
    ...result,
    manifestPath,
    outputPath,
    reportPath,
    output: await fs.readFile(outputPath),
    report: JSON.parse(await fs.readFile(reportPath, "utf8")),
  };
}

async function expectRejection(directory, name, expectedMessage, manifest) {
  const manifestPath = path.join(directory, `${name}.json`);
  const outputPath = path.join(directory, `${name}.png`);
  const reportPath = path.join(directory, `${name}-report.json`);
  await writeJson(manifestPath, manifest);
  try {
    await executeFile(process.execPath, [
      ASSEMBLER,
      "--manifest",
      manifestPath,
      "--output",
      outputPath,
      "--report",
      reportPath,
    ]);
    throw new Error(`${name} unexpectedly passed`);
  } catch (error) {
    if (error.message === `${name} unexpectedly passed`) throw error;
    const evidence = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    assert(
      evidence.includes(expectedMessage),
      `${name} rejected for the wrong reason; expected "${expectedMessage}", received:\n${evidence}`,
    );
  }
  const outputExists = await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false);
  const reportExists = await fs
    .access(reportPath)
    .then(() => true)
    .catch(() => false);
  assert(!outputExists && !reportExists, `${name} left partial output files`);
  return name;
}

function acceptedVisualReview(outputSha256) {
  return {
    verdict: "ACCEPT",
    reviewer: "actor-pose-assembly-self-test",
    reviewedPreparedSha256: outputSha256,
    axes: REQUIRED_VISUAL_AXES.map((axis) => ({
      axis,
      verdict: "ACCEPT",
      notes: `Synthetic fixture accepts ${axis} for schema and hash-binding coverage.`,
    })),
  };
}

async function compareInheritedCell(outputPath, basePath, index) {
  const region = {
    left: (index % 4) * 256,
    top: Math.floor(index / 4) * 256,
    width: 256,
    height: 256,
  };
  const [output, base] = await Promise.all([
    sharp(outputPath).extract(region).ensureAlpha().raw().toBuffer(),
    sharp(basePath).extract(region).ensureAlpha().raw().toBuffer(),
  ]);
  assert(output.equals(base), `inherited cell ${index} pixels changed`);
}

async function main() {
  await fs.mkdir(path.join(ROOT, "test-results"), { recursive: true });
  const directory = await fs.mkdtemp(
    path.join(ROOT, "test-results", "actor-pose-assembly-"),
  );
  try {
    const productionSourcePath = path.join(ROOT, BASE_FILE);
    const basePath = path.join(directory, "normalized-production-base.png");
    await executeFile(process.execPath, [
      path.join(ROOT, "scripts", "prepare-actor-source.mjs"),
      "--input",
      productionSourcePath,
      "--output",
      basePath,
    ]);
    const commonPromptPrefixPath = path.join(directory, "common-prefix.txt");
    const commonPromptPrefix = [
      "Cinderwake isolated actor pose.",
      "Use the immutable elevated three-quarter camera and literal #ff00ff background.",
      "Keep identity, materials, light direction, scale, and ground contact fixed.",
      "",
    ].join("\n");
    await fs.writeFile(commonPromptPrefixPath, commonPromptPrefix);

    const referenceDeclarations = await Promise.all(
      REFERENCE_FILES.map(async ({ file, role }) => ({
        file,
        sha256: await fileSha256(file),
        role,
      })),
    );
    const isolatedSources = new Map();
    for (const index of ISOLATED_INDEXES) {
      const posePath = path.join(directory, `raw-pose-${index}.png`);
      if (index === 7) {
        const rectangle = async (width, height, background) =>
          sharp({ create: { width, height, channels: 4, background } })
            .png()
            .toBuffer();
        await sharp({
          create: {
            width: 1024,
            height: 1024,
            channels: 4,
            background: { r: 255, g: 0, b: 255, alpha: 1 },
          },
        })
          .composite([
            {
              input: await rectangle(880, 620, {
                r: 40,
                g: 34,
                b: 42,
                alpha: 1,
              }),
              left: 60,
              top: 120,
            },
            {
              input: await rectangle(40, 160, {
                r: 34,
                g: 28,
                b: 36,
                alpha: 1,
              }),
              left: 60,
              top: 740,
            },
            {
              input: await rectangle(120, 160, {
                r: 34,
                g: 28,
                b: 36,
                alpha: 0.2,
              }),
              left: 100,
              top: 740,
            },
          ])
          .png({ compressionLevel: 9, palette: true, quality: 100 })
          .toFile(posePath);
      } else {
        await sharp(basePath)
          .extract({
            left: (index % 4) * 256,
            top: Math.floor(index / 4) * 256,
            width: 256,
            height: 256,
          })
          .resize(1024, 1024, { kernel: "nearest" })
          .png({ compressionLevel: 9, palette: true, quality: 100 })
          .toFile(posePath);
      }
      const promptPath = path.join(directory, `prompt-${index}.txt`);
      await fs.writeFile(
        promptPath,
        `${commonPromptPrefix}Pose ${index}: authored east-walk phase ${index - 3} of 4.\n`,
      );
      isolatedSources.set(index, {
        kind: "isolated",
        raw: {
          file: relativePath(posePath),
          sha256: sha256(await fs.readFile(posePath)),
        },
        prompt: {
          file: relativePath(promptPath),
          sha256: sha256(await fs.readFile(promptPath)),
        },
        commonPromptPrefix: {
          file: relativePath(commonPromptPrefixPath),
          sha256: sha256(await fs.readFile(commonPromptPrefixPath)),
        },
        references: clone(referenceDeclarations),
        generation: {
          tool: "deterministic committed-cell fixture generator",
          artifactId: `stonekin-production-cell-${index}`,
        },
      });
    }

    const manifest = {
      schemaVersion: 1,
      contract: "CinderwakeIsolatedPoseAssemblyV1",
      id: "stonekin-primary-mixed-fixture",
      actorId: "stonekin",
      sourceFamily: "primary",
      actorContract: {
        file: CONTRACT_FILE,
        sha256: await fileSha256(CONTRACT_FILE),
      },
      styleBrief: {
        file: STYLE_FILE,
        sha256: await fileSha256(STYLE_FILE),
      },
      baseSheet: {
        file: relativePath(basePath),
        sha256: sha256(await fs.readFile(basePath)),
      },
      cells: Array.from({ length: 16 }, (_, index) => ({
        index,
        semanticRole:
          index >= 4 && index <= 7
            ? `east-walk-phase-${index - 3}`
            : `inherited-primary-cell-${index}`,
        source: isolatedSources.get(index) ?? {
          kind: "inherited",
          baseCell: index,
        },
      })),
    };

    const first = await runAssembler(directory, "valid-first", manifest);
    const second = await runAssembler(directory, "valid-second", manifest);
    assert(
      first.output.equals(second.output),
      "repeated assembly bytes differ",
    );
    assert(
      first.report.output.sha256 === sha256(first.output),
      "report output hash does not match output bytes",
    );
    assert(
      first.report.output.sha256 === second.report.output.sha256,
      "repeated assembly output hashes differ",
    );
    assert(
      first.report.assembly.isolatedCells === 4 &&
        first.report.assembly.inheritedCells === 12,
      "mixed sheet did not report 4 isolated and 12 inherited cells",
    );
    assert(
      first.report.artReview.status === "UNREVIEWED",
      "mechanical assembly promoted unreviewed art",
    );
    const isolatedReports = first.report.assembly.cells.filter(
      ({ mode }) => mode === "isolated",
    );
    assert(isolatedReports.length === 4, "report omitted isolated cells");
    const sharedScale = first.report.assembly.sharedIsolatedPoseScale;
    assert(
      first.report.assembly.canonicalIsolatedCanvasScale === 0.25 &&
        sharedScale < 0.2,
      "isolated-pose assembly did not shrink its one shared scale for asymmetric support",
    );
    assert(
      isolatedReports.every(
        ({ effectiveScale }) => effectiveScale === sharedScale,
      ),
      "isolated cells did not use one common scale",
    );
    assert(
      isolatedReports.every(
        ({ preparedBounds }) =>
          preparedBounds.top + preparedBounds.height ===
          first.report.assembly.footAnchor.y,
      ),
      "isolated poses were not grounded on the shared source foot anchor",
    );
    assert(
      isolatedReports.every(
        ({ contact }) => Math.abs(contact.centroidOffsetFromAnchor) <= 0.5,
      ),
      "isolated poses were not centered over the shared contact anchor",
    );
    for (const index of Array.from({ length: 16 }, (_, value) => value).filter(
      (index) => !ISOLATED_INDEXES.includes(index),
    ))
      await compareInheritedCell(first.outputPath, basePath, index);
    const metadata = await sharp(first.output).metadata();
    assert(
      metadata.width === 1024 && metadata.height === 1024,
      "assembled sheet is not 1024x1024",
    );
    const topLeft = await sharp(first.output).ensureAlpha().raw().toBuffer();
    assert(
      topLeft[0] === 255 &&
        topLeft[1] === 0 &&
        topLeft[2] === 255 &&
        topLeft[3] === 255,
      "assembled sheet background is not literal opaque magenta",
    );

    const reviewedManifest = {
      ...clone(manifest),
      preparedSha256: first.report.output.sha256,
      visualReview: acceptedVisualReview(first.report.output.sha256),
    };
    const reviewed = await runAssembler(
      directory,
      "valid-reviewed",
      reviewedManifest,
    );
    assert(
      reviewed.output.equals(first.output),
      "adding exact-hash review metadata changed output bytes",
    );
    assert(
      reviewed.report.artReview.status === "ACCEPT" &&
        reviewed.report.artReview.axes.length === REQUIRED_VISUAL_AXES.length,
      "valid exact-hash visual review was not preserved",
    );

    const rejectionChecks = [];
    const missingCell = clone(manifest);
    missingCell.cells.pop();
    rejectionChecks.push(
      await expectRejection(
        directory,
        "missing-cell",
        "must contain exactly 16 cells",
        missingCell,
      ),
    );

    const duplicateCell = clone(manifest);
    duplicateCell.cells[15].index = 14;
    rejectionChecks.push(
      await expectRejection(
        directory,
        "duplicate-cell",
        "duplicate cell 14",
        duplicateCell,
      ),
    );

    for (const [name, pathToHash, expectedMessage] of [
      [
        "stale-actor-contract-hash",
        ["actorContract"],
        "actorContract.sha256 mismatch",
      ],
      ["stale-style-hash", ["styleBrief"], "styleBrief.sha256 mismatch"],
      ["stale-base-hash", ["baseSheet"], "baseSheet.sha256 mismatch"],
      [
        "stale-raw-hash",
        ["cells", 4, "source", "raw"],
        "cell 4.raw.sha256 mismatch",
      ],
      [
        "stale-prompt-hash",
        ["cells", 4, "source", "prompt"],
        "cell 4.prompt.sha256 mismatch",
      ],
      [
        "stale-prefix-hash",
        ["cells", 4, "source", "commonPromptPrefix"],
        "cell 4.commonPromptPrefix.sha256 mismatch",
      ],
      [
        "stale-reference-hash",
        ["cells", 4, "source", "references", 0],
        "cell 4.references[0].sha256 mismatch",
      ],
    ]) {
      const stale = clone(manifest);
      let target = stale;
      for (const segment of pathToHash) target = target[segment];
      target.sha256 = "0".repeat(64);
      rejectionChecks.push(
        await expectRejection(directory, name, expectedMessage, stale),
      );
    }

    const invalidBasePath = path.join(directory, "corrupt-base-input.png");
    const blackPixel = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    await sharp(basePath)
      .composite([{ input: blackPixel, left: 0, top: 0 }])
      .png({ compressionLevel: 9 })
      .toFile(invalidBasePath);
    const invalidBaseMargin = clone(manifest);
    invalidBaseMargin.baseSheet = {
      file: relativePath(invalidBasePath),
      sha256: sha256(await fs.readFile(invalidBasePath)),
    };
    rejectionChecks.push(
      await expectRejection(
        directory,
        "invalid-base-margin",
        "non-magenta pixel outside source safe bounds",
        invalidBaseMargin,
      ),
    );

    const undersizedRawPath = path.join(
      directory,
      "fixture-undersized-raw-pose.png",
    );
    await sharp(isolatedSources.get(4).raw.file)
      .resize(512, 512, { kernel: "nearest" })
      .png()
      .toFile(undersizedRawPath);
    const undersizedRaw = clone(manifest);
    undersizedRaw.cells[4].source.raw = {
      file: relativePath(undersizedRawPath),
      sha256: sha256(await fs.readFile(undersizedRawPath)),
    };
    rejectionChecks.push(
      await expectRejection(
        directory,
        "undersized-raw-pose",
        "must be square and at least 1024px",
        undersizedRaw,
      ),
    );

    const forbiddenScale = clone(manifest);
    forbiddenScale.cells[4].scale = 0.75;
    rejectionChecks.push(
      await expectRejection(
        directory,
        "forbidden-scale",
        'forbidden per-cell field "scale"',
        forbiddenScale,
      ),
    );
    const forbiddenTransform = clone(manifest);
    forbiddenTransform.cells[4].source.transform = { offsetX: 3 };
    rejectionChecks.push(
      await expectRejection(
        directory,
        "forbidden-transform",
        'forbidden per-cell field "transform"',
        forbiddenTransform,
      ),
    );

    const mismatchedReferences = clone(manifest);
    mismatchedReferences.cells[5].source.references.reverse();
    rejectionChecks.push(
      await expectRejection(
        directory,
        "mismatched-ordered-references",
        "references do not match the shared ordered reference set",
        mismatchedReferences,
      ),
    );

    const stalePreparedHash = {
      ...clone(manifest),
      preparedSha256: "0".repeat(64),
    };
    rejectionChecks.push(
      await expectRejection(
        directory,
        "stale-prepared-hash",
        "manifest.preparedSha256 mismatch",
        stalePreparedHash,
      ),
    );

    const staleVisualReview = {
      ...clone(manifest),
      visualReview: acceptedVisualReview("0".repeat(64)),
    };
    rejectionChecks.push(
      await expectRejection(
        directory,
        "stale-visual-review-hash",
        "reviewedPreparedSha256 does not match assembled output hash",
        staleVisualReview,
      ),
    );

    assert(rejectionChecks.length === 16, "unexpected rejection-control count");
    console.log(
      `Actor pose assembly PASS: deterministic 12 inherited + 4 isolated sheet, one shared scale/anchor, exact-hash review binding, ${rejectionChecks.length}/${rejectionChecks.length} named rejection controls.`,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

await main();
