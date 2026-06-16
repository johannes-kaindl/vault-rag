import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import { IndexLoader, VaultIndex } from "./index";
import { Retriever, Hit } from "./retriever";
import { RelatedNotesView, VIEW_TYPE_RELATED } from "./view";
import { DEFAULT_SETTINGS, VaultRagSettings, VaultRagSettingTab } from "./settings";

export default class VaultRagPlugin extends Plugin {
  settings!: VaultRagSettings;
  private index: VaultIndex | null = null;
  private retriever: Retriever | null = null;
  private lastMtime = 0;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new VaultRagSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_RELATED, (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, {
      getHits: () => this.currentHits(),
      openPath: (p) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
      },
    }));
    this.addRibbonIcon("search", "Verwandte Notizen", () => this.activateView());
    this.addCommand({ id: "open-related", name: "Verwandte Notizen öffnen", callback: () => this.activateView() });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    await this.loadIndex();
    this.registerInterval(window.setInterval(() => this.maybeReload(), 30000)); // Index-Refresh nach Sync
  }

  async loadIndex() {
    try {
      this.index = await new IndexLoader(this.app.vault.adapter, this.settings.indexDir).load();
      this.retriever = new Retriever(this.index);
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st) this.lastMtime = st.mtime;
      this.refresh();
    } catch (e) { this.index = null; this.retriever = null; console.warn("vault-rag: loadIndex failed", e); }
  }

  async maybeReload() {
    try {
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st && st.mtime !== this.lastMtime) { this.lastMtime = st.mtime; await this.loadIndex(); }
    } catch { /* noch kein Index */ }
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

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_RELATED, active: true });
  }

  async saveSettings() { await this.saveData(this.settings); }
}
