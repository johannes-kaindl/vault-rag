# Design: Selektions-Reformatter (Slice C.1 „Inline-Composer")

**Datum:** 2026-07-19
**Status:** Design freigegeben (brainstorming abgeschlossen)
**Slice:** C „Inline-Composer" — erster Sub-Slice (`C.1`)

## Problem & Ziel

Nutzer sollen einen **markierten Abschnitt einer Notiz** per Befehl umformatieren
können — z.B. Fließtext → Liste/Tabelle/Mermaid/Callout, eine Tabelle kippen, eine
Liste zu einer Tabelle machen, aus Stichpunkten Fließtext erzeugen. Heute muss man
das von Hand tippen oder ein externes Tool bemühen.

Das Feature ist die klassische **Inline-Composer**-Aufgabe (Slice C der Roadmap in
`AGENTS.md`) und nutzt vorhandene Infrastruktur: LLM-Zugang (`ChatClient`, SSE-Stream),
Modal-/Suggester-Muster (`note_picker.ts`, `settings.ts`) und die obsidian-freie
Testbarkeitsgrenze (VaultAdapter-Doktrin).

## Scope

### v1-Transforms

**Mechanisch** (offline, instant, verlustfrei — kein Endpoint nötig):
- `Tabelle kippen` (transpose)
- `Tabelle → Liste`
- `In Callout einpacken` (Callout-Typ wählbar)

**LLM** (gestreamt, mit Vorschau vor dem Anwenden):
- `→ Liste/Stichpunkte`
- `→ Fließtext` (Stichpunkte auflösen)
- `→ Tabelle` (semantische Spalten-Erkennung — deckt auch „Liste → Tabelle" ab)
- `→ Mermaid-Diagramm`
- `Eigene Anweisung` (Freitext)

### Bewusst NICHT in v1

- **Outline-Composer** (eigener späterer Slice): in der Sidebar einen Gliederungspunkt
  wählen → dessen Abschnitt umformatieren/ersetzen/ergänzen. Andere Interaktion
  (Struktur-Baum statt Editor-Selektion) und andere Risiken (ganze Abschnitte statt
  Selektion) → separater Slice, nachdem der Selektions-Kern steht.
- Mechanisches `Liste → Tabelle` (Spalten-Ambiguität) — vom LLM-`→ Tabelle` abgedeckt.
- Neue Settings, Modell-Override pro Transform, Mermaid-Syntax-Validierung/-Render.

## Kern-Entscheidungen (aus dem Brainstorming)

1. **Hybrid-Engine:** deterministische Transforms laufen mechanisch (offline, kein
   Halluzinationsrisiko bei reiner Umstrukturierung), semantische übers LLM. Passt zum
   offline-first-Ethos und schützt Datenintegrität bei reinen Struktur-Ops.
2. **Vorschau nur bei LLM:** mechanische Transforms ersetzen die Selektion sofort
   (Cmd-Z genügt); LLM-Transforms streamen in ein Vorschau-Modal, destruktiv erst nach
   Bestätigung.
3. **Drei Eingänge, eine Engine:** Command+Picker (Basis, mobil/hotkey-bar),
   Editor-Kontextmenü (dünner Aufsatz auf denselben Handler), Freitext (Picker-Eintrag
   „Eigene Anweisung…"). Kein eigenes Hub-Panel.
4. **Eigenes leichtes Vorschau-Modal** statt SmartApply-Panel-Reuse — SmartApplys
   Diff-Gate ist auf Ganze-Notiz-Reflow + Relevanz-Ranking zugeschnitten, für
   „alt → neu einer Selektion" zu schwer.

## Architektur

Folgt der VaultAdapter-Doktrin: Logik obsidian-frei und in Node testbar, obsidian nur
an der Kante. `src/` bleibt flach (Präfix `reformat_`).

### Pure Module (obsidian-frei, testbar)

- **`reformat_transforms.ts`** — Registry der Transforms als einzige Wahrheit:
  `interface TransformDef { id: string; label: string; kind: "mechanical" | "llm" }`
  plus die Liste. Picker (Anzeige) und Dispatch (Ausführung) lesen dieselbe Quelle.
- **`reformat_mechanical.ts`** — die deterministischen Parser als reine Funktionen:
  - `transposeTable(md: string): string` — Markdown-Tabelle kippen.
  - `tableToList(md: string): string` — jede Zeile → Listenpunkt (Header als
    `Spalte: Wert`-Paare oder erste Spalte als Label; im Plan festzulegen).
  - `wrapInCallout(md: string, type: string): string` — Auswahl in `> [!type]` packen.
  - Robust gegen Edgecases: Alignment-Zeile (`|:--|--:|`), escaped Pipes (`\|`),
    ragged rows, Einzelspalte. Bei nicht-passender Struktur ein **erkennbares Signal**
    (Rückgabe `null` o.ä.) statt kaputter Ausgabe — der Glue macht daraus eine Notice.
  - **Hier liegt das Haupt-Test-Gewicht.**
- **`reformat_prompts.ts`** — pro LLM-Format ein Prompt-Builder
  `buildMessages(text: string, instruction?: string): ChatMessage[]`. Reine Funktion,
  liefert System- + User-Message. Freitext-Variante hängt `instruction` an.

### Obsidian-gekoppelte Module (dünn, nach `note_picker.ts`-Präzedenz)

- **`reformat_picker.ts`** — `FuzzySuggestModal` über die Transform-Registry; der
  Eintrag „Eigene Anweisung…" öffnet ein kleines Text-Input-Modal für die Freitext-
  Anweisung.
- **`reformat_preview_modal.ts`** — `Modal`: zeigt Ur-Text und gestreamtes Ergebnis,
  Buttons `[Anwenden] [Neu generieren] [Verwerfen]`. Hält den `AbortController` für
  den Stream.

### Glue in `main.ts`

- Command `reformat-selection` („Abschnitt umformatieren") via `editorCallback`
  (liefert Editor + View).
- Editor-Kontextmenü-Eintrag via `registerEvent(workspace.on("editor-menu", …))` →
  ruft denselben Handler.
- Orchestrierung: Selektion + Range festhalten → Picker → mechanisch anwenden **oder**
  Vorschau-Modal + `ChatClient.stream`.
- LLM-Config: Reuse der bestehenden Chat-Endpoint/Modell-Auflösung (dieselbe wie das
  Chat-Panel). Transform-Calls fix mit niedriger `temperature` (~0.2) und
  `suppressThinking: true`.

## Ablauf / Datenfluss

1. **Auslösen** (Command/Hotkey/Kontextmenü): `editor.getSelection()` + Range
   (`from`/`to`) merken. Leere Selektion → Notice „Bitte einen Abschnitt markieren",
   Abbruch.
2. **Picker** öffnen → Transform wählen (oder „Eigene Anweisung…" → Text-Input).
3. **Mechanisch:** pure Funktion auf den Selektionstext.
   - Erfolg → `editor.replaceRange(result, from, to)`. Instant; Cmd-Z macht rückgängig.
   - Struktur passt nicht (z.B. Transpose auf Nicht-Tabelle) → Notice, **keine
     Änderung**.
4. **LLM:** Vorschau-Modal öffnen → `reformat_prompts.buildMessages(...)` →
   `ChatClient.stream(messages, onContent, onReasoning, signal, { temperature, suppressThinking, maxTokens })`
   streamt Tokens in den Ergebnisbereich des Modals.
   - `[Anwenden]` → `editor.replaceRange(result, from, to)`, Modal schließen.
   - `[Neu generieren]` → erneut streamen.
   - `[Verwerfen]` / Modal schließen → `AbortSignal` bricht den Stream ab, **keine
     Änderung**.

## Selektion & Anwenden (Korrektheits-Punkt)

Picker und Modal ziehen den Editor-Fokus ab → die Editor-Selektion geht verloren.
Deshalb beim Auslösen **Range (`from`/`to`) und Text festhalten** und beim Anwenden
gezielt `editor.replaceRange(neu, from, to)` verwenden — **nicht** `replaceSelection`
(würde an der aktuellen, evtl. verschobenen Cursor-Position schreiben).

**Bekannte v1-Grenze:** Editiert der Nutzer die Notiz zwischen Auslösen und Anwenden,
kann die gemerkte Range veralten und an falscher Stelle schreiben. Selten; für v1
dokumentiert, kein aktiver Schutz (mögliches v2: Range gegen den erwarteten Ur-Text
verifizieren, bei Abweichung abbrechen).

## Fehlerbehandlung

- **Leere Selektion** → Notice, Abbruch.
- **Mechanischer Parser trifft falsche Struktur** → Notice („Auswahl ist keine
  Markdown-Tabelle" o.ä.), **nie** kaputte Ausgabe schreiben.
- **LLM offline / Stream-Fehler** → Fehler im Modal sichtbar, **nichts** angewendet
  (destruktiv erst nach Bestätigung — safe by design).
- **Abbruch während Stream** → `AbortController` sauber beenden.

## Tests

- **Schwerpunkt pure Module:**
  - `reformat_mechanical`: Transpose (Header, Alignment-Zeile, escaped `\|`, ragged
    rows, Einzelspalte), `tableToList`, `wrapInCallout` (verschiedene Typen); jeweils
    der Nicht-passt-Fall (Signal statt Garbage).
  - `reformat_prompts`: Message-Struktur je Format; Freitext hängt `instruction` an.
  - `reformat_transforms`: Registry-Konsistenz (ids eindeutig, kinds gültig).
- **Glue (Modal/Picker):** leichtgewichtiger happy-dom-Test nach bestehendem
  Panel-Muster (optional; das Test-Gewicht trägt der pure Kern).
- **Prozess:** TDD (Default lt. `AGENTS.md`), alle Tests grün nach jeder Änderung.

## Offene Detail-Entscheidungen für den Plan

- Genaues Ausgabeformat von `tableToList` (Header-Paare vs. erste Spalte als Label).
- Callout-Typ-Auswahl: fester Default (`note`) mit Nachfrage, oder Typ im Picker.
- `maxTokens`-Deckel für Transform-Streams (Kontext-abhängig).
- Exakte Prompt-Formulierungen je Format (im TDD gegen erwartete Ausgaben schärfen).
