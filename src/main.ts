import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Notice, Platform, normalizePath, requestUrl, Editor, EditorPosition, MarkdownView } from "obsidian";
import { VaultIndex } from "./index";
import { Hit } from "./retriever";
import { RelatedPanel, VIEW_TYPE_RELATED } from "./view";
import { DEFAULT_SETTINGS, VaultRagSettings, VaultRagSettingTab, RestoreBackupModal } from "./settings";
// Endpunkt-Wahrheit direkt aus dem puren Modul, nicht durch das obsidian-gekoppelte ./settings.
import { chatRequestModel, effectiveModel, migrateEndpointList, type EndpointConfig } from "./endpoint_config";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { mergeSettings } from "./vendor/kit/settings";
import { EmbeddingClient } from "./embedder";
import { LiveIndexer } from "./live_indexer";
import { PendingQueue } from "./pending_queue";
import { SearchPanel, VIEW_TYPE_SEARCH, SearchResult } from "./search_view";
import { ChatClient } from "./chat_client";
import { buildContext } from "./context_source";
import { pickNote } from "./note_picker";
import { ChatSession } from "./chat_session";
import { ChatPanel, VIEW_TYPE_CHAT } from "./chat_view";
import { SmartApply, type ApplyProposal } from "./smart_apply";
import { SmartApplyPanel, VIEW_TYPE_SMART_APPLY } from "./smart_apply_view";
import { extractType, templateFilesUnder, parseTemplate } from "./template_matcher";
import type { ApplyMode } from "./note_restructurer";
import { TemplateRanker } from "./template_ranker";
import type { TemplateRank } from "./template_ranker";
import { buildHideCss, normalizeIndexDir } from "./index_dir";
import { migrateIndex, onlyContainsIndexFiles, hasAllRequiredFiles, INDEX_REQUIRED_FILES, removeDirDeep } from "./index_migrate";
import { BACKUP_SUBDIR, backupDirName, selectBackupsToDelete, sortBackupsNewestFirst, BackupEntry } from "./index_backup";
import { VaultRetrievalView, VIEW_TYPE_HUB } from "./hub_view";
import type { HubPanel, TabId } from "./hub_panel";
import { isSuspiciousShrink, PersistBlockedError, diffIndexVsVault, canPersistHealedIndex, embeddingModelMatchesIndex, assertModelSafeToPersist } from "./index_guard";
import { loadIndexStore, verifyBackupCandidate } from "./index_store";
import { CONTAINER_FILE, decodeContainer } from "./index_container";
import { McpTools } from "./mcp/tools";
import { generateToken } from "./mcp/auth";
import { pickTransform, promptInstruction } from "./reformat_picker";
import type { TransformDef } from "./reformat_transforms";
import { splitSelectionAffix } from "./reformat_mechanical";
import { ReformatPreviewModal } from "./reformat_preview_modal";
import { REFORMAT_MAX_TOKENS } from "./reformat_prompts";
import { ReformatReadiness, readinessMessage, canRun, isRangeStale } from "./reformat_selection_state";
import { ReformatPanel } from "./reformat_panel";
import { mapStartError, classifySelfCheck, type SelfCheckResult } from "./mcp/mcp_diagnostics";
import { indexDeltaReadout, computeIndexDelta, classifyChunkless, healResultMessage, splitHealTargets } from "./index_delta";
import type { McpServerHandle } from "./mcp/http_server";
import { RetrievalFacade } from "./retrieval_facade";

export interface EmbeddingProgress {
  isEmbedding: boolean;
  embeddedNotes: number;
  pendingNotes: number;
  /** Während eines Voll-Reindex: Fortschritt durch die Notiz-Liste; sonst null. */
  reindex: { done: number; total: number } | null;
}

/** Entprellung des selectionchange-Listeners: hoch genug gegen Tipp-Rauschen,
 *  niedrig genug, dass das Panel dem Markieren unmittelbar folgt. */
const SELECTION_DEBOUNCE_MS = 150;

export default class VaultRagPlugin extends Plugin {
  settings!: VaultRagSettings;
  private index: VaultIndex | null = null;
  private facade!: RetrievalFacade;
  private guardedRead: (rel: string) => Promise<string> = (p) => this.app.vault.adapter.read(p);
  private lastMtime = 0;
  embedder!: EmbeddingClient;
  chatClient!: ChatClient;
  activeEmbeddingEndpoint: string | null = null;
  activeChatEndpoint: string | null = null;
  /** Modell, mit dem der aktuelle `embedder` gebaut wurde (Endpunkt-Override oder global).
   *  Embedder und LiveIndexer/Manifest MÜSSEN immer dasselbe Modell nennen — sonst behauptet
   *  das Manifest einen Vektorraum, aus dem die Vektoren nicht stammen. */
  private embeddingModelInUse = "";
  /** Chat-Endpunkt, mit dem `chatClient` gebaut wurde — Quelle des Zeilen-Modell-Overrides.
   *  Anders als beim Embedder wird hier die Config statt eines fertigen Modellnamens gehalten:
   *  Smart Apply bringt ein eigenes Modellfeld mit, und nur `chatRequestModel` kennt die
   *  Vorrangregel zwischen beidem. */
  private chatEndpointInUse: EndpointConfig = { url: "" };
  /** Zuletzt gemeldete Modell-Guard-Übersprünge — verhindert Notice-Spam, weil
   *  `embedderReady()` den Resolver bei jedem fehlgeschlagenen Ping erneut anwirft. */
  private lastSkipNotice = "";
  private smartApply: SmartApply | null = null;
  private templateRanker?: TemplateRanker;
  private liveIndexer!: LiveIndexer;
  private pendingQueue!: PendingQueue;
  private debounceTimers = new Map<string, number>();
  embeddingProgress: EmbeddingProgress = {
    isEmbedding: false,
    embeddedNotes: 0,
    pendingNotes: 0,
    reindex: null,
  };
  private statusBarEl: HTMLElement | null = null;
  private hideStyleSheet: CSSStyleSheet | null = null;
  private isSwitchingIndexDir = false;
  private indexHealthy = true;
  /** Chunk-lose Notizen (leer / nur Frontmatter) — nie indexierbar, zählen nicht als fehlend.
   *  Bewusst NICHT persistiert: wird bei jedem loadIndex frisch klassifiziert (selbstheilend
   *  gegenüber extern geänderten Dateien) und in-Session von den Live-Handlern gepflegt. */
  private emptyNotePaths = new Set<string>();
  /** Auto-Heal höchstens einmal je Gefahrenzustand-Episode (Reset bei gesundem Load). */
  private autoHealAttempted = false;
  private indexOpChain: Promise<void> = Promise.resolve();
  private mcpServer: McpServerHandle | null = null;
  private mcpLastStartError: string | null = null;
  private mcpOpChain: Promise<void> = Promise.resolve();
  private lastCapture: { editor: Editor; path: string; from: EditorPosition; to: EditorPosition; text: string } | null = null;
  private lastReadiness: ReformatReadiness = { kind: "no-editor" };
  private selectionDebounce: number | null = null;
  private reformatPanel: ReformatPanel | null = null;

  /** Serialisiert mutierende Index-Operationen (mutate+build+persist), damit der persist-Guard
   *  nicht durch nebenläufige Events (z.B. Ordner-Bulk-Delete) fälschlich Shrink meldet und kein
   *  liveIndexer-Instanz-Swap mitten in einer Operation passiert. */
  private runIndexOp(fn: () => Promise<void>): Promise<void> {
    const next = this.indexOpChain.then(fn, fn);
    this.indexOpChain = next.catch(() => {});
    return next;
  }

  /** Serialisiert Start/Stop/Restart des MCP-Servers, damit ein Toggle+Port-Edit-Race
   *  (Settings-Tab) oder ein Restart mitten in einem Unload keine Handles doppelt bindet
   *  oder verwaist zurücklässt (analog runIndexOp). */
  private runMcpOp(fn: () => Promise<void>): Promise<void> {
    const next = this.mcpOpChain.then(fn, fn);
    this.mcpOpChain = next.catch(() => {});
    return next;
  }

  private openPath = (p: string): void => {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  };

  /** Liest den Editor-Zustand und schreibt Auswahl + Bereitschaft mit.
   *  Wichtig: liegt gerade KEIN Markdown-View vorn (z.B. weil der Fokus im Sidebar-Panel
   *  ist), bleibt der zuletzt gemerkte Stand stehen — genau dafür existiert die Mitschrift.
   *  `workspace.activeEditor` ist laut API in diesem Moment null. */
  private captureSelection(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    if (view.getMode() !== "source") {
      this.lastReadiness = { kind: "reading-mode" };
      this.lastCapture = null;
      return;
    }
    const file = view.file;
    if (!file) { this.lastReadiness = { kind: "no-editor" }; this.lastCapture = null; return; }
    const editor = view.editor;
    const text = editor.getSelection();
    if (!text.trim()) {
      this.lastReadiness = { kind: "no-selection" };
      this.lastCapture = null;
      return;
    }
    this.lastCapture = { editor, path: file.path, from: editor.getCursor("from"), to: editor.getCursor("to"), text };
    this.lastReadiness = { kind: "ready", text };
  }

  /** Gehört der gemerkte Editor noch zu einer offenen Markdown-Ansicht — mit derselben
   *  Datei und weiterhin im Bearbeiten-Modus? Der Editor allein genügt nicht: er gehört
   *  zur View, nicht zur Datei, und überlebt einen Notiz-Wechsel im selben Pane. */
  private captureIsLive(cap: NonNullable<typeof this.lastCapture>): boolean {
    return this.app.workspace.getLeavesOfType("markdown").some(leaf =>
      leaf.view instanceof MarkdownView
      && leaf.view.editor === cap.editor
      && leaf.view.getMode() === "source"
      && leaf.view.file?.path === cap.path);
  }

  /** Aktueller Bereitschaftszustand — vom Sidebar-Panel gelesen. */
  reformatReadiness(): ReformatReadiness {
    return this.lastReadiness;
  }

  async onload() {
    // Prä-0.19-data.json trägt die Endpunkte als blanke URL-Strings (und noch älter als
    // Einzelfeld) — hier ehrlich getypt, migriert wird gleich darunter.
    const loaded = await this.loadData() as (Omit<Partial<VaultRagSettings>, "embeddingEndpoints" | "chatEndpoints"> & {
      embeddingEndpoint?: string; chatEndpoint?: string;
      embeddingEndpoints?: (string | EndpointConfig)[]; chatEndpoints?: (string | EndpointConfig)[];
    }) | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, loaded as Partial<VaultRagSettings> | null);
    // Migration: alte Einzel-Endpoint-Settings und Prä-0.19-String-Listen → EndpointConfig-Listen.
    this.settings.embeddingEndpoints = migrateEndpointList(loaded?.embeddingEndpoint, loaded?.embeddingEndpoints);
    this.settings.chatEndpoints = migrateEndpointList(loaded?.chatEndpoint, loaded?.chatEndpoints);
    // Tiefe Kopie: die Default-Einträge sind jetzt veränderliche Objekte — eine flache Kopie
    // teilte sie mit DEFAULT_SETTINGS, und ein späteres `cfg.apiKey = …` schriebe ein Geheimnis
    // in die Modul-Defaults.
    if (!this.settings.embeddingEndpoints.length) this.settings.embeddingEndpoints = DEFAULT_SETTINGS.embeddingEndpoints.map(c => ({ ...c }));
    if (!this.settings.chatEndpoints.length) this.settings.chatEndpoints = DEFAULT_SETTINGS.chatEndpoints.map(c => ({ ...c }));
    // Synchron mit dem ersten Listen-Eintrag instanziieren, damit embedder/chatClient nie undefined
    // sind; das Auflösen des aktiven Endpoints folgt asynchron am Ende von onload.
    const e0 = this.settings.embeddingEndpoints[0] ?? { url: "" };
    const c0 = this.settings.chatEndpoints[0] ?? { url: "" };
    this.embeddingModelInUse = effectiveModel(e0, this.settings.embeddingModel);
    this.embedder = new EmbeddingClient(e0.url, this.embeddingModelInUse, e0.apiKey);
    this.chatEndpointInUse = c0;
    this.chatClient = new ChatClient(c0.url, this.chatModelInUse, c0.apiKey);
    // Embedder und LiveIndexer immer als Paar mit DEMSELBEN Modell bauen: der Resolver läuft
    // fire-and-forget am Ende von onload, der modify-Listener kann davor feuern.
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, this.settings.indexDir, this.embedder, this.embeddingModelInUse);
    this.pendingQueue = new PendingQueue(this.app.vault.adapter, this.settings.indexDir);
    this.facade = new RetrievalFacade({
      getIndex: () => this.index,
      embedderReady: () => this.embedderReady(),
      embed: (texts) => this.embedder.embed(texts),
      settings: () => ({ k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude }),
      readVault: (rel) => this.guardedRead(rel),
    });

    this.addSettingTab(new VaultRagSettingTab(this.app, this));

    // File-Events
    this.registerEvent(this.app.vault.on("modify", (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (file.extension !== "md") return;
      this.scheduleEmbed(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (file.extension !== "md") return;
      void this.handleDelete(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile)) return;
      if (file.extension !== "md") return;
      void this.handleRename(file.path, oldPath);
    }));

    await this.pendingQueue.load();
    await this.loadIndex();
    // Nur aus bekannt-gutem Kontext sichern (vgl. Fix 3 im Whole-Branch-Review): loadIndex selbst
    // snapshottet nicht mehr, damit ein Gefahrenzustand/Fremd-Shrink keinen Backup-Slot kapert.
    if (this.index && this.indexHealthy) void this.snapshotIndex();

    // Index-Refresh nach Sync (30s) + Pending-Drain (60s)
    this.registerInterval(window.setInterval(() => void this.maybeReload(), 30000));
    this.registerInterval(window.setInterval(() => void this.maybeDrainPending(), 60000));

    if (this.settings.smartApplyEnabled) {
      this.smartApply = new SmartApply(
        {
          read: (p) => this.app.vault.adapter.read(p),
          write: (p, data) => this.app.vault.adapter.write(p, data),
          listTemplates: async () =>
            templateFilesUnder(this.app.vault.getMarkdownFiles().map(f => f.path), this.settings.templateDir),
          typeOf: async (p) => extractType(await this.app.vault.adapter.read(p)),
          embed: async (t) => {
            const e = await this.facade.embedQuery(t);
            if (e.kind !== "vec") throw new Error("kein Index / Embedder offline");
            return e.vec;
          },
          // Weiterhin gebraucht: detectType() (template_matcher.ts) ruft deps.search() für den
          // RAG-Typ-Vote auf — entgegen der Planannahme kein toter Code (SEAM-VERTRAG 3, auto-detect
          // im leeren-templatePath-Pfad von proposeSmartApply). Läuft über die Fassade (searchVector,
          // der einzige interne Low-Level-Pfad mit exclude-Override); opts (inkl. hart gesetztem
          // exclude:["Templates/"] aus template_matcher.ts) wird vollständig durchgereicht — siehe
          // Task-3-Report + Fix-Wave-Report.
          search: (vec, opts) => {
            const r = this.facade.searchVector(vec, opts);
            return r.kind === "hits" ? r.hits : [];
          },
        },
        () => this.chatClient,
        () => ({
          model: this.smartApplyModelInUse,
          temperature: this.settings.smartApplyTemperature,
          suppressThinking: this.settings.smartApplySuppressThinking,
          maxTokens: this.settings.smartApplyMaxTokens,
        }),
      );
      this.templateRanker = new TemplateRanker({
        read: (p) => this.app.vault.adapter.read(p),
        stat: async (p) => { const s = await this.app.vault.adapter.stat(p); return { mtime: s?.mtime ?? 0 }; },
        listTemplates: async () =>
          templateFilesUnder(this.app.vault.getMarkdownFiles().map(f => f.path), this.settings.templateDir),
        // Persistierter Vault-Vektor (note-level) — wie der RAG-Retriever; spart das Neu-Einbetten
        // indexierter Vorlagen/Notizen komplett.
        indexVector: (p) => this.index?.vectorFor(p) ?? null,
        embed: async (t) => {
          const e = await this.facade.embedQuery(t);
          if (e.kind !== "vec") throw new Error("kein Index / Embedder offline");
          return e.vec;
        },
      });
    }

    this.addCommand({
      id: "reindex-vault",
      name: "Vault neu indizieren",
      callback: () => void this.reindexVault(),
    });

    this.addCommand({
      id: "heal-index",
      name: "Index vervollständigen (fehlende Notizen)",
      callback: () => void this.healVault(),
    });

    this.addCommand({
      id: "restore-index-backup",
      name: "Index aus Backup wiederherstellen",
      callback: () => void (async () => { new RestoreBackupModal(this.app, await this.listBackups(), (n) => void this.restoreBackup(n)).open(); })(),
    });

    if (this.settings.showStatusBar) this.setStatusBarVisible(true);
    this.refreshIndexFolderHiding();

    // Aktiven Endpoint aus den Fallback-Listen auflösen (erster erreichbarer gewinnt).
    void this.resolveAndReconnectEmbedder();
    void this.resolveAndReconnectChat();

    void this.startMcpServerIfEnabled();
    // Über denselben mcpOpChain wie start/restart, damit ein Unload mitten in einem
    // laufenden Start/Restart nicht auf ein Handle race'd, das gerade erst gebunden wird.
    this.register(() => { void this.runMcpOp(() => this.stopMcpServer()); });

    // Hub: EIN registerView statt vier — buildPanels() ans Ende von onload, damit
    // this.smartApply/this.templateRanker (oben im smartApplyEnabled-Block gebaut) bereits existieren.
    this.registerView(VIEW_TYPE_HUB, (leaf: WorkspaceLeaf) => new VaultRetrievalView(leaf, this.buildPanels(), "related"));
    this.addRibbonIcon("layers", "Vault Retrieval", () => void this.openHub("related"));
    this.addCommand({ id: "open-related", name: "Verwandte Notizen öffnen", callback: () => void this.openHub("related") });
    this.addCommand({ id: "open-semantic-search", name: "Semantische Suche öffnen", callback: () => void this.openHub("search") });
    this.addCommand({ id: "open-vault-chat", name: "Vault Chat öffnen", callback: () => void this.openHub("chat") });
    this.addCommand({ id: "open-reformat", name: "Umformatieren-Panel öffnen", callback: () => void this.openHub("reformat") });
    this.addCommand({
      id: "smart-apply-active-note",
      name: "Smart Apply auf aktive Notiz",
      checkCallback: (checking: boolean) => {
        const f = this.app.workspace.getActiveFile();
        const ok = f instanceof TFile && f.extension === "md" && this.settings.smartApplyEnabled;
        if (ok && !checking) void this.openHub("smart-apply");
        return ok;
      },
    });

    this.addCommand({
      id: "reformat-selection",
      name: "Abschnitt umformatieren",
      // Bewusst `callback` statt `editorCallback`: editorCallback blendet den Command
      // aus der Palette aus, sobald kein Editor aktiv ist (Lesemodus, Fokus in der
      // Sidebar) — er verschwand dadurch kommentarlos. Jetzt immer sichtbar und
      // selbsterklärend über readinessMessage().
      callback: () => void this.reformatFromCommand(),
    });

    // Der übergebene `editor` dient nur als Sichtbarkeits-Guard; die Aktion löst den
    // aktiven View erneut auf (eine Ausführungs-Wahrheit). In einem Split, in dem der
    // Fokus dem Rechtsklick nicht folgt, meldet sie dann ehrlich „Nichts markiert.".
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      if (!editor.getSelection().trim()) return;
      menu.addItem(item => item
        .setTitle("Abschnitt umformatieren")
        .setIcon("wand")
        .onClick(() => void this.reformatFromCommand()));
    }));

    // Bindet nur das beim Laden aktive Dokument: Auswahlen in einem Obsidian-Pop-out-Fenster
    // aktualisieren die Mitschrift nicht. Ungefährlich — die Guards verweigern dann.
    this.registerDomEvent(activeDocument, "selectionchange", () => {
      if (this.selectionDebounce !== null) window.clearTimeout(this.selectionDebounce);
      this.selectionDebounce = window.setTimeout(() => {
        this.selectionDebounce = null;
        this.captureSelection();
        this.reformatPanel?.refresh();
      }, SELECTION_DEBOUNCE_MS);
    });
    this.register(() => {
      if (this.selectionDebounce !== null) window.clearTimeout(this.selectionDebounce);
    });

    // Notiz-/Pane-Wechsel bewegt die DOM-Selektion nicht zwingend — ohne dieses Event
    // zeigte das Panel nach einem Wechsel weiter die alte Auswahl als „bereit" an.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.captureSelection();
      this.reformatPanel?.refresh();
    }));

    this.app.workspace.onLayoutReady(() => this.migrateOldLeaves());
  }

  private buildPanels(): HubPanel[] {
    const panels: HubPanel[] = [
      new RelatedPanel({
        getHits: () => this.currentHits(),
        openPath: this.openPath,
      }),
      new SearchPanel({
        search: (q) => this.runSearch(q),
        openPath: this.openPath,
      }),
      new ChatPanel({
        session: new ChatSession({
          client: () => this.chatClient,
          assemble: (paths) => buildContext(paths, {
            read: (p) => this.app.vault.adapter.read(p),
            budget: this.settings.contextCharBudget,
          }),
          systemPreamble: () => this.settings.chatSystemPrompt,
          params: () => ({ model: this.chatModelInUse, temperature: this.settings.chatTemperature, suppressThinking: this.settings.suppressThinking }),
        }),
        openPath: this.openPath,
        copyText: (t: string) => { void navigator.clipboard.writeText(t); new Notice("Kopiert"); },
        ping: () => this.chatReady(),
        listModels: () => this.chatClient.listModels(),
        getModel: () => this.settings.chatModel,
        setModel: (m: string) => { this.settings.chatModel = m; void this.saveSettings(); },
        inputPosition: () => this.settings.chatInputPosition,
        getActivePath: () => this.app.workspace.getActiveFile()?.path ?? null,
        embed: async (q) => {
          const e = await this.facade.embedQuery(q);
          if (e.kind !== "vec") throw new Error("Embedder nicht erreichbar.");  // context_panel fängt → []
          return e.vec;
        },
        search: (vec, n) => {
          const r = this.facade.searchVector(vec, { k: n });
          return r.kind === "hits" ? r.hits.map(h => h.path) : [];
        },
        pickNote: () => pickNote(this.app),
        autoK: this.settings.chatK,
        getSuppress: () => this.settings.suppressThinking,
        setSuppress: (v: boolean) => { this.settings.suppressThinking = v; void this.saveSettings(); },
        enterSends: () => this.settings.enterSends,
      }),
    ];
    if (this.settings.smartApplyEnabled && this.smartApply && this.templateRanker) {
      panels.push(new SmartApplyPanel({
        // SEAM-VERTRAG (7): build/reroll tragen templatePath + mode + die Live-Stream-Callbacks der View.
        build: (notePath, templatePath, mode, onToken, onReasoning) => this.proposeSmartApply(notePath, templatePath, mode, onToken, onReasoning),
        accept: (p, selection, auditTrail) => this.smartApply!.persistApply(p, selection, auditTrail),
        reroll: (p, templatePath, mode, onToken, onReasoning) => this.proposeSmartApply(p.notePath, templatePath, mode, onToken, onReasoning),
        openPath: this.openPath,
        abort: () => { this.smartApply?.abort(); },
        activeNotePath: () => {
          const f = this.app.workspace.getActiveFile();
          return f instanceof TFile && f.extension === "md" ? f.path : null;
        },
        listModels: () => this.chatClient.listModels(),
        ping: () => this.chatReady(),
        getModel: () => this.settings.smartApplyModel || this.settings.chatModel,
        setModel: (m: string) => { this.settings.smartApplyModel = m; void this.saveSettings(); },
        rankTemplates: (notePath: string): Promise<TemplateRank[]> => this.templateRanker!.rank(notePath),
        getSuppress: () => this.settings.smartApplySuppressThinking,
        setSuppress: (v: boolean) => { this.settings.smartApplySuppressThinking = v; void this.saveSettings(); },
        templateDefaultMode: (templatePath: string) => this.templateDefaultMode(templatePath),
      }));
    }
    const reformat = new ReformatPanel({
      getReadiness: () => this.reformatReadiness(),
      run: (def, instruction) => void this.runTransform(def, instruction),
    });
    this.reformatPanel = reformat;
    panels.push(reformat);
    return panels;
  }

  async openHub(tab: TabId): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HUB);
    const leaf = existing.length ? existing[0] : this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing.length) await leaf.setViewState({ type: VIEW_TYPE_HUB, active: true });
    const view = leaf.view;
    if (view instanceof VaultRetrievalView) view.showTab(tab);
    void this.app.workspace.revealLeaf(leaf);
  }

  private migrateOldLeaves(): void {
    for (const t of [VIEW_TYPE_RELATED, VIEW_TYPE_SEARCH, VIEW_TYPE_CHAT, VIEW_TYPE_SMART_APPLY]) {
      for (const leaf of this.app.workspace.getLeavesOfType(t)) leaf.detach();
    }
  }

  /** Aktiven Embedding-Endpoint aus der Fallback-Liste auflösen (erster erreichbarer gewinnt)
   *  und embedder + liveIndexer darauf neu verdrahten. Behält die liveIndexer-Verdrahtung. */
  async resolveAndReconnectEmbedder(): Promise<void> {
    // Eigene Schleife statt resolveActiveEndpoint (Kit): das kennt nur URLs und könnte den
    // Schlüssel/das Modell-Override des Eintrags nicht mitführen.
    // Modell-Guard: ein Kandidat mit fremdem Embedding-Modell darf den geladenen Index NICHT
    // bedienen (anderer Vektorraum, stille Vergiftung) — er wird übersprungen, nicht genutzt.
    const indexModel = this.index?.manifest.embedding_model;
    const fits = (cfg: EndpointConfig): boolean =>
      embeddingModelMatchesIndex(effectiveModel(cfg, this.settings.embeddingModel), indexModel);
    let active: EndpointConfig | null = null;
    const skipped: string[] = [];
    for (const candidate of this.settings.embeddingEndpoints) {
      const url = candidate.url?.trim();
      if (!url) continue;
      const model = effectiveModel(candidate, this.settings.embeddingModel);
      if (!fits(candidate)) {
        skipped.push(`„${url}" (Modell ${model})`);
        continue;
      }
      if (await new EmbeddingClient(url, model, candidate.apiKey).ping()) {
        active = candidate;
        break;
      }
    }
    // Auch die Rückfall-Verdrahtung respektiert den Guard: lieber ein passender, gerade nicht
    // erreichbarer Endpunkt als ein erreichbarer aus dem falschen Vektorraum.
    const cfg = active ?? this.settings.embeddingEndpoints.find(fits) ?? this.settings.embeddingEndpoints[0] ?? { url: "" };
    this.activeEmbeddingEndpoint = active ? normalizeEndpoint(cfg.url) : null;
    const m = effectiveModel(cfg, this.settings.embeddingModel);
    this.embeddingModelInUse = m;
    this.embedder = new EmbeddingClient(cfg.url, m, cfg.apiKey);
    // Die DURCHSETZUNG des Modell-Schutzes hängt nicht hier, sondern an der Schreiboperation
    // (LiveIndexer.persist → assertModelSafeToPersist, Wahrheit aus dem Container auf Platte).
    // Der Skip oben ist reine Prävention: ein unpassender Endpunkt wird gar nicht erst aktiv.
    this.noticeSkippedEmbeddingEndpoints(skipped, indexModel);
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, this.settings.indexDir, this.embedder, m);
    if (this.index) this.liveIndexer.init(this.index);
    else if (this.indexHealthy) this.liveIndexer.markFresh();
    // Gefahrenzustand (indexHealthy=false) → bewusst NICHT markFresh: bleibt not-ready (Schreibschutz).
  }

  /** Klartext-Meldung für Endpunkte, die der Modell-Guard übersprungen hat — im Wortlaut, damit
   *  der Nutzer versteht, warum sein externer Anbieter nicht greift. Enthält NIE den Schlüssel.
   *  Wiederholt sich nicht: erst wenn sich die Menge der Übersprungenen ändert, kommt sie wieder. */
  private noticeSkippedEmbeddingEndpoints(skipped: string[], indexModel: string | undefined): void {
    const signature = skipped.join("|");
    if (signature === this.lastSkipNotice) return;
    this.lastSkipNotice = signature;
    if (!skipped.length) return;
    new Notice(
      `Embedding-Endpunkt übersprungen: ${skipped.join(", ")} passt nicht zum Modell des Index `
      + `(${indexModel ?? "unbekannt"}). Ein Wechsel des Embedding-Modells erfordert einen `
      + `vollständigen Neuaufbau des Index.`,
      10000,
    );
  }

  /** Nutzertext für eine Schreib-Blockade — egal ob geworfen (`persist`) oder vorab entschieden
   *  (`checkModelAgainstDisk`). `model-mismatch` bekommt Klartext samt Ausweg; die generische
   *  „Index wirkt beschädigt"-Meldung wäre dort schlicht falsch. Nie mit Schlüssel. */
  private blockedMessage(kind: PersistBlockedError["kind"] | undefined, fallback: string): string {
    if (kind !== "model-mismatch") return fallback;
    return "⚠ Vault Retrieval: Das Embedding-Modell dieses Endpunkts passt nicht zum Index — "
      + "es wird nichts geschrieben (Schreibschutz). Suche und Lesen laufen weiter. Ausweg: passenden "
      + 'Endpunkt eintragen oder „Vault neu indizieren".';
  }

  /** Wie `blockedMessage`, nur direkt aus einem gefangenen Fehler — auch aus einem `unknown`
   *  im catch-Block (alles außer `PersistBlockedError` bekommt den Fallback). */
  private persistBlockedMessage(e: unknown, fallback: string): string {
    return this.blockedMessage(e instanceof PersistBlockedError ? e.kind : undefined, fallback);
  }

  /** Aktiven Chat-Endpoint aus der Fallback-Liste auflösen (erster erreichbarer gewinnt)
   *  und chatClient darauf neu verdrahten. */
  async resolveAndReconnectChat(): Promise<void> {
    let active: EndpointConfig | null = null;
    for (const candidate of this.settings.chatEndpoints) {
      const url = candidate.url?.trim();
      if (!url) continue;
      if (await new ChatClient(url, effectiveModel(candidate, this.settings.chatModel), candidate.apiKey).ping()) {
        active = candidate;
        break;
      }
    }
    const cfg = active ?? this.settings.chatEndpoints[0] ?? { url: "" };
    this.activeChatEndpoint = active ? normalizeEndpoint(cfg.url) : null;
    this.chatEndpointInUse = cfg;
    this.chatClient = new ChatClient(cfg.url, this.chatModelInUse, cfg.apiKey);
  }

  /** Modell, das eine Chat-Anfrage tatsächlich mitschickt. `ChatClient.stream` liest `opts.model`
   *  und ignoriert das im Konstruktor gesetzte Modell — jede Aufrufstelle muss deshalb DIESEN
   *  Wert übergeben, sonst ginge bei einem Fallback auf einen gehosteten Anbieter der lokale
   *  Modellname raus (HTTP 400 ohne erkennbare Ursache). Getter statt Feld: eine Modellauswahl
   *  im Dropdown wirkt so sofort, ohne Re-Resolve. */
  get chatModelInUse(): string {
    return chatRequestModel(this.chatEndpointInUse, "", this.settings.chatModel);
  }

  /** Wie `chatModelInUse`, nur mit Smart Applys eigenem Modellfeld als Zwischenstufe:
   *  `smartApplyModel` gilt gegenüber dem globalen Chat-Modell, unterliegt aber dem
   *  Zeilen-Override des aktiven Endpunkts (dessen Modellnamen sind die einzigen, die dort
   *  garantiert existieren). */
  private get smartApplyModelInUse(): string {
    return chatRequestModel(this.chatEndpointInUse, this.settings.smartApplyModel, this.settings.chatModel);
  }

  /** Embedder-Reachability mit EINEM Re-Resolve-Retry: aktiven pingen; schlägt fehl,
   *  einmal die Fallback-Liste neu auflösen und erneut pingen. Kein Loop.
   *  Public, weil der Settings-Tab denselben Check nutzt (keine Logik-Dopplung). */
  async embedderReady(): Promise<boolean> {
    if (await this.embedder.ping()) return true;
    await this.resolveAndReconnectEmbedder();
    return this.embedder.ping();
  }

  /** Chat-Reachability mit EINEM Re-Resolve-Retry, analog embedderReady. */
  private async chatReady(): Promise<boolean> {
    if (await this.chatClient.ping()) return true;
    await this.resolveAndReconnectChat();
    return this.chatClient.ping();
  }

  /** CSS-Regel, die den Index-Ordner im Datei-Explorer aus-/einblendet. Idempotent.
   *  Nutzt Constructable Stylesheets (kein <style>-Element — Lint-Regel no-forbidden-elements).
   *  Diese API gibt es erst ab Safari/iOS 16.4 — auf älteren Mobile-WebViews still überspringen
   *  (Ordner bleibt sichtbar, aber das Plugin lädt normal weiter; KEIN Crash). */
  refreshIndexFolderHiding(): void {
    if (!("replaceSync" in CSSStyleSheet.prototype) || !("adoptedStyleSheets" in activeDocument)) return;
    try {
      if (!this.hideStyleSheet) {
        this.hideStyleSheet = new CSSStyleSheet();
        activeDocument.adoptedStyleSheets = [...activeDocument.adoptedStyleSheets, this.hideStyleSheet];
        this.register(() => {
          activeDocument.adoptedStyleSheets = activeDocument.adoptedStyleSheets.filter(s => s !== this.hideStyleSheet);
          this.hideStyleSheet = null;
        });
      }
      this.hideStyleSheet.replaceSync(buildHideCss(this.settings.indexDir, this.settings.hideIndexFolder));
    } catch (e) {
      console.warn("vault-rag: Index-Ordner-Ausblenden auf dieser Plattform nicht unterstützt", e);
    }
  }

  /**
   * Verlegt den Index-Ordner: Dateien kopieren (kein Reindex) → Komponenten neu verdrahten
   * → Hide-CSS aktualisieren → alten Ordner aufräumen (nur wenn er ausschließlich unsere
   * Dateien enthält). Reihenfolge strikt B-vor-A (kein Datenverlust, vgl. Reindex-Lehre).
   */
  async changeIndexDir(newDir: string): Promise<void> {
    const oldDir = normalizeIndexDir(this.settings.indexDir);
    const target = normalizeIndexDir(newDir);
    if (target === "" || target === oldDir) return;
    this.isSwitchingIndexDir = true;
    try {
      await migrateIndex(this.app.vault.adapter, oldDir, target);
      // Datenverlust-Schutz (B-vor-A): hatte der alte Ordner einen vollständigen Index, MUSS der
      // neue ihn nach der Migration auch haben — sonst nichts umstellen, nichts persistieren, nichts löschen.
      if ((await this.indexComplete(oldDir)) && !(await this.indexComplete(target))) {
        new Notice(`Index-Verlegung nach „${target}" unvollständig — nichts geändert, „${oldDir}" bleibt aktiv.`);
        return;
      }
      this.settings.indexDir = target;
      await this.saveSettings();
      this.liveIndexer = new LiveIndexer(this.app.vault.adapter, target, this.embedder, this.embeddingModelInUse);
      this.pendingQueue = new PendingQueue(this.app.vault.adapter, target);
      await this.pendingQueue.load();
      await this.loadIndex();
      this.refreshIndexFolderHiding();
      // Fix 2: alten Ordner NUR löschen, wenn der neue Index wirklich geladen werden konnte
      // (indexComplete prüft nur Existenz, nicht Parsebarkeit — loadIndex meldet Parse-Fehler
      // jetzt laut als Gefahrenzustand, statt sie still zu schlucken).
      if (this.index) {
        await this.cleanupIndexDir(oldDir);
      } else {
        new Notice(`Neuer Index unter „${target}" nicht ladbar — alter Ordner „${oldDir}" bleibt als Sicherung erhalten.`);
      }
    } finally {
      this.isSwitchingIndexDir = false;
    }
  }

  /** True, wenn alle zum Laden nötigen Index-Dateien in `dir` existieren (pending.json ist optional). */
  private async indexComplete(dir: string): Promise<boolean> {
    for (const f of INDEX_REQUIRED_FILES) {
      if (!(await this.app.vault.adapter.exists(`${dir}/${f}`))) return false;
    }
    return true;
  }

  /** Löscht den alten Index-Ordner — nur wenn er ausschließlich unsere Index-Dateien enthält. */
  private async cleanupIndexDir(dir: string): Promise<void> {
    try {
      const listing = await this.app.vault.adapter.list(dir);
      if (!onlyContainsIndexFiles(listing.files ?? [], listing.folders ?? [])) {
        new Notice(`Alter Index-Ordner „${dir}" enthält weitere Dateien — bitte manuell prüfen.`);
        return;
      }
      await removeDirDeep(this.app.vault.adapter, dir);
    } catch (e) {
      console.warn("vault-rag: cleanupIndexDir failed", e);
      new Notice(`Alter Index-Ordner „${dir}" konnte nicht entfernt werden — bitte manuell prüfen.`);
    }
  }

  private backupsRoot(): string { return `${this.manifest.dir}/${BACKUP_SUBDIR}`; }

  /** Kopiert den aktuellen Index geräte-lokal (Plugin-Ordner, synct nicht) und rotiert auf 3.
   *  Läuft über runIndexOp (Fix Backup-Rotation): verhindert, dass ein Snapshot mitten in einen
   *  laufenden Live-Persist hineinkopiert und dadurch eine unvollständige Kopie erzeugt.
   *  runIndexOp ist NICHT reentrant — alle Aufrufer müssen `void this.snapshotIndex()`
   *  (fire-and-forget) bleiben, nie von innerhalb eines runIndexOp-Callbacks awaiten (Deadlock). */
  async snapshotIndex(): Promise<void> {
    if (!this.index || !this.indexHealthy) return; // nur bekannt-guten Zustand sichern
    return this.runIndexOp(async () => {
      try {
        const root = this.backupsRoot();
        // Zeitstempel aus dem Container-Header (fällt sonst auf lastMtime zurück).
        let builtAt = "";
        try {
          const buf = await this.app.vault.adapter.readBinary(`${this.settings.indexDir}/${CONTAINER_FILE}`);
          builtAt = ((decodeContainer(buf).manifest as { built_at?: string }).built_at) ?? "";
        } catch { /* ignore */ }
        if (!builtAt) builtAt = new Date(this.lastMtime || Date.now()).toISOString();
        const name = backupDirName(builtAt);
        const dest = `${root}/${name}`;
        if (await this.app.vault.adapter.exists(`${dest}/${CONTAINER_FILE}`)) return; // schon gesichert
        await migrateIndex(this.app.vault.adapter, this.settings.indexDir, dest);
        if (!(await this.backupComplete(dest))) {
          // Race (z. B. Quelldatei wurde währenddessen von Sync überschrieben) — keine
          // Ordner-Leiche stehen lassen. Der nächste reguläre Snapshot-Versuch holt es nach.
          await this.removeBackupDir(root, name);
          return;
        }
        // Rotation: vorhandene Backup-Verzeichnisse listen → älteste über 3 löschen.
        const existing = await this.backupNames();
        for (const del of selectBackupsToDelete(existing, 3)) {
          await this.removeBackupDir(root, del);
        }
      } catch (e) { console.warn("vault-rag: snapshotIndex failed", e); }
    });
  }

  private async backupComplete(dest: string): Promise<boolean> {
    const listing = await this.app.vault.adapter.list(dest);
    return hasAllRequiredFiles(listing.files ?? []);
  }

  /** Entfernt ein Backup-Verzeichnis. Fehler sind nicht fatal, werden aber NICHT verschwiegen:
   *  der stumme catch hier hat den EISDIR-Bug wochenlang unsichtbar gehalten (1309 Leichen). */
  private async removeBackupDir(root: string, name: string): Promise<void> {
    try {
      await removeDirDeep(this.app.vault.adapter, `${root}/${name}`);
    } catch (e) {
      console.warn(`vault-rag: Backup-Ordner „${name}" konnte nicht entfernt werden`, e);
    }
  }

  private async backupNames(): Promise<string[]> {
    try {
      const listing = await this.app.vault.adapter.list(this.backupsRoot());
      return (listing.folders ?? []).map(p => p.split("/").pop() ?? p);
    } catch { return []; }
  }

  async listBackups(): Promise<BackupEntry[]> {
    const names = await this.backupNames();
    const entries: BackupEntry[] = [];
    for (const name of names) {
      // Container-first; Legacy-Fallback für Prä-0.18-Backups (die noch das Tripel enthalten).
      let count = 0;
      try {
        const buf = await this.app.vault.adapter.readBinary(`${this.backupsRoot()}/${name}/${CONTAINER_FILE}`);
        count = decodeContainer(buf).manifest.count;
      } catch {
        try { const m = JSON.parse(await this.app.vault.adapter.read(`${this.backupsRoot()}/${name}/manifest.json`)) as { count?: number }; count = m.count ?? 0; } catch { /* ignore */ }
      }
      entries.push({ name, count });
    }
    return sortBackupsNewestFirst(entries);
  }

  async restoreBackup(name: string): Promise<void> {
    const src = `${this.backupsRoot()}/${name}`;
    // Vollständigkeit prüfen, bevor wir den aktiven Index ersetzen. hasAllRequiredFiles akzeptiert
    // Container-Backups UND Prä-0.18-Tripel-Backups (loadIndex migriert Letztere beim Laden).
    // list() gekapselt: der Ordner kann zwischen Modal-Öffnen und Klick wegrotiert sein — das muss
    // als „unvollständig" mit Notice enden, nicht als unhandled rejection (Aufrufer sind `void …`).
    let files: string[] = [];
    try { files = (await this.app.vault.adapter.list(src)).files ?? []; } catch { /* → unvollständig */ }
    if (!hasAllRequiredFiles(files)) {
      new Notice(`Backup „${name}" unvollständig — Wiederherstellung abgebrochen.`);
      return;
    }
    // Legacy-Backup (Prä-0.18-Tripel, kein Container): die korrupte index.bin im indexDir MUSS weg,
    // bevor das Tripel darüber kopiert wird — loadIndexStore ist container-first und würde sonst die
    // korrupte index.bin sehen, `corrupt` liefern und das restaurierte Tripel nie anschauen (die
    // Wiederherstellung wäre still wirkungslos). Das Tripel im Backup ist an dieser Stelle bereits
    // als vollständig bewiesen; enthält das Backup einen Container, überschreibt migrateIndex die
    // Ziel-Datei ohnehin — dann ist nichts zu löschen.
    if (!files.some(f => (f.split("/").pop() ?? f) === CONTAINER_FILE)) {
      try { await this.app.vault.adapter.remove(`${this.settings.indexDir}/${CONTAINER_FILE}`); } catch { /* nicht vorhanden ok */ }
    }
    await migrateIndex(this.app.vault.adapter, src, this.settings.indexDir);
    await this.loadIndex();
    new Notice(this.indexHealthy ? "Index aus Backup wiederhergestellt." : "Wiederhergestellter Index ließ sich nicht laden.");
  }

  /** Command-/Kontextmenü-Weg: Zustand frisch erfassen, Picker zeigen, ausführen. */
  private async reformatFromCommand(): Promise<void> {
    this.captureSelection();
    if (!canRun(this.lastReadiness)) { new Notice(readinessMessage(this.lastReadiness)); return; }
    const def = await pickTransform(this.app);
    if (!def) return;
    await this.runTransform(def);
  }

  /** Führt einen Transform auf der gemerkten Auswahl aus — gemeinsamer Weg für Command,
   *  Kontextmenü und Sidebar-Panel (eine Ausführungs-Wahrheit). */
  async runTransform(def: TransformDef, instruction?: string): Promise<void> {
    const cap = this.lastCapture;
    if (!cap || !canRun(this.lastReadiness)) { new Notice(readinessMessage(this.lastReadiness)); return; }
    if (!this.captureIsLive(cap)) { new Notice("Die Notiz ist nicht mehr offen — bitte neu markieren."); return; }
    if (isRangeStale(cap.editor.getRange(cap.from, cap.to), cap.text)) {
      new Notice("Die Auswahl hat sich geändert — bitte neu markieren."); return;
    }

    // Umgebende Leerzeichen nicht in den Transform geben, beim Zurückschreiben wieder anfügen.
    const { lead, core, trail } = splitSelectionAffix(cap.text);

    if (def.kind === "mechanical") {
      const result = def.run(core);
      if (result == null) { new Notice(`„${def.label}" passt nicht zur Auswahl.`); return; }
      cap.editor.replaceRange(lead + result + trail, cap.from, cap.to);
      return;
    }

    let instr = instruction;
    if (def.freetext && instr === undefined) {
      const typed = await promptInstruction(this.app);
      if (typed == null) return;
      instr = typed;
    }
    const messages = def.buildMessages(core, instr);

    new ReformatPreviewModal(this.app, {
      original: core,
      stream: (onToken, signal) => this.chatClient
        .stream(messages, onToken, () => {}, signal, {
          model: this.chatModelInUse,
          temperature: 0.2,
          suppressThinking: true,
          maxTokens: REFORMAT_MAX_TOKENS,
        })
        .then(r => r.content),
      onApply: (result) => {
        // Erneut prüfen: zwischen Öffnen des Modals und „Anwenden" kann editiert worden sein.
        if (!this.captureIsLive(cap) || isRangeStale(cap.editor.getRange(cap.from, cap.to), cap.text)) {
          new Notice("Die Auswahl hat sich geändert — nichts eingefügt.");
          return;
        }
        cap.editor.replaceRange(lead + result + trail, cap.from, cap.to);
      },
    }).open();
  }

  /** Kompakter Zustands-Text für die Robustheits-Sektion in den Einstellungen. */
  indexHealthReadout(embedded: number, total: number, healthy: boolean, emptyCount = 0): string {
    if (!healthy) return "⚠ Embedding-Index beschädigt — Laden fehlgeschlagen (Schreibschutz aktiv; deine Notizen sind unberührt)";
    return indexDeltaReadout(embedded, total, emptyCount);
  }

  /** Erfasste vs. Soll-Notizzahl für die Index-Zustand-Zeile. `embedded = total − fehlende`
   *  (fehlende via `diffIndexVsVault`, dieselbe missing-Basis wie `healVault`) — bewusst NICHT
   *  `liveIndexer.noteCount`, das Stale-Einträge (gelöscht/umbenannt) mitzählt und das Delta
   *  unter Index-Drift verfälschen würde (Button fälschlich disabled trotz fehlender Notizen).
   *  Chunk-lose Notizen (emptyNotePaths) zählen weder als fehlend noch ins Soll — sie können
   *  nie im Index landen; sonst zeigte die Zeile ein dauerhaftes Phantom-Defizit.
   *  `healthy` spiegelt den Schreibschutz-Zustand für die Zeile + Button. */
  indexDelta(): { embedded: number; total: number; healthy: boolean; emptyCount: number } {
    const vaultPaths = this.vaultMarkdownPaths();
    const missing = this.index ? diffIndexVsVault([...this.index.paths], vaultPaths).missing : vaultPaths;
    return { ...computeIndexDelta(vaultPaths.length, missing, this.emptyNotePaths), healthy: this.indexHealthy };
  }

  async loadIndex() {
    // Container-first (Task 2): loadIndexStore kapselt exists-Konservativität, Legacy-Migration
    // und die Korruptions-Klassifikation an einer Stelle (obsidian-frei, getestet).
    const result = await loadIndexStore(this.app.vault.adapter, this.settings.indexDir);
    if (result.state === "loaded") {
      // Gesunder Load beendet die Gefahrenzustand-Episode → Auto-Heal darf wieder greifen.
      this.autoHealAttempted = false;
      this.index = result.index;
      this.liveIndexer.init(this.index);
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/${CONTAINER_FILE}`);
      if (st) this.lastMtime = st.mtime;
      this.indexHealthy = true;
      this.refresh();
      this.syncProgress();
      const vaultPaths = this.vaultMarkdownPaths();
      const { missing } = diffIndexVsVault([...this.index.paths], vaultPaths);
      // Chunk-lose Notizen frisch klassifizieren (billig: nur die missing-Pfade lesen) —
      // sie sind nie indexierbar und dürfen weder Auto-Heal noch das Delta triggern.
      this.emptyNotePaths = new Set(await classifyChunkless(missing, (p) => this.app.vault.adapter.read(p)));
      const embeddable = missing.filter(p => !this.emptyNotePaths.has(p));
      // Konservativ: nur bei substanzieller Lücke laut werden (>5% UND >20 Notizen),
      // und nur wenn der Embedder erreichbar ist (sonst ist die Lücke evtl. temporär).
      if (embeddable.length > 20 && embeddable.length > vaultPaths.length * 0.05 && await this.embedderReady()) {
        new Notice(`vault-rag: ${embeddable.length} von ${vaultPaths.length} Notizen fehlen im Index.`, 8000);
        // Fire-and-forget: loadIndex() blockiert onload() nicht auf User-Interaktion.
        void confirmAction(this.app, {
          title: "Index vervollständigen?",
          message: `${embeddable.length} von ${vaultPaths.length} Notizen fehlen im Index. Nur die fehlenden werden neu eingebettet (Delta) — der bestehende Index bleibt erhalten.`,
          confirmLabel: "Jetzt vervollständigen",
          cancelLabel: "Später",
          warning: false,
        }).then((ok) => { if (ok) void this.healVault(); });
      }
    } else if (result.state === "no-index") {
      // Frische Installation: leerer Indexer darf gefahrlos aufbauen.
      this.index = null;
      this.liveIndexer.markFresh();
      this.indexHealthy = true;
      this.syncProgress();
    } else {
      // GEFAHRENZUSTAND: Index liegt vor, ließ sich aber nicht laden. liveIndexer NICHT init'en
      // und explizit auf not-ready setzen (auch mid-session, falls er zuvor schon ready war —
      // sonst würde der persist-Guard trotz Gefahrenzustand nicht greifen). Laut anzeigen.
      this.index = null;
      this.liveIndexer.markUnready();
      this.indexHealthy = false;
      this.syncProgress();
      new Notice("⚠ Vault Retrieval: Der Embedding-Index für die Ähnlichkeitssuche ist beschädigt — deine Notizen sind unberührt, nur der Suchindex. Schreibschutz aktiv; automatische Wiederherstellung wird versucht.", 10000);
      // Fire-and-forget: die Heal-Kaskade darf onload()/loadIndex() nicht auf Netz/Backups blocken.
      void this.attemptAutoHeal();
    }
  }

  /** Backup-Kaskade: neuestes CRC-beweisbares Backup übernehmen, Lücke per Delta-Heal schließen,
   *  nur restlos sauberen Heal persistieren. Ohne Endpoint/Backup bleibt der Gefahrenzustand
   *  (iPhone wartet auf die Desktop-Heilung via Sync). */
  private async attemptAutoHeal(): Promise<void> {
    if (this.autoHealAttempted) return;
    // Synchron beanspruchen (vor dem ersten await): maybeReload läuft auf einem Intervall und
    // kann während des embedderReady-Pings einen zweiten corrupt-Load feuern — sonst liefe die
    // teure Kaskade doppelt (jede fehlende Notiz zweimal embedden, doppelte Notices).
    this.autoHealAttempted = true;
    const ready = await this.embedderReady();
    // Re-Check (1/2): Die Kaskade läuft detacht. Währenddessen kann maybeReload seinen guten
    // prevIndex restauriert haben („Reload lieferte einen schlechteren Index") — dann ist der
    // Gefahrenzustand vorbei. Ohne diesen Check würden wir einen älteren Backup-Stand über den
    // guten Index schreiben (persist("heal") umgeht den Shrink-Guard) und jede Notice wäre Lärm.
    // Versuch wieder freigeben: die Episode hat sich OHNE Heal erledigt — eine spätere echte
    // Korruption derselben Session muss wieder Auto-Heal bekommen (die Notice verspricht es).
    if (this.indexHealthy) { this.autoHealAttempted = false; return; }
    if (!ready) {
      // Versuch wieder freigeben: ein transient offline gestarteter Obsidian darf den einzigen
      // Versuch der Episode nicht verbrauchen — der nächste corrupt-Load probiert es erneut.
      this.autoHealAttempted = false;
      new Notice("vault-rag: Automatische Wiederherstellung nicht möglich (Embedding-Endpoint nicht erreichbar) — Schreibschutz bleibt aktiv. Über Einstellungen › Index-Robustheit wiederherstellen oder neu indizieren.", 10000);
      return;
    }
    let candidate: VaultIndex | null = null;
    for (const b of await this.listBackups()) { // sortBackupsNewestFirst-Reihenfolge
      candidate = await verifyBackupCandidate(this.app.vault.adapter, `${this.backupsRoot()}/${b.name}`);
      if (candidate) break;
    }
    if (!candidate) { // keine beweisbare Basis → Status quo, aber nicht stumm (Spec §Heal-Kaskade Schritt 3)
      if (!this.indexHealthy) new Notice("vault-rag: Automatische Wiederherstellung nicht möglich (kein intaktes lokales Backup gefunden) — Schreibschutz bleibt aktiv. Über Einstellungen › Index-Robustheit wiederherstellen oder neu indizieren.", 10000);
      return;
    }
    const base = candidate;
    // Sonderfall, den persist() strukturell NICHT sehen kann: Die Kaskade läuft genau dann, wenn
    // der Container auf Platte defekt ist — dort gibt es keine Disk-Wahrheit, gegen die der
    // Modell-Guard prüfen könnte. Die Basis hier ist aber ebenfalls disk-verifiziert
    // (verifyBackupCandidate, CRC-Beweis), also dieselbe Regel (assertModelSafeToPersist) auf
    // dieselbe Frage anwenden, bevor additiv fremde Vektoren einmischen.
    if (!assertModelSafeToPersist(base.manifest.embedding_model, this.embeddingModelInUse, "heal").allowed) {
      new Notice("vault-rag: Automatische Wiederherstellung nicht möglich — das Backup wurde mit einem anderen Embedding-Modell gebaut als der aktive Endpunkt. Schreibschutz bleibt aktiv; passenden Endpunkt eintragen oder neu indizieren.", 10000);
      return;
    }
    // liveIndexer einmal snapshotten (Repo-Konvention, vgl. handleDelete/drainPending): ein
    // paralleles resolveAndReconnectEmbedder() darf init/heal/persist nicht auf verschiedene
    // Instanzen verteilen — sonst persistierte eine leere Instanz über den geheilten Stand.
    const li = this.liveIndexer;
    let healed = false;
    let aborted = false;
    let added = 0;
    try {
      await this.runIndexOp(async () => {
        // Re-Check (2/2): zwischen Kaskadenstart und dem Zug an der runIndexOp-Kette kann der
        // gute Index zurück sein — dann nichts anfassen (auch kein markUnready).
        if (this.indexHealthy) { aborted = true; return; }
        li.init(base);
        const { missing } = diffIndexVsVault([...base.paths], this.vaultMarkdownPaths());
        const report = await li.healMissing(missing, (p) => this.app.vault.adapter.read(p));
        if (!canPersistHealedIndex(report.failed.length)) {
          li.markUnready(); // halb geheilten Index NICHT verteilen
          return;
        }
        await li.persist("heal");
        healed = true;
        added = report.added;
      });
    } catch (e) {
      // persist/read können werfen (Disk, mkdir, writeBinary). Unbehandelt bliebe der Nutzer
      // ewig auf „automatische Wiederherstellung wird versucht" sitzen.
      console.warn("vault-rag: attemptAutoHeal failed", e);
      li.markUnready();
      new Notice("vault-rag: Automatische Wiederherstellung fehlgeschlagen — Schreibschutz bleibt aktiv. Über Einstellungen › Index-Robustheit wiederherstellen oder neu indizieren.", 10000);
      return;
    }
    // guter Index steht wieder → stiller Abbruch, keine Notice; Versuch wieder freigeben (s. o.).
    if (aborted) { this.autoHealAttempted = false; return; }
    if (healed) {
      new Notice(`vault-rag: Index automatisch aus Backup wiederhergestellt — ${added} Notizen ergänzt.`, 8000);
      await this.loadIndex(); // lädt den frisch persistierten Container → gesunder Zustand
    } else {
      new Notice("vault-rag: Automatische Wiederherstellung unvollständig — Schreibschutz bleibt aktiv. Über Einstellungen › Index-Robustheit wiederherstellen oder neu indizieren.", 10000);
    }
  }

  async maybeReload() {
    if (this.isSwitchingIndexDir) return;
    try {
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/${CONTAINER_FILE}`);
      if (st && st.mtime !== this.lastMtime) {
        const prevCount = this.index?.count ?? 0;
        const prevIndex = this.index;
        this.lastMtime = st.mtime;
        await this.loadIndex();
        // Jeden "schlechteren" Ausgang abfangen — sowohl Gefahrenzustand (!this.index, z.B.
        // abgeschnittenes notes.i8 eines Fremdgeräts) als auch Suspicious-Shrink —, solange wir
        // vorher einen guten prevIndex hatten. Bedingung direkt im if (statt in einer Zwischenvariable),
        // damit TS prevIndex innerhalb des Blocks als non-null narrowt.
        if (prevIndex && (!this.index || isSuspiciousShrink(prevCount, this.index.count))) {
          const newCount = this.index?.count ?? 0;
          this.index = prevIndex;
          this.indexHealthy = true;
          this.liveIndexer.init(prevIndex);
          this.syncProgress();
          new Notice(`vault-rag: Reload lieferte einen schlechteren Index (${newCount} statt ${prevCount}) — guter Index behalten. „Index vervollständigen", um zu vereinen.`, 10000);
        } else {
          void this.snapshotIndex(); // NUR bei gutem, übernommenem Reload snapshotten (siehe Fix 3)
        }
      }
    } catch { /* noch kein Index */ }
  }

  private scheduleEmbed(path: string): void {
    const existing = this.debounceTimers.get(path);
    if (existing !== undefined) window.clearTimeout(existing);
    const tid = window.setTimeout(() => {
      this.debounceTimers.delete(path);
      void this.handleModify(path);
    }, this.settings.debounceMs);
    this.debounceTimers.set(path, tid);
  }

  private async handleModify(path: string): Promise<void> {
    if (this.isSwitchingIndexDir) return;
    if (path.startsWith(".")) return;
    if (this.settings.exclude.some(e => path.startsWith(e))) return;
    if (path.startsWith(this.settings.indexDir + "/")) return;
    let content: string;
    try { content = await this.app.vault.adapter.read(path); } catch { return; }

    if (await this.embedderReady()) {
      // Mutate+build+persist serialisiert über runIndexOp (Fix 1): sonst könnten parallele
      // Events (z.B. Bulk-Delete/-Modify) verschränkt laufen und dem persist-Guard eine falsche
      // ±1-Differenz vorspiegeln (Shrink-Fehlalarm) oder einen liveIndexer-Instanz-Swap mitten
      // in der Operation erleben.
      await this.runIndexOp(async () => {
        // liveIndexer snapshotten: ein paralleles fire-and-forget resolveAndReconnectEmbedder()
        // könnte this.liveIndexer über die awaits hinweg neu zuweisen → Update auf alter Instanz,
        // buildIndex/persist auf neuer = stiller Verlust. Eine Instanz durchgängig nutzen (vgl. runSearch).
        const li = this.liveIndexer;
        this.embeddingProgress.isEmbedding = true;
        try {
          const updated = await li.update(path, content);
          if (updated === "empty") this.emptyNotePaths.add(path); else this.emptyNotePaths.delete(path);
          // buildIndex ERST nach erfolgreichem persist: ein geblockter Persist darf `this.index`
          // nicht mit dem Manifest des Indexers überschreiben (das trägt dessen Embedding-Modell).
          // Sonst läse resolveAndReconnectEmbedder sein `indexModel` aus einem vergifteten
          // In-Memory-Index, verwürfe den passenden Endpunkt und säte den nächsten LiveIndexer
          // (init(this.index)) mit fremden Vektoren unter einem passenden Modellnamen.
          await li.persist("live");
          this.index = li.buildIndex();
          this.indexHealthy = true; // vormaliger (auch fälschlicher) Block ist aufgehoben — schreibt wieder gesund.
          this.syncProgress();
          this.refresh();
        } catch (e) {
          if (e instanceof PersistBlockedError) {
            this.indexHealthy = false;
            new Notice(this.persistBlockedMessage(e, "⚠ Vault Retrieval: Embedding-Index wirkt beschädigt — Änderung vorgemerkt statt überschrieben (Schreibschutz). Deine Notizen sind unberührt."), 8000);
          }
          await this.pendingQueue.add(path);
          this.syncProgress();
        } finally {
          this.embeddingProgress.isEmbedding = false;
        }
      });
    } else {
      await this.pendingQueue.add(path);
      this.syncProgress();
    }
  }

  private async handleDelete(path: string): Promise<void> {
    if (this.isSwitchingIndexDir) return;
    if (path.startsWith(".")) return;
    if (!(await this.embedderReady())) return;
    // liveIndexer VOR der Serialisierung snapshotten (Minor 6): ein paralleler Instanz-Swap
    // (resolveAndReconnectEmbedder) darf die laufende Operation nicht unter der Hand wechseln.
    const li = this.liveIndexer;
    await this.runIndexOp(async () => {
      try {
        li.remove(path);
        this.emptyNotePaths.delete(path);
        this.index = li.buildIndex();
        await li.persist("live");
        this.indexHealthy = true;
        this.syncProgress();
        this.refresh();
      } catch (e) {
        if (e instanceof PersistBlockedError) { this.indexHealthy = false; new Notice(this.persistBlockedMessage(e, "⚠ vault-rag: Löschung nicht persistiert (Schreibschutz)."), 8000); }
        else console.warn("vault-rag: handleDelete failed", e);
      }
    });
  }

  private async handleRename(newPath: string, oldPath: string): Promise<void> {
    if (this.isSwitchingIndexDir) return;
    if (newPath.startsWith(".") || oldPath.startsWith(".")) return;
    if (await this.embedderReady()) {
      // liveIndexer VOR der Serialisierung snapshotten (Minor 6, analog handleDelete).
      const li = this.liveIndexer;
      await this.runIndexOp(async () => {
        try {
          li.rename(oldPath, newPath);
          if (this.emptyNotePaths.delete(oldPath)) this.emptyNotePaths.add(newPath);
          this.index = li.buildIndex();
          await li.persist("live");
          this.indexHealthy = true;
          this.syncProgress();
          this.refresh();
        } catch (e) {
          if (e instanceof PersistBlockedError) { this.indexHealthy = false; new Notice(this.persistBlockedMessage(e, "⚠ vault-rag: Umbenennung nicht persistiert (Schreibschutz)."), 8000); }
          else console.warn("vault-rag: handleRename failed", e);
        }
      });
    } else {
      await this.pendingQueue.add(newPath);
      this.syncProgress();
    }
  }

  private async maybeDrainPending(): Promise<void> {
    if (this.isSwitchingIndexDir) return;
    if (this.pendingQueue.size === 0) return;
    if (!(await this.embedderReady())) return;
    await this.drainPending();
  }

  private async drainPending(): Promise<void> {
    // liveIndexer einmal snapshotten (vor dem ersten await darauf) — ein paralleles
    // resolveAndReconnectEmbedder() könnte this.liveIndexer sonst über die awaits hinweg
    // neu zuweisen → Update auf alter, buildIndex/persist auf neuer Instanz = stiller Verlust.
    const li = this.liveIndexer;
    const paths = this.pendingQueue.drain();
    // Mutate+build+persist serialisiert über runIndexOp (Fix 1) — analog den anderen drei Live-Pfaden.
    await this.runIndexOp(async () => {
      try {
        this.embeddingProgress.isEmbedding = true;
        for (const path of paths) {
          try {
            const content = await this.app.vault.adapter.read(path);
            const updated = await li.update(path, content);
            if (updated === "empty") this.emptyNotePaths.add(path); else this.emptyNotePaths.delete(path);
          } catch { /* Datei gelöscht oder unlesbar — überspringen */ }
        }
        // drain() hat in-memory bereits geleert; clear() nicht aufrufen —
        // sonst gehen Paths verloren die während des await-Loops neu reinkamen.
        // buildIndex ERST nach erfolgreichem persist (Begründung s. handleModify): ein geblockter
        // Persist lässt `this.index` unberührt, statt ihn mit einem fremden Modell zu stempeln.
        await li.persist("live");
        this.index = li.buildIndex();
        this.indexHealthy = true;
        this.syncProgress();
        this.refresh();
      } catch {
        this.syncProgress();
      } finally {
        this.embeddingProgress.isEmbedding = false;
      }
    });
  }

  private vaultMarkdownPaths(): string[] {
    return this.app.vault.getMarkdownFiles().map(f => f.path).filter(p => {
      if (p.startsWith(".")) return false;
      if (this.settings.exclude.some(e => p.startsWith(e))) return false;
      if (p.startsWith(this.settings.indexDir + "/")) return false;
      return true;
    });
  }

  async reindexVault(): Promise<void> {
    if (!(await this.embedderReady())) {
      new Notice("Embedding-Endpoint nicht erreichbar — Vault-Indizierung abgebrochen.");
      return;
    }
    const allPaths = this.vaultMarkdownPaths();
    const total = allPaths.length;
    const notice = new Notice(`Indiziere Vault… 0/${total}`, 0);
    // Statusleiste fürs Reindex einblenden (falls aus), damit man die Notice wegklicken kann
    // und den Fortschritt unten weiterverfolgt; am Ende auf das Setting zurücksetzen.
    const statusReveal = !this.statusBarEl;
    if (statusReveal) this.setStatusBarVisible(true);
    this.embeddingProgress.isEmbedding = true;
    this.embeddingProgress.reindex = { done: 0, total };
    this.updateStatusBar();
    try {
      const report = await this.liveIndexer.reindexAll(
        allPaths,
        (p) => this.app.vault.adapter.read(p),
        (done, _indexed, tot) => {
          this.embeddingProgress.reindex = { done, total: tot };
          this.updateStatusBar();
          notice.setMessage(`Indiziere Vault… ${done}/${tot}`);
        },
      );
      // Voll-Reindex hat den ganzen Vault gelesen → frischeste Leer-Klassifikation.
      this.emptyNotePaths = new Set(report.skippedEmpty);
      this.index = this.liveIndexer.buildIndex();
      await this.liveIndexer.persist("reindex");
      this.indexHealthy = true;
      this.refresh();
      void this.snapshotIndex();
      notice.setMessage(`Vault indiziert: ${report.added} Notizen.`);
    } catch (e) {
      console.warn("vault-rag: reindexVault failed", e);
      notice.setMessage(this.persistBlockedMessage(e, "Vault-Indizierung fehlgeschlagen."));
    } finally {
      this.embeddingProgress.reindex = null;
      this.embeddingProgress.isEmbedding = false;
      this.syncProgress();
      if (statusReveal) this.setStatusBarVisible(this.settings.showStatusBar);
      window.setTimeout(() => notice.hide(), 4000);
    }
  }

  /** Delta-Reindex: nur im Vault vorhandene, aber nicht indizierte Notizen nachziehen. */
  async healVault(): Promise<void> {
    if (!(await this.embedderReady())) {
      new Notice("Embedding-Endpoint nicht erreichbar — Vervollständigen abgebrochen.");
      return;
    }
    // liveIndexer einmal snapshotten (Repo-Konvention, vgl. handleDelete/drainPending/attemptAutoHeal):
    // ein paralleles fire-and-forget resolveAndReconnectEmbedder() (z.B. aus dem Einstellungs-Tab)
    // darf this.liveIndexer über die awaits hinweg nicht neu zuweisen — sonst prüfte das Gate
    // Instanz A und Instanz B embeddete/persistierte, also genau die Garantie, die das Gate gibt.
    const li = this.liveIndexer;
    if (!li.isReady()) {
      // isReady() false heißt: kein geladener Index ODER Schreibschutz nach Load-/Heal-Fehler —
      // „kein Index geladen" allein wäre in der zweiten Lage sachlich falsch.
      new Notice(`Kein sicherer Basis-Index verfügbar (nicht geladen oder Schreibschutz) — bitte „Aus Backup wiederherstellen" oder „Vault neu indizieren".`);
      return;
    }
    // Modell-Verträglichkeit VOR dem Embedden klären (Disk-Wahrheit, dieselbe Regel wie in
    // persist()). Ein erst am Ende blockierter Heal ließe die fremden Vektoren in der Vektor-Map
    // des Indexers zurück — nichts macht sie rückgängig, und der nächste regulär erlaubte Persist
    // schriebe sie mit. Nicht embedden ist billiger als zurückrollen.
    const gate = await li.checkModelAgainstDisk("heal");
    if (!gate.allowed) {
      new Notice(this.blockedMessage(gate.kind, "Vervollständigen abgebrochen: Der Index auf Platte ist gerade nicht lesbar (Sync läuft oder Container beschädigt) — bitte später erneut versuchen oder aus einem Backup wiederherstellen."), 10000);
      return;
    }
    const vaultPaths = this.vaultMarkdownPaths();
    const indexPaths = [...(this.index ? this.index.paths : [])];
    const { missing } = diffIndexVsVault(indexPaths, vaultPaths);
    if (missing.length === 0) { new Notice("Index ist vollständig — nichts zu tun."); return; }
    // Bekannte leere Pfade nicht erneut embedden — Fortschritt/Meldung zählen sonst 179
    // statt der 1 echten Lücke (inkonsistent zur Index-Zustand-Zeile).
    const { embeddable, knownEmpty } = splitHealTargets(missing, this.emptyNotePaths);
    if (embeddable.length === 0) { new Notice(healResultMessage(0, knownEmpty.length, 0)); return; }
    const notice = new Notice(`Vervollständige Index… 0/${embeddable.length}`, 0);
    const statusReveal = !this.statusBarEl;
    if (statusReveal) this.setStatusBarVisible(true);
    this.embeddingProgress.isEmbedding = true;
    this.embeddingProgress.reindex = { done: 0, total: embeddable.length };
    this.updateStatusBar();
    try {
      const report = await li.healMissing(
        embeddable,
        (p) => this.app.vault.adapter.read(p),
        (done, _indexed, tot) => {
          this.embeddingProgress.reindex = { done, total: tot };
          this.updateStatusBar();
          notice.setMessage(`Vervollständige Index… ${done}/${tot}`);
        },
      );
      // Leer-Set aktualisieren: bekannte Leere bleiben, frisch entdeckte kommen dazu.
      this.emptyNotePaths = new Set([...knownEmpty, ...report.skippedEmpty]);
      // buildIndex ERST nach erfolgreichem persist (wie handleModify/drainPending): ändert sich die
      // Platte zwischen Gate und Schreiben, bleibt `this.index` sauber statt fremd gestempelt.
      await li.persist("heal");
      this.index = li.buildIndex();
      this.indexHealthy = true;
      this.refresh();
      void this.snapshotIndex();
      notice.setMessage(healResultMessage(report.added, knownEmpty.length + report.skippedEmpty.length, report.failed.length));
    } catch (e) {
      console.warn("vault-rag: healVault failed", e);
      notice.setMessage(this.persistBlockedMessage(e, "Vervollständigen fehlgeschlagen."));
    } finally {
      this.embeddingProgress.reindex = null;
      this.embeddingProgress.isEmbedding = false;
      this.syncProgress();
      if (statusReveal) this.setStatusBarVisible(this.settings.showStatusBar);
      window.setTimeout(() => notice.hide(), 4000);
    }
  }

  currentHits(): Hit[] {
    const f = this.app.workspace.getActiveFile();
    if (!f) return [];
    const r = this.facade.related(f.path);
    return r.kind === "hits" ? r.hits : [];
  }

  refresh() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HUB)) {
      const v = leaf.view;
      if (v instanceof VaultRetrievalView) v.refreshContext();
    }
  }

  /** Offene Smart-Apply-Cockpits sofort neu ranken (z.B. nach Vorlagenpfad-Änderung). */
  refreshSmartApplyRanking(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HUB)) {
      const v = leaf.view;
      if (v instanceof VaultRetrievalView) v.refreshRanking();
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    if (!this.indexHealthy) {
      this.statusBarEl.setText("⚠ Suchindex beschädigt");
      return;
    }
    const p = this.embeddingProgress;
    if (p.reindex) {
      this.statusBarEl.setText(`↻ Indiziere ${p.reindex.done.toLocaleString("de-DE")}/${p.reindex.total.toLocaleString("de-DE")}`);
    } else if (p.isEmbedding) {
      this.statusBarEl.setText("↻ embedding…");
    } else if (p.pendingNotes > 0) {
      this.statusBarEl.setText(`● ${p.embeddedNotes.toLocaleString("de-DE")} | ⏳ ${p.pendingNotes}`);
    } else {
      this.statusBarEl.setText(`● ${p.embeddedNotes.toLocaleString("de-DE")}`);
    }
  }

  setStatusBarVisible(show: boolean): void {
    if (show && !this.statusBarEl) {
      this.statusBarEl = this.addStatusBarItem();
      this.updateStatusBar();
    } else if (!show && this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
  }

  private syncProgress(): void {
    this.embeddingProgress.embeddedNotes = this.liveIndexer.noteCount;
    this.embeddingProgress.pendingNotes = this.pendingQueue.size;
    this.updateStatusBar();
  }

  private async runSearch(query: string): Promise<SearchResult> {
    return this.facade.search(query);
  }

  // SEAM-VERTRAG (5): templatePath="" → auto-detect; non-empty → direkt verwenden (Picker entfällt).
  // Picker (pickTemplate) bleibt im Code, wird im Cockpit-Fluss nicht mehr aufgerufen.
  private async proposeSmartApply(
    notePath: string,
    templatePath: string,
    mode: ApplyMode,
    onToken: (t: string) => void,
    onReasoning: (t: string) => void,
  ): Promise<ApplyProposal> {
    const core = this.smartApply;
    if (!core) throw new Error("Smart Apply ist deaktiviert");
    if (templatePath !== "") {
      // Explizite Vorlage aus dem Cockpit-Dropdown — direkt verwenden, kein detect().
      return core.propose(notePath, templatePath, mode, onToken, onReasoning);
    }
    // Auto-detect: detect() ONCE — avoid double embed+search sweep.
    const detection = await core.detect(notePath);
    let tpl = detection.templatePath;
    if (!tpl) {
      const list = templateFilesUnder(this.app.vault.getMarkdownFiles().map(f => f.path), this.settings.templateDir);
      if (list.length === 1) {
        tpl = list[0];
      } else if (list.length === 0) {
        new Notice("Keine Vorlage in " + this.settings.templateDir + " — lege eine an");
        throw new Error("keine-vorlage");
      } else {
        throw new Error("vorlage-waehlen");
      }
    }
    // SEAM-VERTRAG (7): Live-Stream-Callbacks der View durchreichen (genau ein Stream in propose).
    return core.propose(notePath, tpl, mode, onToken, onReasoning, undefined, detection);
  }

  /** Liest+parst die Vorlage und liefert ihren defaultMode; Fallback auf den Settings-Default,
   *  falls die Vorlage nicht gelesen/geparst werden kann (z.B. noch keine Auswahl getroffen). */
  private async templateDefaultMode(templatePath: string): Promise<ApplyMode> {
    try {
      const text = await this.app.vault.adapter.read(templatePath);
      return parseTemplate(text).defaultMode;
    } catch {
      return this.settings.smartApplyDefaultMode;
    }
  }

  /** Generiert bei Bedarf einen Token, speichert ihn und gibt ihn zurück. */
  ensureMcpToken(): string {
    if (!this.settings.mcpToken) { this.settings.mcpToken = generateToken(); void this.saveSettings(); }
    return this.settings.mcpToken;
  }

  mcpServerRunning(): boolean { return this.mcpServer !== null; }
  mcpServerAddress(): string | null {
    return this.mcpServer ? `http://127.0.0.1:${this.mcpServer.port}/mcp` : null;
  }

  mcpStartError(): string | null { return this.mcpLastStartError; }

  /** Neuen Token erzeugen, persistieren, Server neu starten. Alte Clients werden ungültig. */
  async rotateMcpToken(): Promise<void> {
    this.settings.mcpToken = generateToken();
    await this.saveSettings();
    await this.restartMcpServer();
  }

  /** Ruft den eigenen Loopback-Server wie ein externer Client (initialize) und klassifiziert. */
  async mcpSelfCheck(): Promise<SelfCheckResult> {
    const url = this.mcpServerAddress();
    if (!url) return "unreachable";
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vault-retrieval-selfcheck", version: this.manifest.version } },
    });
    let timer: number | undefined;
    const timeout = new Promise<"__timeout__">(resolve => {
      timer = window.setTimeout(() => resolve("__timeout__"), 5000);
    });
    try {
      const raced = await Promise.race([
        requestUrl({
          url, method: "POST", throw: false,
          headers: {
            "Authorization": `Bearer ${this.settings.mcpToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
          },
          body,
        }),
        timeout,
      ]);
      if (raced === "__timeout__") return classifySelfCheck({ networkError: true, status: 0, bodyText: "" });
      return classifySelfCheck({ networkError: false, status: raced.status, bodyText: raced.text });
    } catch (e) {
      console.warn("vault-rag: MCP-Selbsttest fehlgeschlagen", e);
      return classifySelfCheck({ networkError: true, status: 0, bodyText: "" });
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  /** Startet den Server, wenn aktiviert und Desktop. Idempotent (stoppt vorher).
   *  Läuft serialisiert über runMcpOp (Fix 2) — siehe doStartMcpServer. */
  async startMcpServerIfEnabled(): Promise<void> {
    return this.runMcpOp(() => this.doStartMcpServer());
  }

  private async doStartMcpServer(): Promise<void> {
    await this.stopMcpServer();
    if (Platform.isMobile || !this.settings.mcpEnabled) return;
    const token = this.ensureMcpToken();
    try {
      const { startMcpServer } = await import("./mcp/http_server");
      // Lese-Schutz für externe Agents: es passieren nur Pfade, die Obsidian selbst als
      // Vault-Datei kennt. Bewusst über die Vault-API statt über node:fs/realpath — der
      // Store-Scan flaggt jeden direkten fs-Zugriff ("Direct Filesystem Access"), und ein
      // Symlink, den Obsidian als Vault-Datei listet, liest Obsidian ohnehin selbst.
      // Path-Traversal ist damit strenger abgedeckt als zuvor (Spec 2026-07-23).
      const { makeVaultReadGuard } = await import("./mcp/vault_read_guard");
      this.guardedRead = makeVaultReadGuard(
        (rel) => this.app.vault.getAbstractFileByPath(normalizePath(rel)) instanceof TFile,
        (rel) => this.app.vault.adapter.read(rel),
      );
      const tools = new McpTools(this.facade);
      this.mcpServer = await startMcpServer({ port: this.settings.mcpPort, token, tools, version: this.manifest.version });
      this.mcpLastStartError = null;
    } catch (e) {
      this.mcpLastStartError = mapStartError(e as { code?: string; message?: string });
      console.warn("vault-rag: MCP-Server-Start fehlgeschlagen", e);
      new Notice(`⚠ MCP-Server konnte nicht starten (${this.mcpLastStartError}): ${String((e as Error).message ?? e)}`, 8000);
      this.mcpServer = null;
    }
  }

  async stopMcpServer(): Promise<void> {
    if (this.mcpServer) { try { await this.mcpServer.close(); } catch { /* egal */ } this.mcpServer = null; }
  }

  /** Vollständiger Neustart (nach Toggle/Port/Token-Änderung in den Settings). Serialisiert
   *  über denselben mcpOpChain wie startMcpServerIfEnabled — konkurrierende Aufrufe (z.B. schnell
   *  hintereinander getippte Port-Änderungen) können sich dadurch nicht überholen. */
  async restartMcpServer(): Promise<void> {
    return this.runMcpOp(() => this.doStartMcpServer());
  }

  async saveSettings() { await this.saveData(this.settings); }
}
