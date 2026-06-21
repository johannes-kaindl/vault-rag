# Spec — IMG→MD aus vault-rag ausgliedern (`image-to-markdown`)

**Datum:** 2026-06-21
**Status:** Design (vor writing-plans)
**Kontext:** Teilprojekt A der „vault-rag → Community-Einreichung"-Roadmap. Blocker für
Teilprojekt B (vault-rag submission-readiness). Ziel der Gesamt-Roadmap: schneller,
kohärenter RAG-Kern in der Obsidian-Community-Registry + Feedback.

## Warum

IMG→MD ist **kein RAG**. Es teilt mit vault-rag nur den SSE-Streaming-Transport, nicht den
Index/Retrieval-Kern. Im selben Repo verwässert es die Botschaft „vault-basiertes RAG", die
genau das ist, worauf Johannes Feedback einsammeln will. Ein eigenständiges
`image-to-markdown`-Plugin ergibt einen schlanken, leicht erklärbaren vault-rag-Kern
(Related-Notes + semantische Suche + RAG-Chat) **und** eine zweite Registry-/Feedback-Fläche.

Die Plugin-manifest-`id` ist nach Community-Aufnahme permanent — der Schnitt muss **vor** der
Einreichung passieren. Ein IMG→MD-Split kostet ~1–2 Tage; die Obsidian-Review-Latenz ist
Wochen → der Split verzögert „rauskommen" praktisch nicht.

## Scope

**In Scope:** IMG→MD vollständig in ein neues Plugin `image-to-markdown` verlagern; vault-rag
auf den RAG-Kern zurückschneiden; beide Repos grün (Tests + tsc + Build).

**Out of Scope:** Community-Einreichung (Teilprojekt B); IMG→MDs eigene Einreichung (danach);
neue IMG→MD-Features; Codeberg/GitHub-Remote-Setup des neuen Repos (separater, User-getriggerter
Release-Schritt — initialer Push auf frisches Remote ist CC-Hard-Block).

## Dependency-Graph

### Wandert vollständig nach `image-to-markdown`

| Quelle (vault-rag `src/`) | Rolle |
|---|---|
| `vision_client.ts` (+ `tests/vision_client.test.ts`) | Vision-Calls: `transcribe` (non-stream) + `transcribeStream` |
| `img_to_md.ts` (+ `tests/img_to_md.test.ts`) | Reiner Kern: `findImageEmbeds`, `buildTranscriptNote`, `replaceEmbed`, `uniqueNotePath`, `transcriptNotePath`, `writeTranscripts`, `runImgToMd`, `ImgToMdIO`, `IMAGE_EXTS`/`SUPPORTED_EXTS` |
| `img_to_md_state.ts` (+ `tests/img_to_md_state.test.ts`) | View-State (`ImgItem` etc.) |
| `img_to_md_view.ts` (+ `tests/img_to_md_view.test.ts`) | Sidebar-View (`ImgToMdView`, `VIEW_TYPE_IMGMD`, `ImgToMdViewDeps`) |
| Settings `visionEndpoint`, `visionModel`, `visionPrompt`, `DEFAULT_VISION_PROMPT` | aus `settings.ts` heraus → neues `settings.ts` |
| `main.ts`-Verdrahtung | `visionClient`-Feld, `VisionClient`-Init, `registerView(VIEW_TYPE_IMGMD…)`, Ribbon `scan-text`, Commands `open-img-md-sidebar` + `img-to-md`, File-Kontextmenü-Eintrag, `makeImgIO`, `makeImgViewDeps`, `refreshImgViews`, `activateImgMdView`, `reconnectVision`, der `refreshImgViews`-Call im `active-leaf-change`-Handler |

### Geteilter Transport → **kopieren** (nicht shared package)

Beide Plugins brauchen denselben SSE-Transport. Wird in beide Repos **kopiert**:

| Datei | Begründung Kopie |
|---|---|
| `sse.ts` (`streamSSE`, `parseSSE`) (+ `tests/sse.test.ts`) | Von `VisionClient.transcribeStream` gebraucht |
| `think_splitter.ts` (`ThinkSplitter`) (+ `tests/think_splitter.test.ts`) | Dependency von `sse.ts` |
| `ping()` + `listModels()` | Generische „GET /v1/models"-Helfer (heute in `ChatClient`, kein Chat-Bezug). Im neuen Plugin **schlank an/in `VisionClient`** statt einer vollen `ChatClient`-Kopie — der View nutzt sie nur für Modell-Picker + Verbindungsstatus. |

**Warum kopieren statt shared npm-Package:** ~5 KB stabiler Code. Ein geteiltes Paket brächte
Versionierung, Link-Setup und Build-Komplexität für zwei kleine Obsidian-Plugins — Overengineering.
Divergiert der Transport später stark, kann man immer noch extrahieren (YAGNI).

### Bleibt in vault-rag (RAG-Kern, unangetastet)

`index.ts`, `retriever.ts`, `chunker.ts`, `embedder.ts`, `embed_vector.ts`, `pending_queue.ts`,
`live_indexer.ts`, `view.ts`/`search_view.ts`, `context_panel.ts`/`context_source.ts`,
`note_picker.ts`, `chat_client.ts`, `chat_session.ts`, `chat_view.ts`, `settings.ts` (ohne vision*),
`main.ts` (ohne IMG→MD-Verdrahtung). `sse.ts` + `think_splitter.ts` **bleiben** (von `ChatClient`
gebraucht) — sie werden ins neue Plugin *kopiert*, nicht verschoben.

## Zielstruktur `image-to-markdown`

Scaffold analog vault-rag (gleiches Profil `ts-node` · `obsidian-plugin`):

```
image-to-markdown/
  manifest.json        id: image-to-markdown · name: "Image to Markdown" · minAppVersion (von vault-rag übernehmen)
  package.json         name image-to-markdown, scripts dev/build/test wie vault-rag
  esbuild.config.mjs   entryPoints src/main.ts, externals obsidian/electron, output main.js
  tsconfig.json        wie vault-rag (strict, noImplicitAny)
  vitest.config.ts     obsidian-Mock-Alias auf tests/__mocks__/obsidian.ts
  src/
    main.ts            Plugin-Entry: View/Ribbon/Commands/Kontextmenü/SettingTab, VisionClient
    vision_client.ts   + ping/listModels
    img_to_md.ts
    img_to_md_state.ts
    img_to_md_view.ts
    settings.ts        VisionSettings + DEFAULT + SettingTab (Endpoint/Modell/Prompt)
    sse.ts             (kopiert)
    think_splitter.ts  (kopiert)
  tests/
    __mocks__/obsidian.ts   (kopiert)
    *.test.ts               (mitgewandert + sse/think_splitter-Tests kopiert)
  README.md  LICENSE (AGPL-3.0)  CHANGELOG.md  .gitignore
```

## Reihenfolge (grobe Schritte — Details im Plan)

1. `image-to-markdown` scaffolden (Build/Test-Toolchain grün auf leerem Scaffold).
2. Transport + Mock kopieren; ihre Tests grün im neuen Repo.
3. IMG→MD-Module + Tests übertragen; Imports umhängen; `ping`/`listModels` an `VisionClient`.
4. `main.ts` + `settings.ts` des neuen Plugins aus der vault-rag-Verdrahtung aufbauen.
5. **Neues Plugin grün:** `npm test` + `npx tsc --noEmit` + `npm run build`.
6. vault-rag bereinigen: IMG→MD-Module + Tests + Settings + main.ts-Verdrahtung entfernen.
7. **vault-rag grün:** Tests (RAG-Teilmenge) + tsc + Build; CHANGELOG-Eintrag (Breaking: IMG→MD
   ausgegliedert, Verweis auf neues Plugin); AGENTS.md/Modul-Layout nachziehen.

## Definition of Done

- [ ] `image-to-markdown`: `npm test` grün, `npx tsc --noEmit` sauber, `npm run build` erzeugt `main.js`.
- [ ] vault-rag: `npm test` grün (nur noch RAG-Tests), `npx tsc --noEmit` sauber, `npm run build` ok.
- [ ] vault-rag enthält **keine** Referenz mehr auf vision/img_to_md (grep sauber).
- [ ] Funktionale Parität IMG→MD: Command, Ribbon, Kontextmenü, Sidebar-Streaming, Notiz-Anlage
      verhalten sich wie vorher (Tests decken den Kern; Smoke-Test durch Johannes nach Bau).
- [ ] vault-rag CHANGELOG + AGENTS.md (Modul-Layout/Slices) aktualisiert.

## Risiken / Gotchas

- **vitest ≠ tsc:** Beide Repos explizit mit `npx tsc --noEmit` prüfen (in der Mega-Session
  rutschte ein Response-Nullability-Regress an vitest vorbei).
- **`reconnectVision?.()`** wird in `settings.ts` optional-chained aufgerufen — im neuen Plugin
  ist es eine reguläre Methode; Aufrufstellen anpassen.
- **Obsidian-Submission-Hygiene** (für später relevant, schon jetzt sauber halten):
  `detachLeavesOfType` im `onunload`, keine hartkodierten Styles, kein `innerHTML`.
- **`makeImgViewDeps`** baut heute `new ChatClient(visionEndpoint, "")` für ping/listModels —
  im neuen Plugin durch `VisionClient`-Methoden ersetzen (keine ChatClient-Abhängigkeit).
- Initialer Push des neuen Repos auf ein frisches Remote ist CC-Hard-Block → User-getriggert,
  nicht Teil dieses Teilprojekts.
