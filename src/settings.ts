import { AbstractInputSuggest, App, ButtonComponent, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder, setIcon, setTooltip } from "obsidian";
import { ChatClient } from "./chat_client";
import { EmbeddingClient } from "./embedder";
import { resolveCapabilities } from "./capabilities";
import { reasoningHappened, isAlwaysOnThinker } from "./reasoning";
import { normalizeIndexDir, isDotPath } from "./index_dir";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { ENDPOINT_PRESETS, validateEndpointInput } from "./vendor/kit/endpoint_diagnostics";
import { EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
import type { ApplyMode } from "./note_restructurer";

/** Migriert alte Einzel-Endpoint-Settings auf eine Liste. Reiner Helfer. */
export function migrateEndpointList(single: string | undefined, list: string[] | undefined): string[] {
  if (list && list.length) return list.filter(e => e && e.trim());
  if (single && single.trim()) return [single.trim()];
  return [];
}

/** Wendet die Bearbeitung EINES Endpoint-Felds auf die Liste an (bei blur, nicht pro Tastendruck).
 *  isAdder=true: nicht-leerer Wert wird angehängt. isAdder=false: Index setzen (leer → entfernen). Getrimmt+leer-gefiltert. */
export function applyEndpointEdit(endpoints: string[], index: number, value: string, isAdder: boolean): string[] {
  const v = value.trim();
  const next = [...endpoints];
  if (isAdder) { if (v) next.push(v); }
  else if (v) { next[index] = v; }
  else { next.splice(index, 1); }
  return next.map(e => e.trim()).filter(e => e);
}

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  hideIndexFolder: boolean;
  exclude: string[];
  embeddingEndpoints: string[];
  embeddingModel: string;
  showStatusBar: boolean;
  debounceMs: number;
  chatEndpoints: string[];
  chatModel: string;
  chatK: number;
  contextCharBudget: number;
  chatTemperature: number;
  chatSystemPrompt: string;
  chatInputPosition: "bottom" | "top";
  suppressThinking: boolean;
  enterSends: boolean;
  smartApplyEnabled: boolean;
  templateDir: string;
  smartApplyTemperature: number;
  smartApplyModel: string;
  smartApplySuppressThinking: boolean;
  smartApplyMaxTokens: number;
  smartApplyDefaultMode: ApplyMode;
}

export const DEFAULT_SYSTEM_PROMPT =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  hideIndexFolder: true,
  exclude: ["Templates/", "Archive/"],
  embeddingEndpoints: ["http://localhost:11434"],
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
  debounceMs: 3000,
  chatEndpoints: ["http://localhost:1234"],
  chatModel: "qwen3",
  chatK: 5,
  contextCharBudget: 12000,
  chatTemperature: 0.7,
  chatSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  chatInputPosition: "bottom",
  suppressThinking: false,
  enterSends: true,
  smartApplyEnabled: false,
  templateDir: "Templates/",
  smartApplyTemperature: 0,
  smartApplyModel: "",
  smartApplySuppressThinking: false,
  smartApplyMaxTokens: 4096,
  smartApplyDefaultMode: "deterministisch",
};

type Caps = { vision: string; thinking: { support: string; confidence: string } };

/** Die Plugin-Oberfläche, die der Settings-Tab nutzt — getypt statt `any`. */
export interface VaultRagPluginHost extends Plugin {
  settings: VaultRagSettings;
  embedder: EmbeddingClient;
  chatClient: ChatClient;
  activeEmbeddingEndpoint: string | null;
  activeChatEndpoint: string | null;
  embeddingProgress: { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number };
  saveSettings(): Promise<void>;
  refresh(): void;
  refreshSmartApplyRanking(): void;
  resolveAndReconnectEmbedder(): Promise<void>;
  resolveAndReconnectChat(): Promise<void>;
  embedderReady(): Promise<boolean>;
  setStatusBarVisible(visible: boolean): void;
  reindexVault(): Promise<void>;
  refreshIndexFolderHiding(): void;
  changeIndexDir(newDir: string): Promise<void>;
}

/** Autocomplete-Suggest für Vault-Ordner in einem Text-Input-Feld. */
class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private textInputEl: HTMLInputElement) {
    super(app, textInputEl);
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllFolders()
      .map((f: TFolder) => f.path)
      .filter((p: string) => p.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(path);
    this.textInputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}

class ReindexConfirmModal extends Modal {
  constructor(app: App, private onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Vault neu indizieren?" });
    contentEl.createEl("p", {
      text: "Alle Notizen werden neu eingebettet — das kann dauern. Dein bestehender Index bleibt erhalten, bis die Indizierung vollständig durchläuft.",
    });
    const btnRow = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btnRow)
      .setButtonText("Abbrechen")
      .onClick(() => this.close());
    new ButtonComponent(btnRow)
      .setButtonText("Neu indizieren")
      .setClass("mod-warning")
      .onClick(() => { this.close(); this.onConfirm(); });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Settings-Tab. Die Zeilen-Logik lebt in `build*`-Methoden, die EINEN `Setting` füllen; `display()`
 * rendert sie flach. Querverweise zwischen Zeilen (Modelldetails↔Budget-Slider, Suppress-Test↔
 * Fähigkeiten) laufen über Render-State-Felder, die `resetRenderState()` pro Render-Zyklus neu setzt.
 */
export class VaultRagSettingTab extends PluginSettingTab {
  private refreshInterval: ReturnType<typeof window.setInterval> | null = null;
  private lastCaps: Caps = { vision: "no", thinking: { support: "none", confidence: "no" } };
  private updateBudgetMax: (maxChars: number) => void = () => {};
  private infoValue: HTMLElement | null = null;
  private capSetting: Setting | null = null;
  // Endpunkte nur beim ECHTEN Tab-Öffnen auflösen, nicht bei jedem Re-Render: blur/Trash/
  // „Verbindung prüfen"/rerender rufen display() direkt, und die Edit-Handler reconnecten
  // bereits explizit — sonst 3 Resolves pro Edit (verbreitert das liveIndexer-Race-Fenster).
  private resolvedOnOpen = false;

  constructor(app: App, private plugin: VaultRagPluginHost) { super(app, plugin); }

  hide(): void {
    this.clearInterval();
    this.resolvedOnOpen = false;
    super.hide();
  }

  private clearInterval(): void {
    if (this.refreshInterval !== null) { window.clearInterval(this.refreshInterval); this.refreshInterval = null; }
  }

  private resetRenderState(): void {
    // Intervall NUR in buildEmbeddingStatus (clear-then-start) starten + in hide() stoppen —
    // hier nicht anfassen.
    this.lastCaps = { vision: "no", thinking: { support: "none", confidence: "no" } };
    this.updateBudgetMax = () => {};
    this.infoValue = null;
    this.capSetting = null;
  }

  /** Re-Render nach einem Daten-Refresh (z.B. „Modelle laden“). */
  private rerender(): void {
    // display() ist seit 1.13 deprecated, bleibt aber der Render-Pfad für minAppVersion 1.7.2.
    this.display();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.resetRenderState();
    // Verbindungs-Moment NUR beim Tab-Öffnen (nicht bei Re-Renders): aktive Endpunkte aus den
    // Fallback-Listen auflösen (fire-and-forget; Status-Icons + Status-Poll spiegeln das Ergebnis).
    if (!this.resolvedOnOpen) {
      this.resolvedOnOpen = true;
      void this.plugin.resolveAndReconnectEmbedder();
      void this.plugin.resolveAndReconnectChat();
    }
    const sec = (name: string): void => { new Setting(containerEl).setName(name).setHeading(); };
    sec("Suche");
    this.buildK(new Setting(containerEl));
    this.buildMinSim(new Setting(containerEl));
    this.buildExclude(new Setting(containerEl));
    sec("Live-Embedding");
    this.buildEmbeddingEndpointList();
    this.buildEmbeddingModel(new Setting(containerEl));
    this.buildEmbeddingStatus(new Setting(containerEl));
    this.buildDebounce(new Setting(containerEl));
    this.buildStatusBar(new Setting(containerEl));
    sec("Index");
    this.buildIndexDir(new Setting(containerEl));
    this.buildHideIndexFolder(new Setting(containerEl));
    this.buildReindexButton(new Setting(containerEl));
    sec("Chat");
    this.buildChatEndpointList();
    this.buildChatModel(new Setting(containerEl));
    this.buildModelDetails(new Setting(containerEl));
    this.buildCaps(new Setting(containerEl));
    this.buildChatK(new Setting(containerEl));
    this.buildBudget(new Setting(containerEl));
    this.buildTemp(new Setting(containerEl));
    this.buildSystemPrompt(new Setting(containerEl));
    this.buildInputPos(new Setting(containerEl));
    this.buildThinking(new Setting(containerEl));
    this.buildEnter(new Setting(containerEl));
    sec("Smart Apply");
    this.buildSmartApplyEnabled(new Setting(containerEl));
    this.buildSmartApplyConnectionNote(new Setting(containerEl));
    this.buildTemplateDir(new Setting(containerEl));
    this.buildSmartApplyTemperature(new Setting(containerEl));
    this.buildSmartApplyModel(new Setting(containerEl));
    this.buildSmartApplySuppress(new Setting(containerEl));
    this.buildSmartApplyMaxTokens(new Setting(containerEl));
    this.buildSmartApplyDefaultMode(new Setting(containerEl));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Geordneter Endpunkt-Fallback-Listen-Editor (für Embedding wie Chat identisch).
   *  Rendert `[...endpoints, ""]` (leeres Add-Feld), Label/Desc nur in Zeile 0. Mutation NUR
   *  bei blur (nicht pro Tastendruck), via applyEndpointEdit → saveSettings → reconnect → Re-Render.
   *  Pro echtem Eintrag: Status-Icon (loader → check/x, aktiver Endpunkt markiert) + Mülleimer. */
  private buildEndpointList(opts: {
    containerEl: HTMLElement;
    label: string; desc: string; placeholder: string;
    get: () => string[]; set: (eps: string[]) => void;
    active: () => string | null;
    probe: (ep: string) => Promise<EndpointStatus>;
    reconnect: () => Promise<void>;
  }): void {
    const eps = opts.get();
    const rows = [...eps, ""];   // leeres Zusatzfeld am Ende
    rows.forEach((value, i) => {
      const isAdder = i >= eps.length;
      const s = new Setting(opts.containerEl);
      if (i === 0) s.setName(opts.label).setDesc(opts.desc);
      const statusIcon = s.controlEl.createSpan({ cls: "vault-rag-ep-status" });
      s.addText(tx => {
        tx.setPlaceholder(isAdder ? "Weiteren Endpunkt hinzufügen…" : opts.placeholder).setValue(value);
        // Listen-Mutation NUR bei blur, NICHT in onChange: onChange feuert pro Tastendruck und
        // würde im Add-Feld jeden Zwischenstand (h, ht, htt, …) als eigenen Eintrag anhängen.
        tx.inputEl.addEventListener("blur", () => {
          const before = opts.get();
          const updated = applyEndpointEdit(before, i, tx.getValue(), isAdder);
          if (updated.length === before.length && updated.every((e, k) => e === before[k])) return;   // unverändert → kein Re-Render
          opts.set(updated);
          void this.plugin.saveSettings()
            .then(() => opts.reconnect())
            .then(() => this.display());
        });
      });
      // Löschen: expliziter Mülleimer-Button (nicht am leeren Add-Feld). Das Status-Icon links
      // ist nur Erreichbarkeits-Anzeige, kein Lösch-Button.
      if (!isAdder) {
        s.addExtraButton(b => b
          .setIcon("trash-2")
          .setTooltip("Endpunkt entfernen")
          .onClick(() => {
            opts.set(applyEndpointEdit(opts.get(), i, "", false));
            void this.plugin.saveSettings()
              .then(() => opts.reconnect())
              .then(() => this.display());
          }));
      }
      // Pro-Feld-Status in A11y-Form (Form + Text + Farbe): loader → check/x, aktiver markiert.
      const ep = value.trim();
      if (!isAdder && ep) {
        setIcon(statusIcon, "loader"); setTooltip(statusIcon, "prüfe…");
        void opts.probe(ep).then(status => {
          statusIcon.empty();
          setIcon(statusIcon, status.reachable ? "circle-check" : "circle-x");
          statusIcon.toggleClass("is-ok", status.reachable);
          statusIcon.toggleClass("is-error", !status.reachable);
          const isActive = normalizeEndpoint(ep) === (opts.active() ?? "");
          statusIcon.toggleClass("is-active", isActive);
          setTooltip(statusIcon, status.klartext + (isActive ? " · aktiv" : ""));
        });
        // Eingabe-Prüfung: nicht-blockierendes Warn-Icon (WCAG-Form + Tooltip)
        const warnings = validateEndpointInput(ep);
        if (warnings.length) {
          const warnIcon = s.controlEl.createSpan({ cls: "vault-rag-ep-warn" });
          setIcon(warnIcon, "alert-triangle");
          setTooltip(warnIcon, warnings.map(w => w.message).join(" · "));
        }
      }
    });
    const actions = new Setting(opts.containerEl);
    ENDPOINT_PRESETS.forEach(preset => {
      actions.addButton(b => b
        .setButtonText(`+ ${preset.label}`)
        .setTooltip(`${preset.url} hinzufügen`)
        .onClick(() => {
          const cur = opts.get();
          opts.set(applyEndpointEdit(cur, cur.length, preset.url, true));
          void this.plugin.saveSettings()
            .then(() => opts.reconnect())
            .then(() => this.display());
        }));
    });
    actions.addButton(b => b.setButtonText("Verbindung prüfen").onClick(() => this.display()));
  }

  private buildEmbeddingEndpointList(): void {
    this.buildEndpointList({
      containerEl: this.containerEl,
      label: "Embedding-Endpunkte",
      desc: "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. Ollama- oder MLX-Server-URLs (Desktop oder LAN/VPN-erreichbar).",
      placeholder: "http://localhost:11434",
      get: () => this.plugin.settings.embeddingEndpoints,
      set: (eps) => { this.plugin.settings.embeddingEndpoints = eps; },
      active: () => this.plugin.activeEmbeddingEndpoint,
      probe: (ep) => new EmbeddingClient(ep, this.plugin.settings.embeddingModel).probe(),
      reconnect: () => this.plugin.resolveAndReconnectEmbedder(),
    });
  }

  private buildChatEndpointList(): void {
    this.buildEndpointList({
      containerEl: this.containerEl,
      label: "Chat-Endpunkte",
      desc: "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. OpenAI-kompatible LLM-Server (MLX/LM-Studio), getrennt von den Embedding-Endpunkten.",
      placeholder: "http://localhost:1234",
      get: () => this.plugin.settings.chatEndpoints,
      set: (eps) => { this.plugin.settings.chatEndpoints = eps; },
      active: () => this.plugin.activeChatEndpoint,
      probe: (ep) => new ChatClient(ep, this.plugin.settings.chatModel).probe(),
      reconnect: () => this.plugin.resolveAndReconnectChat(),
    });
  }

  /** Capability-Chips (Lucide-Icons) in die controlEl der Fähigkeiten-Zeile. */
  private renderCaps(setting: Setting, c: Caps): void {
    const el = setting.controlEl; el.empty();
    const chip = (icon: string, text: string, dim: boolean): void => {
      const span = el.createSpan({ cls: dim ? "vault-rag-cap is-dim" : "vault-rag-cap" });
      setIcon(span.createSpan({ cls: "vault-rag-cap-icon" }), icon);
      span.createSpan({ text });
    };
    let any = false;
    if (c.vision !== "no") { chip("eye", c.vision === "confirmed" ? "Vision" : "Vision?", c.vision !== "confirmed"); any = true; }
    if (c.thinking.support !== "none") {
      const t = c.thinking.support === "always" ? "Thinking (immer an)" : "Thinking";
      chip("brain", c.thinking.confidence === "confirmed" ? t : t + "?", c.thinking.confidence !== "confirmed");
      any = true;
    }
    if (!any) el.setText("keine besonderen Fähigkeiten erkannt");
  }

  private showInfo(model: string): void {
    // Tolerant gegenüber stale .then nach einem update()/display()-Re-Render: resetRenderState()
    // nullt die Felder, die Null-Guards no-oppen dann; bei gleichem Modell ist der Inhalt idempotent.
    void this.plugin.chatClient?.modelInfo(model).then((info: { contextLength?: number; quantization?: string; state?: string } | null) => {
      if (!this.infoValue) return;
      if (info) {
        const ctx = info.contextLength ? `max Context ${info.contextLength.toLocaleString("de-DE")}` : "";
        this.infoValue.setText([ctx, info.quantization, info.state].filter(Boolean).join(" · ") || "geladen");
        // Budget-Obergrenze ans Modell-Fenster koppeln (~4 Zeichen/Token).
        if (info.contextLength) this.updateBudgetMax(info.contextLength * 4);
      } else {
        this.infoValue.setText("keine Details (braucht LM Studios /api/v0/models)");
      }
    });
  }

  private showCaps(model: string): void {
    void this.plugin.chatClient?.fetchCapabilities(model).then((meta: Parameters<typeof resolveCapabilities>[0]) => {
      this.lastCaps = resolveCapabilities(meta, model, {});
      if (this.capSetting) this.renderCaps(this.capSetting, this.lastCaps);
    });
  }

  // ── Builder: Suche ────────────────────────────────────────────────────
  private buildK(s: Setting): void {
    s.setName(`Anzahl verwandter Notizen: ${this.plugin.settings.k}`)
      .setDesc("Wie viele ähnliche Notizen im Panel angezeigt werden (5–50)")
      .addSlider(sl => sl.setLimits(5, 50, 1).setValue(this.plugin.settings.k)        .onChange(async (v: number) => {
          this.plugin.settings.k = v;
          s.setName(`Anzahl verwandter Notizen: ${v}`);
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));
  }

  private buildMinSim(s: Setting): void {
    s.setName(`Mindest-Ähnlichkeit: ${Math.round(this.plugin.settings.minSim * 100)} %`)
      .setDesc("Notizen unterhalb dieser Schwelle werden ausgeblendet — niedriger = mehr Treffer, unschärfer")
      .addSlider(sl => sl.setLimits(0, 0.9, 0.05).setValue(this.plugin.settings.minSim)        .onChange(async (v: number) => {
          this.plugin.settings.minSim = v;
          s.setName(`Mindest-Ähnlichkeit: ${Math.round(v * 100)} %`);
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));
  }

  private buildExclude(s: Setting): void {
    s.setName("Ausschluss-Pfade")
      .setDesc("Kommagetrennte Pfade, die nicht eingebettet werden (z.B. Templates/, Archive/). Versteckte Pfade (Konfig-Ordner, Papierkorb) sind immer automatisch ausgeschlossen.")
      .addText(t => t.setPlaceholder("Templates/, Archive/").setValue(this.plugin.settings.exclude.join(", "))
        .onChange(async (v: string) => {
          this.plugin.settings.exclude = v.split(",").map((x: string) => x.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));
  }

  // ── Builder: Live-Embedding ───────────────────────────────────────────
  private buildEmbeddingModel(s: Setting): void {
    s.setName("Embedding-Modell").setDesc("Modellname wie auf dem Endpoint verfügbar");
    void this.plugin.embedder?.listModels().then((models: string[]) => {
      const cur = this.plugin.settings.embeddingModel;
      if (models.length) {
        const list = models.includes(cur) ? models : [cur, ...models];
        s.addDropdown(d => {
          list.forEach((m: string) => { d.addOption(m, m); });
          d.setValue(cur).onChange((v: string) => {
            this.plugin.settings.embeddingModel = v;
            void this.plugin.saveSettings();
            void this.plugin.resolveAndReconnectEmbedder();
          });
        });
      } else {
        s.addText(t => t.setPlaceholder("qwen3-embedding:8b").setValue(cur).onChange(async (v: string) => {
          this.plugin.settings.embeddingModel = v.trim();
          await this.plugin.saveSettings();
          void this.plugin.resolveAndReconnectEmbedder();
        }));
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.rerender()));
      }
    });
  }

  private buildDebounce(s: Setting): void {
    s.setName(`Debounce: ${this.plugin.settings.debounceMs / 1000} s`)
      .setDesc("Wartezeit nach dem letzten Speichern, bevor neu eingebettet wird")
      .addSlider(sl => sl.setLimits(500, 10000, 500).setValue(this.plugin.settings.debounceMs)        .onChange(async (v: number) => {
          this.plugin.settings.debounceMs = v;
          s.setName(`Debounce: ${v / 1000} s`);
          await this.plugin.saveSettings();
        }));
  }

  // ── Builder: Chat ─────────────────────────────────────────────────────
  private buildChatModel(s: Setting): void {
    s.setName("Chat-Modell").setDesc("Modellname wie auf dem Chat-Endpoint verfügbar");
    void this.plugin.chatClient?.listModels().then((models: string[]) => {
      if (models.length) {
        const cur = this.plugin.settings.chatModel;
        const list = models.includes(cur) ? models : [cur, ...models];
        s.addDropdown(d => {
          list.forEach((m: string) => { d.addOption(m, m); });
          d.setValue(cur).onChange((v: string) => {
            this.plugin.settings.chatModel = v;
            void this.plugin.saveSettings();
            void this.plugin.resolveAndReconnectChat();
            this.showInfo(v);
            this.showCaps(v);
          });
        });
      } else {
        s.setDesc('Server offline — Modellname eintippen, dann „Modelle laden“');
        s.addText(t => t.setPlaceholder("qwen3").setValue(this.plugin.settings.chatModel)
          .onChange(async (v: string) => {
            this.plugin.settings.chatModel = v.trim();
            await this.plugin.saveSettings();
            void this.plugin.resolveAndReconnectChat();
          }));
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.rerender()));
      }
      this.showInfo(this.plugin.settings.chatModel);
      this.showCaps(this.plugin.settings.chatModel);
    });
  }

  private buildModelDetails(s: Setting): void {
    s.setName("Modelldetails");
    this.infoValue = s.controlEl.createSpan({ cls: "vault-rag-info-value", text: "…" });
  }

  private buildCaps(s: Setting): void {
    s.setName("Fähigkeiten");
    this.capSetting = s;
    this.renderCaps(s, this.lastCaps);
  }

  private buildChatK(s: Setting): void {
    s.setName(`Kontext-Notizen: ${this.plugin.settings.chatK}`)
      .setDesc("Wie viele Notizen als Kontext in den Chat gehen (Auto-RAG)")
      .addSlider(sl => sl.setLimits(1, 20, 1).setValue(this.plugin.settings.chatK)        .onChange(async (v: number) => {
          this.plugin.settings.chatK = v;
          s.setName(`Kontext-Notizen: ${v}`);
          await this.plugin.saveSettings();
        }));
  }

  private buildBudget(s: Setting): void {
    s.setName(`Kontext-Budget: ${this.plugin.settings.contextCharBudget.toLocaleString("de-DE")} Zeichen`)
      .setDesc("Maximale Gesamtlänge des Notiz-Kontexts (anteilig verteilt). Obergrenze richtet sich nach dem Modell-Fenster.")
      .addSlider(sl => {
        sl.setLimits(2000, 32000, 1000).setValue(this.plugin.settings.contextCharBudget)          .onChange(async (v: number) => {
            this.plugin.settings.contextCharBudget = v;
            s.setName(`Kontext-Budget: ${v.toLocaleString("de-DE")} Zeichen`);
            await this.plugin.saveSettings();
          });
        // Sobald das Modell-Fenster bekannt ist (showInfo): Slider-Max daran koppeln + Wert klemmen.
        this.updateBudgetMax = (maxChars: number): void => {
          const max = Math.max(8000, Math.round(maxChars / 1000) * 1000);
          sl.setLimits(2000, max, 1000);
          const val = Math.min(this.plugin.settings.contextCharBudget, max);
          sl.setValue(val);
          s.setName(`Kontext-Budget: ${val.toLocaleString("de-DE")} / max ~${max.toLocaleString("de-DE")} Zeichen`);
          if (val !== this.plugin.settings.contextCharBudget) {
            this.plugin.settings.contextCharBudget = val;   // nur bei echter Klemmung schreiben
            void this.plugin.saveSettings();
          }
        };
      });
  }

  private buildTemp(s: Setting): void {
    s.setName(`Temperatur: ${this.plugin.settings.chatTemperature}`)
      .setDesc("Kreativität vs. Bestimmtheit (0 = deterministisch, höher = kreativer)")
      .addSlider(sl => sl.setLimits(0, 2, 0.1).setValue(this.plugin.settings.chatTemperature)        .onChange(async (v: number) => {
          this.plugin.settings.chatTemperature = v;
          s.setName(`Temperatur: ${v}`);
          await this.plugin.saveSettings();
        }));
  }

  private buildSystemPrompt(s: Setting): void {
    s.setName("System-Prompt")
      .setDesc("Grundanweisung an das Modell. Der Notiz-Kontext wird automatisch angehängt.")
      .addTextArea(t => {
        t.setValue(this.plugin.settings.chatSystemPrompt).onChange(async (v: string) => {
          this.plugin.settings.chatSystemPrompt = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 8;
        t.inputEl.addClass("vault-rag-prompt-textarea");
      });
  }

  private buildInputPos(s: Setting): void {
    s.setName("Eingabe-Position")
      .setDesc("Wo die Chat-Eingabe sitzt (greift beim nächsten Öffnen des Panels)")
      .addDropdown(d => d.addOption("bottom", "Unten").addOption("top", "Oben").setValue(this.plugin.settings.chatInputPosition)
        .onChange(async (v: string) => {
          this.plugin.settings.chatInputPosition = v as "bottom" | "top";
          await this.plugin.saveSettings();
        }));
  }

  private buildThinking(s: Setting): void {
    s.setName("Thinking unterdrücken")
      .setDesc("Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar. „Testen“ prüft, ob das Modell wirklich abschaltet.")
      .addToggle(t => t.setValue(this.plugin.settings.suppressThinking).onChange(async (v: boolean) => {
        this.plugin.settings.suppressThinking = v;
        await this.plugin.saveSettings();
      }))
      .addButton(b => b.setButtonText("Testen").onClick(async () => {
        const model = this.plugin.settings.chatModel;
        if (isAlwaysOnThinker(model)) { new Notice("Dieses Modell denkt immer (nur low/medium/high)."); return; }
        b.setButtonText("Teste…"); b.setDisabled(true);
        try {
          const res = await this.plugin.chatClient.stream(
            [{ role: "user", content: "Antworte in genau einem Wort: Hallo." }],
            () => {}, () => {}, undefined, { model, suppressThinking: true });
          const happened = reasoningHappened(res.content, res.reasoning);
          new Notice(happened ? "Modell denkt trotz „aus“" : "Thinking wird unterdrückt");
          if (happened) {
            // Live-Nachweis, dass das Modell denkt → Fähigkeiten-Zeile hochstufen.
            this.lastCaps = { ...this.lastCaps, thinking: { support: "always", confidence: "confirmed" } };
            if (this.capSetting) this.renderCaps(this.capSetting, this.lastCaps);
          }
        } catch {
          new Notice("Chat-Endpoint nicht erreichbar");
        } finally { b.setButtonText("Testen"); b.setDisabled(false); }
      }));
  }

  private buildEnter(s: Setting): void {
    s.setName("Enter sendet")
      .setDesc("An: Enter sendet, Shift+Enter macht eine neue Zeile. Aus: umgekehrt.")
      .addToggle(t => t.setValue(this.plugin.settings.enterSends).onChange(async (v: boolean) => {
        this.plugin.settings.enterSends = v;
        await this.plugin.saveSettings();
      }));
  }

  // ── Builder: Smart Apply ──────────────────────────────────────────────
  private buildSmartApplyEnabled(s: Setting): void {
    s.setName("Smart Apply aktivieren")
      .setDesc("Schaltet den Befehl, das Ribbon-Icon und das Panel frei: eine unstrukturierte Notiz hinter einem Diff-Gate in die Struktur einer Vorlage überführen. Greift beim nächsten Neuladen des Plugins.")
      .addToggle(t => t.setValue(this.plugin.settings.smartApplyEnabled).onChange(async (v: boolean) => {
        this.plugin.settings.smartApplyEnabled = v;
        await this.plugin.saveSettings();
      }));
  }

  /** Reiner Hinweis — Smart Apply nutzt die bestehende Chat-Verbindung; keine eigenen Endpoint-Felder. */
  private buildSmartApplyConnectionNote(s: Setting): void {
    s.setName("Verbindung")
      .setDesc('Smart Apply nutzt die Chat-Verbindung (Endpoint, Modell) aus dem Abschnitt „Chat“ — kein eigener Endpoint nötig.');
  }

  private buildTemplateDir(s: Setting): void {
    s.setName("Vorlagen-Ordner")
      .setDesc('Ordner mit den Vorlagen — Markdown-Dateien darin und in Unterordnern werden berücksichtigt. Ausgenommen sind Folder Notes (Datei trägt den Namen ihres Ordners, z.B. Projekt/Projekt.md).')
      .addText(t => {
        t.setPlaceholder("Templates/").setValue(this.plugin.settings.templateDir);
        const normalize = (v: string): string => {
          const trimmed = v.trim();
          if (trimmed === "") return "";
          return trimmed.endsWith("/") ? trimmed : trimmed + "/";
        };
        const save = async (v: string): Promise<void> => {
          this.plugin.settings.templateDir = normalize(v);
          await this.plugin.saveSettings();
          this.plugin.refreshSmartApplyRanking();   // offenes Cockpit sofort neu ranken (kein Reload)
        };
        t.onChange(save);
        new FolderSuggest(this.app, t.inputEl).onSelect(async (path: string) => {
          t.setValue(normalize(path));
          await save(path);
        });
      });
  }

  private buildSmartApplyTemperature(s: Setting): void {
    s.setName(`Smart-Apply-Temperatur: ${this.plugin.settings.smartApplyTemperature}`)
      .setDesc("Temperatur für den Umsortier-Call (0 = deterministisch — empfohlen für reproduzierbare Vorschläge).")
      .addSlider(sl => sl.setLimits(0, 2, 0.1).setValue(this.plugin.settings.smartApplyTemperature)
        .onChange(async (v: number) => {
          this.plugin.settings.smartApplyTemperature = v;
          s.setName(`Smart-Apply-Temperatur: ${v}`);
          await this.plugin.saveSettings();
        }));
  }

  private buildSmartApplyModel(s: Setting): void {
    s.setName("Smart-Apply-Modell")
      .setDesc('Modell fuer den Umsortier-Call. Leer = Chat-Modell aus dem Abschnitt "Chat" verwenden.')
      .addText(t => t.setPlaceholder('leer = Chat-Modell').setValue(this.plugin.settings.smartApplyModel)
        .onChange(async (v: string) => {
          this.plugin.settings.smartApplyModel = v.trim();
          await this.plugin.saveSettings();
        }));
  }

  private buildSmartApplySuppress(s: Setting): void {
    s.setName("Thinking unterdrücken (Smart Apply)")
      .setDesc("Sendet Suppress-Hints fuer den Smart-Apply-Call — sinnvoll bei Thinking-Modellen, die auch strukturiert schreiben koennen.")
      .addToggle(t => t.setValue(this.plugin.settings.smartApplySuppressThinking).onChange(async (v: boolean) => {
        this.plugin.settings.smartApplySuppressThinking = v;
        await this.plugin.saveSettings();
      }));
  }

  private buildSmartApplyMaxTokens(s: Setting): void {
    s.setName(`Smart-Apply-Max-Tokens: ${this.plugin.settings.smartApplyMaxTokens}`)
      .setDesc("Maximale Anzahl generierter Tokens fuer den Umsortier-Call (512–16384). Hoeher = sicher fuer grosse Notizen mit vielen Bloecken.")
      .addSlider(sl => sl.setLimits(512, 16384, 512).setValue(this.plugin.settings.smartApplyMaxTokens)
        .onChange(async (v: number) => {
          this.plugin.settings.smartApplyMaxTokens = v;
          s.setName(`Smart-Apply-Max-Tokens: ${v}`);
          await this.plugin.saveSettings();
        }));
  }

  private buildSmartApplyDefaultMode(s: Setting): void {
    s.setName("Smart-Apply-Standardmodus")
      .setDesc("Für Vorlagen ohne eigene Modus-Angabe. Additiv/Transformativ lässt das LLM Werte erschließen und ergänzen (mit Konfidenz).")
      .addDropdown(d => d
        .addOption("deterministisch", "Deterministisch (nur zuordnen)")
        .addOption("additiv", "Additiv (erschließen + ergänzen)")
        .setValue(this.plugin.settings.smartApplyDefaultMode)
        .onChange(async (v) => { this.plugin.settings.smartApplyDefaultMode = v as ApplyMode; await this.plugin.saveSettings(); }));
  }

  /** Kompakte einzeilige Embedding-Status-Zeile (bei den Embedding-Settings): EIN konsistent
   *  gefärbter Verbindungspunkt + aktiver Endpunkt + Zähler, live aktualisiert. Kein Control → Wert in controlEl ok. */
  private buildEmbeddingStatus(s: Setting): void {
    s.setName("Embedding-Status");
    const val = s.controlEl.createSpan({ cls: "vault-rag-info-value" });
    const dot = val.createSpan({ cls: "vault-rag-conn-dot" });
    const text = val.createSpan();
    let connected: boolean | null = null;
    const render = (): void => {
      dot.toggleClass("is-checking", connected === null);
      dot.toggleClass("is-ok", connected === true);
      dot.toggleClass("is-error", connected === false);
      // Form (Icon) trägt den Status, Farbe nur sekundär — lesbar auch bei Farbsehschwäche (WCAG 1.4.1).
      setIcon(dot, connected === null ? "loader" : connected ? "circle-check" : "circle-x");
      const active = this.plugin.activeEmbeddingEndpoint;
      const conn = connected === null ? "prüfe…" : connected ? (active ? `verbunden via ${active}` : "verbunden") : "offline";
      const p = this.plugin.embeddingProgress as { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number } | undefined;
      const counts = p ? `${p.embeddedNotes.toLocaleString("de-DE")} eingebettet · ${p.pendingNotes.toLocaleString("de-DE")} ausstehend` : "";
      const act = p?.isEmbedding ? "Embedding läuft" : "";
      text.setText([conn, act, counts].filter(Boolean).join(" · "));
    };
    render();
    // Status-Poll stützt sich auf dieselbe Reachability-Logik wie main.ts (ping → Re-Resolve → ping).
    void this.plugin.embedderReady().then((ok: boolean) => { connected = ok; render(); });
    this.clearInterval();
    this.refreshInterval = window.setInterval(render, 2000);
  }

  private buildStatusBar(s: Setting): void {
    s.setName("Fortschritt in Statusleiste")
      .setDesc("Zeigt Embedding-Status in der unteren Obsidian-Leiste")
      .addToggle(t => t.setValue(this.plugin.settings.showStatusBar).onChange(async (v: boolean) => {
        this.plugin.settings.showStatusBar = v;
        await this.plugin.saveSettings();
        this.plugin.setStatusBarVisible(v);
      }));
  }

  private buildIndexDir(s: Setting): void {
    let typed = this.plugin.settings.indexDir;
    s.setName("Index-Ordner")
      .setDesc('Wo der Vektor-Index gespeichert wird. Synct cross-device (inkl. iPhone) nur mit der Obsidian-Sync-Option „Sync all other types". Ein Pfad mit „." am Anfang wird von Obsidian Sync ignoriert.')
      .addText(t => {
        t.setPlaceholder("_vaultrag").setValue(this.plugin.settings.indexDir);
        t.onChange((v: string) => { typed = v; });
        new FolderSuggest(this.app, t.inputEl).onSelect((path: string) => { typed = path; t.setValue(path); });
      })
      .addButton(b => b.setButtonText("Übernehmen").onClick(async () => {
        const norm = normalizeIndexDir(typed);
        if (norm === "" || norm === normalizeIndexDir(this.plugin.settings.indexDir)) return;
        if (isDotPath(norm)) new Notice('Index-Ordner beginnt mit „." — synct dann nicht cross-device (auch nicht aufs iPhone).');
        b.setButtonText("Verschiebe…"); b.setDisabled(true);
        try {
          await this.plugin.changeIndexDir(norm);
          new Notice(`Index verschoben nach „${norm}".`);
        } finally { b.setButtonText("Übernehmen"); b.setDisabled(false); }
        this.display();
      }));
  }

  private buildHideIndexFolder(s: Setting): void {
    s.setName("Index-Ordner im Datei-Explorer ausblenden")
      .setDesc("Versteckt den Index-Ordner kosmetisch im Datei-Explorer. Daten, Sync und Suche bleiben unberührt. Standardmäßig an.")
      .addToggle(t => t.setValue(this.plugin.settings.hideIndexFolder).onChange(async (v: boolean) => {
        this.plugin.settings.hideIndexFolder = v;
        await this.plugin.saveSettings();
        this.plugin.refreshIndexFolderHiding();
      }));
  }

  private buildReindexButton(s: Setting): void {
    s.setName("Vault neu indizieren")
      .setDesc("Bettet alle Notizen neu ein. Das kann je nach Vault-Größe mehrere Minuten dauern. Der bestehende Index bleibt bis zum Abschluss erhalten.")
      .addButton(b => b
        .setButtonText("Vault neu indizieren")
        .onClick(() => {
          new ReindexConfirmModal(this.app, () => { void this.plugin.reindexVault(); }).open();
        }));
  }
}
