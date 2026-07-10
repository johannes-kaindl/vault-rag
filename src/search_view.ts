import { Hit } from "./retriever";
import { renderHits } from "./view";
import { HubPanel, TabId } from "./hub_panel";

export const VIEW_TYPE_SEARCH = "vault-rag-search";

export type SearchResult =
  | { kind: "hits"; hits: Hit[] }
  | { kind: "offline" }
  | { kind: "no-index" };

export interface SearchDeps {
  search: (query: string) => Promise<SearchResult>;
  openPath: (path: string) => void;
}

const MIN_QUERY = 3;
const DEBOUNCE_MS = 400;

export class SearchPanel implements HubPanel {
  readonly id: TabId = "search";
  readonly label = "Suche";
  readonly icon = "search";
  private container!: HTMLElement;
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private timer: number | null = null;

  constructor(private deps: SearchDeps) {}

  mount(container: HTMLElement): void {
    this.container = container;
    const c = this.container; c.empty();
    const input = c.createEl("input", { cls: "vault-rag-search-input" });
    input.type = "text";
    input.placeholder = "Semantisch suchen…";
    this.inputEl = input;
    this.resultsEl = c.createDiv({ cls: "vault-rag-search-results" });
    input.addEventListener("input", () => this.schedule(input.value ?? ""));
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") void this.runQuery(input.value ?? ""); });
    this.renderState("Suchbegriff eingeben (≥3 Zeichen).");
  }

  private schedule(query: string): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.runQuery(query), DEBOUNCE_MS);
  }

  async runQuery(query: string): Promise<void> {
    const q = query.trim();
    if (q.length < MIN_QUERY) { this.renderState("Suchbegriff eingeben (≥3 Zeichen)."); return; }
    this.renderResult(await this.deps.search(q));
  }

  renderResult(result: SearchResult): void {
    if (result.kind === "offline") return this.renderState("Embedder nicht erreichbar (lokal/VPN).");
    if (result.kind === "no-index") return this.renderState('Kein Index — über den Befehl „Vault neu indizieren“ erstellen.');
    if (result.hits.length === 0) return this.renderState("Keine Treffer über der Schwelle.");
    const el = this.resultsEl!; el.empty();
    renderHits(el, result.hits, this.deps.openPath);
  }

  private renderState(text: string): void {
    const el = this.resultsEl!; el.empty();
    el.createDiv({ cls: "vault-rag-search-state", text });
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
}
