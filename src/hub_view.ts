import { ItemView, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { HubPanel, TabId } from "./hub_panel";

export const VIEW_TYPE_HUB = "vault-retrieval-hub";

export interface HubController {
  setTab(id: TabId): void;
  notifyFileOpen(path: string | null): void;
  currentTab(): TabId;
  destroy(): void;
}

export class VaultRetrievalView extends ItemView {
  private ctrl: HubController | null = null;

  constructor(leaf: WorkspaceLeaf, private panels: HubPanel[], private navState: TabId) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_HUB; }
  getDisplayText(): string { return "Vault Retrieval"; }
  getIcon(): string { return "layers"; }

  async onOpen(): Promise<void> {
    this.ctrl = VaultRetrievalView.buildInto(this.contentEl, this.panels, this.navState);
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

  // ── Reine Aufbau-/Navigationslogik (node-testbar, ohne Obsidian) ──────────
  static buildInto(root: HTMLElement, panels: HubPanel[], defaultTab: TabId): HubController {
    root.empty();
    root.addClass("vault-rag-hub-root");
    const tabsEl = root.createDiv({ cls: "vault-rag-hub-tabs" });
    const contentEl = root.createDiv({ cls: "vault-rag-hub-content" });
    const panelDivs = new Map<TabId, HTMLElement>();
    const tabBtns = new Map<TabId, HTMLElement>();
    let navState = defaultTab;

    const applyVisibility = (): void => {
      for (const [id, div] of panelDivs) div.toggleClass("is-hidden", id !== navState);
      for (const [id, btn] of tabBtns) btn.toggleClass("is-active", id === navState);
    };

    for (const panel of panels) {
      const btn = tabsEl.createEl("button", { cls: "vault-rag-hub-tab", attr: { "data-tab": panel.id } });
      const ic = btn.createSpan({ cls: "vault-rag-hub-tab-icon" }); setIcon(ic, panel.icon);
      btn.createSpan({ cls: "vault-rag-hub-tab-label", text: panel.label });
      btn.addEventListener("click", () => ctrl.setTab(panel.id));
      tabBtns.set(panel.id, btn);
      const div = contentEl.createDiv({ cls: "vault-rag-hub-panel", attr: { "data-tab": panel.id } });
      panelDivs.set(panel.id, div);
      panel.mount(div);
    }

    const ctrl: HubController = {
      currentTab: () => navState,
      setTab(id: TabId): void {
        if (id === navState) return;
        panels.find(p => p.id === navState)?.onHide?.();
        navState = id;
        applyVisibility();
        panels.find(p => p.id === navState)?.onShow?.();
      },
      notifyFileOpen(path: string | null): void { for (const p of panels) p.onFileOpen?.(path); },
      destroy(): void { for (const p of panels) p.destroy(); },
    };

    applyVisibility();
    panels.find(p => p.id === navState)?.onShow?.();   // Default-Panel initial onShow
    return ctrl;
  }
}
