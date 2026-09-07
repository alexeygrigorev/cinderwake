import type { GameHost } from "./GameHost";
import type { InputController } from "../input/InputController";
import { GameAudio, VOICE_CUES, type VoiceCue } from "../audio/GameAudio";
import { nextLevelExperience } from "../game/content";
import {
  missionJournal,
  missionLandmarks,
  missionArchive,
  type MissionCue,
} from "../game/missions";
import { findStateNavigationRoute } from "../game/navigation";
import type { GameState, Vec2 } from "../game/types";
import {
  decodeSave,
  encodeSave,
  loadSave,
  safeToAutosave,
  storeSave,
  type CampaignSave,
} from "./saveGame";

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function browserSave(kind?: "manual" | "auto"): CampaignSave | null {
  try {
    return loadSave(localStorage, kind);
  } catch {
    return null;
  }
}

/** Accessible narrative lives in a paused, scrollable DOM sheet, never tiny atlas glyph paragraphs. */
export class CampaignUI {
  private readonly events = new AbortController();
  private readonly tools = document.createElement("nav");
  private readonly dialog = document.createElement("dialog");
  private readonly discoveries: Set<string>;
  private nearby?: MissionCue;
  private autosaveTick = 0;
  private lastMission = "";
  private lastMap = "";
  private route: Vec2[] = [];
  private routeTick = -60;
  private routeTarget = "";
  private previousFocus?: HTMLElement;
  private savingDisabled = false;
  private saveStatus = "Progress saves here automatically when you are safe.";

  constructor(
    private readonly host: GameHost,
    private readonly input: InputController,
    private readonly resume: (save: CampaignSave, imported?: boolean) => void,
    private readonly exit: () => void,
    discoveries: readonly string[] = [],
    readonly audio = new GameAudio(import.meta.env.BASE_URL),
  ) {
    this.discoveries = new Set(discoveries);
    this.tools.className = "campaign-tools";
    this.tools.setAttribute("aria-label", "Journey controls");
    this.tools.dataset.uiCopy = "campaign-controls";
    this.tools.innerHTML =
      '<button data-journal aria-label="Journal and save">Journal <kbd>J</kbd></button><button data-interact hidden></button><button data-sound-toggle aria-label="Enable sound">Sound off</button><span data-checkpoint-indicator role="status"></span>';
    this.dialog.className = "campaign-dialog";
    this.dialog.dataset.uiCopy = "campaign-narrative";
    this.dialog.setAttribute("aria-label", "The Last Bell journal");
    document.querySelector(".game")!.append(this.tools, this.dialog);
    this.tools.querySelector<HTMLButtonElement>("[data-journal]")!.onclick =
      () => this.open();
    this.tools.querySelector<HTMLButtonElement>("[data-interact]")!.onclick =
      () => this.interact();
    this.tools.querySelector<HTMLButtonElement>(
      "[data-sound-toggle]",
    )!.onclick = () => {
      const snapshot = this.audio.snapshot();
      this.audio.activate();
      if (
        snapshot.muted ||
        snapshot.volume === 0 ||
        snapshot.contextState !== "running"
      ) {
        this.audio.setMuted(false);
        if (snapshot.volume === 0) this.audio.setVolume(0.65);
        this.audio.startMusic();
      } else this.audio.setMuted(true);
      this.updateSoundStatus();
    };
    this.audio.startMusic();
    this.updateSoundStatus();
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    window.addEventListener("pointerdown", () => this.audio.activate(), {
      signal: this.events.signal,
    });
    window.addEventListener(
      "keydown",
      (event) => {
        this.audio.activate();
        if (
          event.repeat ||
          (event.target instanceof HTMLElement &&
            event.target.closest("input,textarea,select"))
        )
          return;
        if (event.key === "Escape" || event.key.toLowerCase() === "j") {
          event.preventDefault();
          if (this.dialog.open) this.close();
          else this.open();
        }
        if (event.key.toLowerCase() === "f" && !this.dialog.open) {
          event.preventDefault();
          this.interact();
        }
      },
      { signal: this.events.signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          this.audio.stop();
          this.input.resetInput();
          this.autosave();
          if (!this.dialog.open) this.open();
        }
      },
      { signal: this.events.signal },
    );
    window.addEventListener("pagehide", () => this.autosave(), {
      signal: this.events.signal,
    });
  }

  destroy(): void {
    this.events.abort();
    this.audio.stop();
    this.dialog.remove();
    this.tools.remove();
  }
  private say(id?: string): void {
    if (id && VOICE_CUES.includes(id as VoiceCue))
      this.audio.speak(id as VoiceCue);
  }

  update(state: GameState): void {
    this.tools.dataset.tick = String(state.tick);
    this.audio.observe(state);
    const journal = missionJournal(state);
    const missionKey = `${journal.activeId}:${state.phase}`;
    if (
      this.lastMission &&
      this.lastMission !== missionKey &&
      state.phase !== "lost"
    )
      this.say(journal.cue.voiceId);
    if (state.phase === "won" && this.lastMission !== missionKey)
      this.autosave();
    this.lastMission = missionKey;
    const landmarks = missionLandmarks(state);
    this.nearby = landmarks
      .filter(
        (cue) =>
          Math.hypot(
            cue.position.x - state.player.position.x,
            cue.position.y - state.player.position.y,
          ) < 1800,
      )
      .sort(
        (a, b) =>
          Math.hypot(
            a.position.x - state.player.position.x,
            a.position.y - state.player.position.y,
          ) -
          Math.hypot(
            b.position.x - state.player.position.x,
            b.position.y - state.player.position.y,
          ),
      )[0];
    const interact =
      this.tools.querySelector<HTMLButtonElement>("[data-interact]")!;
    interact.hidden = !this.nearby || state.phase !== "playing";
    if (this.nearby) {
      const text = `${this.nearby.kind === "npc" ? "Speak: " : "Read: "}${this.nearby.title}`;
      if (interact.textContent !== text) interact.textContent = text;
      interact.dataset.cue = this.nearby.id;
    }
    const objective = document.querySelector<HTMLElement>("#objective");
    if (objective) {
      objective.dataset.mission = journal.activeId;
      objective.dataset.missionTitle = journal.title;
      objective.dataset.targetId = journal.cue.id;
      objective.setAttribute(
        "aria-label",
        `${journal.title}. ${journal.cue.text} Direction follows the walkable route.`,
      );
      // Recompute only a few times per second; routefinding every render starves mobile input.
      if (
        state.tick < this.routeTick ||
        state.tick - this.routeTick >= 20 ||
        this.routeTarget !== journal.cue.id ||
        this.lastMap !== state.map.digest
      ) {
        this.route = [
          ...findStateNavigationRoute(
            state,
            state.player.position,
            journal.cue.position,
            state.player.radius,
          ),
        ];
        this.routeTick = state.tick;
        this.routeTarget = journal.cue.id;
        this.lastMap = state.map.digest;
      }
      while (
        this.route[0] &&
        Math.hypot(
          this.route[0].x - state.player.position.x,
          this.route[0].y - state.player.position.y,
        ) <= 160
      )
        this.route.shift();
      const waypoint = this.route[0] ?? journal.cue.position;
      const angle =
        (Math.atan2(
          waypoint.y - state.player.position.y,
          waypoint.x - state.player.position.x,
        ) *
          180) /
          Math.PI -
        90;
      objective.querySelector<HTMLElement>(
        ".objective-direction",
      )!.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      objective.dataset.route = this.route.length ? "walkable" : "unavailable";
    }
    if (state.tick < this.autosaveTick) this.autosaveTick = state.tick;
    if (state.tick - this.autosaveTick >= 600) this.autosave();
    this.updateSoundStatus();
  }

  private updateSoundStatus(): void {
    const snapshot = this.audio.snapshot();
    this.tools.dataset.audio = JSON.stringify(snapshot);
    const button = this.tools.querySelector<HTMLButtonElement>(
      "[data-sound-toggle]",
    )!;
    const enabled =
      !snapshot.muted &&
      snapshot.volume > 0 &&
      snapshot.contextState === "running";
    const text = enabled ? "Sound on" : "Sound off";
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute("aria-label", enabled ? "Mute sound" : "Enable sound");
    button.setAttribute("aria-pressed", String(enabled));
    button.title = snapshot.failed
      ? "Some audio could not load. Check your connection."
      : "Music, combat sounds and voices";
  }

  /** Start-of-run checkpoint is intentional even if the opening ambush is nearby. */
  checkpoint(): void {
    this.save("auto");
  }
  private autosave(): void {
    if (!this.savingDisabled && safeToAutosave(this.host.getState()))
      this.save("auto");
  }
  private save(kind: "auto" | "manual"): boolean {
    const state = this.host.getState();
    this.autosaveTick = state.tick;
    if (state.phase === "lost") {
      this.status("Cannot save a fallen character. Load a checkpoint.");
      return false;
    }
    try {
      const saved = storeSave(localStorage, state, [...this.discoveries], kind);
      this.status(
        kind === "manual"
          ? "Checkpoint saved on this browser."
          : "Autosaved safely on this browser.",
        "saved",
      );
      const slot = this.dialog.querySelector(`[data-save-slot="${kind}"]`);
      if (slot) slot.textContent = this.describeSave(saved);
      this.savingDisabled = false;
      return true;
    } catch {
      this.savingDisabled = true;
      this.status(
        "Browser storage unavailable. Export a save file to keep your progress.",
        "unavailable",
      );
      return false;
    }
  }
  status(message: string, saveState?: "saved" | "unavailable"): void {
    this.saveStatus = message;
    const status = this.dialog.querySelector("[data-save-status]");
    if (status) status.textContent = message;
    const indicator = this.tools.querySelector<HTMLElement>(
      "[data-checkpoint-indicator]",
    )!;
    if (saveState) {
      indicator.dataset.saveState = saveState;
      indicator.textContent =
        saveState === "saved" ? "Saved here" : "Save unavailable";
      indicator.title = message;
    }
  }
  private describeSave(save: CampaignSave | null): string {
    if (!save) return "No checkpoint yet";
    return `${new Date(save.savedAt).toLocaleString()} · Level ${save.state.player.level}${save.state.phase === "won" ? " · Journey complete" : ""}`;
  }
  private interact(): void {
    if (!this.nearby) return;
    this.discoveries.add(this.nearby.id);
    this.open(this.nearby);
    this.say(this.nearby.voiceId);
  }
  open(cue?: MissionCue): void {
    this.host.setPaused(true);
    this.input.resetInput();
    if (!this.dialog.open)
      this.previousFocus = document.activeElement as HTMLElement;
    const state = this.host.getState();
    const journal = missionJournal(state);
    const read = missionArchive(state, this.discoveries);
    const saved = browserSave("manual");
    const auto = browserSave("auto");
    this.dialog.innerHTML = `<header><div><small>FIELD JOURNAL · GAME PAUSED</small><h2>The Last Bell</h2></div><button data-close aria-label="Back to game">Back to game <kbd>Esc</kbd></button></header>
      <p class="hero-progress">Level ${state.player.level} · XP ${state.player.xp}/${nextLevelExperience(state.player.level)} · Power ${state.player.power} · Supplies ${state.player.tonics} tonics · Gold ${state.player.gold}</p>
      ${cue ? `<article class="discovery"><small>${escape(cue.kind.toUpperCase())}</small><h3>${escape(cue.title)}</h3><p>${escape(cue.text)}</p>${cue.voiceId ? "<button data-listen>Listen again</button>" : ""}</article>` : `<p class="journal-summary">${escape(journal.summary)}</p>`}
      ${journal.guidance ? `<p class="journal-guidance" role="note"><strong>Bell Keeper tactic.</strong> ${escape(journal.guidance)}</p>` : ""}
      <ol class="mission-list">${journal.objectives.map((objective) => `<li data-mission-id="${objective.id}" data-complete="${objective.complete}" ${objective.id === journal.activeId ? 'aria-current="step"' : ""}><span>${objective.complete ? "✓" : `${objective.current}/${objective.total}`}</span><div><h3>${escape(objective.title)}</h3><p>${escape(objective.description)}</p></div></li>`).join("")}</ol>
      ${journal.ending ? `<p class="journal-ending">${escape(journal.ending)}</p>` : ""}
      ${read.length ? `<details><summary>Discovered writings and conversations (${this.discoveries.size})</summary>${read.map((entry) => `<h3>${escape(entry.title)}</h3><p>${escape(entry.text)}</p>`).join("")}</details>` : ""}
      <section class="save-controls" aria-label="Saved journey"><h3>Save your progress</h3><p data-save-status role="status">${escape(this.saveStatus)}</p><p class="save-location">Saved in this browser on this device. Clearing site data removes these saves. Export a save file to keep a backup or move to another device, then import it there.</p><dl class="save-slots"><dt>Manual checkpoint</dt><dd data-save-slot="manual">${escape(this.describeSave(saved))}</dd><dt>Safe autosave</dt><dd data-save-slot="auto">${escape(this.describeSave(auto))}</dd></dl><div class="journal-actions"><button data-save ${state.phase === "lost" ? "disabled" : ""}>Save checkpoint</button><button data-load="manual" ${saved ? "" : "disabled"}>Load checkpoint</button><button data-load="auto" ${auto ? "" : "disabled"}>Load autosave</button><button data-export>Export save</button><label class="import-save">Import save<input type="file" accept=".json,application/json" data-import-save aria-label="Import save" /></label><button data-exit>Save and leave</button></div></section>
      <details class="controls-help"><summary>Controls and sound</summary><p>Click clear ground to move. Click an enemy to pursue and attack. WASD / arrows move; Space or Shift-click holds your ground and attacks. Right click / E uses your class ability. Q drinks a tonic. F reads or speaks nearby. J opens this journal. On touch screens, tap to travel or use the movement pad; hold Strike to attack nearby foes.</p><p>Save checkpoint keeps a manual slot. Autosave uses a separate slot when you are safe and above half health. Export a file before clearing browser data.</p><button data-mute aria-pressed="${this.audio.snapshot().muted}">${this.audio.snapshot().muted ? "Unmute sound" : "Mute sound"}</button><label>Volume <input data-volume type="range" min="0" max="1" step="0.05" value="${this.audio.snapshot().volume}" /></label></details><button data-leave>Leave without saving</button>`;
    this.dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick =
      () => this.close();
    const listen =
      this.dialog.querySelector<HTMLButtonElement>("[data-listen]");
    if (listen) listen.onclick = () => this.say(cue?.voiceId);
    this.dialog.querySelector<HTMLButtonElement>("[data-save]")!.onclick =
      () => {
        if (this.save("manual"))
          this.dialog.querySelector<HTMLButtonElement>(
            '[data-load="manual"]',
          )!.disabled = false;
      };
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-load]")
      .forEach((button) => {
        button.onclick = () => {
          const save = browserSave(button.dataset.load as "manual" | "auto");
          if (save) this.resume(save);
        };
      });
    this.dialog.querySelector<HTMLButtonElement>("[data-export]")!.onclick =
      () => {
        const blob = new Blob([encodeSave(state, [...this.discoveries])], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `cinderwake-${state.seed.replace(/[^a-zA-Z0-9_-]/g, "_")}-${state.tick}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    this.dialog.querySelector<HTMLInputElement>(
      "[data-import-save]",
    )!.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        if (file.size > 4_194_304) throw new Error("File exceeds 4 MB.");
        const imported = decodeSave(await file.text());
        // Import is validated before any checkpoint or running state is replaced.
        this.resume(imported, true);
      } catch (error) {
        this.status(
          `Could not import: ${error instanceof Error ? error.message : "invalid file"}`,
        );
      }
    };
    this.dialog.querySelector<HTMLButtonElement>("[data-exit]")!.onclick =
      () => {
        if (this.save("manual")) this.exit();
      };
    this.dialog.querySelector<HTMLButtonElement>("[data-leave]")!.onclick =
      () => this.exit();
    this.dialog.querySelector<HTMLButtonElement>("[data-mute]")!.onclick = (
      event,
    ) => {
      const muted = !this.audio.snapshot().muted;
      this.audio.setMuted(muted);
      const button = event.currentTarget as HTMLButtonElement;
      button.textContent = muted ? "Unmute sound" : "Mute sound";
      button.setAttribute("aria-pressed", String(muted));
    };
    this.dialog.querySelector<HTMLInputElement>("[data-volume]")!.oninput = (
      event,
    ) => this.audio.setVolume(Number((event.target as HTMLInputElement).value));
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector<HTMLButtonElement>("[data-close]")!.focus();
  }
  private close(): void {
    this.dialog.close();
    this.input.resetInput();
    this.host.setPaused(false);
    this.audio.startMusic();
    this.previousFocus?.focus();
  }
}
