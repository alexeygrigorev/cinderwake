import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CANVAS_SIZE = 1024;
const BACKGROUND = { red: 255, green: 0, blue: 255 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  root,
  "art/generation/guides/quadruped-pose-layout.png",
);
const manifestPath = path.join(
  root,
  "art/generation/guides/quadruped-pose-layout.v1.json",
);
const arguments_ = process.argv.slice(2);
const checkOnly = arguments_.includes("--check");

if (arguments_.some((argument) => argument !== "--check")) {
  throw new Error("Usage: node scripts/build-pose-layout-guide.mjs [--check]");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function guideSvg() {
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#ff00ff"/>

  <!-- Far supports diverge from the upper hip and shoulder. -->
  <path fill="#71848a" d="M382 326 C352 365 323 421 295 485 C276 529 258 568 260 601 C262 622 279 636 301 632 C326 627 337 602 342 574 C354 509 379 449 421 370 Z"/>
  <ellipse cx="287" cy="624" rx="50" ry="25" transform="rotate(-12 287 624)" fill="#93a6aa"/>
  <g transform="translate(-110 0)">
    <path fill="#69877d" d="M604 399 C615 446 630 497 647 553 C658 588 665 618 680 641 C692 658 718 659 731 643 C743 628 732 603 717 575 C688 520 675 464 672 419 Z"/>
    <ellipse cx="709" cy="649" rx="50" ry="25" transform="rotate(12 709 649)" fill="#91aaa0"/>
  </g>

  <!-- One connected hooked tail, diagonal body, neck, head, and muzzle silhouette. -->
  <path fill="#34454a" d="M358 371 C310 347 252 308 225 267 C207 239 211 217 229 202 C246 189 265 200 270 220 C276 240 264 257 250 269 C281 305 327 327 377 336 Z"/>
  <ellipse cx="505" cy="410" rx="218" ry="133" transform="rotate(18 505 410)" fill="#34454a"/>
  <ellipse cx="502" cy="386" rx="177" ry="88" transform="rotate(18 502 386)" fill="#596d6e"/>
  <path fill="#34454a" d="M624 401 C662 377 713 384 750 418 C785 450 796 499 775 537 C754 575 707 591 666 573 C626 555 601 514 603 468 C604 438 611 414 624 401 Z"/>
  <path fill="#34454a" d="M730 474 C766 474 807 491 828 518 C844 538 838 565 817 581 C795 598 758 591 733 573 C710 556 702 531 711 507 C715 495 722 484 730 474 Z"/>
  <path fill="#34454a" d="M651 415 L662 331 C664 316 680 310 690 323 L735 423 Z"/>
  <path fill="#34454a" d="M704 425 L742 354 C749 341 764 344 768 358 L772 465 Z"/>
  <path fill="#718486" d="M647 428 C681 401 724 413 751 446 C722 435 692 440 668 457 C653 468 641 453 647 428 Z"/>

  <!-- Near supports diverge from the lower hip and shoulder. -->
  <path fill="#b57f4a" d="M390 455 C390 510 386 570 379 630 C373 682 365 725 375 757 C382 779 408 790 428 776 C447 763 445 731 443 694 C438 619 450 548 466 482 Z"/>
  <ellipse cx="405" cy="770" rx="52" ry="25" transform="rotate(-8 405 770)" fill="#d3a36b"/>
  <path fill="#ad7042" d="M628 507 C650 555 678 610 707 662 C731 706 744 747 762 772 C777 792 807 796 822 778 C836 761 814 729 793 695 C752 630 728 572 715 527 Z"/>
  <ellipse cx="797" cy="774" rx="52" ry="25" transform="rotate(9 797 774)" fill="#d19863"/>

  <!-- Small top-facing facial planes clarify east without labels or props. -->
  <path fill="#98a8a7" d="M774 520 C795 520 814 529 823 543 C808 537 793 538 779 547 Z"/>
  <ellipse cx="747" cy="465" rx="10" ry="8" transform="rotate(18 747 465)" fill="#d9c781"/>
</svg>
`);
}

async function renderGuide() {
  return sharp(guideSvg(), { density: 72 })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      effort: 10,
      palette: false,
    })
    .toBuffer();
}

function isLiteralMagenta(data, offset) {
  return (
    data[offset] === BACKGROUND.red &&
    data[offset + 1] === BACKGROUND.green &&
    data[offset + 2] === BACKGROUND.blue
  );
}

function ratioInRegion(data, info, region, predicate) {
  let matches = 0;
  let pixels = 0;
  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      pixels += 1;
      if (predicate(data, offset)) matches += 1;
    }
  }
  return matches / pixels;
}

async function inspectGuide(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== CANVAS_SIZE ||
    info.height !== CANVAS_SIZE ||
    info.channels !== 4
  ) {
    throw new Error(
      `Guide must decode as 1024x1024 RGBA; received ${info.width}x${info.height}x${info.channels}`,
    );
  }

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let literalMagentaPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] !== 255)
        throw new Error(`Guide contains transparency at ${x},${y}`);
      if (isLiteralMagenta(data, offset)) {
        literalMagentaPixels += 1;
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Guide is blank");

  const occupied = {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  const widthRatio = occupied.width / CANVAS_SIZE;
  const heightRatio = occupied.height / CANVAS_SIZE;
  const contactRatio = occupied.bottom / CANVAS_SIZE;
  if (widthRatio < 0.6 || widthRatio > 0.64)
    throw new Error(`Occupied width ratio ${widthRatio} is outside 0.60-0.64`);
  if (heightRatio < 0.58 || heightRatio > 0.63)
    throw new Error(
      `Occupied height ratio ${heightRatio} is outside 0.58-0.63`,
    );
  if (contactRatio < 0.77 || contactRatio > 0.79)
    throw new Error(
      `Lowest contact ratio ${contactRatio} is outside 0.77-0.79`,
    );

  const literalMagentaRatio =
    literalMagentaPixels / (CANVAS_SIZE * CANVAS_SIZE);
  if (literalMagentaRatio < 0.7)
    throw new Error(
      `Literal-magenta coverage ${literalMagentaRatio} is unexpectedly low`,
    );

  const pawRegions = [
    { name: "far hind", left: 230, top: 590, width: 115, height: 70 },
    { name: "near hind", left: 350, top: 735, width: 115, height: 70 },
    { name: "far fore", left: 540, top: 610, width: 115, height: 75 },
    { name: "near fore", left: 740, top: 735, width: 115, height: 75 },
  ];
  for (const paw of pawRegions) {
    const inkRatio = ratioInRegion(
      data,
      info,
      paw,
      (pixels, offset) => !isLiteralMagenta(pixels, offset),
    );
    if (inkRatio < 0.14)
      throw new Error(`${paw.name} paw is not legible (${inkRatio} ink)`);
  }

  const negativeSpaceChannels = [
    { name: "hind supports", left: 340, top: 590, width: 28, height: 105 },
    { name: "middle supports", left: 458, top: 600, width: 75, height: 105 },
    { name: "fore supports", left: 652, top: 605, width: 24, height: 70 },
  ];
  for (const channel of negativeSpaceChannels) {
    const magentaRatio = ratioInRegion(data, info, channel, isLiteralMagenta);
    if (magentaRatio < 0.84)
      throw new Error(
        `${channel.name} negative-space channel is too narrow (${magentaRatio} magenta)`,
      );
  }

  return {
    occupied,
    widthRatio,
    heightRatio,
    contactRatio,
    literalMagentaRatio,
  };
}

const firstBuild = await renderGuide();
const secondBuild = await renderGuide();
const firstHash = sha256(firstBuild);
const secondHash = sha256(secondBuild);
if (firstHash !== secondHash || !firstBuild.equals(secondBuild))
  throw new Error("Two clean guide renders were not byte-identical");

const inspection = await inspectGuide(firstBuild);
if (checkOnly) {
  const [committed, manifestBytes] = await Promise.all([
    readFile(outputPath),
    readFile(manifestPath),
  ]);
  const committedHash = sha256(committed);
  if (committedHash !== firstHash || !committed.equals(firstBuild))
    throw new Error(
      `Committed guide hash ${committedHash} differs from rebuilt hash ${firstHash}`,
    );
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.contract !== "CinderwakePoseLayoutGuideV1" ||
    manifest.file !== "art/generation/guides/quadruped-pose-layout.png" ||
    manifest.sha256 !== firstHash ||
    manifest.visualReview?.verdict !== "ACCEPT" ||
    manifest.visualReview?.reviewedSha256 !== firstHash ||
    typeof manifest.visualReview?.reviewer !== "string" ||
    manifest.visualReview.reviewer.length === 0 ||
    !Array.isArray(manifest.visualReview.acceptedAxes) ||
    manifest.visualReview.acceptedAxes.length < 4 ||
    !Array.isArray(manifest.visualReview.cautions) ||
    manifest.visualReview.cautions.length < 3
  )
    throw new Error("Pose-layout guide manifest or visual review is invalid");
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, firstBuild);
}

console.log(
  `${checkOnly ? "Verified" : "Built"} quadruped pose layout ${firstHash}: ` +
    `${inspection.occupied.width}x${inspection.occupied.height}px ink, ` +
    `lowest contact y=${inspection.occupied.bottom}.`,
);
