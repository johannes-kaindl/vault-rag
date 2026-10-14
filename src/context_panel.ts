import { t } from "./vendor/kit/i18n";

export interface ContextPanelDeps {
  embed: (q: string) => Promise<Float32Array>;
  search: (vec: Float32Array, n: number) => string[];
  getActivePath: () => string | null;
  pickNote: () => Promise<string | null>;
  /** Embedding pausiert (Spec 2026-09-17, E3): dann geht nur Gepinntes mit, ohne Embedding-Aufruf. Fehlt der Anschluss: nie pausiert. */
  isPaused?: () => boolean;
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

  /** Wie viele Auto-Treffer gelten JETZT: während der Pause 0, der gespeicherte `autoK` bleibt dabei unberührt. */
  effectiveK(): number { return this.deps.isPaused?.() ? 0 : this.autoK; }

  mount(el: HTMLElement): void {
    el.empty();
    const head = el.createDiv({ cls: "vault-rag-ctx-head" });
    this.countEl = head.createSpan({ cls: "vault-rag-ctx-count", text: t("context.count", 0) });
    const kWrap = head.createDiv({ cls: "vault-rag-ctx-k" });
    kWrap.createEl("button", { cls: "vault-rag-ctx-kdec", text: "−" }).addEventListener("click", () => this.setAutoK(this.autoK - 1));
    this.kEl = kWrap.createSpan({ cls: "vault-rag-ctx-kval" });
    this.renderK();
    kWrap.createEl("button", { cls: "vault-rag-ctx-kinc", text: "+" }).addEventListener("click", () => this.setAutoK(this.autoK + 1));
    head.createEl("button", { cls: "vault-rag-ctx-active", text: t("context.addActive") }).addEventListener("click", () => this.addActive());
    head.createEl("button", { cls: "vault-rag-ctx-pick", text: t("context.addNote") }).addEventListener("click", () => void this.addViaPicker());
    this.listEl = el.createDiv({ cls: "vault-rag-ctx-list" });
    this.render();
  }

  async setQuery(q: string): Promise<void> {
    const gen = ++this.queryGeneration;   // gegen Out-of-Order-Embeds (langsamer Embedder)
    const query = q.trim();
    this.lastQuery = query;
    // k = 0 (Vanilla) und Pause: kein Embedding, nichts zu suchen — der Aufruf würde das Modell nur laden.
    if (query.length < MIN_QUERY || this.effectiveK() === 0) { this.ranked = []; this.recompute(); return; }
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
    this.autoDocs = this.ranked.filter(p => !this.pinned.includes(p) && !this.excluded.has(p)).slice(0, this.effectiveK());
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
    this.renderK();
    // Bei Erhöhung über den geholten Puffer hinaus neu retrieven, sonst nur neu rechnen.
    if (increasing && this.effectiveK() > 0 && this.ranked.length < next + this.pinned.length && this.lastQuery.length >= MIN_QUERY) {
      void this.setQuery(this.lastQuery);
    } else {
      this.recompute();
    }
  }
  /** Anzeige des Auto-Zählers: „Auto aus“ bei 0, „Auto ⏸“ während der Pause (der gespeicherte Wert bleibt). */
  renderK(): void {
    const paused = this.deps.isPaused?.() === true;
    const el = this.kEl; if (!el) return;
    el.setText(paused ? t("context.autoPaused") : this.autoK === 0 ? t("context.autoOff") : t("context.auto", this.autoK));
    if (paused) el.setAttribute("aria-label", t("context.autoPausedHint")); else el.removeAttribute("aria-label");
  }
  /** Die Pause ist zu Ende: die letzte Eingabe neu suchen (wenn Auto-Treffer gewünscht sind), Anzeige auffrischen. */
  onResume(): void {
    this.renderK();
    if (this.autoK > 0 && this.lastQuery.length >= MIN_QUERY) void this.setQuery(this.lastQuery); else this.recompute();
  }
  /** Die Pause hat begonnen: Auto-Treffer fallen weg, Gepinntes bleibt. */
  onPause(): void { this.renderK(); this.recompute(); }
  currentPaths(): string[] { return [...new Set([...this.pinned, ...this.autoDocs])]; }
  reset(): void { this.excluded.clear(); this.recompute(); }

  private render(): void {
    const el = this.listEl; if (!el) return; el.empty();
    this.countEl?.setText(t("context.count", this.currentPaths().length));
    for (const p of this.pinned) {
      const chip = el.createSpan({ cls: "vault-rag-ctx-chip is-pinned", text: `📌 ${this.basename(p)} ✕` });
      chip.addEventListener("click", () => this.unpin(p));
    }
    for (const p of this.autoDocs) {
      const chip = el.createSpan({ cls: "vault-rag-ctx-chip is-auto", text: `${this.basename(p)} ✕` });
      chip.addEventListener("click", () => this.excludeAuto(p));
    }
  }

  private basename(p: string): string { return p.split("/").pop()?.replace(/\.md$/, "") ?? p; }
}
