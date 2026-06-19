# Chat: Unified Live-Kontext-Panel — Design

**Goal:** Die drei Chat-Modi (Vault / Aktive Notiz / Gewählt) durch **eine editierbare
Kontext-Liste** über der Eingabe ersetzen: Auto-RAG-Treffer aktualisieren sich live beim
Tippen, manuell gepinnte Notizen bleiben fix, einzelne Treffer sind wegklickbar (nächst-
ähnlicher rückt nach), die Auto-Anzahl ist im Frontend einstellbar.

**Architecture:** Retrieval wandert in die **Live-Vorschau** (`ContextPanel`); das Bauen des
Kontext-Texts (`buildContext`) und die Generierung (`ChatSession`) bleiben getrennt und
bekommen nur noch eine fixe Pfadliste. Ersetzt die 3-Modi-Schicht aus Slice B.

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`, `FuzzySuggestModal`),
vitest + happy-dom. Reuse: `EmbeddingClient` + `toIndexVector` + `Retriever.search`.

## Entscheidungen (Brainstorming 2026-06-19, ratifiziert)

- **Pins + Auto-Fill:** manuell hinzugefügte Notizen sind gepinnt (sticky); Auto-RAG füllt die
  restlichen Slots bis `autoK`. `autoK = 0` ⇒ nur Pins (ersetzt „nur aktive Notiz").
- **Live beim Tippen, fix beim Senden:** Auto-Liste aktualisiert sich debounced (~400 ms) zur
  aktuellen Frage. Beim Senden wird genau die gezeigte Liste verwendet. Pins bleiben über Fragen
  hinweg; weggeklickte Auto-Treffer bleiben für die aktuelle Frage ausgeschlossen, Reset beim Senden.
- **Layout:** Nachrichten oben · **Kontext-Liste direkt über der Eingabe** · Eingabe unten.
- **Manuell hinzufügen:** „+ Notiz" öffnet einen **Fuzzy-Picker** (`FuzzySuggestModal` über alle
  Vault-Notizen) + „+ Aktive Notiz" als Ein-Klick-Schnellpin. **Kein Drag&Drop** (bewusst: Obsidians
  Drag-Daten sind fragil/undokumentiert).
- **Die 3 Modus-Buttons entfallen.**
- **Out of scope (eigene Slices):** Thinking-Anzeige (`reasoning_content`) gleich danach; Token-/
  Tempo-Stats + Personas weiterhin geparkt.

## Architektur-Split

```
Tippen → ContextPanel.setQuery(q) [debounce] → embed(q) → search(vec, N)
        → autoDocs = ranked ohne (pinned ∪ excluded), erste autoK → Chips rendern (live)
+ Notiz (Fuzzy-Picker) / + Aktive Notiz → pin → Chips
× Auto-Treffer → excluded.add → nachrücken      × Pin → unpin
Senden → paths = ContextPanel.currentPaths()  (pinned + autoDocs, dedupe)
       → ChatSession.send(query, paths, onToken) → buildContext(paths) → LLM-Stream
```

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/context_panel.ts` | **neu** | Editierbare Live-Kontext-Liste: State + Retrieval-für-Vorschau + Render. |
| `src/note_picker.ts` | **neu** | `pickNote(app): Promise<string \| null>` via `FuzzySuggestModal` über `getMarkdownFiles()`. UI, nicht unit-getestet (nur in `main` importiert → Mock braucht kein `FuzzySuggestModal`). |
| `src/context_source.ts` | **refactor** | `buildContext(paths, {read, budget}): Promise<ContextResult>`. Raus: `ChatMode`, `ContextDeps`, 3-Modi-`assembleContext`, `related`/`activePath`/`picked`-Logik. |
| `src/chat_session.ts` | **ändern** | `send(query, paths, onToken)`; `mode`/`picked`/`reset(picked)` angepasst; `ChatSessionDeps.assemble: (paths) => Promise<ContextResult>`. |
| `src/chat_view.ts` | **ändern** | `ContextPanel` über der Eingabe hosten; Modi-Buttons + `renderPicked` raus; Tippen → `panel.setQuery`, Senden → `panel.currentPaths()`. |
| `src/main.ts` | **ändern** | ContextPanel-Deps verdrahten (`embed`/`search`/`getActivePath`/`pickNote`); Modi-Wiring + `assembleChatContext` ersetzt durch `buildContext`-Assemble; `chatK` = Default-`autoK`. |

### Schnittstellen

```ts
// context_source.ts
export interface ContextResult { text: string; sources: string[] }
export function buildContext(paths: string[], deps: { read: (p: string) => Promise<string>; budget: number }): Promise<ContextResult>;

// context_panel.ts
export interface ContextPanelDeps {
  embed: (q: string) => Promise<Float32Array>;     // embed+toIndexVector (snapshot-guarded, von main)
  search: (vec: Float32Array, n: number) => string[];  // Retriever.search → Pfade (snapshot)
  getActivePath: () => string | null;
  pickNote: () => Promise<string | null>;
}
export class ContextPanel {
  pinned: string[];
  excluded: Set<string>;
  autoK: number;
  autoDocs: string[];
  constructor(deps: ContextPanelDeps, autoK: number);
  mount(el: HTMLElement): void;        // baut die DOM-Struktur
  setQuery(q: string): Promise<void>;  // debounced retrieve → autoDocs → render
  addActive(): void;
  async addViaPicker(): Promise<void>;
  setAutoK(n: number): void;
  currentPaths(): string[];            // pinned + autoDocs, dedupe
  reset(): void;                       // excluded leeren (pro Frage); Pins bleiben
}

// chat_session.ts
export interface ChatSessionDeps {
  client: ChatClient;
  assemble: (paths: string[]) => Promise<ContextResult>;
}
// send(query: string, paths: string[], onToken): Promise<{ sources; error? }>
```

`RETRIEVE_N = autoK + 20` (Puffer fürs Nachrücken). `autoDocs` werden bei jeder State-Änderung
(pin/exclude/autoK) **aus der gecachten Rangliste** neu berechnet — nur `setQuery` re-embedded.

## Datenfluss (Senden)

`ChatView.submit`: `const paths = this.panel.currentPaths();` → `session.send(query, paths, onToken)`.
`main`-`assemble = (paths) => buildContext(paths, { read: p => app.vault.adapter.read(p), budget: settings.contextCharBudget })`.
Nach dem Senden: `panel.reset()` (Ausschlüsse für die nächste Frage leeren).

## Zustände / Fehlerbehandlung

- **Eingabe leer / <3 Zeichen** → keine Auto-Treffer (nur Pins); Hinweis „tippen für Kontext".
- **Embedder offline** (`embed` wirft) → Auto-Liste leer + dezenter Hinweis; **Pins funktionieren weiter**.
- **Kein Index / `search` liefert []** → keine Auto-Treffer; Pins gehen.
- **Picker abgebrochen** (`pickNote` → null) → nichts passiert.
- `buildContext`-`read`-Fehler überspringt die Notiz (kein Crash).

## Tests (TDD, vitest)

- `tests/context_panel.test.ts` — `setQuery`→`autoDocs` (Mock embed/search); `pin`/`unpin`;
  `excludeAuto`→Nachrücken (aus Puffer); `autoK`-Grenze + `setAutoK`-Neuberechnung; `currentPaths`
  = pinned+auto dedupe; `embed`-Fehler → Auto leer, Pins bleiben; `reset` leert Ausschlüsse.
- `tests/context_source.test.ts` — `buildContext`: gegebene Pfade → `## pfad`+Text, Budget-Kürzung,
  `read`-Fehler überspringt, `sources`.
- `tests/chat_session.test.ts` — `send(query, paths)`: assemble(paths) aufgerufen, Multi-Turn,
  leere/Fehler-Pfade (angepasst von `mode`/`picked`).
- `tests/chat_view.test.ts` — ContextPanel gehostet (über der Eingabe); Senden nutzt
  `panel.currentPaths()`; Modi-Buttons/`renderPicked` entfernt.

## Migration

Ersetzt die frische Slice-B-Kontextschicht: `context_source` (3-Modi) → `buildContext`;
`ChatSession.mode`/`picked` → fixe Pfadliste; `chat_view` Modi-Buttons + `renderPicked` → `ContextPanel`.
Betroffene Tests werden angepasst/entfernt. Streaming/Status/Stoppuhr/Neuer-Chat bleiben unverändert.

## Self-Review

- **Placeholder-Scan:** kein TBD/TODO.
- **Konsistenz:** Retrieval ausschließlich in `ContextPanel` (Vorschau); `buildContext`/`ChatSession`
  sehen nur Pfade. `RETRIEVE_N`-Puffer deckt das Nachrücken ab. Snapshot-Guards (wie `runSearch`)
  im `embed`/`search`-Wiring von `main`.
- **Scope:** ein Plan. Thinking + Tokens/Personas explizit ausgegliedert. D&D verworfen.
- **Ambiguität:** `autoK`-Default = `settings.chatK`; Ausschlüsse pro Frage (Reset beim Senden);
  Pins über Fragen hinweg; Picker = `FuzzySuggestModal` (UI, untested) — alles explizit.
