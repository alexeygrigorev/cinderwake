import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { availablePort } from "./lib/available-port.mjs";
import {
  assessExpectations,
  defaultFeedbackPlan,
  escapeHtml,
  feedbackVerdict,
  validateFeedbackPlan,
} from "./lib/feedback.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: npm run feedback -- [--plan plan.json] [--only case-id,case-id] [--output NEW_DIRECTORY] [--base-url URL]\nRuns behavioral probes and retains feedback.json, feedback.md, report.html, contact sheets and exact replay data.\nExit 0: declared checks pass (visual review still required). Exit 1: behavioral/runtime failure. Exit 2: invalid invocation.",
  );
  process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--plan", "--only", "--output", "--base-url"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  ) {
    console.error(`Unknown or incomplete option: ${args[i]}`);
    process.exit(2);
  }
  options[args[i].slice(2)] = args[i + 1];
}
let plan;
try {
  plan = validateFeedbackPlan(
    options.plan
      ? JSON.parse(await fs.readFile(options.plan, "utf8"))
      : defaultFeedbackPlan(),
  );
  if (options.only) {
    const selected = options.only.split(",");
    for (const id of selected)
      if (!plan.cases.some((entry) => entry.id === id))
        throw new Error(`Unknown case: ${id}`);
    plan = {
      ...plan,
      cases: plan.cases.filter(({ id }) => selected.includes(id)),
    };
  }
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
let output;
if (options.output) {
  output = path.resolve(options.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output); // Refuse existing evidence; never mix old and new results.
} else {
  await fs.mkdir("quality-results/feedback", { recursive: true });
  output = path.resolve(await fs.mkdtemp("quality-results/feedback/run-"));
}
const writeJson = (file, value) =>
  fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function sourceIdentity() {
  const git = (...values) =>
    execFileSync("git", values, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const commit = git("rev-parse", "HEAD").trim();
  const patch = git("diff", "HEAD", "--binary");
  const status = git("status", "--short");
  const untracked = {};
  for (const file of git("ls-files", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(
      (file) => file && !path.resolve(file).startsWith(`${output}${path.sep}`),
    ))
    untracked[file] = hash(await fs.readFile(file));
  return {
    commit,
    patch,
    status,
    untracked,
    fingerprint: hash(JSON.stringify({ commit, patch, untracked })),
  };
}
let browser;
let server;
const results = [];
const replayPlan = structuredClone(plan);
const metadata = {
  version: 1,
  startedAt: new Date().toISOString(),
  node: process.version,
  applicationSource: options["base-url"]
    ? "external server: source identity is unverified"
    : "local Vite server",
  reproductionCommand: `npm run feedback -- --plan ${shellQuote(path.join(output, "replay-plan.json"))}${options["base-url"] ? ` --base-url ${shellQuote(options["base-url"])}` : ""}`,
};
await writeJson(path.join(output, "plan.json"), plan);
await writeJson(path.join(output, "replay-plan.json"), replayPlan);
let source;

async function capture(page, directory, label, bridgeName) {
  const sample = await page.evaluate((name) => {
    const bridge = window[name];
    const snapshot = bridge.snapshot();
    const manifest = bridge.renderManifest();
    return {
      tick: snapshot.tick,
      snapshot,
      manifest,
      hash: bridge.stateHash?.() ?? null,
      canvas: bridge.captureFrame(),
    };
  }, bridgeName);
  const frame = `${label}-canvas.png`;
  const pageFrame = `${label}-page.png`;
  await page.screenshot({ path: path.join(directory, pageFrame) });
  await fs.writeFile(
    path.join(directory, `${label}-canvas.png`),
    Buffer.from(sample.canvas.split(",")[1], "base64"),
  );
  delete sample.canvas;
  return {
    ...sample,
    frame,
    pageFrame,
    pageFrameTiming:
      bridgeName === "__GAME_OBSERVE__"
        ? "Later live presentation; not synchronized to this tick"
        : "Paused at the captured tick",
  };
}

async function controlled(page, entry, directory, samples, checks) {
  await page.goto(`${metadata.baseURL}/?testMode=1`);
  await page.waitForFunction(() => window.__GAME_TEST__?.ready);
  const initial = await page.evaluate(
    ({ scenario, state }) =>
      state
        ? window.__GAME_TEST__.loadState(state)
        : window.__GAME_TEST__.loadScenario(scenario),
    entry,
  );
  await writeJson(path.join(directory, "initial-state.json"), initial);
  const replayCase = replayPlan.cases.find(({ id }) => id === entry.id);
  delete replayCase.scenario;
  replayCase.state = initial;
  await writeJson(path.join(output, "replay-plan.json"), replayPlan);
  if (entry.ticks[0] !== initial.tick)
    throw new Error("First capture tick must equal the initial state tick");
  if (
    entry.commands.some(
      ({ tick }) => tick < initial.tick || tick >= entry.ticks.at(-1),
    )
  )
    throw new Error(
      "Every command must execute within the captured tick interval",
    );
  await writeJson(path.join(directory, "commands.json"), entry.commands);
  await page.evaluate(
    (commands) => window.__GAME_TEST__.queueInputs(commands),
    entry.commands,
  );
  for (const tick of entry.ticks) {
    await page.evaluate((target) => {
      const bridge = window.__GAME_TEST__;
      bridge.step(target - bridge.snapshot().tick, { render: false });
      bridge.render();
    }, tick);
    samples.push(
      await capture(page, directory, `tick-${tick}`, "__GAME_TEST__"),
    );
  }
  checks.push(...assessExpectations(entry.expect, samples));
  // Reconstruct the retained state and replay the exact same input tape.
  const replay = await page.evaluate(
    ({ initial, commands, ticks }) => {
      const bridge = window.__GAME_TEST__;
      bridge.loadState(initial);
      bridge.queueInputs(commands);
      return ticks.map((tick) => {
        bridge.step(tick - bridge.snapshot().tick, { render: false });
        return { tick, hash: bridge.stateHash() };
      });
    },
    { initial, commands: entry.commands, ticks: entry.ticks },
  );
  await writeJson(path.join(directory, "replay.json"), replay);
  checks.push({
    id: "deterministic-replay",
    pass: replay.every((sample, index) => sample.hash === samples[index].hash),
    expected: samples.map(({ tick, hash }) => ({ tick, hash })),
    actual: replay,
    evidence: "replay.json",
    hint: "Compare canonical snapshots at the first divergent tick; input, RNG and initial state must match.",
  });
}

async function live(page, entry, directory, samples, checks) {
  const phone = entry.live.profile === "phone";
  const gestures = [];
  await page.goto(`${metadata.baseURL}/`);
  const activate = async (selector) =>
    phone ? page.locator(selector).tap() : page.locator(selector).click();
  await activate(`[data-class='${entry.live.classId}']`);
  await activate("#begin");
  await page.waitForFunction(() => window.__GAME_OBSERVE__?.ready);
  checks.push({
    id: "ordinary-route",
    pass: await page.evaluate(
      () =>
        !window.__GAME_TEST__ &&
        window.__GAME_OBSERVE__.mode === "observe-only",
    ),
    evidence: "timeline.json",
  });
  samples.push(await capture(page, directory, "opening", "__GAME_OBSERVE__"));
  const session = phone ? await page.context().newCDPSession(page) : null;
  async function touch(type, x, y) {
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  }
  if (phone) {
    const box = await page.locator(".move-pad").boundingBox();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touch("touchStart", center.x, center.y);
    await touch("touchMove", center.x - 30, center.y);
    gestures.push({ action: "joystick-west", holdMs: 300, center });
  } else {
    await page.keyboard.down("a");
    gestures.push({ action: "keyboard-a", holdMs: 300 });
  }
  await page.waitForTimeout(300);
  if (phone) await touch("touchEnd");
  else await page.keyboard.up("a");
  await page.waitForTimeout(80);
  samples.push(await capture(page, directory, "moved", "__GAME_OBSERVE__"));
  const strike = page.locator(
    phone
      ? ".mobile-actions [data-action='attack']"
      : ".skills [data-action='attack']",
  );
  if (phone) {
    const box = await strike.boundingBox();
    await touch("touchStart", box.x + box.width / 2, box.y + box.height / 2);
  } else {
    const point = await page.evaluate(() => {
      const manifest = window.__GAME_OBSERVE__.renderManifest();
      const target = manifest.drawCalls.find(
        (call) => call.type === "monster" && call.visible,
      );
      const rect = document.querySelector("canvas").getBoundingClientRect();
      const anchor = target?.footAnchor ?? { x: 550, y: 300 };
      return {
        x: rect.x + (anchor.x / manifest.viewport.width) * rect.width,
        y: rect.y + (anchor.y / manifest.viewport.height) * rect.height,
      };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    gestures.push({ action: "mouse-aim", point });
  }
  gestures.push({
    action: phone ? "touch-hold-strike" : "mouse-hold-strike",
    holdMs: 1200,
  });
  await page.waitForTimeout(400);
  samples.push(await capture(page, directory, "strike", "__GAME_OBSERVE__"));
  await page.waitForTimeout(800);
  if (phone) await touch("touchEnd");
  else await page.mouse.up();
  samples.push(await capture(page, directory, "recovery", "__GAME_OBSERVE__"));
  await writeJson(path.join(directory, "gestures.json"), gestures);
  const [opening, moved] = samples;
  const final = samples.at(-1);
  const distance = Math.hypot(
    moved.snapshot.player.position.x - opening.snapshot.player.position.x,
    moved.snapshot.player.position.y - opening.snapshot.player.position.y,
  );
  checks.push({
    id: "physical-movement",
    pass: distance >= 200,
    actual: distance,
    expected: ">= 200 world units",
    evidence: "timeline.json",
    hint: "Inspect physical keyboard/joystick binding, collisions and live simulation time.",
  });
  const attacks = (sample, after) =>
    sample.snapshot.eventLog.filter(
      (event) =>
        event.sourceId === "player" &&
        event.type === "attack_started" &&
        event.tick > after,
    ).length;
  checks.push({
    id: "movement-does-not-attack",
    pass: attacks(moved, opening.tick) === 0,
    actual: attacks(moved, opening.tick),
    expected: 0,
    evidence: "timeline.json",
  });
  checks.push({
    id: "held-strike-repeats",
    pass: attacks(final, moved.tick) >= 2,
    actual: attacks(final, moved.tick),
    expected: ">= 2 player attacks",
    evidence: "timeline.json",
    hint: "Hold Strike through cooldown; inspect lost/released input or a stalled production loop.",
  });
  checks.push({
    id: "live-time",
    pass: final.tick - moved.tick >= 40,
    actual: final.tick - moved.tick,
    expected: ">= 40 simulation ticks during held strike",
    evidence: "timeline.json",
  });
}

async function writeReports(complete = false) {
  const verdict = feedbackVerdict(
    results,
    plan.cases.map(({ id }) => id),
    complete,
  );
  const failures = results.flatMap((entry) =>
    entry.checks
      .filter((check) => !check.pass)
      .map((check) => ({
        case: entry.id,
        ...check,
        evidence: check.evidence
          ? `${entry.id}/${check.evidence}`
          : "feedback.json",
      })),
  );
  const report = {
    version: 1,
    verdict,
    complete,
    plannedCases: plan.cases.map(({ id }) => id),
    visualVerdict: "NEEDS_VISUAL_REVIEW",
    coverage:
      "The default plan probes movement, primary/ability damage, kill, exit unlock, pickup and deterministic replay for three heroes, plus ordinary desktop/phone launch, movement and held Strike. Only plannedCases in this report were run. This does not establish fun, animation quality, whole-run completion, balance or native-device performance.",
    failures,
    cases: results,
    metadata,
  };
  await writeJson(path.join(output, "feedback.json"), report);
  const lines = [
    `# Game feedback: ${verdict}`,
    "",
    "Visual quality: NEEDS_VISUAL_REVIEW. Inspect the contact sheets and full-size frames before judging appearance or changing baselines.",
    "",
    ...failures.flatMap((failure) => [
      `- ${failure.case}/${failure.id}: ${failure.message ?? `expected ${JSON.stringify(failure.expected)}, observed ${JSON.stringify(failure.actual)}`}`,
      `  Evidence: ${failure.evidence}. ${failure.hint ?? ""}`,
    ]),
    "",
    `Checks: ${results.map((entry) => `${entry.id} ${entry.checks.filter((check) => check.pass).length}/${entry.checks.length}`).join("; ")}`,
    "",
    report.coverage,
    "",
    `Replay: ${metadata.reproductionCommand}`,
    "",
    "For the next iteration: reproduce a failed case, inspect its timeline and PNGs, fix the cause, add a causal expectation, and rerun. Passing numeric checks do not approve the art.",
  ];
  await fs.writeFile(path.join(output, "feedback.md"), `${lines.join("\n")}\n`);
  const cards = results
    .map(
      (entry) =>
        `<section><h2>${escapeHtml(entry.id)} — ${entry.checks.every((check) => check.pass) ? "PASS" : "FAIL"}</h2><ul>${entry.checks.map((check) => `<li class="${check.pass ? "pass" : "fail"}">${check.pass ? "PASS" : "FAIL"} ${escapeHtml(check.id)}: ${escapeHtml(check.message ?? JSON.stringify(check.actual ?? ""))} ${check.pass ? "" : escapeHtml(check.hint ?? "")}</li>`).join("")}</ul><p><a href="${entry.id}/timeline.json">State + render timeline</a> · <a href="${entry.id}/console.json">Browser faults</a> · <a href="${entry.id}/contact-sheet.png">Canvas contact sheet</a></p>${entry.frames.map((frame) => `<figure><a href="${entry.id}/${frame}"><img loading="lazy" src="${entry.id}/${frame}" alt="${escapeHtml(entry.id)} ${frame}"></a><figcaption>${frame}</figcaption></figure>`).join("")}<details><summary>Full page with HUD (live pages are later, unsynchronized samples)</summary>${(entry.pages ?? []).map((frame) => `<figure><a href="${entry.id}/${frame}"><img loading="lazy" src="${entry.id}/${frame}" alt="${frame}"></a><figcaption>${frame}</figcaption></figure>`).join("")}</details></section>`,
    )
    .join("");
  await fs.writeFile(
    path.join(output, "report.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Game feedback ${verdict}</title><style>body{background:#15191f;color:#eee;font:16px system-ui;max-width:1200px;margin:32px auto;padding:16px}section{border-top:1px solid #637080;margin-top:28px}figure{display:inline-block;width:30%;margin:1%;vertical-align:top}img{width:100%;height:auto}figcaption{font-size:12px}a{color:#9ed3ff}.pass{color:#9edbb4}.fail{color:#ff9b9b}li{margin:8px 0}</style><h1>Game feedback: ${verdict}</h1><p>Visual quality: NEEDS_VISUAL_REVIEW. Open full-size frames; passing checks do not approve appearance.</p><p>${escapeHtml(report.coverage)}</p><a href="feedback.json">Machine-readable feedback</a>${cards}</html>`,
  );
  if (!complete) return;
  console.log(
    `${verdict}: ${results.length} cases, ${failures.length} failed checks. Visual review required.\n${path.join(output, "feedback.md")}\n${path.join(output, "report.html")}`,
  );
  for (const failure of failures)
    console.error(
      `${failure.case}/${failure.id}: ${failure.message ?? JSON.stringify(failure.actual)} (${failure.evidence})`,
    );
  process.exitCode = verdict === "PASS" ? 0 : 1;
}

try {
  source = await sourceIdentity();
  metadata.source = {
    commit: source.commit,
    status: source.status,
    untracked: source.untracked,
    fingerprint: source.fingerprint,
  };
  await fs.writeFile(path.join(output, "source.patch"), source.patch);
  if (options["base-url"])
    metadata.baseURL = options["base-url"].replace(/\/$/, "");
  else {
    const port = await availablePort();
    metadata.baseURL = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
    for (let attempt = 0; ; attempt += 1) {
      if (server.exitCode !== null || attempt >= 100)
        throw new Error("Feedback server failed to start within 25 seconds");
      try {
        if (
          (await fetch(metadata.baseURL, { signal: AbortSignal.timeout(1000) }))
            .ok
        )
          break;
      } catch {
        /* Server is still starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  browser = await chromium.launch({ headless: true });
  metadata.browser = browser.version();
  for (const entry of plan.cases) {
    const directory = path.join(output, entry.id);
    await fs.mkdir(directory);
    const phone = entry.live?.profile === "phone";
    const context = await browser.newContext({
      viewport: phone
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      isMobile: phone,
      hasTouch: phone,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const faults = [];
    page.on("pageerror", (error) => faults.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") faults.push(message.text());
    });
    const samples = [];
    const checks = [];
    try {
      if (entry.live) await live(page, entry, directory, samples, checks);
      else await controlled(page, entry, directory, samples, checks);
    } catch (error) {
      checks.push({
        id: "runner",
        pass: false,
        message: error.message,
        evidence: "error.png",
        hint: "Inspect the retained browser frame and console.json; rerun this case from plan.json.",
      });
      await page
        .screenshot({ path: path.join(directory, "error.png") })
        .catch(() => {});
    } finally {
      checks.push({
        id: "browser-errors",
        pass: faults.length === 0,
        actual: faults,
        expected: [],
        evidence: "console.json",
      });
      await writeJson(path.join(directory, "timeline.json"), samples);
      await writeJson(path.join(directory, "console.json"), faults);
      if (samples.length) {
        const thumbs = await Promise.all(
          samples.map((sample) =>
            sharp(path.join(directory, sample.frame))
              .resize({
                width: 480,
                height: 320,
                fit: "contain",
                background: "#15191f",
              })
              .png()
              .toBuffer(),
          ),
        );
        await sharp({
          create: {
            width: 480 * Math.min(3, thumbs.length),
            height: 320 * Math.ceil(thumbs.length / 3),
            channels: 4,
            background: "#15191f",
          },
        })
          .composite(
            thumbs.map((input, index) => ({
              input,
              left: (index % 3) * 480,
              top: Math.floor(index / 3) * 320,
            })),
          )
          .png()
          .toFile(path.join(directory, "contact-sheet.png"));
      }
      results.push({
        id: entry.id,
        mode: entry.live
          ? "physical-input-real-time"
          : "deterministic-semantic-input",
        checks,
        frames: samples.map(({ frame }) => frame),
        pages: samples.map(({ pageFrame }) => pageFrame),
      });
      await context.close();
      console.log(
        `${entry.id}: ${checks.every((check) => check.pass) ? "PASS" : "FAIL"}`,
      );
      await writeReports(); // Keep a readable partial report if a later case crashes.
    }
  }
  const endSource = await sourceIdentity();
  if (endSource.fingerprint !== source.fingerprint)
    results.push({
      id: "source-changed",
      frames: [],
      checks: [
        {
          id: "consistent-source",
          pass: false,
          message:
            "Source changed during this run. Rerun after edits finish; evidence spans different builds.",
        },
      ],
    });
} catch (error) {
  results.push({
    id: "infrastructure",
    frames: [],
    checks: [{ id: "runner", pass: false, message: error.message }],
  });
} finally {
  metadata.completedAt = new Date().toISOString();
  await browser?.close();
  if (server && server.exitCode === null) server.kill();
  await writeReports(true);
}
