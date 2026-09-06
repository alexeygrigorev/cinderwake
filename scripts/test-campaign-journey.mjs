import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/test-campaign-journey.mjs [--seeds cinder-041,ember-road,last-bell] [--classes vanguard,ranger,arcanist] [--max-ticks 18000] [--output NEW_DIRECTORY] [--replay tape.json]\nRuns generated worlds through real simulation inputs with live AI. Retains exact input tapes and failure states; replays every run. This is behavioral evidence, not browser or visual approval.",
  );
  process.exit(0);
}
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (
    !["--seeds", "--classes", "--max-ticks", "--output", "--replay"].includes(
      args[index],
    ) ||
    !args[index + 1] ||
    args[index + 1].startsWith("--")
  ) {
    console.error(`Unknown or incomplete option: ${args[index]}`);
    process.exit(2);
  }
  options[args[index].slice(2)] = args[index + 1];
}
const seeds = (options.seeds ?? "cinder-041,ember-road,last-bell").split(",");
const classes = (options.classes ?? "vanguard,ranger,arcanist").split(",");
const maxTicks = Number(options["max-ticks"] ?? 18000);
if (
  !Number.isSafeInteger(maxTicks) ||
  maxTicks < 1 ||
  maxTicks > 72000 ||
  classes.some((id) => !["vanguard", "ranger", "arcanist"].includes(id)) ||
  seeds.some((seed) => !seed)
) {
  console.error(
    "Use supported classes, nonempty seeds, and 1–72000 max ticks.",
  );
  process.exit(2);
}
await fs.mkdir("quality-results/campaign", { recursive: true });
const output = options.output
  ? path.resolve(options.output)
  : path.resolve(await fs.mkdtemp("quality-results/campaign/run-"));
if (options.output) await fs.mkdir(output);
const writeJson = (name, value) =>
  fs.writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  patch: execFileSync("git", ["diff", "HEAD", "--binary"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }),
  untracked: {},
};
for (const file of execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean))
  source.untracked[file] = sha256(await fs.readFile(file));
await writeJson("source.json", source);
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const results = [];
let runtimeError = null;
try {
  const [
    scenarioApi,
    simulation,
    navigation,
    sceneryApi,
    missions,
    canonical,
    snapshots,
    content,
    saves,
  ] = await Promise.all([
    server.ssrLoadModule("/src/testkit/scenarios.ts"),
    server.ssrLoadModule("/src/game/simulation.ts"),
    server.ssrLoadModule("/src/game/navigation.ts"),
    server.ssrLoadModule("/src/game/sceneryLayout.ts"),
    server.ssrLoadModule("/src/game/missions.ts"),
    server.ssrLoadModule("/src/testkit/canonical.ts"),
    server.ssrLoadModule("/src/testkit/stateSnapshots.ts"),
    server.ssrLoadModule("/src/game/content.ts"),
    server.ssrLoadModule("/src/app/saveGame.ts"),
  ]);
  const stateHash = (state) => sha256(canonical.canonicalJson(state));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const snapshot = (state) => JSON.parse(canonical.canonicalJson(state));

  function capture(state, reason) {
    const journal = missions.missionJournal(state);
    return {
      tick: state.tick,
      reason,
      hash: stateHash(state),
      phase: state.phase,
      mission: journal.activeId,
      target: journal.cue,
      player: {
        position: { ...state.player.position },
        health: state.player.health,
        maxHealth: state.player.maxHealth,
        level: state.player.level,
        power: state.player.power,
        tonics: state.player.tonics,
      },
      metrics: { ...state.metrics },
      remaining: state.monsters.filter((monster) => monster.health > 0).length,
    };
  }

  function nextInput(state, pilot) {
    const player = state.player;
    const scenery = sceneryApi.sceneryCollisions(state.map);
    const threats = state.monsters
      .filter((monster) => monster.health > 0)
      .sort(
        (a, b) =>
          distance(a.position, player.position) -
            distance(b.position, player.position) || a.id.localeCompare(b.id),
      );
    const retainedThreat = threats.find(
      (monster) => monster.id === pilot.threatId,
    );
    const threat =
      threats[0] && distance(threats[0].position, player.position) < 2000
        ? threats[0]
        : (retainedThreat ?? threats[0]);
    pilot.threatId = threat?.id ?? null;
    const threatDistance = threat
      ? distance(player.position, threat.position)
      : Infinity;
    const clearShot =
      threat &&
      navigation.navigationSegmentWalkable(
        state.map,
        scenery,
        player.position,
        threat.position,
        player.classId === "ranger"
          ? 110
          : player.classId === "arcanist"
            ? 155
            : 0,
      );
    const melee = player.classId === "vanguard";
    const desiredRange = melee ? 1250 : 4000;
    const attackRange = content.ARCHETYPES[player.classId].attackRange;
    let target = threat
      ? { id: threat.id, position: threat.position }
      : missions.missionJournal(state).cue;
    let needsMovement = true;
    if (threat && clearShot && threatDistance <= desiredRange)
      needsMovement = false;
    if (threat && !melee && threatDistance < 1800) {
      const dx = player.position.x - threat.position.x;
      const dy = player.position.y - threat.position.y;
      target = {
        id: `retreat:${threat.id}`,
        position: {
          x: Math.round(player.position.x + dx * 2),
          y: Math.round(player.position.y + dy * 2),
        },
      };
      needsMovement = true;
    } else if (threatDistance > 2400) {
      const retainedLoot = state.loot.find(
        (item) => item.id === pilot.lootTarget,
      );
      const loot =
        retainedLoot && distance(retainedLoot.position, player.position) < 4500
          ? retainedLoot
          : state.loot
              .filter((item) => item.kind !== "tonic" || player.tonics < 5)
              .sort(
                (a, b) =>
                  distance(a.position, player.position) -
                    distance(b.position, player.position) ||
                  a.id.localeCompare(b.id),
              )[0];
      if (
        loot &&
        distance(loot.position, player.position) <
          Math.min(retainedLoot === loot ? 4500 : 3000, threatDistance)
      ) {
        target = { id: loot.id, position: loot.position };
        pilot.lootTarget = loot.id;
        needsMovement = true;
      } else pilot.lootTarget = null;
    }
    if (
      pilot.map !== state.map.digest ||
      pilot.target !== target.id ||
      (state.tick >= pilot.routeUntil &&
        (!pilot.route.length ||
          distance(pilot.targetPosition, target.position) >= 512))
    ) {
      pilot.route = needsMovement
        ? navigation.findNavigationRoute(
            state.map,
            scenery,
            player.position,
            target.position,
            player.radius,
          )
        : [];
      pilot.map = state.map.digest;
      pilot.target = target.id;
      pilot.targetPosition = { ...target.position };
      pilot.routeUntil = state.tick + 12;
    }
    while (
      pilot.route.length &&
      distance(player.position, pilot.route[0]) <= player.moveSpeed * 0.8
    )
      pilot.route.shift();
    let moveX = 0;
    let moveY = 0;
    if (needsMovement && pilot.route.length) {
      const waypoint = pilot.route[0];
      const dx = waypoint.x - player.position.x;
      const dy = waypoint.y - player.position.y;
      moveX = Math.abs(dx) >= player.moveSpeed * 0.5 ? Math.sign(dx) : 0;
      moveY = Math.abs(dy) >= player.moveSpeed * 0.5 ? Math.sign(dy) : 0;
    }
    const abilityRange = melee
      ? 2200
      : player.classId === "arcanist"
        ? 2600
        : attackRange;
    return {
      moveX,
      moveY,
      aim: threat ? { ...threat.position } : null,
      attack: Boolean(threat && clearShot && threatDistance <= attackRange),
      ability: Boolean(threat && clearShot && threatDistance <= abilityRange),
      useTonic: player.health <= player.maxHealth - 40 && player.tonics > 0,
    };
  }

  function replay(tape, initialState = tape.initialState) {
    if (
      !tape ||
      tape.schemaVersion !== 1 ||
      !Array.isArray(tape.inputs) ||
      !/^[a-f0-9]{64}$/.test(tape.expectedFinalHash)
    )
      throw new Error("Invalid campaign replay tape");
    let declaredTicks = 0;
    for (const segment of tape.inputs) {
      const input = segment?.input;
      declaredTicks += segment?.ticks;
      if (
        !Number.isSafeInteger(segment?.ticks) ||
        segment.ticks < 1 ||
        declaredTicks > 72000 ||
        !input ||
        ![-1, 0, 1].includes(input.moveX) ||
        ![-1, 0, 1].includes(input.moveY) ||
        ["attack", "ability", "useTonic"].some(
          (key) => typeof input[key] !== "boolean",
        ) ||
        (input.aim !== null &&
          (!input.aim ||
            !Number.isSafeInteger(input.aim.x) ||
            !Number.isSafeInteger(input.aim.y)))
      )
        throw new Error(
          "Invalid or excessive semantic inputs in campaign tape",
        );
    }
    const state = snapshots.stateFromSnapshot(initialState);
    let skipTicks = initialState.tick - tape.initialState.tick;
    for (const segment of tape.inputs) {
      const skip = Math.min(skipTicks, segment.ticks);
      skipTicks -= skip;
      for (let tick = skip; tick < segment.ticks; tick += 1)
        simulation.stepGame(state, segment.input);
    }
    return state;
  }

  if (options.replay) {
    const tape = JSON.parse(await fs.readFile(options.replay, "utf8"));
    if (
      tape.schemaVersion !== 1 ||
      !Array.isArray(tape.inputs) ||
      typeof tape.expectedFinalHash !== "string"
    )
      throw new Error("Invalid campaign replay tape");
    const state = replay(tape);
    const actualHash = stateHash(state);
    const matched = actualHash === tape.expectedFinalHash;
    await writeJson("replayed-state.json", snapshot(state));
    results.push({
      id: tape.id,
      pass: matched,
      replayMatched: matched,
      finalHash: actualHash,
      expectedHash: tape.expectedFinalHash,
      phase: state.phase,
    });
  } else {
    for (const seed of seeds)
      for (const classId of classes) {
        const id = `${results.length + 1}-${classId}-${seed.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const scenario = scenarioApi.createRunScenario(seed, classId);
        const state = scenarioApi.worldFromScenario(scenario);
        const initialState = snapshot(state);
        const checkpoints = [capture(state, "arrival")];
        const inputs = [];
        const pilot = { route: [], routeUntil: 0, target: null, map: null };
        let previousInput = null;
        let lastProgressTick = 0;
        let progress = {
          position: { ...state.player.position },
          kills: 0,
          damage: 0,
          map: state.map.digest,
        };
        let blocker = null;
        let savedCheckpoint = null;
        const validationErrors = [];
        let previousMission = missions.missionJournal(state).activeId;
        while (state.phase === "playing" && state.tick < maxTicks) {
          const input = nextInput(state, pilot);
          const serialized = JSON.stringify(input);
          if (serialized === previousInput) inputs.at(-1).ticks += 1;
          else {
            inputs.push({ ticks: 1, input });
            previousInput = serialized;
          }
          simulation.stepGame(state, input);
          if (state.tick === 300) {
            try {
              savedCheckpoint = saves.encodeSave(
                state,
                ["scroll:ileya:warning"],
                0,
              );
            } catch (error) {
              validationErrors.push(
                `Checkpoint save rejected: ${error.message}`,
              );
            }
            checkpoints.push(capture(state, "save-checkpoint"));
          }
          const journal = missions.missionJournal(state);
          if (journal.activeId !== previousMission || state.tick % 1200 === 0) {
            checkpoints.push(
              capture(
                state,
                journal.activeId !== previousMission
                  ? "mission-transition"
                  : "interval",
              ),
            );
            previousMission = journal.activeId;
          }
          if (
            distance(progress.position, state.player.position) > 1024 ||
            progress.kills !== state.metrics.kills ||
            progress.damage !== state.metrics.damageDealt ||
            progress.map !== state.map.digest
          ) {
            lastProgressTick = state.tick;
            progress = {
              position: { ...state.player.position },
              kills: state.metrics.kills,
              damage: state.metrics.damageDealt,
              map: state.map.digest,
            };
          }
          if (state.tick - lastProgressTick >= 600) {
            blocker =
              "stalled: no tile of travel or combat progress for 10 seconds";
            break;
          }
        }
        if (state.phase === "lost")
          blocker = "defeated: the generated campaign killed this input policy";
        else if (state.phase === "playing" && !blocker)
          blocker =
            "time-budget: campaign did not finish within declared simulation ticks";
        checkpoints.push(capture(state, "final"));
        const expectedFinalHash = stateHash(state);
        const tape = {
          schemaVersion: 1,
          id,
          scenario,
          initialState,
          inputs,
          expectedFinalHash,
        };
        await writeJson(`${id}-tape.json`, tape);
        await writeJson(`${id}-final-state.json`, snapshot(state));
        await writeJson(`${id}-checkpoints.json`, checkpoints);
        const replayed = replay(tape);
        const replayMatched = stateHash(replayed) === expectedFinalHash;
        const loadedSave = savedCheckpoint
          ? saves.decodeSave(savedCheckpoint)
          : null;
        const saveResumeMatched =
          loadedSave !== null &&
          loadedSave.discoveries.includes("scroll:ileya:warning") &&
          stateHash(replay(tape, loadedSave.state)) === expectedFinalHash;
        if (savedCheckpoint)
          await fs.writeFile(
            path.join(output, `${id}-checkpoint.save.json`),
            savedCheckpoint,
          );
        let snapshotMatched = false;
        try {
          const restored = snapshots.stateFromSnapshot(snapshot(state));
          snapshotMatched =
            stateHash(restored) === expectedFinalHash &&
            JSON.stringify(missions.missionJournal(restored)) ===
              JSON.stringify(missions.missionJournal(state));
        } catch (error) {
          validationErrors.push(`Final snapshot rejected: ${error.message}`);
        }
        if (validationErrors.length) blocker = validationErrors.join("; ");
        const result = {
          id,
          seed,
          classId,
          pass:
            state.phase === "won" &&
            replayMatched &&
            snapshotMatched &&
            saveResumeMatched,
          phase: state.phase,
          blocker,
          ticks: state.tick,
          simulationSeconds: state.tick / 60,
          remaining: state.monsters.filter((monster) => monster.health > 0)
            .length,
          metrics: { ...state.metrics },
          health: state.player.health,
          maxHealth: state.player.maxHealth,
          level: state.player.level,
          power: state.player.power,
          mission: missions.missionJournal(state).activeId,
          target: missions.missionJournal(state).cue,
          replayMatched,
          snapshotMatched,
          saveResumeMatched,
          validationErrors,
          tape: `${id}-tape.json`,
          checkpoints: `${id}-checkpoints.json`,
          finalState: `${id}-final-state.json`,
          reproduction: `node scripts/test-campaign-journey.mjs --replay '${path.join(output, `${id}-tape.json`).replaceAll("'", "'\"'\"'")}'`,
        };
        results.push(result);
        await writeJson("results.json", {
          schemaVersion: 1,
          complete: false,
          results,
        });
        console.log(
          `${result.pass ? "PASS" : "FAIL"} ${id}: ${state.phase}, ${state.metrics.kills} kills, ${state.player.health} HP, ${state.tick} ticks${blocker ? ` (${blocker})` : ""}`,
        );
      }
  }
} catch (error) {
  runtimeError = error.stack ?? String(error);
  console.error(runtimeError);
} finally {
  await server.close();
  const pass =
    !runtimeError &&
    results.length > 0 &&
    results.every((result) => result.pass);
  await writeJson("results.json", {
    schemaVersion: 1,
    complete: !runtimeError,
    pass,
    runtimeError,
    scope:
      "Deterministic semantic-input campaign; no browser events or visual assessment",
    results,
  });
  await fs.writeFile(
    path.join(output, "report.md"),
    `# Campaign feedback\n\n${pass ? "PASS" : "FAIL"} — generated worlds, live AI, semantic inputs only. No actor teleportation, injected kills, stat buffs, or injected victory.\n\nThis is behavioral evidence. Browser controls, sound, and visual polish require separate review. The pilot has full state visibility, so completion times do not estimate first-time human play.\n\n${results.map((result) => `- ${result.id}: ${result.pass ? "PASS" : "FAIL"}; ${result.phase}; ${result.ticks ?? "replay"} ticks; ${result.blocker ?? "no blocker"}; exact replay ${result.replayMatched ? "matched" : "FAILED"}.`).join("\n")}\n${runtimeError ? `\nRuntime error: ${runtimeError}\n` : ""}`,
  );
  console.log(`Campaign evidence: ${output}`);
  if (!pass) process.exitCode = 1;
}
