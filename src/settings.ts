import { AbstractInputSuggest, App, ButtonComponent, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder, setIcon, setTooltip } from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionGroup, SettingDefinition, SettingControl } from "obsidian";
import { ChatClient } from "./chat_client";
import { EmbeddingClient } from "./embedder";
import { resolveCapabilities } from "./capabilities";
import { reasoningHappened, isAlwaysOnThinker } from "./vendor/kit/reasoning";
import { normalizeIndexDir, isDotPath } from "./index_dir";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { ENDPOINT_PRESETS, validateEndpointInput, type EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, migrateEndpointList, splitExcludePaths, normalizeTemplateDir, type VaultRagSettings } from "./settings_core";
import { MCP_CLIENTS, buildClientSnippet, maskToken, type McpClientId } from "./mcp/client_snippets";
import type { SelfCheckResult } from "./mcp/mcp_diagnostics";

export { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, migrateEndpointList };
export type { VaultRagSettings };

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

/** Roter/destruktiver Button, versionssicher: setDestructive() ab Obsidian 1.13, sonst die
 *  mod-warning-DOM-Klasse (kein deprecated setWarning, kein Lint-Warning, roter Look überall).
 *  Der Cast auf einen anonymen Typ nimmt `obsidianmd/no-unsupported-api` die Sicht auf
 *  ButtonComponent.setDestructive (1.13-only). */
export function applyDestructive(b: ButtonComponent): ButtonComponent {
  const bx = b as unknown as { setDestructive?: () => void };
  if (typeof bx.setDestructive === "function") bx.setDestructive();
  else b.buttonEl.addClass("mod-warning");
  return b;
}

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
  healVault(): Promise<void>;
  refreshIndexFolderHiding(): void;
  changeIndexDir(newDir: string): Promise<void>;
  listBackups(): Promise<{ name: string; count: number }[]>;
  restoreBackup(name: string): Promise<void>;
  indexHealthReadout(embedded: number, total: number, healthy: boolean, emptyCount?: number): string;
  indexDelta(): { embedded: number; total: number; healthy: boolean; emptyCount: number };
  mcpServerRunning(): boolean;
  mcpServerAddress(): string | null;
  restartMcpServer(): Promise<void>;
  ensureMcpToken(): string;
  mcpStartError(): string | null;
  rotateMcpToken(): Promise<void>;
  mcpSelfCheck(): Promise<SelfCheckResult>;
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

export class HealConfirmModal extends Modal {
  constructor(app: App, private missing: number, private total: number, private onConfirm: () => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Index vervollständigen?" });
    contentEl.createEl("p", { text: `${this.missing} von ${this.total} Notizen fehlen im Index. Nur die fehlenden werden neu eingebettet (Delta) — der bestehende Index bleibt erhalten.` });
    const btnRow = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btnRow).setButtonText("Später").onClick(() => this.close());
    new ButtonComponent(btnRow).setButtonText("Jetzt vervollständigen").setCta().onClick(() => { this.close(); this.onConfirm(); });
  }
  onClose(): void { this.contentEl.empty(); }
}

export class RestoreBackupModal extends Modal {
  constructor(app: App, private entries: { name: string; count: number }[], private onPick: (name: string) => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Aus Backup wiederherstellen" });
    if (this.entries.length === 0) { contentEl.createEl("p", { text: "Keine Backups vorhanden." }); return; }
    for (const e of this.entries) {
      const row = new Setting(contentEl).setName(`${e.count.toLocaleString("de-DE")} Notizen`).setDesc(e.name);
      row.addButton(b => applyDestructive(b.setButtonText("Wiederherstellen")).onClick(() => { this.close(); this.onPick(e.name); }));
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

/**
 * Settings-Tab. `getSettingDefinitions()` liefert die deklarative Struktur (7 Gruppen); einfache
 * Zeilen sind reine `control`-Definitionen, dynamische Zeilen (Endpoint-Listen, Modell-Dropdowns,
 * Status-Polls, MCP-Sektion) sind `render`-Hatches. Querverweise zwischen Zeilen (Modelldetails↔
 * Budget-Slider, Suppress-Test↔Fähigkeiten) laufen über Render-State-Felder (`lastCaps`,
 * `infoValue`, `capSetting`, `updateBudgetMax`), die render-Hatches beim Zeichnen neu setzen.
 */
export class VaultRagSettingTab extends PluginSettingTab {
  private mcpPortRestartTimer: number | null = null;
  private showMcpToken = false;
  private mcpClient: McpClientId = "claude-code";
  private lastCaps: Caps = { vision: "no", thinking: { support: "none", confidence: "no" } };
  private updateBudgetMax: (maxChars: number) => void = () => {};
  private infoValue: HTMLElement | null = null;
  private capSetting: Setting | null = null;
  // Von render-Hatches gestartete Status-Polls (z.B. renderEmbeddingStatus) — Cleanup läuft primär
  // über die von den Hatches zurückgegebene Cleanup-Funktion (render-Cleanup); hide() räumt
  // zusätzlich defensiv alle hier gesammelten Intervalle ab (API garantiert Cleanup beim
  // Fenster-Zerstören nicht).
  private pollIntervals: number[] = [];
  // Cleanup-Funktionen, die render-Hatches beim Zeichnen zurückgeben (z.B. renderEmbeddingStatus).
  // Ab 1.13 ruft das Framework diese vor dem Zerlegen einer Zeile selbst auf; renderImperative()
  // muss denselben Vertrag einhalten und sie vor jedem Rebuild abräumen (siehe dort).
  private rowCleanups: Array<() => void> = [];

  constructor(app: App, private plugin: VaultRagPluginHost) { super(app, plugin); }

  // ── Deklarative Settings-API (Obsidian 1.13) ────────────────────────────
  // Fundament für die schrittweise Migration von display() auf
  // getSettingDefinitions(): Lese-/Schreibschicht mit Coercion (exclude
  // string↔string[], templateDir-Normalisierung) + Seiteneffekten (refresh,
  // setStatusBarVisible, refreshIndexFolderHiding, refreshSmartApplyRanking).
  getControlValue(key: string): unknown {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "exclude") return (s.exclude as string[]).join(", ");
    return s[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "exclude") s.exclude = splitExcludePaths(value as string);
    else if (key === "templateDir") s.templateDir = normalizeTemplateDir(value as string);
    else s[key] = value;
    await this.plugin.saveSettings();
    switch (key) {
      case "k": case "minSim": this.plugin.refresh(); break;
      case "showStatusBar": this.plugin.setStatusBarVisible(s.showStatusBar as boolean); break;
      case "hideIndexFolder": this.plugin.refreshIndexFolderHiding(); break;
      case "templateDir": this.plugin.refreshSmartApplyRanking(); break;
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [this.searchGroup(), this.embeddingGroup(), this.indexGroup(), this.robustnessGroup(), this.mcpGroup(), this.chatGroup(), this.smartApplyGroup()];
  }

  // ── Imperativer Fallback (Obsidian < 1.13) ──────────────────────────────
  // Ab 1.13 ruft der Host getSettingDefinitions() selbst auf und display() wird nie
  // aufgerufen; auf ≤1.12 fehlt getSettingDefinitions als Renderpfad, dort ruft der Host
  // stattdessen display(). renderImperative() liest DIESELBE Struktur und zeichnet sie mit
  // der klassischen Setting-API — eine Wahrheit, kein zweiter Definitionsbaum.
  display(): void { this.renderImperative(); }

  private renderImperative(): void {
    // Vorherigen Durchlauf abräumen, bevor die Zeilen zerlegt werden — sonst laufen z.B. die
    // 2s-Polls von renderEmbeddingStatus bei jedem refreshUi()-Rebuild unbegrenzt weiter (Leak).
    for (const c of this.rowCleanups) c();
    this.rowCleanups = [];
    this.containerEl.empty();
    for (const item of this.getSettingDefinitions()) this.renderDefinitionItem(this.containerEl, item);
  }

  /** Re-Render des Tabs. Ab 1.13 exponiert das deklarative Framework update(); auf dem <1.13-Fallback
   *  existiert die Methode nicht → renderImperative() erneut laufen. Der Cast auf einen anonymen Typ
   *  nimmt `obsidianmd/no-unsupported-api` die Sicht auf SettingTab.update (1.13-only). */
  private refreshUi(): void {
    const self = this as unknown as { update?: () => void };
    if (typeof self.update === "function") self.update();
    else this.renderImperative();
  }

  private renderDefinitionItem(containerEl: HTMLElement, item: SettingDefinitionItem): void {
    if ((item as SettingDefinitionGroup).type === "group") {
      const g = item as SettingDefinitionGroup;
      if (g.heading) new Setting(containerEl).setName(g.heading).setHeading();
      for (const sub of g.items ?? []) this.renderDefinitionItem(containerEl, sub);
      return;
    }
    const def = item as SettingDefinition & { render?: unknown; action?: unknown; control?: SettingControl };
    const s = new Setting(containerEl);
    if (def.name) s.setName(def.name);
    if (def.desc) s.setDesc(def.desc);
    if (typeof def.render === "function") {
      const cleanup = (def.render as (s: Setting, g?: unknown) => void | (() => void))(s);
      if (typeof cleanup === "function") this.rowCleanups.push(cleanup);
      return;
    }
    if (typeof def.action === "function") {
      const action = def.action;
      s.addButton(b => b.setButtonText(def.name).onClick(() => action(s.settingEl, 0)));
      return;
    }
    if (def.control) this.renderControl(s, def.name, def.control);
    // empty: nur name/desc (bereits gesetzt)
  }

  /** Rendert einen einzelnen deklarativen Control-Typ mit der klassischen Setting-API.
   *  `setDynamicTooltip()` ist bewusst NICHT verwendet (deprecated seit 1.13 — der Slider-Wert
   *  ist heute inline im Namen sichtbar, s. displayFormat); der Fallback zeigt den Wert deshalb
   *  ausschließlich über denselben Namens-Mechanismus wie die Deklarativ-API. */
  private renderControl(s: Setting, name: string, c: SettingControl): void {
    const key = c.key;
    const cur = this.getControlValue(key);
    const save = (v: unknown): void => { void this.setControlValue(key, v); };
    switch (c.type) {
      case "slider": {
        const fmt = c.displayFormat;
        const label = (v: number): void => { if (fmt) s.setName(`${name}: ${fmt(v)}`); };
        label(cur as number);
        s.addSlider(sl => sl.setLimits(c.min, c.max, c.step).setValue(cur as number)
          .onChange((v: number) => { save(v); label(v); }));
        break;
      }
      case "toggle":
        s.addToggle(t => t.setValue(cur as boolean).onChange(save));
        break;
      case "dropdown":
        s.addDropdown(d => { for (const [k, v] of Object.entries(c.options)) d.addOption(k, v); d.setValue(cur as string).onChange(save); });
        break;
      case "textarea":
        s.addTextArea(t => { t.setValue(cur as string).onChange(save); if (c.rows) t.inputEl.rows = c.rows; });
        break;
      case "folder":
        s.addText(t => { t.setPlaceholder(c.placeholder ?? "").setValue(cur as string).onChange(save);
          new FolderSuggest(this.app, t.inputEl).onSelect((p: string) => { t.setValue(p); save(p); }); });
        break;
      case "text":
      default:
        s.addText(t => t.setPlaceholder((c as { placeholder?: string }).placeholder ?? "").setValue(cur as string).onChange(save));
        break;
    }
  }

  /** Macht die von der API übergebene Setting-Row zu einem neutralen Block-Container:
   *  render-Hatches, die mehrere Rows zeichnen, dürfen sonst nicht in die Zwei-Spalten-.setting-item.
   *  Achtung: leert settingEl → Desc muss der Hatch selbst neu setzen. */
  private hostFor(setting: Setting): HTMLElement {
    setting.settingEl.empty();
    setting.settingEl.removeClass("setting-item");
    return setting.settingEl;
  }

  private searchGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "Suche", items: [
      { name: "Anzahl verwandter Notizen",
        desc: "Wie viele ähnliche Notizen im Panel angezeigt werden (5–50)",
        control: { type: "slider", key: "k", min: 5, max: 50, step: 1,
          displayFormat: (v: number) => String(v) } },
      { name: "Mindest-Ähnlichkeit",
        desc: "Notizen unterhalb dieser Schwelle werden ausgeblendet — niedriger = mehr Treffer, unschärfer",
        control: { type: "slider", key: "minSim", min: 0, max: 0.9, step: 0.05,
          displayFormat: (v: number) => `${Math.round(v * 100)} %` } },
      { name: "Ausschluss-Pfade",
        desc: "Kommagetrennte Pfade, die nicht eingebettet werden (z.B. Templates/, Archive/). Versteckte Pfade (Konfig-Ordner, Papierkorb) sind immer automatisch ausgeschlossen.",
        control: { type: "text", key: "exclude", placeholder: "Templates/, Archive/" } },
    ] };
  }

  private embeddingGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "Live-Embedding", items: [
      { name: "Embedding-Endpunkte", desc: "", render: this.renderEmbeddingEndpoints },
      { name: "Embedding-Modell", desc: "Modellname wie auf dem Endpoint verfügbar", render: this.renderEmbeddingModel },
      { name: "Embedding-Status", desc: "", render: this.renderEmbeddingStatus },
      { name: "Debounce", desc: "Wartezeit nach dem letzten Speichern, bevor neu eingebettet wird",
        control: { type: "slider", key: "debounceMs", min: 500, max: 10000, step: 500,
          displayFormat: (v: number) => `${v / 1000} s` } },
      { name: "Fortschritt in Statusleiste", desc: "Zeigt Embedding-Status in der unteren Obsidian-Leiste",
        control: { type: "toggle", key: "showStatusBar" } },
    ] };
  }

  private indexGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "Index", items: [
      { name: "Index-Ordner", desc: "", render: this.renderIndexDir },
      { name: "Index-Ordner im Datei-Explorer ausblenden",
        desc: "Versteckt den Index-Ordner kosmetisch im Datei-Explorer. Daten, Sync und Suche bleiben unberührt. Standardmäßig an.",
        control: { type: "toggle", key: "hideIndexFolder" } },
    ] };
  }

  /** „Vault neu indizieren" lebt bewusst hier statt in der Index-Sektion (Config): Robustheit
   *  bündelt alle Wiederherstellungs-Aktionen (Zustand, Delta-Heal, Backup, Voll-Reindex) an
   *  einer Stelle — kein zweiter Reindex-Button mehr in „Index". */
  private robustnessGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "Index-Robustheit", items: [
      { name: "Index-Zustand", desc: "", render: this.renderIndexHealth },
      { name: "Aus Backup wiederherstellen",
        desc: "Geräte-lokale Sicherungen des Index (letzte 3). Ersetzt den aktuellen Index.",
        action: () => { void (async () => {
          new RestoreBackupModal(this.app, await this.plugin.listBackups(), (n) => void this.plugin.restoreBackup(n)).open();
        })(); } },
      { name: "Vault neu indizieren",
        desc: "Baut den kompletten Index von Grund auf neu — der letzte Ausweg.",
        action: () => { new ReindexConfirmModal(this.app, () => { void this.plugin.reindexVault(); }).open(); } },
    ] };
  }

  /** Die MCP-Sektion ist zustandsreich (bedingte Zeilen bei mcpEnabled, Token-Toggle,
   *  Port-Debounce-Restart, Client-Dropdown, Snippet-`<pre>`) — deshalb EIN render-Hatch statt
   *  einzelner Controls, der den kompletten bisherigen buildMcpSection-Body zeichnet. */
  private mcpGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "MCP-Server", items: [
      { name: "MCP-Server", desc: "", render: this.renderMcpSection },
    ] };
  }

  /** Chat-Gruppe: Endpunkte/Modell/Modelldetails/Fähigkeiten/Budget bleiben render-Hatches
   *  (Cross-Referenzen über lastCaps/infoValue/capSetting, Budget-Max ans Modell-Fenster
   *  gekoppelt). „Thinking testen“ war ein Button IN der Toggle-Zeile — jetzt eigene
   *  Action-Zeile, das Toggle selbst ist deklarativ. */
  private chatGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "Chat", items: [
      { name: "Chat-Endpunkte", desc: "", render: this.renderChatEndpoints },
      { name: "Chat-Modell", desc: "Modellname wie auf dem Chat-Endpoint verfügbar", render: this.renderChatModel },
      { name: "Modelldetails", desc: "", render: this.renderModelDetails },
      { name: "Fähigkeiten", desc: "", render: this.renderCapsRow },
      { name: "Kontext-Notizen", desc: "Wie viele Notizen als Kontext in den Chat gehen (Auto-RAG)",
        control: { type: "slider", key: "chatK", min: 1, max: 20, step: 1, displayFormat: (v: number) => String(v) } },
      { name: "Kontext-Budget", desc: "", render: this.renderBudget },
      { name: "Temperatur", desc: "Kreativität vs. Bestimmtheit (0 = deterministisch, höher = kreativer)",
        control: { type: "slider", key: "chatTemperature", min: 0, max: 2, step: 0.1, displayFormat: (v: number) => String(v) } },
      { name: "System-Prompt", desc: "Grundanweisung an das Modell. Der Notiz-Kontext wird automatisch angehängt.",
        control: { type: "textarea", key: "chatSystemPrompt" } },
      { name: "Eingabe-Position", desc: "Wo die Chat-Eingabe sitzt (greift beim nächsten Öffnen des Panels)",
        control: { type: "dropdown", key: "chatInputPosition", options: { bottom: "Unten", top: "Oben" } } },
      { name: "Thinking unterdrücken",
        desc: "Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar.",
        control: { type: "toggle", key: "suppressThinking" } },
      { name: "Thinking testen", desc: "Prüft, ob das Modell bei „unterdrücken“ wirklich abschaltet.",
        action: () => { void this.runThinkingTest(); } },
      { name: "Enter sendet", desc: "An: Enter sendet, Shift+Enter macht eine neue Zeile. Aus: umgekehrt.",
        control: { type: "toggle", key: "enterSends" } },
    ] };
  }

  /** Smart-Apply-Gruppe: fast vollständig deklarativ. „Verbindung" ist eine reine Info-Zeile
   *  (kein control/render/action — Smart Apply teilt sich den Chat-Endpoint, kein eigener nötig).
   *  templateDir ist ein natives folder-Control (Vault-Ordner-Suggester); die Trailing-Slash-
   *  Normalisierung passiert bereits in setControlValue (Task 2). Nur das Modell-Dropdown bleibt
   *  ein render-Hatch (Cross-Referenz auf plugin.chatClient, Online/Offline-Fallback). */
  private smartApplyGroup(): SettingDefinitionGroup {
    return { type: "group", heading: "Smart Apply", items: [
      { name: "Smart Apply aktivieren",
        desc: "Schaltet Befehl, Ribbon-Icon und Panel frei: eine unstrukturierte Notiz hinter einem Diff-Gate in die Struktur einer Vorlage überführen. Greift beim nächsten Neuladen des Plugins.",
        control: { type: "toggle", key: "smartApplyEnabled" } },
      { name: "Verbindung",
        desc: 'Smart Apply nutzt die Chat-Verbindung (Endpoint, Modell) aus dem Abschnitt „Chat" — kein eigener Endpoint nötig.' },
      { name: "Vorlagen-Ordner",
        desc: "Ordner mit den Vorlagen — Markdown-Dateien darin und in Unterordnern werden berücksichtigt. Ausgenommen sind Folder Notes (Datei trägt den Namen ihres Ordners).",
        control: { type: "folder", key: "templateDir", placeholder: "Templates/" } },
      { name: "Smart-Apply-Temperatur",
        desc: "Temperatur für den Umsortier-Call (0 = deterministisch — empfohlen für reproduzierbare Vorschläge).",
        control: { type: "slider", key: "smartApplyTemperature", min: 0, max: 2, step: 0.1, displayFormat: (v: number) => String(v) } },
      { name: "Smart-Apply-Modell", desc: 'Modell für den Umsortier-Call. Leer = Chat-Modell verwenden.',
        render: this.renderSmartApplyModel },
      { name: "Thinking unterdrücken (Smart Apply)",
        desc: "Sendet Suppress-Hints für den Smart-Apply-Call — sinnvoll bei Thinking-Modellen, die auch strukturiert schreiben können.",
        control: { type: "toggle", key: "smartApplySuppressThinking" } },
      { name: "Smart-Apply-Max-Tokens",
        desc: "Maximale Anzahl generierter Tokens für den Umsortier-Call (512–16384). Höher = sicher für große Notizen.",
        control: { type: "slider", key: "smartApplyMaxTokens", min: 512, max: 16384, step: 512, displayFormat: (v: number) => String(v) } },
      { name: "Smart-Apply-Standardmodus",
        desc: "Für Vorlagen ohne eigene Modus-Angabe. Additiv lässt das LLM Werte erschließen und ergänzen (mit Konfidenz).",
        control: { type: "dropdown", key: "smartApplyDefaultMode",
          options: { deterministisch: "Deterministisch (nur zuordnen)", additiv: "Additiv (erschließen + ergänzen)" } } },
    ] };
  }

  /** render-Hatch: Embedding-Endpunkt-Liste. Zeichnet in hostFor über buildEndpointList. */
  private renderEmbeddingEndpoints = (setting: Setting): void => {
    const host = this.hostFor(setting);
    this.buildEndpointList({
      containerEl: host,
      label: "Embedding-Endpunkte",
      desc: "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. Ollama- oder MLX-Server-URLs (Desktop oder LAN/VPN-erreichbar).",
      placeholder: "http://localhost:11434",
      get: () => this.plugin.settings.embeddingEndpoints,
      set: (eps) => { this.plugin.settings.embeddingEndpoints = eps; },
      active: () => this.plugin.activeEmbeddingEndpoint,
      probe: (ep) => new EmbeddingClient(ep, this.plugin.settings.embeddingModel).probe(),
      reconnect: () => this.plugin.resolveAndReconnectEmbedder(),
    });
  };

  /** render-Hatch: Embedding-Modell-Dropdown. Zeichnet eine frische Setting im hostFor-Container. */
  private renderEmbeddingModel = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host).setName("Embedding-Modell").setDesc("Modellname wie auf dem Endpoint verfügbar");
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
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.refreshUi()));
      }
    });
  };

  /** render-Hatch: Embedding-Status-Zeile mit 2s-Poll. Das Intervall wird in pollIntervals
   *  gesammelt und als Cleanup-Funktion zurückgegeben — hide() räumt pollIntervals defensiv ab. */
  private renderEmbeddingStatus = (setting: Setting): (() => void) => {
    const host = this.hostFor(setting);
    const s = new Setting(host).setName("Embedding-Status");
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
      // Nur die eingebettete Zahl hier — der echte Rückstand (fehlende Notizen) lebt als EINE
      // Wahrheit in der Index-Zustand-Zeile (Index-Robustheit). „pending" war die transiente
      // Offline-Queue und kollidierte optisch mit dem Deckungs-Delta.
      const counts = p ? `${p.embeddedNotes.toLocaleString("de-DE")} eingebettet` : "";
      const act = p?.isEmbedding ? "Embedding läuft" : "";
      text.setText([conn, act, counts].filter(Boolean).join(" · "));
    };
    render();
    // Status-Poll stützt sich auf dieselbe Reachability-Logik wie main.ts (ping → Re-Resolve → ping).
    void this.plugin.embedderReady().then((ok: boolean) => { connected = ok; render(); });
    const interval = window.setInterval(render, 2000);
    this.pollIntervals.push(interval);
    return () => { window.clearInterval(interval); };
  };

  /** render-Hatch: Index-Ordner-Pfad + „Übernehmen". */
  private renderIndexDir = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host);
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
        this.refreshUi();
      }));
  };

  /** render-Hatch: Index-Zustand-Zeile (dynamische Desc via indexHealthReadout +
   *  „Vervollständigen"-Button); indexDelta() wird bei jedem Render/update() frisch geholt. */
  private renderIndexHealth = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const { embedded, total, healthy, emptyCount } = this.plugin.indexDelta();
    new Setting(host)
      .setName("Index-Zustand")
      .setDesc(this.plugin.indexHealthReadout(embedded, total, healthy, emptyCount))
      .addButton(b => b
        .setButtonText("Vervollständigen")
        .setDisabled(!healthy || embedded >= total)
        .onClick(() => { void this.plugin.healVault(); }));
  };

  /** render-Hatch: komplette MCP-Sektion. Bedingte Zeilen (nur bei mcpEnabled) und der
   *  Client-Snippet-`<pre>`-Block sitzen alle in diesem einen Hatch. */
  private renderMcpSection = (setting: Setting): void => {
    const containerEl = this.hostFor(setting);
    new Setting(containerEl)
      .setName("MCP-Server aktivieren")
      .setDesc("Lokaler HTTP-Server, über den externe LLM-Agents (z. B. Claude Code) den Vault durchsuchen. Nur Desktop, nur solange Obsidian läuft. Loopback (127.0.0.1) + Token.")
      .addToggle(t => t.setValue(this.plugin.settings.mcpEnabled).onChange(async (v: boolean) => {
        this.plugin.settings.mcpEnabled = v;
        if (v) this.plugin.ensureMcpToken();
        await this.plugin.saveSettings();
        await this.plugin.restartMcpServer();
        this.refreshUi();
      }));

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Loopback-Port des MCP-Servers (Default 8123). Änderung startet den Server neu.")
      .addText(t => t.setPlaceholder("8123").setValue(String(this.plugin.settings.mcpPort))
        .onChange(async (v: string) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1 || n > 65535) return;
          this.plugin.settings.mcpPort = n;
          await this.plugin.saveSettings();
          // Debounce (Fix 2): sonst würde jeder Tastendruck einen eigenen Server-Restart
          // auslösen (mirrors scheduleEmbed's Debounce-Idee in main.ts) — Speichern bleibt
          // sofort, nur der Neustart wartet ~800ms auf Tipp-Ruhe.
          if (this.mcpPortRestartTimer !== null) window.clearTimeout(this.mcpPortRestartTimer);
          this.mcpPortRestartTimer = window.setTimeout(() => {
            this.mcpPortRestartTimer = null;
            void this.plugin.restartMcpServer().then(() => this.refreshUi());
          }, 800);
        }));

    const detail = this.plugin.mcpStartError();
    const status = this.plugin.mcpServerRunning()
      ? `läuft · ${this.plugin.mcpServerAddress() ?? ""}`
      : (this.plugin.settings.mcpEnabled ? `aus — ${detail ?? "Start fehlgeschlagen"}` : "aus");
    new Setting(containerEl).setName("Status").setDesc(status);

    if (!this.plugin.settings.mcpEnabled) return;

    const token = this.plugin.settings.mcpToken;

    new Setting(containerEl)
      .setName("Token")
      .setDesc(this.showMcpToken ? token : maskToken(token))
      .addButton(b => b.setButtonText(this.showMcpToken ? "Verbergen" : "Anzeigen")
        .onClick(() => { this.showMcpToken = !this.showMcpToken; this.refreshUi(); }))
      .addButton(b => applyDestructive(b.setButtonText("Neu generieren"))
        .onClick(async () => {
          await this.plugin.rotateMcpToken();
          new Notice("Neuer Token — alte Clients müssen neu verbunden werden");
          this.refreshUi();
        }));

    new Setting(containerEl)
      .setName("Verbindung testen")
      .setDesc("Prüft den Server über den Loopback-Endpunkt — wie ein externer Client.")
      .addButton(b => b.setButtonText("Testen")
        .onClick(async () => {
          b.setDisabled(true);
          const res = await this.plugin.mcpSelfCheck();
          b.setDisabled(false);
          const msg = res === "ok" ? "✓ 3 Tools erreichbar"
            : res === "unauthorized" ? "Token stimmt nicht"
            : res === "unreachable" ? "Server nicht erreichbar (aus? Port?)"
            : "Antwort ist kein MCP";
          new Notice(`MCP-Selbsttest: ${msg}`);
        }));

    new Setting(containerEl)
      .setName("Angebotene Tools")
      .setDesc("search · related · read_note — read-only Zugriff auf den Vault-Index.");

    const url = this.plugin.mcpServerAddress() ?? `http://127.0.0.1:${this.plugin.settings.mcpPort}/mcp`;

    new Setting(containerEl)
      .setName("Client-Setup")
      .setDesc("Config für deinen MCP-Client — Client wählen, dann kopieren.")
      .addDropdown(d => {
        for (const c of MCP_CLIENTS) d.addOption(c.id, c.label);
        d.setValue(this.mcpClient);
        d.onChange((v: string) => { this.mcpClient = v as McpClientId; this.refreshUi(); });
      })
      .addButton(b => b.setButtonText("Kopieren")
        .onClick(() => {
          void navigator.clipboard.writeText(buildClientSnippet(this.mcpClient, { url, token }));
          new Notice("MCP-Config kopiert");
        }));

    const pre = containerEl.createEl("pre", { cls: "vault-rag-mcp-snippet" });
    pre.setText(buildClientSnippet(this.mcpClient, { url, token: maskToken(token) }));
  };

  /** render-Hatch: Chat-Endpunkt-Liste. Zeichnet in hostFor über buildEndpointList. */
  private renderChatEndpoints = (setting: Setting): void => {
    const host = this.hostFor(setting);
    this.buildEndpointList({
      containerEl: host,
      label: "Chat-Endpunkte",
      desc: "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. OpenAI-kompatible LLM-Server (MLX/LM-Studio), getrennt von den Embedding-Endpunkten.",
      placeholder: "http://localhost:1234",
      get: () => this.plugin.settings.chatEndpoints,
      set: (eps) => { this.plugin.settings.chatEndpoints = eps; },
      active: () => this.plugin.activeChatEndpoint,
      probe: (ep) => new ChatClient(ep, this.plugin.settings.chatModel).probe(),
      reconnect: () => this.plugin.resolveAndReconnectChat(),
    });
  };

  /** render-Hatch: Chat-Modell-Dropdown. Zeichnet eine frische Setting im hostFor-Container. Löst
   *  showInfo/showCaps aus — die schreiben in infoValue/lastCaps, gelesen von den render-Hatches
   *  Modelldetails/Fähigkeiten (Cross-Referenz über Render-State, kein direkter Aufruf). */
  private renderChatModel = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host).setName("Chat-Modell").setDesc("Modellname wie auf dem Chat-Endpoint verfügbar");
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
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.refreshUi()));
      }
      this.showInfo(this.plugin.settings.chatModel);
      this.showCaps(this.plugin.settings.chatModel);
    });
  };

  /** render-Hatch: Modelldetails-Zeile. Setzt infoValue, das showInfo() (aus renderChatModel)
   *  asynchron befüllt. */
  private renderModelDetails = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host).setName("Modelldetails");
    this.infoValue = s.controlEl.createSpan({ cls: "vault-rag-info-value", text: "…" });
  };

  /** render-Hatch: Fähigkeiten-Zeile. Setzt capSetting, das showCaps() (renderChatModel) und
   *  runThinkingTest() bei einer Caps-Upgrade re-rendern. */
  private renderCapsRow = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host).setName("Fähigkeiten");
    this.capSetting = s;
    this.renderCaps(s, this.lastCaps);
  };

  /** render-Hatch: Kontext-Budget-Slider. Bleibt render-Hatch (nicht deklarativ), weil die
   *  Obergrenze modell-gekoppelt ist: updateBudgetMax() (aufgerufen aus showInfo, sobald das
   *  Modell-Fenster bekannt ist) klemmt Limits/Wert live nach. */
  private renderBudget = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host);
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
  };

  /** render-Hatch: Smart-Apply-Modell-Dropdown. Zeichnet in hostFor. Leer-Option zuerst: der
   *  leere Wert ist bedeutungstragend (= Chat-Modell erben). */
  private renderSmartApplyModel = (setting: Setting): void => {
    const host = this.hostFor(setting);
    const s = new Setting(host).setName("Smart-Apply-Modell")
      .setDesc('Modell fuer den Umsortier-Call. Leer = Chat-Modell aus dem Abschnitt "Chat" verwenden.');
    void this.plugin.chatClient?.listModels().then((models: string[]) => {
      const cur = this.plugin.settings.smartApplyModel;
      if (models.length) {
        const list = cur && !models.includes(cur) ? [cur, ...models] : models;
        s.addDropdown(d => {
          d.addOption("", "Chat-Modell verwenden");
          list.forEach((m: string) => { d.addOption(m, m); });
          d.setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.smartApplyModel = v;
            await this.plugin.saveSettings();
          });
        });
      } else {
        s.setDesc('Server offline — Modellname eintippen (leer = Chat-Modell), dann „Modelle laden"');
        s.addText(t => t.setPlaceholder("leer = Chat-Modell").setValue(cur)
          .onChange(async (v: string) => {
            this.plugin.settings.smartApplyModel = v.trim();
            await this.plugin.saveSettings();
          }));
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.refreshUi()));
      }
    });
  };

  /** Body des früheren „Testen“-Buttons aus buildThinking (das Toggle daneben ist jetzt
   *  deklarativ). Ohne Button-Disable-Handling — Rückmeldung nur noch über Notice. Bei
   *  bestätigtem Thinking-Nachweis: Caps hochstufen + Fähigkeiten-Zeile neu zeichnen. */
  private async runThinkingTest(): Promise<void> {
    const model = this.plugin.settings.chatModel;
    if (isAlwaysOnThinker(model)) { new Notice("Dieses Modell denkt immer (nur low/medium/high)."); return; }
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
    }
  }

  hide(): void {
    for (const id of this.pollIntervals) window.clearInterval(id);
    this.pollIntervals = [];
    if (this.mcpPortRestartTimer !== null) { window.clearTimeout(this.mcpPortRestartTimer); this.mcpPortRestartTimer = null; }
    super.hide();
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
            .then(() => this.refreshUi());
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
              .then(() => this.refreshUi());
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
          if (cur.includes(preset.url)) return;   // schon in der Liste — kein Duplikat anhängen
          opts.set(applyEndpointEdit(cur, cur.length, preset.url, true));
          void this.plugin.saveSettings()
            .then(() => opts.reconnect())
            .then(() => this.refreshUi());
        }));
    });
    actions.addButton(b => b.setButtonText("Verbindung prüfen").onClick(() => this.refreshUi()));
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
    // Tolerant gegenüber stale .then nach einem Re-Render (this.infoValue wird pro render-Hatch
    // neu gesetzt): der Null-Guard no-oppt dann; bei gleichem Modell ist der Inhalt idempotent.
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
}
