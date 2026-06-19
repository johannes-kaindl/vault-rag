export interface ContextPanelDeps {
  embed: (q: string) => Promise<Float32Array>;
  search: (vec: Float32Array, n: number) => string[];
  getActivePath: () => string | null;
  pickNote: () => Promise<string | null>;
}

const MIN_QUERY = 3;
const BUFFER = 20;

/** Editierbare Live-Kontext-Liste: gepinnte Notizen (sticky) + Auto-RAG-Treffer (live).
 *  Timer-frei — der Debounce lebt in der ChatView, damit der Panel-State unit-testbar bleibt. */
export class ContextPanel {
  pinned: string[] = [];
  excluded = new Set<string>();
  autoDocs: string[] = [];
  private ranked: string[] = [];
  private lastQuery = "";
  private queryGeneration = 0;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private kEl: HTMLElement | null = null;

  constructor(private deps: ContextPanelDeps, public autoK: number) {}

  mount(el: HTMLElement): void {
    el.empty();
    const head = el.createDiv({ cls: "vault-rag-ctx-head" });
    this.countEl = head.createEl("span", { cls: "vault-rag-ctx-count", text: "Kontext (0)" });
    const kWrap = head.createDiv({ cls: "vault-rag-ctx-k" });
    kWrap.createEl("button", { cls: "vault-rag-ctx-kdec", text: "−" }).addEventListener("click", () => this.setAutoK(this.autoK - 1));
    this.kEl = kWrap.createEl("span", { cls: "vault-rag-ctx-kval", text: `Auto ${this.autoK}` });
    kWrap.createEl("button", { cls: "vault-rag-ctx-kinc", text: "+" }).addEventListener("click", () => this.setAutoK(this.autoK + 1));
    head.createEl("button", { cls: "vault-rag-ctx-active", text: "+ Aktive Notiz" }).addEventListener("click", () => this.addActive());
    head.createEl("button", { cls: "vault-rag-ctx-pick", text: "+ Notiz" }).addEventListener("click", () => void this.addViaPicker());
    this.listEl = el.createDiv({ cls: "vault-rag-ctx-list" });
    this.render();
  }

  async setQuery(q: string): Promise<void> {
    const gen = ++this.queryGeneration;   // gegen Out-of-Order-Embeds (langsamer Embedder)
    const query = q.trim();
    this.lastQuery = query;
    if (query.length < MIN_QUERY) { this.ranked = []; this.recompute(); return; }
    try {
      const vec = await this.deps.embed(query);
      if (gen !== this.queryGeneration) return;   // ein neuerer setQuery hat gewonnen
      this.ranked = this.deps.search(vec, this.autoK + BUFFER);
    } catch {
      if (gen !== this.queryGeneration) return;
      this.ranked = [];
    }
    this.recompute();
  }

  private recompute(): void {
    this.autoDocs = this.ranked.filter(p => !this.pinned.includes(p) && !this.excluded.has(p)).slice(0, this.autoK);
    this.render();
  }

  pin(path: string): void { if (!this.pinned.includes(path)) { this.pinned.push(path); this.recompute(); } }
  unpin(path: string): void { this.pinned = this.pinned.filter(p => p !== path); this.recompute(); }
  excludeAuto(path: string): void { this.excluded.add(path); this.recompute(); }
  addActive(): void { const p = this.deps.getActivePath(); if (p) this.pin(p); }
  async addViaPicker(): Promise<void> { const p = await this.deps.pickNote(); if (p) this.pin(p); }
  setAutoK(n: number): void {
    const next = Math.max(0, n);
    const increasing = next > this.autoK;
    this.autoK = next;
    this.kEl?.setText(`Auto ${this.autoK}`);
    // Bei Erhöhung über den geholten Puffer hinaus neu retrieven, sonst nur neu rechnen.
    if (increasing && this.ranked.length < next + this.pinned.length && this.lastQuery.length >= MIN_QUERY) {
      void this.setQuery(this.lastQuery);
    } else {
      this.recompute();
    }
  }
  currentPaths(): string[] { return [...new Set([...this.pinned, ...this.autoDocs])]; }
  reset(): void { this.excluded.clear(); this.recompute(); }

  private render(): void {
    const el = this.listEl; if (!el) return; el.empty();
    this.countEl?.setText(`Kontext (${this.currentPaths().length})`);
    for (const p of this.pinned) {
      const chip = el.createEl("span", { cls: "vault-rag-ctx-chip is-pinned", text: `📌 ${this.basename(p)} ✕` });
      chip.addEventListener("click", () => this.unpin(p));
    }
    for (const p of this.autoDocs) {
      const chip = el.createEl("span", { cls: "vault-rag-ctx-chip is-auto", text: `${this.basename(p)} ✕` });
      chip.addEventListener("click", () => this.excludeAuto(p));
    }
  }

  private basename(p: string): string { return p.split("/").pop()?.replace(/\.md$/, "") ?? p; }
}
