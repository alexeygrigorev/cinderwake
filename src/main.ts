import "./styles.css";
import { ARCHETYPES } from "./game/content";
import { findStateNavigationRoute } from "./game/navigation";
import type { CharacterClass, GameState } from "./game/types";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  type ScenarioV1,
} from "./testkit/scenarios";
import { GameHost } from "./app/GameHost";
import { InputController } from "./input/InputController";
import { installGameTestBridge } from "./testkit/browserBridge";
import { installPlayerObserver } from "./testkit/playerObserver";
import { preloadSpriteAssets, SPRITE_CATALOG } from "./render/sprites";

const app = document.querySelector<HTMLDivElement>("#app")!;
const assetBase = import.meta.env.BASE_URL;
const spriteAssetCount = Object.keys(SPRITE_CATALOG.assets).length;
let selected: CharacterClass = "vanguard",
  seed = "cinder-041",
  host: GameHost | undefined,
  input: InputController | undefined,
  activeScenario: ScenarioV1 | undefined;
const query = new URLSearchParams(location.search),
  testMode = query.get("testMode") === "1",
  captureMode = query.get("captureMode") === "1";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function spriteGlyphs(value: string): string {
  return value
    .split(/(\s+)/)
    .filter(Boolean)
    .map((token) => {
      if (/^\s+$/.test(token)) {
        return `<i class="sprite-space" aria-hidden="true" style="--spaces:${token.length}"></i>`;
      }
      const glyphs = [...token]
        .map((character) => {
          const codePoint = character.codePointAt(0) ?? 63;
          const supported =
            codePoint >= 32 && codePoint <= 126 ? codePoint : 63;
          const index = supported - 32;
          const x = ((index % 16) / 15) * 100;
          const y = (Math.floor(index / 16) / 7) * 100;
          return `<i class="sprite-glyph" style="background-position:${x}% ${y}%"></i>`;
        })
        .join("");
      return `<span class="sprite-word" aria-hidden="true">${glyphs}</span>`;
    })
    .join("");
}

function spriteText(value: string, className = ""): string {
  return `<span class="sprite-text ${className}" aria-label="${escapeAttribute(value)}">${spriteGlyphs(value)}</span>`;
}

function setSpriteGlyphs(element: HTMLElement, value: string): void {
  element.innerHTML = spriteGlyphs(value);
  element.setAttribute("aria-label", value);
}

function setSpriteLabel(
  element: HTMLElement,
  value: string,
  className = "",
): void {
  element.innerHTML = spriteText(value, className);
  element.setAttribute("aria-label", value);
}

function selectionScene(classId: CharacterClass): string {
  return `${assetBase}assets/selection/${classId}-v2.webp`;
}

function screen(): void {
  const archetype = ARCHETYPES[selected];
  app.innerHTML = `<main class="selection selection-v2${testMode ? " test-mode" : ""}" data-selected-class="${selected}" style="--selection-art:url('${selectionScene(selected)}');--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><div class="selection-art" role="img" aria-label="${escapeAttribute(`${archetype.name} standing before the ruined settlement`)}"></div><header class="selection-header"><p class="eyebrow">${spriteText("Choose your ember", "sprite-eyebrow")}</p><h1 data-ui-title>Cinderwake</h1></header><section class="choose" aria-label="Character selection"><div class="selected-class"><h2 data-ui-title>${archetype.name}</h2>${spriteText(archetype.role, "sprite-role")}${spriteText(`HP ${archetype.health} / ARM ${archetype.armor}`, "sprite-stats")}</div><div class="cards" role="group" aria-label="Playable characters">${Object.values(
    ARCHETYPES,
  )
    .map(
      (candidate) =>
        `<button class="class-card ${selected === candidate.id ? "selected" : ""}" data-class="${candidate.id}" style="--accent:${candidate.accent};--portrait:url('${selectionScene(candidate.id)}')" aria-label="${escapeAttribute(`${candidate.name}. ${candidate.role}. ${candidate.description}`)}" aria-pressed="${selected === candidate.id}"><span class="class-portrait" aria-hidden="true"></span><strong data-ui-title>${candidate.name}</strong></button>`,
    )
    .join(
      "",
    )}</div><form class="run-controls"><label class="seed-label">${spriteText("Run seed", "sprite-seed-label")}<span class="seed-control"><input id="seed" value="${escapeAttribute(seed)}" maxlength="48" aria-label="Run seed" autocomplete="off" spellcheck="false" /><span class="seed-display sprite-text" aria-hidden="true">${spriteGlyphs(seed)}</span></span></label><button id="begin" class="begin" type="submit" aria-label="Enter the wake">${spriteText("Enter the wake >", "sprite-button-label")}</button></form></section>${testMode ? `<button class="lab-toggle selection-lab-toggle" aria-label="Open Test lab">${spriteText("Lab", "sprite-button-label")}</button>` : ""}</main>`;
  app.querySelectorAll<HTMLButtonElement>("[data-class]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.class as CharacterClass;
        screen();
      }),
  );
  app.querySelector<HTMLInputElement>("#seed")!.oninput = (event) => {
    seed = (event.target as HTMLInputElement).value;
    app.querySelector<HTMLElement>(".seed-display")!.innerHTML =
      spriteGlyphs(seed);
  };
  app.querySelector<HTMLFormElement>(".run-controls")!.onsubmit = (event) => {
    event.preventDefault();
    void boot(createRunScenario(seed || "cinder-041", selected));
  };
  const selectionLab = app.querySelector<HTMLButtonElement>(".lab-toggle");
  if (selectionLab) selectionLab.onclick = () => lab();
}
async function boot(scenario: ScenarioV1): Promise<void> {
  activeScenario = scenario;
  app.innerHTML = `<main class="loading" aria-busy="true" style="--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><h1 data-ui-title>Cinderwake</h1><p class="loading-status" aria-live="polite">${spriteText(`Waking the atlas 0 / ${spriteAssetCount}`, "sprite-loading")}</p></main>`;
  try {
    const requestedTimeout = Number(query.get("assetTimeoutMs"));
    await preloadSpriteAssets(
      (loaded, total) => {
        const status = app.querySelector<HTMLElement>(".loading-status");
        if (status)
          setSpriteLabel(
            status,
            `Waking the atlas ${loaded} / ${total}`,
            "sprite-loading",
          );
      },
      testMode && requestedTimeout > 0 ? requestedTimeout : undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    app.innerHTML = `<main class="loading loading-failed" style="--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><h1 data-ui-title>Atlas failed.</h1><p>${spriteText(message, "sprite-loading-error")}</p><div><button data-loading="retry" aria-label="Retry loading">${spriteText("Retry", "sprite-button-label")}</button><button data-loading="back" aria-label="Back to character selection">${spriteText("Back", "sprite-button-label")}</button></div></main>`;
    app.querySelector<HTMLButtonElement>("[data-loading='retry']")!.onclick =
      () => void boot(scenario);
    app.querySelector<HTMLButtonElement>("[data-loading='back']")!.onclick =
      () => screen();
    return;
  }
  app.innerHTML = `<main class="game${testMode ? " test-mode" : ""}" style="--terrain-atlas:url('${assetBase}assets/sprites/environment-terrain.png');--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><div class="stage"><canvas aria-label="Cinderwake game view"></canvas><div class="hud top"><div class="brand" data-ui-title>CINDERWAKE <small></small></div><div class="objective" id="objective" aria-live="polite"><i class="objective-direction" aria-hidden="true"></i><span><strong id="objective-title"></strong><small id="objective-detail"></small></span></div><div class="counter" id="monsters"></div></div><div class="hud bottom"><div class="health"><div class="health-label">${spriteText("Vitality", "sprite-hud-label")}</div><b><i id="hpbar"></i></b><em id="hp"></em></div><div class="skills"><button data-action="attack" aria-label="Strike">${spriteText("Click", "sprite-shortcut")}${spriteText("Strike", "sprite-action-label")}</button><button data-action="ability" aria-label="Use ability">${spriteText("Right click", "sprite-shortcut")}${spriteText("Ability", "sprite-action-label")}<i id="cd"></i></button><button data-action="tonic" aria-label="Drink tonic">${spriteText("Q", "sprite-shortcut")}${spriteText("Tonic", "sprite-action-label")}<i id="tonics"></i></button></div></div><aside class="loot-log"><strong>${spriteText("Run log", "sprite-panel-label")}</strong><div id="log"></div></aside><div id="outcome" class="outcome hidden"></div></div><nav class="mobile-controls" aria-label="Touch game controls"><div class="move-pad" data-direction="0,0" role="application" aria-label="Eight-direction movement pad"><span class="move-ring"></span><span class="move-knob"></span><small>${spriteText("Move", "sprite-control-label")}</small></div><div class="mobile-actions"><button class="primary-action" data-action="attack" aria-label="Strike"><strong>${spriteText("Strike", "sprite-action-label")}</strong><span>${spriteText("Primary", "sprite-action-detail")}</span></button><button class="ability-action" data-action="ability" aria-label="Use ability"><strong>${spriteText("Ability", "sprite-action-label")}</strong><span id="mobile-cd"></span></button><button class="tonic-action" data-action="tonic" aria-label="Drink tonic"><strong>${spriteText("Tonic", "sprite-action-label")}</strong><span id="mobile-tonics"></span></button></div></nav>${testMode ? `<button class="lab-toggle" aria-label="Open Test lab">${spriteText("Test lab", "sprite-button-label")}</button>` : ""}</main>`;
  const canvas = app.querySelector<HTMLCanvasElement>("canvas")!;
  host?.stop();
  input?.destroy();
  host = new GameHost(canvas, testMode || captureMode);
  input = new InputController(
    canvas,
    (x, y) => host!.worldAt(x, y),
    () => host!.getState().player.position,
    (from, target) => {
      const state = host!.getState();
      return findStateNavigationRoute(state, from, target, state.player.radius);
    },
  );
  input.attachMovePad(app.querySelector<HTMLElement>(".move-pad")!);
  host.inputProvider = () => input!.sample();
  const playerObserver = installPlayerObserver(host);
  host.onRender = (state, manifest) => {
    updateHud(state);
    playerObserver.record(manifest);
  };
  host.startScenario(scenario);
  host.start();
  if (testMode) installGameTestBridge(host);
  app
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          input!.press(b.dataset.action as "attack" | "ability" | "tonic")),
    );
  const gameLab = app.querySelector<HTMLButtonElement>(".lab-toggle");
  if (gameLab) gameLab.onclick = () => lab();
}
function updateHud(state: GameState): void {
  const p = state.player;
  const hp = document.querySelector<HTMLElement>("#hp"),
    bar = document.querySelector<HTMLElement>("#hpbar"),
    monsters = document.querySelector<HTMLElement>("#monsters"),
    tonics = document.querySelector<HTMLElement>("#tonics"),
    mobileTonics = document.querySelector<HTMLElement>("#mobile-tonics"),
    cd = document.querySelector<HTMLElement>("#cd"),
    mobileCd = document.querySelector<HTMLElement>("#mobile-cd"),
    runSeed = document.querySelector<HTMLElement>(".brand small"),
    log = document.querySelector<HTMLElement>("#log"),
    objective = document.querySelector<HTMLElement>("#objective"),
    objectiveTitle = document.querySelector<HTMLElement>("#objective-title"),
    objectiveDetail = document.querySelector<HTMLElement>("#objective-detail"),
    objectiveDirection = document.querySelector<HTMLElement>(
      ".objective-direction",
    );
  if (!hp) return;
  setSpriteGlyphs(hp, `${p.health} / ${p.maxHealth}`);
  setSpriteGlyphs(runSeed!, state.seed);
  bar!.style.width = `${(100 * p.health) / p.maxHealth}%`;
  const livingMonsters = state.monsters.filter((monster) => monster.health > 0);
  setSpriteGlyphs(
    monsters!,
    `${livingMonsters.length} ${livingMonsters.length === 1 ? "foe" : "foes"}`,
  );
  setSpriteGlyphs(tonics!, `${p.tonics}`);
  setSpriteGlyphs(mobileTonics!, `${p.tonics}`);
  const cooldown =
    state.tick >= p.abilityReadyTick
      ? "READY"
      : `${((p.abilityReadyTick - state.tick) / 60).toFixed(1)}s`;
  setSpriteGlyphs(cd!, cooldown);
  setSpriteGlyphs(mobileCd!, cooldown);
  const target = livingMonsters.length
    ? [...livingMonsters].sort((first, second) => {
        const firstDistance = Math.hypot(
          first.position.x - p.position.x,
          first.position.y - p.position.y,
        );
        const secondDistance = Math.hypot(
          second.position.x - p.position.x,
          second.position.y - p.position.y,
        );
        return (
          firstDistance - secondDistance || first.id.localeCompare(second.id)
        );
      })[0]!
    : {
        id: "exit:rift-gate",
        position: {
          x: (state.map.exit.x + 0.5) * 1024,
          y: (state.map.exit.y + 0.5) * 1024,
        },
      };
  const objectiveHeading = livingMonsters.length
    ? "Hunt the cinders"
    : "The rift is open";
  const objectiveCopy = livingMonsters.length
    ? `${livingMonsters.length} remain`
    : "Enter the gate";
  setSpriteGlyphs(objectiveTitle!, objectiveHeading);
  setSpriteGlyphs(objectiveDetail!, objectiveCopy);
  const targetAngle =
    (Math.atan2(
      target.position.y - p.position.y,
      target.position.x - p.position.x,
    ) *
      180) /
      Math.PI -
    90;
  objectiveDirection!.style.transform = `rotate(${targetAngle.toFixed(2)}deg)`;
  objective!.dataset.targetId = target.id;
  objective!.dataset.state = livingMonsters.length ? "hunt" : "exit";
  objective!.setAttribute(
    "aria-label",
    `${objectiveHeading}. ${objectiveCopy}. Direction marker points toward ${target.id}.`,
  );
  const events = (state.events.length ? state.events : state.eventLog).slice(
    -2,
  );
  log!.innerHTML = spriteText(
    events.length
      ? events
          .map(
            (event) =>
              (event.type === "movement_blocked"
                ? `Blocked: ${event.detail ?? event.targetId ?? "obstacle"}`
                : event.type.replaceAll("_", " ")) +
              (event.amount ? ` +${event.amount}` : ""),
          )
          .join(" / ")
      : "The cinders stir.",
    "sprite-log",
  );
  const out = document.querySelector<HTMLElement>("#outcome")!;
  const deathStillPlaying =
    state.phase === "lost" &&
    state.player.animation.clip === "death" &&
    state.tick < state.player.animation.lockedUntilTick;
  if (state.phase !== "playing" && !deathStillPlaying) {
    out.classList.remove("hidden");
    const outcomeLabel =
        state.phase === "won" ? "Rift sealed" : "The wake consumes you",
      outcomeTitle = state.phase === "won" ? "Cinders quieted." : "Run ended.";
    out.innerHTML = `<p>${spriteText(outcomeLabel, "sprite-outcome-label")}</p><h2 data-ui-title>${outcomeTitle}</h2><button aria-label="Try again">${spriteText("Try again", "sprite-button-label")}</button>`;
    out.querySelector("button")!.addEventListener("click", () => {
      void boot(activeScenario!);
    });
  } else {
    out.classList.add("hidden");
    out.replaceChildren();
  }
}
function lab(): void {
  const existing = document.querySelector(".lab");
  if (existing) {
    existing.remove();
    return;
  }
  const scenarioIds = Object.keys(BUILTIN_SCENARIOS);
  let scenarioIndex = 0;
  const node = document.createElement("aside");
  node.className = "lab";
  node.style.setProperty(
    "--ui-atlas",
    `url('${assetBase}assets/sprites/ui.png')`,
  );
  node.style.setProperty(
    "--glyph-atlas",
    `url('${assetBase}assets/sprites/glyphs.png')`,
  );
  node.innerHTML = `<button class="close" aria-label="Close Test lab">${spriteText("X", "sprite-button-label")}</button><p class="eyebrow">${spriteText("Deterministic tools", "sprite-eyebrow")}</p><h2 data-ui-title>Test lab</h2><div class="lab-field"><span class="lab-field-label">${spriteText("Scenario", "sprite-field-label")}</span><div class="scenario-chooser" role="group" aria-label="Scenario chooser"><button data-lab="scenario-previous" aria-label="Previous scenario">${spriteText("<", "sprite-button-label")}</button><output class="scenario-value" aria-label="${escapeAttribute(scenarioIds[scenarioIndex]!)}" aria-live="polite">${spriteText(scenarioIds[scenarioIndex]!, "sprite-scenario-value")}</output><button data-lab="scenario-next" aria-label="Next scenario">${spriteText(">", "sprite-button-label")}</button></div></div><div class="lab-actions"><button data-lab="load" aria-label="Load scenario">${spriteText("Load", "sprite-button-label")}</button><button data-lab="pause" aria-label="Pause">${spriteText("Pause", "sprite-button-label")}</button><button data-lab="step" aria-label="Step one tick">${spriteText("Step +1", "sprite-button-label")}</button></div><button data-lab="capture" aria-label="Download state JSON">${spriteText("Download state JSON", "sprite-button-label")}</button><p class="frame">${spriteText("Frame strip uses the current deterministic canvas frame.", "sprite-lab-copy")}</p><canvas class="mini" width="240" height="135" aria-label="Current deterministic canvas frame"></canvas></aside>`;
  document.body.append(node);
  node.querySelector(".close")!.addEventListener("click", () => node.remove());
  const scenarioValue =
    node.querySelector<HTMLOutputElement>(".scenario-value")!;
  const updateScenario = (): void => {
    setSpriteLabel(
      scenarioValue,
      scenarioIds[scenarioIndex]!,
      "sprite-scenario-value",
    );
  };
  node.querySelectorAll<HTMLButtonElement>("[data-lab]").forEach(
    (b) =>
      (b.onclick = () => {
        const action = b.dataset.lab;
        if (action === "scenario-previous") {
          scenarioIndex =
            (scenarioIndex - 1 + scenarioIds.length) % scenarioIds.length;
          updateScenario();
        }
        if (action === "scenario-next") {
          scenarioIndex = (scenarioIndex + 1) % scenarioIds.length;
          updateScenario();
        }
        if (action === "load")
          void boot(BUILTIN_SCENARIOS[scenarioIds[scenarioIndex]!]!);
        if (action === "pause" && host) {
          const paused = host.togglePaused();
          setSpriteLabel(b, paused ? "Resume" : "Pause", "sprite-button-label");
        }
        if (action === "step" && host) host.step();
        if (action === "capture" && host) {
          const blob = new Blob(
              [JSON.stringify(host!.captureState(), null, 2)],
              { type: "application/json" },
            ),
            a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `cinderwake-${host!.state.tick}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }
      }),
  );
  const mini = node.querySelector<HTMLCanvasElement>(".mini")!;
  const tick = () => {
    if (!node.isConnected || !host) return;
    mini.getContext("2d")!.drawImage(host.renderer.canvas, 0, 0, 240, 135);
    requestAnimationFrame(tick);
  };
  tick();
}
async function initialize(): Promise<void> {
  const builtin = query.get("scenario");
  const showSelection = query.get("selection") === "1";
  if (showSelection) screen();
  else if (builtin && BUILTIN_SCENARIOS[builtin])
    await boot(BUILTIN_SCENARIOS[builtin]);
  else if (testMode) await boot(BUILTIN_SCENARIOS["animation-idle"]!);
  else screen();
}

void initialize();
