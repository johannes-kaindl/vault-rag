import { App, ButtonComponent, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionGroup } from "obsidian";
import { ChatClient } from "./chat_client";
import { EmbeddingClient } from "./embedder";
import { resolveCapabilities } from "./capabilities";
import { reasoningHappened, isAlwaysOnThinker } from "./vendor/kit/reasoning";
import { normalizeIndexDir, isDotPath } from "./index_dir";
import { ENDPOINT_PRESETS } from "./vendor/kit/endpoint_diagnostics";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { copyToClipboard } from "./vendor/kit-obsidian/clipboard";
import { FolderSuggest } from "./vendor/kit-obsidian/folder-suggest";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "./vendor/kit-obsidian/settings_walker";
import { DEFAULT_SETTINGS, splitExcludePaths, normalizeTemplateDir, type VaultRagSettings } from "./settings_core";
import { rowModel, describeEndpointRole, endpointStatusText, endpointWarningText } from "./endpoint_config";
import { buildEndpointList as buildKitEndpointList, type EndpointListStrings } from "./vendor/kit-obsidian/endpoint-list";
import { embeddingModelMatchesIndex } from "./index_guard";
import { resolveModelChoice, type ModelHintKey } from "./vendor/kit/model-choice";
import { renderModelPicker } from "./vendor/kit-obsidian/model-picker";
import { createModelListCache, type ModelListCache } from "./vendor/kit/model-list-cache";
import { MCP_CLIENTS, buildClientSnippet, maskToken, type McpClientId } from "./mcp/client_snippets";
import { describeStartError, type SelfCheckResult, type StartErrorReason } from "./mcp/mcp_diagnostics";
import { t } from "./vendor/kit/i18n";

export { DEFAULT_SETTINGS };
export type { VaultRagSettings };
// Endpunkt-Helfer werden hier NICHT durchgereicht: sie kommen direkt aus `endpoint_config.ts`
// (eine öffentliche Fläche pro Wahrheit).

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
  /** Embedding-Modell des geladenen Index — genutzt, um das Modell einer Endpunkt-Zeile
   *  gegen den Index abzugleichen (`modelFits` in `buildEndpointList`). Schmaler Getter statt
   *  öffentlichem `index`-Feld: die UI braucht nur diesen String. */
  readonly indexEmbeddingModel: string | undefined;
  embedder: EmbeddingClient;
  chatClient: ChatClient;
  /** Modell, das Chat-Anfragen tatsächlich mitschicken (Zeilen-Modell des aktiven
   *  Endpunkts — seit 0.31.0 die einzige Quelle) — siehe main.ts. */
  chatModelInUse: string;
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
  mcpStartError(): StartErrorReason | null;
  rotateMcpToken(): Promise<void>;
  mcpSelfCheck(): Promise<SelfCheckResult>;
}

export class RestoreBackupModal extends Modal {
  constructor(app: App, private entries: { name: string; count: number }[], private onPick: (name: string) => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: t("settings.robustness.restoreBackup.name") });
    if (this.entries.length === 0) { contentEl.createEl("p", { text: t("settings.restore.empty") }); return; }
    for (const e of this.entries) {
      const row = new Setting(contentEl).setName(t("settings.recentNoteCount", e.count.toLocaleString())).setDesc(e.name);
      row.addButton(b => applyDestructive(b.setButtonText(t("settings.restore.button"))).onClick(() => { this.close(); this.onPick(e.name); }));
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
  // Cleanup-Funktion des letzten renderSettingDefinitions()-Laufs (Kit-Walker, settings_walker.ts).
  // Ab 1.13 ruft das Framework sie vor dem Zerlegen einer Zeile selbst auf; renderImperative()
  // muss denselben Vertrag einhalten und sie vor jedem Rebuild abräumen (siehe dort).
  private cleanupPrevious: () => void = () => {};
  // Einmal pro Tab-Öffnen (nicht pro Re-Render) Embedder+Chat re-resolven — ersetzt das
  // resolvedOnOpen-Gate aus dem alten display(). getSettingDefinitions() läuft sowohl im
  // nativen Pfad (Framework ruft pro update() erneut auf) als auch im Fallback
  // (renderImperative() pro Rebuild) — das Flag macht in beiden EINMAL pro Öffnen daraus;
  // hide() setzt es zurück, damit das nächste Öffnen wieder re-resolved.
  private resolvedOnOpen = false;
  /** Modell-Listen je Endpunkt (Schlüssel = normalizeEndpoint(url)) samt Generationszähler:
   *  eine Antwort aus einer alten Generation wird verworfen, sonst schriebe eine langsame
   *  Antwort in eine Zeile, die inzwischen einen anderen Endpunkt zeigt.
   *  Überlebt bewusst refreshUi() — der Tab wird bei JEDEM URL-Commit neu gebaut, und
   *  reconnect() pingt dabei jeden Endpunkt (bis 5 s); ohne Cache zöge jedes Tippen an einer
   *  URL sämtliche Modell-Listen erneut. Stirbt in hide().
   *
   *  Kommt seit der Rückadoption aus `vendor/kit/model-list-cache` — jenes Modul IST die
   *  Extraktion genau dieser Felder aus diesem Repo (Kit-Docstring: „Herkunft: vault-rag/
   *  src/settings.ts (loadModelList/invalidateModelList/modelListGeneration, 0.19.x)").
   *  Instanz statt Modul-Singleton: der Cache gehört zur Lebensdauer EINES Settings-Tabs.
   *
   *  Holt die Modell-Liste eines Endpunkts (mit Cache). Sparsam: eine nicht leere Liste
   *  beweist die Erreichbarkeit bereits — nur bei leerer Liste wird zusätzlich geprobt, um
   *  „offline" von „gibt keine Liste heraus" zu trennen. */
  private modelCache: ModelListCache = createModelListCache();

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

  /** Einmal-pro-Öffnen die aktiven Endpunkte auflösen. An ein echtes Render-Signal (erster
   *  render-Hatch) gehängt statt an getSettingDefinitions() — Letzteres enumeriert die native
   *  1.13-Settings-Suche auch ohne unser Tab anzuzeigen, was das Gate zu früh verbrauchen würde.
   *  Läuft in beiden Pfaden (nativ: Framework ruft den Hatch beim Anzeigen; Fallback: renderImperative). */
  private ensureResolvedOnOpen(): void {
    if (this.resolvedOnOpen) return;
    this.resolvedOnOpen = true;
    // Re-Render NACH Abschluss beider Resolver — sonst zeigt eine Zeile (z.B. Status-Icon +
    // Rollen-Text) noch den Stand von vor dem Resolve, während main.ts activeEmbeddingEndpoint/
    // activeChatEndpoint längst umgeschaltet hat: eine Zeile behauptet "aktiv", während eine
    // andere per Live-Status "verbunden" meldet — genau die Diskrepanz, die die Rollen-Zeile
    // verhindern soll. Kein Loop: resolvedOnOpen ist zu diesem Zeitpunkt bereits true, der
    // Rebuild ruft ensureResolvedOnOpen() erneut auf, das dort sofort returned.
    void Promise.all([
      this.plugin.resolveAndReconnectEmbedder(),
      this.plugin.resolveAndReconnectChat(),
    ]).then(() => this.refreshUi());
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
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(
      this.containerEl,
      this.getSettingDefinitions(),
      this,
      this.app,
    );
  }

  /** Re-Render des Tabs. Ab 1.13 exponiert das deklarative Framework update(); auf dem <1.13-Fallback
   *  existiert die Methode nicht → renderImperative() erneut laufen. */
  private refreshUi(): void {
    refreshSettingsTab(this, () => this.renderImperative());
  }

  /** Übersetzt den sprachfreien Hinweis-Schlüssel des Kit-Pickers (i18n Teil 3: das Kit
   *  liefert Codes, wir formulieren). Eine Wahrheit für Endpunkt-Zeilen und Smart-Apply-Feld. */
  private modelHint(key: ModelHintKey): string {
    return key === "unreachable" ? t("modelChoice.hintUnreachable")
         : key === "no-list" ? t("modelChoice.hintNoList")
         : "";
  }

  private searchGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.search.group"), items: [
      { name: t("settings.search.count.name"),
        desc: t("settings.search.count.desc"),
        control: { type: "slider", key: "k", min: 5, max: 50, step: 1,
          displayFormat: (v: number) => String(v) } },
      { name: t("settings.search.minSim.name"),
        desc: t("settings.search.minSim.desc"),
        control: { type: "slider", key: "minSim", min: 0, max: 0.9, step: 0.05,
          displayFormat: (v: number) => `${Math.round(v * 100)} %` } },
      { name: t("settings.search.exclude.name"),
        desc: t("settings.search.exclude.desc"),
        control: { type: "text", key: "exclude", placeholder: "Templates/, Archive/" } },   // i18n-exempt: Pfad-Beispiel, sprachneutral (Ordnernamen)
    ] };
  }

  private embeddingGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.embedding.group"), items: [
      { name: t("settings.embeddingEndpoints.label"), desc: "", render: this.renderEmbeddingEndpoints },
      { name: t("settings.embeddingStatus.name"), desc: "", render: this.renderEmbeddingStatus },
      { name: t("settings.embedding.debounce.name"), desc: t("settings.embedding.debounce.desc"),
        control: { type: "slider", key: "debounceMs", min: 500, max: 10000, step: 500,
          displayFormat: (v: number) => `${v / 1000} s` } },
      { name: t("settings.embedding.statusBar.name"), desc: t("settings.embedding.statusBar.desc"),
        control: { type: "toggle", key: "showStatusBar" } },
    ] };
  }

  private indexGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.index.group"), items: [
      { name: t("settings.indexFolder.name"), desc: "", render: this.renderIndexDir },
      { name: t("settings.index.hideFolder.name"),
        desc: t("settings.index.hideFolder.desc"),
        control: { type: "toggle", key: "hideIndexFolder" } },
    ] };
  }

  /** „Vault neu indizieren" lebt bewusst hier statt in der Index-Sektion (Config): Robustheit
   *  bündelt alle Wiederherstellungs-Aktionen (Zustand, Delta-Heal, Backup, Voll-Reindex) an
   *  einer Stelle — kein zweiter Reindex-Button mehr in „Index". */
  private robustnessGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.robustness.group"), items: [
      { name: t("settings.indexHealth.name"), desc: "", render: this.renderIndexHealth },
      { name: t("settings.robustness.restoreBackup.name"),
        desc: t("settings.robustness.restoreBackup.desc"),
        action: () => { void (async () => {
          new RestoreBackupModal(this.app, await this.plugin.listBackups(), (n) => void this.plugin.restoreBackup(n)).open();
        })(); } },
      { name: t("command.reindexVault"),
        desc: t("settings.robustness.reindex.desc"),
        action: () => {
          void confirmAction(this.app, {
            title: t("settings.robustness.reindexConfirm.title"),
            message: t("settings.robustness.reindexConfirm.message"),
            confirmLabel: t("settings.robustness.reindexConfirm.confirmLabel"),
            cancelLabel: t("settings.robustness.reindexConfirm.cancelLabel"),
          }).then((ok) => { if (ok) void this.plugin.reindexVault(); });
        } },
    ] };
  }

  /** Die MCP-Sektion ist zustandsreich (bedingte Zeilen bei mcpEnabled, Token-Toggle,
   *  Port-Debounce-Restart, Client-Dropdown, Snippet-`<pre>`) — deshalb EIN render-Hatch statt
   *  einzelner Controls, der den kompletten bisherigen buildMcpSection-Body zeichnet. */
  private mcpGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.mcp.group"), items: [
      { name: t("settings.mcp.row.name"), desc: "", render: this.renderMcpSection },
    ] };
  }

  /** Chat-Gruppe: Endpunkte/Modelldetails/Fähigkeiten/Budget bleiben render-Hatches
   *  (Cross-Referenzen über lastCaps/infoValue/capSetting, Budget-Max ans Modell-Fenster
   *  gekoppelt). „Thinking testen“ war ein Button IN der Toggle-Zeile — jetzt eigene
   *  Action-Zeile, das Toggle selbst ist deklarativ. */
  private chatGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.chat.group"), items: [
      { name: t("settings.chatEndpoints.label"), desc: "", render: this.renderChatEndpoints },
      { name: t("settings.modelDetails.name"), desc: "", render: this.renderModelDetails },
      { name: t("settings.capabilities.name"), desc: "", render: this.renderCapsRow },
      { name: t("settings.chat.contextNotes.name"), desc: t("settings.chat.contextNotes.desc"),
        control: { type: "slider", key: "chatK", min: 1, max: 20, step: 1, displayFormat: (v: number) => String(v) } },
      { name: t("settings.chat.contextBudget.name"), desc: "", render: this.renderBudget },
      { name: t("settings.chat.temperature.name"), desc: t("settings.chat.temperature.desc"),
        control: { type: "slider", key: "chatTemperature", min: 0, max: 2, step: 0.1, displayFormat: (v: number) => String(v) } },
      { name: t("settings.chat.systemPrompt.name"), desc: t("settings.chat.systemPrompt.desc"),
        control: { type: "textarea", key: "chatSystemPrompt", rows: 8 } },
      { name: t("settings.chat.inputPosition.name"), desc: t("settings.chat.inputPosition.desc"),
        control: { type: "dropdown", key: "chatInputPosition", options: { bottom: t("settings.chat.inputPosition.optionBottom"), top: t("settings.chat.inputPosition.optionTop") } } },
      { name: t("settings.chat.suppressThinking.name"),
        desc: t("settings.chat.suppressThinking.desc"),
        control: { type: "toggle", key: "suppressThinking" } },
      { name: t("settings.chat.testThinking.name"), desc: t("settings.chat.testThinking.desc"),
        action: () => { void this.runThinkingTest(); } },
      { name: t("settings.chat.enterSends.name"), desc: t("settings.chat.enterSends.desc"),
        control: { type: "toggle", key: "enterSends" } },
    ] };
  }

  /** Smart-Apply-Gruppe: fast vollständig deklarativ. „Verbindung" ist eine reine Info-Zeile
   *  (kein control/render/action — Smart Apply teilt sich den Chat-Endpoint, kein eigener nötig).
   *  templateDir ist ein natives folder-Control (Vault-Ordner-Suggester); die Trailing-Slash-
   *  Normalisierung passiert bereits in setControlValue (Task 2). Nur das Modell-Dropdown bleibt
   *  ein render-Hatch (Cross-Referenz auf plugin.chatClient, Online/Offline-Fallback). */
  private smartApplyGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.smartApply.group"), items: [
      { name: t("settings.smartApply.enable.name"),
        desc: t("settings.smartApply.enable.desc"),
        control: { type: "toggle", key: "smartApplyEnabled" } },
      { name: t("settings.smartApply.connection.name"),
        desc: t("settings.smartApply.connection.desc") },
      { name: t("settings.smartApply.templateDir.name"),
        desc: t("settings.smartApply.templateDir.desc"),
        control: { type: "folder", key: "templateDir", placeholder: "Templates/" } },   // i18n-exempt: Pfad-Beispiel, sprachneutral (Ordnername)
      { name: t("settings.smartApply.temperature.name"),
        desc: t("settings.smartApply.temperature.desc"),
        control: { type: "slider", key: "smartApplyTemperature", min: 0, max: 2, step: 0.1, displayFormat: (v: number) => String(v) } },
      { name: t("settings.smartApplyModel.name"), desc: t("settings.smartApply.modelRow.desc"),
        render: this.renderSmartApplyModel },
      { name: t("settings.smartApply.suppressThinking.name"),
        desc: t("settings.smartApply.suppressThinking.desc"),
        control: { type: "toggle", key: "smartApplySuppressThinking" } },
      { name: t("settings.smartApply.maxTokens.name"),
        desc: t("settings.smartApply.maxTokens.desc"),
        control: { type: "slider", key: "smartApplyMaxTokens", min: 512, max: 16384, step: 512, displayFormat: (v: number) => String(v) } },
      { name: t("settings.smartApply.defaultMode.name"),
        desc: t("settings.smartApply.defaultMode.desc"),
        control: { type: "dropdown", key: "smartApplyDefaultMode",
          options: { deterministisch: t("settings.smartApply.defaultMode.optionDeterministic"), additiv: t("settings.smartApply.defaultMode.optionAdditive") } } },
    ] };
  }

  /** render-Hatch: Embedding-Endpunkt-Liste. Zeichnet in settingBodyHost über buildEndpointList. */
  private renderEmbeddingEndpoints = (setting: Setting): void => {
    this.ensureResolvedOnOpen();
    const host = settingBodyHost(setting);
    const embeddingLabel = t("settings.embeddingEndpoints.label");
    buildKitEndpointList({
      containerEl: host,
      label: embeddingLabel,
      desc: t("settings.embeddingEndpoints.desc"),
      placeholder: "http://localhost:11434",   // i18n-exempt: URL-Beispiel, sprachneutral
      strings: this.endpointStrings(embeddingLabel),
      cache: this.modelCache,
      get: () => this.plugin.settings.embeddingEndpoints,
      set: (eps) => { this.plugin.settings.embeddingEndpoints = eps; },
      active: () => this.plugin.activeEmbeddingEndpoint,
      clientFor: (cfg) => new EmbeddingClient(cfg.url, rowModel(cfg), cfg.apiKey),
      modelFits: (cfg) => embeddingModelMatchesIndex(rowModel(cfg), this.plugin.indexEmbeddingModel),
      save: () => this.plugin.saveSettings(),
      reconnect: () => this.plugin.resolveAndReconnectEmbedder(),
      rerender: () => this.refreshUi(),
      presets: ENDPOINT_PRESETS,
    });
  };

  /** render-Hatch: Embedding-Status-Zeile mit 2s-Poll. Das Intervall wird in pollIntervals
   *  gesammelt und als Cleanup-Funktion zurückgegeben — hide() räumt pollIntervals defensiv ab. */
  private renderEmbeddingStatus = (setting: Setting): (() => void) => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.embeddingStatus.name"));
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
      const conn = connected === null ? t("settings.conn.checking") : connected ? (active ? t("settings.conn.connectedVia", active) : t("settings.conn.connected")) : t("settings.conn.offline");
      const p = this.plugin.embeddingProgress as { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number } | undefined;
      // Nur die eingebettete Zahl hier — der echte Rückstand (fehlende Notizen) lebt als EINE
      // Wahrheit in der Index-Zustand-Zeile (Index-Robustheit). „pending" war die transiente
      // Offline-Queue und kollidierte optisch mit dem Deckungs-Delta.
      const counts = p ? t("settings.conn.embeddedCount", p.embeddedNotes.toLocaleString()) : "";
      const act = p?.isEmbedding ? t("settings.conn.embedding") : "";
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
    const host = settingBodyHost(setting);
    const s = new Setting(host);
    let typed = this.plugin.settings.indexDir;
    s.setName(t("settings.indexFolder.name"))
      .setDesc(t("settings.indexFolder.desc"))
      .addText(t => {
        t.setPlaceholder("_vaultrag").setValue(this.plugin.settings.indexDir);   // i18n-exempt: Ordnername-Beispiel, sprachneutral
        t.onChange((v: string) => { typed = v; });
        new FolderSuggest(this.app, t.inputEl).onSelect((path: string) => { typed = path; t.setValue(path); });
      })
      .addButton(b => b.setButtonText(t("settings.button.apply")).onClick(async () => {
        const norm = normalizeIndexDir(typed);
        if (norm === "" || norm === normalizeIndexDir(this.plugin.settings.indexDir)) return;
        if (isDotPath(norm)) new Notice(t("settings.indexFolder.dotWarning"));
        b.setButtonText(t("settings.indexFolder.moving")); b.setDisabled(true);
        try {
          await this.plugin.changeIndexDir(norm);
          new Notice(t("settings.indexFolder.moved", norm));
        } finally { b.setButtonText(t("settings.button.apply")); b.setDisabled(false); }
        this.refreshUi();
      }));
  };

  /** render-Hatch: Index-Zustand-Zeile (dynamische Desc via indexHealthReadout +
   *  „Vervollständigen"-Button); indexDelta() wird bei jedem Render/update() frisch geholt. */
  private renderIndexHealth = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const { embedded, total, healthy, emptyCount } = this.plugin.indexDelta();
    new Setting(host)
      .setName(t("settings.indexHealth.name"))
      .setDesc(this.plugin.indexHealthReadout(embedded, total, healthy, emptyCount))
      .addButton(b => b
        .setButtonText(t("settings.button.complete"))
        .setDisabled(!healthy || embedded >= total)
        .onClick(() => { void this.plugin.healVault(); }));
  };

  /** render-Hatch: komplette MCP-Sektion. Bedingte Zeilen (nur bei mcpEnabled) und der
   *  Client-Snippet-`<pre>`-Block sitzen alle in diesem einen Hatch. */
  private renderMcpSection = (setting: Setting): void => {
    const containerEl = settingBodyHost(setting);
    new Setting(containerEl)
      .setName(t("settings.mcpEnable.name"))
      .setDesc(t("settings.mcpEnable.desc"))
      .addToggle(t => t.setValue(this.plugin.settings.mcpEnabled).onChange(async (v: boolean) => {
        this.plugin.settings.mcpEnabled = v;
        if (v) this.plugin.ensureMcpToken();
        await this.plugin.saveSettings();
        await this.plugin.restartMcpServer();
        this.refreshUi();
      }));

    new Setting(containerEl)
      .setName(t("settings.mcpPort.name"))
      .setDesc(t("settings.mcpPort.desc"))
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

    const startError = this.plugin.mcpStartError();
    const detail = startError ? describeStartError(startError) : null;
    const status = this.plugin.mcpServerRunning()
      ? t("settings.mcp.running", this.plugin.mcpServerAddress() ?? "")
      : (this.plugin.settings.mcpEnabled ? t("settings.mcp.offWithDetail", detail ?? t("settings.mcp.startFailed")) : t("settings.mcp.off"));
    new Setting(containerEl).setName(t("settings.mcpStatus.name")).setDesc(status);

    if (!this.plugin.settings.mcpEnabled) return;

    const token = this.plugin.settings.mcpToken;

    new Setting(containerEl)
      .setName(t("settings.mcpToken.name"))
      .setDesc(this.showMcpToken ? token : maskToken(token))
      .addButton(b => b.setButtonText(this.showMcpToken ? t("settings.button.hide") : t("settings.button.show"))
        .onClick(() => { this.showMcpToken = !this.showMcpToken; this.refreshUi(); }))
      .addButton(b => applyDestructive(b.setButtonText(t("settings.button.regenerate")))
        .onClick(async () => {
          await this.plugin.rotateMcpToken();
          new Notice(t("settings.mcpToken.regenerated"));
          this.refreshUi();
        }));

    new Setting(containerEl)
      .setName(t("settings.mcpTestConnection.name"))
      .setDesc(t("settings.mcpTestConnection.desc"))
      .addButton(b => b.setButtonText(t("settings.button.testConnection"))
        .onClick(async () => {
          b.setDisabled(true);
          const res = await this.plugin.mcpSelfCheck();
          b.setDisabled(false);
          const msg = res === "ok" ? t("settings.mcp.selfTest.ok")
            : res === "unauthorized" ? t("settings.mcp.selfTest.unauthorized")
            : res === "unreachable" ? t("settings.mcp.selfTest.unreachable")
            : t("settings.mcp.selfTest.badResponse");
          new Notice(t("settings.mcpSelfTest", msg));
        }));

    new Setting(containerEl)
      .setName(t("settings.mcpTools.name"))
      .setDesc(t("settings.mcpTools.desc"));

    const url = this.plugin.mcpServerAddress() ?? `http://127.0.0.1:${this.plugin.settings.mcpPort}/mcp`;

    new Setting(containerEl)
      .setName(t("settings.mcpClientSetup.name"))
      .setDesc(t("settings.mcpClientSetup.desc"))
      .addDropdown(d => {
        for (const c of MCP_CLIENTS) d.addOption(c.id, t(c.labelKey));
        d.setValue(this.mcpClient);
        d.onChange((v: string) => { this.mcpClient = v as McpClientId; this.refreshUi(); });
      })
      .addButton(b => b.setButtonText(t("settings.button.copy"))
        .onClick(() => {
          void copyToClipboard(buildClientSnippet(this.mcpClient, { url, token }), {
            copiedMessage: t("settings.mcpConfigCopied"),
            failedMessage: t("settings.mcpConfigCopyFailed"),
          });
        }));

    const pre = containerEl.createEl("pre", { cls: "vault-rag-mcp-snippet" });
    pre.setText(buildClientSnippet(this.mcpClient, { url, token: maskToken(token) }));
  };

  /** render-Hatch: Chat-Endpunkt-Liste. Zeichnet in settingBodyHost über buildEndpointList. */
  private renderChatEndpoints = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const chatLabel = t("settings.chatEndpoints.label");
    buildKitEndpointList({
      containerEl: host,
      label: chatLabel,
      desc: t("settings.chatEndpoints.desc"),
      placeholder: "http://localhost:1234",   // i18n-exempt: URL-Beispiel, sprachneutral
      strings: this.endpointStrings(chatLabel),
      cache: this.modelCache,
      get: () => this.plugin.settings.chatEndpoints,
      set: (eps) => { this.plugin.settings.chatEndpoints = eps; },
      active: () => this.plugin.activeChatEndpoint,
      clientFor: (cfg) => new ChatClient(cfg.url, rowModel(cfg), cfg.apiKey),
      // KEIN modelFits: an einem Chat-Endpunkt haengt kein Index, ein Modellwechsel ist dort
      // folgenlos. Der Kit-Vertrag liest das Fehlen als „passt immer".
      save: () => this.plugin.saveSettings(),
      reconnect: () => this.plugin.resolveAndReconnectChat(),
      rerender: () => this.refreshUi(),
      presets: ENDPOINT_PRESETS,
    });
  };

  /** render-Hatch: Modelldetails-Zeile. Befüllt sich selbst über showInfo() mit dem Modell,
   *  das eine echte Anfrage bekäme (chatModelInUse) — seit 0.31.0 gibt es keine Chat-Modell-
   *  Zeile mehr, die das anstieß; eine Modelländerung in der Endpunkt-Zeile löst über deren
   *  `rerender` einen Neuaufbau aus und damit diesen Hatch. */
  private renderModelDetails = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.modelDetails.name"));
    this.infoValue = s.controlEl.createSpan({ cls: "vault-rag-info-value", text: t("settings.loadingPlaceholder") });
    this.showInfo(this.plugin.chatModelInUse);
  };

  private renderCapsRow = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.capabilities.name"));
    this.capSetting = s;
    this.renderCaps(s, this.lastCaps);
    this.showCaps(this.plugin.chatModelInUse);
  };

  /** render-Hatch: Kontext-Budget-Slider. Bleibt render-Hatch (nicht deklarativ), weil die
   *  Obergrenze modell-gekoppelt ist: updateBudgetMax() (aufgerufen aus showInfo, sobald das
   *  Modell-Fenster bekannt ist) klemmt Limits/Wert live nach. */
  private renderBudget = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host);
    s.setName(t("settings.contextBudget.name", this.plugin.settings.contextCharBudget.toLocaleString()))
      .setDesc(t("settings.contextBudget.desc"))
      .addSlider(sl => {
        // Obsidians `setValue` loest `onChange` aus (am Aufruf-Stack gemessen, 2026-08-04).
        // Ohne diesen Schalter wird jedes programmatische Nachziehen der Obergrenze zu einem
        // Schreibvorgang: Tab oeffnen genuegte, um `data.json` zu schreiben, ohne dass jemand
        // etwas geaendert hatte. Das zementiert einen fehlerhaften Speicherzustand sofort und
        // macht "data.json wurde geschrieben" als Diagnose-Signal wertlos.
        let programmatic = false;
        sl.setLimits(2000, 32000, 1000).setValue(this.plugin.settings.contextCharBudget)          .onChange(async (v: number) => {
            if (programmatic) return;
            this.plugin.settings.contextCharBudget = v;
            s.setName(t("settings.contextBudget.name", v.toLocaleString()));
            await this.plugin.saveSettings();
          });
        // Sobald das Modell-Fenster bekannt ist (showInfo): Slider-Max daran koppeln + Wert klemmen.
        this.updateBudgetMax = (maxChars: number): void => {
          const max = Math.max(8000, Math.round(maxChars / 1000) * 1000);
          sl.setLimits(2000, max, 1000);
          const val = Math.min(this.plugin.settings.contextCharBudget, max);
          programmatic = true;
          try { sl.setValue(val); } finally { programmatic = false; }
          s.setName(t("settings.contextBudget.nameWithMax", val.toLocaleString(), max.toLocaleString()));
          if (val !== this.plugin.settings.contextCharBudget) {
            // Eine echte Klemmung IST eine Aenderung und wird geschrieben — hier bewusst
            // ausserhalb des Schalters, damit der Wert nicht bei jedem Oeffnen zurueckspringt.
            this.plugin.settings.contextCharBudget = val;
            void this.plugin.saveSettings();
          }
        };
      });
  };

  /** render-Hatch: Smart-Apply-Modell. Der leere Wert ist bedeutungstragend (= Modell des
   *  aktiven Chat-Endpunkts), deshalb allowEmpty; das Label der Leer-Option setzt der Host,
   *  das Kit formuliert nicht. */
  private renderSmartApplyModel = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.smartApplyModel.name"))
      .setDesc(t("settings.smartApplyModel.desc"));
    const key = this.plugin.activeChatEndpoint ?? "";
    const gen = this.modelCache.generation();
    void this.modelCache.load(key, this.plugin.chatClient).then(({ models, reachable }) => {
      if (gen !== this.modelCache.generation()) return;
      const choice = resolveModelChoice({ reachable, models, current: this.plugin.settings.smartApplyModel, allowEmpty: true });
      const emptyLabel = t("settings.smartApplyModel.emptyLabel");
      renderModelPicker({
        setting: s,
        choice: { ...choice, options: choice.options.map(o => o.value === "" ? { ...o, label: emptyLabel } : o) },
        ariaLabel: t("settings.smartApplyModel.name"),
        placeholder: t("settings.smartApplyModel.placeholder"),
        hint: this.modelHint(choice.hintKey),
        savedSuffix: t("modelChoice.savedSuffix"),
        refreshTooltip: t("settings.button.fetchModels"),
        onPick: (v: string) => {
          this.plugin.settings.smartApplyModel = v;
          void this.plugin.saveSettings();
        },
        onRefresh: () => { this.modelCache.invalidate(key); this.refreshUi(); },
      });
    });
  };

  /** Body des früheren „Testen“-Buttons aus buildThinking (das Toggle daneben ist jetzt
   *  deklarativ). Ohne Button-Disable-Handling — Rückmeldung nur noch über Notice. Bei
   *  bestätigtem Thinking-Nachweis: Caps hochstufen + Fähigkeiten-Zeile neu zeichnen. */
  private async runThinkingTest(): Promise<void> {
    // Getestet wird das Modell, das eine echte Anfrage bekäme (chatModelInUse) — ein Test
    // gegen einen anderen Namen liefe ins Leere („Endpoint nicht erreichbar" statt eines
    // Thinking-Befunds).
    const model = this.plugin.chatModelInUse;
    if (isAlwaysOnThinker(model)) { new Notice(t("settings.thinkerAlwaysOn")); return; }
    try {
      const res = await this.plugin.chatClient.stream(
        [{ role: "user", content: t("settings.thinkingTest.prompt") }],
        () => {}, () => {}, undefined,
        { model, suppressThinking: true, trace: { feature: "settings-probe", app: this.app } });
      const happened = reasoningHappened(res.content, res.reasoning);
      new Notice(happened ? t("settings.thinkingDespiteOff") : t("settings.thinkingSuppressed"));
      if (happened) {
        // Live-Nachweis, dass das Modell denkt → Fähigkeiten-Zeile hochstufen.
        this.lastCaps = { ...this.lastCaps, thinking: { support: "always", confidence: "confirmed" } };
        if (this.capSetting) this.renderCaps(this.capSetting, this.lastCaps);
      }
    } catch {
      new Notice(t("settings.chatEndpointUnreachable"));
    }
  }

  hide(): void {
    for (const id of this.pollIntervals) window.clearInterval(id);
    this.pollIntervals = [];
    if (this.mcpPortRestartTimer !== null) { window.clearTimeout(this.mcpPortRestartTimer); this.mcpPortRestartTimer = null; }
    this.cleanupPrevious();
    this.cleanupPrevious = () => {};
    this.resolvedOnOpen = false;
    this.modelCache.clear();
    super.hide();
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Die Sprach-Hälfte des Kit-Endpunkt-Editors. Das Kit formuliert nichts selbst (sein
   *  Docstring: „Sprache, Tonfall und Übersetzung gehören dem Consumer") — hier liegt die
   *  Abbildung seiner 22 Textstellen auf unsere i18n-Schlüssel.
   *
   *  `label` ist Parameter und nicht aus `opts` abgeleitet, weil auf diesem Tab ZWEI Listen
   *  stehen (Embedding und Chat): ein gemeinsames Objekt gäbe allen URL-Feldern beider Listen
   *  dasselbe `aria-label`, und ein Screenreader könnte sie nicht auseinanderhalten. Genau
   *  dieser Fall ist im Kit-Vertrag namentlich als unserer dokumentiert.
   *
   *  Drei Stellen sind bewusst KEINE t()-Aufrufe, sondern unsere eigenen Übersetzer für
   *  Kit-Diagnose-Codes (i18n Teil 3 — die vendorten Module liefern Code UND fest deutschen
   *  Klartext; wir nehmen immer den Code): `statusTooltip`, `role`, `warnings`. */
  private endpointStrings(label: string): EndpointListStrings {
    return {
      addPlaceholder: t("settings.endpoint.addPlaceholder"),
      apiKeyPlaceholder: t("settings.endpoint.keyPlaceholder"),
      modelPlaceholder: t("settings.endpoint.modelPlaceholder"),
      ariaUrl: t("settings.endpointRow.ariaUrl", label),
      ariaAdd: t("settings.endpointRow.ariaAdd", label),
      ariaApiKey: (url: string) => t("settings.endpoint.keyAria", url),
      ariaModel: (url: string) => t("settings.endpoint.modelAria", url),
      // Der Kit-Picker liefert einen sprachfreien Schlüssel statt eines fertigen Satzes —
      // dieselbe Regel, nach der unsere eigenen Diagnose-Funktionen Codes liefern.
      modelHint: (key) => this.modelHint(key),
      savedSuffix: t("modelChoice.savedSuffix"),
      refreshModels: t("settings.button.fetchModels"),
      moveToFront: t("settings.endpoint.moveToFrontTooltip"),
      remove: t("settings.endpoint.removeTooltip"),
      thirdParty: t("settings.endpoint.keyWarning"),
      probing: t("settings.conn.checking"),
      statusTooltip: (status) => endpointStatusText(status),
      role: (role) => describeEndpointRole(role),
      warnings: (warnings) => warnings.map(endpointWarningText).join(" · "),
      presetTooltip: (preset) => t("settings.endpoint.addPreset", preset.url),
      presetLabel: (preset) => `+ ${preset.label}`,
      checkConnection: t("settings.button.checkConnection"),
      saveFailed: t("settings.endpointSaveFailed"),
    };
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
      const label = c.thinking.support === "always" ? t("settings.thinking.alwaysOn") : "Thinking";
      chip("brain", c.thinking.confidence === "confirmed" ? label : label + "?", c.thinking.confidence !== "confirmed");
      any = true;
    }
    if (!any) el.setText(t("settings.caps.none"));
  }

  private showInfo(model: string): void {
    // Tolerant gegenüber stale .then nach einem Re-Render (this.infoValue wird pro render-Hatch
    // neu gesetzt): der Null-Guard no-oppt dann; bei gleichem Modell ist der Inhalt idempotent.
    void this.plugin.chatClient?.modelInfo(model).then((info: { contextLength?: number; quantization?: string; state?: string } | null) => {
      if (!this.infoValue) return;
      if (info) {
        const ctx = info.contextLength ? t("settings.modelDetails.maxContext", info.contextLength.toLocaleString()) : "";
        this.infoValue.setText([ctx, info.quantization, info.state].filter(Boolean).join(" · ") || t("settings.caps.loaded"));
        // Budget-Obergrenze ans Modell-Fenster koppeln (~4 Zeichen/Token).
        if (info.contextLength) this.updateBudgetMax(info.contextLength * 4);
      } else {
        this.infoValue.setText(t("settings.caps.noDetails"));
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
