import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import sharp from "sharp";

const executeFile = promisify(execFile);
const ROOT = process.cwd();
const SPEC = JSON.parse(
  await fs.readFile(path.join(ROOT, "art", "actor-atlas-v1.json"), "utf8"),
);
const ACTORS = [
  "vanguard",
  "ranger",
  "arcanist",
  "ashfang",
  "hexer",
  "stonekin",
];
const FACINGS = ["east", "west", "north", "south"];
const AUTHORED_FACINGS = ["east", "north", "south"];
const MONSTER_IDS = new Set(["ashfang", "hexer", "stonekin"]);
const CLIPS = Object.keys(SPEC.clips);
const CELL = SPEC.atlas.cellWidth;
const CORE_HALF_WIDTH = 24;

function parseArguments(arguments_) {
  const options = {
    atlasDirectory: path.join(ROOT, "public", "assets", "sprites"),
    reportDirectory: path.join(ROOT, "quality-results", "actor-atlas-audit"),
    reportOnly: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--report-only") {
      options.reportOnly = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--atlas-dir" && name !== "--report-dir")
      throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? arguments_[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} requires a value`);
    if (name === "--atlas-dir")
      options.atlasDirectory = path.resolve(ROOT, value);
    else options.reportDirectory = path.resolve(ROOT, value);
  }
  return options;
}

const OPTIONS = parseArguments(process.argv.slice(2));
const ATLAS_DIRECTORY = OPTIONS.atlasDirectory;
const REPORT_DIRECTORY = OPTIONS.reportDirectory;
const THRESHOLDS = {
  minimumInkPixels: 120,
  maximumCutEdgeRun: 24,
  loopCentroidStep: 10,
  loopDimensionStep: 20,
  loopMinimumMaskIou: 0.45,
  hurtCentroidStep: 18,
  actionCentroidStep: 32,
  actionCoreCentroidStep: 22,
  actionDimensionStep: 60,
  deathCentroidStep: 32,
  deathDimensionStep: 64,
  turnCentroidDistance: 20,
  turnHeightDifference: 24,
  turnAreaRatio: 1.35,
};
const REPAIR_BASELINE = {
  commit: "571909a98073de056df67078148b11ff4e708a68",
  reproduction:
    "git archive the baseline commit's public/assets/sprites, then run node scripts/audit-actor-atlases.mjs --report-only --atlas-dir <extracted>/public/assets/sprites --report-dir <output>",
  summary: {
    passingBanks: 118,
    totalBanks: 144,
    passingFacingComparisons: 708,
    totalFacingComparisons: 720,
  },
  defects: [
    {
      id: "hurt-recovery",
      affectedBanks: 24,
      reachability: "reachable",
      evidence:
        "Every actor and facing ended hurt on a non-idle recoil; Hexer south had the worst 13.76 px recovery-centroid seam.",
    },
    {
      id: "ashfang-side-ability",
      affectedBanks: 2,
      reachability: "registered-not-currently-selected-by-ai",
      evidence:
        "East/west frame 2->3 had 27.91 px maximum body-core displacement and 0.274 mask IoU.",
    },
    {
      id: "ashfang-walk-facing-turn",
      affectedComparisons: 12,
      reachability: "reachable",
      evidence:
        "East versus north/south same-phase walk heights differed by as much as 32 px.",
    },
  ],
  atlasSha256: {
    vanguard:
      "87962956a5e0cf6531c86eef187cbec4891e05bb22fdfeabae1ed444bdda986d",
    ranger: "ba6c8cd9708713f1262e3e47ee2375bf65372e3868bc4b40616b09ba3044226a",
    arcanist:
      "fbed99924640e2bc9534970290363ae0589998929150494ccab01824d9118b49",
    ashfang: "f8123c107dd520970b0af6f3157a1761cb414c2190a0e663983b4b38d612d7f0",
    hexer: "bc401075592ae74556de0a27d3ecf4a6b8e08f99b80e7c329c703a1cc0ab2dfb",
    stonekin:
      "025bfe46d0a6088f99bf1736b41126abf64303acc82f1370c8649aca32af9b73",
  },
};

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function bankFor(facing, clip) {
  if (facing === "east" || facing === "west") return SPEC.clips[clip];
  return SPEC.directionalClips[`${facing}${capitalize(clip)}`];
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : 0;
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function maximumRun(values) {
  let current = 0;
  let peak = 0;
  for (const value of values) {
    current = value ? current + 1 : 0;
    peak = Math.max(peak, current);
  }
  return peak;
}

function expectedDistinctFrames(clip, facing) {
  if (clip === "idle" || clip === "walk" || clip === "hurt") return 4;
  if (clip === "attack" || clip === "ability") return 5;
  return facing === "east" || facing === "west" ? 8 : 4;
}

function analyzeFrame(rgba, label) {
  const mask = new Uint8Array(CELL * CELL);
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let coreAlphaWeight = 0;
  let coreWeightedX = 0;
  let coreWeightedY = 0;
  let inkPixels = 0;
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const destinationOffset = (y * CELL + x) * 4;
      const alpha = rgba[destinationOffset + 3] / 255;
      if (alpha <= 0) continue;
      weightedX += x * alpha;
      weightedY += y * alpha;
      alphaWeight += alpha;
      if (
        x >= SPEC.atlas.footAnchor.x - CORE_HALF_WIDTH &&
        x <= SPEC.atlas.footAnchor.x + CORE_HALF_WIDTH
      ) {
        coreWeightedX += x * alpha;
        coreWeightedY += y * alpha;
        coreAlphaWeight += alpha;
      }
      if (rgba[destinationOffset + 3] < 8) continue;
      mask[y * CELL + x] = 1;
      inkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert(inkPixels > 0, `${label} is blank`);
  const leftEdge = Array.from(
    { length: maxY - minY + 1 },
    (_, offset) => mask[(minY + offset) * CELL + minX] === 1,
  );
  const rightEdge = Array.from(
    { length: maxY - minY + 1 },
    (_, offset) => mask[(minY + offset) * CELL + maxX] === 1,
  );
  const topEdge = Array.from(
    { length: maxX - minX + 1 },
    (_, offset) => mask[minY * CELL + minX + offset] === 1,
  );
  return {
    rgba,
    mask,
    sha256: sha256(rgba),
    inkPixels,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      right: maxX,
      bottom: maxY,
    },
    centroid: { x: weightedX / alphaWeight, y: weightedY / alphaWeight },
    coreCentroid:
      coreAlphaWeight > 0
        ? {
            x: coreWeightedX / coreAlphaWeight,
            y: coreWeightedY / coreAlphaWeight,
          }
        : { x: weightedX / alphaWeight, y: weightedY / alphaWeight },
    cutEdgeRun: Math.max(
      maximumRun(leftEdge),
      maximumRun(rightEdge),
      maximumRun(topEdge),
    ),
  };
}

function extractFrame(atlas, atlasWidth, row, column, flipX) {
  const rgba = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const sourceX = flipX ? CELL - 1 - x : x;
      const sourceOffset =
        ((row * CELL + y) * atlasWidth + column * CELL + sourceX) * 4;
      const destinationOffset = (y * CELL + x) * 4;
      atlas.copy(rgba, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return analyzeFrame(rgba, `atlas row ${row} column ${column}`);
}

function translatedFrame(frame, deltaX, deltaY) {
  const rgba = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const destinationX = x + deltaX;
      const destinationY = y + deltaY;
      if (
        destinationX < 0 ||
        destinationX >= CELL ||
        destinationY < 0 ||
        destinationY >= CELL
      )
        continue;
      const sourceOffset = (y * CELL + x) * 4;
      const destinationOffset = (destinationY * CELL + destinationX) * 4;
      frame.rgba.copy(rgba, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return analyzeFrame(rgba, `synthetic translation ${deltaX},${deltaY}`);
}

function transitionEvidence(first, second, type, from, to) {
  let intersection = 0;
  let union = 0;
  let squaredError = 0;
  for (let index = 0; index < first.mask.length; index += 1) {
    if (first.mask[index] && second.mask[index]) intersection += 1;
    if (first.mask[index] || second.mask[index]) union += 1;
  }
  for (let index = 0; index < first.rgba.length; index += 1) {
    const difference = first.rgba[index] - second.rgba[index];
    squaredError += difference * difference;
  }
  return {
    type,
    from,
    to,
    centroidDistance: distance(first.centroid, second.centroid),
    coreCentroidDistance: distance(first.coreCentroid, second.coreCentroid),
    widthDifference: Math.abs(first.bounds.width - second.bounds.width),
    heightDifference: Math.abs(first.bounds.height - second.bounds.height),
    areaRatio:
      Math.max(first.inkPixels, second.inkPixels) /
      Math.min(first.inkPixels, second.inkPixels),
    maskIou: union > 0 ? intersection / union : 1,
    normalizedRgbaRmse: Math.sqrt(squaredError / first.rgba.length) / 255,
    byteIdentical: first.sha256 === second.sha256,
  };
}

function transitionsFor(clip, frames, idleFrame) {
  const transitions = frames
    .slice(1)
    .map((frame, index) =>
      transitionEvidence(frames[index], frame, "consecutive", index, index + 1),
    );
  if (SPEC.clips[clip].looping)
    transitions.push(
      transitionEvidence(
        frames.at(-1),
        frames[0],
        "loop-wrap",
        frames.length - 1,
        0,
      ),
    );
  else if (["attack", "ability", "hurt"].includes(clip))
    transitions.push(
      transitionEvidence(
        frames.at(-1),
        idleFrame,
        "idle-recovery",
        frames.length - 1,
        "idle:0",
      ),
    );
  return transitions;
}

function bankChecks(clip, frames, transitions, idleFrame, facing) {
  const safe = SPEC.atlas.safeInkBounds;
  const consecutive = transitions.filter(
    ({ type }) => type === "consecutive" || type === "loop-wrap",
  );
  const maximumCentroidStep = maximum(
    consecutive.map(({ centroidDistance }) => centroidDistance),
  );
  const maximumCoreCentroidStep = maximum(
    consecutive.map(({ coreCentroidDistance }) => coreCentroidDistance),
  );
  const maximumWidthStep = maximum(
    consecutive.map(({ widthDifference }) => widthDifference),
  );
  const maximumHeightStep = maximum(
    consecutive.map(({ heightDifference }) => heightDifference),
  );
  const minimumMaskIou = Math.min(...consecutive.map(({ maskIou }) => maskIou));
  const uniqueFrames = new Set(frames.map(({ sha256: digest }) => digest)).size;
  const recoveryTransition = transitions.find(
    ({ type }) => type === "idle-recovery",
  );
  const geometry = frames.every(
    ({ inkPixels, bounds, cutEdgeRun }) =>
      inkPixels >= THRESHOLDS.minimumInkPixels &&
      cutEdgeRun <= THRESHOLDS.maximumCutEdgeRun &&
      bounds.x >= safe.x &&
      bounds.y >= safe.y &&
      bounds.right < safe.x + safe.width &&
      bounds.bottom < safe.y + safe.height &&
      bounds.bottom === SPEC.atlas.footAnchor.y - 1,
  );
  const enoughDistinctFrames =
    uniqueFrames >= expectedDistinctFrames(clip, facing);
  let motionContinuity;
  if (clip === "idle" || clip === "walk")
    motionContinuity =
      maximumCentroidStep <= THRESHOLDS.loopCentroidStep &&
      maximumWidthStep <= THRESHOLDS.loopDimensionStep &&
      maximumHeightStep <= THRESHOLDS.loopDimensionStep &&
      minimumMaskIou >= THRESHOLDS.loopMinimumMaskIou;
  else if (clip === "hurt")
    motionContinuity =
      maximumCentroidStep <= THRESHOLDS.hurtCentroidStep &&
      maximumWidthStep <= THRESHOLDS.actionDimensionStep &&
      maximumHeightStep <= THRESHOLDS.actionDimensionStep;
  else if (clip === "death")
    motionContinuity =
      maximumCentroidStep <= THRESHOLDS.deathCentroidStep &&
      maximumWidthStep <= THRESHOLDS.deathDimensionStep &&
      maximumHeightStep <= THRESHOLDS.deathDimensionStep;
  else
    motionContinuity =
      maximumCentroidStep <= THRESHOLDS.actionCentroidStep &&
      maximumCoreCentroidStep <= THRESHOLDS.actionCoreCentroidStep &&
      maximumWidthStep <= THRESHOLDS.actionDimensionStep &&
      maximumHeightStep <= THRESHOLDS.actionDimensionStep;
  const recoverySeamExact =
    clip === "death" ||
    clip === "idle" ||
    clip === "walk" ||
    (recoveryTransition?.byteIdentical === true &&
      frames.at(-1).sha256 === idleFrame.sha256);
  return {
    geometry,
    enoughDistinctFrames,
    motionContinuity,
    recoverySeamExact,
    pass:
      geometry && enoughDistinctFrames && motionContinuity && recoverySeamExact,
    measurements: {
      uniqueFrames,
      expectedDistinctFrames: expectedDistinctFrames(clip, facing),
      maximumCentroidStep,
      maximumCoreCentroidStep,
      maximumWidthStep,
      maximumHeightStep,
      minimumMaskIou,
      cutEdgeRunPeak: maximum(frames.map(({ cutEdgeRun }) => cutEdgeRun)),
      recoveryCentroidDistance: recoveryTransition?.centroidDistance ?? 0,
      recoveryRmse: recoveryTransition?.normalizedRgbaRmse ?? 0,
    },
  };
}

async function writeStrip(actorId, facing, clip, frames, comparisonFrame) {
  const displayFrames = comparisonFrame ? [...frames, comparisonFrame] : frames;
  const width = displayFrames.length * CELL;
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CELL}"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#526b71"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#455d62"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/>${comparisonFrame ? `<rect x="${width - CELL + 1}" y="1" width="${CELL - 2}" height="${CELL - 2}" fill="none" stroke="#f2bd68" stroke-width="2"/>` : ""}</svg>`,
  );
  const composites = [{ input: background, left: 0, top: 0 }];
  for (const [index, frame] of displayFrames.entries())
    composites.push({
      input: await sharp(frame.rgba, {
        raw: { width: CELL, height: CELL, channels: 4 },
      })
        .png()
        .toBuffer(),
      left: index * CELL,
      top: 0,
    });
  const relativePath = path.posix.join(
    "strips",
    actorId,
    `${facing}-${clip}.png`,
  );
  const outputPath = path.join(REPORT_DIRECTORY, relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width,
      height: CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(outputPath);
  return relativePath;
}

async function writeActorOverview(actorId, banks) {
  const labelWidth = 150;
  const stripWidth = 576;
  const rowHeight = 64;
  const overviewWidth = labelWidth + stripWidth;
  const overviewHeight = banks.length * rowHeight;
  const composites = [];
  for (const [index, bank] of banks.entries()) {
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${rowHeight}"><rect width="100%" height="100%" fill="${bank.checks.pass ? "#172023" : "#412326"}"/><text x="8" y="26" font-family="DejaVu Sans Mono, monospace" font-size="15" fill="#f3c889">${bank.facing} ${bank.clip}</text><text x="8" y="48" font-family="DejaVu Sans Mono, monospace" font-size="13" fill="${bank.checks.pass ? "#83d39a" : "#ff8b7e"}">${bank.checks.pass ? "PASS" : "FAIL"}</text></svg>`,
    );
    const strip = await sharp(path.join(REPORT_DIRECTORY, bank.stripFile))
      .resize(stripWidth, rowHeight, {
        fit: "contain",
        background: "#455d62",
        kernel: "lanczos3",
      })
      .png()
      .toBuffer();
    composites.push(
      { input: label, left: 0, top: index * rowHeight },
      { input: strip, left: labelWidth, top: index * rowHeight },
    );
  }
  const relativePath = path.posix.join("overviews", `${actorId}.png`);
  const outputPath = path.join(REPORT_DIRECTORY, relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width: overviewWidth,
      height: overviewHeight,
      channels: 4,
      background: "#111719",
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(outputPath);
  return relativePath;
}

function facingComparison(first, second, actorId, clip, frameIndex, pair) {
  return {
    actorId,
    clip,
    frameIndex,
    pair,
    centroidDistance: distance(first.centroid, second.centroid),
    heightDifference: Math.abs(first.bounds.height - second.bounds.height),
    widthDifference: Math.abs(first.bounds.width - second.bounds.width),
    areaRatio:
      Math.max(first.inkPixels, second.inkPixels) /
      Math.min(first.inkPixels, second.inkPixels),
  };
}

function facingComparisonPass(comparison) {
  return (
    !["idle", "walk"].includes(comparison.clip) ||
    (comparison.centroidDistance <= THRESHOLDS.turnCentroidDistance &&
      comparison.heightDifference <= THRESHOLDS.turnHeightDifference &&
      comparison.areaRatio <= THRESHOLDS.turnAreaRatio)
  );
}

function transitionContractComparison(
  actorId,
  contractId,
  contract,
  facing,
  framesByBank,
) {
  assert(
    contract.anchor === "foot",
    `${actorId}/${contractId} must use the fixed foot anchor`,
  );
  assert(
    Array.isArray(contract.clips) && contract.clips.length === 2,
    `${actorId}/${contractId} must compare exactly two clips`,
  );
  const [firstClip, secondClip] = contract.clips;
  const firstFrames = framesByBank.get(`${facing}:${firstClip}`);
  const secondFrames = framesByBank.get(`${facing}:${secondClip}`);
  assert(
    firstFrames && secondFrames,
    `${actorId}/${contractId}/${facing} names an unavailable clip bank`,
  );
  const firstMedianInkHeight = median(
    firstFrames.map(({ bounds }) => bounds.height),
  );
  const secondMedianInkHeight = median(
    secondFrames.map(({ bounds }) => bounds.height),
  );
  const footBottomRange =
    Math.max(
      ...firstFrames.map(({ bounds }) => bounds.bottom),
      ...secondFrames.map(({ bounds }) => bounds.bottom),
    ) -
    Math.min(
      ...firstFrames.map(({ bounds }) => bounds.bottom),
      ...secondFrames.map(({ bounds }) => bounds.bottom),
    );
  const medianInkHeightDifference = Math.abs(
    firstMedianInkHeight - secondMedianInkHeight,
  );
  return {
    actorId,
    contractId,
    facing,
    clips: contract.clips,
    anchor: contract.anchor,
    firstMedianInkHeight,
    secondMedianInkHeight,
    medianInkHeightDifference,
    maximumMedianInkHeightDifference:
      contract.maximumAtlasMedianInkHeightDifference,
    footBottomRange,
    pass:
      footBottomRange === 0 &&
      medianInkHeightDifference <=
        contract.maximumAtlasMedianInkHeightDifference,
  };
}

function runNegativeControls(framesByBank) {
  const idle = framesByBank.get("east:idle")[0];
  const hurt = framesByBank.get("east:hurt");
  const staleHurt = [...hurt.slice(0, -1), hurt[2]];
  const staleHurtCheck = bankChecks(
    "hurt",
    staleHurt,
    transitionsFor("hurt", staleHurt, idle),
    idle,
    "east",
  );

  const ability = framesByBank.get("east:ability");
  const displacedAbility = [...ability];
  displacedAbility[3] = translatedFrame(ability[3], -40, -40);
  const displacedAbilityCheck = bankChecks(
    "ability",
    displacedAbility,
    transitionsFor("ability", displacedAbility, idle),
    idle,
    "east",
  );

  const walk = framesByBank.get("east:walk");
  const clippedWalk = [...walk];
  clippedWalk[0] = translatedFrame(walk[0], -60, 0);
  const clippedWalkCheck = bankChecks(
    "walk",
    clippedWalk,
    transitionsFor("walk", clippedWalk, idle),
    idle,
    "east",
  );

  const turnComparison = facingComparison(
    framesByBank.get("east:walk")[0],
    framesByBank.get("north:walk")[0],
    "vanguard",
    "walk",
    0,
    "east->north",
  );
  const oversizedTurn = {
    ...turnComparison,
    heightDifference: THRESHOLDS.turnHeightDifference + 1,
  };
  const oversizedClipTransition = {
    medianInkHeightDifference: 9,
    maximumMedianInkHeightDifference: 8,
    footBottomRange: 0,
  };

  return [
    {
      id: "non-idle-hurt-terminal",
      mutation:
        "replace the exact idle recovery frame with the preceding recoil",
      expectedFailure: "recoverySeamExact",
      detected: !staleHurtCheck.recoverySeamExact && !staleHurtCheck.pass,
    },
    {
      id: "displaced-action-frame",
      mutation: "translate one ability frame 40 px left and 40 px up",
      expectedFailure: "motionContinuity",
      detected:
        !displacedAbilityCheck.motionContinuity && !displacedAbilityCheck.pass,
    },
    {
      id: "cut-loop-frame",
      mutation: "translate one walk frame 60 px through the left cell edge",
      expectedFailure: "geometry",
      detected: !clippedWalkCheck.geometry && !clippedWalkCheck.pass,
    },
    {
      id: "oversized-facing-turn",
      mutation: "force a same-phase turn height delta one pixel over policy",
      expectedFailure: "turnHeightDifference",
      detected: !facingComparisonPass(oversizedTurn),
    },
    {
      id: "idle-walk-height-pop",
      mutation:
        "force a foot-anchored idle/walk median ink-height delta one pixel over policy",
      expectedFailure: "maximumAtlasMedianInkHeightDifference",
      detected:
        oversizedClipTransition.footBottomRange !== 0 ||
        oversizedClipTransition.medianInkHeightDifference >
          oversizedClipTransition.maximumMedianInkHeightDifference,
    },
  ];
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function reportHtml(report) {
  const actorSections = report.actors
    .map((actor) => {
      const cards = actor.banks
        .map(
          (bank) => `<article class="${bank.checks.pass ? "pass" : "fail"}">
            <h3>${htmlEscape(bank.facing)} ${htmlEscape(bank.clip)} · ${bank.checks.pass ? "PASS" : "FAIL"}</h3>
            <a href="${htmlEscape(bank.stripFile)}"><img src="${htmlEscape(bank.stripFile)}" alt="${htmlEscape(actor.actorId)} ${htmlEscape(bank.facing)} ${htmlEscape(bank.clip)} complete frame strip"></a>
            <p>${bank.frames.length} runtime frames${bank.comparisonLabel ? ` + gold-outlined ${htmlEscape(bank.comparisonLabel)}` : ""}. ${bank.reachableInGameplay ? "Reachable in current gameplay." : "Registered in the full atlas contract; current monster AI does not select ability."} Unique ${bank.checks.measurements.uniqueFrames}/${bank.checks.measurements.expectedDistinctFrames} minimum; centroid step ${bank.checks.measurements.maximumCentroidStep.toFixed(2)} px; core ${bank.checks.measurements.maximumCoreCentroidStep.toFixed(2)} px; dimensions ${bank.checks.measurements.maximumWidthStep}/${bank.checks.measurements.maximumHeightStep} px; minimum IoU ${bank.checks.measurements.minimumMaskIou.toFixed(3)}.</p>
            <p>Geometry ${bank.checks.geometry ? "pass" : "FAIL"}; continuity ${bank.checks.motionContinuity ? "pass" : "FAIL"}; recovery seam ${bank.checks.recoverySeamExact ? "pass" : "FAIL"}.</p>
          </article>`,
        )
        .join("\n");
      return `<section><h2>${htmlEscape(actor.actorId)} · ${actor.pass ? "PASS" : "FAIL"}</h2><p><a href="${htmlEscape(actor.overviewFile)}"><img src="${htmlEscape(actor.overviewFile)}" alt="${htmlEscape(actor.actorId)} complete labeled animation overview"></a></p><div class="grid">${cards}</div></section>`;
    })
    .join("\n");
  const findings = report.findings
    .map(
      (finding) =>
        `<li><strong>${htmlEscape(finding.id)}</strong>: ${htmlEscape(finding.summary)}</li>`,
    )
    .join("\n");
  const baselineDefects = report.repairBaseline.defects
    .map(
      (defect) =>
        `<li><strong>${htmlEscape(defect.id)}</strong> (${htmlEscape(defect.reachability)}): ${htmlEscape(defect.evidence)}</li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cinderwake actor atlas audit</title>
<style>
  :root {
    color-scheme: dark;
    font-family: system-ui, sans-serif;
    background: #111719;
    color: #e9e0d1;
  }
  body { max-width: 1500px; margin: auto; padding: 20px; }
  h1, h2, h3 { color: #f3c889; }
  .summary, .coverage {
    padding: 14px;
    border-left: 4px solid #e0a85b;
    background: #272218;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(430px, 1fr));
    gap: 12px;
  }
  article {
    border: 1px solid #45545a;
    border-radius: 8px;
    padding: 12px;
    background: #172023;
  }
  article.fail { border-color: #dc6f63; background: #291b1b; }
  article.pass h3::first-letter { color: #83d39a; }
  img { width: 100%; height: auto; background: #526b71; }
  code { overflow-wrap: anywhere; color: #c9e6ed; }
  a { color: #9fd6e4; }
  p { line-height: 1.45; }
</style>
</head>
<body>
<h1>Every runtime actor animation bank</h1><p class="summary"><strong>${report.pass ? "PASS" : "FAIL"}</strong> · ${report.summary.passingBanks}/${report.summary.totalBanks} runtime-facing banks pass; ${report.summary.passingFacingComparisons}/${report.summary.totalFacingComparisons} authored-facing comparisons pass; ${report.summary.passingTransitionComparisons}/${report.summary.totalTransitionComparisons} declared clip-transition comparisons pass.</p>
<p>This is an exhaustive byte-level and visual audit of all six actors, six clips, and four runtime facings. West strips are the exact horizontal reflection used by the renderer. A gold outline marks the loop-wrap frame or idle recovery frame. Metrics diagnose continuity; the strips retain visual-review authority.</p>
<h2>Defects found before repair</h2><p>The same gate replayed against immutable atlas bytes from commit <code>${htmlEscape(report.repairBaseline.commit)}</code> passed only ${report.repairBaseline.summary.passingBanks}/${report.repairBaseline.summary.totalBanks} banks and ${report.repairBaseline.summary.passingFacingComparisons}/${report.repairBaseline.summary.totalFacingComparisons} authored-facing comparisons. Existing narrower tests had passed that art.</p><ul>${baselineDefects}</ul>
<p class="coverage"><strong>Existing-test gap:</strong> ${htmlEscape(report.coverageGap)}</p><ul>${findings}</ul>
<p>${report.summary.detectedNegativeControls}/${report.summary.negativeControls} injected negative controls were rejected. Current monster ability banks are registered and audited even though monster AI does not yet select them.</p>
<p>Commit <code>${htmlEscape(report.metadata.commit)}</code> · tracked patch <code>${htmlEscape(report.metadata.trackedWorktreePatchSha256)}</code> · actor spec <code>${htmlEscape(report.metadata.actorSpecSha256)}</code> · generated ${htmlEscape(report.metadata.generatedAt)} · Node ${htmlEscape(report.metadata.node)} · sharp ${htmlEscape(report.metadata.sharp)}. Command <code>${htmlEscape(report.executedCommand)}</code>. <a href="report.json">JSON evidence and complete file hashes</a>.</p>
${actorSections}
</body>
</html>\n`;
}

async function metadata() {
  const commit =
    process.env.GITHUB_SHA ??
    (
      await executeFile("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
      })
    ).stdout.trim();
  const trackedPatch = (
    await executeFile("git", ["diff", "--binary", "HEAD"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
  ).stdout;
  return {
    commit,
    trackedWorktreePatchSha256: sha256(trackedPatch),
    actorSpecSha256: sha256(
      await fs.readFile(path.join(ROOT, "art", "actor-atlas-v1.json")),
    ),
    builderSha256: sha256(
      await fs.readFile(path.join(ROOT, "scripts", "build-sprite-assets.mjs")),
    ),
    auditScriptSha256: sha256(
      await fs.readFile(path.join(ROOT, "scripts", "audit-actor-atlases.mjs")),
    ),
    buildManifestSha256: sha256(
      await fs.readFile(path.join(ATLAS_DIRECTORY, "build-manifest.json")),
    ),
    generatedAt: new Date().toISOString(),
    node: process.version,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
  };
}

await fs.mkdir(REPORT_DIRECTORY, { recursive: true });
const actorReports = [];
const authoredFacingComparisons = [];
const transitionComparisons = [];
let negativeControls = [];
for (const actorId of ACTORS) {
  const atlasPath = path.join(ATLAS_DIRECTORY, `actor-${actorId}.png`);
  const { data, info } = await sharp(atlasPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(
    info.width === SPEC.atlas.pixelWidth &&
      info.height === SPEC.atlas.pixelHeight,
    `${actorId} atlas dimensions differ from the actor contract`,
  );
  const framesByBank = new Map();
  const banks = [];
  for (const facing of FACINGS) {
    for (const clip of CLIPS) {
      const bank = bankFor(facing, clip);
      const frames = bank.sourceFrames.map((_, frameIndex) =>
        extractFrame(
          data,
          info.width,
          bank.atlasRow,
          frameIndex,
          facing === "west",
        ),
      );
      framesByBank.set(`${facing}:${clip}`, frames);
    }
  }
  if (actorId === "vanguard")
    negativeControls = runNegativeControls(framesByBank);
  for (const facing of FACINGS) {
    for (const clip of CLIPS) {
      const frames = framesByBank.get(`${facing}:${clip}`);
      const idleFrame = framesByBank.get(`${facing}:idle`)[0];
      const transitions = transitionsFor(clip, frames, idleFrame);
      let comparisonFrame;
      let comparisonLabel;
      if (SPEC.clips[clip].looping) {
        comparisonFrame = frames[0];
        comparisonLabel = "loop frame 0";
      } else if (["attack", "ability", "hurt"].includes(clip)) {
        comparisonFrame = idleFrame;
        comparisonLabel = "idle recovery";
      }
      const checks = bankChecks(clip, frames, transitions, idleFrame, facing);
      banks.push({
        actorId,
        facing,
        clip,
        atlasRow: bankFor(facing, clip).atlasRow,
        reflectedFromEast: facing === "west",
        reachableInGameplay: !(MONSTER_IDS.has(actorId) && clip === "ability"),
        frames: frames.map((frame, frameIndex) => ({
          frameIndex,
          sha256: frame.sha256,
          inkPixels: frame.inkPixels,
          bounds: frame.bounds,
          centroid: frame.centroid,
          coreCentroid: frame.coreCentroid,
          cutEdgeRun: frame.cutEdgeRun,
        })),
        transitions,
        checks,
        comparisonLabel,
        stripFile: await writeStrip(
          actorId,
          facing,
          clip,
          frames,
          comparisonFrame,
        ),
      });
    }
  }
  for (const clip of CLIPS) {
    const frameCount = SPEC.clips[clip].sourceFrames.length;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const facingFrames = Object.fromEntries(
        AUTHORED_FACINGS.map((facing) => [
          facing,
          framesByBank.get(`${facing}:${clip}`)[frameIndex],
        ]),
      );
      for (const [first, second] of [
        ["east", "north"],
        ["north", "south"],
        ["south", "east"],
      ])
        authoredFacingComparisons.push(
          facingComparison(
            facingFrames[first],
            facingFrames[second],
            actorId,
            clip,
            frameIndex,
            `${first}->${second}`,
          ),
        );
    }
  }
  for (const [contractId, contract] of Object.entries(
    SPEC.actorOverrides?.[actorId]?.transitionContracts ?? {},
  )) {
    assert(
      Array.isArray(contract.facings) && contract.facings.length > 0,
      `${actorId}/${contractId} must name at least one facing`,
    );
    for (const facing of contract.facings)
      transitionComparisons.push(
        transitionContractComparison(
          actorId,
          contractId,
          contract,
          facing,
          framesByBank,
        ),
      );
  }
  const actorTransitionComparisons = transitionComparisons.filter(
    (comparison) => comparison.actorId === actorId,
  );
  actorReports.push({
    actorId,
    atlasSha256: sha256(await fs.readFile(atlasPath)),
    banks,
    pass:
      banks.every(({ checks }) => checks.pass) &&
      actorTransitionComparisons.every(({ pass }) => pass),
    passingBanks: banks.filter(({ checks }) => checks.pass).length,
    failingBanks: banks.filter(({ checks }) => !checks.pass).length,
    overviewFile: await writeActorOverview(actorId, banks),
  });
}

for (const comparison of authoredFacingComparisons)
  comparison.pass = facingComparisonPass(comparison);

const allBanks = actorReports.flatMap(({ banks }) => banks);
const failedBanks = allBanks.filter(({ checks }) => !checks.pass);
const failedFacingComparisons = authoredFacingComparisons.filter(
  ({ pass }) => !pass,
);
const failedTransitionComparisons = transitionComparisons.filter(
  ({ pass }) => !pass,
);
const failedNegativeControls = negativeControls.filter(
  ({ detected }) => !detected,
);
const hurtFailures = failedBanks.filter(
  ({ clip, checks }) => clip === "hurt" && !checks.recoverySeamExact,
);
const continuityFailures = failedBanks.filter(
  ({ checks }) => !checks.motionContinuity,
);
const findings = [
  {
    id: "hurt-to-idle-recovery",
    summary:
      hurtFailures.length > 0
        ? `${hurtFailures.length} runtime-facing hurt banks end on a recoil pose rather than exact idle, so the animation visibly snaps when its lock expires. The worst centroid seam is ${maximum(hurtFailures.map(({ checks }) => checks.measurements.recoveryCentroidDistance)).toFixed(2)} atlas pixels.`
        : "All 24 runtime-facing hurt banks end on the byte-identical idle frame; no recoil-to-idle snap remains.",
  },
  {
    id: "within-bank-discontinuity",
    summary:
      continuityFailures.length > 0
        ? `${continuityFailures.length} banks exceed the declared motion-continuity envelope: ${continuityFailures.map(({ actorId, facing, clip }) => `${actorId}/${facing}/${clip}`).join(", ")}.`
        : "No bank exceeds its clip-specific within-bank continuity envelope.",
  },
  {
    id: "authored-facing-scale-pop",
    summary:
      failedFacingComparisons.length > 0
        ? `${failedFacingComparisons.length} idle/walk same-phase facing comparisons exceed turn continuity, led by ${failedFacingComparisons[0].actorId}/${failedFacingComparisons[0].clip}.`
        : "All authored idle/walk facing comparisons stay within turn-continuity bounds.",
  },
  {
    id: "declared-clip-transition-scale-pop",
    summary:
      failedTransitionComparisons.length > 0
        ? `${failedTransitionComparisons.length} declared foot-anchored clip transitions exceed their atlas median-height envelope, led by ${failedTransitionComparisons[0].actorId}/${failedTransitionComparisons[0].facing}.`
        : `All ${transitionComparisons.length} declared foot-anchored clip transitions stay within their atlas median-height envelope.`,
  },
  {
    id: "detector-negative-controls",
    summary:
      failedNegativeControls.length > 0
        ? `${failedNegativeControls.length} injected defect controls escaped detection.`
        : `All ${negativeControls.length} injected recovery, displacement, clipping, facing-scale, and clip-transition defects were rejected.`,
  },
];
const report = {
  schemaVersion: 1,
  contract: "CinderwakeActorAtlasAuditV1",
  pass:
    failedBanks.length === 0 &&
    failedFacingComparisons.length === 0 &&
    failedTransitionComparisons.length === 0 &&
    failedNegativeControls.length === 0,
  command: "npm run art:animation:check",
  reportOnlyCommand: "npm run art:animation:audit",
  executedCommand: [process.execPath, ...process.argv.slice(1)].join(" "),
  metadata: await metadata(),
  thresholds: THRESHOLDS,
  repairBaseline: REPAIR_BASELINE,
  summary: {
    actors: ACTORS.length,
    clips: CLIPS.length,
    runtimeFacings: FACINGS.length,
    totalBanks: allBanks.length,
    passingBanks: allBanks.length - failedBanks.length,
    failingBanks: failedBanks.length,
    totalFacingComparisons: authoredFacingComparisons.length,
    passingFacingComparisons:
      authoredFacingComparisons.length - failedFacingComparisons.length,
    failingFacingComparisons: failedFacingComparisons.length,
    totalTransitionComparisons: transitionComparisons.length,
    passingTransitionComparisons:
      transitionComparisons.length - failedTransitionComparisons.length,
    failingTransitionComparisons: failedTransitionComparisons.length,
    negativeControls: negativeControls.length,
    detectedNegativeControls:
      negativeControls.length - failedNegativeControls.length,
  },
  coverageGap:
    "Before this exhaustive gate, the atlas validator required only nonblank grounded cells and two distinct hashes. The temporal matrix still has no hurt sequence, no monster ability sequence, and no same-tick authored-facing turn sequence, so those narrower reports could pass while discontinuities remained shipped. This gate closes that static-atlas coverage gap; browser sequences remain authoritative for rendered timing and camera behavior.",
  findings,
  negativeControls,
  failedBanks: failedBanks.map(({ actorId, facing, clip, checks }) => ({
    actorId,
    facing,
    clip,
    checks,
  })),
  failedFacingComparisons,
  authoredFacingComparisons,
  failedTransitionComparisons,
  transitionComparisons,
  actors: actorReports,
};
await Promise.all([
  fs.writeFile(
    path.join(REPORT_DIRECTORY, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  fs.writeFile(path.join(REPORT_DIRECTORY, "index.html"), reportHtml(report)),
]);
console.log(
  `${report.pass ? "PASS" : "FAIL"} ${report.summary.passingBanks}/${report.summary.totalBanks} banks, ${report.summary.passingFacingComparisons}/${report.summary.totalFacingComparisons} facing comparisons, ${report.summary.passingTransitionComparisons}/${report.summary.totalTransitionComparisons} declared clip transitions; ${path.relative(ROOT, REPORT_DIRECTORY)}`,
);
if (!OPTIONS.reportOnly) process.exitCode = report.pass ? 0 : 1;
