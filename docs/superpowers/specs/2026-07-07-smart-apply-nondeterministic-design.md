# Smart Apply — Non-Deterministic Mode (Design)

**Datum:** 2026-07-07
**Status:** Design (brainstorming abgeschlossen, approved: Ansatz A + Zwei-Slice-Schnitt)
**Scope dieser Spec:** Slice 1 (Additiv). Slice 2 (Transformativ) ist skizziert, aber nicht Teil dieser Umsetzung.

## Problem & Motivation

Smart Apply läuft heute **rein deterministisch**: Das LLM liefert nur eine Zuordnung
nummerierter Original-Blöcke zu Template-Überschriften (`Assignment`), der Host baut den Body
aus **Original-Bytes** zusammen (`assembleBody`), `permutationCheck` garantiert Vollständigkeit,
und der `fm-source`-Gate verwirft jeden Frontmatter-Wert, der nicht **wörtlich** im Text vorkommt.
Erfinden ist per Konstruktion unmöglich.

Das ist für viele Einsätze genau richtig — aber es verschenkt Potenzial: Manchmal will man, dass
das LLM Informationen **erschließt** und **ergänzt** (z. B. `bereich`, `medium`, `autor`, `jahr`
ableiten, auch wenn nicht wörtlich genannt; eine fehlende Zusammenfassung oder Überleitung
schreiben) — nach bestem Wissen, mit **Konfidenzangabe**, damit das Risiko sichtbar statt
versteckt ist.

## Ziel

Ein **wählbarer Modus** pro Anwendung, der die Determinismus-Garantie kontrolliert aufweicht,
ohne den bewährten deterministischen Pfad zu gefährden. Der Nutzer behält granulare Kontrolle:
jede erschlossene/ergänzte Information ist einzeln, mit Konfidenz, annehmbar oder ablehnbar.

## Modi (Eskalations-Leiter)

| Modus | Body | Frontmatter |
|---|---|---|
| `deterministisch` (heute) | nur Zuordnung aus Original-Bytes | nur wörtlich (`content`) |
| `additiv` (**Slice 1**) | Original byte-heilig **+** neue, markierte Ergänzungsblöcke | wörtlich **+** erschlossen (`inferred`) |
| `transformativ` (**Slice 2**) | zusätzlich Umschreiben von Original-Blöcken erlaubt | wörtlich + erschlossen |

**Kern-Invariante Slice 1:** Im additiven Modus bleiben **alle Original-Blöcke byte-genau erhalten**.
Das LLM darf nur *zusätzliche* Blöcke einfügen — es darf Original-Text nicht verändern. Damit gilt
`permutationCheck` für die Original-Blöcke unverändert weiter; die Non-Fabrication-Garantie für
bestehenden Inhalt bleibt exakt.

## Architektur — Ansatz A (ein erweitertes Schema, modusabhängig gegated)

Das `Assignment`-Schema wird abwärtskompatibel erweitert; eine harte Gating-Schicht verwirft im
deterministischen Modus alle neuen Felder, sodass der bestehende Pfad **bit-identisch** bleibt
(abgesichert durch die 53 bestehenden `smart_apply`-Tests als Regressionsnetz). Es bleibt bei
**einem** LLM-Stream pro `propose()` (SEAM-VERTRAG 7).

### Datenmodell (`note_restructurer.ts`, `frontmatter.ts`)

```ts
type ApplyMode = "deterministisch" | "additiv" | "transformativ";
type Confidence = "hoch" | "mittel" | "niedrig";

interface Addition {
  id: string;                 // "add_0", "add_1" — Handle für granulare Auswahl
  targetHeading: string;      // muss Template-Heading sein, sonst verworfen
  text: string;               // LLM-erzeugt
  confidence: Confidence;
}

interface Assignment {
  version: number;            // 2 (1 bleibt gültig: additions optional, fehlt = leer)
  sections: { heading: string; blocks: string[] }[];
  unassigned: string[];
  additions?: Addition[];     // NEU — nur additiv
  frontmatter: Record<string, FmAssignedValue>;
}
```

`FmAssignedValue` (in `frontmatter.ts`): `source` erweitert um `"inferred"`; `inferred`-Werte
tragen zusätzlich `confidence: Confidence`. `content` und `empty` unverändert.

**Konfidenz-Format:** ordinale Stufen (`hoch`/`mittel`/`niedrig`), nicht numerisch. Begründung:
LLMs kalibrieren numerische Konfidenz schlecht; drei Stufen mappen sauber auf drei WCAG-taugliche
Icon-Formen (Form + Text, nicht Farbe — Rot-Grün-Sehschwäche des Nutzers). **Robustheit:** das
Konfidenz-Parsing normalisiert tolerant (englische Labels `high/medium/low`, Groß-/Kleinschreibung,
Whitespace) auf die drei Stufen; Unbekanntes/Fehlendes → `niedrig` (konservativ = default abgewählt).

### Modus-Wahl

- **Vorlagen-Default:** reservierter Meta-Key `smartapply_modus: additiv` im Vorlagen-Frontmatter.
  `parseTemplate` zieht ihn — wie schon `type` — als Meta heraus und entfernt ihn aus `keys`/
  `fmDefaults`, sodass er **nie in die Zielnotiz leakt**. Fehlt der Key → Default `deterministisch`.
  Exponiert als `tpl.defaultMode`. Ungültiger Wert → `deterministisch` (defensiv).
- **Cockpit:** 3-stufiges Segmented-Control (Deterministisch / Additiv / Transformativ). Initialwert =
  `tpl.defaultMode` (bzw. globaler Default, wenn Vorlage nichts sagt). Pro Anwendung übersteuerbar.
  „Transformativ" ist in Slice 1 **sichtbar aber disabled** (Leiter erkennbar, kommt in Slice 2).
- **Globaler Fallback-Default** in den Settings (Dropdown), Default `deterministisch` — hält das
  Gesamtverhalten rückwärtskompatibel.

### Prompt (`buildRestructurePrompt(tpl, blocks, mode)`)

Neuer `mode`-Parameter.
- `deterministisch`: exakt der heutige Prompt (`ANTI_FABRICATION`).
- `additiv`: neuer System-Prompt. Erlaubt zusätzlich (a) `additions` — neue Blöcke unter einer
  Template-Heading, jeder mit `confidence`; (b) `frontmatter` mit `source: "inferred"` + `confidence`
  für erschlossene Werte. **Bleibt verboten:** Original-Blöcke umschreiben/zusammenfassen; jede
  Original-`block_id` muss weiter genau einmal in `sections`/`unassigned` vorkommen. Der Prompt
  verlangt Zurückhaltung („nur ergänzen/erschließen, was fundiert ableitbar ist; im Zweifel `niedrig`
  oder weglassen") und ehrliche Selbst-Konfidenz.

### Pipeline & Gating (`smart_apply.ts` `propose()`)

Signatur: `propose(notePath, templatePath, mode, onToken, onReasoning, signal?, preDetection?)`.

Nach `parseAssignment` **modusabhängiges Gating**:
- `deterministisch`: `additions` verworfen; `inferred`-FM wird wie `content` behandelt und durch den
  bestehenden `fm-source`-Gate auf Wörtlichkeit geprüft (nicht wörtlich → `empty`). ⇒ heutiges Verhalten.
- `additiv`:
  - `additions` behalten, aber jede mit `targetHeading ∉ tpl.sections` wird verworfen (analog
    `reconcileAssignment`) → neuer Check `additions-target`.
  - `content`-FM weiterhin wörtlich gegated (ein Modell könnte fälschlich `content` statt `inferred`
    labeln — der Gate schützt davor).
  - `inferred`-FM behalten **mit** Konfidenz; **kein** Wörtlichkeits-Gate (Erschließung ist der Zweck).
- `permutationCheck`: unverändert über die Original-`block_id`s. `additions` (`add_*`) fließen **nicht**
  ein → Original-Vollständigkeitsgarantie exakt erhalten.

`hardOk` unverändert (Original-Garantien: parse + permutation + fm-roundtrip + assemble). `additions-target`
ist ein **weicher** Check (verworfene Additions blockieren nicht, sie erscheinen nur nicht).

### ApplyProposal-Erweiterung

```ts
interface ApplyProposal {
  // … bestehende Felder …
  mode: ApplyMode;
  additions: Addition[];                 // resolved, targetHeading-validiert
  // fmRows tragen bereits source; erweitert um optional confidence bei inferred
}
```

### Reiner Assembler & granulare Auswahl

Neu: `assembleProposedText(proposal, selection, auditTrail) → string`, rein/testbar.
- `selection`: Menge angenommener Item-IDs (inferred-FM-Keys + Addition-IDs). Nicht-angenommene
  inferred-FM → fallen auf `empty`/Default; nicht-angenommene Additions → weggelassen. `content`/
  `existing`-FM und Original-Blöcke sind immer drin (nicht abwählbar — sie sind sicher bzw. deine Daten).
- `auditTrail: boolean`: bei `true` werden angenommene erschlossene Infos markiert (s. u.).
- `propose()` ruft ihn mit **Default-Auswahl** (Konfidenz `hoch`+`mittel` an, `niedrig` aus) für die
  Preview. `persistApply` ruft ihn mit der **finalen User-Auswahl**.

### persistApply

Signatur: `persistApply(proposal, selection, auditTrail)`. Baut den finalen Text via
`assembleProposedText`, danach unveränderter Stale-Hash-Guard + einziger Write + Undo. `!hardOk` →
`{written:false, reason:"blocked"}` wie heute.

**Audit-Spur** (`auditTrail: true`):
- Erschlossene, angenommene FM-Keys → Sammel-Feld `smartapply_erschlossen: [key1, key2]` im Frontmatter
  (parsebar, via Obsidian-Search/Bases durchsuchbar).
- Angenommene Additions → dezenter `%%erschlossen: <konfidenz>%%`-Kommentar am Blockende (im
  Reading-View unsichtbar, in der Suche auffindbar).
`auditTrail: false` → nichts davon; sauberes Dokument. Undo bleibt in beiden Fällen Sicherheitsnetz.

### UI (`smart_apply_view.ts` / `SmartApplyPanel`)

- **Modus-Segmented-Control** im Kopf (Deterministisch / Additiv / Transformativ-disabled). Wechsel
  → **Re-Stream** (`propose` mit neuem Modus), da der Modus den Prompt ändert.
- **Konfidenz-Auswahl** dagegen → nur **Re-Assembly** (`assembleProposedText`), **kein** Stream.
- **FM-Diff:** `inferred`-Werte bekommen ein Konfidenz-Badge (Form + Text: ● hoch / ◐ mittel / ○ niedrig)
  + Checkbox. `existing`/`content`-Werte wie heute (keine Checkbox — sicher).
- **Body-Diff:** Additions erscheinen unter ihrer Ziel-Heading, visuell als „＋ ergänzt" markiert,
  mit Konfidenz-Badge + Checkbox. Original-Blöcke wie heute.
- **Default-Auswahl:** `hoch`+`mittel` angehakt, `niedrig` abgehakt (aber sichtbar).
- **Audit-Toggle** im Kopf/Footer: „Provenienz behalten" (an/aus).

### Settings

- Globaler Default-Modus (Dropdown, Default `deterministisch`).
- Kein Konfidenz-Schwellwert-Setting (YAGNI: „niedrig default abgewählt" ist fixe Regel).

## Testing (TDD)

- **Regression (kritisch):** die 53 bestehenden `smart_apply`-Tests bleiben grün → deterministischer
  Pfad bit-identisch. `buildRestructurePrompt` ohne/`deterministisch`-Modus = heutiger Output.
- **Schema:** `parseAssignment` akzeptiert `version:2` mit `additions`; `version:1` ohne bleibt gültig.
- **Gating:** deterministisch verwirft `additions`/`inferred`; additiv behält sie; `additions-target`
  verwirft stray Headings; `content`-Wörtlichkeits-Gate greift auch im additiven Modus.
- **permutationCheck:** unverändert grün mit Additions präsent (Original-IDs vollständig).
- **assembleProposedText:** Default-Auswahl, volle Abwahl, Teilauswahl, Audit an/aus (FM-Feld +
  `%%`-Kommentar korrekt gesetzt/weggelassen).
- **parseTemplate:** `smartapply_modus` als Meta extrahiert, nicht in `keys`/`fmDefaults`; ungültig →
  `deterministisch`; fehlt → `deterministisch`.
- **Vault-gated (`.vault.test.ts`):** die echten Capture-Vorlagen parsen sauber mit optionalem
  `smartapply_modus`.

## Bewusste Scope-Schnitte (YAGNI)

- **Slice 2 (transformativ / `rewrites` + Wort-Diff)** ist nicht Teil dieser Umsetzung. Das
  Segmented-Control zeigt den Modus disabled, damit die Leiter sichtbar ist.
- Kein Few-Shot, keine Reverse-Template-Synthese, kein Konfidenz-Schwellwert-Setting.
- Additions dürfen nur unter **bestehende** Template-Headings — keine neuen Überschriften erfinden.

## Slice 2 (Ausblick, nicht in Scope)

Transformativer Modus: Schema um `rewrites: [{ blockId, newText, confidence }]`. Ein umgeschriebener
Block ersetzt den Original-Text; `permutationCheck` kann keine Byte-Identität mehr prüfen (block-id-
Struktur bleibt), das Diff-Gate zeigt Wort-für-Wort Original ↔ umgeschrieben pro Block. Baut auf
Slice 1's Konfidenz-Gate, granularer Auswahl und Audit-Spur auf.
