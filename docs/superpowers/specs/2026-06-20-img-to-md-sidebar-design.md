# IMG→MD-Sidebar — Design

- **Datum:** 2026-06-20
- **Status:** Spec (vor writing-plans)
- **Vorgänger:** [`2026-06-20-vision-img-to-md-design.md`](2026-06-20-vision-img-to-md-design.md) (Command + Editor-Kontextmenü, non-streaming)
- **Referenzen:** `2026-06-19-chat-rag-design.md` (ChatView/ChatClient.stream), `2026-06-19-chat-thinking-design.md` (ThinkSplitter/reasoning)

## Kontext & Ziel

Heute gibt es IMG→MD nur als **Command + Editor-Kontextmenü**: one-shot, non-streaming, legt direkt Notizen an und ersetzt die Bild-Embeds. Mehrwert fehlt für den interaktiven Fall — Modellwahl, Mitlesen der (ggf. streamenden) Transkription, Review *vor* dem Schreiben.

Diese Slice baut eine **eigene Sidebar-View** (wie `ChatView`), die genau das liefert: erkannte Bilder als ankreuzbare Liste, **live streamende** Transkription pro Bild mit optionalem Gedanken-Block, und **bewusstes** Anlegen der Notizen (einzeln oder als Batch).

### Beschlossene Eckpunkte (aus dem Brainstorming)

1. **Verhältnis zum Command (Q1=A):** Die Sidebar wird der primäre *interaktive* Weg. Command + Editor-Kontextmenü **bleiben** als 1-Klick-Shortcut. Beide auf geteiltem reinem Kern.
2. **Workflow & Schreib-Zeitpunkt (Q2=A⁺-1):** Liste **aller** erkannten Bilder mit Checkboxen (Default: alle an) + „Alle aus-/abwählen"-Toggle. „Transkribieren" verarbeitet die angehakten **sequenziell**; das aktuelle Bild **streamt live** in eine eigene Ergebnis-Karte. Geschrieben wird erst auf Knopfdruck — **pro Karte „Notiz anlegen"** *und* ein Sammelknopf **„Alle anlegen"**.
3. **Streaming-Ansatz (Q3=2):** Den SSE-Transport (Reader-Loop + Multibyte-Drain + `ThinkSplitter`) **einmal** als `streamSSE` extrahieren; `ChatClient.stream` (refactored) **und** ein neues `VisionClient.transcribeStream` nutzen ihn. Kein Aufweichen des Chat-Message-Typs, keine Re-Implementierung der Drain-Falle.
4. **View-Logik (Q4):** Eigenes **reines** Modul (`img_to_md_state.ts`) für Auswahl-Set/Toggle-all/Karten-Liste/Delta-Append; die View ist dünner Renderer. (Best-Practice-Präferenz: testbar/idiomatisch vor minimalem Diff.)

## Nicht-Ziele (YAGNI v1)

- **Kein Bild-Picker.** Die Sidebar arbeitet auf den Embeds der **aktiven Notiz**; bei Notizwechsel Re-Scan. (`pickNote` ist .md-only; ein Bild-Picker bräuchte eine eigene `FuzzySuggestModal` — später nachrüstbar.)
- **Kein Inline-Editieren** des Transkripts vor dem Schreiben (im Review bestätigt). Die Karte zeigt den Transkript-Text read-only (pre-wrap, also den rohen Markdown — ehrlich darüber, was geschrieben wird). Korrekturen macht man danach in der angelegten Notiz.
- **Kein Persona/Prompt-Editor in der Sidebar.** Der Transkriptions-Prompt kommt aus den Settings (`visionPrompt`); Änderung dort.
- **Kein Multi-Notiz-Kontext / RAG.** Reine Bild→Markdown-Transkription.

## Architektur

### Module — neu / geändert

| Modul | Art | Inhalt |
|---|---|---|
| `src/sse.ts` | **neu** | `parseSSE` (umgezogen aus `chat_client.ts`, additiv um `model?` erweitert) + `streamSSE(res, onContent, onReasoning) → Promise<{content; reasoning; model}>`. Einziger Ort für Reader-Loop + Multibyte-Drain + `ThinkSplitter`-Verdrahtung. |
| `src/chat_client.ts` | geändert | `ChatClient.stream` baut Body + fetch + `res.ok`-Check (wirft `'Chat HTTP <status>'`) und delegiert das Body-Lesen an `streamSSE`. Verhaltensgleich; `content` bleibt `string`. `parseSSE`-Import aus `./sse`. |
| `src/vision_client.ts` | geändert | Neue Methode `transcribeStream(dataUrl, prompt, onContent, onReasoning, signal?) → Promise<{content; reasoning; model}>` (stream:true, `res.ok`-Check wirft `'Vision HTTP <status>'`, delegiert an `streamSSE`). Bestehendes `transcribe` (non-stream) bleibt **verhaltensgleich** — wird nur so refactored, dass es den Body-Bau via privatem `buildVisionMessages(dataUrl, prompt)` mit `transcribeStream` teilt (DRY). |
| `src/img_to_md.ts` | geändert | Extrahiert reinen Helfer `transcriptNotePath(io: {noteExists}, sourcePath, imagePath) → string` (kapselt `dir = dirOf(source)`, `base = basenameNoExt(image)`, `uniqueNotePath`). `runImgToMd` nutzt ihn (1-Zeilen-Refactor) → Platzierungsregel ist single-source. Sonst unverändert. |
| `src/img_to_md_state.ts` | **neu, rein** | View-Buchhaltung ohne DOM: Auswahl-Set, Toggle-all, Karten-Liste (`status`, `text`, `reasoning`, `writtenPath`), `addDelta`, `markWritten`, Abfrage „welche Karten fertig & ungeschrieben". |
| `src/img_to_md_view.ts` | **neu** | `VIEW_TYPE_IMGMD = "vault-rag-img"`, `ImgToMdView extends ItemView` + `ImgToMdViewDeps` (alle Obsidian-/Vision-Zugriffe als injizierte Closures). Dünner Renderer über `img_to_md_state`. |
| `src/main.ts` | geändert | `registerView` + Ribbon (`scan-text`) + Command „IMG→MD-Sidebar öffnen" + `activateImgMdView()` (rechte Sidebar, Singleton-Reveal). Deps via Live-Getter; `refresh`-Fan-out bei `active-leaf-change`. Bestehendes Batch-Command + Kontextmenü bleiben. |
| `styles.css` | geändert | `.vault-rag-img-*`-Klassen (Liste, Chip/Checkbox-Zeile, Karte, Aktions-Buttons). Keine `ctx-`-Kollision. |
| `src/settings.ts` | optional | Optionale „Vision-Verbindung"-Statuszeile analog `chatConnSetting`. Vision-Settings (Endpoint/Modell/Prompt) existieren bereits. |

### Datenfluss & UX

```
aktive Notiz ──scan(findImageEmbeds)──▶ Bild-Liste (Checkboxen, alle an)
  [☑ foto-1.jpg] [☑ scan-2.png] [☒ x.heic „nicht unterstützt"]   [ Alle abwählen ]
            │
   [ Transkribieren ]  ◀──▶ [ Stop ]   (ein Button, Re-Entrancy-Guard)
            │  Karten leeren → scannen → angehakte sequenziell
            ▼
   pro Bild eine Ergebnis-Karte:
     ┌─ „Bild 2/4 · scan-2.png" ───────────────────────┐
     │ ▸ 💭 Gedanken (nur falls reasoning ≠ leer; live offen, auto-zu) │ ← streamSSE.onReasoning
     │ <Transkript, streamt live, pre-wrap>            │ ← streamSSE.onContent
     │ [Kopieren]   [Notiz anlegen]                    │
     └──────────────────────────────────────────────────┘
            │ Klick „Notiz anlegen"  (siehe Schreib-Mechanik)
            ▼
   Transkript-Notiz angelegt + Embed in Quellnotiz ersetzt → Re-Scan
   Bild fällt aus der Liste; Karte zeigt „✓ angelegt: <pfad>" (klickbar via openPath)

   [ Alle anlegen ]  ◀── schreibt alle fertigen, noch nicht angelegten Karten (batched)
```

- **Kopf:** Status-Zeile (Vision-`ping`, klickbar) + **Modell-Switcher** gegen den Vision-Endpoint.
- **Modell-Switcher:** Liste via `new ChatClient(settings.visionEndpoint, "").listModels()` (Muster aus `settings.ts`); aktuelles Modell voranstellen falls nicht enthalten; `setModel` → `settings.visionModel` setzen + `saveSettings()` + `reconnectVision()`.

## Streaming (Ansatz 2)

### `streamSSE` — Grenze

`streamSSE(res, onContent, onReasoning)` bekommt eine **bereits geprüfte** `Response` (Caller hat `res.ok` sichergestellt). Es:
1. liest `res.body.getReader()` (mit dem bestehenden unsicheren Cast-Guard), `TextDecoder`, `ThinkSplitter`;
2. pro Chunk: `parseSSE(buffer)` → `rest` zurückhalten; `reasoning`-Deltas via `onReasoning`; `content`-Deltas durch `ThinkSplitter.push` → `onContent`/`onReasoning`; `model` festhalten (erster Chunk mit `model`-Feld);
3. **Drain am Ende:** `buffer += dec.decode()` + finaler `parseSSE` + `splitter.flush()` (Multibyte/letzte Zeile — die Falle bleibt an dieser einen Stelle);
4. gibt `{content, reasoning, model}` zurück.

**Abbruch:** Das `AbortSignal` geht im jeweiligen Client an `fetch`. Bei Abbruch wirft `reader.read()` einen `AbortError`, der durch `streamSSE` **propagiert** (nicht gefangen) — die View fängt ihn und behandelt ihn als Nicht-Fehler.

**Fehlerstrings bleiben lokal:** `'Chat HTTP …'` in `ChatClient`, `'Vision HTTP …'` in `VisionClient` — keine Migration.

### `parseSSE.model`

`parseSSE` extrahiert zusätzlich `model` (das Top-Level-`model`-Feld eines Chunks; erstes Vorkommen gewinnt). Beim lokalen Endpoint (LM Studio) reflektiert das das **geladene** Modell — genau die autoritative Quelle für `transcribed_by` (vgl. Commit `fb76421`). `streamSSE` akkumuliert das erste nicht-leere `model` über alle `parseSSE`-Aufrufe.

### `VisionClient.transcribeStream`

```ts
transcribeStream(
  dataUrl: string, prompt: string,
  onContent: (t: string) => void, onReasoning: (t: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; reasoning: string; model: string }>
```

Body identisch zu `transcribe` (via `buildVisionMessages`), nur `stream: true`. `model`-Fallback: ist `parseSSE.model` leer, der Konstruktor-`model` (= `settings.visionModel`, via `reconnectVision` aktuell gehalten) — nie blind raten.

## Schreib-Mechanik (Korrektur ggü. erstem Entwurf)

Kein gemeinsamer Schreib-Orchestrator (`applyTranscript`): `runImgToMd` schreibt die Quellnotiz **gebündelt einmal am Ende**, die Sidebar schreibt **inkrementell** — verschiedene Muster, nicht in eine Funktion zwingen. Geteilt werden nur die reinen Helfer (`buildTranscriptNote`, `replaceEmbed`, `uniqueNotePath`) **plus** der neue `transcriptNotePath` (Platzierungsregel).

**Einzelnes „Notiz anlegen" (eine Karte):**
```
content = await readNote(sourcePath)
path    = transcriptNotePath(io, sourcePath, imagePath)
await createNote(path, buildTranscriptNote({ imageLink, sourceName, date, model, transcript }))
updated = replaceEmbed(content, embed.raw, basenameNoExt(path))
if (updated !== content) await writeNote(sourcePath, updated)
→ markWritten(card, path); Re-Scan
```

**„Alle anlegen" (mehrere Karten):** vermeidet die Read-Modify-Write-Race durch **Batching** wie `runImgToMd`:
```
content = await readNote(sourcePath)
for (card of fertigUndUngeschrieben) {              // sequenziell:
  path = transcriptNotePath(io, sourcePath, card.imagePath)   // uniqueNotePath sieht zuvor angelegte,
  await createNote(path, buildTranscriptNote({…}))            // weil createNote awaited wird
  content = replaceEmbed(content, card.embed.raw, basenameNoExt(path))
  markWritten(card, path)
}
if (content !== original) await writeNote(sourcePath, content)
→ Re-Scan
```

**Re-Scan nach Schreiben:** Der ersetzte Embed ist nicht mehr als Bild auffindbar → das Bild fällt aus der Liste; ein zweites `-2`-Duplikat ist strukturell ausgeschlossen. Die Ergebnis-Karte bleibt sichtbar mit „✓ angelegt".

## Fehlerbehandlung

- **Pro Bild fehlertolerant:** ein Fehler (`Vision HTTP …` / Netz) markiert nur *seine* Karte rot; der Batch läuft weiter.
- **Stop = `AbortError`:** kein Fehler-State; gestreamte Deltas bleiben sichtbar; „Notiz anlegen" ist für abgebrochene/leere Transkripte **deaktiviert**.
- **Leeres/getrimmt-leeres Transkript → kein Schreiben** (skip), wie Command.
- **HEIC/HEIF/bmp:** gelistet, Checkbox **disabled**, Label „nicht unterstützt" (beide Gates: `IMAGE_EXTS` Erkennung / `SUPPORTED_EXTS` transkribierbar).
- **Bild nicht auflösbar** (`resolveImage` null): Karte als „nicht gefunden" markieren, skip.
- **Kein Stale-Client:** Vision-Aufrufe über Live-Getter (`() => this.visionClient`) → `reconnectVision` greift automatisch.
- **`onClose`** cleart alle Timer (Status-/Arbeits-Indikator).

## Invarianten (nicht brechen)

1. **View ohne direktes `fetch`/`app.*`** — alles über injizierte Closures (Testbarkeit, PROF-OBS-03/04).
2. **`transcribed_by` aus `response.model`** (Streaming: erster Chunk), Fallback Settings — nie blind Settings.
3. **YAML-Escaping** in `buildTranscriptNote` (`esc()`) beibehalten — Frontmatter-Integrität.
4. **Nicht-destruktiv/idempotent:** `uniqueNotePath` (kein Überschreiben), `writeNote` nur bei echter Änderung, leer→skip.
5. **Bild-Dedupe pro Datei** (`e.link`) wie im Command.
6. **`chat_client.test.ts` bleibt grün** — Wächter des `streamSSE`-Refactors.

## Tests (TDD, zuerst rot)

| Test | Prüft |
|---|---|
| `tests/sse.test.ts` *(neu)* | `streamSSE` treibt onContent/onReasoning; **Drain** (Multibyte über Chunk-Grenze + abgeschnittene letzte Zeile, z.B. `'Ende <'`); `model` aus erstem Chunk; `AbortError` propagiert; `parseSSE.model`-Extraktion. |
| `tests/chat_client.test.ts` | bleibt grün nach Refactor (Verhaltensgleichheit) + `parseSSE`-Import aus `./sse`. |
| `tests/vision_client.test.ts` | `transcribeStream` streamt Deltas + liefert `{content, reasoning, model}`; `transcribe` unverändert grün; `buildVisionMessages`-Body korrekt. |
| `tests/img_to_md.test.ts` | `transcriptNotePath` (dir/base/Kollision); `runImgToMd` weiter grün (nutzt Helfer). |
| `tests/img_to_md_state.test.ts` *(neu)* | Auswahl-Set, Toggle-all (alle an↔aus), unsupported nicht wählbar, Karten-Append (Delta), `markWritten`, „fertig & ungeschrieben"-Abfrage. |
| `tests/img_to_md_view.test.ts` *(neu, headless wie `chat_view.test.ts`)* | Liste mit Checkboxen (Default alle an); Toggle-all kippt; unsupported disabled; „Transkribieren" streamt live in Karte (synchroner State-Push, dann await); Gedanken-Block nur bei reasoning; Kopieren → `copyText`; „Notiz anlegen" → Schreib-Closure + „✓ angelegt"; „Alle anlegen" batched; Stop bricht ab; Timer-Cleanup bei `onClose`. |
| `tests/settings.test.ts` | Vision-Felder-Tests bleiben grün; optionale Verbindungszeile. |

## Im Review entschieden (2026-06-20)

1. **Inline-Editieren** des Transkripts: **nein** (read-only) — Korrekturen in der angelegten Notiz. Nicht-Ziel v1.
2. **Transkript-Darstellung** in der Karte: **Roh-Markdown, pre-wrap** (ehrlich + einfach, identisch zum ChatView-Stil).
3. **Settings-Verbindungszeile** für Vision: **später** — die Sidebar hat oben bereits eine klickbare Vision-Status-Zeile; zweite in den Settings ist nur nice-to-have. Hält v1-Scope eng.
