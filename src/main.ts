import "./styles.css";
import { ARCHETYPES } from "./game/content";
import type { CharacterClass, GameState } from "./game/types";
import {
  BUILTIN_SCENARIOS,
  createRunScenario,
  type ScenarioV1,
} from "./testkit/scenarios";
import { GameHost } from "./app/GameHost";
import { InputController } from "./input/InputController";
import { installGameTestBridge } from "./testkit/browserBridge";
import { preloadSpriteAssets } from "./render/sprites";

const app = document.querySelector<HTMLDivElement>("#app")!;
const assetBase = import.meta.env.BASE_URL;
let selected: CharacterClass = "vanguard",
  seed = "cinder-041",
  host: GameHost | undefined,
  input: InputController | undefined,
  activeScenario: ScenarioV1 | undefined;
const query = new URLSearchParams(location.search),
  testMode = query.get("testMode") === "1";

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

function screen(): void {
  app.innerHTML = `<main class="selection" style="--terrain-atlas:url('${assetBase}assets/sprites/environment-terrain.png');--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><section class="hero"><p class="eyebrow">${spriteText("A deterministic action RPG", "sprite-eyebrow")}</p><h1 data-ui-title>Cinderwake</h1><p>${spriteText("Descend into the ember-dark. Every run begins with a seed - and every strike can be replayed.", "sprite-copy")}</p><div class="hero-lineup" aria-label="Three Cinderwake heroes">${[
    "vanguard",
    "ranger",
    "arcanist",
  ]
    .map(
      (classId) =>
        `<span style="background-image:url('${assetBase}assets/sprites/actor-${classId}.png')"></span>`,
    )
    .join(
      "",
    )}</div></section><section class="choose"><p class="eyebrow">${spriteText("Choose your ember", "sprite-eyebrow")}</p><div class="cards">${Object.values(
    ARCHETYPES,
  )
    .map(
      (a) =>
        `<button class="class-card ${selected === a.id ? "selected" : ""}" data-class="${a.id}" style="--accent:${a.accent}" aria-label="${escapeAttribute(`${a.name}. ${a.role}. ${a.description}`)}"><span class="class-portrait" style="background-image:url('${assetBase}assets/sprites/actor-${a.id}.png')"></span><strong data-ui-title>${a.name}</strong>${spriteText(a.role, "sprite-role")}${spriteText(a.description, "sprite-description")}${spriteText(`HP ${a.health} / ARM ${a.armor}`, "sprite-stats")}</button>`,
    )
    .join(
      "",
    )}</div><label class="seed-label">${spriteText("Run seed", "sprite-seed-label")}<span class="seed-control"><input id="seed" value="${escapeAttribute(seed)}" maxlength="48" aria-label="Run seed" autocomplete="off" spellcheck="false" /><span class="seed-display sprite-text" aria-hidden="true">${spriteGlyphs(seed)}</span></span></label><button id="begin" class="begin" aria-label="Enter the wake">${spriteText("Enter the wake >", "sprite-button-label")}</button><p class="hint">${spriteText("Keyboard, pointer, or touch controls / every input is replayable", "sprite-hint")}</p><button class="lab-toggle selection-lab-toggle" aria-label="Open Test lab">${spriteText("Test lab", "sprite-button-label")}</button></section></main>`;
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
  app.querySelector<HTMLButtonElement>("#begin")!.onclick = () =>
    void boot(createRunScenario(seed || "cinder-041", selected));
  app.querySelector<HTMLButtonElement>(".lab-toggle")!.onclick = () => lab();
}
async function boot(scenario: ScenarioV1): Promise<void> {
  activeScenario = scenario;
  app.innerHTML = `<main class="loading" style="--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><h1 data-ui-title>Cinderwake</h1><p>${spriteText("Waking the atlas...", "sprite-loading")}</p></main>`;
  await preloadSpriteAssets();
  app.innerHTML = `<main class="game" style="--terrain-atlas:url('${assetBase}assets/sprites/environment-terrain.png');--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><div class="stage"><canvas aria-label="Cinderwake game view"></canvas><div class="hud top"><div class="brand" data-ui-title>CINDERWAKE <small></small></div><div class="counter" id="monsters"></div></div><div class="hud bottom"><div class="health"><div class="health-label">${spriteText("Vitality", "sprite-hud-label")}</div><b><i id="hpbar"></i></b><em id="hp"></em></div><div class="skills"><button data-action="attack" aria-label="Strike">${spriteText("Click", "sprite-shortcut")}${spriteText("Strike", "sprite-action-label")}</button><button data-action="ability" aria-label="Use ability">${spriteText("Right click", "sprite-shortcut")}${spriteText("Ability", "sprite-action-label")}<i id="cd"></i></button><button data-action="tonic" aria-label="Drink tonic">${spriteText("Q", "sprite-shortcut")}${spriteText("Tonic", "sprite-action-label")}<i id="tonics"></i></button></div></div><aside class="loot-log"><strong>${spriteText("Run log", "sprite-panel-label")}</strong><div id="log"></div></aside><div id="outcome" class="outcome hidden"></div></div><nav class="mobile-controls" aria-label="Touch game controls"><div class="move-pad" data-direction="0,0" role="application" aria-label="Eight-direction movement pad"><span class="move-ring"></span><span class="move-knob"></span><small>${spriteText("Move", "sprite-control-label")}</small></div><div class="mobile-actions"><button data-action="attack" aria-label="Strike"><strong>${spriteText("Strike", "sprite-action-label")}</strong><span>${spriteText("Primary", "sprite-action-detail")}</span></button><button data-action="ability" aria-label="Use ability"><strong>${spriteText("Ability", "sprite-action-label")}</strong><span id="mobile-cd"></span></button><button data-action="tonic" aria-label="Drink tonic"><strong>${spriteText("Tonic", "sprite-action-label")}</strong><span id="mobile-tonics"></span></button></div></nav><button class="lab-toggle" aria-label="Open Test lab">${spriteText("Test lab", "sprite-button-label")}</button></main>`;
  const canvas = app.querySelector<HTMLCanvasElement>("canvas")!;
  host?.stop();
  input?.destroy();
  host = new GameHost(canvas, testMode);
  input = new InputController(canvas, (x, y) => host!.worldAt(x, y));
  input.attachMovePad(app.querySelector<HTMLElement>(".move-pad")!);
  host.inputProvider = () => input!.sample();
  host.onRender = updateHud;
  host.startScenario(scenario);
  host.start();
  app
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          input!.press(b.dataset.action as "attack" | "ability" | "tonic")),
    );
  app.querySelector<HTMLButtonElement>(".lab-toggle")!.onclick = () => lab();
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
    log = document.querySelector<HTMLElement>("#log");
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
  const events = (state.events.length ? state.events : state.eventLog).slice(
    -2,
  );
  log!.innerHTML = spriteText(
    events.length
      ? events
          .map(
            (event) =>
              event.type.replaceAll("_", " ") +
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
  if (builtin && BUILTIN_SCENARIOS[builtin])
    await boot(BUILTIN_SCENARIOS[builtin]);
  else if (testMode) await boot(BUILTIN_SCENARIOS["animation-idle"]!);
  else screen();
  if (testMode) installGameTestBridge(host!);
}

void initialize();
