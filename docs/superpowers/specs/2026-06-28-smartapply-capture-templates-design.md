# Spec — Batch der Kern-Capture-Vorlagen (Smart-Apply)

**Datum:** 2026-06-28
**Status:** Entwurf → Review
**Vorhaben:** ③ aus dem 0.5.0/0.6.0-Handoff — eigener `brainstorming→spec→plan→subagent-driven`-Zyklus.
**Kontext:** Der Smart-Apply-Pilot `Gespräch.md` hat sich bewährt; aus seinem echten Gebrauch sind drei
Lehren entstanden. Dieser Batch wendet sie auf die nächsten Capture-Typen an. Die Smart-Apply-Engine
(`note_restructurer.ts`, `template_matcher.ts`, `frontmatter.ts`, `smart_apply_view.ts`) bleibt
**unverändert** — geliefert werden Vault-Inhalte (Vorlagen + Testmaterial) plus ein Test-Guard.

---

## 1. Ziel & Scope

Fünf neue Smart-Apply-Capture-Vorlagen, die erfassten Freitext in die kanonische Struktur des jeweiligen
Notiztyps **routen** (keine Generierung):

| Typ | `type` (emoji-exakt) | Dateiname |
|---|---|---|
| Notiz | `📝 Notiz` | `Notiz.md` |
| Konzept | `💡 Konzept` | `Konzept.md` |
| Quelle | `🔎 Quelle` | `Quelle.md` |
| Dokument | `📄 Dokument` | `Dokument.md` |
| Kommunikation | `📬 Kommunikation` | `Kommunikation.md` |

**Ablageort:** der konfigurierte Smart-Apply-Vorlagenordner, in dem der Pilot liegt —
`/Users/Shared/10_ObsidianVaults/10_Pallas/50_Ressourcen/20_System/03-Vorlagen/70_SmartApply/`.
`resolveTemplateForType` matcht den Dateinamen emoji/whitespace/case-normalisiert gegen den `type:`-Wert
(`📝 Notiz` → `notiz` ← `Notiz.md`) — **keine Emoji im Dateinamen nötig**.

**Modell:** gemma (kleines Modell — Hinweise daher direktiv und selbsterklärend).

**Bewusst NICHT im Scope** (frontmatter-lastig, schwacher Routing-Fit / YAGNI): Person (`👤 Kontakt`),
Organisation (`🏢 Organisation`), Steckbrief (`🤖 LLM Steckbrief` / `👤 Autoren-Steckbrief`),
Projekt (`🗂️ Projekt`). Separat zu entscheiden.

---

## 2. Wie Smart-Apply funktioniert (Designgrenzen, die das Vorlagen-Format bestimmen)

Aus dem gelesenen Code (`buildRestructurePrompt`, `mergeFrontmatter`, `assembleBody`, `parseTemplate`):

1. **Keine Fabrikation.** Das LLM ordnet nur nummerierte Original-Blöcke den Überschriften zu bzw.
   extrahiert **wörtliche** Frontmatter-Werte (`source:"content"` muss wörtlich aus den Blöcken stammen,
   sonst `source:"empty"`). Es darf **nicht zusammenfassen/umschreiben** → Felder, die Synthese verlangen
   (`summary`, `title`), werden **weggelassen**.
2. **Frontmatter-Merge-Präzedenz** (`mergeFrontmatter`): bestehender nicht-leerer Wert der Notiz →
   LLM-`content`-Wert → Vorlagen-Default → leer. Konsequenz:
   - Bestehende Notiz-Keys (`title`, `created`, `tags`, `up`, …) **überleben automatisch** (preserve-unknown)
     → in der Vorlage **nur die Keys führen, die Smart-Apply treiben soll**.
   - **Jeder** in der Vorlage gelistete Key erscheint im Output (ggf. leer). Also nur gewünschte Keys listen.
3. **Verbatim vs. Enum.** Zwei Key-Klassen:
   - **Verbatim-extrahierbar** (datum, partei/autor, source-URL, aktenzeichen, jahr): stehen wörtlich im
     Text → zuverlässig. (Leichte Normalisierung wie Datum→`YYYY-MM-DD` oder `[[Name]]`-Wrapping wird per
     Hinweis direktiv angewiesen; bekannte Grauzone zur „wörtlich"-Regel, in der Praxis von gemma befolgt.)
   - **Enum-Klassifikation** (status, bereich, medium, kanal, richtung, dokumenttyp, lesestatus): selten
     wörtlich im Text. Strategie: **direktiver Enum-Hinweis + sinnvoller Default**. Klassifiziert das
     Modell → gut; sonst → Default (oder leer bei `bereich`). Kein Datenverlust.
4. **Auffang.** `assembleBody` hängt für `unassigned`-Blöcke automatisch `## Übrig` an. Die Lehre
   „Notizen = Auffang" bedeutet: eine **benannte** Sink-Sektion als letzte Sektion, deren `%%`-Anleitung
   explizit „alles Übrige hierher" sagt — damit Reste in die saubere Sektion statt ins generische `## Übrig`
   wandern. `## Übrig` bleibt Sicherheitsnetz.
5. **Kein statischer Body-Inhalt.** `parseTemplate` erfasst nur Inhalt **ab der ersten `##`-Überschrift**;
   Text davor wird ignoriert. `assembleBody` emittiert ausschließlich `heading + geroutete Blöcke`. Daher
   **keine** Base/Dataview-Steckbrief-Callouts der Normalvorlagen — Smart-Apply kann sie nicht befüllen.
   Vorlagen = Überschriften + `%%`-Anleitung, sonst nichts (wie der Pilot).

### 2.1 Harte Parser-Constraints (verifiziert gegen Code + Tests)

- **Frontmatter-`#`-Hinweise sind EINZEILIG.** `parseFrontmatter` arbeitet zeilenweise; eine
  Fortsetzungszeile (`   # …` ohne `key:`) matcht die KV-Regex nicht und wird **still verworfen**. Bestätigt
  durch `tests/frontmatter.test.ts` (alle Comment-Cases einzeilig) und die Normalvorlage `Dokument (FM)`,
  deren mehrzeiliger `dokumenttyp`-Kommentar in Smart-Apply die zweite Zeile verlöre. → **Jeder
  FM-Hinweis muss eine physische Zeile sein** (darf beliebig lang sein).
- **Sektions-`%%`-Anleitungen dürfen umbrechen.** `extractAnnotations` nutzt `/%%([\s\S]*?)%%/g`
  (multiline). Mehrzeilige `%%`-Blöcke sind erlaubt.
- **Enum-Werte emoji-exakt + wörtlich-zu-übernehmen** auflisten (kanonisch aus den `20_Typ`-Vorlagen).
  Der Pilot listete `Arbeit | Finanzen | …` ohne Emoji und hätte `bereich: Arbeit` statt `💼 Arbeit`
  erzeugt — dieser Defekt wird hier vermieden.

---

## 3. Authoring-Pattern (einheitlich für alle 5)

**Hinweis-Stil:** volle imperative Sätze (Johannes' Wahl) — robuster für gemma. FM-Hinweis einzeilig.

**Frontmatter-Keys** = `type` (fixer emoji-Default) + Enum-Felder (Hinweis + Default) + Verbatim-Felder
(Extraktions-Hinweis). Weggelassen: `summary`/`title` (Synthese), `related`/`quellen`/`up`/`tags`/`aliases`
(Navigation/Wikilink-Synthese), Maschinerie (`created`/`updated`/`id`).

**Body** = 2–4 entkernte `##`-Sektionen:
- **Lead-Sektion** beansprucht in ihrer `%%`-Anleitung **explizit den Einleitungs-/Kontextsatz** (block_0).
- **Letzte Sektion** = **benannter Auffang** (`%%`: „alles Übrige hierher").

**Kanonische Enum-Vokabulare** (emoji-exakt, aus den `20_Typ`-Normalvorlagen):
- `bereich` (7): `💼 Arbeit` · `💰 Finanzen` · `💚 Gesundheit` · `🎯 Hobbys` · `🏠 Privat` · `🧠 System` · `📖 Lernen & Entwicklung`

---

## 4. Die 5 Vorlagen (wörtlicher Soll-Inhalt)

> Hinweis: Im Folgenden ist jeder `#`-Hinweis **eine** Zeile (hier ggf. durch die Seitenbreite optisch
> umgebrochen — in der Datei NICHT umbrechen).

### 4.1 `Notiz.md`

```markdown
---
type: "📝 Notiz"
status: "🌱 Entwurf"   # Bearbeitungsstand der Notiz. Übernimm genau einen Wert wörtlich: 🌱 Entwurf · ✏️ In-Arbeit · 🌿 Evergreen · ✅ Erledigt · 📦 Archiv. Frisch erfasstes Material → 🌱 Entwurf.
bereich:   # Lebensbereich, dem die Notiz zugehört. Übernimm genau einen Wert wörtlich: 💼 Arbeit · 💰 Finanzen · 💚 Gesundheit · 🎯 Hobbys · 🏠 Privat · 🧠 System · 📖 Lernen & Entwicklung. Ist keiner erkennbar, lass das Feld leer.
---

## 💡 Kerngedanke
%% Hierher kommt der zentrale Gedanke der Notiz — die Kernaussage, worum es im Wesentlichen geht. Auch ein einleitender Satz, der nur das Thema benennt oder den Anlass nennt, gehört hierher. %%

## 📝 Notizen
%% Alle weiteren Inhalte: Beobachtungen, Details, Zitate, Stichpunkte, lose Gedanken. Dies ist der Auffang — jeder Block, der nicht eindeutig die Kernaussage ist, kommt hierher. %%
```

### 4.2 `Konzept.md`

```markdown
---
type: "💡 Konzept"
status: "🌱 Entwurf"   # Bearbeitungsstand des Konzepts. Übernimm genau einen Wert wörtlich: 🌱 Entwurf · 🌿 Evergreen · 📦 Archiv. Frisch erfasst → 🌱 Entwurf.
bereich:   # Lebensbereich, dem das Konzept zugehört. Übernimm genau einen Wert wörtlich: 💼 Arbeit · 💰 Finanzen · 💚 Gesundheit · 🎯 Hobbys · 🏠 Privat · 🧠 System · 📖 Lernen & Entwicklung. Ist keiner erkennbar, lass das Feld leer.
---

## 💡 Die Idee
%% Hierher kommt die zentrale Behauptung des Konzepts — was es im Kern aussagt. Auch ein einleitender Satz, der das Thema oder den Begriff benennt, gehört hierher. %%

## 🔍 Evidenz & Argumentation
%% Blöcke, die die Idee stützen oder begründen: Belege, Daten, Argumente, Beispiele, Herleitungen. %%

## ⚡ Implikationen
%% Blöcke, die beschreiben, was aus der Idee FOLGT — Konsequenzen, Anwendungen, Auswirkungen (erkennbar an „daraus folgt", „das führt zu", „in der Praxis bedeutet das"). Reine Belege oder Beispiele gehören in 🔍 Evidenz & Argumentation. %%

## 📝 Weitere Notizen
%% Alles Übrige: lose Gedanken, offene Fragen, Nebenbemerkungen. Dies ist der Auffang — jeder Block, der zu keiner der obigen Überschriften eindeutig passt, kommt hierher. %%
```

### 4.3 `Quelle.md`

```markdown
---
type: "🔎 Quelle"
status: "🌱 Entwurf"   # Bearbeitungsstand. Übernimm genau einen Wert wörtlich: 🌱 Entwurf · ✏️ In-Arbeit · 🌿 Evergreen · ✅ Erledigt · 📦 Archiv. Frisch erfasst → 🌱 Entwurf.
source:    # URL, DOI oder ISBN der Quelle, falls im Text genannt — wörtlich übernehmen. Sonst leer lassen.
medium:    # Art der Quelle, falls erkennbar. Übernimm genau einen Wert wörtlich: Buch · Artikel · Video · Podcast · Paper · Webseite. Sonst leer lassen.
autor:     # Autor bzw. Urheber, falls genannt (Nachname, Vorname; bei Videos der Kanalname). Sonst leer lassen.
jahr:      # Erscheinungsjahr als vierstellige Zahl, falls genannt. Sonst leer lassen.
lesestatus: "📥 Ungelesen"   # Lesefortschritt. Übernimm genau einen Wert wörtlich: 📥 Ungelesen · 📖 Lese ich · ✅ Gelesen · ⏸️ Pausiert. Standard für neu erfasste Quellen: 📥 Ungelesen.
bereich:   # Lebensbereich, dem die Quelle zugehört. Übernimm genau einen Wert wörtlich: 💼 Arbeit · 💰 Finanzen · 💚 Gesundheit · 🎯 Hobbys · 🏠 Privat · 🧠 System · 📖 Lernen & Entwicklung. Ist keiner erkennbar, lass das Feld leer.
---

## 📌 Worum es geht
%% Hierher kommt der einleitende Block, der benennt, um welche Quelle es geht und worum sie handelt — Titel, Thema, Anlass. Der erste Kontextsatz gehört hierher. %%

## 💡 Kernideen
%% Die wichtigsten Aussagen und Gedanken aus der Quelle — die zentralen Punkte, je als eigener Block. %%

## 🔑 Schlüsselzitate
%% Nur wörtliche Zitate aus der Quelle — erkennbar an Anführungszeichen oder klarer Zuschreibung. Paraphrasierte Kernaussagen gehören in 💡 Kernideen, nicht hierher. %%

## 📝 Laufende Notizen
%% Eigene Gedanken, Reaktionen, Ableitungen und alles Übrige. Dies ist der Auffang — jeder Block, der zu keiner der obigen Überschriften eindeutig passt, kommt hierher. %%
```

### 4.4 `Dokument.md`

```markdown
---
type: "📄 Dokument"
status: "✏️ In-Arbeit"   # Bearbeitungsstand. Übernimm genau einen Wert wörtlich: ✏️ In-Arbeit · 🌿 Evergreen · 📦 Archiv. Standard für neu erfasste Dokumente: ✏️ In-Arbeit.
dokumenttyp:   # Art des Dokuments, falls erkennbar. Übernimm genau einen Wert wörtlich: Vertrag · Bescheid · Vollmacht · Rechnung · Gutachten · Schreiben · Formular · Protokoll · Urteil · Befund · Medikament · Scan · Sonstiges. Sonst leer lassen.
datum:     # Originaldatum des Dokuments (Ausstellungs- oder Unterschriftsdatum) als YYYY-MM-DD, falls genannt. Sonst leer lassen.
richtung:  # Laufrichtung, falls erkennbar. Übernimm genau einen Wert wörtlich: eingehend · ausgehend · intern. Sonst leer lassen.
partei:    # Die andere Partei (Absender oder Empfänger) als [[Name]], falls genannt. Sonst leer lassen.
aktenzeichen:   # Aktenzeichen, Vertrags- oder Referenznummer, falls genannt — wörtlich übernehmen. Sonst leer lassen.
frist:     # Reaktions- oder Handlungsfrist als YYYY-MM-DD, falls im Text genannt. Sonst leer lassen.
bereich:   # Lebensbereich, dem das Dokument zugehört. Übernimm genau einen Wert wörtlich: 💼 Arbeit · 💰 Finanzen · 💚 Gesundheit · 🎯 Hobbys · 🏠 Privat · 🧠 System · 📖 Lernen & Entwicklung. Ist keiner erkennbar, lass das Feld leer.
---

## 📄 Inhalt
%% Hierher kommt, was das Dokument regelt, feststellt oder beantragt — der inhaltliche Kern, einschließlich wichtiger Klauseln und Passagen. Auch ein einleitender Satz, der benennt, um welches Dokument es geht, gehört hierher. %%

## ⚠️ Fristen & Handlungsbedarf
%% Blöcke mit einer konkreten, bereits jetzt fälligen Frist oder Aufgabe — was bis wann getan werden muss. Bloß erwähnte, künftige oder ausdrücklich noch nicht fällige Schritte gehören NICHT hierher, sondern in den Auffang. %%

## 📝 Weiteres
%% Nebenaspekte, lose Verweise, Randnotizen und alles Übrige. Dies ist der Auffang — jeder Block, der nicht der inhaltliche Kern (📄 Inhalt) und keine konkrete Frist oder Aufgabe ist, kommt hierher. %%
```

### 4.5 `Kommunikation.md`

```markdown
---
type: "📬 Kommunikation"
status: "3-abgeschlossen ✅"   # Bearbeitungsstand des Vorgangs. Übernimm genau einen Wert wörtlich: 2-in-arbeit ✏️ · 3-abgeschlossen ✅ · 5-archiv 📦. Standard für einen erfassten, geschehenen Vorgang: 3-abgeschlossen ✅.
datum:     # Datum des Vorgangs als YYYY-MM-DD, falls genannt. Sonst leer lassen.
kanal:     # Kommunikationskanal, falls erkennbar. Übernimm genau einen Wert wörtlich: E-Mail · Post · Telefon. Sonst leer lassen.
richtung:  # Laufrichtung, falls erkennbar. Übernimm genau einen Wert wörtlich: eingehend · ausgehend. Sonst leer lassen.
partei:    # Die Gegenpartei (Absender oder Empfänger) als [[Name]], falls genannt. Sonst leer lassen.
---

## 📨 Inhalt
%% Hierher kommt der eigentliche Inhalt der Kommunikation — was gesagt, gefragt oder mitgeteilt wurde. Auch ein einleitender Satz, der benennt, mit wem und worüber kommuniziert wurde, gehört hierher. %%

## ✅ Handlungsbedarf
%% Blöcke, die beschreiben, was als Reaktion zu tun ist — geforderte Antworten, To-dos, Fristen. %%

## 📝 Weiteres
%% Verweise, Nebenbemerkungen und alles Übrige. Dies ist der Auffang — jeder Block, der zu keiner der obigen Überschriften eindeutig passt, kommt hierher. %%
```

---

## 5. Validierung („so dass ich alles testen kann") — drei Ebenen

### Ebene 1 — Parse-Guard (automatisiert, vault-gated)

Neue Vitest-Datei `tests/smartapply_templates.vault.test.ts`, die die **echten** Vault-Vorlagen über das
echte `parseTemplate`/`buildRestructurePrompt` prüft. **Gated** auf Existenz des Vault-Ordners
(`describe.skipIf(!existsSync(dir))`) → in der GitHub-Release-CI (kein Vault) sauber übersprungen, lokal
bei Johannes grün. SSOT bleibt der Vault (keine Datei-Duplikate). Pro Vorlage:

1. `parseTemplate(text).type` === erwarteter emoji-exakter `type`-String.
2. **Jeder** geführte Frontmatter-Key (außer `type`) hat ein **nicht-leeres** `fmGuidance[key]`
   → fängt den Einzeilen-Constraint (verschluckte Fortsetzungszeile) ab.
3. **Jede** Sektion hat eine nicht-leere `guidance` (`%%`).
4. ≥ 2 Sektionen; die **letzte** Sektion-`guidance` enthält die Auffang-Markierung
   (Regex `/Auffang|Übrige/i`).
5. Die **erste** Sektion-`guidance` enthält die Intro-Markierung
   (Regex `/einleitend|Kontextsatz|erste[rn]? Kontext|worum/i`).
6. `buildRestructurePrompt(tpl, [zwei Beispiel-Blöcke])` rendert für jeden geführten Key **mit Hinweis**
   (also alle außer `type`) eine `Hinweis:`-Zeile, enthält kein `undefined`, und jede Sektion erscheint
   mit `Anleitung:`. `type` erscheint mit `Beispiel:` (emoji-exakter Default).
7. Enum-Default-Werte (`status`, `lesestatus`) sind in der erlaubten Enum-Menge des Typs.

### Ebene 2 — Prompt-Render-Sichtprüfung (manuell, optional)

Ein kleines npm-Script (`npm run check:templates` → `scripts/check-smartapply-templates.mjs` via vitest
oder `tsx`) gibt für jede Vorlage den von `buildRestructurePrompt` erzeugten System+User-Prompt aus, damit
Johannes vor dem GUI-Smoke sieht, wie die Hinweise beim Modell ankommen. (Falls Mechanik-Overhead zu groß:
entfällt — Ebene 1 + 3 genügen. Im Plan entscheiden.)

### Ebene 3 — GUI-Smoke (manuell, der eigentliche Akzeptanztest)

Pro Vorlage eine **fertige Rohnotiz** in `/Users/Shared/10_ObsidianVaults/10_Pallas/_SmartApplyTest/`
(existiert, liegt außerhalb des `templateDir` → wird nicht als Vorlage gelistet). Je Datei ein realistischer,
unstrukturierter Capture-Text mit: einem Einleitungs-/Kontextsatz (Intro-Routing-Test), Material für jede
Sektion, extrahierbaren Frontmatter-Signalen (Datum/Name/URL/Enum-Hinweis) und ein, zwei „Rest"-Blöcken
(Auffang-Test). Johannes wählt in Obsidian je Notiz die passende Vorlage und prüft:
Routing korrekt? Intro in der Lead-Sektion? Reste im benannten Auffang (nicht `## Übrig`)? Frontmatter
emoji-exakt? → Eine knappe Smoke-Checkliste als Handover-Note (`user-handover`-Skill) begleitet das.

---

## 6. Deliverables & Build-Reihenfolge (für den Plan)

1. **5 Vorlagen** nach `…/03-Vorlagen/70_SmartApply/` schreiben (§4 wörtlich).
2. **Parse-Guard-Test** `tests/smartapply_templates.vault.test.ts` (§5.1) — **TDD**: Test zuerst schreiben.
   Der Gate prüft den Vault-**Ordner** (lokal vorhanden) → der Test läuft, ist aber **rot**, weil die 5
   Vorlagen-Dateien fehlen/unvollständig sind. Dann Vorlagen aus §4 schreiben/anpassen, bis grün. Eine
   fehlende oder invalide Vorlage ist ein **fehlschlagendes** Assert (kein Skip — geskippt wird nur, wenn
   der ganze Vault-Ordner fehlt, z. B. in CI).
3. **5 Rohnotizen** nach `_SmartApplyTest/` (§5.3).
4. **(optional) Render-Check-Script** (§5.2).
5. **Smoke-Checkliste** als Handover-Note für Johannes.
6. **Cockpit + AGENTS** nicht nötig zu ändern (Engine unverändert); ggf. kurzer §🧭-Eintrag am Session-Ende.

**Akzeptanz (DoD):**
- [ ] `npx vitest run tests/smartapply_templates.vault.test.ts` lokal grün (5 Vorlagen valide).
- [ ] `npm test` (gesamte Suite) bleibt grün; CI unberührt (Test gated).
- [ ] 5 Vorlagen erscheinen in der Smart-Apply-Vorlagenliste (Picker/Rangliste).
- [ ] Johannes-GUI-Smoke je Typ bestanden (Routing + Intro + Auffang + emoji-exaktes Frontmatter).

---

## 7. Offene Folgeentscheidungen (außerhalb dieses Scopes)

- **Pilot-Vokabel `Gespräch` ↔ `Besprechung`:** `Gespräch.md` (`🗣️ Gespräch`) hat **0 reale Notizen**;
  real existieren `🗣️ Besprechung` (6) und `📬 Kommunikation` (19). Der Pilot-`type` ist faktisch verwaist
  → separat klären, ob umbenennen (`Besprechung`) oder bewusste Soll-Migration. Berührt diesen Batch nicht.
- **Person/Organisation/Steckbrief/Projekt:** ausgelassen (§1) — bei Bedarf eigener Mini-Batch, dann mit
  Fokus auf Feld-Extraktion statt Prosa-Routing.
- **Datum/`[[ ]]`-Normalisierung** ist eine bekannte Grauzone zur „wörtlich"-Regel; im GUI-Smoke beobachten.

---

## 8. Lessons-Integration (Quelle: 0.5.0/0.6.0-Cockpit)

| Lehre | Umsetzung im Pattern |
|---|---|
| Hinweise **direktiv**, keine Optionslisten | Volle imperative Sätze; Enums als „Übernimm genau einen Wert wörtlich: …". |
| Einleitungs-/Kontextsatz explizit zuweisen | Lead-Sektion-`%%` beansprucht block_0 ausdrücklich. |
| „Notizen" = Auffang | Letzte Sektion benannter Sink; `%%` sagt „alles Übrige hierher". |
| Emoji-exakte Enum-Werte (neu) | Kanonische Werte mit Emoji aus `20_Typ`; behebt den `bereich: Arbeit`-Defekt des Piloten. |
| Einzeilige FM-Hinweise (neu, Parser-Constraint) | Jeder `#`-Hinweis eine Zeile; Parse-Guard erzwingt nicht-leere Hinweise. |
