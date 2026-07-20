import { Hit } from "./retriever";
import { HubPanel, TabId } from "./hub_panel";

export const VIEW_TYPE_RELATED = "vault-rag-related";

export interface ViewDeps { getHits: () => Hit[]; openPath: (path: string) => void; }

export function renderHits(el: HTMLElement, hits: Hit[], openPath: (path: string) => void): void {
  for (const h of hits) {
    const row = el.createDiv({ cls: "vault-rag-hit" });
    const name = h.path.split("/").pop()?.replace(/\.md$/, "") ?? h.path;
    row.createSpan({ cls: "vault-rag-hit-title", text: name });
    row.createSpan({ cls: "vault-rag-hit-score", text: h.score.toFixed(2) });
    row.addEventListener("click", () => openPath(h.path));
  }
}

export class RelatedPanel implements HubPanel {
  readonly id: TabId = "related";
  readonly label = "Ähnlich";
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
  destroy(): void {}

  /** Public, damit der Hub nach Index-Reload extern refreshen kann. */
  refreshContext(): void {
    const c = this.container; c.empty();
    const hits = this.deps.getHits();
    if (hits.length === 0) { c.createDiv({ cls: "vault-rag-empty", text: "Keine verwandten Notizen (oder Notiz noch nicht indexiert)." }); return; }
    renderHits(c, hits, this.deps.openPath);
  }
}
