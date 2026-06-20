import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ImgToMdState, ImgItem } from "./img_to_md_state";

export const VIEW_TYPE_IMGMD = "vault-rag-img";

export interface ImgToMdViewDeps {
  getActivePath: () => string | null;
  scan: (sourcePath: string) => Promise<ImgItem[]>;
  transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; reasoning: string; model: string }>;
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string }[]) => Promise<string[]>;
  ping: () => Promise<boolean>;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  openPath: (p: string) => void;
  copyText: (t: string) => void;
}

export class ImgToMdView extends ItemView {
  private state = new ImgToMdState();
  private statusEl: HTMLElement | null = null;
  private modelSel: HTMLSelectElement | null = null;
  private listEl: HTMLElement | null = null;
  private cardsEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private runBtn: HTMLElement | null = null;
  private controller: AbortController | null = null;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: ImgToMdViewDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_IMGMD; }
  getDisplayText(): string { return "IMG → MD"; }
  getIcon(): string { return "scan-text"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty(); c.addClass("vault-rag-img-root");
    this.statusEl = c.createDiv({ cls: "vault-rag-img-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    this.modelSel = c.createEl("select", { cls: "vault-rag-img-model dropdown" }) as HTMLSelectElement;
    this.modelSel.addEventListener("change", () => this.deps.setModel(this.modelSel?.value ?? ""));
    const head = c.createDiv({ cls: "vault-rag-img-head" });
    this.toggleBtn = head.createEl("button", { cls: "vault-rag-img-toggle", text: "Alle abwählen" });
    this.toggleBtn.addEventListener("click", () => { this.state.toggleAll(); this.renderList(); });
    this.runBtn = head.createEl("button", { cls: "vault-rag-img-run mod-cta", text: "Transkribieren" });
    this.runBtn.addEventListener("click", () => this.onRunClick());
    this.listEl = c.createDiv({ cls: "vault-rag-img-list" });
    this.cardsEl = c.createDiv({ cls: "vault-rag-img-cards" });
    const foot = c.createDiv({ cls: "vault-rag-img-foot" });
    foot.createEl("button", { cls: "vault-rag-img-all", text: "Alle anlegen" }).addEventListener("click", () => void this.writeAll());
    await this.refreshStatus();
    await this.refreshModels();
    await this.rescan();
  }

  async refreshStatus(): Promise<void> {
    const el = this.statusEl; if (!el) return;
    el.setText("Vision-LLM: prüfe…");
    const ok = await this.deps.ping();
    el.setText(ok ? "● Vision-LLM verbunden" : "○ Vision-LLM offline — in den Settings prüfen");
  }

  private async refreshModels(): Promise<void> {
    const sel = this.modelSel; if (!sel) return;
    const cur = this.deps.getModel();
    const models = await this.deps.listModels();
    sel.empty();
    const list = models.includes(cur) ? models : [cur, ...models];
    for (const m of list) { const o = sel.createEl("option", { text: m }) as HTMLOptionElement; o.value = m; }
    sel.value = cur;
  }

  async rescan(): Promise<void> {
    const path = this.deps.getActivePath();
    const items = path ? await this.deps.scan(path) : [];
    this.state.setItems(items);
    this.renderList();
  }

  /** Aktive Notiz gewechselt → Karten der alten Notiz verwerfen + neu scannen. */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.state.clearCards();
    this.renderCards();
    await this.rescan();
  }

  private basename(link: string): string { return link.split("/").pop() ?? link; }

  private renderList(): void {
    const el = this.listEl; if (!el) return; el.empty();
    this.toggleBtn?.setText(this.state.allSelected() ? "Alle abwählen" : "Alle auswählen");
    if (!this.state.items.length) { el.createDiv({ cls: "vault-rag-img-empty", text: "Keine Bilder in dieser Notiz." }); return; }
    for (const item of this.state.items) {
      const row = el.createDiv({ cls: "vault-rag-img-item" });
      const cb = row.createEl("input", { cls: "vault-rag-img-check" }) as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = this.state.isSelected(item.link);
      cb.disabled = !item.supported;
      cb.addEventListener("change", () => { this.state.toggle(item.link); this.renderList(); });
      const label = item.supported ? this.basename(item.link) : `${this.basename(item.link)} — nicht unterstützt`;
      row.createEl("span", { cls: "vault-rag-img-name", text: label });
    }
  }

  private renderCards(): void { /* Task 8 */ const el = this.cardsEl; if (el) el.empty(); }

  private onRunClick(): void { /* Task 8 */ }
  async run(): Promise<void> { /* Task 8 */ }
  async writeOne(_i: number): Promise<void> { /* Task 9 */ }
  async writeAll(): Promise<void> { /* Task 9 */ }

  async onClose(): Promise<void> {
    this.controller?.abort();
    this.contentEl.removeClass("vault-rag-img-root");
  }
}
