import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Notice } from "obsidian";
import { IndexLoader, VaultIndex } from "./index";
import { Retriever, Hit } from "./retriever";
import { RelatedNotesView, VIEW_TYPE_RELATED } from "./view";
import { DEFAULT_SETTINGS, VaultRagSettings, VaultRagSettingTab } from "./settings";
import { EmbeddingClient } from "./embedder";
import { LiveIndexer } from "./live_indexer";
import { PendingQueue } from "./pending_queue";
import { SemanticSearchView, VIEW_TYPE_SEARCH, SearchResult } from "./search_view";
import { toIndexVector } from "./embed_vector";
import { ChatClient } from "./chat_client";
import { buildContext } from "./context_source";
import { pickNote } from "./note_picker";
import { ChatSession } from "./chat_session";
import { ChatView, VIEW_TYPE_CHAT } from "./chat_view";
import { SmartApply, type ApplyProposal } from "./smart_apply";
import { SmartApplyView, VIEW_TYPE_SMART_APPLY } from "./smart_apply_view";
import { extractType, templateFilesUnder } from "./template_matcher";
import { TemplateRanker } from "./template_ranker";
import type { TemplateRank } from "./template_ranker";

export interface EmbeddingProgress {
  isEmbedding: boolean;
  embeddedNotes: number;
  pendingNotes: number;
  /** Während eines Voll-Reindex: Fortschritt durch die Notiz-Liste; sonst null. */
  reindex: { done: number; total: number } | null;
}

export default class VaultRagPlugin extends Plugin {
  settings!: VaultRagSettings;
  private index: VaultIndex | null = null;
  private retriever: Retriever | null = null;
  private lastMtime = 0;
  embedder!: EmbeddingClient;
  chatClient!: ChatClient;
  private smartApply: SmartApply | null = null;
  private templateRanker?: TemplateRanker;
  private liveIndexer!: LiveIndexer;
  private pendingQueue!: PendingQueue;
  private debounceTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
  embeddingProgress: EmbeddingProgress = {
    isEmbedding: false,
    embeddedNotes: 0,
    pendingNotes: 0,
    reindex: null,
  };
  private statusBarEl: HTMLElement | null = null;

  private openPath = (p: string): void => {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  };

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultRagSettings>);
    this.embedder = new EmbeddingClient(this.settings.embeddingEndpoint, this.settings.embeddingModel);
    this.chatClient = new ChatClient(this.settings.chatEndpoint, this.settings.chatModel);
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, this.settings.indexDir, this.embedder, this.settings.embeddingModel);
    this.pendingQueue = new PendingQueue(this.app.vault.adapter, this.settings.indexDir);

    this.addSettingTab(new VaultRagSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_RELATED, (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, {
      getHits: () => this.currentHits(),
      openPath: this.openPath,
    }));
    this.registerView(VIEW_TYPE_SEARCH, (leaf: WorkspaceLeaf) => new SemanticSearchView(leaf, {
      search: (q) => this.runSearch(q),
      openPath: this.openPath,
    }));
    this.addRibbonIcon("search", "Verwandte Notizen", () => this.activateView());
    this.addCommand({ id: "open-related", name: "Verwandte Notizen öffnen", callback: () => this.activateView() });
    this.addRibbonIcon("telescope", "Semantische Suche", () => this.activateSearchView());
    this.addCommand({ id: "open-semantic-search", name: "Semantische Suche öffnen", callback: () => this.activateSearchView() });
    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, {
      session: new ChatSession({
        client: () => this.chatClient,
        assemble: (paths) => buildContext(paths, {
          read: (p) => this.app.vault.adapter.read(p),
          budget: this.settings.contextCharBudget,
        }),
        systemPreamble: () => this.settings.chatSystemPrompt,
        params: () => ({ model: this.settings.chatModel, temperature: this.settings.chatTemperature, suppressThinking: this.settings.suppressThinking }),
      }),
      openPath: this.openPath,
      copyText: (t: string) => { void navigator.clipboard.writeText(t); new Notice("Kopiert"); },
      ping: () => this.chatClient.ping(),
      listModels: () => this.chatClient.listModels(),
      getModel: () => this.settings.chatModel,
      setModel: (m: string) => { this.settings.chatModel = m; void this.saveSettings(); },
      inputPosition: () => this.settings.chatInputPosition,
      getActivePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      embed: async (q) => {
        const index = this.index;
        if (!index) throw new Error("kein Index");
        const vecs = await this.embedder.embed([q]);
        if (vecs.length === 0) throw new Error("embed: leere Antwort");
        return toIndexVector(vecs, index.dim);
      },
      search: (vec, n) => {
        const retriever = this.retriever;
        return retriever ? retriever.search(vec, { k: n, minSim: this.settings.minSim, exclude: this.settings.exclude }).map(h => h.path) : [];
      },
      pickNote: () => pickNote(this.app),
      autoK: this.settings.chatK,
      getSuppress: () => this.settings.suppressThinking,
      setSuppress: (v: boolean) => { this.settings.suppressThinking = v; void this.saveSettings(); },
      enterSends: () => this.settings.enterSends,
    }));
    this.addRibbonIcon("message-square", "Vault Chat", () => this.activateChatView());
    this.addCommand({ id: "open-vault-chat", name: "Vault Chat öffnen", callback: () => this.activateChatView() });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));

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
            const index = this.index;
            if (!index) throw new Error("kein Index");
            const vecs = await this.embedder.embed([t]);
            if (vecs.length === 0) throw new Error("embed: leere Antwort");
            return toIndexVector(vecs, index.dim);
          },
          search: (vec, opts) => {
            const retriever = this.retriever;
            return retriever ? retriever.search(vec, opts) : [];
          },
        },
        () => this.chatClient,
        () => ({
          model: this.settings.smartApplyModel || this.settings.chatModel,
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
          const index = this.index;
          if (!index) throw new Error("kein Index");
          const vecs = await this.embedder.embed([t]);
          if (vecs.length === 0) throw new Error("embed: leere Antwort");
          return toIndexVector(vecs, index.dim);
        },
      });
      this.registerView(VIEW_TYPE_SMART_APPLY, (leaf: WorkspaceLeaf) => new SmartApplyView(leaf, {
        // SEAM-VERTRAG (7): build/reroll tragen templatePath + die Live-Stream-Callbacks der View.
        build: (notePath, templatePath, onToken, onReasoning) => this.proposeSmartApply(notePath, templatePath, onToken, onReasoning),
        accept: (p) => this.smartApply!.persistApply(p),
        reroll: (p, templatePath, onToken, onReasoning) => this.proposeSmartApply(p.notePath, templatePath, onToken, onReasoning),
        openPath: this.openPath,
        abort: () => { this.smartApply?.abort(); },
        activeNotePath: () => {
          const f = this.app.workspace.getActiveFile();
          return f instanceof TFile && f.extension === "md" ? f.path : null;
        },
        listModels: () => this.chatClient.listModels(),
        ping: () => this.chatClient.ping(),
        getModel: () => this.settings.smartApplyModel || this.settings.chatModel,
        setModel: (m: string) => { this.settings.smartApplyModel = m; void this.saveSettings(); },
        rankTemplates: (notePath: string): Promise<TemplateRank[]> => this.templateRanker!.rank(notePath),
        getSuppress: () => this.settings.smartApplySuppressThinking,
        setSuppress: (v: boolean) => { this.settings.smartApplySuppressThinking = v; void this.saveSettings(); },
      }));
      this.addRibbonIcon("wand-2", "Smart Apply", () => void this.activateSmartApplyView());
      this.addCommand({
        id: "smart-apply-active-note",
        name: "Smart Apply auf aktive Notiz",
        checkCallback: (checking: boolean) => {
          const f = this.app.workspace.getActiveFile();
          const ok = f instanceof TFile && f.extension === "md";
          if (ok && !checking) void this.activateSmartApplyView();
          return ok;
        },
      });
    }

    this.addCommand({
      id: "reindex-vault",
      name: "Vault neu indizieren",
      callback: () => void this.reindexVault(),
    });

    if (this.settings.showStatusBar) this.setStatusBarVisible(true);
  }

  reconnectEmbedder(): void {
    this.embedder = new EmbeddingClient(this.settings.embeddingEndpoint, this.settings.embeddingModel);
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, this.settings.indexDir, this.embedder, this.settings.embeddingModel);
    if (this.index) this.liveIndexer.init(this.index);
  }

  reconnectChat(): void {
    this.chatClient = new ChatClient(this.settings.chatEndpoint, this.settings.chatModel);
  }

  async loadIndex() {
    try {
      this.index = await new IndexLoader(this.app.vault.adapter, this.settings.indexDir).load();
      this.retriever = new Retriever(this.index);
      this.liveIndexer.init(this.index);
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st) this.lastMtime = st.mtime;
      this.refresh();
      this.syncProgress();
    } catch (e) {
      this.index = null; this.retriever = null;
      console.warn("vault-rag: loadIndex failed", e);
    }
  }

  async maybeReload() {
    try {
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st && st.mtime !== this.lastMtime) { this.lastMtime = st.mtime; await this.loadIndex(); }
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
    if (path.startsWith(".")) return;
    if (this.settings.exclude.some(e => path.startsWith(e))) return;
    if (path.startsWith(this.settings.indexDir + "/")) return;
    let content: string;
    try { content = await this.app.vault.adapter.read(path); } catch { return; }

    if (await this.embedder.ping()) {
      this.embeddingProgress.isEmbedding = true;
      try {
        await this.liveIndexer.update(path, content);
        this.index = this.liveIndexer.buildIndex();
        this.retriever = new Retriever(this.index);
        await this.liveIndexer.persist();
        this.syncProgress();
        this.refresh();
      } catch {
        await this.pendingQueue.add(path);
        this.syncProgress();
      } finally {
        this.embeddingProgress.isEmbedding = false;
      }
    } else {
      await this.pendingQueue.add(path);
      this.syncProgress();
    }
  }

  private async handleDelete(path: string): Promise<void> {
    if (path.startsWith(".")) return;
    if (!(await this.embedder.ping())) return;
    this.liveIndexer.remove(path);
    this.index = this.liveIndexer.buildIndex();
    this.retriever = new Retriever(this.index);
    await this.liveIndexer.persist();
    this.syncProgress();
    this.refresh();
  }

  private async handleRename(newPath: string, oldPath: string): Promise<void> {
    if (newPath.startsWith(".") || oldPath.startsWith(".")) return;
    if (await this.embedder.ping()) {
      this.liveIndexer.rename(oldPath, newPath);
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist();
      this.syncProgress();
      this.refresh();
    } else {
      await this.pendingQueue.add(newPath);
      this.syncProgress();
    }
  }

  private async maybeDrainPending(): Promise<void> {
    if (this.pendingQueue.size === 0) return;
    if (!(await this.embedder.ping())) return;
    await this.drainPending();
  }

  private async drainPending(): Promise<void> {
    const paths = this.pendingQueue.drain();
    try {
      this.embeddingProgress.isEmbedding = true;
      for (const path of paths) {
        try {
          const content = await this.app.vault.adapter.read(path);
          await this.liveIndexer.update(path, content);
        } catch { /* Datei gelöscht oder unlesbar — überspringen */ }
      }
      // drain() hat in-memory bereits geleert; clear() nicht aufrufen —
      // sonst gehen Paths verloren die während des await-Loops neu reinkamen.
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist();
      this.syncProgress();
      this.refresh();
    } catch {
      this.syncProgress();
    } finally {
      this.embeddingProgress.isEmbedding = false;
    }
  }

  async reindexVault(): Promise<void> {
    if (!(await this.embedder.ping())) {
      new Notice("Embedding-Endpoint nicht erreichbar — Vault-Indizierung abgebrochen.");
      return;
    }
    const allPaths = this.app.vault.getMarkdownFiles().map(f => f.path).filter(p => {
      if (p.startsWith(".")) return false;
      if (this.settings.exclude.some(e => p.startsWith(e))) return false;
      if (p.startsWith(this.settings.indexDir + "/")) return false;
      return true;
    });
    const total = allPaths.length;
    const notice = new Notice(`Indiziere Vault… 0/${total}`, 0);
    // Statusleiste fürs Reindex einblenden (falls aus), damit man die Notice wegklicken kann
    // und den Fortschritt unten weiterverfolgt; am Ende auf das Setting zurücksetzen.
    const statusReveal = !this.statusBarEl;
    if (statusReveal) this.setStatusBarVisible(true);
    this.embeddingProgress.isEmbedding = true;
    this.embeddingProgress.reindex = { done: 0, total };
    this.updateStatusBar();
    let lastIndexed = 0;
    try {
      await this.liveIndexer.reindexAll(
        allPaths,
        (p) => this.app.vault.adapter.read(p),
        (done, indexed, tot) => {
          lastIndexed = indexed;
          this.embeddingProgress.reindex = { done, total: tot };
          this.updateStatusBar();
          notice.setMessage(`Indiziere Vault… ${done}/${tot}`);
        },
      );
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist();
      this.refresh();
      notice.setMessage(`Vault indiziert: ${lastIndexed} Notizen.`);
    } catch (e) {
      console.warn("vault-rag: reindexVault failed", e);
      notice.setMessage("Vault-Indizierung fehlgeschlagen.");
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
    if (!f || !this.retriever) return [];
    return this.retriever.related(f.path, { k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude });
  }

  refresh() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED)) {
      const v = leaf.view as RelatedNotesView;
      v.render?.();
    }
  }

  /** Offene Smart-Apply-Cockpits sofort neu ranken (z.B. nach Vorlagenpfad-Änderung). */
  refreshSmartApplyRanking(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SMART_APPLY)) {
      const v = leaf.view;
      if (v instanceof SmartApplyView) v.refreshRanking();
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
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

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED);
    if (existing.length) { void this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_RELATED, active: true });
  }

  private async runSearch(query: string): Promise<SearchResult> {
    // Snapshot vor den awaits: maybeReload() (30s) könnte index/retriever zwischenzeitlich nullen.
    const retriever = this.retriever;
    const index = this.index;
    if (!retriever || !index) return { kind: "no-index" };
    if (!(await this.embedder.ping())) return { kind: "offline" };
    try {
      const vecs = await this.embedder.embed([query]);
      if (vecs.length === 0) throw new Error("embed: leere Antwort");
      const qVec = toIndexVector(vecs, index.dim);
      const hits = retriever.search(qVec, {
        k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude,
      });
      return { kind: "hits", hits };
    } catch {
      return { kind: "offline" };
    }
  }

  async activateSearchView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH);
    if (existing.length) { void this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_SEARCH, active: true });
  }

  async activateChatView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    if (existing.length) { void this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
  }

  // SEAM-VERTRAG (5): templatePath="" → auto-detect; non-empty → direkt verwenden (Picker entfällt).
  // Picker (pickTemplate) bleibt im Code, wird im Cockpit-Fluss nicht mehr aufgerufen.
  private async proposeSmartApply(
    notePath: string,
    templatePath: string,
    onToken: (t: string) => void,
    onReasoning: (t: string) => void,
  ): Promise<ApplyProposal> {
    const core = this.smartApply;
    if (!core) throw new Error("Smart Apply ist deaktiviert");
    if (templatePath !== "") {
      // Explizite Vorlage aus dem Cockpit-Dropdown — direkt verwenden, kein detect().
      return core.propose(notePath, templatePath, onToken, onReasoning);
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
    return core.propose(notePath, tpl, onToken, onReasoning, undefined, detection);
  }

  // Reveal-only: öffnet/enthüllt das Cockpit; Trigger läuft über den Cockpit-Button.
  async activateSmartApplyView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SMART_APPLY);
    const leaf = existing.length ? existing[0] : this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing.length) await leaf.setViewState({ type: VIEW_TYPE_SMART_APPLY, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings() { await this.saveData(this.settings); }
}
