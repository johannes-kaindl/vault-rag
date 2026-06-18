# Semantische Suche (Query-Panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Sidebar-Panel, in dem freier Text eingegeben wird und semantisch gerankte Notizen erscheinen (Query → Embedding → Cosinus über den gesyncten Index → Top-k).

**Architecture:** Drei kleine Extraktionen, damit Query- und Notiz-Pfad denselben Code teilen (`toIndexVector`, `Retriever.search`, `renderHits`), plus ein neuer `SemanticSearchView` und die Verdrahtung in `main.ts`. Die Retrieval-Engine bleibt unverändert.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`, `registerView`, `addRibbonIcon`), vitest + happy-dom.

## Global Constraints

- TypeScript strict + `noImplicitAny` — keine `any`-Casts für neue Typen.
- Obsidian-Mock unter `tests/__mocks__/obsidian.ts`; kein echter obsidian-Import im Test.
- `INDEX_DIM = 256` (Matryoshka-Truncation); Vektoren L2-normalisiert → Cosinus = Dot-Product.
- Query MUSS durch dieselbe Transformation wie Notizen (`toIndexVector`) — sonst inkompatibler Vektorraum.
- Nach jedem Task: alle Tests grün (`npx vitest run`) + Build (`npm run build`).
- Commits: Conventional Commits, nur berührte Dateien, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Online-only, kein Offline-Fallback. `k`/`minSim`/`exclude` aus bestehenden Settings — kein neues Setting.

---

### Task 1: `toIndexVector()` — geteilte Embedding→Vektor-Transformation

**Files:**
- Create: `src/embed_vector.ts`
- Test: `tests/embed_vector.test.ts`

**Interfaces:**
- Produces: `toIndexVector(vecs: Float32Array[], dim?: number): Float32Array` — Mean über `min(dim, vecs[0].length)`, dann L2-Normalisierung. `dim` Default 256. Leere Eingabe → leeres `Float32Array`.

- [ ] **Step 1: Failing test schreiben**

`tests/embed_vector.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { toIndexVector } from "../src/embed_vector";

const norm = (v: Float32Array) => Math.sqrt([...v].reduce((s, x) => s + x * x, 0));

describe("toIndexVector", () => {
  it("normalisiert einen einzelnen Vektor auf Einheitslänge", () => {
    const v = toIndexVector([new Float32Array([3, 4])], 2);
    expect(v[0]).toBeCloseTo(0.6, 5);
    expect(v[1]).toBeCloseTo(0.8, 5);
    expect(norm(v)).toBeCloseTo(1, 5);
  });
  it("mittelt mehrere Vektoren, dann normalisiert", () => {
    const v = toIndexVector([new Float32Array([1, 0]), new Float32Array([0, 1])], 2);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  it("truncatet auf dim (Matryoshka)", () => {
    const v = toIndexVector([new Float32Array([1, 2, 99, 99])], 2);
    expect(v.length).toBe(2);
    expect(norm(v)).toBeCloseTo(1, 5);
  });
  it("leere Eingabe → leeres Float32Array", () => {
    expect(toIndexVector([], 256).length).toBe(0);
  });
});
```

- [ ] **Step 2: Test ausführen — erwartet FAIL**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/embed_vector.test.ts 2>&1 | tail -10`
Expected: FAIL — `toIndexVector` nicht gefunden.

- [ ] **Step 3: Implementierung**

`src/embed_vector.ts`:
```typescript
/** Embeddings → auf `dim` truncaten (Matryoshka) → Mean → L2-normalisieren.
 *  Einzige Quelle dieser Transformation: von Notiz-Pfad (live_indexer) UND Query-Pfad genutzt,
 *  damit beide im selben Vektorraum landen. */
export function toIndexVector(vecs: Float32Array[], dim = 256): Float32Array {
  const d = Math.min(dim, vecs[0]?.length ?? 0);
  const mean = new Float32Array(d);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i] / vecs.length;
  let norm = 0;
  for (let i = 0; i < d; i++) norm += mean[i] * mean[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < d; i++) mean[i] /= norm;
  return mean;
}
```

- [ ] **Step 4: Test ausführen — erwartet PASS**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/embed_vector.test.ts 2>&1 | tail -10`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/Shared/code/vault-rag && git add src/embed_vector.ts tests/embed_vector.test.ts && git commit -m "feat(search): toIndexVector — geteilte Embedding→Vektor-Transformation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `live_indexer` auf `toIndexVector` umstellen (DRY)

**Files:**
- Modify: `src/live_indexer.ts:28-44` (`update()`)

**Interfaces:**
- Consumes: `toIndexVector` (Task 1).

- [ ] **Step 1: Bestehende Tests als Sicherheitsnetz laufen**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/live_indexer.test.ts 2>&1 | tail -10`
Expected: PASS (Baseline grün vor dem Refactor).

- [ ] **Step 2: Import ergänzen**

In `src/live_indexer.ts`, nach den bestehenden Imports:
```typescript
import { toIndexVector } from "./embed_vector";
```

- [ ] **Step 3: Inline-Transform ersetzen**

In `update()` den Block (heute Zeilen ~32-43):
```typescript
    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    const dim = Math.min(INDEX_DIM, vecs[0].length);
    const mean = new Float32Array(dim);
    for (const v of vecs) {
      for (let i = 0; i < dim; i++) mean[i] += v[i] / vecs.length;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += mean[i] * mean[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) mean[i] /= norm;

    this.noteVectors.set(path, mean);
```
ersetzen durch:
```typescript
    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    this.noteVectors.set(path, toIndexVector(vecs, INDEX_DIM));
```

- [ ] **Step 4: Tests grün (verhaltensgleich)**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/live_indexer.test.ts 2>&1 | tail -10`
Expected: PASS (unverändert).

- [ ] **Step 5: Commit**

```bash
cd /Users/Shared/code/vault-rag && git add src/live_indexer.ts && git commit -m "refactor(indexer): update() nutzt toIndexVector (DRY)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Retriever.search(queryVec)` + privates `rank()`

**Files:**
- Modify: `src/retriever.ts`
- Test: `tests/retriever.test.ts` (ergänzen)

**Interfaces:**
- Consumes: `VaultIndex`, `RetrieveOpts`, `Hit` (bestehend).
- Produces: `Retriever.search(queryVec: Float32Array, opts: RetrieveOpts): Hit[]` — rankt ALLE Notizen per Cosinus (kein self-exclude), `minSim`-Schwelle, `exclude`-Präfixe, Top-k. `related()` bleibt nach außen unverändert.

- [ ] **Step 1: Failing test schreiben**

In `tests/retriever.test.ts` ans Ende der `describe`-Suite ergänzen:
```typescript
  it("search rankt per Query-Vektor (kein self-exclude)", () => {
    const r = new Retriever(idx());
    const hits = r.search(new Float32Array([1, 0]), { k: 3, minSim: 0, exclude: [] });
    expect(hits.map(h => h.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });
  it("search respektiert minSim, exclude-Präfix und k", () => {
    const r = new Retriever(idx());
    expect(r.search(new Float32Array([1, 0]), { k: 5, minSim: 0.5, exclude: [] }).map(h => h.path)).toEqual(["a.md", "b.md"]);
    expect(r.search(new Float32Array([1, 0]), { k: 5, minSim: 0, exclude: ["a.md"] }).map(h => h.path)).toEqual(["b.md", "c.md"]);
    expect(r.search(new Float32Array([1, 0]), { k: 1, minSim: 0, exclude: [] }).length).toBe(1);
  });
```

- [ ] **Step 2: Test ausführen — erwartet FAIL**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/retriever.test.ts 2>&1 | tail -10`
Expected: FAIL — `search` nicht vorhanden.

- [ ] **Step 3: `retriever.ts` refactoren**

`src/retriever.ts` Klassen-Body ersetzen durch:
```typescript
export class Retriever {
  constructor(private index: VaultIndex) {}

  related(activePath: string, opts: RetrieveOpts): Hit[] {
    const q = this.index.vectorFor(activePath);
    if (!q) return [];
    return this.rank(q, opts, activePath);
  }

  search(queryVec: Float32Array, opts: RetrieveOpts): Hit[] {
    return this.rank(queryVec, opts);
  }

  private rank(q: Float32Array, opts: RetrieveOpts, skipPath?: string): Hit[] {
    const dim = this.index.dim, vecs = this.index.vectors, paths = this.index.paths;
    const hits: Hit[] = [];
    for (let r = 0; r < paths.length; r++) {
      const p = paths[r];
      if (p === skipPath || opts.exclude.some(e => p.startsWith(e))) continue;
      let dot = 0;
      for (let c = 0; c < dim; c++) dot += q[c] * vecs[r * dim + c];   // Cosinus (normalisiert)
      if (dot >= opts.minSim) hits.push({ path: p, score: dot });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.k);
  }
}
```
(Imports/`Hit`/`RetrieveOpts` oben unverändert lassen.)

- [ ] **Step 4: Tests grün (neue + bestehende `related`-Tests)**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/retriever.test.ts 2>&1 | tail -10`
Expected: PASS (alle, inkl. bestehender `related`-Tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/Shared/code/vault-rag && git add src/retriever.ts tests/retriever.test.ts && git commit -m "feat(search): Retriever.search(queryVec) + privates rank()

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `renderHits()` aus `view.ts` extrahieren

**Files:**
- Modify: `src/view.ts`
- Test: `tests/view.test.ts` (ergänzen)

**Interfaces:**
- Produces: `renderHits(el: HTMLElement, hits: Hit[], openPath: (path: string) => void): void` — rendert je Hit eine `.vault-rag-hit`-Row mit Titel + Score (`toFixed(2)`) + Klick-Callback. `RelatedNotesView` nutzt es.

- [ ] **Step 1: Failing test schreiben**

In `tests/view.test.ts` neuen `describe`-Block ergänzen (Import oben erweitern: `import { RelatedNotesView, VIEW_TYPE_RELATED, renderHits } from "../src/view";`, `makeFakeEl` aus dem Mock importieren):
```typescript
import { makeFakeEl } from "./__mocks__/obsidian";

describe("renderHits", () => {
  it("rendert eine Row pro Hit mit Titel, Score und Klick", () => {
    const el: any = makeFakeEl();
    const opened: string[] = [];
    renderHits(el, [{ path: "notes/foo.md", score: 0.85 }, { path: "bar.md", score: 0.5 }], p => opened.push(p));
    const rows = el.children.filter((c: any) => c.className?.includes("vault-rag-hit"));
    expect(rows.length).toBe(2);
    const score = rows[0].children.find((c: any) => c.className?.includes("vault-rag-hit-score"));
    expect(score.textContent).toBe("0.85");
    rows[0].click();
    expect(opened).toEqual(["notes/foo.md"]);
  });
});
```

- [ ] **Step 2: Test ausführen — erwartet FAIL**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/view.test.ts 2>&1 | tail -10`
Expected: FAIL — `renderHits` nicht exportiert.

- [ ] **Step 3: `view.ts` refactoren**

In `src/view.ts` die freie Funktion ergänzen (nach den Imports, vor der Klasse):
```typescript
export function renderHits(el: HTMLElement, hits: Hit[], openPath: (path: string) => void): void {
  for (const h of hits) {
    const row = el.createDiv({ cls: "vault-rag-hit" });
    const name = h.path.split("/").pop()?.replace(/\.md$/, "") ?? h.path;
    row.createEl("span", { cls: "vault-rag-hit-title", text: name });
    row.createEl("span", { cls: "vault-rag-hit-score", text: h.score.toFixed(2) });
    row.addEventListener("click", () => openPath(h.path));
  }
}
```
Und `RelatedNotesView.render()` ersetzen durch:
```typescript
  render() {
    const c = this.contentEl; c.empty();
    const hits = this.deps.getHits();
    if (hits.length === 0) { c.createDiv({ cls: "vault-rag-empty", text: "Keine verwandten Notizen (oder Notiz noch nicht indexiert)." }); return; }
    renderHits(c, hits, this.deps.openPath);
  }
```

- [ ] **Step 4: Tests grün (neue + bestehende View-Tests)**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/view.test.ts 2>&1 | tail -10`
Expected: PASS (alle).

- [ ] **Step 5: Commit**

```bash
cd /Users/Shared/code/vault-rag && git add src/view.ts tests/view.test.ts && git commit -m "refactor(view): renderHits extrahieren (geteilt mit Such-Panel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `SemanticSearchView` + `SearchDeps`/`SearchResult`

**Files:**
- Create: `src/search_view.ts`
- Test: `tests/search_view.test.ts`

**Interfaces:**
- Consumes: `renderHits` (Task 4), `Hit` (retriever).
- Produces:
  - `VIEW_TYPE_SEARCH = "vault-rag-search"`
  - `SearchResult = { kind: "hits"; hits: Hit[] } | { kind: "offline" } | { kind: "no-index" }`
  - `SearchDeps { search(query: string): Promise<SearchResult>; openPath(path: string): void }`
  - `class SemanticSearchView extends ItemView` mit `runQuery(query)`, `renderResult(result)`.

- [ ] **Step 1: Failing test schreiben**

`tests/search_view.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { SemanticSearchView, VIEW_TYPE_SEARCH, SearchResult } from "../src/search_view";
import { makeFakeApp } from "./__mocks__/obsidian";

function mkView(search: (q: string) => Promise<SearchResult>, openPath = () => {}) {
  const leaf: any = { app: makeFakeApp() };
  return new SemanticSearchView(leaf, { search, openPath });
}
const states = (v: any) =>
  v.contentEl.children.flatMap((c: any) => c.children ?? []).filter((c: any) => c.className?.includes("vault-rag-search-state"));
const hits = (v: any) =>
  v.contentEl.children.flatMap((c: any) => c.children ?? []).filter((c: any) => c.className?.includes("vault-rag-hit"));

describe("SemanticSearchView", () => {
  it("getViewType ist VIEW_TYPE_SEARCH", () => {
    expect(mkView(async () => ({ kind: "hits", hits: [] })).getViewType()).toBe(VIEW_TYPE_SEARCH);
  });
  it("kurze Query (<3) zeigt Hinweis, ruft search nicht", async () => {
    const search = vi.fn(async () => ({ kind: "hits", hits: [] }) as SearchResult);
    const v = mkView(search); await v.onOpen(); await v.runQuery("ab");
    expect(search).not.toHaveBeenCalled();
    expect(states(v).length).toBe(1);
  });
  it("Treffer werden gerendert", async () => {
    const v = mkView(async () => ({ kind: "hits", hits: [{ path: "a.md", score: 0.9 }] }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(hits(v).length).toBe(1);
  });
  it("offline-Zustand", async () => {
    const v = mkView(async () => ({ kind: "offline" }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(states(v).some((s: any) => s.textContent.includes("nicht erreichbar"))).toBe(true);
  });
  it("no-index-Zustand", async () => {
    const v = mkView(async () => ({ kind: "no-index" }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(states(v).some((s: any) => s.textContent.includes("Kein Index"))).toBe(true);
  });
  it("0 Treffer zeigt Schwellen-Hinweis", async () => {
    const v = mkView(async () => ({ kind: "hits", hits: [] }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(states(v).some((s: any) => s.textContent.includes("Keine Treffer"))).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen — erwartet FAIL**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/search_view.test.ts 2>&1 | tail -10`
Expected: FAIL — Modul `search_view` fehlt.

- [ ] **Step 3: Implementierung**

`src/search_view.ts`:
```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import { Hit } from "./retriever";
import { renderHits } from "./view";

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

export class SemanticSearchView extends ItemView {
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private timer: ReturnType<typeof window.setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: SearchDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_SEARCH; }
  getDisplayText(): string { return "Semantische Suche"; }
  getIcon(): string { return "telescope"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty();
    const input = c.createEl("input", { cls: "vault-rag-search-input" }) as HTMLInputElement;
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
    if (result.kind === "no-index") return this.renderState("Kein Index — HyperForge-Export nötig.");
    if (result.hits.length === 0) return this.renderState("Keine Treffer über der Schwelle.");
    const el = this.resultsEl!; el.empty();
    renderHits(el, result.hits, this.deps.openPath);
  }

  private renderState(text: string): void {
    const el = this.resultsEl!; el.empty();
    el.createDiv({ cls: "vault-rag-search-state", text });
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
}
```

- [ ] **Step 4: Test ausführen — erwartet PASS**

Run: `cd /Users/Shared/code/vault-rag && npx vitest run tests/search_view.test.ts 2>&1 | tail -10`
Expected: PASS (6 Tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/Shared/code/vault-rag && git add src/search_view.ts tests/search_view.test.ts && git commit -m "feat(search): SemanticSearchView (Sidebar-Panel, Zustände)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verdrahtung in `main.ts` + Styles

**Files:**
- Modify: `src/main.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `SemanticSearchView`, `VIEW_TYPE_SEARCH`, `SearchDeps`, `SearchResult` (Task 5); `toIndexVector` (Task 1); `Retriever.search` (Task 3).

- [ ] **Step 1: Imports ergänzen**

In `src/main.ts` bei den Imports:
```typescript
import { SemanticSearchView, VIEW_TYPE_SEARCH, SearchResult } from "./search_view";
import { toIndexVector } from "./embed_vector";
```

- [ ] **Step 2: `openPath` als Methode extrahieren + in beiden Views nutzen**

In der Klasse eine Pfeil-Property ergänzen (z. B. nach `statusBarEl`):
```typescript
private openPath = (p: string): void => {
  const f = this.app.vault.getAbstractFileByPath(p);
  if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
};
```
In der bestehenden `registerView(VIEW_TYPE_RELATED, …)` die inline-`openPath` durch `openPath: this.openPath` ersetzen.

- [ ] **Step 3: Such-View registrieren + Ribbon + Command**

In `onload()`, nach der bestehenden View-Registrierung:
```typescript
this.registerView(VIEW_TYPE_SEARCH, (leaf: WorkspaceLeaf) => new SemanticSearchView(leaf, {
  search: (q) => this.runSearch(q),
  openPath: this.openPath,
}));
this.addRibbonIcon("telescope", "Semantische Suche", () => this.activateSearchView());
this.addCommand({ id: "open-semantic-search", name: "Semantische Suche öffnen", callback: () => this.activateSearchView() });
```

- [ ] **Step 4: `runSearch` + `activateSearchView` ergänzen**

Methoden in der Klasse ergänzen (Muster `activateSearchView` analog zur bestehenden `activateView`, aber mit `VIEW_TYPE_SEARCH`):
```typescript
private async runSearch(query: string): Promise<SearchResult> {
  if (!this.retriever || !this.index) return { kind: "no-index" };
  if (!(await this.embedder.ping())) return { kind: "offline" };
  try {
    const vecs = await this.embedder.embed([query]);
    const qVec = toIndexVector(vecs, this.index.dim);
    const hits = this.retriever.search(qVec, {
      k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude,
    });
    return { kind: "hits", hits };
  } catch {
    return { kind: "offline" };
  }
}

private async activateSearchView(): Promise<void> {
  const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEARCH);
  if (existing.length > 0) { this.app.workspace.revealLeaf(existing[0]); return; }
  const leaf = this.app.workspace.getRightLeaf(false);
  if (leaf) { await leaf.setViewState({ type: VIEW_TYPE_SEARCH, active: true }); this.app.workspace.revealLeaf(leaf); }
}
```
> Hinweis: Signaturen exakt an die bestehende `activateView()` angleichen (gleiche `getRightLeaf`/`setViewState`/`revealLeaf`-Aufrufe). Falls `activateView` minimal abweicht, dieselbe Form übernehmen.

- [ ] **Step 5: Minimale Styles**

In `styles.css` ergänzen:
```css
.vault-rag-search-input { width: 100%; margin-bottom: 8px; }
.vault-rag-search-state { color: var(--text-muted); padding: 4px 0; }
```

- [ ] **Step 6: Build + alle Tests grün**

Run:
```bash
cd /Users/Shared/code/vault-rag && npm run build 2>&1 | tail -8 && npx vitest run 2>&1 | tail -12
```
Expected: Build ohne TS-Fehler; alle Tests grün (45 bestehende + ~14 neue).

- [ ] **Step 7: Commit**

```bash
cd /Users/Shared/code/vault-rag && git add src/main.ts styles.css && git commit -m "feat(search): Such-Panel verdrahten (View, Ribbon, Command, runSearch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-Implementation

- `npm run build` → `main.js` aktuell; Plugin in Obsidian neu laden, Command „Semantische Suche öffnen" testen (online: Treffer; Embedder aus: „nicht erreichbar").
- Cockpit-TaskNote „Slice A+ verifizieren" deckt den manuellen Obsidian-Check mit ab.

## Self-Review

**1. Spec-Coverage:** `toIndexVector` (Task 1) · gleicher Vektorraum/DRY (Task 1+2) · `Retriever.search` (Task 3) · `renderHits`-Reuse (Task 4) · `SemanticSearchView` + alle 5 Zustände (Task 5) · Verdrahtung/online-only/`no-index`/`offline` (Task 6). Alle Spec-Abschnitte abgedeckt.

**2. Placeholder-Scan:** Kein TBD/TODO; jeder Code-Step zeigt den vollständigen Code. Der einzige „angleichen"-Hinweis (Task 6 Step 4) verweist auf die real existierende `activateView()` als Vorlage — kein Loch.

**3. Typ-Konsistenz:** `toIndexVector(vecs, dim)`, `Retriever.search(queryVec, opts)`, `renderHits(el, hits, openPath)`, `SearchDeps.search → SearchResult` durchgängig identisch über Tasks 1/3/4/5/6. `VIEW_TYPE_SEARCH` einheitlich. `exclude` als Präfix-Liste konsistent mit `RetrieveOpts`.
