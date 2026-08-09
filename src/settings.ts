import { App, ButtonComponent, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon, setTooltip } from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionGroup } from "obsidian";
import { ChatClient } from "./chat_client";
import { EmbeddingClient } from "./embedder";
import { resolveCapabilities } from "./capabilities";
import { reasoningHappened, isAlwaysOnThinker } from "./vendor/kit/reasoning";
import { normalizeIndexDir, isDotPath } from "./index_dir";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { ENDPOINT_PRESETS, validateEndpointInput, type EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { FolderSuggest } from "./vendor/kit-obsidian/folder-suggest";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "./vendor/kit-obsidian/settings_walker";
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, splitExcludePaths, normalizeTemplateDir, type VaultRagSettings } from "./settings_core";
import { applyEndpointEdit, effectiveModel, carriesApiKey, moveEndpointToFront, endpointRole, describeEndpointRole, type EndpointConfig } from "./endpoint_config";
import { embeddingModelMatchesIndex } from "./index_guard";
import { resolveModelChoice, type ModelChoice } from "./model_choice";
import { MCP_CLIENTS, buildClientSnippet, maskToken, type McpClientId } from "./mcp/client_snippets";
import type { SelfCheckResult } from "./mcp/mcp_diagnostics";
import { t } from "./vendor/kit/i18n";

export { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT };
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
  /** Modell, das Chat-Anfragen tatsächlich mitschicken (Zeilen-Override des aktiven
   *  Endpunkts vor `settings.chatModel`) — siehe main.ts. */
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
  mcpStartError(): string | null;
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

interface ModelPickerOpts {
  /** Zeile, in die gezeichnet wird (bereits vorhandene Setting). */
  setting: Setting;
  choice: ModelChoice;
  /** Für Screenreader — in einer Endpunkt-Zeile stehen drei Felder nebeneinander. */
  ariaLabel: string;
  placeholder: string;
  /** Speichern + Nachwirkungen (reconnect, showInfo/showCaps, commit) — je Stelle verschieden. */
  onPick: (value: string) => void;
  /** Cache für diesen Endpunkt verwerfen und neu zeichnen. */
  onRefresh: () => void;
  /** Wie der Hinweistext aus ModelChoice dargestellt wird. "desc" (Vorgabe) schreibt ihn als
   *  Beschreibung unter die Zeile; "tooltip" hängt ihn an den „Modelle abrufen"-Knopf — nötig in
   *  den Endpunkt-Zeilen, die bewusst keinen Zeilentext tragen (siehe Kommentar in
   *  buildEndpointList), UND weil das Steuerelement selbst im Modus "locked" disabled ist (ein
   *  Tooltip darauf käme in Chromium nie an — deaktivierte Controls bekommen keine Pointer-Events). */
  hintAs?: "desc" | "tooltip";
  /** Wohin gezeichnet wird statt in `setting.controlEl` selbst (optional). Nötig, wenn der Picker
   *  asynchron nach bereits gezeichneten Geschwistern (Mülleimer, Warn-Icon) in dieselbe Zeile
   *  soll — Obsidians `add*`-Methoden hängen sonst immer ans Ende von `controlEl` an, unabhängig
   *  von der Aufrufreihenfolge im Code (siehe buildEndpointList). */
  target?: HTMLElement;
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
  /** Modell-Listen je Endpunkt, Schlüssel = normalizeEndpoint(url).
   *  Überlebt bewusst refreshUi(): der Tab wird bei JEDEM URL-Commit neu gebaut, und
   *  reconnect() pingt dabei jeden Endpunkt (bis 5 s). Ohne Cache zöge jedes Tippen an
   *  einer URL sämtliche Modell-Listen erneut. Stirbt in hide(). */
  private modelLists = new Map<string, Promise<{ models: string[]; reachable: boolean }>>();
  /** Läuft parallel zu jeder listen-FORMändernden Mutation hoch. Eine Antwort, die zu einer
   *  alten Generation gehört, wird verworfen — sonst schriebe eine langsame Antwort (z.B.
   *  LM-Studio-Timeout, danach schnelles Ollama) in eine Zeile, die inzwischen einen anderen
   *  Endpunkt zeigt. */
  private modelListGeneration = 0;

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

  /** Holt die Modell-Liste eines Endpunkts (mit Cache). Sparsam: eine nicht leere Liste
   *  beweist die Erreichbarkeit bereits — nur bei leerer Liste wird zusätzlich geprobt, um
   *  „offline" von „gibt keine Liste heraus" zu trennen. */
  private loadModelList(
    key: string,
    client: { listModels(): Promise<string[]>; probe(): Promise<EndpointStatus> } | undefined,
  ): Promise<{ models: string[]; reachable: boolean }> {
    const cached = this.modelLists.get(key);
    if (cached) return cached;

    // Cache das Promise selbst vor dem ersten await — gleichzeitige Aufrufer wartet auf
    // dieselbe Anfrage statt je einen HTTP-Request zu starten.
    let promise: Promise<{ models: string[]; reachable: boolean }>;

    if (!client) {
      // Absicherung, kein Produktivpfad: main.ts hält embedder/chatClient immer gesetzt, sobald
      // das Plugin geladen ist. Dieser Zweig ist nur aus Tests erreichbar (Client fehlt dort
      // bewusst) und liefert dann einen Offline-Zustand statt zu werfen.
      promise = Promise.resolve({ models: [], reachable: false });
    } else {
      // Client vorhanden: starte die Anfrage und löse bei Fehler den Cache-Eintrag auf.
      promise = (async () => {
        const models = await client.listModels();
        const reachable = models.length > 0 ? true : (await client.probe()).reachable;
        return { models, reachable };
      })().catch(() => {
        // Nur den eigenen Eintrag verwerfen: lief zwischen Start und Fehlschlag bereits ein
        // invalidateModelList + neuer loadModelList, steht unter `key` schon ein anderes
        // (neueres) Promise — das darf dieser Zweig nicht mitreißen, sonst kostet es nur eine
        // überflüssige Anfrage statt einer falschen. listModels()/probe() fangen Fehler ohnehin
        // schon selbst ab; dies hier ist reines Rückfallnetz für andere Fehlschläge.
        if (this.modelLists.get(key) === promise) this.modelLists.delete(key);
        return { models: [], reachable: false };
      });
    }

    this.modelLists.set(key, promise);
    return promise;
  }

  /** Verwirft einen Cache-Eintrag. Nötig nach „Modelle abrufen" und nach jedem
   *  apiKey-Commit: vorher lieferte der Endpunkt vermutlich 401 und damit eine leere Liste. */
  private invalidateModelList(key: string): void {
    this.modelLists.delete(key);
  }

  /** Zeichnet die Modell-Auswahl in eine bestehende Setting-Zeile. Kennt die Regeln nicht —
   *  die stehen in resolveModelChoice (model_choice.ts). */
  private renderModelPicker(opts: ModelPickerOpts): void {
    const { setting: s, choice, target } = opts;
    const hintAs = opts.hintAs ?? "desc";
    if (choice.hint && hintAs === "desc") s.setDesc(choice.hint);

    if (choice.mode === "freetext") {
      s.addText(t => {
        t.setPlaceholder(opts.placeholder).setValue(choice.value);
        t.inputEl.setAttribute("aria-label", opts.ariaLabel);
        t.inputEl.addEventListener("blur", () => { opts.onPick(t.getValue().trim()); });
        target?.appendChild(t.inputEl);
      });
    } else {
      s.addDropdown(d => {
        for (const o of choice.options) d.addOption(o.value, o.label);
        d.setValue(choice.value);
        d.selectEl.setAttribute("aria-label", opts.ariaLabel);
        if (choice.mode === "locked") d.setDisabled(true);
        else d.onChange((v: string) => { opts.onPick(v); });
        target?.appendChild(d.selectEl);
      });
    }

    // „Modelle abrufen" zeichnet IMMER, in allen drei Modi — auch im Regelfall (dropdown), sonst
    // lässt sich eine frisch installierte Modell-Liste nicht auffrischen, ohne die Einstellungen
    // neu zu öffnen. Er ist außerdem der Träger des Hinweistexts bei hintAs "tooltip": er ist als
    // einziges Element in jedem Modus nie disabled (anders als das <select> im Modus "locked"),
    // ein Tooltip landet dort also zuverlässig. Der eigene Zweck bleibt erhalten — der Hinweis wird
    // an den Button-Tooltip angehängt, nicht dessen Ersatz.
    s.addExtraButton(b => {
      const tooltip = choice.hint && hintAs === "tooltip"
        ? `${choice.hint} · ${t("settings.button.fetchModels")}`
        : t("settings.button.fetchModels");
      b.setIcon("refresh-cw").setTooltip(tooltip).onClick(() => { opts.onRefresh(); });
      target?.appendChild(b.extraSettingsEl);
    });
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
      { name: t("settings.embeddingModel.name"), desc: t("settings.embeddingModel.desc"), render: this.renderEmbeddingModel },
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

  /** Chat-Gruppe: Endpunkte/Modell/Modelldetails/Fähigkeiten/Budget bleiben render-Hatches
   *  (Cross-Referenzen über lastCaps/infoValue/capSetting, Budget-Max ans Modell-Fenster
   *  gekoppelt). „Thinking testen“ war ein Button IN der Toggle-Zeile — jetzt eigene
   *  Action-Zeile, das Toggle selbst ist deklarativ. */
  private chatGroup(): SettingDefinitionGroup {
    return { type: "group", heading: t("settings.chat.group"), items: [
      { name: t("settings.chatEndpoints.label"), desc: "", render: this.renderChatEndpoints },
      { name: t("settings.chatModel.name"), desc: t("settings.chatModel.desc"), render: this.renderChatModel },
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
    this.buildEndpointList({
      containerEl: host,
      label: t("settings.embeddingEndpoints.label"),
      desc: t("settings.embeddingEndpoints.desc"),
      placeholder: "http://localhost:11434",   // i18n-exempt: URL-Beispiel, sprachneutral
      get: () => this.plugin.settings.embeddingEndpoints,
      set: (eps) => { this.plugin.settings.embeddingEndpoints = eps; },
      active: () => this.plugin.activeEmbeddingEndpoint,
      clientFor: (cfg) => new EmbeddingClient(cfg.url, effectiveModel(cfg, this.plugin.settings.embeddingModel), cfg.apiKey),
      globalModel: () => this.plugin.settings.embeddingModel,
      modelFits: (cfg) => embeddingModelMatchesIndex(
        effectiveModel(cfg, this.plugin.settings.embeddingModel),
        this.plugin.indexEmbeddingModel,
      ),
      reconnect: () => this.plugin.resolveAndReconnectEmbedder(),
    });
  };

  /** render-Hatch: Embedding-Modell. Zeichnet über den gemeinsamen Picker. */
  private renderEmbeddingModel = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.embeddingModel.name")).setDesc(t("settings.embeddingModel.desc"));
    const key = this.plugin.activeEmbeddingEndpoint ?? "";
    const gen = this.modelListGeneration;
    void this.loadModelList(key, this.plugin.embedder).then(({ models, reachable }) => {
      if (gen !== this.modelListGeneration) return;   // verspätete Antwort — Zeile ist tot
      this.renderModelPicker({
        setting: s,
        choice: resolveModelChoice({
          reachable, models, current: this.plugin.settings.embeddingModel, allowEmpty: false,
        }),
        ariaLabel: t("settings.embeddingModel.name"),
        placeholder: "qwen3-embedding:8b",   // i18n-exempt: Modellname-Beispiel, sprachneutral
        onPick: (v: string) => {
          this.plugin.settings.embeddingModel = v;
          void this.plugin.saveSettings();
          void this.plugin.resolveAndReconnectEmbedder();
        },
        onRefresh: () => { this.invalidateModelList(key); this.refreshUi(); },
      });
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

    const detail = this.plugin.mcpStartError();
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
        for (const c of MCP_CLIENTS) d.addOption(c.id, c.label);
        d.setValue(this.mcpClient);
        d.onChange((v: string) => { this.mcpClient = v as McpClientId; this.refreshUi(); });
      })
      .addButton(b => b.setButtonText(t("settings.button.copy"))
        .onClick(() => {
          void navigator.clipboard.writeText(buildClientSnippet(this.mcpClient, { url, token }));
          new Notice(t("settings.mcpConfigCopied"));
        }));

    const pre = containerEl.createEl("pre", { cls: "vault-rag-mcp-snippet" });
    pre.setText(buildClientSnippet(this.mcpClient, { url, token: maskToken(token) }));
  };

  /** render-Hatch: Chat-Endpunkt-Liste. Zeichnet in settingBodyHost über buildEndpointList. */
  private renderChatEndpoints = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    this.buildEndpointList({
      containerEl: host,
      label: t("settings.chatEndpoints.label"),
      desc: t("settings.chatEndpoints.desc"),
      placeholder: "http://localhost:1234",   // i18n-exempt: URL-Beispiel, sprachneutral
      get: () => this.plugin.settings.chatEndpoints,
      set: (eps) => { this.plugin.settings.chatEndpoints = eps; },
      active: () => this.plugin.activeChatEndpoint,
      clientFor: (cfg) => new ChatClient(cfg.url, effectiveModel(cfg, this.plugin.settings.chatModel), cfg.apiKey),
      globalModel: () => this.plugin.settings.chatModel,
      reconnect: () => this.plugin.resolveAndReconnectChat(),
    });
  };

  /** render-Hatch: Chat-Modell. Löst zusätzlich showInfo/showCaps aus — die schreiben in
   *  infoValue/lastCaps, gelesen von den render-Hatches Modelldetails/Fähigkeiten
   *  (Cross-Referenz über Render-State, kein direkter Aufruf). */
  private renderChatModel = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.chatModel.name")).setDesc(t("settings.chatModel.desc"));
    const key = this.plugin.activeChatEndpoint ?? "";
    const gen = this.modelListGeneration;
    void this.loadModelList(key, this.plugin.chatClient).then(({ models, reachable }) => {
      // Modelldetails/Fähigkeiten sind eigene Zeilen und laut Plan unabhängig von der
      // Modell-Auswahl-Zeile selbst — sie laufen deshalb VOR dem Generations-Guard, sonst
      // blieben beide Zeilen bei einer verworfenen Generation leer statt sich zu befüllen.
      this.showInfo(this.plugin.settings.chatModel);
      this.showCaps(this.plugin.settings.chatModel);
      if (gen !== this.modelListGeneration) return;
      this.renderModelPicker({
        setting: s,
        choice: resolveModelChoice({
          reachable, models, current: this.plugin.settings.chatModel, allowEmpty: false,
        }),
        ariaLabel: t("settings.chatModel.name"),
        placeholder: "qwen3",   // i18n-exempt: Modellname-Beispiel, sprachneutral
        onPick: (v: string) => {
          this.plugin.settings.chatModel = v;
          void this.plugin.saveSettings();
          void this.plugin.resolveAndReconnectChat();
          this.showInfo(v);
          this.showCaps(v);
        },
        onRefresh: () => { this.invalidateModelList(key); this.refreshUi(); },
      });
    });
  };

  /** render-Hatch: Modelldetails-Zeile. Setzt infoValue, das showInfo() (aus renderChatModel)
   *  asynchron befüllt. */
  private renderModelDetails = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.modelDetails.name"));
    this.infoValue = s.controlEl.createSpan({ cls: "vault-rag-info-value", text: t("settings.loadingPlaceholder") });
  };

  /** render-Hatch: Fähigkeiten-Zeile. Setzt capSetting, das showCaps() (renderChatModel) und
   *  runThinkingTest() bei einer Caps-Upgrade re-rendern. */
  private renderCapsRow = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.capabilities.name"));
    this.capSetting = s;
    this.renderCaps(s, this.lastCaps);
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
        sl.setLimits(2000, 32000, 1000).setValue(this.plugin.settings.contextCharBudget)          .onChange(async (v: number) => {
            this.plugin.settings.contextCharBudget = v;
            s.setName(t("settings.contextBudget.name", v.toLocaleString()));
            await this.plugin.saveSettings();
          });
        // Sobald das Modell-Fenster bekannt ist (showInfo): Slider-Max daran koppeln + Wert klemmen.
        this.updateBudgetMax = (maxChars: number): void => {
          const max = Math.max(8000, Math.round(maxChars / 1000) * 1000);
          sl.setLimits(2000, max, 1000);
          const val = Math.min(this.plugin.settings.contextCharBudget, max);
          sl.setValue(val);
          s.setName(t("settings.contextBudget.nameWithMax", val.toLocaleString(), max.toLocaleString()));
          if (val !== this.plugin.settings.contextCharBudget) {
            this.plugin.settings.contextCharBudget = val;   // nur bei echter Klemmung schreiben
            void this.plugin.saveSettings();
          }
        };
      });
  };

  /** render-Hatch: Smart-Apply-Modell. Der leere Wert ist bedeutungstragend
   *  (= Chat-Modell erben), deshalb allowEmpty. */
  private renderSmartApplyModel = (setting: Setting): void => {
    const host = settingBodyHost(setting);
    const s = new Setting(host).setName(t("settings.smartApplyModel.name"))
      .setDesc(t("settings.smartApplyModel.desc"));
    const key = this.plugin.activeChatEndpoint ?? "";
    const gen = this.modelListGeneration;
    void this.loadModelList(key, this.plugin.chatClient).then(({ models, reachable }) => {
      if (gen !== this.modelListGeneration) return;
      this.renderModelPicker({
        setting: s,
        choice: resolveModelChoice({
          reachable, models, current: this.plugin.settings.smartApplyModel,
          allowEmpty: true, emptyLabel: t("settings.smartApplyModel.emptyLabel"),
        }),
        ariaLabel: t("settings.smartApplyModel.name"),
        placeholder: t("settings.smartApplyModel.placeholder"),
        onPick: (v: string) => {
          this.plugin.settings.smartApplyModel = v;
          void this.plugin.saveSettings();
        },
        onRefresh: () => { this.invalidateModelList(key); this.refreshUi(); },
      });
    });
  };

  /** Body des früheren „Testen“-Buttons aus buildThinking (das Toggle daneben ist jetzt
   *  deklarativ). Ohne Button-Disable-Handling — Rückmeldung nur noch über Notice. Bei
   *  bestätigtem Thinking-Nachweis: Caps hochstufen + Fähigkeiten-Zeile neu zeichnen. */
  private async runThinkingTest(): Promise<void> {
    // Getestet wird das Modell, das eine echte Anfrage bekäme — bei aktivem Endpunkt mit
    // Zeilen-Override ist das nicht `settings.chatModel`, und ein Test gegen den anderen
    // Namen liefe ins Leere („Endpoint nicht erreichbar" statt eines Thinking-Befunds).
    const model = this.plugin.chatModelInUse;
    if (isAlwaysOnThinker(model)) { new Notice(t("settings.thinkerAlwaysOn")); return; }
    try {
      const res = await this.plugin.chatClient.stream(
        [{ role: "user", content: t("settings.thinkingTest.prompt") }],
        () => {}, () => {}, undefined, { model, suppressThinking: true });
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
    this.modelLists.clear();
    super.hide();
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Geordneter Endpunkt-Fallback-Listen-Editor (für Embedding wie Chat identisch).
   *  Rendert `[...endpoints, Adder]` (leeres Add-Feld), Label/Desc nur in Zeile 0. Mutation NUR
   *  bei blur (nicht pro Tastendruck), via applyEndpointEdit → saveSettings → reconnect → Re-Render.
   *  Pro echtem Eintrag: Status-Icon (loader → check/x, aktiver Endpunkt markiert), URL-,
   *  Schlüssel- (maskiert) und Modell-Feld + Mülleimer. */
  private buildEndpointList(opts: {
    containerEl: HTMLElement;
    label: string; desc: string; placeholder: string;
    get: () => EndpointConfig[]; set: (eps: EndpointConfig[]) => void;
    active: () => string | null;
    /** Client GENAU dieser Zeile (URL + Schlüssel der Zeile) — trägt sowohl die Erreichbarkeits-
     *  Probe (Status-Icon) als auch die Modell-Liste (Dropdown). EIN Client statt zwei getrennt
     *  parametrierten Konstruktionen, damit Status-Icon und Modell-Liste nie über dieselbe Zeile
     *  auseinanderlaufen können. */
    clientFor: (cfg: EndpointConfig) => { listModels(): Promise<string[]>; probe(): Promise<EndpointStatus> };
    /** Globales Modell, das gilt, wenn die Zeile keinen Override trägt. */
    globalModel: () => string;
    /** Nur Embedding-Listen: passt das (Override-)Modell dieser Zeile zum geladenen Index?
     *  Fehlt der Callback (Chat-Liste), gilt true — dort hängt kein Index am Modell. */
    modelFits?: (cfg: EndpointConfig) => boolean;
    reconnect: () => Promise<void>;
  }): void {
    const eps = opts.get();
    const rows: EndpointConfig[] = [...eps, { url: "" }];   // leeres Zusatzfeld am Ende
    // Jede Mutation, die die Listen-FORM ändert (URL-Edit, Mülleimer, Preset), macht die
    // gerenderten Zeilen-Indizes stale — bis der Re-Render kommt, wäre ein blur in einer anderen
    // Zeile auf den falschen Eintrag gebucht (im schlimmsten Fall ein Anbieter-Schlüssel am
    // falschen Host). Darum: Zeilen sofort sperren, das Re-Render entsperrt durch Neuaufbau.
    /** Sperr-ZUSTAND des Containers. Die Klasse sperrt auch die Icon-Buttons (Obsidian rendert sie
     *  als div, das kein `disabled` kennt), `aria-busy` sagt es Screenreadern. */
    const setLockState = (locked: boolean): void => {
      if (locked) opts.containerEl.addClass("vault-rag-ep-busy");
      else opts.containerEl.removeClass("vault-rag-ep-busy");
      opts.containerEl.setAttribute("aria-busy", locked ? "true" : "false");  // "false" = gültiger ARIA-Ruhezustand
    };
    const setRowsDisabled = (disabled: boolean): void => {
      opts.containerEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")
        .forEach(el => { el.disabled = disabled; });
    };
    const lockRows = (): void => {
      this.modelListGeneration++;
      setLockState(true);
      setRowsDisabled(true);
    };
    // Idempotente Freigabe beim Betreten: Klasse und aria-busy überleben sonst den 1.13-Pfad —
    // refreshUi() geht dort über update(), und settingBodyHost leert zwar die Kinder des Containers, aber
    // nicht seine Klassen/Attribute. Ohne das bliebe die Liste dauerhaft pointer-events: none.
    // Nur der Zustand: die Zeilen entstehen erst darunter, es gibt hier noch nichts zu entsperren.
    setLockState(false);
    // Rettungsnetz: eine gescheiterte Kette (saveData, reconnect) darf die UI nicht verriegelt
    // zurücklassen. Bewusst ohne Fehlerdetails in Log/Notice — hier hängen Anbieter-Schlüssel dran.
    const failSafe = (): void => {
      setLockState(false);
      setRowsDisabled(false);
      new Notice(t("settings.endpointSaveFailed"), 8000);
      // Re-Render statt bloßem Entsperren: bei einer gescheiterten Kette hat opts.set(...) die
      // Settings im Speicher bereits mutiert, bevor saveSettings()/reconnect() geworfen hat — ohne
      // Rebuild zeigt das DOM weiter die alte Reihenfolge/Indizes, und der nächste Klick auf
      // Mülleimer/„zuerst verwenden" träfe den falschen Eintrag.
      this.refreshUi();
    };
    // Beschriftung + Erklärung als EIGENE Zeile ohne Steuerelemente. Vorher hingen sie an der
    // ersten Endpunkt-Zeile — Obsidians `Setting` teilt die Zeile in Info (links) und Controls
    // (rechts), und mit drei Feldern rechts blieb der Text auf eine unlesbare Buchstabensäule
    // gequetscht (gemeldet 2026-08-04). Die Zeilen selbst tragen deshalb keinen Text mehr und
    // bekommen über `vault-rag-ep-row` die volle Breite für ihre Felder.
    new Setting(opts.containerEl).setName(opts.label).setDesc(opts.desc);

    rows.forEach((cfg, i) => {
      const isAdder = i >= eps.length;
      const s = new Setting(opts.containerEl);
      s.settingEl.addClass("vault-rag-ep-row");
      const statusIcon = s.controlEl.createSpan({ cls: "vault-rag-ep-status" });
      // Drittanbieter-Hinweis: in-place umschaltbar, NICHT nur einmal beim Zeilen-Render gebaut —
      // der apiKey-Commit unten baut den Tab bewusst nicht neu (siehe dort), also muss dieses Icon
      // sich selbst zeigen/verstecken können, sonst bleibt der Nutzer genau im Moment, in dem er den
      // Schlüssel einträgt, ohne Hinweis. Eine Wahrheit (`carriesApiKey`), zwei Aufrufzeitpunkte
      // (Erst-Render unten + apiKey-Commit) statt einer zweiten Bedingung.
      let thirdPartyIcon: HTMLSpanElement | null = null;
      const syncThirdPartyIcon = (hasKey: boolean): void => {
        if (hasKey) {
          if (thirdPartyIcon) return;   // schon da — nicht doppelt anlegen
          thirdPartyIcon = s.controlEl.createSpan({ cls: "vault-rag-ep-thirdparty" });
          setIcon(thirdPartyIcon, "alert-triangle");
          setTooltip(thirdPartyIcon, t("settings.endpoint.keyWarning"));
        } else if (thirdPartyIcon) {
          thirdPartyIcon.remove();
          thirdPartyIcon = null;
        }
      };
      /** Schreibt die Rollen-Zeile neu, ohne den Tab neu aufzubauen. Wird vom probe-Block
       *  unten gesetzt (vorher gibt es keine Zeile) und beim Modell-Commit aufgerufen —
       *  das Modell-Override entscheidet über `skipped-model`, ändert die Listen-FORM aber
       *  nicht, löst also bewusst kein `refreshUi()` aus. Ohne diesen Rückruf behielte die
       *  Zeile ihre Aussage von vor der Modellwahl: ein Endpunkt, den der Guard längst
       *  überspringt, meldete weiter „erreichbar, aber Platz N" (gemeldet 2026-08-05). */
      let syncRoleLine: (() => void) | null = null;
      // Listen-Mutation NUR bei blur, NICHT in onChange: onChange feuert pro Tastendruck und
      // würde im Add-Feld jeden Zwischenstand (h, ht, htt, …) als eigenen Eintrag anhängen.
      // Nur URL-Änderungen rendern neu (Statuszeile hängt an der URL). Schlüssel/Modell tun das
      // NICHT: refreshUi baut den Tab komplett neu auf, und da reconnect() jeden Endpunkt pingt
      // (bis 5 s), risse es dem Nutzer sonst mitten im Tippen des nächsten Feldes das DOM weg.
      const commit = (field: "url" | "apiKey" | "model", value: string): void => {
        const before = opts.get();
        const updated = applyEndpointEdit(before, i, field, value, isAdder);
        if (JSON.stringify(updated) === JSON.stringify(before)) return;   // unverändert → kein Re-Render
        const rerender = field === "url";
        if (rerender) lockRows();
        // apiKey ändert die Listen-FORM nicht (kein Re-Render) — das Drittanbieter-Icon muss sich
        // deshalb hier selbst aktualisieren, statt auf den (bewusst ausbleibenden) Neuaufbau zu warten.
        if (field === "apiKey") {
          syncThirdPartyIcon(carriesApiKey(updated[i]));
          // Ohne Schlüssel lieferte der Endpunkt vermutlich 401 → leere Liste → Notausgang.
          // Mit Schlüssel hat er eine Liste; der alte Eintrag wäre eine Lüge. Anders als das
          // Drittanbieter-Icon oben korrigiert sich die Modell-Zeile dadurch NICHT selbst —
          // sichtbar wird die neue Liste erst beim nächsten Zeilen-Neuaufbau (URL-Commit,
          // „Modelle abrufen", Tab-Reload), da dieser Commit bewusst kein refreshUi() auslöst.
          this.invalidateModelList(normalizeEndpoint(updated[i].url));
        }
        opts.set(updated);
        const chain = this.plugin.saveSettings().then(() => opts.reconnect());
        // Das Modell-Override entscheidet mit über die Rolle der Zeile (`skipped-model`).
        // Erst NACH reconnect() nachziehen: der Resolver kann den Endpunkt wegen des neuen
        // Modells gerade fallengelassen oder übernommen haben, und die Zeile soll den
        // Zustand danach zeigen, nicht den davor.
        const withRoleSync = field === "model" ? chain.then(() => { syncRoleLine?.(); }) : chain;
        void (rerender ? withRoleSync.then(() => this.refreshUi()) : withRoleSync).catch(failSafe);
      };
      s.addText(tx => {
        tx.setPlaceholder(isAdder ? t("settings.endpoint.addPlaceholder") : opts.placeholder).setValue(cfg.url);
        tx.inputEl.setAttribute("aria-label", isAdder ? t("settings.endpointRow.ariaAdd", opts.label) : t("settings.endpointRow.ariaUrl", opts.label));
        tx.inputEl.addEventListener("blur", () => { commit("url", tx.getValue()); });
      });
      // Schlüssel + Modell nur an bestehenden Einträgen — am leeren Adder gäbe es nichts zu tragen.
      // aria-label statt bloßem Placeholder: der verschwindet beim Tippen, und drei unbeschriftete
      // Felder in einer Zeile sind für Screenreader nicht auseinanderzuhalten.
      if (!isAdder) {
        s.addText(tx => {
          tx.setPlaceholder(t("settings.endpoint.keyPlaceholder")).setValue(cfg.apiKey ?? "");
          tx.inputEl.type = "password";                    // maskiert gegen Schultergucken/Screenshots
          tx.inputEl.setAttribute("autocomplete", "off");
          tx.inputEl.setAttribute("aria-label", t("settings.endpoint.keyAria", cfg.url));
          tx.inputEl.addEventListener("blur", () => { commit("apiKey", tx.getValue()); });
        });
        // Modell-Override: Dropdown mit den Modellen GENAU DIESES Endpunkts. Die Liste kommt
        // aus dem Tab-Cache (loadModelList), nicht vom aktiven Client — eine Zeile kann einen
        // ganz anderen Anbieter meinen als den gerade verbundenen.
        // Platz SYNCHRON reservieren: der Picker zeichnet erst nach dem geladenen Promise, der
        // Mülleimer/das Warn-Icon gleich darunter aber synchron. Ohne Reservierung hängt Obsidian
        // (das jede add*-Komponente in Aufrufreihenfolge an controlEl anhängt) das Dropdown ans
        // Ende der Zeile — hinter den Mülleimer, ein Layout-Sprung inklusive. `renderModelPicker`
        // zeichnet über `target` deshalb direkt in dieses Element statt in `s.controlEl`.
        const modelSlot = s.controlEl.createSpan({ cls: "vault-rag-model-slot" });
        const listKey = normalizeEndpoint(cfg.url);
        const gen = this.modelListGeneration;
        void this.loadModelList(listKey, opts.clientFor(cfg)).then(({ models, reachable }) => {
          if (gen !== this.modelListGeneration) return;   // Liste hat sich verschoben
          this.renderModelPicker({
            setting: s,
            target: modelSlot,
            choice: resolveModelChoice({
              reachable, models, current: cfg.model ?? "",
              allowEmpty: true, emptyLabel: t("settings.endpoint.emptyModelLabel", opts.globalModel() || t("settings.endpoint.notSet")),
            }),
            ariaLabel: t("settings.endpoint.modelAria", cfg.url),
            placeholder: t("settings.endpoint.modelPlaceholder"),
            onPick: (v: string) => { commit("model", v); },
            onRefresh: () => { this.invalidateModelList(listKey); this.refreshUi(); },
            hintAs: "tooltip",
          });
        });
      }
      // „Zuerst verwenden": setzt die Zeile an die Spitze der Prioritätsliste. An Platz 1
      // bewusst GAR NICHT gezeichnet statt deaktiviert — ein setDisabled-Element trägt seinen
      // Tooltip in Electron unsichtbar (Befund aus dem Modell-Picker-Review 2026-08-05), der
      // Knopf wäre dort also stumm UND wirkungslos.
      if (!isAdder && i > 0) {
        s.addExtraButton(b => b
          .setIcon("arrow-up-to-line")
          .setTooltip(t("settings.endpoint.moveToFrontTooltip"))
          .onClick(() => {
            lockRows();
            opts.set(moveEndpointToFront(opts.get(), i));
            void this.plugin.saveSettings()
              .then(() => opts.reconnect())
              .then(() => this.refreshUi())
              .catch(failSafe);
          }));
      }
      // Löschen: expliziter Mülleimer-Button (nicht am leeren Add-Feld). Das Status-Icon links
      // ist nur Erreichbarkeits-Anzeige, kein Lösch-Button.
      if (!isAdder) {
        s.addExtraButton(b => b
          .setIcon("trash-2")
          .setTooltip(t("settings.endpoint.removeTooltip"))
          .onClick(() => {
            lockRows();
            opts.set(applyEndpointEdit(opts.get(), i, "url", "", false));
            void this.plugin.saveSettings()
              .then(() => opts.reconnect())
              .then(() => this.refreshUi())
              .catch(failSafe);
          }));
      }
      // Pro-Feld-Status in A11y-Form (Form + Text + Farbe): loader → check/x, aktiver markiert.
      const ep = cfg.url.trim();
      if (!isAdder && ep) {
        setIcon(statusIcon, "loader"); setTooltip(statusIcon, t("settings.conn.checking"));
        // Rolle der Zeile als eigene Zeile UNTER den Feldern (flex-basis 100% im umbrechenden
        // Control-Container): horizontal ist die Zeile mit drei Feldern + bis zu drei Icons +
        // zwei Knöpfen ausgereizt (Layout-Fix 2026-08-04). Synchron angelegt, asynchron befüllt.
        const stateEl = s.controlEl.createDiv({ cls: "vault-rag-ep-state", text: t("settings.conn.checking") });
        // Erreichbarkeit ändert sich nur durch eine neue Probe, die Rolle aber auch durch das
        // Modell-Override. Das Probe-Ergebnis wird deshalb festgehalten, damit die Rolle ohne
        // erneuten Netzzugriff nachgezogen werden kann.
        let probed: EndpointStatus | null = null;
        const applyRole = (): void => {
          if (!probed) return;
          const isActive = normalizeEndpoint(ep) === (opts.active() ?? "");
          // Den Eintrag frisch aus der Liste lesen, nicht das `cfg` vom Render-Zeitpunkt:
          // nach einem Modell-Commit trägt nur die Liste den neuen Wert.
          const current = opts.get()[i] ?? cfg;
          const role = endpointRole({
            isActive,
            reachable: probed.reachable,
            // Gilt nur für Embedding-Endpunkte; für Chat hängt kein Index am Modell (immer true).
            modelFits: opts.modelFits?.(current) ?? true,
            position: i + 1,
          });
          stateEl.setText(describeEndpointRole(role));
          stateEl.toggleClass("is-active", role.kind === "active");
        };
        syncRoleLine = applyRole;
        void opts.clientFor(cfg).probe().then(status => {
          statusIcon.empty();
          setIcon(statusIcon, status.reachable ? "circle-check" : "circle-x");
          statusIcon.toggleClass("is-ok", status.reachable);
          statusIcon.toggleClass("is-error", !status.reachable);
          // Tooltip trägt nur noch die Erreichbarkeits-Diagnose; das frühere " · aktiv" entfällt,
          // weil die Rolle jetzt als Text in der Zeile steht (keine zweite Wahrheit im Hover).
          setTooltip(statusIcon, status.klartext);
          probed = status;
          applyRole();
        });
        // Eingabe-Prüfung: nicht-blockierendes Warn-Icon (WCAG-Form + Tooltip)
        const warnings = validateEndpointInput(ep);
        if (warnings.length) {
          const warnIcon = s.controlEl.createSpan({ cls: "vault-rag-ep-warn" });
          setIcon(warnIcon, "alert-triangle");
          setTooltip(warnIcon, warnings.map(w => w.message).join(" · "));
        }
        // Drittanbieter-Hinweis (Erst-Render): der Schlüssel ist der verlässliche Indikator, nicht
        // die URL (ein eigener Server im LAN braucht keinen — eine URL-Heuristik wäre unzuverlässig).
        // Sachlicher Hinweis, keine Warnung vor einem Fehler — Form/Icon + Text, nie Farbe allein
        // (WCAG 1.4.1); NIE den Schlüssel selbst im Text/Tooltip. syncThirdPartyIcon() hält das
        // danach auch beim apiKey-Commit aktuell (siehe dort), ohne den Tab neu zu bauen.
        syncThirdPartyIcon(carriesApiKey(cfg));
      }
    });
    const actions = new Setting(opts.containerEl);
    ENDPOINT_PRESETS.forEach(preset => {
      actions.addButton(b => b
        .setButtonText(`+ ${preset.label}`)
        .setTooltip(t("settings.endpoint.addPreset", preset.url))
        .onClick(() => {
          const cur = opts.get();
          if (cur.some(c => c.url === preset.url)) return;   // schon in der Liste — kein Duplikat anhängen
          lockRows();
          opts.set(applyEndpointEdit(cur, cur.length, "url", preset.url, true));
          void this.plugin.saveSettings()
            .then(() => opts.reconnect())
            .then(() => this.refreshUi())
            .catch(failSafe);
        }));
    });
    actions.addButton(b => b.setButtonText(t("settings.button.checkConnection")).onClick(() => this.refreshUi()));
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
