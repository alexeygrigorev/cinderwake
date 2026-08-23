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

const app = document.querySelector<HTMLDivElement>("#app")!;
let selected: CharacterClass = "vanguard",
  seed = "cinder-041",
  host: GameHost | undefined,
  input: InputController | undefined,
  activeScenario: ScenarioV1 | undefined;
const query = new URLSearchParams(location.search),
  testMode = query.get("testMode") === "1";
function screen(): void {
  app.innerHTML = `<main class="selection"><section class="hero"><p class="eyebrow">A deterministic action RPG</p><h1>Cinderwake</h1><p>Descend into the ember-dark. Every run begins with a seed—and every strike can be replayed.</p><img src="/assets/cinderwake-heroes.png" alt="Three Cinderwake heroes" /></section><section class="choose"><p class="eyebrow">Choose your ember</p><div class="cards">${Object.values(
    ARCHETYPES,
  )
    .map(
      (a) =>
        `<button class="class-card ${selected === a.id ? "selected" : ""}" data-class="${a.id}" style="--accent:${a.accent}"><strong>${a.name}</strong><span>${a.role}</span><small>${a.description}</small><i>HP ${a.health} · ARM ${a.armor}</i></button>`,
    )
    .join(
      "",
    )}</div><label class="seed-label">Run seed <input id="seed" value="${seed}" maxlength="48" /></label><button id="begin" class="begin">Enter the wake <span>→</span></button><p class="hint">WASD / arrows to move · aim with mouse · click to strike</p></section><button class="lab-toggle">Test lab</button></main>`;
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
    boot(createRunScenario(seed || "cinder-041", selected));
  app.querySelector<HTMLButtonElement>(".lab-toggle")!.onclick = () => lab();
}
function boot(scenario: ScenarioV1): void {
  activeScenario = scenario;
  app.innerHTML = `<main class="game"><div class="stage"><canvas aria-label="Cinderwake game view"></canvas><div class="hud top"><div class="brand">CINDERWAKE <small>${scenario.seed}</small></div><div class="counter" id="monsters">— foes</div></div><div class="hud bottom"><div class="health"><span>VITALITY</span><b><i id="hpbar"></i></b><em id="hp">— / —</em></div><div class="skills"><button data-action="attack"><kbd>Click</kbd> Strike</button><button data-action="ability"><kbd>Right click</kbd> Ability <i id="cd">READY</i></button><button data-action="tonic"><kbd>Q</kbd> Tonic <i id="tonics">0</i></button></div></div><aside class="loot-log"><strong>Run log</strong><div id="log">The cinders stir.</div></aside><div id="outcome" class="outcome hidden"></div></div><button class="lab-toggle">Test lab</button></main>`;
  const canvas = app.querySelector<HTMLCanvasElement>("canvas")!;
  host?.stop();
  host = new GameHost(canvas, testMode);
  input = new InputController(canvas, (x, y) => host!.worldAt(x, y));
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
    cd = document.querySelector<HTMLElement>("#cd"),
    log = document.querySelector<HTMLElement>("#log");
  if (!hp) return;
  hp.textContent = `${p.health} / ${p.maxHealth}`;
  bar!.style.width = `${(100 * p.health) / p.maxHealth}%`;
  monsters!.textContent = `${state.monsters.length} ${state.monsters.length === 1 ? "foe" : "foes"}`;
  tonics!.textContent = `${p.tonics}`;
  cd!.textContent =
    state.tick >= p.abilityReadyTick
      ? "READY"
      : `${((p.abilityReadyTick - state.tick) / 60).toFixed(1)}s`;
  const events = (state.events.length ? state.events : state.eventLog).slice(
    -2,
  );
  log!.innerHTML = events.length
    ? events
        .map(
          (event) =>
            event.type.replaceAll("_", " ") +
            (event.amount ? ` +${event.amount}` : ""),
        )
        .join("<br>")
    : "The cinders stir.";
  if (state.phase !== "playing") {
    const out = document.querySelector<HTMLElement>("#outcome")!;
    out.classList.remove("hidden");
    out.innerHTML = `<p>${state.phase === "won" ? "Rift sealed" : "The wake consumes you"}</p><h2>${state.phase === "won" ? "Cinders quieted." : "Run ended."}</h2><button>Try again</button>`;
    out.querySelector("button")!.onclick = () => boot(activeScenario!);
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
          boot(
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
const builtin = query.get("scenario");
if (builtin && BUILTIN_SCENARIOS[builtin]) boot(BUILTIN_SCENARIOS[builtin]);
else screen();
if (testMode) {
  if (!host) boot(BUILTIN_SCENARIOS["animation-idle"]!);
  installGameTestBridge(host!);
}
