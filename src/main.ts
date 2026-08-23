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

function screen(): void {
  app.innerHTML = `<main class="selection" style="--terrain-atlas:url('${assetBase}assets/sprites/environment-terrain.png');--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><section class="hero"><p class="eyebrow">A deterministic action RPG</p><h1>Cinderwake</h1><p>${spriteText("Descend into the ember-dark. Every run begins with a seed - and every strike can be replayed.", "sprite-copy")}</p><div class="hero-lineup" aria-label="Three Cinderwake heroes">${[
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
    )}</div></section><section class="choose"><p class="eyebrow">Choose your ember</p><div class="cards">${Object.values(
    ARCHETYPES,
  )
    .map(
      (a) =>
        `<button class="class-card ${selected === a.id ? "selected" : ""}" data-class="${a.id}" style="--accent:${a.accent}" aria-label="${escapeAttribute(`${a.name}. ${a.role}. ${a.description}`)}"><span class="class-portrait" style="background-image:url('${assetBase}assets/sprites/actor-${a.id}.png')"></span><strong>${a.name}</strong>${spriteText(a.role, "sprite-role")}${spriteText(a.description, "sprite-description")}${spriteText(`HP ${a.health} / ARM ${a.armor}`, "sprite-stats")}</button>`,
    )
    .join(
      "",
    )}</div><label class="seed-label">Run seed <input id="seed" value="${seed}" maxlength="48" /></label><button id="begin" class="begin">Enter the wake <span>→</span></button><p class="hint">${spriteText("Keyboard, pointer, or touch controls / every input is replayable", "sprite-hint")}</p></section><button class="lab-toggle">Test lab</button></main>`;
  app.querySelectorAll<HTMLButtonElement>("[data-class]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.class as CharacterClass;
        screen();
      }),
  );
  app.querySelector<HTMLInputElement>("#seed")!.oninput = (e) =>
    (seed = (e.target as HTMLInputElement).value);
  app.querySelector<HTMLButtonElement>("#begin")!.onclick = () =>
    void boot(createRunScenario(seed || "cinder-041", selected));
  app.querySelector<HTMLButtonElement>(".lab-toggle")!.onclick = () => lab();
}
async function boot(scenario: ScenarioV1): Promise<void> {
  activeScenario = scenario;
  app.innerHTML = `<main class="loading"><h1>Cinderwake</h1><p>Waking the atlas…</p></main>`;
  await preloadSpriteAssets();
  app.innerHTML = `<main class="game" style="--terrain-atlas:url('${assetBase}assets/sprites/environment-terrain.png');--ui-atlas:url('${assetBase}assets/sprites/ui.png');--glyph-atlas:url('${assetBase}assets/sprites/glyphs.png')"><div class="stage"><canvas aria-label="Cinderwake game view"></canvas><div class="hud top"><div class="brand">CINDERWAKE <small></small></div><div class="counter" id="monsters"></div></div><div class="hud bottom"><div class="health"><span>VITALITY</span><b><i id="hpbar"></i></b><em id="hp"></em></div><div class="skills"><button data-action="attack"><kbd>Click</kbd> Strike</button><button data-action="ability"><kbd>Right click</kbd> Ability <i id="cd"></i></button><button data-action="tonic"><kbd>Q</kbd> Tonic <i id="tonics"></i></button></div></div><aside class="loot-log"><strong>Run log</strong><div id="log"></div></aside><div id="outcome" class="outcome hidden"></div></div><nav class="mobile-controls" aria-label="Touch game controls"><div class="move-pad" data-direction="0,0" role="application" aria-label="Eight-direction movement pad"><span class="move-ring"></span><span class="move-knob"></span><small>Move</small></div><div class="mobile-actions"><button data-action="attack" aria-label="Strike"><strong>Strike</strong><span>Primary</span></button><button data-action="ability" aria-label="Use ability"><strong>Ability</strong><span id="mobile-cd"></span></button><button data-action="tonic" aria-label="Drink tonic"><strong>Tonic</strong><span id="mobile-tonics"></span></button></div></nav><button class="lab-toggle">Test lab</button></main>`;
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
    out.innerHTML = `<p>${state.phase === "won" ? "Rift sealed" : "The wake consumes you"}</p><h2>${state.phase === "won" ? "Cinders quieted." : "Run ended."}</h2><button>Try again</button>`;
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
  const node = document.createElement("aside");
  node.className = "lab";
  node.innerHTML = `<button class="close">×</button><p class="eyebrow">Deterministic tools</p><h2>Test lab</h2><label>Scenario<select>${Object.keys(
    BUILTIN_SCENARIOS,
  )
    .map((x) => `<option value="${x}">${x}</option>`)
    .join(
      "",
    )}</select></label><div><button data-lab="load">Load</button><button data-lab="pause">Pause</button><button data-lab="step">Step +1</button></div><button data-lab="capture">Download state JSON</button><p class="frame">Frame strip uses the current deterministic canvas frame.</p><canvas class="mini" width="240" height="135"></canvas></aside>`;
  document.body.append(node);
  node.querySelector(".close")!.addEventListener("click", () => node.remove());
  node.querySelectorAll<HTMLButtonElement>("[data-lab]").forEach(
    (b) =>
      (b.onclick = () => {
        const action = b.dataset.lab;
        if (action === "load")
          void boot(
            BUILTIN_SCENARIOS[
              (node.querySelector("select") as HTMLSelectElement).value
            ]!,
          );
        if (action === "pause")
          b.textContent = host!.togglePaused() ? "Resume" : "Pause";
        if (action === "step") host!.step();
        if (action === "capture") {
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
