# Smart Apply Dashboard (Smart Templating — Slice 1.5) — Design

**Goal:** Die Smart-Apply-Sidebar zum **persistenten Steuer-Cockpit** ausbauen — Modell wählen,
starten/stoppen, Lauf live mitlesen (Denken + Roh-Stream), Status sehen — und dabei den im Smoke
gefundenen **„Anwenden tut nichts"-Bug** beheben (stiller No-op bei stale/blocked) sowie den
**Reasoning-Modell-Hänger** (kein `suppressThinking`/`max_tokens` → 30-Min-Lauf) abstellen.

Aufsetzend auf Slice 1 (gemergt) + dem Frontmatter-/Übrig-Fix. Reine View-/UX-/Wiring-Slice — kein
neuer Pure-Core-Motor.

## Scope

- **Drin:** persistentes Cockpit (Header mit Modell-Picker/Status/Trigger/Stop), Live-`💭 Denken` +
  einklappbarer Roh-Stream, eigenes Smart-Apply-Modell + `suppressThinking` + `max_tokens`-Cap,
  Apply-Feedback (warum gesperrt) + Stale-Pfad mit „Neu erzeugen & anwenden", Template-`<select>` im
  Header.
- **Draußen (YAGNI/später):** geteilte ChatView-Helfer-Extraktion (diese Slice **kopiert/spiegelt**
  die Muster); zweiter eigener Endpoint (Modell reicht, Chat-Endpoint geteilt); Linter-Heading-Level-
  Toleranz (bekannte Wechselwirkung, separat); Batch/Mehr-Notiz; Few-Shot (bleibt Slice 1.1).

## Entscheidungen (aus dem Brainstorming, ratifiziert)

- **Form A — persistentes Cockpit.** Die Sidebar bleibt offen wie der Chat: fixer Header oben
  (Modell · Verbindungsstatus · `💭`-Toggle · „Auf aktive Notiz anwenden" · **Stop**), der Lauf + Diff
  rendert *darin*. Command/Ribbon **enthüllen** das Cockpit (kein erzwungener Auto-Run).
- **Live B — Denken + Fortschritt + Roh-Stream.** Reasoning strömt live in ein `💭 Denken`-`<details>`;
  Stoppuhr/Status; ein **einklappbarer „Roh-Stream"** zeigt das durchlaufende JSON-Assignment
  (Default zu — Transparenz/Debug). Der Body/Diff erscheint beim Finalisieren (Host-Assemblierung).
- **Modell A — eigenes Modell, Chat-Endpoint geteilt.** Smart Apply bekommt ein eigenes Modell
  (Header-`<select>` via `listModels`); leer = Chat-Modell. Plus **Pflicht-Fixes:** `suppressThinking`-
  Toggle + `max_tokens`-Cap. **Stop** bricht jederzeit ab (`SmartApply.abort()` ist vorhanden).
- **Apply-Stale A — Feedback + „Neu erzeugen & anwenden".** Bei `{written:false, reason:"stale"}`:
  sichtbare Meldung + ein-Klick-Rebuild gegen den aktuellen Stand → bei `hardOk` schreiben. Kein
  stiller No-op.
- **Architektur Option 1 — kopieren statt extrahieren.** `chat_view.ts` bleibt unangetastet; das
  Cockpit **spiegelt** die ChatView-Muster (Modell-Dropdown, Verbindungsstatus, Stop-Toggle,
  Reasoning-`<details>`, Working-Indicator). Konsistent mit der „kopieren statt shared package"-Linie
  des Plugins (vgl. SSE-Transport). Geteilte Extraktion bleibt spätere Aufräum-Option.
- **Template-Wahl im Header** als `<select>` über `templateDir`-Dateien (vorausgewählt auf die
  Erkennung) — alles im Panel, kein Modal mehr im Cockpit-Fluss. (Die `pickTemplate`-FuzzySuggest aus
  Slice 1 bleibt im Code, wird vom Cockpit aber nicht mehr im Standardfluss gebraucht.)

## Architektur

`SmartApplyView` wird vom transienten Diff-Gate zum **persistenten Cockpit** ausgebaut (eine View, nicht
zwei). Pure-Core (`smart_apply.ts`/`note_restructurer.ts`/`template_matcher.ts`/`frontmatter.ts`) bleibt
obsidian-frei; nur die View + `settings.ts` + `main.ts` fassen `obsidian` an. Streaming weiter via
`ChatClient.stream` → `streamSSE` (XHR; `fetch` gesperrt). TS strict, keine `any`-Casts.

Der einzige destruktive Write bleibt in `SmartApply.persistApply` (Stale-Hash-Guard, 1-Klick-Undo) —
unverändert. Neu ist die **View-Zustandsmaschine** drumherum + die Modell-/Denken-Steuerung.

## Zustandsmaschine (Cockpit-Body)

Ein `state`-Feld treibt das Rendering (volles `empty()`+rebuild pro Übergang → keine Listener-Leaks):

```
idle      — keine/bereit: Hinweis „Notiz wählen + Anwenden", Header aktiv
running   — Spinner + Stoppuhr + live 💭 Denken + einklappbarer Roh-Stream + STOP
diff      — Zwei-Flächen-Diff (Frontmatter-Tabelle + Body-Sektions-Stack + Übrig) + Guard-Banner
            + Aktionsleiste (Anwenden/Verwerfen/Erneut)
applied   — „angewendet" + Rückgängig
stale     — „Notiz wurde zwischenzeitlich geändert" + „Neu erzeugen & anwenden"
error     — Abbruch/Fehler („Verworfen" bei abgebrochen; sonst Notice-Text) + zurück zu idle
```

Übergänge: Trigger → `running`; Stream-Ende → `diff` (oder `error`); Anwenden → `applied` |
`stale` (re-read-Hash-Mismatch) | bleibt `diff` (Guard `!hardOk`, sichtbar begründet); „Neu erzeugen &
anwenden" (aus `stale`) → `running` → bei `hardOk` direkt schreiben → `applied`; Stop → `abort()` →
`error`/`idle`; Verwerfen → `idle`; Erneut → `running`.

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/smart_apply_view.ts` | **ändern (Ausbau)** | Persistenter Header (Modell-`<select>` + Verbindungspunkt + `💭`-Toggle + Template-`<select>` + „Auf aktive Notiz anwenden" + **Stop**) + Body-Zustandsmaschine. Live-`onToken`/`onReasoning` füllen Roh-Stream-Pane + `💭`-`<details>`. Stale/error-Zustände + „Neu erzeugen & anwenden". Gespiegelte `chat_view`-Muster (DOM-Helfer, Working-Indicator, Stop-Toggle, Reasoning-`<details>`). `SmartApplyViewDeps` erweitert (s. Schnittstellen). |
| `src/smart_apply.ts` | **ändern** | Der 3. Konstruktor-Arg `temperature: () => number` wird zu `params: () => { temperature: number; suppressThinking: boolean; maxTokens: number }` (gespiegelt aus `ChatSessionDeps.params`); `propose` reicht alle drei in die `client().stream(...)`-Opts durch. Diff-Gate-Kontrakt (`build`/`reroll`/`onToken`/`onReasoning`) unverändert; `abort()` bereits da. |
| `src/chat_client.ts` | **ändern** | `stream`-Opts um `maxTokens?: number` erweitern → `max_tokens` in den Request-Body (`...(opts?.maxTokens != null ? { max_tokens: opts.maxTokens } : {})`). `temperature`/`suppressThinking` schon unterstützt. |
| `src/settings.ts` | **ändern** | `+ smartApplyModel: string` ('' = Chat-Modell), `+ smartApplySuppressThinking: boolean` (false), `+ smartApplyMaxTokens: number` (Default 2048). Builder-Zeilen im bestehenden Muster in die „Smart Apply"-Sektion. |
| `src/main.ts` | **ändern** | Cockpit-Deps verdrahten: `listModels`/`getModel`/`setModel` (Smart-Apply-Modell, gespiegelt aus der Chat-Verdrahtung; `getModel` = `smartApplyModel || chatModel`), `params()` liefert `{ temperature: smartApplyTemperature, suppressThinking: smartApplySuppressThinking, maxTokens: smartApplyMaxTokens }`, `activeNotePath`/`listTemplates`/`ping`. Command/Ribbon → `activateSmartApplyView()` **enthüllt nur** das Cockpit; **KEIN Auto-Run** — Trigger ausschließlich über den „Auf aktive Notiz anwenden"-Button. |
| `tests/smart_apply_view.test.ts` | **ändern** | Header rendert Modell/Status/`💭`/Stop; Zustandswechsel idle→running→diff→applied→stale; Stop ruft `abort`; „Neu erzeugen & anwenden" ruft re-propose + accept; Live-`💭`/Roh-Stream-Append; gesperrtes Anwenden zeigt Grund; kein `innerHTML`/Inline-Style. |
| `tests/smart_apply.test.ts` | **ändern** | `propose` reicht `suppressThinking`+`maxTokens` korrekt in die Stream-Opts (Capture-Spy); Default-Werte. |
| `tests/settings.test.ts` | **ändern** | Backward-Compat-Merge der drei neuen Felder (alter `data.json` → Defaults). |

## Schnittstellen (Delta)

```ts
// smart_apply.ts — 3. ctor-Arg `temperature: () => number`  →  `params: () => SmartApplyParams`
export interface SmartApplyParams { temperature: number; suppressThinking: boolean; maxTokens: number }
// Stream-Call (build/reroll/onToken/onReasoning-Kontrakt unverändert):
//   const p = this.params();
//   client().stream(messages, onToken, onReasoning, signal,
//     { temperature: p.temperature, suppressThinking: p.suppressThinking, maxTokens: p.maxTokens });
// chat_client.ts mappt opts.maxTokens → body.max_tokens.

// smart_apply_view.ts — SmartApplyViewDeps erweitert
export interface SmartApplyViewDeps {
  build: (notePath: string, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  accept: (p: ApplyProposal) => Promise<ApplyResult>;
  reroll: (p: ApplyProposal, onToken: (t: string) => void, onReasoning: (t: string) => void) => Promise<ApplyProposal>;
  openPath: (p: string) => void;
  abort: () => void;
  // NEU (gespiegelt aus ChatViewDeps):
  activeNotePath: () => string | null;        // die aktuelle aktive Markdown-Notiz (oder null)
  listModels: () => Promise<string[]>;         // Modelle vom (Chat-)Endpoint
  getModel: () => string;                      // smartApplyModel || chatModel
  setModel: (m: string) => void;               // persistiert smartApplyModel
  listTemplates: () => Promise<string[]>;      // templateDir/*.md (für das Header-<select>)
  getSuppress: () => boolean;                  // smartApplySuppressThinking
  setSuppress: (v: boolean) => void;
  ping: () => Promise<boolean>;                // Verbindungsstatus
}
```

## Apply-Fix (der Bug)

- **Gesperrtes Anwenden begründen:** Im `diff`-Zustand ist „Anwenden" nur bei `proposal.hardOk` aktiv;
  ist es gesperrt, listet das Guard-Banner die fehlgeschlagenen harten Checks (assignment-parse/
  permutation/fm-roundtrip) — kein stummes Disabled.
- **Stale sichtbar + ein-Klick-Rebuild:** `onAccept` → `persistApply` → `{written:false,reason:"stale"}`
  → Zustand `stale` mit Meldung „Notiz wurde zwischenzeitlich geändert (z.B. durch einen Linter) —
  neu erzeugen?" + Knopf **„Neu erzeugen & anwenden"**: re-`build` gegen den aktuellen Notizstand →
  bei `hardOk` sofort `accept` → `applied`. (Sicher: liest immer den aktuellen Stand; überschreibt nie
  unbemerkt fremde Änderungen.)
- **Linter-Wechselwirkung (dokumentiert, nicht gefixt):** Ein Vault-Linter, der Smart-Applys Output
  beim Speichern nachbearbeitet (z.B. `##`→`#`, Frontmatter-Title-Alias), kann (a) Stale auslösen
  (→ der obige Pfad fängt es) und (b) Re-Runs auf bereits strukturierte Notizen erschweren. Heading-
  Level-Toleranz ist bewusst **nicht** in dieser Slice (separater Punkt).

## Hänger-Fix (Reasoning-Modell)

`propose` reicht `suppressThinking` + `max_tokens` durch; das Cockpit erlaubt ein eigenes (schnelles)
Smart-Apply-Modell + `💭`-Toggle. Der `max_tokens`-Cap (Default 2048) verhindert unbegrenzte
Generierung; **Stop** (`abort()` über den vorhandenen `AbortController`) bricht jederzeit ab. Damit ist
der 30-Min-Blindlauf strukturell ausgeschlossen.

## Datenfluss

```
Cockpit offen (persistent). Header: Modell/Template/💭 wählbar, Verbindungspunkt live.
„Auf aktive Notiz anwenden“ → activeNotePath() → (kein aktives md → Hinweis, bleibt idle) → state=running
  → deps.build(notePath, onToken, onReasoning)   [main: detect → (Template aus Header-<select> | Erkennung) → propose]
       propose: ONE streamSSE-Call mit { temperature, suppressThinking, max_tokens }
       onReasoning → 💭-<details> live · onToken → Roh-Stream-Pane live · Stoppuhr
  → Stream-Ende → ApplyProposal → state=diff (Guard-Banner + Zwei-Flächen-Diff + Übrig)
„Anwenden“ → deps.accept → persistApply (Stale-Hash-Guard)
  → written → state=applied (+ Rückgängig)
  → stale   → state=stale (+ „Neu erzeugen & anwenden“ → build gegen aktuell → accept)
  → blocked → bleibt diff, Banner nennt die fehlgeschlagenen Checks
„Stop“ → deps.abort() → state=error/idle.  „Verwerfen“ → idle.  „Erneut“ → running.
```

## Out of scope (bewusst)

- Geteilte ChatView-Helfer-Extraktion (diese Slice kopiert; spätere DRY-Option).
- Zweiter eigener Endpoint (nur eigenes Modell; Endpoint vom Chat).
- Linter-Heading-Level-Toleranz / linter-robuste Re-Runs.
- Batch / Mehr-Notiz; Few-Shot (Slice 1.1); Reverse Synthesis (Slice 2).
- Persistente Lauf-Historie im Cockpit (nur der aktuelle Lauf).

## Teststrategie (TDD Default)

vitest + happy-dom; Pure-Cores in Node. Reihenfolge: (1) `smart_apply.ts` propose reicht
`suppressThinking`+`max_tokens` durch (Capture-Spy auf die Stream-Opts) + Defaults. (2) `settings.ts`
Backward-Compat-Merge der drei Felder. (3) `smart_apply_view.ts` Cockpit: Header-Render
(Modell/Status/`💭`/Template/Stop), Zustandsmaschine (idle→running→diff→applied→stale), Stop→`abort`,
„Neu erzeugen & anwenden"→re-build+accept, gesperrtes-Anwenden-mit-Grund, Live-`💭`/Roh-Stream-Append,
kein `innerHTML`/kein Inline-`style`. (4) `main.ts`-Verdrahtung: Smoke via `tsc` + Suite grün (kein
Live-Netz; Deps injiziert). Vor Commit: `npx tsc --noEmit` + `npm test` + `npm run lint` grün; danach
`npm run build` für den Live-Reload-Smoke.
