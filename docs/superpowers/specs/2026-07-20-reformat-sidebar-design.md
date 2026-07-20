# Design: Reformat-Sidebar + Erreichbarkeit (Slice C.2)

**Datum:** 2026-07-20
**Status:** Design freigegeben (brainstorming abgeschlossen)
**Slice:** C.2 — Folge-Slice zu [C.1 Selektions-Reformatter](2026-07-19-reformat-selection-design.md)
**Release-Ziel:** alles gebündelt in **0.16.0** (C.1 ist gemergt, aber noch unreleased)

## Auslöser

GUI-Smoke von C.1 war grün („Funktioniert alles super"), aber zwei Dinge kamen aus der
echten Nutzung zurück:

1. **Bug:** Der Command „Abschnitt umformatieren" verschwand plötzlich aus der Command-Palette.
2. **Wunsch:** Launchen aus der Sidebar statt nur über Palette/Kontextmenü — das passt zum
   etablierten Workflow (der Hub ist die gewohnte Anlaufstelle).

## Root Cause des Bugs (systematic-debugging, Hypothese bestätigt)

`reformat-selection` ist der **einzige** Command im Plugin mit `editorCallback`; alle anderen
nutzen `callback`. Die Obsidian-API dokumentiert:

> `editorCallback`: „A command callback that is **only triggered when the user is in an editor**."

Obsidian filtert solche Commands aus der Palette, sobald kein Markdown-Editor aktiv ist —
**Lesemodus**, Fokus in der Sidebar, Canvas/Graph/PDF/Settings. Vom Nutzer bestätigt: er war
im **Lesemodus**.

**Zweiter, verwandter Befund:** `Workspace.activeEditor` ist laut API `MarkdownFileInfo | null`
— *„This can be null if the active view has no editor."* Ein Sidebar-Panel darf die Auswahl
also **nicht erst beim Button-Klick** aus `activeEditor` lesen; zu diesem Zeitpunkt liegt der
Fokus im Panel. Das prägt das Design von Teil B.

**Nicht behebbar (Architektur, nicht Lücke):** Im Lesemodus stellt Obsidian dem Plugin keinen
Editor-State bereit; die sichtbare Markierung ist eine DOM-Selektion. Umformatieren im
Lesemodus ist daher grundsätzlich nicht möglich — die ehrliche Antwort ist ein erklärter,
deaktivierter Zustand, kein stilles Verschwinden.

## Scope

### A · Erreichbarkeits-Fix

`editorCallback` → `callback`. Der Command ist **immer** in der Palette sichtbar und erklärt
sich selbst statt zu verschwinden:

- Lesemodus → Notice „Formatierung im Lese-Modus nicht möglich — wechsle in den Bearbeiten-Modus."
- Kein Editor / keine Notiz → dieselbe Klasse Meldung.
- Nichts markiert → Notice „Nichts markiert."

Das Editor-Kontextmenü **existiert bereits** (C.1) und bleibt unverändert: es erscheint im
Bearbeiten-Modus, sobald etwas markiert ist. Im Lesemodus kann es nicht erscheinen (kein
`editor-menu`-Event ohne Editor). Es wird durch A und B lediglich auffindbar.

### B · Reformat-Panel (5. Hub-Tab)

Neuer Tab im bestehenden Sidebar-Hub: `Related · Search · Chat · Smart Apply · Reformat`.
Folgt dem `HubPanel`-Vertrag (`mount/onShow/onHide/onFileOpen/destroy`) und UI-STANDARD §1
(ein Frontend pro Plugin).

**Aufbau** (Layout vom Nutzer gewählt):

```
┌ Umformatieren ─────────────────┐
│ Markiert: „Der Index wird beim…"│
│ (3 Zeilen)                      │
│                                 │
│ SOFORT · offline                │
│  [ Tabelle kippen            ]  │
│  [ Tabelle → Liste           ]  │
│  [ In Callout einpacken      ]  │
│                                 │
│ MIT VORSCHAU · lokales LLM      │
│  [ → Liste / Stichpunkte     ]  │
│  [ → Fließtext               ]  │
│  [ → Tabelle                 ]  │
│  [ → Mermaid-Diagramm        ]  │
│                                 │
│ Eigene Anweisung                │
│  [_____________________] [ ▶ ]  │
└─────────────────────────────────┘
```

- **Buttons werden aus der `TRANSFORMS`-Registry gerendert** — die Registry bleibt die einzige
  Wahrheit; ein künftiger Transform erscheint automatisch in Picker **und** Panel.
- **Gruppierung nach `kind`:** „SOFORT · offline" (mechanisch, ersetzt sofort, `Cmd+Z`) vs.
  „MIT VORSCHAU · lokales LLM" (streamt ins Vorschau-Modal). Die Gruppierung ist funktional:
  sie sagt vorher, ob sofort etwas passiert und ob ein LLM laufen muss.
- **Freitext-Feld** direkt im Panel (kein Zwischen-Modal, da der Panel ohnehin Platz hat).

**Auswahl-Mitschrift (Kern des Panels):** Ein entprellter `selectionchange`-Listener hält
`{ file, from, to, text, mode }` fest, solange ein Markdown-Editor aktiv ist. Der Button-Klick
benutzt diesen gemerkten Stand statt `activeEditor` (das dann null sein kann). Der Listener
läuft nur, solange der Tab sichtbar ist (`onShow`/`onHide`).

**Zustände:** Ist keine brauchbare Auswahl vorhanden, sind **alle Buttons deaktiviert** und die
Kopfzeile nennt den Grund — „Formatierung im Lese-Modus nicht möglich." bzw. „Nichts markiert."
Kein Raten, keine Auto-Auswahl (bei Tabellen/Listen/Callouts wäre „der aktuelle Block"
mehrdeutig, und mechanische Transforms ersetzen ohne Vorschau).

### C · Staleness-Guard (aus C.1-v2 vorgezogen)

C.1 hat den Schutz gegen veraltete Positionen bewusst zurückgestellt. Der Sidebar-Workflow
macht ihn **notwendig**: zwischen Markieren und Klicken vergeht mehr Zeit, und der Nutzer war
zwischenzeitlich in einer anderen Ansicht.

Vor jedem `replaceRange`: steht an der gemerkten Range noch **exakt der gemerkte Text**? Wenn
nein → Abbruch mit Notice („Die Auswahl hat sich geändert — bitte neu markieren."), **kein
Schreiben**. Gilt für alle drei Eingänge (Command, Kontextmenü, Panel) und für mechanische wie
LLM-Transforms.

Damit entfällt auch die im README dokumentierte v1-Einschränkung — der README-Text wird
entsprechend aktualisiert.

### D · Smart-Apply-Modell-Dropdown

Parität zum Chat-Bereich: In der Smart-Apply-Settings-Sektion wird das Modell über ein Dropdown
der verfügbaren Modelle gewählt statt von Hand eingetragen. Verhalten und Fallback (Textfeld,
wenn der Endpunkt nicht erreichbar ist / keine Modelle liefert) werden vom bestehenden
Chat-Modell-Muster in `settings.ts` übernommen — kein neues Muster.

### Bewusst NICHT in diesem Slice

- Auto-Auswahl des Absatzes unter dem Cursor (verworfen, s.o.).
- Rechtsklick im Lesemodus (technisch unmöglich).
- Die übrigen C.1-Follow-ups: Endpunkt-Neuauflösung vor LLM-Transforms, Enter-zum-Absenden im
  Freitext-Modal, ```-Fence-Stripping bei LLM-Output.
- Outline-Composer (eigener späterer Slice).

## Architektur

### Pure Module (obsidian-frei, testbar) — hier liegt das Test-Gewicht

**`reformat_selection_state.ts`** (neu):

- `type ReformatReadiness = { kind: "ready"; text: string } | { kind: "reading-mode" } | { kind: "no-selection" } | { kind: "no-editor" }`
- `readinessMessage(r: ReformatReadiness): string` — Klartext-Meldung je Zustand (de-DE), zugleich
  Notice-Text für A und Kopfzeilen-Text für B (**eine** Wahrheit für beide).
- `canRun(r: ReformatReadiness): boolean`
- `selectionPreview(text: string, maxLen?: number): { snippet: string; lines: number }` — gekürzte
  Vorschau + Zeilenzahl für die Kopfzeile.
- `isRangeStale(currentText: string, capturedText: string): boolean` — Grundlage für C.

### Obsidian-Schicht (dünn)

- **`reformat_panel.ts`** (neu) — implementiert `HubPanel`; rendert Gruppen aus `TRANSFORMS`,
  hält die Auswahl-Mitschrift, schaltet Buttons/Kopfzeile über `reformat_selection_state`.
- **`hub_panel.ts`** — `TabId` um `"reformat"` erweitern.
- **`hub_view.ts` / `main.ts buildPanels()`** — 5. Panel registrieren.
- **`main.ts`** — Command auf `callback` umstellen; gemeinsamer
  `runTransform(def, captured, instruction?)`, den Command, Kontextmenü und Panel teilen
  (eine Ausführungs-Wahrheit); Staleness-Guard dort zentral.
- **`settings.ts`** — Smart-Apply-Modell-Dropdown nach Chat-Muster.
- **`styles.css`** — Panel-Styles, nur Theme-Variablen.

## Fehlerbehandlung

- Kein Editor / Lesemodus / keine Auswahl → deaktivierte Buttons + Grund (Panel) bzw. Notice
  (Command); **nie** stilles Nichtstun.
- Range veraltet → Notice, kein Schreiben (C).
- Mechanischer Parser passt nicht → bestehende Notice mit Transform-Label (aus C.1).
- LLM offline/Stream-Fehler → Fehler im Vorschau-Modal, nichts angewendet (aus C.1).
- Gemerkte Datei nicht mehr offen → wie „no-editor" behandeln.

## Tests

- **Pure Kern:** `reformat_selection_state` vollständig — alle vier Readiness-Zustände und ihre
  Meldungen, `selectionPreview` (Kürzen, Mehrzeiligkeit, Zeilenzahl, Leerstring),
  `isRangeStale` (identisch/geändert/leer).
- **Registry-Kopplung:** Test, der sicherstellt, dass die Panel-Gruppierung **alle**
  `TRANSFORMS`-Einträge abdeckt (kein Transform fällt aus dem Panel).
- **Glue** (Panel/Settings/main.ts): `tsc` + `lint` + bestehende Suite + GUI-Smoke, entsprechend
  der Repo-Konvention (obsidian-Views werden hier nicht unit-getestet; das Test-Gewicht trägt
  der pure Kern).
- **Prozess:** TDD (Default lt. AGENTS.md).

## Offene Detail-Entscheidungen für den Plan

- Debounce-Intervall des `selectionchange`-Listeners (Größenordnung 100–200 ms).
- Maximale Länge der Auswahl-Vorschau in der Kopfzeile.
- Ob das Freitext-Feld nach erfolgreichem Lauf geleert wird.
