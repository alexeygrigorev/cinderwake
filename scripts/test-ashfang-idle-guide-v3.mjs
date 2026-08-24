import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  CONTRACT,
  inspect,
  render,
  validateContract,
  validateSpatialRelationships,
  validateSvg,
} from "./build-ashfang-idle-guide-v3.mjs";

const execute = promisify(execFile);
const root = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cloneContract() {
  return structuredClone(CONTRACT);
}

function expectRejected(mutator, message) {
  const contract = cloneContract();
  mutator(contract);
  let evidence = "";
  try {
    validateContract(contract);
  } catch (error) {
    evidence = String(error.message);
  }
  assert(
    evidence.includes(message),
    `negative control did not reject ${message}`,
  );
}

expectRejected((contract) => {
  contract.routes[0].points[1][0] += 1;
}, "farHind coordinates changed");
expectRejected((contract) => {
  contract.routes[1].points[2][1] = 764;
}, "nearHind coordinates changed");

const badGap = cloneContract();
badGap.routes[2].points[1][0] = 650;
badGap.routes[2].points[2][0] = 645;
let gapEvidence = "";
try {
  validateSpatialRelationships(badGap);
} catch (error) {
  gapEvidence = String(error.message);
}
assert(
  gapEvidence.includes("separation below elbows is insufficient"),
  "negative control did not reject insufficient FF gap",
);

const badBaseline = cloneContract();
badBaseline.routes[1].points[2][1] = 764;
let baselineEvidence = "";
try {
  validateSpatialRelationships(badBaseline);
} catch (error) {
  baselineEvidence = String(error.message);
}
assert(
  baselineEvidence.includes("near-paw baseline is wrong"),
  "negative control did not reject wrong baseline",
);

const badMidpoint = cloneContract();
badMidpoint.nearPairMidpointX = 521;
let midpointEvidence = "";
try {
  validateSpatialRelationships(badMidpoint);
} catch (error) {
  midpointEvidence = String(error.message);
}
assert(
  midpointEvidence.includes("near-paw midpoint is wrong"),
  "negative control did not reject wrong midpoint",
);

let closedEvidence = "";
try {
  validateSvg('<svg><path d="M0 0 L1 1 Z"/></svg>');
} catch (error) {
  closedEvidence = String(error.message);
}
assert(
  closedEvidence.includes("closed path is forbidden"),
  "negative control did not reject closed shape",
);

const first = await render();
const second = await render();
assert(first.equals(second), "v3 render is not byte-identical");
await inspect(first);
const excessive = await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 255, g: 0, b: 255, alpha: 1 },
  },
})
  .composite([
    {
      input: await sharp({
        create: {
          width: 700,
          height: 700,
          channels: 4,
          background: { r: 13, g: 45, b: 56, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
      left: 100,
      top: 100,
    },
  ])
  .png()
  .toBuffer();
let occupancyEvidence = "";
try {
  await inspect(excessive);
} catch (error) {
  occupancyEvidence = String(error.message);
}
assert(
  occupancyEvidence.includes("excessive occupancy"),
  "negative control did not reject excessive occupancy",
);
const run = await execute(
  process.execPath,
  ["scripts/build-ashfang-idle-guide-v3.mjs", "--check"],
  { cwd: root },
);
assert(
  run.stdout.includes("Verified Ashfang sparse idle guide v3"),
  "v3 check did not verify committed artifact",
);
console.log(
  "Ashfang idle guide v3 negative controls and deterministic rebuild passed.",
);
