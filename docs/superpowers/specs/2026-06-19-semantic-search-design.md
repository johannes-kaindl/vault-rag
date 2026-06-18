# Semantische Suche (Query-Panel) — Design

**Goal:** Ein Sidebar-Panel, in dem der User **freien Text** eingibt und semantisch
gerankte Notizen bekommt (Query → Embedding → Cosinus über den gesyncten Index →
Top-k). Ergänzt das bestehende Related-Notes-Panel (das nur relativ zur *offenen*
Notiz arbeitet) um eine query-getriebene Suche.

**Architecture:** Überwiegend Verdrahtung + drei kleine Extraktionen, damit Query- und
Notiz-Pfad denselben Code teilen. Die Retrieval-Engine (`Retriever`, `EmbeddingClient`,
`VaultIndex`) bleibt unverändert in der Substanz.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`, `addRibbonIcon`,
`registerView`), vitest + happy-dom. Kein neues npm-Paket.

## Entscheidungen (aus dem Brainstorming, ratifiziert)

- **Online-only.** Semantische Suche braucht den erreichbaren Embedder (lokal/VPN), um
  die Query zu vektorisieren. Funktioniert daheim im WLAN oder per VPN. **Kein Offline-Fallback.**
- **Kein lexikalischer Fallback.** Ist der Embedder offline, zeigt das Panel einen
  klaren Zustand „Embedder nicht erreichbar". Für Suche ohne Verbindung dient Obsidians
  native Suche.
- **Eigener Sidebar-View**, koexistiert mit dem Related-Notes-Panel (nichts wird ersetzt).
- **Live-Suche:** debounced ~400 ms, ab ≥3 Zeichen; Enter triggert sofort.
- **Out of scope (eigener Folge-Slice):** On-Device-Embedding fürs iPhone offline. Das
  bräuchte ein kleines, On-Device-laufendes Modell **und** einen passenden Parallel-Index
  (Embedding-Räume sind modell-spezifisch; der aktuelle Index ist `qwen3-embedding:8b`).

## Korrektheits-Kern: gleicher Vektorraum

Der Cosinus ist nur sinnvoll, wenn Query- und Notiz-Vektoren identisch erzeugt sind.
`live_indexer.update()` macht heute inline: **Embeddings → auf 256 Dim truncaten (Matryoshka)
→ Mean → L2-normalisieren** (`src/live_indexer.ts:33-41`). Die Query muss durch **exakt
dieselbe** Transformation. Darum wird diese Transformation in eine geteilte, pure Funktion
`toIndexVector()` extrahiert und von beiden Pfaden genutzt.

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/embed_vector.ts` | **neu** | `toIndexVector(vecs: Float32Array[], dim=256): Float32Array` — Mean über `min(dim, len)`, L2-Norm. Pure, obsidian-frei. |
| `src/retriever.ts` | **ändern** | `search(queryVec, opts): Hit[]` + privates `rank(queryVec, opts, skipPath?)`. `related()` delegiert an `rank(..., activePath)`. |
| `src/view.ts` | **ändern** | `renderHits(el, hits, openPath)` extrahieren (DOM-Rendering der Hit-Rows). Bestehender `RelatedNotesView` nutzt es weiter. |
| `src/search_view.ts` | **neu** | `SemanticSearchView` (eigener `VIEW_TYPE_SEARCH`): Suchfeld + Debounce + Zustände; ruft `renderHits`. |
| `src/live_indexer.ts` | **ändern** | inline-Transform (Z. 33-41) → `toIndexVector()`. Verhalten identisch. |
| `src/main.ts` | **ändern** | `VIEW_TYPE_SEARCH` registrieren, Ribbon + Command, `searchDeps` bereitstellen. |

### Schnittstellen

```ts
// embed_vector.ts
export function toIndexVector(vecs: Float32Array[], dim?: number): Float32Array;

// retriever.ts
search(queryVec: Float32Array, opts: RetrieveOpts): Hit[];   // neu, public
// related() unverändert nach außen; intern via rank()

// view.ts
export function renderHits(el: HTMLElement, hits: Hit[], openPath: (p: string) => void): void;

// search_view.ts
export interface SearchDeps {
  search: (query: string) => Promise<SearchResult>;   // gekapselte Engine, von main bereitgestellt
  openPath: (path: string) => void;
}
export type SearchResult =
  | { kind: "hits"; hits: Hit[] }
  | { kind: "offline" }
  | { kind: "no-index" };
```

`main.searchDeps.search(query)` orchestriert: `ping()` → `embed([query])` →
`toIndexVector([vec])` → `retriever.search(qVec, {k, minSim, exclude})`. `k`/`minSim`/
`exclude` aus den bestehenden Settings (kein neues Setting).

## Datenfluss

```
Tippen (debounced ~400 ms, ≥3 Zeichen) ODER Enter
  → SemanticSearchView ruft deps.search(query)
      → embedder.ping()  ──false──►  SearchResult { offline }
      → retriever == null ──────────► SearchResult { no-index }
      → embedder.embed([query]) → toIndexVector([vec])  (256-dim, normalisiert)
      → retriever.search(qVec, {k, minSim, exclude}) → Hit[]
      → SearchResult { hits }
  → View rendert Zustand; bei hits: renderHits(panel, hits, openPath)
  → Klick auf Treffer öffnet die Notiz
```

## Zustände / Fehlerbehandlung

Das Panel rendert genau einen Zustand:
- **leere/zu kurze Query** (<3 Zeichen) → Hinweis „Suchbegriff eingeben (≥3 Zeichen)"
- **`{ offline }`** (ping false oder `embed` wirft) → „Embedder nicht erreichbar (lokal/VPN)"
- **`{ no-index }`** (`retriever == null`) → „Kein Index — HyperForge-Export nötig"
- **`{ hits }` mit 0 Treffern** → „Keine Treffer über Schwelle (minSim)"
- **`{ hits }` mit Treffern** → Liste via `renderHits`

`embed`-HTTP-Fehler werden in `main.searchDeps.search` gefangen und zu `{ offline }`
(bzw. einem Fehlerzustand) — die View wirft nie selbst.

## Tests (TDD, vitest)

- `tests/embed_vector.test.ts` — Mean über mehrere Vektoren, Truncation auf 256,
  Unit-Norm (‖v‖≈1), Single-Vector = nur normalisieren, leere Eingabe robust.
- `tests/retriever.test.ts` — `search`: Ranking nach Score, `minSim`-Schwelle,
  `exclude`-Präfixe, Top-k (`k`), leerer Index → `[]`. `related()` bleibt grün.
- `tests/view.test.ts` — `renderHits` rendert Rows + Titel + Score + Klick-Callback
  (happy-dom); bestehende View-Tests bleiben grün.
- `tests/search_view.test.ts` — Verdrahtung mit gemockten `SearchDeps`: rendert
  Treffer-, `offline`-, `no-index`- und Leer-Zustand korrekt; Debounce nicht unit-getestet.
- `tests/live_indexer.test.ts` — bleibt grün (Refactor auf `toIndexVector` verhaltensgleich).

## Self-Review

- **Placeholder-Scan:** keine TBD/TODO.
- **Konsistenz:** `toIndexVector` ist die einzige Quelle der Truncation/Norm — Query &
  Index garantiert im selben Raum. View wirft nie (Fehler in `searchDeps.search` gekapselt).
- **Scope:** ein Implementierungsplan, klein. Offline-On-Device bewusst ausgegliedert.
- **Ambiguität:** Live-Debounce (~400 ms, ≥3 Zeichen) explizit; `k`/`minSim`/`exclude` aus
  bestehenden Settings, kein neues Setting in diesem Slice.
