# Smart-Apply Diff-Gate — UI-Redesign — Design

**Datum:** 2026-06-25
**Status:** Design abgenommen, bereit für Plan
**Scope:** Rein View-seitiger Umbau des Smart-Apply-Diff-Gates (`src/smart_apply_view.ts` `renderDiff`-Pfad + `styles.css`). **Keine** Änderung an `smart_apply.ts`/Core/Pipeline — alle nötigen Daten liegen bereits im `ApplyProposal`.

## Problem

Der GUI-Smoke (Pilot Gespräch) bestätigte: technisch routet Smart Apply korrekt, aber das Diff-Gate-UI verstößt gegen UX-Best-Practices (Screenshot 2026-06-25):

1. **Der „Diff" ist keiner:** `renderTwoSurface` zeigt zwei rohe `<pre>`-Blöcke (Original | Vorschlag), je `max-height:200px`, `font-size:11px` — abgeschnitten, ohne Highlighting; der Nutzer muss die Änderung selbst suchen.
2. **Frontmatter doppelt:** einmal als Rohtext im Vorschlag-Pane, einmal als Tabelle darunter.
3. **Frontmatter-Tabelle verrauscht:** leere neue Felder (`datum`/`art`/…) als „`+` Änderung" gelistet, unveränderte (`title`/`created`/`updated`) mit vollem Wert — die echten Änderungen (`type`/`status`) gehen unter.
4. **Der Kern-Wert (Body-Reflow) ist unsichtbar:** welcher Original-Block unter welche Überschrift wandert, erkennt man in den Mini-Panes nicht.
5. **Dichte/Hierarchie:** alles 11–12 px, gedrängt, keine Gruppierung/Lese-Reihenfolge.

## User-Prioritäten (Multi-Select-Klärung)

Beim Review schaut der Nutzer auf: **(1) geht kein Body-Inhalt verloren** (Reflow + Übrig), **(2) welche Frontmatter-Felder werden gefüllt** (entrauscht), **(3) schneller Plausibilitäts-Scan**. **Kein** klassisches farbiges Text-Diff (bewusst abgewählt — für strukturelle Umordnung unübersichtlich).

## Entscheidungen

1. **Semantische 3-Ebenen-Ansicht** (Ansatz A) statt Roh-Text-Panes. *Verworfen:* B (nur Minimal-Polish — adressiert Reflow nicht) und C (Tabs — versteckt Info hinter Klicks, zu schwer fürs schmale Seitenpanel).
2. **Reihenfolge: Scan-Kopf → Frontmatter → Body-Reflow → Rohtext (ausklappbar) → Aktionen.** Frontmatter über Body, weil das die Notiz-Struktur spiegelt (intuitiver, vom Nutzer gewünscht).
3. **Rohtext bleibt erhalten, aber on-demand** (ausklappbares `<details>`) — als Notnagel, nicht prominent.
4. **WCAG 1.4.1 (Rot-Grün-Sehschwäche):** jeder Status redundant über Form/Icon + Text, Farbe nur sekundär. Bestehende form-distinkte `+`/`−`-Icons bleiben.

## Architektur

Rein in `src/smart_apply_view.ts` (`renderDiff` und die von ihm gerufenen `render*`-Methoden) + `styles.css` (`vault-rag-sa-*`). `renderDiff` orchestriert künftig: `renderGuardScan` → `renderFrontmatter` → `renderReflow` → `renderRawDetails` → `renderActions` → `renderReasoning`.

**Datenquelle (alles vorhanden im `ApplyProposal`):**
- `type: string`, `templatePath`, `detection: {source, confidence}` → Scan-Kopf.
- `sectionDiff: SectionDiff[]` mit `{heading, blockIds, provenance}` → Reflow (provenance = lesbare Inhalts-Vorschau, SEAM-Vertrag).
- `unassigned: SourceBlock[]` → „Übrig"-Indikator.
- `fmRows: FmRow[]` mit `{key, original?, proposed?, change}` (`change`: `neu`|`geaendert`|`unveraendert`|`entfernt`) → Frontmatter, gruppiert.
- `checks: CheckResult[]`, `hardOk: boolean` → Prüf-Status.
- `originalText`, `proposedText` → Rohtext-Detail.

### Komponenten

**1 · Scan-Kopf (`renderGuardScan`)** — ersetzt das reine Guard-Banner.
- Zeile 1: Prüf-Status redundant — Icon (`circle-check` / `circle-x`) + Text „Bereit zum Anwenden" / „Anwenden gesperrt" (+ Fehl-Checks-Liste wie bisher bei `!hardOk`).
- Zeile 2: `Vorlage: <type>` + Detection-Label (`confirmed`→„Typ aus Frontmatter", `likely`→„automatisch erkannt", `none`→„manuell gewählt").
- Zeile 3: Stat-Chips — `<zugeordnet>/<gesamt> Blöcke zugeordnet · <K> übrig · <J> Felder gesetzt`. (`gesamt` = `Σ blockIds + unassigned.length`; `zugeordnet` = `Σ blockIds`; `J` = Anzahl prominenter FM-Zeilen.)

**2 · Frontmatter (`renderFrontmatter`, entrauscht)** — zwei Gruppen:
- **Prominent „gesetzt":** Zeilen mit `change ∈ {neu, geaendert}` **und** nicht-leerem `proposed`; plus alle `change=entfernt` (Warn-Form, da Wert wegfällt). Darstellung: Icon (Form pro `change`) + Key + `→ <proposed>` (bei `geaendert`/`entfernt` zusätzlich der alte Wert).
- **Zurückhaltend, ausklappbar:** alle übrigen — neue leere Felder (`change=neu`, `proposed` leer) + `change=unveraendert`. Ein `<details>`-Summary „N leere · M unveränderte Felder" listet sie gedimmt.
- Leere FM-Sektion (`fmRows.length===0`) → nichts.

**3 · Body-Reflow (`renderReflow`, neu — der Kern)** — pro `sectionDiff`-Eintrag eine Zeile:
- Überschrift (`heading`) + Block-Zahl-Badge (`blockIds.length` „Block"/„Blöcke").
- Darunter die Inhalts-Vorschau (`provenance`, gekürzt) als gedimmter Sekundärtext.
- Leere Überschrift (`blockIds.length===0`) gedimmt mit „—".
- **Übrig-Indikator** (Sicherheits-Kern, redundant kodiert): `unassigned.length===0` → `circle-check` + „Übrig: nichts verloren" (success). Sonst → `alert-triangle` + „N Block(e) nicht zugeordnet" + Liste der `unassigned[].text` (gekürzt), in Warn-Form/-Farbe.

**4 · Rohtext (`renderRawDetails`)** — ein `<details>` (zu by default) „Rohtext anzeigen (Original / Vorschlag)", das die bisherigen zwei `<pre>`-Panes enthält (Original/Vorschlag), jetzt mit größerer `max-height` und lesbarer Schrift.

**5 · Aktionen / Reasoning** — unverändert (`renderActions`, `renderReasoning`).

### Styling (`styles.css`)
- Lesbarere Basis (≥ `var(--font-ui-small)` statt 11 px), konsistentes Spacing (Sektionen via leichte Trenner/`margin`), Sektions-Titel als `--text-muted`-Caps.
- Reflow-Zeilen als ruhige Gruppen (Heading fett, Provenance gedimmt eingerückt).
- Status-Farben nur als **sekundärer** Layer über Form+Text (`--text-success`/`--text-error`/`--text-warning`).
- Spezifität niedrig halten (`:where()` wo Overrides möglich), Obsidian-Variablen statt Hex.

## Testing

Wie die bestehende `tests/smart_apply_view.test.ts` (headless, Obsidian-Mock, `setIcon`→`data-icon`-Attribut). Neue/angepasste Asserts pro Zustand:
- Scan-Kopf rendert Prüf-Status mit distinktem `data-icon` + Text; Stat-Chips zeigen korrekte Zahlen (zugeordnet/übrig/gesetzt).
- Frontmatter: gesetzte Felder prominent, leere/unveränderte im `<details>`; ein gefülltes vs. leeres `neu`-Feld landen in verschiedenen Gruppen.
- Reflow: pro `sectionDiff` Heading + Block-Zahl + Provenance; Übrig-Indikator distinkt für leer (success-Form) vs. nicht-leer (warn-Form + gelistete Texte).
- Rohtext-`<details>` vorhanden, enthält Original- und Vorschlag-Pane.
- Bestehende Verhaltens-Tests (Anwenden gesperrt bei `!hardOk`, Buttons) bleiben grün.

## Scope-Schnitte (bewusst NICHT)

- **Keine Core-/Pipeline-Änderung** (`smart_apply.ts`, `note_restructurer.ts` etc.) — nur View + CSS.
- **Kein farbiges Inline-Text-Diff** (Nutzer abgewählt).
- **Keine** Änderung an Header/Ranking/idle/running/applied/stale/error-Zuständen — nur der `diff`-Zustand wird umgebaut.
- Keine neuen ApplyProposal-Felder.

## Offene Punkte für den Plan

- Kürzungslänge für `provenance`/`unassigned`-Vorschau (z.B. ~80 Zeichen, ellipsis) — im Plan festlegen.
- Reihenfolge der prominenten FM-Zeilen: `fmRows`-Originalreihenfolge beibehalten (Template-Key-Order) — bestätigen.
- Exakte Stat-Chip-Texte (Singular/Plural) — im Plan ausformulieren.
