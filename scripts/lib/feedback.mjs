const classes = ["vanguard", "ranger", "arcanist"];

export function defaultFeedbackPlan() {
  return {
    version: 1,
    cases: classes.flatMap((classId) => [
      {
        id: `${classId}-combat`,
        scenario: {
          schemaVersion: 1,
          id: `feedback-${classId}`,
          seed: "feedback-001",
          classId,
          map: {
            mode: "explicit",
            rows: Array.from({ length: 16 }, (_, y) =>
              y === 0 || y === 15
                ? "####################"
                : y === 7
                  ? "#.......P.........E#"
                  : "#..................#",
            ),
          },
          player: { tile: [8, 7] },
          monsters: [
            {
              id: "target",
              kind: "stonekin",
              tile: [10, 7],
              health: 40,
              maxHealth: 40,
              guaranteedLoot: true,
            },
          ],
          settings: { ai: false },
        },
        ticks: [0, 12, 24, 48, 72, 96, 120, 144],
        commands: [
          { tick: 0, input: { moveX: 1 } },
          {
            tick: 12,
            input: { moveX: 0, attack: true, aim: { x: 10752, y: 7680 } },
          },
          { tick: 72, input: { attack: false, ability: true } },
          { tick: 96, input: { ability: false, moveX: 1 } },
          { tick: 120, input: { moveX: 0 } },
        ],
        expect: [
          {
            id: "movement",
            path: "metrics.distanceUnits",
            op: "deltaGte",
            value: 700,
            hint: "Inspect movement input and collision; the open approach should cover at least 700 units.",
          },
          {
            id: "primary-hit",
            at: 72,
            path: "metrics.damageDealt",
            op: "gte",
            value: 1,
            hint: "An attack animation alone is insufficient: inspect aim, range, pending attacks and projectile contact.",
          },
          {
            id: "ability-start",
            path: "eventLog",
            op: "eventCountGte",
            event: "ability_started",
            sourceId: "player",
            value: 1,
            hint: "Inspect the ability input and cooldown.",
          },
          {
            id: "survival",
            path: "player.health",
            op: "gte",
            value: 1,
            hint: "The isolated target has AI disabled; inspect unexpected damage.",
          },
          {
            id: "ability-hit",
            from: 72,
            at: 96,
            path: "metrics.damageDealt",
            op: "deltaGte",
            value: 1,
            hint: "The ability must deal new damage after primary input stops; inspect its impact and range.",
          },
          {
            id: "kill",
            path: "metrics.kills",
            op: "gte",
            value: 1,
            hint: "The primary/ability combination should finish the weakened target.",
          },
          {
            id: "exit-unlocked",
            path: "exitUnlocked",
            op: "eq",
            value: true,
            hint: "The last kill must unlock progression.",
          },
          {
            id: "pickup",
            path: "metrics.lootCollected",
            op: "gte",
            value: 1,
            hint: "Walking over the guaranteed drop must produce a physical pickup.",
          },
        ],
      },
      ...["desktop", "phone"].map((profile) => ({
        id: `${classId}-${profile}-controls`,
        live: { classId, profile },
      })),
    ]),
  };
}

export function validateFeedbackPlan(plan) {
  if (
    plan?.version !== 1 ||
    !Array.isArray(plan.cases) ||
    !plan.cases.length ||
    plan.cases.length > 50
  )
    throw new Error("Plan needs version: 1 and 1–50 cases");
  const ids = new Set();
  for (const entry of plan.cases) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id) || ids.has(entry.id))
      throw new Error(`Invalid or duplicate case ID: ${entry.id}`);
    ids.add(entry.id);
    if (entry.live) {
      if (
        !classes.includes(entry.live.classId) ||
        !["desktop", "phone"].includes(entry.live.profile) ||
        entry.scenario ||
        entry.state ||
        entry.expect ||
        entry.commands ||
        entry.ticks
      )
        throw new Error(`${entry.id}: invalid live profile`);
      continue;
    }
    if (
      Boolean(entry.scenario) === Boolean(entry.state) ||
      !Array.isArray(entry.commands) ||
      !Array.isArray(entry.ticks) ||
      entry.ticks.length < 2 ||
      entry.ticks.length > 60
    )
      throw new Error(
        `${entry.id}: requires scenario, commands and 2–60 capture ticks`,
      );
    let previous = -1;
    for (const tick of entry.ticks) {
      if (
        !Number.isSafeInteger(tick) ||
        tick < 0 ||
        tick <= previous ||
        tick - entry.ticks[0] > 36000
      )
        throw new Error(
          `${entry.id}: capture ticks must increase within 36,000 ticks`,
        );
      previous = tick;
    }
    if (!Array.isArray(entry.expect) || !entry.expect.length)
      throw new Error(
        `${entry.id}: declare at least one behavioral expectation`,
      );
    const checks = new Set();
    for (const check of entry.expect) {
      if (
        typeof check.id !== "string" ||
        !check.id ||
        checks.has(check.id) ||
        typeof check.path !== "string" ||
        !check.path ||
        !["eq", "gte", "lte", "deltaGte", "eventCountGte"].includes(check.op)
      )
        throw new Error(`${entry.id}: invalid or duplicate expectation`);
      checks.add(check.id);
      if (check.at !== undefined && !entry.ticks.includes(check.at))
        throw new Error(`${entry.id}/${check.id}: at must be a captured tick`);
      if (
        check.from !== undefined &&
        (check.op !== "deltaGte" ||
          !entry.ticks.includes(check.from) ||
          check.from >= (check.at ?? entry.ticks.at(-1)))
      )
        throw new Error(
          `${entry.id}/${check.id}: from must be an earlier captured tick for deltaGte`,
        );
      if (
        check.op !== "eq" &&
        (typeof check.value !== "number" || !Number.isFinite(check.value))
      )
        throw new Error(
          `${entry.id}/${check.id}: comparison value must be finite`,
        );
      if (
        check.op === "eq" &&
        !["number", "string", "boolean"].includes(typeof check.value)
      )
        throw new Error(`${entry.id}/${check.id}: eq needs a scalar value`);
      if (check.op === "eventCountGte" && typeof check.event !== "string")
        throw new Error(`${entry.id}/${check.id}: event type required`);
    }
  }
  return plan;
}

function readPath(value, path) {
  for (const key of path.split(".")) {
    if (!value || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

export function assessExpectations(expectations, samples) {
  return expectations.map((check) => {
    const sample =
      check.at === undefined
        ? samples.at(-1)
        : samples.find(({ tick }) => tick === check.at);
    let actual = readPath(sample?.snapshot, check.path);
    if (check.op === "deltaGte") {
      const baseline =
        check.from === undefined
          ? samples[0]
          : samples.find(({ tick }) => tick === check.from);
      const initial = readPath(baseline?.snapshot, check.path);
      actual =
        typeof actual === "number" && typeof initial === "number"
          ? actual - initial
          : undefined;
    }
    if (check.op === "eventCountGte") {
      // Input at tick N emits events stamped N while advancing state to N+1.
      // Exclude retained initial history, not new events on that first tick.
      const matches = (event) =>
        event.type === check.event &&
        (check.sourceId === undefined || event.sourceId === check.sourceId) &&
        event.tick >= samples[0].tick;
      const initial = readPath(samples[0]?.snapshot, check.path);
      actual = Array.isArray(actual)
        ? Math.max(
            0,
            actual.filter(matches).length -
              (Array.isArray(initial) ? initial.filter(matches).length : 0),
          )
        : undefined;
    }
    const numeric = typeof actual === "number" && Number.isFinite(actual);
    const pass =
      check.op === "eq"
        ? actual === check.value
        : numeric &&
          (check.op === "lte" ? actual <= check.value : actual >= check.value);
    return {
      ...check,
      tick: sample?.tick ?? check.at,
      actual: actual ?? null,
      pass,
      evidence: "timeline.json",
      message: pass
        ? "Expectation met"
        : `${check.path}: expected ${check.op} ${JSON.stringify(check.value)}, observed ${JSON.stringify(actual ?? null)}`,
    };
  });
}

export function feedbackVerdict(cases, plannedIds, complete = true) {
  if (!complete) return "INCOMPLETE";
  if (
    plannedIds &&
    plannedIds.some((id) => !cases.some((entry) => entry.id === id))
  )
    return "FAIL";
  return cases.length &&
    cases.every(
      (entry) =>
        entry.checks.length && entry.checks.every((check) => check.pass),
    )
    ? "PASS"
    : "FAIL";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
