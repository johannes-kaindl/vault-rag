import { ItemView, WorkspaceLeaf } from "obsidian";
import { Hit } from "./retriever";

export const VIEW_TYPE_RELATED = "vault-rag-related";

export interface ViewDeps { getHits: () => Hit[]; openPath: (path: string) => void; }

export function renderHits(el: HTMLElement, hits: Hit[], openPath: (path: string) => void): void {
  for (const h of hits) {
    const row = el.createDiv({ cls: "vault-rag-hit" });
    const name = h.path.split("/").pop()?.replace(/\.md$/, "") ?? h.path;
    row.createEl("span", { cls: "vault-rag-hit-title", text: name });
    row.createEl("span", { cls: "vault-rag-hit-score", text: h.score.toFixed(2) });
    row.addEventListener("click", () => openPath(h.path));
  }
}

export class RelatedNotesView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private deps: ViewDeps) { super(leaf); }
  getViewType() { return VIEW_TYPE_RELATED; }
  getDisplayText() { return "Verwandte Notizen"; }
  getIcon() { return "search"; }
  async onOpen() { this.render(); }
  render() {
    const c = this.contentEl; c.empty();
    const hits = this.deps.getHits();
    if (hits.length === 0) { c.createDiv({ cls: "vault-rag-empty", text: "Keine verwandten Notizen (oder Notiz noch nicht indexiert)." }); return; }
    renderHits(c, hits, this.deps.openPath);
  }
}
