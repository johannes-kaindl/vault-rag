import type { Hit } from "./vendor/kit/vector-index";
import { renderHitList } from "./vendor/kit-obsidian/hit-list";
import { HubPanel, TabId } from "./hub_panel";
import { t } from "./vendor/kit/i18n";

export const VIEW_TYPE_RELATED = "vault-rag-related";

export interface ViewDeps { getHits: () => Hit[]; openPath: (path: string) => void; isPaused?: () => boolean; }

export class RelatedPanel implements HubPanel {
  readonly id: TabId = "related";
  get label(): string { return t("panel.related.label"); }
  readonly icon = "waypoints";
  private container!: HTMLElement;
  private visible = false;
  private dirty = false;

  constructor(private deps: ViewDeps) {}

  mount(container: HTMLElement): void { this.container = container; this.refreshContext(); }
  onShow(): void { this.visible = true; if (this.dirty) { this.refreshContext(); this.dirty = false; } }
  onHide(): void { this.visible = false; }
  onFileOpen(_path: string | null): void {
    if (this.visible) { this.refreshContext(); this.dirty = false; } else { this.dirty = true; }
  }
  onEmbeddingPause(): void { this.refreshContext(); }
  destroy(): void {}

  /** Public, damit der Hub nach Index-Reload extern refreshen kann. */
  refreshContext(): void {
    const c = this.container; c.empty();
    // Ohne den Hinweis sähe ein Stand von vor der Pause wie ein aktueller aus.
    if (this.deps.isPaused?.()) c.createDiv({ cls: "vault-rag-paused-hint", text: t("panel.related.pausedHint") });
    const hits = this.deps.getHits();
    if (hits.length === 0) { c.createDiv({ cls: "vault-rag-empty", text: t("panel.related.empty") }); return; }
    renderHitList(c, hits, this.deps.openPath);
  }
}
