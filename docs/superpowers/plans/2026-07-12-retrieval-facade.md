# RetrievalFacade (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine gemeinsame, obsidian-freie `RetrievalFacade` über IndexLoader/Retriever/Embedder bauen, die UI und MCP teilen; die vier duplizierten Query-Embedding-Call-Sites, das UI-Feld `this.retriever` und die MCP-`McpDeps`-Kette darauf umstellen.

**Architecture:** Zustandslose Fassade mit Getter-Injection (`RetrievalDeps` — dasselbe Muster wie das bestehende `McpDeps`). Sie kapselt `embedQuery`/`searchVector`/`search`/`related`/`readNote`, baut `new Retriever(index)` pro Call und liefert getypte Result-Unions (nie throw für erwartbare Zustände). UI-Closures und die MCP-Tools werden dünne Adapter, die die Unions in ihre jeweilige Repräsentation mappen.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API. Kernmodule: `src/index.ts` (VaultIndex/parseIndex), `src/retriever.ts` (Retriever/Hit/RetrieveOpts), `src/embed_vector.ts` (toIndexVector).

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Neue Retrieval-Module bleiben obsidian-frei** (kein `import "obsidian"`) und in Node testbar — wie `retriever.ts`/`index.ts`/`mcp/mcp_deps.ts`.
- **Tests:** vitest, `describe/it/expect`, kein `.only`/`.skip` im Commit. Nach jeder Änderung **alle** Tests grün (`npm test`).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer bei substanziellem AI-Beitrag: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verhalten erhalten:** Die Migration ändert kein sichtbares Verhalten außer dem beabsichtigten Bugfix (Divergenz G: Chat/SmartApply gehen jetzt durch den `embedderReady`-Re-Resolve). Bestehende Tests bleiben grün (ggf. Import/Mock angepasst).
- **`new Retriever(...)` nur noch innerhalb der Fassade** — kein `this.retriever`-Feld mehr im Plugin.

---

## File Structure

- **Neu:** `src/retrieval_facade.ts` — Result-Typen, `RetrievalDeps`, `RetrievalFacade`, `resolveNotePath` (aus `mcp/tools.ts` hierher verschoben, da `readNote` jetzt ein Fassaden-Feature ist).
- **Neu:** `tests/retrieval_facade.test.ts` — Node-Tests der Fassade gegen Fake-Deps.
- **Geändert:** `src/main.ts` — Fassade instanziieren + Getter-Deps + `guardedRead`-Feld; `this.retriever`-Feld + ~10 Zuweisungen entfernen; `currentHits`/`runSearch`/Chat-/SmartApply-/TemplateRanker-Adapter über die Fassade; MCP-Start auf `new McpTools(facade)`; `buildMcpDeps`/`McpDepsHost` entfernen.
- **Geändert:** `src/mcp/tools.ts` — `McpTools` nimmt die Fassade statt `McpDeps`; `resolveNotePath` von hier entfernt (verschoben).
- **Geändert:** `src/smart_apply.ts` — tote `search`-Dep aus `SmartApplyDeps` entfernen (Zeile 49).
- **Gelöscht:** `src/mcp/mcp_deps.ts` (`McpDeps`-Interface entfällt).
- **Test-Migration:** `tests/mcp_tools.test.ts` (Fake-Fassade statt Fake-`McpDeps`; `resolveNotePath`-Tests nach `retrieval_facade.test.ts` verschieben), `tests/main_mcp_deps.test.ts` (löschen — die Logik lebt jetzt in `retrieval_facade.test.ts`).
- **Geändert:** `AGENTS.md` — Modul-Layout um `retrieval_facade.ts` ergänzen.

**Abweichung von der Spec (bewusst, im Plan verfeinert):** `ReadResult` verwendet `{kind:"invalid"; path; reason}` statt `{kind:"excluded"}` — so bleiben die deskriptiven `resolveNotePath`-Meldungen ("Pfad verlässt den Vault", "nur .md", exclude-Präfix) für MCP-Clients erhalten, statt zu einem generischen "excluded" zu kollabieren.

---

## Task 1: RetrievalFacade — Kern (embedQuery / searchVector / search / related)

**Files:**
- Create: `src/retrieval_facade.ts`
- Test: `tests/retrieval_facade.test.ts`

**Interfaces:**
- Consumes: `VaultIndex` (`src/index.ts` — `.dim`, `.rowFor(path): number`, `.vectorFor(path)`), `Retriever`/`Hit`/`RetrieveOpts` (`src/retriever.ts`), `toIndexVector(vecs, dim)` (`src/embed_vector.ts`), `parseIndex` (Tests).
- Produces:
  - `interface RetrievalDeps { getIndex(): VaultIndex | null; embedderReady(): Promise<boolean>; embed(texts: string[]): Promise<Float32Array[]>; settings(): { k: number; minSim: number; exclude: string[] }; readVault(rel: string): Promise<string> }`
  - `interface RetrieveOverrides { k: number; minSim: number }`
  - `type EmbedResult = { kind:"vec"; vec: Float32Array } | { kind:"no-index" } | { kind:"offline" }`
  - `type SearchResult = { kind:"hits"; hits: Hit[] } | { kind:"no-index" } | { kind:"offline" }`
  - `type VecSearchResult = { kind:"hits"; hits: Hit[] } | { kind:"no-index" }`
  - `type RelatedResult = { kind:"hits"; hits: Hit[] } | { kind:"no-index" } | { kind:"not-indexed"; path: string }`
  - `class RetrievalFacade { constructor(deps: RetrievalDeps); embedQuery(text): Promise<EmbedResult>; searchVector(vec, opts?): VecSearchResult; search(query, opts?): Promise<SearchResult>; related(path, opts?): RelatedResult }`

- [ ] **Step 1: Write the failing tests (core methods)**

Create `tests/retrieval_facade.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseIndex, VaultIndex } from "../src/index";
import { RetrievalFacade, RetrievalDeps } from "../src/retrieval_facade";

function idx(): VaultIndex {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  // a=[1,0]  b=[0.92,0.39]  c=[0,1]
  const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
  return parseIndex(m, ["a.md", "b.md", "c.md"], bytes.buffer);
}

function deps(over: Partial<RetrievalDeps> = {}): RetrievalDeps {
  return {
    getIndex: () => idx(),
    embedderReady: async () => true,
    embed: async () => [new Float32Array([1, 0])],
    settings: () => ({ k: 5, minSim: 0, exclude: [] }),
    readVault: async () => "",
    ...over,
  };
}

describe("RetrievalFacade.embedQuery", () => {
  it("no-index wenn kein Index geladen", async () => {
    const f = new RetrievalFacade(deps({ getIndex: () => null }));
    expect(await f.embedQuery("x")).toEqual({ kind: "no-index" });
  });
  it("offline wenn Embedder nicht bereit", async () => {
    const f = new RetrievalFacade(deps({ embedderReady: async () => false }));
    expect(await f.embedQuery("x")).toEqual({ kind: "offline" });
  });
  it("offline wenn embed leer antwortet", async () => {
    const f = new RetrievalFacade(deps({ embed: async () => [] }));
    expect(await f.embedQuery("x")).toEqual({ kind: "offline" });
  });
  it("offline wenn embed wirft", async () => {
    const f = new RetrievalFacade(deps({ embed: async () => { throw new Error("net"); } }));
    expect(await f.embedQuery("x")).toEqual({ kind: "offline" });
  });
  it("vec: toIndexVector auf Index-dim, L2-normalisiert", async () => {
    const f = new RetrievalFacade(deps());
    const r = await f.embedQuery("x");
    expect(r.kind).toBe("vec");
    if (r.kind === "vec") { expect(r.vec.length).toBe(2); expect(r.vec[0]).toBeCloseTo(1, 5); }
  });
});

describe("RetrievalFacade.searchVector", () => {
  it("no-index wenn kein Index", () => {
    const f = new RetrievalFacade(deps({ getIndex: () => null }));
    expect(f.searchVector(new Float32Array([1, 0]))).toEqual({ kind: "no-index" });
  });
  it("hits: rankt per Query-Vektor über settings-Defaults", () => {
    const f = new RetrievalFacade(deps());
    const r = f.searchVector(new Float32Array([1, 0]));
    expect(r).toEqual({ kind: "hits", hits: expect.any(Array) });
    if (r.kind === "hits") expect(r.hits.map(h => h.path)).toEqual(["a.md", "b.md", "c.md"]);
  });
  it("opts überschreiben k/minSim; exclude bleibt aus settings", () => {
    const f = new RetrievalFacade(deps({ settings: () => ({ k: 5, minSim: 0, exclude: ["a.md"] }) }));
    const r = f.searchVector(new Float32Array([1, 0]), { k: 1, minSim: 0 });
    if (r.kind === "hits") expect(r.hits.map(h => h.path)).toEqual(["b.md"]); // a.md excluded, k=1
  });
});

describe("RetrievalFacade.search", () => {
  it("no-index / offline werden durchgereicht", async () => {
    expect(await new RetrievalFacade(deps({ getIndex: () => null })).search("x")).toEqual({ kind: "no-index" });
    expect(await new RetrievalFacade(deps({ embedderReady: async () => false })).search("x")).toEqual({ kind: "offline" });
  });
  it("hits: embed dann cosine", async () => {
    const r = await new RetrievalFacade(deps()).search("x");
    expect(r.kind).toBe("hits");
    if (r.kind === "hits") expect(r.hits[0].path).toBe("a.md");
  });
});

describe("RetrievalFacade.related", () => {
  it("no-index wenn kein Index", () => {
    expect(new RetrievalFacade(deps({ getIndex: () => null })).related("a.md")).toEqual({ kind: "no-index" });
  });
  it("not-indexed wenn Pfad nicht im Index", () => {
    expect(new RetrievalFacade(deps()).related("missing.md")).toEqual({ kind: "not-indexed", path: "missing.md" });
  });
  it("hits: verwandte Notizen, self ausgeschlossen", () => {
    const r = new RetrievalFacade(deps()).related("a.md", { k: 2 });
    if (r.kind === "hits") expect(r.hits.map(h => h.path)).toEqual(["b.md", "c.md"]);
    else throw new Error("erwartete hits");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/retrieval_facade.test.ts`
Expected: FAIL — `Cannot find module '../src/retrieval_facade'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/retrieval_facade.ts`:

```ts
import { VaultIndex } from "./index";
import { Retriever, Hit, RetrieveOpts } from "./retriever";
import { toIndexVector } from "./embed_vector";

/** Live-Anschlüsse, die die Fassade konsumiert — vom Plugin (main.ts) injiziert.
 *  Zustandslos: getIndex()/embed etc. liefern immer das aktuelle Live-Objekt. */
export interface RetrievalDeps {
  getIndex(): VaultIndex | null;
  /** ready-check inkl. Re-Resolve-Retry (der EINE Endpoint-Resolver-Pfad). */
  embedderReady(): Promise<boolean>;
  /** roher Batch-Embed (EmbeddingClient.embed); die Fassade ruft embed([text]). */
  embed(texts: string[]): Promise<Float32Array[]>;
  settings(): { k: number; minSim: number; exclude: string[] };
  /** Volltext einer vault-relativen Notiz (main.ts übergibt sie symlink-guarded). */
  readVault(rel: string): Promise<string>;
}

/** Per-Call überschreibbar; exclude bleibt IMMER aus settings(). */
export interface RetrieveOverrides { k: number; minSim: number }

export type EmbedResult = { kind: "vec"; vec: Float32Array } | { kind: "no-index" } | { kind: "offline" };
export type SearchResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" } | { kind: "offline" };
export type VecSearchResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" };
export type RelatedResult = { kind: "hits"; hits: Hit[] } | { kind: "no-index" } | { kind: "not-indexed"; path: string };

export class RetrievalFacade {
  constructor(private deps: RetrievalDeps) {}

  /** Query-Text → Vektor im Index-Raum. Erwartbare Zustände als Werte, nie throw. */
  async embedQuery(text: string): Promise<EmbedResult> {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    return this.embedWith(index, text);
  }

  /** Reine Cosinus-Suche mit fertigem Query-Vektor (kein embed, kein ready-check). */
  searchVector(vec: Float32Array, opts?: Partial<RetrieveOverrides>): VecSearchResult {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    return { kind: "hits", hits: new Retriever(index).search(vec, this.resolveOpts(opts)) };
  }

  /** Query-Text → embed → Cosinus. */
  async search(query: string, opts?: Partial<RetrieveOverrides>): Promise<SearchResult> {
    const index = this.deps.getIndex();          // Snapshot vor dem await (kein Reload-Race)
    if (!index) return { kind: "no-index" };
    const e = await this.embedWith(index, query);
    if (e.kind !== "vec") return e;              // offline
    return { kind: "hits", hits: new Retriever(index).search(e.vec, this.resolveOpts(opts)) };
  }

  /** Verwandte Notizen zu einem Pfad (offline, direkt aus dem Index). */
  related(path: string, opts?: Partial<RetrieveOverrides>): RelatedResult {
    const index = this.deps.getIndex();
    if (!index) return { kind: "no-index" };
    if (index.rowFor(path) < 0) return { kind: "not-indexed", path };
    return { kind: "hits", hits: new Retriever(index).related(path, this.resolveOpts(opts)) };
  }

  private async embedWith(index: VaultIndex, text: string): Promise<{ kind: "vec"; vec: Float32Array } | { kind: "offline" }> {
    if (!(await this.deps.embedderReady())) return { kind: "offline" };
    try {
      const vecs = await this.deps.embed([text]);
      if (vecs.length === 0) return { kind: "offline" };
      return { kind: "vec", vec: toIndexVector(vecs, index.dim) };
    } catch {
      return { kind: "offline" };
    }
  }

  private resolveOpts(opts?: Partial<RetrieveOverrides>): RetrieveOpts {
    const s = this.deps.settings();
    return { k: opts?.k ?? s.k, minSim: opts?.minSim ?? s.minSim, exclude: s.exclude };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/retrieval_facade.test.ts`
Expected: PASS (alle Blöcke embedQuery/searchVector/search/related).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: kein Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/retrieval_facade.ts tests/retrieval_facade.test.ts
git commit -m "feat(retrieval): RetrievalFacade-Kern (embedQuery/searchVector/search/related)

Zustandslose, obsidian-freie Fassade über Retriever+Embedder mit getypten
Result-Unions (nie throw). Fundament für UI- und MCP-Konsolidierung (Slice 2).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: RetrievalFacade — readNote + resolveNotePath verschieben

**Files:**
- Modify: `src/retrieval_facade.ts` (readNote + resolveNotePath ergänzen)
- Modify: `src/mcp/tools.ts` (resolveNotePath-Definition hier entfernen, aus Fassade importieren — Zwischenschritt bis Task 4)
- Test: `tests/retrieval_facade.test.ts` (readNote + resolveNotePath-Tests ergänzen)
- Modify: `tests/mcp_tools.test.ts` (resolveNotePath-Import auf `../src/retrieval_facade` umbiegen)

**Interfaces:**
- Consumes: `RetrievalDeps.readVault`, `RetrievalDeps.settings().exclude`.
- Produces:
  - `function resolveNotePath(rel: string, exclude: string[]): string` (verschoben — identische Semantik, wirft bei ungültigem Pfad)
  - `type ReadResult = { kind:"ok"; text: string } | { kind:"not-found"; path: string } | { kind:"invalid"; path: string; reason: string }`
  - `RetrievalFacade.readNote(relPath: string): Promise<ReadResult>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/retrieval_facade.test.ts`:

```ts
import { RetrievalFacade as _F, resolveNotePath } from "../src/retrieval_facade";

describe("resolveNotePath", () => {
  it("normalisiert gültige relative .md-Pfade", () => {
    expect(resolveNotePath("Ordner/Notiz.md", [])).toBe("Ordner/Notiz.md");
    expect(resolveNotePath("./a/./b.md", [])).toBe("a/b.md");
  });
  it("verbietet absolute Pfade, Traversal und nicht-.md", () => {
    expect(() => resolveNotePath("/etc/x.md", [])).toThrow(/vault-relative/);
    expect(() => resolveNotePath("a/../../x.md", [])).toThrow(/verlässt den Vault/);
    expect(() => resolveNotePath("a/x.txt", [])).toThrow(/Markdown/);
  });
  it("verbietet exclude-Präfix (case-insensitiv)", () => {
    expect(() => resolveNotePath("templates/x.md", ["Templates/"])).toThrow(/Ausschluss-Präfix/);
  });
});

describe("RetrievalFacade.readNote", () => {
  const base = {
    getIndex: () => null, embedderReady: async () => true,
    embed: async () => [], settings: () => ({ k: 5, minSim: 0, exclude: ["Templates/"] }),
  };
  it("ok: liest Volltext über readVault", async () => {
    const f = new RetrievalFacade({ ...base, readVault: async (r) => `INHALT von ${r}` });
    expect(await f.readNote("a/b.md")).toEqual({ kind: "ok", text: "INHALT von a/b.md" });
  });
  it("invalid: resolveNotePath-Grund bleibt erhalten", async () => {
    const f = new RetrievalFacade({ ...base, readVault: async () => "x" });
    const r = await f.readNote("../x.md");
    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") expect(r.reason).toMatch(/verlässt den Vault/);
  });
  it("invalid: exclude-Präfix", async () => {
    const f = new RetrievalFacade({ ...base, readVault: async () => "x" });
    expect((await f.readNote("Templates/x.md")).kind).toBe("invalid");
  });
  it("not-found: readVault wirft", async () => {
    const f = new RetrievalFacade({ ...base, readVault: async () => { throw new Error("ENOENT"); } });
    expect(await f.readNote("a/b.md")).toEqual({ kind: "not-found", path: "a/b.md" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/retrieval_facade.test.ts`
Expected: FAIL — `resolveNotePath` und `readNote` existieren noch nicht in `retrieval_facade`.

- [ ] **Step 3: Add resolveNotePath + ReadResult + readNote to `src/retrieval_facade.ts`**

Add the `ReadResult` type next to the other result types:

```ts
export type ReadResult = { kind: "ok"; text: string } | { kind: "not-found"; path: string } | { kind: "invalid"; path: string; reason: string };
```

Add this exported function (copy verbatim from `src/mcp/tools.ts`, only the location changes):

```ts
/** Path-Guard für readNote: vault-relativ, kein Traversal, nur .md, exclude-Präfix (case-insensitiv).
 *  Gibt den normalisierten vault-relativen Pfad zurück. Reine String-Logik (kein node:path). */
export function resolveNotePath(rel: string, exclude: string[]): string {
  if (rel.startsWith("/")) throw new Error(`Nur vault-relative Pfade erlaubt: "${rel}"`);
  const parts = rel.split(/[\\/]/).filter(s => s !== "" && s !== ".");
  if (parts.some(s => s === "..")) throw new Error(`Pfad verlässt den Vault: "${rel}"`);
  const norm = parts.join("/");
  if (!norm.toLowerCase().endsWith(".md")) throw new Error(`Nur Markdown-Notizen (.md) lesbar: "${rel}"`);
  const normLower = norm.toLowerCase();
  const hit = exclude.find(e => e && normLower.startsWith(e.toLowerCase()));
  if (hit) throw new Error(`Pfad liegt unter Ausschluss-Präfix "${hit}": "${rel}"`);
  return norm;
}
```

Add the method to `RetrievalFacade`:

```ts
  /** Volltext einer Notiz mit Path-Guard. Ungültige Pfade → invalid (Grund erhalten). */
  async readNote(relPath: string): Promise<ReadResult> {
    let rel: string;
    try {
      rel = resolveNotePath(relPath, this.deps.settings().exclude);
    } catch (e) {
      return { kind: "invalid", path: relPath, reason: (e as Error).message };
    }
    try {
      return { kind: "ok", text: await this.deps.readVault(rel) };
    } catch {
      return { kind: "not-found", path: relPath };
    }
  }
```

- [ ] **Step 4: Point `src/mcp/tools.ts` at the moved function (temporary bridge)**

In `src/mcp/tools.ts`, remove the local `resolveNotePath` definition (lines 11-22) and import it instead. Change the top imports to add:

```ts
import { resolveNotePath } from "../retrieval_facade";
```

Leave the rest of `tools.ts` unchanged for now (McpTools still uses `McpDeps`; it gets rewritten in Task 4). This keeps the build green between tasks.

- [ ] **Step 5: Update `tests/mcp_tools.test.ts` import**

In `tests/mcp_tools.test.ts`, change the `resolveNotePath` import source from `"../src/mcp/tools"` to `"../src/retrieval_facade"`. (Leave the resolveNotePath test cases there for now — they are removed in Task 4 when they overlap with the facade tests. Duplicate coverage is temporarily fine.)

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — facade tests green, mcp_tools tests green (resolveNotePath now imported from facade).

- [ ] **Step 7: Commit**

```bash
git add src/retrieval_facade.ts src/mcp/tools.ts tests/retrieval_facade.test.ts tests/mcp_tools.test.ts
git commit -m "feat(retrieval): readNote + resolveNotePath in die Fassade verschieben

readNote als getypter ReadResult (ok/not-found/invalid mit Grund); Path-Guard
zieht von mcp/tools.ts in die geteilte Fassade. mcp/tools.ts überbrückt per Import.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: UI-Migration in main.ts (Fassade bauen, this.retriever entfernen)

**Files:**
- Modify: `src/main.ts`
- Modify: `src/smart_apply.ts` (tote `search`-Dep entfernen)

**Interfaces:**
- Consumes: `RetrievalFacade`, `RetrievalDeps` (Task 1). Chat's `ContextPanelDeps` (`src/context_panel.ts`) bleibt unverändert: `embed: (q) => Promise<Float32Array>` (wirft bei offline; context_panel fängt → `[]`), `search: (vec, n) => string[]`.
- Produces: `this.facade: RetrievalFacade`, `this.guardedRead` (Feld). Kein `this.retriever` mehr.

- [ ] **Step 1: Add facade field + guardedRead + imports**

In `src/main.ts` top imports, add:

```ts
import { RetrievalFacade } from "./retrieval_facade";
```

Remove the now-unneeded `Retriever` from the `./retriever` import (keep `Hit`):

```ts
import { Hit } from "./retriever";
```

Replace the field declaration `private retriever: Retriever | null = null;` (line ~71) with:

```ts
private facade!: RetrievalFacade;
private guardedRead: (rel: string) => Promise<string> = (p) => this.app.vault.adapter.read(p);
```

In `onload`, right after `this.pendingQueue = new PendingQueue(...)` (line ~133), build the facade:

```ts
this.facade = new RetrievalFacade({
  getIndex: () => this.index,
  embedderReady: () => this.embedderReady(),
  embed: (texts) => this.embedder.embed(texts),
  settings: () => ({ k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude }),
  readVault: (rel) => this.guardedRead(rel),
});
```

- [ ] **Step 2: Migrate `currentHits` (RelatedPanel)**

Replace `currentHits` (lines ~857-861) with:

```ts
currentHits(): Hit[] {
  const f = this.app.workspace.getActiveFile();
  if (!f) return [];
  const r = this.facade.related(f.path);
  return r.kind === "hits" ? r.hits : [];
}
```

- [ ] **Step 3: Migrate `runSearch` (SearchPanel)**

The facade's `SearchResult` union is structurally identical to `search_view.ts`'s `SearchResult` (`hits`/`offline`/`no-index`). Replace `runSearch` (lines ~912-929) with:

```ts
private async runSearch(query: string): Promise<SearchResult> {
  return this.facade.search(query);
}
```

(`SearchResult` stays imported from `./search_view`; the facade returns the same shape, so the assignment is structurally compatible.)

- [ ] **Step 4: Migrate Chat embed/search closures (buildPanels)**

Replace the Chat panel's `embed` and `search` closures (lines ~289-299) with:

```ts
embed: async (q) => {
  const e = await this.facade.embedQuery(q);
  if (e.kind !== "vec") throw new Error("Embedder nicht erreichbar.");  // context_panel fängt → []
  return e.vec;
},
search: (vec, n) => {
  const r = this.facade.searchVector(vec, { k: n });
  return r.kind === "hits" ? r.hits.map(h => h.path) : [];
},
```

- [ ] **Step 5: Migrate SmartApply embed + drop dead search dep**

Replace the SmartApply deps' `embed` and `search` (lines ~172-182) with only `embed` (the `search` dep is dead — never called in `smart_apply.ts`):

```ts
embed: async (t) => {
  const e = await this.facade.embedQuery(t);
  if (e.kind !== "vec") throw new Error("kein Index / Embedder offline");
  return e.vec;
},
```

Then remove the dead `search` field from `SmartApplyDeps` in `src/smart_apply.ts` (line 49):

```ts
// DELETE this line:
//   search: (vec: Float32Array, opts: { k: number; minSim: number; exclude: string[] }) => { path: string; score: number }[];
```

- [ ] **Step 6: Migrate TemplateRanker embed**

Replace the TemplateRanker deps' `embed` (lines ~200-206) with (leave `indexVector` untouched — it uses `this.index`, not the retriever):

```ts
embed: async (t) => {
  const e = await this.facade.embedQuery(t);
  if (e.kind !== "vec") throw new Error("kein Index / Embedder offline");
  return e.vec;
},
```

- [ ] **Step 7: Remove all `this.retriever` assignments**

Delete every `this.retriever = new Retriever(this.index);` line (~lines 551, 643, 676, 698, 740, 790, 839) and adjust the null/restore sites:
- Lines ~568, ~576: `this.index = null; this.retriever = null;` → `this.index = null;`
- Line ~599: `this.index = prevIndex; this.retriever = prevRetriever;` → `this.index = prevIndex;` — and remove the corresponding `const prevRetriever = this.retriever;` capture a few lines above (search the `maybeReload` body for `prevRetriever`).

Use grep to confirm none remain:

Run: `grep -n "this.retriever\|prevRetriever\|new Retriever" src/main.ts`
Expected: no output.

- [ ] **Step 8: Typecheck + full suite + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests green; `main.js` builds.

Note: `src/mcp/*` still compiles — `McpTools`/`buildMcpDeps` are untouched in this task and keep working via the old `McpDeps` path (rewritten in Task 4).

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/smart_apply.ts
git commit -m "refactor(retrieval): UI-Consumer auf RetrievalFacade, this.retriever entfernt

currentHits/runSearch/Chat/SmartApply/TemplateRanker gehen durch die Fassade;
das Retriever-Feld + ~7 Reset-Stellen entfallen. Chat/SmartApply nutzen jetzt den
embedderReady-Re-Resolve (heilt den offline-Embed-Bug, Divergenz G). Tote
SmartApply.search-Dep entfernt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: MCP-Migration (McpTools über Fassade, alte Kette entfernen)

**Files:**
- Modify: `src/mcp/tools.ts` (McpTools nimmt `RetrievalFacade`)
- Modify: `src/main.ts` (MCP-Start baut `new McpTools(this.facade)` + setzt `this.guardedRead`; `buildMcpDeps`/`McpDepsHost`/`McpDeps`-Import/`mcpDepsHost()` entfernen)
- Delete: `src/mcp/mcp_deps.ts`
- Modify: `tests/mcp_tools.test.ts` (Fake-Fassade statt Fake-McpDeps; resolveNotePath-Tests entfernen — jetzt in facade-Tests)
- Delete: `tests/main_mcp_deps.test.ts`

**Interfaces:**
- Consumes: `RetrievalFacade` (search/related/readNote), `HitList`/`toHitList` (bleiben in `tools.ts`).
- Produces: `class McpTools { constructor(facade: RetrievalFacade); search(a): Promise<HitList>; related(a): Promise<HitList>; readNote(a): Promise<{path; content}> }` — externes Verhalten (Rückgabe-JSON, Fehlermeldungen) identisch zu vorher.

- [ ] **Step 1: Rewrite `src/mcp/tools.ts`**

Replace the entire file with (keeps `HitList`/`toHitList`; drops `resolveNotePath`, `requireIndex`, `opts`, the `McpDeps` import):

```ts
import { Hit } from "../retriever";
import { RetrievalFacade } from "../retrieval_facade";

export interface HitList { hits: { path: string; score: number }[] }

/** Transport-freie Tool-Handler des MCP-Servers — register_tools.ts ist die SDK-Schale.
 *  Dünner Adapter über die geteilte RetrievalFacade: Result-Unions → JSON bzw. throw. */
export class McpTools {
  constructor(private facade: RetrievalFacade) {}

  private static toHitList(hits: Hit[]): HitList {
    return { hits: hits.map(h => ({ path: h.path, score: Math.round(h.score * 1000) / 1000 })) };
  }

  async search(a: { query: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const r = await this.facade.search(a.query, { k: a.k, minSim: a.min_similarity });
    if (r.kind === "no-index") throw new Error("Kein Index geladen — im Plugin (neu) indizieren oder aus Backup wiederherstellen.");
    if (r.kind === "offline") throw new Error("Embedding-Endpoint nicht erreichbar.");
    return McpTools.toHitList(r.hits);
  }

  async related(a: { path: string; k?: number; min_similarity?: number }): Promise<HitList> {
    const r = this.facade.related(a.path, { k: a.k, minSim: a.min_similarity });
    if (r.kind === "no-index") throw new Error("Kein Index geladen — im Plugin (neu) indizieren oder aus Backup wiederherstellen.");
    if (r.kind === "not-indexed") throw new Error(`Notiz nicht im Index: "${a.path}" — nicht indexiert (exclude-Regel?) oder noch nicht embedded.`);
    return McpTools.toHitList(r.hits);
  }

  async readNote(a: { path: string }): Promise<{ path: string; content: string }> {
    const r = await this.facade.readNote(a.path);
    if (r.kind === "invalid") throw new Error(r.reason);
    if (r.kind === "not-found") throw new Error(`Notiz nicht gefunden: "${a.path}"`);
    return { path: a.path, content: r.text };
  }
}
```

Note: `{ k: a.k, minSim: a.min_similarity }` passes `undefined` through when absent — the facade's `resolveOpts` (`opts?.k ?? s.k`) then falls back to settings, identical to the old `opts()` behavior.

- [ ] **Step 2: Wire the MCP start in `src/main.ts` to the facade**

In the MCP start block (lines ~1050-1062), replace the `mcpDepsHost()`/`buildMcpDeps` wiring with `this.guardedRead` + the shared facade:

```ts
const { startMcpServer } = await import("./mcp/http_server");
// Symlink-Escape-Schutz (desktop-only, dynamisch importiert, damit Mobile nie node:fs/path lädt).
const { makeVaultReadGuard } = await import("./mcp/vault_read_guard");
const adapter = this.app.vault.adapter;
if (adapter instanceof FileSystemAdapter) {
  this.guardedRead = makeVaultReadGuard(adapter.getBasePath(), (p) => adapter.read(p));
}
const tools = new McpTools(this.facade);
this.mcpServer = await startMcpServer({ port: this.settings.mcpPort, token, tools, version: this.manifest.version });
this.mcpLastStartError = null;
```

- [ ] **Step 3: Remove the dead MCP-deps plumbing from `src/main.ts`**

- Delete the `McpDepsHost` interface (lines ~44-51).
- Delete `buildMcpDeps` (lines ~54-66).
- Delete `mcpDepsHost()` method (lines ~975-983).
- Remove imports that are now unused: `import type { McpDeps } from "./mcp/mcp_deps";` and `import { toIndexVector } from "./embed_vector";` (toIndexVector no longer used in main.ts — confirm with grep). Keep `McpTools` import.

Run: `grep -n "toIndexVector\|McpDeps\|mcpDepsHost\|buildMcpDeps\|McpDepsHost" src/main.ts`
Expected: no output.

- [ ] **Step 4: Delete `src/mcp/mcp_deps.ts`**

```bash
git rm src/mcp/mcp_deps.ts
```

- [ ] **Step 5: Rewrite `tests/mcp_tools.test.ts` against a fake facade**

Replace the McpTools portion so it constructs `McpTools` with a fake/real `RetrievalFacade`. Build a real facade over fake deps (reuse the `idx()`/`deps()` pattern from `retrieval_facade.test.ts`), OR construct a minimal stub facade. Concrete replacement:

```ts
import { describe, it, expect } from "vitest";
import { McpTools } from "../src/mcp/tools";
import { RetrievalFacade } from "../src/retrieval_facade";
import { parseIndex } from "../src/index";

function idx() {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
  return parseIndex(m, ["a.md", "b.md", "c.md"], bytes.buffer);
}
function tools(over = {}) {
  const facade = new RetrievalFacade({
    getIndex: () => idx(),
    embedderReady: async () => true,
    embed: async () => [new Float32Array([1, 0])],
    settings: () => ({ k: 5, minSim: 0, exclude: ["Templates/"] }),
    readVault: async (r: string) => `INHALT ${r}`,
    ...over,
  });
  return new McpTools(facade);
}

describe("McpTools.search", () => {
  it("liefert gerundete Hits", async () => {
    const r = await tools().search({ query: "x" });
    expect(r.hits[0]).toEqual({ path: "a.md", score: 1 });
  });
  it("wirft bei fehlendem Index", async () => {
    await expect(tools({ getIndex: () => null }).search({ query: "x" })).rejects.toThrow(/Kein Index/);
  });
  it("wirft bei offline", async () => {
    await expect(tools({ embedderReady: async () => false }).search({ query: "x" })).rejects.toThrow(/nicht erreichbar/);
  });
});

describe("McpTools.related", () => {
  it("verwandte Notizen", async () => {
    const r = await tools().related({ path: "a.md" });
    expect(r.hits.map(h => h.path)).toEqual(["b.md", "c.md"]);
  });
  it("wirft bei nicht-indexierter Notiz", async () => {
    await expect(tools().related({ path: "missing.md" })).rejects.toThrow(/nicht im Index/);
  });
});

describe("McpTools.readNote", () => {
  it("liest Volltext", async () => {
    expect(await tools().readNote({ path: "a/b.md" })).toEqual({ path: "a/b.md", content: "INHALT a/b.md" });
  });
  it("wirft mit Guard-Grund bei Traversal", async () => {
    await expect(tools().readNote({ path: "../x.md" })).rejects.toThrow(/verlässt den Vault/);
  });
  it("wirft bei exclude-Präfix", async () => {
    await expect(tools().readNote({ path: "Templates/x.md" })).rejects.toThrow(/Ausschluss-Präfix/);
  });
});
```

(The standalone `resolveNotePath` describe-block that was added to `mcp_tools.test.ts` in Task 2/Step 5 is now covered in `retrieval_facade.test.ts` — remove it from `mcp_tools.test.ts`.)

- [ ] **Step 6: Delete `tests/main_mcp_deps.test.ts`**

Its subject (`buildMcpDeps`/`McpDepsHost` — ready-check + embed + toIndexVector) is now covered by `retrieval_facade.test.ts` (embedQuery block).

```bash
git rm tests/main_mcp_deps.test.ts
```

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests green; `main.js` builds (SDK bundled, MCP path intact).

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools.ts src/main.ts tests/mcp_tools.test.ts
git commit -m "refactor(mcp): McpTools über RetrievalFacade, McpDeps-Kette entfernt

McpTools wird dünner Adapter (Union→JSON/throw); buildMcpDeps/McpDepsHost/
mcp_deps.ts + main_mcp_deps.test entfallen. Externes Tool-Verhalten unverändert
(Rückgabe-JSON + Fehlermeldungen identisch, per Test gepinnt).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AGENTS.md-Update + Gesamt-Verifikation

**Files:**
- Modify: `AGENTS.md` (Modul-Layout)

- [ ] **Step 1: Add `retrieval_facade.ts` to the module layout**

In `AGENTS.md`, in the `### Modul-Layout (src/)` code block, add after the `retriever.ts` entry:

```
retrieval_facade.ts  Gemeinsame obsidian-freie Fassade über Retriever/Embedder für UI + MCP:
                  RetrievalFacade(deps).embedQuery/searchVector/search/related/readNote →
                  getypte Result-Unions (hits/no-index/offline/not-indexed/…), nie throw.
                  resolveNotePath (Path-Guard) lebt hier. Kein this.retriever-Feld mehr.
```

Also update the `mcp/` layout line: remove `tools.ts`'s "McpDeps-injiziert" note → "McpTools = dünner Adapter über RetrievalFacade"; drop the `mcp_deps.ts` mention if present.

- [ ] **Step 2: Full verification sweep**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: typecheck clean; lint clean; **all tests green** (facade tests added, mcp_tools migrated, main_mcp_deps removed); `main.js` builds.

- [ ] **Step 3: Confirm no orphans**

Run: `grep -rn "this.retriever\|McpDepsHost\|buildMcpDeps\|mcp_deps" src/ tests/`
Expected: no output (all references removed).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): Modul-Layout um retrieval_facade.ts ergänzen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (durchgeführt)

**Spec-Coverage:**
- Fassade obsidian-frei, Getter-Injection, zustandslos → Task 1. ✅
- Result-Unions statt throw → Task 1 (Typen) + Adapter-Mapping Task 3/4. ✅
- Divergenz A (4× embedQuery) → Task 3 (Chat/SmartApply/TemplateRanker/Search) + Task 4 (MCP). ✅
- Divergenz B (Retriever-Lifecycle) → Task 3 Step 7 (Feld + Resets weg). ✅
- Divergenz C (Defaults/Override) → `resolveOpts` Task 1. ✅
- Divergenz D (related not-indexed) → `related` Task 1 + MCP-Mapping Task 4. ✅
- Divergenz E (Fehlermodell) → Unions Task 1 + Adapter Task 3/4. ✅
- Divergenz G (ready-check umgangen) → Chat/SmartApply gehen durch `embedderReady` (Task 3 Step 4/5). ✅
- readNote + Symlink-Guard erhalten → Task 2 (Fassade) + `guardedRead` Task 3/4. ✅

**Placeholder-Scan:** kein TBD/TODO; jeder Code-Step trägt vollständigen Code. ✅

**Typ-Konsistenz:** `RetrievalDeps.embed(texts: string[])` überall; `searchVector` synchron (context_panel `search` ist synchron); `SearchResult`-Shape der Fassade == `search_view.SearchResult`; `ReadResult.invalid.reason` in Fassade erzeugt und in McpTools gelesen. ✅

**Bekannte Abweichung von der Spec:** `ReadResult` nutzt `invalid{reason}` statt `excluded` (erhält deskriptive Guard-Meldungen) — oben unter „File Structure" dokumentiert.
