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

export interface EmbeddingProgress {
  isEmbedding: boolean;
  embeddedNotes: number;
  pendingNotes: number;
}

export default class VaultRagPlugin extends Plugin {
  settings!: VaultRagSettings;
  private index: VaultIndex | null = null;
  private retriever: Retriever | null = null;
  private lastMtime = 0;
  embedder!: EmbeddingClient;
  chatClient!: ChatClient;
  private liveIndexer!: LiveIndexer;
  private pendingQueue!: PendingQueue;
  private debounceTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
  embeddingProgress: EmbeddingProgress = {
    isEmbedding: false,
    embeddedNotes: 0,
    pendingNotes: 0,
  };
  private statusBarEl: HTMLElement | null = null;

  private openPath = (p: string): void => {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  };

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    this.registerInterval(window.setInterval(() => this.maybeReload(), 30000));
    this.registerInterval(window.setInterval(() => void this.maybeDrainPending(), 60000));

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

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const p = this.embeddingProgress;
    if (p.isEmbedding) {
      (this.statusBarEl as any).setText("↻ embedding…");
    } else if (p.pendingNotes > 0) {
      (this.statusBarEl as any).setText(`● ${p.embeddedNotes.toLocaleString("de-DE")} | ⏳ ${p.pendingNotes}`);
    } else {
      (this.statusBarEl as any).setText(`● ${p.embeddedNotes.toLocaleString("de-DE")}`);
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

  async saveSettings() { await this.saveData(this.settings); }
}
