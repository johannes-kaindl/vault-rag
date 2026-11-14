import { Hit } from "./vendor/kit/vector-index";
import { renderHitList } from "./vendor/kit-obsidian/hit-list";
import { HubPanel, TabId } from "./hub_panel";
import { t } from "./vendor/kit/i18n";

export const VIEW_TYPE_SEARCH = "vault-rag-search";

export type SearchResult =
  | { kind: "hits"; hits: Hit[] }
  | { kind: "offline" }
  | { kind: "paused" }
  | { kind: "no-index" };

export interface SearchDeps {
  search: (query: string) => Promise<SearchResult>;
  openPath: (path: string) => void;
  /** Pause beenden (der Knopf im Pause-Zustand). Fehlt der Anschluss, zeigt der Zustand nur den Text. */
  resume?: () => void;
}

const MIN_QUERY = 3;
const DEBOUNCE_MS = 400;

export class SearchPanel implements HubPanel {
  readonly id: TabId = "search";
  get label(): string { return t("panel.search.label"); }
  readonly icon = "search";
  private container!: HTMLElement;
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private timer: number | null = null;
  /** Der Suchtext und das Ergebnis zu genau diesem Text überleben `destroy()` und ein erneutes `mount()` (das Panel bleibt dieselbe Instanz, `PanelPool`). */
  private lastQuery = "";
  private lastResult: { query: string; result: SearchResult } | null = null;

  constructor(private deps: SearchDeps) {}

  mount(container: HTMLElement): void {
    this.container = container;
    const c = this.container; c.empty();
    const input = c.createEl("input", { cls: "vault-rag-search-input" });
    input.type = "text";
    input.placeholder = t("panel.search.placeholder");
    this.inputEl = input;
    this.resultsEl = c.createDiv({ cls: "vault-rag-search-results" });
    input.addEventListener("input", () => { this.lastQuery = input.value ?? ""; this.schedule(this.lastQuery); });
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") void this.runQuery(input.value ?? ""); });
    // Nach dem Schließen und Öffnen des Blatts: der letzte Text steht wieder im Feld, die Treffer dazu sofort (ohne Netz); ein Text ohne Ergebnis (das Blatt
    // schloss vor dem Entprellen) läuft jetzt.
    input.value = this.lastQuery;
    const q = this.lastQuery.trim();
    if (this.lastResult && this.lastResult.query === q) this.renderResult(this.lastResult.result);
    else if (q.length >= MIN_QUERY) { this.renderState(t("panel.search.prompt")); void this.runQuery(q); }
    else this.renderState(t("panel.search.prompt"));
  }

  private schedule(query: string): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.runQuery(query), DEBOUNCE_MS);
  }

  async runQuery(query: string): Promise<void> {
    this.lastQuery = query;
    const q = query.trim();
    if (q.length < MIN_QUERY) { this.renderState(t("panel.search.prompt")); return; }
    const result = await this.deps.search(q);
    this.lastResult = { query: q, result };
    this.renderResult(result);
  }

  renderResult(result: SearchResult): void {
    if (result.kind === "offline") return this.renderState(t("panel.search.offline"));
    if (result.kind === "paused") return this.renderPaused();
    if (result.kind === "no-index") return this.renderState(t("panel.search.noIndex"));
    if (result.hits.length === 0) return this.renderState(t("panel.search.noHits"));
    const el = this.resultsEl!; el.empty();
    renderHitList(el, result.hits, this.deps.openPath);
  }

  /** Empty-State nach UI-STANDARD §8 mit genau einem CTA: die Pause ist eine Entscheidung, der Weg zurück steht daneben. */
  private renderPaused(): void {
    const el = this.resultsEl!; el.empty();
    const empty = el.createDiv({ cls: "vault-rag-empty", text: t("panel.search.paused") });
    if (this.deps.resume) {
      const btn = empty.createEl("button", { cls: "mod-cta", text: t("panel.search.resume") });
      btn.addEventListener("click", () => this.deps.resume?.());
    }
  }

  private renderState(text: string): void {
    const el = this.resultsEl!; el.empty();
    el.createDiv({ cls: "vault-rag-search-state", text });
  }

  /** Pause an: laufende Eingabe zeigt den Pause-Zustand; Fortsetzen: dieselbe Eingabe läuft neu. */
  onEmbeddingPause(paused: boolean): void {
    const q = (this.inputEl?.value ?? "").trim();
    if (q.length < MIN_QUERY) return;
    if (paused) this.renderPaused(); else void this.runQuery(q);
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
}
