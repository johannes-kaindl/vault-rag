# Slice 2 — Interne Retrieval-API-Konsolidierung (RetrievalFacade)

**Datum:** 2026-07-12
**Status:** Design freigegeben, bereit für Implementierungsplan
**Typ:** Fundament / Refactoring (kein User-Feature)

## Kontext & Problem

Retrieval (Query → Embedding → Cosinus-Suche) wird heute an **vier** Stellen
unabhängig zusammengesetzt, jede mit demselben `embed([text]) → empty-check →
toIndexVector(vecs, index.dim)`-Boilerplate — aber mit divergierenden Defaults,
Fehlermodellen und ready-Checks:

| Call-Site | Ort | ready-Check | Fehler-Repräsentation |
|---|---|---|---|
| SearchPanel | `main.ts` `runSearch` | ja (`embedderReady`) | getypter Union `{kind:"offline"\|"no-index"\|"hits"}` |
| ChatPanel (Kontext) | `main.ts` embed/search-Deps | **nein** | stilles `[]` |
| MCP-Server | `main.ts` `buildMcpDeps.embedQuery` + `mcp/tools.ts` | ja | throw → `isError`-Text |
| SmartApply/TemplateRanker | `main.ts` | **nein** | throw |

Der MCP-Pfad besitzt mit `McpDeps` (`src/mcp/mcp_deps.ts`) bereits ~90 % der
gewünschten Fassade — nur MCP-lokal und nicht von der UI geteilt.

### Konkrete Divergenzen (die der Umbau schließt)

- **A — Query→embed→cosine 4× dupliziert.** Dasselbe Boilerplate, dim-Quelle,
  ready-Verhalten je Stelle anders.
- **B — Retriever-Lifecycle.** UI hält ein Feld `this.retriever`, das an ~8
  Reload/Reindex/Heal-Stellen neu gesetzt wird; MCP baut `new Retriever(index)`
  pro Call. Zwei Muster für dieselbe Sache.
- **C — Defaults/Override divergiert.** UI überschreibt nie (`{k,minSim,exclude}`
  aus settings); MCP erlaubt per-Call `k ?? s.k`, `minSim ?? s.minSim`; `exclude`
  nirgends überschreibbar.
- **D — `related` not-indexed.** UI ruft `retriever.related` roh (leeres Panel);
  MCP macht expliziten `rowFor < 0`-Check + deskriptiven throw.
- **E — Ergebnis-/Fehlermodell.** getypter Union (Search) vs. throw→`isError`
  (MCP) vs. stilles `[]` (Chat).
- **G — Endpoint-Resolution umgangen.** Chat-embed und SmartApply embedden gegen
  `this.embedder` **ohne** `embedderReady()`-Re-Resolve-Retry → **latenter Bug:**
  bei Offline/Endpoint-Wechsel wird gegen einen toten Embedder embeddet.

## Ziel

Eine **gemeinsame, obsidian-freie, Node-testbare `RetrievalFacade`**, die UI und
MCP teilen. Sie kapselt Query-Embedding, Retriever-Bau, Defaults-Merge und ein
einheitliches Ergebnis-/Fehlermodell. UI-Closures und `buildMcpDeps` werden zu
dünnen Adaptern.

**Ambitionsgrad (bewusst begrenzt):** Das Interface wird sauber geschnitten, damit
Slice 3 (in-Process-Plugin-API für Fremd-Plugins) darauf aufsetzen *kann* — aber
Versionierung, Stabilitätsgarantie und Fremd-Consumer-Doku sind **nicht** Teil von
Slice 2 (YAGNI, das ist Slice-3-Arbeit).

## Ansatz: Getter-Injection, zustandslose Fassade

Die Fassade bekommt **Getter-Deps** (Live-Objekte werden pro Call frisch geholt) —
dasselbe erprobte, obsidian-freie Muster wie `McpDeps` heute. Sie hält keinen
State und baut `new Retriever(index)` pro Call (billig: nur Referenz, die
Cosine-Schleife läuft ohnehin pro Call).

**Verworfene Alternativen:**
- *Langlebiges Objekt mit `setIndex()`/`setEmbedder()`-Mutatoren:* mehr beweglicher
  State, die ~8 Update-Stellen bleiben nur umbenannt — kein Gewinn.
- *Retriever-Cache per Index-Identität:* Mikro-Optimierung ohne messbaren Nutzen
  (Retriever-Bau ist gratis) — YAGNI.

**Bonus des zustandslosen Ansatzes:** Das UI-Feld `this.retriever` und seine ~8
Reset-Stellen (Divergenz B) entfallen ersatzlos — die Fassade zieht den Index
immer live via `getIndex()`.

## Architektur

### Neues Modul `src/retrieval_facade.ts` (obsidian-frei)

```ts
interface RetrievalDeps {
  getIndex(): VaultIndex | null;
  embedderReady(): Promise<boolean>;        // der EINE ready-check inkl. Re-Resolve-Retry
  embed(texts: string[]): Promise<Float32Array[]>;
  settings(): { k: number; minSim: number; exclude: string[] };
  readVault(rel: string): Promise<string>;  // main.ts übergibt sie bereits symlink-guarded
}

class RetrievalFacade {
  constructor(deps: RetrievalDeps);
  embedQuery(text: string): Promise<EmbedResult>;
  search(query: string, opts?: Partial<RetrieveOverrides>): Promise<SearchResult>;
  related(path: string, opts?: Partial<RetrieveOverrides>): RelatedResult;   // synchron, nutzt vectorFor
  readNote(relPath: string): Promise<ReadResult>;
}

interface RetrieveOverrides { k: number; minSim: number }  // exclude NICHT überschreibbar
```

### Ergebnistypen — getypte Unions, nie throw

Erwartbare Nicht-Erfolgs-Zustände sind **Werte**, kein Kontrollfluss. Nur echte
Programmierfehler werfen.

```ts
type EmbedResult   = { kind:"vec";  vec: Float32Array }  | { kind:"no-index" } | { kind:"offline" };
type SearchResult  = { kind:"hits"; hits: Hit[] }        | { kind:"no-index" } | { kind:"offline" };
type RelatedResult = { kind:"hits"; hits: Hit[] }        | { kind:"no-index" } | { kind:"not-indexed"; path:string };
type ReadResult    = { kind:"ok";   text: string }       | { kind:"not-found"; path:string } | { kind:"excluded"; path:string };
```

`Hit` bleibt `{ path, score }` aus `retriever.ts` (unverändert).

### Vereinheitlichte Semantik (schließt die Divergenzen)

- **Defaults/Override (C):** `k = opts?.k ?? s.k`, `minSim = opts?.minSim ?? s.minSim`,
  `exclude` **immer** aus `settings()` (nie überschreibbar). UI übergibt nichts,
  Chat übergibt `{k:n}`, MCP reicht seine optionalen Argumente durch.
- **dim (A):** immer `getIndex().dim` — kein `dim`-Parameter mehr durchgereicht.
  Ohne Index → `{kind:"no-index"}` (dim ist an den Index gebunden).
- **ready-check (G):** `embedQuery` ruft **immer** `embedderReady()` → Chat/SmartApply
  umgehen den Re-Resolve nicht mehr; der offline-Bug verschwindet.
- **`related` not-indexed (D):** Fassade liefert `{kind:"not-indexed"}` bei
  `rowFor(path) < 0`; Adapter entscheiden die Repräsentation.
- **Retriever-Bau:** intern pro Call aus `getIndex()`; Divergenz B entfällt.

### Adapter werden dünn

- **MCP** (`buildMcpDeps` + `McpTools`): mappt Union → `no-index`/`offline` →
  throw (→ `isError`); `hits` → JSON (`toHitList`, score gerundet); `related`
  `not-indexed` → deskriptiver throw (wie heute). `readNote` nutzt
  `facade.readNote` — `resolveNotePath`(exclude)-Guard wandert in die Fassade,
  `readVault` bleibt die von `main.ts` symlink-guarded übergebene Dep.
- **UI-Closures:** `runSearch`, Chat `embed`+`search`, `currentHits` → `switch`
  auf den Union. `currentHits` wird `facade.related(activePath)`.
- **SmartApply/TemplateRanker:** nutzen `facade.embedQuery(...)`. TemplateRankers
  `vectorFor`-basiertes Vorlagen-Ranking bleibt **unberührt** (kein Fassaden-Thema);
  nur sein embed-Fallback läuft über die Fassade.
- **`main.ts`:** **ein** `this.facade = new RetrievalFacade({...getter...})`, einmal
  in `onload` gebaut; die ~8 `this.retriever = new Retriever(...)` entfallen.

## Testing (TDD, Node, Fake-Deps)

Die Fassade ist obsidian-frei → Tests gegen Fake-Index + Fake-Embedder:

- `embedQuery`: no-index (kein Index) · offline (`embedderReady` false) · offline
  (embed wirft) · offline (leeres embed-Ergebnis) · vec (dim aus Index).
- `search`: no-index · offline · hits · Defaults aus settings · `k`/`minSim`-Override
  · `exclude` **nicht** überschreibbar.
- `related`: hits · no-index · not-indexed (`rowFor < 0`) · self-skip (bestehend).
- `readNote`: ok · excluded (Guard) · not-found.

**Regression:** bestehende MCP- und Search-Tests bleiben grün — Verhalten ist
identisch, nur der Pfad ändert sich.

## Scope-Grenzen (YAGNI)

**Nicht in Slice 2:**
- Öffentliche Versionierung / Stabilitätsgarantie / Fremd-Consumer-Doku (= Slice 3).
- `related` mit Query-Vektor statt Pfad.
- Retriever-/Ergebnis-Caching.
- Änderungen am Index-Format, an `VaultAdapter` oder am Live-Indexer-Producer-Pfad.

## Betroffene Dateien (Erwartung)

- **Neu:** `src/retrieval_facade.ts`, `tests/retrieval_facade.test.ts`.
- **Geändert:** `src/main.ts` (Fassade bauen + Getter-Deps, Retriever-Feld entfernen,
  UI-Closures + `buildMcpDeps` verdünnen), `src/mcp/tools.ts` (Union statt eigener
  Retriever-Bau, `resolveNotePath` in die Fassade verschoben), ggf. `src/mcp/mcp_deps.ts`
  (Vertrag an `RetrievalDeps` angleichen), `src/search_view.ts`/`src/chat_view.ts`/
  `src/context_panel.ts`/`src/view.ts` nur, falls sich die Dep-Signaturen ändern.
- **AGENTS.md:** Modul-Layout um `retrieval_facade.ts` ergänzen.
