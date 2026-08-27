import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import type { HubPanel, TabId } from "./hub_panel";
import { buildHubInto, type HubController } from "./vendor/kit-obsidian/hub";

export const VIEW_TYPE_HUB = "vault-retrieval-hub";

export class VaultRetrievalView extends ItemView {
  private ctrl: HubController<TabId> | null = null;

  constructor(leaf: WorkspaceLeaf, private panels: HubPanel[], private navState: TabId) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_HUB; }
  getDisplayText(): string { return "Vault Retrieval"; }
  getIcon(): string { return "layers"; }

  async onOpen(): Promise<void> {
    this.ctrl = buildHubInto(this.contentEl, this.panels, this.navState);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.emitFileOpen()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.emitFileOpen()));
  }

  async onClose(): Promise<void> {
    this.ctrl?.destroy();
    this.ctrl = null;
    this.contentEl.empty();
  }

  private emitFileOpen(): void {
    this.ctrl?.notifyFileOpen(this.app.workspace.getActiveFile()?.path ?? null);
  }

  // ── Public API für main.ts ────────────────────────────────────────────────
  showTab(id: TabId): void { this.ctrl?.setTab(id); this.navState = id; }
  refreshContext(): void { this.emitFileOpen(); }
  refreshRanking(): void {
    const sa = this.panels.find(p => p.id === "smart-apply") as { refreshRanking?: () => void } | undefined;
    sa?.refreshRanking?.();
  }

  getState(): Record<string, unknown> { return { tab: this.ctrl?.currentTab() ?? this.navState }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const tab = (state as { tab?: TabId } | null)?.tab;
    if (tab) { this.navState = tab; this.ctrl?.setTab(tab); }
    return super.setState(state, result);
  }
}
