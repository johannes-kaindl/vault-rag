# Smart-Apply-Vorlagen + FM-Guidance — Design (Pilot: Gespräch)

**Datum:** 2026-06-25
**Status:** Design abgenommen, bereit für Plan
**Scope:** (1) Authoring Smart-Apply-tauglicher Vorlagen aus dem Templater-Vorlagensystem; (2) kleine Parser-Erweiterung, damit `#`-Kommentare im Frontmatter als LLM-Guidance wirken. Code-Slice ist **Smoke-first validiert** (echter MLX-Call belegt den Nutzen, bevor committet wird).

## Problem

Smart Apply (v2, released 0.4.0) überführt unstrukturierte Notizen hinter einem Diff-Gate in die Struktur einer Vorlage: Body-Reflow (Original-Blöcke unter Template-Überschriften) + Frontmatter füllen. Die Body-Routing-Qualität hängt an der **`%%`-Guidance** der Vorlage — `parseTemplate` extrahiert pro Body-Sektion den `%%`-Kommentar als `guidance`, `buildRestructurePrompt` rahmt ihn als „Anleitung:"-Vorgabe.

Die Vault-Vorlagen unter `50_Ressourcen/20_System/03-Vorlagen/` sind ein **Templater-Kompositionssystem** und passen nicht auf das, was Smart Apply parsen kann:

| Kollision | Folge für Smart Apply |
|---|---|
| `(full)`-Vorlagen sind reiner Templater-Code (`<%* tp.file.include(FM)+include(body) %>`) | `parseTemplate` findet weder Frontmatter noch Überschriften → ~19 nutzlose Ranking-Einträge |
| `(FM)` und `(body)` sind getrennte Dateien | Smart Apply liest nur *eine* Datei → bekommt nie FM-Keys **und** Überschriften zusammen |
| Frontmatter enthält Templater-Ausdrücke (`<% tp.date.now() %>`) und YAML-`#`-Kommentare | `parseFrontmatter` (yaml_lite) parst beides als wörtlichen Wert → würde als Default in die Notiz geschrieben |
| Ausfüllhilfen sind kursive Platzhalter (`*Was war der Anlass?*`), kein `%%` | `buildRestructurePrompt` nutzt nur `%%`-`guidance`, nicht den Platzhalter → die Hilfe erreicht das LLM nicht |
| `templateDir` zeigt aktuell auf den Wurzelordner | Smart Apply rankt über alle 107 Dateien (Router, Chronos, LLM-Prompts mitgemischt) |

Zweites Problem (vom User eingebracht): Frontmatter hat **keine Guidance-Schiene**. `%%` wirkt nur auf Body-Sektionen; im Frontmatter steuert allein der Beispiel-/Default-Wert das LLM — und der ist via `mergeFrontmatter` zugleich der Fallback. Ein `#`-Kommentar wäre der elegante Mechanismus (native YAML-Syntax, vom Templater ignoriert, menschenlesbar), aber `parseFrontmatter` versteht ihn aktuell nicht — er wird Teil des Werts.

## Entscheidungen

1. **Eigener Smart-Apply-Ordner** (Artefakt-Strategie): flache, selbsterklärende Vorlagen — Templater-System bleibt unangetastet, `%%`/`#` stören keinen manuellen Flow. *Verworfen:* `(full)` flach umbauen (großer Eingriff) und `(body)` anreichern (keine FM-Befüllung, Filter-Aufwand).
2. **Pilot-first:** EINEN Typ (Gespräch) bauen, live gegen MLX smoken, Format härten — *dann* Kern-Typen im Batch.
3. **Ordnername:** `70_SmartApply/` (NN_-Konvention, neben `60_Workflow` / `80_LLM-Prompts`).
4. **Frontmatter schlank:** nur Content-Keys; `type`/`status` mit tragbarem Default, der Rest leer.
5. **FM-Guidance via `#`-Kommentare** (vom User eingebracht): kleine `parseFrontmatter`-Erweiterung, damit `#`-Kommentare als FM-Guidance ins LLM gehen statt als Wert-Müll. **Smoke-first:** ein echter MLX-Call belegt den Nutzen, bevor der Code committet wird.

## Architektur

### A · Vorlagen-Ordner (Daten)

Neuer Ordner **`50_Ressourcen/20_System/03-Vorlagen/70_SmartApply/`**, *eine flache `.md` pro Typ*. Dateiname = reiner Typname (`Gespräch.md`) — `resolveTemplateForType` matcht ihn emoji-/case-normalisiert gegen `type:`. Jede Vorlage ist eine **bereinigte Ableitung** aus dem `(FM)`+`(body)`-Split:

- **Frontmatter:** Templater-Ausdrücke entfernt; nur Content-Keys; `type` als Routing-Anker, `status` mit Default; übrige Felder leer. Pro Key ein `#`-Kommentar als Guidance (Optionen/Format/„falls genannt").
- **Body:** die `##`-Überschriften aus `(body)`, jede mit knapper `%%`-Anleitung. Kein Templater-Code, keine kursiven Platzhalter — reines Maschinen-Input.

`templateDir` wird auf `70_SmartApply/` umgestellt (behebt das 107-Dateien-Rauschen). Ordner nach Anlegen indexieren, damit `index.vectorFor()` Echtzeit-Ranking liefert statt Fallback-embed.

#### Pilot-Artefakt: `70_SmartApply/Gespräch.md`

```markdown
---
type: "🗣️ Gespräch"
status: "✅ Abgeschlossen"   # Geplant | Abgeschlossen | Archiv
datum:          # YYYY-MM-DD, falls im Text genannt
art:            # Meeting | Telefonat | E-Mail | Videocall | Gespräch | Konsultation
teilnehmer:     # beteiligte Personen als [[Wikilinks]], falls genannt
projekt:        # zugehöriges Projekt als [[Wikilink]], falls genannt
bereich:        # Arbeit | Finanzen | Gesundheit | Hobbys | Privat | System
follow_up_bis:  # YYYY-MM-DD Deadline für offene Punkte, falls genannt
---

## 🎯 Themen & Agenda
%% Anlass des Gesprächs und was besprochen werden sollte — Zielsetzung, Tagesordnung. %%

## 📋 Ergebnisse & Beschlüsse
%% Was entschieden, vereinbart oder festgestellt wurde — konkrete Beschlüsse und Resultate. %%

## ✅ Nächste Schritte
%% Konkrete Aufgaben mit Verantwortlichkeit und ggf. Frist — alles To-do-artige. %%

## 💬 Gesprächsnotizen
%% Stichpunkte/Details aus dem Verlauf, die weder Ergebnis noch Aufgabe sind — der Rest. %%
```

Quellen: `20_Typ/Gespräch (FM).md` (Feldnamen + Optionslisten aus den YAML-Kommentaren) und `20_Typ/Gespräch (body).md` (Überschriften). `summary` wird bewusst weggelassen (1-Satz-Synthese kann Smart Apply nicht liefern, s.u.).

### B · Parser-Erweiterung (Code, Smoke-first)

Damit `#`-Kommentare als FM-Guidance wirken, drei eng begrenzte Änderungen:

1. **`parseFrontmatter` (`frontmatter.ts`):** trennt einen `#`-Kommentar (YAML-konform: ` #` mit Whitespace davor, **außerhalb** von Quotes) vom Wert ab und sammelt ihn pro Key. `ParsedFrontmatter` bekommt ein Feld `comments: Record<string, string>`. Der Wert bleibt sauber (kein Kommentar-Müll im Default).
2. **`parseTemplate` → `TemplateSpec` (`template_matcher.ts`):** reicht die FM-Kommentare als `fmGuidance: Record<string, string>` durch.
3. **`buildRestructurePrompt` (`note_restructurer.ts`):** baut pro FM-Key `- <key> (Beispiel: <default>; Hinweis: <guidance>)`.

**Edge-Cases (Tests):** gequotete Werte mit `#` werden **nicht** gestrippt (`title: "Note #5"`); `key: # nur-Kommentar` → Wert leer + Kommentar; `#tag` ohne führenden Space ist **kein** Kommentar (bleibt Wert); `status: "✅ Abgeschlossen"   # …` → Quote-Wert + trailing Kommentar korrekt getrennt. Serialisierung (`serializeFrontmatter`) schreibt weiterhin nur `key: value` (Kommentare sind Template-only, nie in der Zielnotiz). `assertParseable` bleibt grün (Kommentare sind nicht Teil des serialisierten Outputs).

Die Änderungen berühren `mergeFrontmatter`/`diffFrontmatter` **nicht** in der Signatur — `comments` ist additiv und nur im Template-/Prompt-Pfad relevant.

## Ehrliche Grenze: FM-Befüllung bleibt auf wörtlich begrenzt

`#`-Guidance verbessert das *Routing-Signal* fürs Frontmatter, aber **Smart Apply füllt FM nur wörtlich (`source="content"`)** — Non-Fabrication. Felder, die eine Synthese bräuchten (`summary`), bleiben leer, egal wie gut die Guidance ist; realistisch befüllbar sind nur wörtlich im Text stehende Werte (Datum, `[[Person]]`, Projektname, Art). Der Pilot misst daher zwei getrennte Achsen: **Body-Routing** (`%%`, Hauptnutzen) und **FM-Extraktion wörtlicher Werte** (`#`, sekundär).

## Pilot-Ablauf (Smoke-first)

1. `70_SmartApply/Gespräch.md` anlegen (mit `#`-FM-Hints + `%%`-Body).
2. **MLX-Smoke (vor Parser-Code):** `parseTemplate` + `buildRestructurePrompt` + echter MLX-Call gegen eine reale/synthetische unstrukturierte Gesprächsnotiz, **zwei Läufe** — Prompt *ohne* FM-Hints vs. Prompt *mit* manuell injizierten FM-Hints. Vergleich: Verbessern die Hints die FM-Extraktion + bleibt das Body-Routing stabil?
   - Endpoint: MLX (vom User bestätigt erreichbar). Headless-Node-Script im scratchpad.
3. **Wenn die Hints helfen** → Parser-Erweiterung (B) bauen (TDD), Re-Smoke über den echten Code-Pfad. Wenn nicht → `#`-Guidance verwerfen, nur `%%`-Body-Pilot.
4. `templateDir` → `70_SmartApply/` umstellen; indexieren; GUI-Smoke durch User (in-place reload, Diff-Gate).
5. Format/Anleitung nachschärfen → **User-Abnahme**.
6. **Dann** Batch-Ableitung der Kern-Capture-Typen: Quelle, Person, Konzept, Notiz, Kommunikation, Dokument, Organisation, Autoren-Steckbrief, LLM-Steckbrief (+ ggf. Projekt).

## Drift-Schutz & Testing

Vorlagen sind aus den `(FM)`/`(body)`-Splits abgeleitet → bei Templater-Schema-Änderung nachzuziehen. Für den Pilot kein Automatismus; beim Vollausbau optional ein Ableitungs-/Check-Script (mit Tests). Parser-Erweiterung bekommt Unit-Tests (Edge-Cases oben); Template-Authoring wird durch den Live-Smoke validiert.

## Scope-Schnitte (bewusst NICHT im Pilot)

- **Keine Layout-/Strukturtypen** (MOC, Callout, Präsentation, Termin, Task) — kein realistischer Smart-Apply-Fall.
- **Keine Drift-Automatik** im Pilot.
- **Kein Batch** vor abgenommenem Pilot.
- **Keine FM-*Synthese*** (`summary` o.ä.) — verletzt Non-Fabrication; bleibt leer.

## Offene Punkte für den Plan

- `templateDir`-Umstellung: nur in der laufenden `data.json` (in-place, git-ignored, vault-spezifisch) oder auch als neuer DEFAULT_SETTINGS-Wert? Vermutlich nur lokal.
- Smoke-Notiz: echte Gesprächsnotiz aus dem Vault oder synthetisches Fixture? (Synthetik ist reproduzierbar + teilbar.)
- MLX-Modell + Endpoint-URL für den Smoke (aus `data.json` ableitbar).

## Smoke-Ergebnis (2026-06-25)

MLX-Smoke (`gemma-4-26b-a4b-qat`, `suppressThinking`, localhost) gegen eine synthetische Gesprächsnotiz (Telefonat Dr. Berger / Solarpark Nord), zwei Läufe (ohne/mit FM-Hints, sonst identisch):

- **Body-Routing 4/4 perfekt** in beiden Läufen — die `%%`-Anleitung trägt; das ist der Hauptnutzen, bestätigt.
- **FM-`#`-Hints helfen klar:** roher Lauf füllte nur `projekt` (`Solarpark Nord`, ohne Wikilink); mit Hints → `projekt` `[[Solarpark Nord]]` + `follow_up_bis` `2026-07-15` (von A komplett verpasst).
- **Direktive Hints schlagen Optionslisten:** `art`/`teilnehmer` (wörtlich im Text) wurden erst extrahiert, nachdem die Hints von bloßer Optionsliste auf Anweisung umgestellt wurden (`jede im Text namentlich genannte Person als [[Name]]`) → `art` `Telefonat`, `teilnehmer` `[[Dr. Berger]]`. Ergebnis: 4/4 wörtliche Felder, korrekt formatiert.
- **Non-Fabrication intakt:** `bereich` (Inferenz „Arbeit", nicht wörtlich im Text) bleibt korrekt leer.
- **Reasoning-Fallstrick bestätigt:** Ohne `suppressParams` lieferte das Thinking-Modell leeren `content` (Reasoning fraß den `max_tokens`-Cap). Der echte Plugin-Pfad (`smartApplySuppressThinking=true`) löst das — Smoke daran angeglichen.

**Gate: POSITIV → Phase B (Parser-Erweiterung) bauen.** Lehre für den Batch (Task 6): FM-Hints **direktiv** formulieren, nicht als bloße Optionsliste. Bonus: Der `parseFmRaw`-Prototyp im Smoke validierte die geplante `splitComment`-Logik (Task 2) vorab.
