# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, `../../_docs` relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

**Projekt:** `vault-rag` (Repo-Slug) · Plugin-id **`vault-retrieval`**, Name **„Vault Retrieval"** —
Obsidian-Plugin für **lokale, offline Related-Notes** aus einem gesyncten Embedding-Index. Autor: Johannes Kaindl.
(Repo-Name bleibt `vault-rag`; die manifest-`id` wurde zu `vault-retrieval` umbenannt, weil `vault-rag` in der
Obsidian-Community-Directory bereits von einem fremden Plugin belegt ist.)

**Warum es existiert:** Drei AI-Plugins (`similar-notes`, `local-gpt`, `smart-composer`)
berechnen je **eigene** Embeddings über dasselbe Modell (`qwen3-embedding:8b`) → redundant
und ressourcenfressend. `vault-rag` ersetzt sie durch **ein** Plugin auf **einem** geteilten
[HyperForge](../hyperforge)-Retrieval-Backend.

**Bewusste Designentscheidungen:**
- **Retrieval ≠ Generierung.** Retrieval läuft über HyperForge; Chat/Composer (spätere Slices)
  über lokale LLMs. Das Panel selbst braucht **keinen** Daemon, kein VPN, kein On-Device-LLM.
- **Slices statt Monolith:** **A Related-Notes** (✅ gebaut + live) · **B Chat** · **C Inline-Composer**.
- **IMG→MD ausgegliedert (2026-06-21):** Bild-Transkription ist kein RAG → eigenständiges
  Plugin [`image-to-markdown`](https://git.jkaindl.de/jkaindl/vault-rag) (Schwester-Repo `../image-to-markdown`).
  vault-rag bleibt der schlanke RAG-Kern. Der SSE-Transport (`sse.ts`/`think_splitter.ts`) ist in beide
  Plugins kopiert, nicht geteilt.
- **Offline-first & cross-device:** HyperForge exportiert beim Reindex einen note-level
  Matryoshka-256-int8-Mini-Index (~1,4 MB) nach `<vault>/_vaultrag/`. Das Plugin liest ihn und
  rechnet **Brute-Force-Cosinus lokal** — auf allen Geräten, auch auf dem iPhone.
- **Live-Embedding (Slice A+):** Bei `file:modify` wird die Notiz via konfigurierbarem
  Ollama/MLX-Endpoint neu vektorisiert; Offline-Edits landen in einer Dirty-List und werden
  bei Reconnect nachgezogen. Der statische `_vaultrag/`-Index bleibt das Sync-Artefakt.

## Architecture principles

**Obsidian-Grenze über `VaultAdapter`:** `src/index.ts` definiert das `VaultAdapter`-Interface
(`read/readBinary/write/writeBinary/mkdir`). Alle Index-/Embedding-Module sprechen **nur** dieses
Interface an, nie direkt die Obsidian-API → in Node testbar ohne DOM-Mock (PROF-OBS-03/04).
**Dieses Interface nicht ohne Not ändern** — Tests und `LiveIndexer` hängen daran.

`obsidian` wird nur an der Kante importiert: `main.ts`, `hub_view.ts`, `settings.ts`, `http.ts`
sowie die dünnen Modal-/Picker-Wrapper (`note_picker.ts`, `template_picker.ts`,
`reformat_picker.ts`, `reformat_preview_modal.ts`) und das `reformat_panel.ts`. Diese Wrapper
sind **bewusst nicht unit-getestet** — das Test-Gewicht trägt der pure Kern; neue obsidian-Views
folgen diesem Muster statt Tests mit DOM-Mocks aufzubauen. Historisch —
`hub_view.ts` + `main.ts` sind die einzigen View-Layer-obsidian-Importe (Hub-Konsolidierung,
siehe „Abweichungen"). Die vier Hub-Panels (`view.ts`/`search_view.ts`/`chat_view.ts`/
`smart_apply_view.ts`) sind obsidian-frei bis auf `setIcon` (`chat_view.ts`, `smart_apply_view.ts`)
bzw. zusätzlich `Notice` (nur `smart_apply_view.ts`, Fehler-Feedback). `http.ts` kapselt Obsidians
`requestUrl` (CORS-frei, mobil-tauglich) als einzigen Netz-Helfer — die
Client-Module (`chat_client`, `embedder`, `capabilities`) sprechen nur `http.ts` an und bleiben damit
obsidian-frei + in Node testbar. **Streaming:** `ChatClient.stream` → `streamSSE` (`sse.ts`) nutzt
`XMLHttpRequest` (via `onprogress`), weil `requestUrl` nicht streamen kann und `fetch` von der
obsidianmd-Lint-Regel gesperrt ist — XHR ist der erlaubte Streaming-Primitive. `main.ts` orchestriert:
`file-Events → Debounce → embed → buildIndex → persist → refresh`.

### Modul-Layout (`src/`)

```
index.ts          VaultAdapter-Interface · IndexManifest · VaultIndex · parseIndex ·
                  IndexLoader — Legacy-Leser für das Prä-0.18-Tripel (notes.i8/paths.json/
                  manifest.json), int8→float32 + Renormalisierung (Quant-Drift). `parseIndex`
                  validiert neben `count == paths` auch `notes.i8.byteLength == count × dim`
                  (Byte-Guard) — wirft laut statt stillem Clobber/NaN. Wird von `index_store.ts`
                  für die byte-level Migration alter Indizes genutzt.
index_container.ts  Container-Codec (seit 0.18.0): kodiert/dekodiert `_vaultrag/index.bin` —
                  `"VRIX"`-Magic · u32 headerLen LE · Header-JSON (Manifest inkl. `paths`,
                  `schema_version: 2`) · Int8-Matrix · CRC32 über den Payload. Pure encode/decode,
                  kein Datei-I/O.
index_store.ts    Container-first-Load: liest `index.bin`, fällt bei Fehlen/Korruption auf das
                  Legacy-Tripel zurück und migriert es beim ersten Load byte-level in den
                  Container (verlustfrei, kein Reindex). `verifyBackupCandidate` prüft ein
                  geräte-lokales Backup per CRC, bevor die Auto-Heal-Kaskade (main.ts) es
                  übernimmt.
index_delta.ts    Pure Delta-/Heal-Anzeige-Logik (keine Obsidian-Abhängigkeit): indexDeltaReadout
                  („N / M Notizen", de-DE, ggf. „(vollständig)" + „· K leere Notizen ignoriert") ·
                  computeIndexDelta (leere Notizen zählen weder als fehlend noch ins Soll) ·
                  classifyChunkless (chunk-lose Pfade erkennen; unlesbar ≠ leer) · splitHealTargets
                  (bekannte Leere fliegen aus dem Heal-Lauf) · healResultMessage (ehrliche Notice:
                  „X ergänzt · Y leere übersprungen · Z fehlgeschlagen").
index_guard.ts    Pure-core Datenverlust-Entscheidungen: classifyLoadResult (no-index/loaded-ok/
                  load-failed-index-present) · assertSafeToPersist (Live-Persist darf Count nur
                  ±1 senken) · isSuspiciousShrink (Cross-Device-Clobber-Heuristik) ·
                  diffIndexVsVault (missing/stale) · PersistBlockedError.
index_backup.ts   Pure-core Namens-/Rotationslogik für geräte-lokale Index-Backups:
                  BACKUP_SUBDIR ("index-backups") · backupDirName (ISO-Zeitstempel → FS-sicher) ·
                  selectBackupsToDelete (Rotation, N=3) · sortBackupsNewestFirst (Restore-Auswahl).
                  Die eigentliche Datei-I/O liegt in main.ts (migrateIndex).
retriever.ts      Retriever(index).related(path, {k,minSim,exclude}) → Hit[];
                  Brute-Force-Cosinus auf normalisierten Vektoren, Top-k über minSim.
retrieval_facade.ts  Gemeinsame obsidian-freie Fassade über Retriever/Embedder für UI + MCP:
                  RetrievalFacade(deps).embedQuery/searchVector/search/related/readNote →
                  getypte Result-Unions (hits/no-index/offline/not-indexed/…), nie throw.
                  resolveNotePath (Path-Guard) lebt hier. Kein this.retriever-Feld mehr.
chunker.ts        Frontmatter-Strip + Heading-Split (Port von HyperForge chunker.py).
endpoint_config.ts EndpointConfig { url, apiKey?, model? } · authHeaders (EINZIGE Stelle, an der
                  ein Bearer aus einem Endpunkt-/Anbieter-Schlüssel gebaut wird — der MCP-Server
                  baut seinen Loopback-Token-Bearer separat) · effectiveModel (Endpunkt-Override
                  vor globalem Modell) · chatRequestModel (Vorrang für EINE Chat-Anfrage:
                  Zeilen-Override → feature-eigenes Modell (`smartApplyModel`) → globales
                  Chat-Modell; `ChatClient.stream` liest nur `opts.model`, nie das
                  Konstruktor-Modell) · migrateEndpointList (alte String-Liste → Configs) ·
                  applyEndpointEdit (Zeilen-Bearbeitung bei blur, Feld-Diskriminator
                  "url"|"apiKey"|"model") · carriesApiKey (verlässlicher Drittanbieter-Indikator
                  für die Settings-UI — der Schlüssel, NICHT die URL: ein eigener Server im LAN/VPN
                  braucht auch keinen) · moveEndpointToFront (die Liste IST die Priorität —
                  Umsortieren an Index 0 ist die einzige Wahrheit, welcher Endpunkt bevorzugt wird;
                  Index 0/außerhalb liefert eine unveränderte Kopie statt Fehler) · endpointRole/
                  describeEndpointRole (EndpointRole-Ableitung "active"|"standby"|"unreachable"|
                  "skipped-model" + ihr Zeilentext — reine Ableitung aus Zutaten, die die Settings-UI
                  bereits kennt, keine eigene Wahrheit über Aktivität; Prüfreihenfolge ist
                  bedeutungstragend: aktiv schlägt alles, dann nicht-erreichbar vor Modell-Mismatch).
                  Obsidian-frei. **Einzige öffentliche Fläche** — weder
                  settings.ts noch settings_core.ts reichen diese Helfer durch; Aufrufer
                  importieren direkt hier.
capabilities.ts   Reine Vision/Thinking-Erkennung, geschichtet L1 Metadaten (Ollama /api/show,
                  LM Studio /api/v1|v0) → L2 Name-Heuristik → L3 live-bestätigt (monotones Upgrade);
                  geteilter fetchCapabilities(baseUrl, model)-Probe-Helper.
embedder.ts       EmbeddingClient → Ollama/MLX HTTP-Endpoint; ping() + Batch-Embed (32/Req) +
                  listModels() + fetchCapabilities().
http.ts           httpJson() über Obsidians requestUrl — einziger obsidian-Import der Netz-Schicht.
pending_queue.ts  PendingQueue → Dirty-List in pending.json; drain-on-reconnect.
live_indexer.ts   LiveIndexer → note-level Vektor-Map; update/remove/rename · buildIndex ·
                  persist(reason) schreibt EINE Datei (`index_container.ts` → `index.bin`, kein
                  Multi-File-Write mehr), gegen `index_guard` geguarded (ready + Live-Disk-Read des
                  tatsächlichen Counts vor jedem live-Persist statt gecachtem Zustand) ·
                  healMissing (additiver Delta-Reindex für Self-Heal) · markUnready/markFresh
                  (Gefahrenzustand-Schalter) · noteCount-Getter.
model_choice.ts   `resolveModelChoice(input) → { mode, options, value, hint }` — EINE Wahrheit für
                  alle vier Modellname-Felder der Einstellungen (Embedding-, Chat-, Smart-Apply-Modell,
                  Endpunkt-Zeilen-Override). Drei Modi: `dropdown` (Endpunkt liefert eine Liste),
                  `locked` (Endpunkt nicht erreichbar — gespeicherter Wert bleibt sichtbar, aber
                  unveränderbar), `freetext` (erreichbar, aber ohne Liste). Invariante: in `dropdown`
                  und `locked` steht `value` **immer** unter `options` — sonst fällt ein `<select>`
                  still auf die erste Option zurück und überschreibt einen gültigen, nur nicht
                  gelisteten Wert beim nächsten Speichern. Nur im `dropdown`-Modus bekommt ein
                  gespeicherter, aber nicht gelisteter Wert deshalb eine eigene Option mit Zusatz
                  „(gespeichert)"; im `locked`-Modus ist der gespeicherte Wert ohnehin die einzige
                  Option, es gibt nichts zu unterscheiden. Obsidian-frei, Zeichnen liegt beim Host
                  (`renderModelPicker` in `settings.ts`).
settings.ts       VaultRagSettings · DEFAULT_SETTINGS · VaultRagSettingTab — vollständig deklarativ
                  (Obsidian 1.13 `getSettingDefinitions()`, 7 Gruppen, durchsuchbar): einfache
                  Zeilen sind `control`-Definitionen, `get/setControlValue` liest/schreibt sie
                  (mit Coercion + Seiteneffekten wie refresh/setStatusBarVisible). Dynamische
                  Zeilen (Endpoint-Listen — pro Zeile URL + maskiertes API-Schlüssel-Feld +
                  Modell-Override als Dropdown, ein „Zuerst verwenden"-Knopf (ab Zeile 2, bewusst
                  nicht gezeichnet statt deaktiviert an Platz 1 — ein `setDisabled`-Tooltip bleibt in
                  Electron unsichtbar) verschiebt die Zeile per `moveEndpointToFront` an die Spitze,
                  eine `vault-rag-ep-state`-Zeile zeigt pro Endpunkt seine `endpointRole` (aktiv/
                  Platz N/nicht erreichbar/Modell-Mismatch) synchron angelegt + asynchron nach der
                  Probe befüllt, gesperrt während einer form-ändernden Mutation läuft,
                  plus `alert-triangle`-Hinweis-Icon bei gesetztem Schlüssel (`carriesApiKey`) —
                  Form/Icon + Tooltip, nie Farbe allein, Schlüssel selbst nie im Text; das Icon
                  schaltet sich beim apiKey-Commit **in-place** um, weil dieser Commit bewusst kein
                  `refreshUi()` auslöst (Tab-Neuaufbau bleibt URL-Commits vorbehalten) —,
                  Status-Poll alle 2 s, MCP-Sektion) sind render-Hatches. Die vier Modellname-Felder
                  zeichnet `renderModelPicker` (dünner Host über `resolveModelChoice`,
                  `model_choice.ts`) — welcher Wert wo gilt, entscheidet `model_choice.ts`, wie
                  gezeichnet wird `renderModelPicker` (`hintAs: "desc"|"tooltip"`: Endpunkt-Zeilen
                  bekommen den Hinweis als Tooltip statt als Zeilentext, weil sie bewusst keinen
                  tragen — Layout, siehe Kommentar in `buildEndpointList`). Modell-Listen werden pro
                  Endpunkt-URL in `modelLists` gecacht (`Map<string, Promise<{models, reachable}>>`
                  — Promises, nicht nur Ergebnisse, damit gleichzeitig startende render-Hatches sich
                  eine Anfrage teilen; überlebt `refreshUi()`, stirbt in `hide()`); sparsam geprobt —
                  eine nicht leere Liste beweist Erreichbarkeit bereits, `probe()` läuft nur bei
                  leerer Liste nach. Ein Generationszähler (`modelListGeneration`, hochgezählt in
                  `lockRows()` vor jeder form-ändernden Mutation) verwirft verspätete Antworten;
                  „Modelle abrufen" und ein API-Schlüssel-Commit verwerfen den Cache-Eintrag gezielt —
                  sichtbar wird die neue Liste dabei aber erst beim nächsten Zeilen-Neuaufbau, der
                  apiKey-Commit selbst löst bewusst kein `refreshUi()` aus.
                  **Zweigleisig:** ab 1.13 rendert das Framework deklarativ +
                  durchsuchbar; auf ≤1.12 (minAppVersion 1.12.7 — 1.13 ist Catalyst-Preview) läuft
                  `display() { renderImperative() }`, das dieselbe `getSettingDefinitions()`-Struktur
                  imperativ zeichnet (eine Wahrheit). 1.13-only-APIs (`update`/`setDestructive`) sind
                  hinter Runtime-Feature-Checks versteckt (`refreshUi`/`applyDestructive`) → lint 0
                  auch bei 1.12.7. On-Open-Endpunkt-Resolve hängt am ersten render-Hatch, nicht am Getter.
view.ts           RelatedPanel (HubPanel) — rendert Hits (`renderHits`, auch von search_view.ts
                  genutzt), Klick öffnet Notiz.
search_view.ts    SearchPanel (HubPanel) — Wortsuche über den Index (Debounce 400 ms, Min. 3 Zeichen).
chat_view.ts      ChatPanel (HubPanel) — Chat-UI: SSE-Streaming, Kontext-Panel, Reasoning-Anzeige,
                  Modell-/Thinking-Auswahl.
smart_apply_view.ts SmartApplyPanel (HubPanel) — Diff-Gate-Cockpit (Scan-Guard, Frontmatter-Diff,
                  Body-Reflow, Relevanz-Rangliste, Rohtext on-demand).
hub_panel.ts      HubPanel-Interface + TabId ("related"|"search"|"chat"|"smart-apply") — Vertrag
                  zwischen Hub und den vier Panels (mount/onShow/onHide/onFileOpen/destroy).
hub_view.ts       VaultRetrievalView (ItemView, VIEW_TYPE_HUB="vault-retrieval-hub") — EIN
                  Sidebar-View mit Tab-Leiste statt vier Views; hält alle Panels dauerhaft gemountet
                  (State-Persistenz), blendet nur per `display:none` um (kein render-from-scratch).
settings_core.ts  Obsidian-freie Settings-Wahrheit: VaultRagSettings (embeddingEndpoints/
                  chatEndpoints als EndpointConfig[]) · DEFAULT_SETTINGS — die Endpunkt-Helfer
                  liegen in endpoint_config.ts und werden von dort importiert, nicht hier
                  durchgereicht. Vom MCP-Server direkt importiert.
mcp/              In-Plugin HTTP-MCP-Server (Loopback, `/mcp`, StreamableHTTP): `http_server.ts` ·
                  `register_tools.ts` · `tools.ts` (dünner Adapter über RetrievalFacade) · `auth.ts`.
                  Kein Node-Adapter/kein stdio mehr.
reformat_mechanical.ts  Pure Markdown-Struktur-Transforms (Slice C.1): `transposeTable` (Tabelle
                  kippen) · `tableToList` · `wrapInCallout` · `splitSelectionAffix` (Rand-Whitespace
                  vom Kern trennen; ein reiner Spalten-Einzug gehört zum KERN, sonst klebt er nur
                  an der ersten Ergebniszeile). Interner `parseTable`-Helper. **Pipes werden beim
                  Rendern re-escaped** — sonst zerreißt eine `\|`-Zelle die Tabelle (s. Gotchas).
reformat_prompts.ts     Pure Prompt-Builder je LLM-Zielformat (`buildTransformMessages`) +
                  `REFORMAT_MAX_TOKENS`. Anti-Fabrication im System-Prompt; NICHT verwandt mit
                  `note_restructurer.ANTI_FABRICATION` (das ist SmartApplys JSON-Protokoll).
reformat_transforms.ts  `TRANSFORMS`-Registry — **einzige Wahrheit** für Picker UND Sidebar-Panel.
                  Diskriminierte Union über `kind`: mechanisch trägt `run(text) → string|null`
                  (null = Struktur passt nicht), llm trägt `buildMessages`; genau ein Eintrag
                  hat `freetext: true`.
reformat_selection_state.ts  Pure Bereitschafts-/Anzeige-Logik (Slice C.2): `ReformatReadiness`
                  (ready/reading-mode/no-selection/no-editor) · `readinessMessage` (EINE Wahrheit
                  für Notice und Panel-Kopfzeile) · `canRun` · `selectionPreview` ·
                  `isRangeStale` · `groupTransforms` (teilt die Registry in die zwei Panel-Gruppen).
reformat_progress.ts    Pure `waitingMessage(elapsedMs)` für die Vorschau, solange kein Token da
                  ist. Bewusst ohne Diagnose — der Endpoint sagt nicht, ob geladen oder gedacht wird.
reformat_picker.ts      `pickTransform` (FuzzySuggestModal über die Registry) + `promptInstruction`
                  (Freitext-Modal). obsidian-gekoppelt, nach `note_picker.ts`-Muster.
reformat_preview_modal.ts  `ReformatPreviewModal` — Ur-Text vs. gestreamtes Ergebnis, Anwenden/
                  Neu/Verwerfen. Stale-Run-Guard (`this.controller !== ctrl`) auf allen Pfaden;
                  `onClose` nullt den Controller, sonst wäre der Guard nach dem Schließen wirkungslos.
reformat_panel.ts       `ReformatPanel` (HubPanel, 5. Tab) — rendert die Gruppen aus `TRANSFORMS`,
                  zeigt Auswahl-Vorschau bzw. den Grund, deaktiviert alle Buttons wenn `canRun` false.
main.ts           Plugin-Entry: Hub-View/Ribbon("layers")/Commands/SettingTab registrieren, file-Events
                  (modify/delete/rename), 3 s-Debounce, 60 s-Drain, EmbeddingProgress + Statusleiste.
                  Zusätzlich Index-Robustheit: `loadIndex` klassifiziert per `index_guard` in
                  no-index/loaded-ok/Gefahrenzustand (Schreibschutz + laute Notice statt Clobber),
                  `maybeReload` guarded per `isSuspiciousShrink` gegen Cross-Device-Clobber (behält
                  den guten In-Memory-Index), `healVault`/`HealConfirmModal` bieten Self-Heal
                  (`diffIndexVsVault` + `LiveIndexer.healMissing`) bei erkannter Lücke an,
                  `snapshotIndex`/`listBackups`/`restoreBackup` verwalten die geräte-lokalen
                  Index-Backups (`index_backup.ts`).
                  Reformat (Slice C): `captureSelection` schreibt die Editor-Auswahl laufend mit
                  (entprellter `selectionchange`-Listener + `active-leaf-change`), weil
                  `workspace.activeEditor` null ist, sobald der Fokus im Sidebar-Panel liegt;
                  `runTransform` ist der gemeinsame Weg für Command, Kontextmenü und Panel und
                  guarded jedes `replaceRange` mit `captureIsLive` + `isRangeStale`.
                  Aktive Endpunkt-Modelle: `embeddingModelInUse` (Embedder + LiveIndexer/Manifest
                  als Paar) und `chatEndpointInUse` → Getter `chatModelInUse` /
                  `smartApplyModelInUse` (`chatRequestModel`). JEDE Chat-Anfrage muss einen der
                  beiden Getter als `opts.model` mitgeben — `settings.chatModel` direkt zu
                  senden ignoriert das Zeilen-Override des aktiven Endpunkts.
```

**Index-Format (seit 0.18.0):** EINE Container-Datei `_vaultrag/index.bin` — `"VRIX"` · u32 headerLen LE
· Header-JSON (Manifest inkl. `paths`, `schema_version: 2`) · Int8-Matrix · CRC32. Ein File statt drei,
damit Obsidian Sync keine Generationen mischen kann (Spec
`docs/superpowers/specs/2026-07-29-sync-race-container-index-design.md`). Embedding-Dimension **256**,
`INT8_SCALE = 127`, **mean**-Aggregation. `pending.json` bleibt eigenständig (Dirty-List, unkritisch).
Das Prä-0.18-Tripel (`notes.i8`/`paths.json`/`manifest.json`) wird beim ersten Load byte-level migriert.
**HyperForge-Export ist stillgelegt** — bei Reaktivierung muss er das Container-Format erzeugen.

### Vendored Kit Module (`src/vendor/kit/` + `src/vendor/kit-obsidian/`)

**Zwei Ablagen seit 2026-07-27 (workspace-weite Konvention):** `src/vendor/kit/` hält die
**obsidian-freien** Kit-Module (`endpoint.ts`, `endpoint_diagnostics.ts`, `reasoning.ts`,
`settings.ts`, `sse.ts`, `think.ts`), `src/vendor/kit-obsidian/` die **obsidian-gekoppelten**
(`confirm.ts`, `collapsible.ts` + `VENDOR.json`). Beide sind **verbatim-Snapshots — nie von Hand
editieren**, Updates nur per Neu-Kopie aus obsidian-kit.

`src/vendor/kit-obsidian/confirm.ts` (@0.16.1, `b7aaf7c`) — `confirmAction(app, opts)` als einzige
Bestätigungs-Modal-Wahrheit; ersetzt seit `210b43c` die repo-eigenen `ConfirmModal`-Klassen in
`main.ts`/`settings.ts` (UI-STANDARD §2: Cancel als Link, `modal-button-container`).
**Gotcha:** der Heal-Dialog beim Start läuft bewusst **fire-and-forget** (`.then(…)`, kein `await`) —
ein `await` in `onload` blockiert den Plugin-Start, bis der Nutzer klickt (`bee6a2a`).

`src/vendor/kit-obsidian/collapsible.ts` (aus obsidian-kit#0.13.0, eigener Datei-Header-Pin —
nicht von der `VENDOR.json` abgedeckt) — erste obsidian-gekoppelte UI-Schicht des
Kits. `collapsibleSection(containerEl, opts)` rendert eine einklappbare Settings-Sektion (klickbarer
Header + Body). Der Header ist tastatur-/screenreader-bedienbar (`role="button"`, `tabindex="0"`,
`aria-expanded`, Enter/Leertaste-Toggle, `:focus-visible`-Ring — a11y ab Kit 0.13.0). Der Auf-/Zu-Zustand wird über den optionalen `CollapsibleStorage`-Callback persistiert —
vault-rag verdrahtet ihn an `settings.uiCollapsed` (Record<string, boolean>, persistiert in data.json).
`resolveCollapsed(key, defaultCollapsed, storage)` ist pure (kein DOM), entscheidet über Startzustand:
persistierter Wert (falls key + storage vorhanden) sonst defaultCollapsed (Fallback: true). CSS
(`COLLAPSIBLE_CSS`) wird über obsidian-Kit bereitgestellt und in `styles.css` übernommen.
**Seit der Migration auf `getSettingDefinitions()` (native Gruppen ersetzen die einklappbaren
Sektionen) wird diese Datei von `settings.ts` nicht mehr importiert/genutzt** — sie bleibt im Repo
für Kit-Konsistenz (obsidian-kit-Vendoring als Einheit, nicht Datei-für-Datei ausgedünnt).

## Commands

```bash
npm install                       # Deps
npm run dev                       # esbuild watch  (= node esbuild.config.mjs)
npm run build                     # baut main.js
npm test                          # vitest run     (801 Tests, 58 Files)
npm run lint                      # eslint src     (typescript-eslint + eslint-plugin-obsidianmd)
npm run typecheck                 # tsc --noEmit
npx vitest run tests/<datei>      # eine Test-Datei
npm run version-bump              # scripts/version-bump.mjs
npm run release                   # scripts/release.mjs (Tag + Forge-Release)
```

esbuild: `entryPoints: src/main.ts`, `format: cjs`, `externals: obsidian, electron`, Output `main.js`
(gitignored). `lint`/`typecheck` sind verdrahtet; nur ein `deploy`-Script fehlt (siehe Abweichungen).

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; Obsidian-Mock unter `tests/__mocks__/obsidian.ts` (kein echter
  obsidian-Import im Test). `describe/it/expect`, kein `.only`/`.skip` im Commit. Nach jeder
  Änderung müssen **alle Tests grün** bleiben.
- **`isEmbedding` immer via `try/finally`** klammern (kein vergessenes `finally`).
- **Status-Bar-Text:** `↻ embedding…` / `● N | ⏳ M` (N=embedded, M=pending) / `● N`.
- **Commits:** Conventional Commits (`feat/fix/docs/chore/refactor/test(scope): …`), deutsche
  Beschreibung erlaubt. **Nur berührte Dateien stagen — nie `git add -A`.** Trailer bei
  substanziellem AI-Beitrag (Version zum Commit-Zeitpunkt):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Größere Features** laufen über die Superpowers-Kette
  brainstorming → writing-plans → subagent-driven-development → finishing; **TDD ist Default**.
  Specs/Pläne landen im Coding-Cockpit des Maintainers (siehe §Memory, CORE-META-14);
  `docs/superpowers/{specs,plans}/` ist eingefrorener Alt-Bestand.

## Gotchas

- **`data.json`** ist die von Obsidian persistierte Plugin-Konfig (`saveData`) — maschinen-/vault-spezifisch,
  daher git-ignored (nicht committen).
- **`_vaultrag/` ist bewusst kein Dot-Ordner:** Obsidian Sync ignoriert Dot-Ordner. Daher braucht
  Sync „Sync all other file types"; im Pallas-Vault ist `_vaultrag/` git-ignored (derived, synct via
  Obsidian Sync, nicht git).
- **Dot-Pfade auto-ausgeschlossen:** `handleModify/Delete/Rename` returnen bei `path.startsWith(".")`
  (deckt `.obsidian/`, `.trash/` ab) — daher `.trash/` **nicht** mehr in `DEFAULT_SETTINGS.exclude`.
- **`parseIndex`** validiert `count == paths` **und** `notes.i8.byteLength == count × dim`
  (Byte-Guard). Ein abgeschnittener `notes.i8` (partieller Sync-Download) wirft laut → `loadIndex`
  erkennt das als Gefahrenzustand (Schreibschutz, keine Live-Persists) statt still zu clobbern
  oder NaN-Vektoren zu produzieren. Der Guard gilt für Plugin **und** MCP-Server gleichermaßen
  (beide nutzen `IndexLoader`/`parseIndex`) — seit 0.18.0 aber nur noch für die byte-level
  Legacy-Migration in `index_store.ts`; der reguläre Load-Pfad ist der Container (`index_container.ts`),
  dessen CRC32 dieselbe Rolle übernimmt: eine CRC-Mismatch beim Load ist der Gefahrenzustand-Trigger,
  nicht mehr der Byte-Guard.
- **`persist` ist gegen Clobber/Shrink geguarded und schreibt seit 0.18.0 EINE Datei:**
  `LiveIndexer.persist(reason)` kodiert den kompletten Container (`index_container.ts` →
  `index.bin`, CRC32 inklusive) und schreibt ihn in einem Zug — kein Write-Order-Problem mehr
  (früher `notes.i8` → `paths.json` → `manifest.json`, drei Dateien, drei Gelegenheiten für Sync,
  eine Mischgeneration zu erzeugen). `reason="live"` darf den Notiz-Count nur um ±1 senken, sonst
  `PersistBlockedError("shrink")`; ist der Indexer nicht initialisiert/beschädigt (Gefahrenzustand,
  `markUnready`), blockt jeder Live-Persist mit `PersistBlockedError("not-ready")`.
  `reason="reindex"` ist explizit nutzergetriggert und immer erlaubt (Voll-Ersatz); `"live"`/`"heal"`
  blocken zusätzlich mit `PersistBlockedError("model-mismatch")`, wenn das Embedder-Modell nicht zum
  Modell des Containers **auf der Platte** passt — siehe eigener Gotcha unten. `main.ts` fängt
  `PersistBlockedError` je Event-Handler ab: `handleModify` merkt die Notiz zusätzlich in der
  `PendingQueue` vor (nicht verworfen), `handleDelete`/`handleRename` melden nur laut (Notice) ohne
  Pending-Fallback — in allen drei Fällen setzt es `indexHealthy = false`. Geräte-lokale
  Index-Backups liegen unter `<plugin-dir>/index-backups/` (synct **nicht**, rotiert auf 3 —
  `index_backup.ts`), Snapshot bei jedem erfolgreichen Load + vor riskanten Operationen.
- **Auto-Heal-Kaskade (höchstens einmal je Episode):** Liefert der Load einen CRC-defekten Container,
  sucht `main.ts` das neueste per `verifyBackupCandidate` CRC-bewiesene geräte-lokale Backup, übernimmt
  es und ergänzt fehlende Notizen per Delta-Reindex — aber nur, wenn der Embedding-Endpoint erreichbar
  ist; sonst greift wie zuvor Schreibschutz + Notice mit Handlungsanweisung. Persistiert wird der
  geheilte Index **nur bei restlos sauberem Heal-Lauf** (`failed === 0`) — ein teilweiser Heal bleibt
  im Speicher, ohne den Container auf der Disk zu überschreiben, und die Kaskade läuft pro
  Plugin-Start/Episode nur einmal an statt in einer Schleife zu hämmern.
- **Ein Embedding-Index ist an sein Modell gebunden — der Modell-Guard schützt das doppelt
  (vorbeugend + durchsetzend), weil ein fremdes Modell strukturell unauffällige, aber falsche
  Vektoren erzeugt:** Notiz-Count, Dimension und CRC bleiben in Ordnung, nur die
  Ähnlichkeitssuche wird still schlechter — und nur ein vollständiger Neuaufbau (`reason="reindex"`)
  heilt es. **Vorbeugend:** `resolveAndReconnectEmbedder` überspringt jeden Endpunkt-Kandidaten,
  dessen (Override-)Modell nicht zu `this.index.manifest.embedding_model` passt
  (`embeddingModelMatchesIndex`, `index_guard.ts`) — auch in der Rückfall-Verdrahtung, die sonst
  einen erreichbaren, aber falschen Kandidaten aktiv geschaltet hätte; nur wenn **kein** Kandidat
  passt, gewinnt trotzdem der erste (bewusster Modellwechsel), mit Notice.
  **Durchsetzend:** `LiveIndexer.persist("live"|"heal")` liest bei **jedem** Aufruf das Modell
  frisch vom Container auf der Platte (nie den In-Memory-Stand — ein zuvor geblockter Persist kann
  die Prüfung also nicht vergiften) und blockt bei Abweichung mit
  `PersistBlockedError("model-mismatch")` (`assertModelSafeToPersist`, `index_guard.ts`).
  `healVault` fragt zusätzlich **vorab** per `LiveIndexer.checkModelAgainstDisk("heal")`, bevor es
  überhaupt embedded — sonst bliebe additiv geschriebenes Fremdmodell-Material im In-Memory-Index
  hängen, obwohl der anschließende Persist geblockt worden wäre (das Residuum, das Fix-Runde 4
  schloss). Einziger Ausweg für einen bewussten Modellwechsel: **„Vault neu indizieren"**
  (Voll-Ersatz, vom Guard nie geprüft). Gilt **nur** für Embedding-Endpunkte — für Chat-Endpunkte
  hängt kein Index am Modell, ein Wechsel dort ist folgenlos.
- **Leere Notizen sind nie im Index (by design):** `embedNote` → null bei 0 Chunks (nur Frontmatter/
  leer, z.B. Ordner-Notizen). Damit sie kein Phantom-Defizit erzeugen, hält `main.ts` ein
  `emptyNotePaths`-Set — **bewusst nicht persistiert**: bei jedem `loadIndex` frisch klassifiziert
  (`classifyChunkless` über die missing-Pfade), in-Session von den Live-Handlern gepflegt, von
  Heal/Reindex aus dem `HealReport` neu aufgebaut. Delta-Anzeige/Heal-Lauf/Auto-Heal-Prompt rechnen
  alle auf der bereinigten Basis (`computeIndexDelta`/`splitHealTargets`).
- **HyperForge-Export** braucht Daemon-Stopp bei Live-Lauf (embedded-Qdrant ist single-process).
- **`main.js`** ist Build-Artefakt (gitignored) — nie von Hand editieren.
- **`adapter.rmdir(path, false)` löscht in Obsidian NIE ein Verzeichnis** — auch kein leeres.
  Der Adapter setzt es intern auf `fs.rm()` **ohne** `recursive` um; das wirft auf jedem
  Verzeichnis `ERR_FS_EISDIR` (`syscall: "rm"`). Gemessen 2026-08-03 in echtem Obsidian, in allen
  Fällen identisch — Vault-Ordner, Plugin-Ordner hinter Symlink, leerer wie befüllter Ordner.
  **Immer `rmdir(path, true)`** — `removeDirDeep` (`index_migrate.ts`) ist die eine Wahrheit dafür.
  Die falsche Form hat über Wochen 1309 leere Backup-Ordner erzeugt, weil ein stummer `catch` den
  Fehler schluckte; **ein `catch`, der einen FS-Fehler verwirft, ohne ihn zu loggen, ist hier
  verboten.** Fallstrick bei der Diagnose: eine `fs.rmdir`-Probe in Node ist **kein** Beleg — sie
  prüft nicht den Weg, den Obsidian tatsächlich geht (genau daran ist die erste Analyse gescheitert).
- **Index-Ordner-Hide ist rein kosmetisch (CSS):** `buildHideCss` (`index_dir.ts`) erzeugt eine
  `display:none`-Regel auf `.nav-folder-title[data-path=…]`, injiziert via Constructable Stylesheet
  (`adoptedStyleSheets`) — `createEl("style")`/`<style>`-Elemente sind von der Lint-Regel
  `no-forbidden-elements` gesperrt. `refreshIndexFolderHiding` (`main.ts`) feature-detektet die API
  (erst iOS/Safari 16.4+) und überspringt sie still auf älteren WebViews (Ordner bleibt sichtbar,
  kein Crash). `data-path` ist internes Obsidian-Markup — bricht es, taucht der Ordner nur wieder auf
  (kein Datenverlust).
- **Pfad-Wechsel migriert per Copy + verifiziert vor Delete:** `changeIndexDir` (`main.ts`) kopiert via
  `migrateIndex` an den neuen Ort (kein Reindex), prüft mit `indexComplete`, dass der neue Index
  vollständig ist, und löscht den alten Ordner nur dann — und nur, wenn er ausschließlich Index-Dateien
  enthält (`onlyContainsIndexFiles`). Hatte der alte einen vollständigen Index und der neue nicht →
  nichts geändert (Datenverlust-Schutz, B-vor-A).
- **MCP-Server läuft in-Plugin (HTTP)** statt als separater stdio-CLI: desktop-only via
  `Platform.isMobile`-Gate, Loopback (`127.0.0.1`) + Bearer-Token, läuft nur solange Obsidian
  offen ist (kein eigenständiger Prozess); Spec `docs/superpowers/specs/2026-07-09-mcp-server-design.md`.
- **Ein Endpunkt-API-Schlüssel muss an ALLE fünf Netzwege**, nicht nur den Chat-/Embed-POST:
  Probe (`probeEndpoint`/`.probe()`/`.ping()`), `listModels`, `embed`/Chat-POST, `streamSSE`
  (Chat-Streaming) und `fetchCapabilities`. Alle gehen über `authHeaders(apiKey)`
  (`endpoint_config.ts`) — fehlt der Schlüssel an der **Probe**, gilt der Endpunkt nie als
  erreichbar und `resolveAndReconnectEmbedder`/`resolveAndReconnectChat` überspringen ihn
  stillschweigend (kein Ping-Erfolg); das Feature wirkt dann wie tot, ohne Fehlermeldung, weil
  ein reiner Ping-Fehlschlag keine Notice auslöst (anders als der Modell-Guard oben, der explizit
  meldet).
- **`editorCallback` blendet einen Command aus der Palette aus**, sobald kein Markdown-Editor
  fokussiert ist — Lesemodus, Fokus in der Sidebar, Canvas/Graph/PDF/Settings. Für den Nutzer sieht
  das aus, als wäre der Command **verschwunden** (real passiert, Slice C.2). Wenn ein Command auch
  ohne Editor auffindbar bleiben soll: `callback` nehmen und den Grund per Notice erklären
  (`readinessMessage` in `reformat_selection_state.ts` ist dafür die eine Wahrheit). Im Lesemodus
  ist Umformatieren **grundsätzlich** unmöglich — Obsidian stellt dort keinen Editor-State bereit,
  die sichtbare Markierung ist eine DOM-Selektion.
- **Ein `Editor` gehört zur View, nicht zur Datei.** Öffnet man im selben Pane eine andere Notiz,
  bleibt **dieselbe** `Editor`-Instanz bestehen. Wer sich eine Auswahl merkt, darf sich deshalb
  nicht auf die Editor-Identität verlassen: bei zufällig passendem Text (Template-Notizen,
  Boilerplate-Header) landet die Ersetzung sonst in der **falschen Notiz**. `captureIsLive`
  (`main.ts`) prüft daher Editor-Identität **und** `getMode() === "source"` **und** `file.path`.
- **Escapte Pipes müssen beim Rendern re-escaped werden.** `\|` in einer Markdown-Tabellenzelle wird
  beim Parsen zu `|`; schreibt man es un-escaped zurück, zerfällt eine Zelle in zwei, Header- und
  Delimiter-Spaltenzahl divergieren und der Inhalt ist beim nächsten Edit dauerhaft zerrissen.
  Besonders heikel, weil mechanische Transforms **ohne Vorschau sofort** ersetzen. `renderTable`
  (`reformat_mechanical.ts`) escapet; ein Round-Trip-Test pinnt die Parse/Render-Symmetrie.

## Memory

- **SDD-Artefakte (seit 2026-07-16): Cockpit, nicht Repo** — Specs/Plans/Task-Reports leben im
  Coding-Cockpit des Maintainers (`$VAULT/25_Coding/vault-rag/_SDD/`, CORE-META-14, maintainer-lokal).
  Sie tragen Arbeitskontext (Vault-Pfade, Schwester-Repo-Interna), der in einem public Repo niemandem nützt.
  Das Repo behält die Design-Essenz in dieser Datei + `CHANGELOG.md`.
- **Alt-Bestand:** `docs/superpowers/{specs,plans}/` ist eingefroren — nichts Neues dort ablegen.
- **Nie im Repo:** absolute Pfade außerhalb des Repos (`/Users/…`, Vault-Pfade) — Platzhalter nutzen
  (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind dagegen erwünscht.
  Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).
- **Projekt-Memory:** `~/.claude/projects/-Users-Shared-code-vault-rag/memory/` (Index `MEMORY.md`,
  aktuell leer). Verwandtes Wissen liegt im HyperForge-Memory: `…-code-hyperforge/memory/project_vault_rag.md`.
- **Coding-Cockpit (SSOT für Stand/Tasks/History):**
  `$VAULT/25_Coding/vault-rag/vault-rag.md` (maintainer-lokal). Wird vom
  SessionEnd-Hook gestempelt (`letzter_commit`, `letzte_session`, `fokus`); §🧭 hält die dauerhafte
  Architektur-/Warum-/Gotcha-Wahrheit. **Beim Start lesen, am Ende fortschreiben.**
- **Session-Handoff:** `.remember/` (gitignored).

## Abweichungen von der Leitkonvention

Stand: siehe `CHANGELOG.md` / `manifest.json` (dort steht die maßgebliche Version — hier bewusst
keine, damit dieser Block nicht durch Zeitablauf falsch wird). Öffentlich released, Forgejo
kanonisch + GitHub-Mirror. Bewusste, begründete Abweichungen (comply-or-explain):

- **CORE-META-02** — Badge-Zeile **partiell**: Lizenz/Docs/Obsidian gesetzt; Release/CI-Badges fehlen.
  *Grund:* Release-Badge mit v0.2.0 nachziehbar; CI-Badges erst mit CI.
- **CORE-META-03** — kein Hero-Bild/Feature-Screenshots in `docs/images/`. **Einzige offene Goldstandard-Lücke**
  (Stand 2026-07-28, sonst `readme_lint` 0 Befunde). *Grund:* Screenshots brauchen eine laufende GUI und sind
  agentenseitig nicht erzeugbar. Beim Nachrüsten: `raw.githubusercontent.com`-URLs verwenden (PROF-OBS-14),
  sinnvollerweise nach dem i18n-Slice, damit die Bilder eine englische UI zeigen.
- **CORE-META-04** — ✅ erledigt (2026-07-28): Diátaxis-Manual unter `docs/` (`tutorial.md` · `how-to/index.md` ·
  `reference/index.md` · `explanation/index.md`), aus der README verlinkt. **Links absolut** (`…/blob/main/…`) —
  der Community-Directory-Renderer löst relative Pfade nicht auf (PROF-OBS-14).
- **CORE-META-06** — ✅ erledigt: `CHANGELOG.md`, `CONTRIBUTING.md` und `SECURITY.md` vorhanden.
- **CORE-META-07** — `LICENSE` (AGPL-3.0) vorhanden; Dual-License-Option (`LICENSING.md`/`CLA.md`)
  noch nicht. *Grund:* erst bei Bedarf/Release.
- **CORE-META-09** — ✅ erledigt (2026-07-28): `README.de.md` + Sprach-Toggle-Zeile in beiden Fassungen.
  EN bleibt kanonisch; `docs/` ist bewusst nur englisch (Umfang).
  ⚠️ **Beide Fassungen zusammen pflegen** — eine veraltete Übersetzung ist schlechter als keine.
- **CORE-META-10** — ✅ erledigt (v0.2.0): `package.json`/Manifest konsistent; Forge-Description + Topics
  auf Forgejo **und** GitHub gesetzt.
- **CORE-GIT-01** — ✅ erledigt (v0.2.0, 2026-06-21): Forgejo-`origin` gesetzt (`git.jkaindl.de/jkaindl/vault-rag`,
  kanonisch) + GitHub-Push-Mirror (`johannes-kaindl/vault-rag`, `sync_on_commit`).
- **PROF-TS-01** — ✅ erledigt: `npm run lint` (ESLint flat-config: `typescript-eslint` recommended-type-checked
  + `eslint-plugin-obsidianmd`) und `npm run typecheck` (`tsc --noEmit`) verdrahtet; ESLint ist sauber
  (die `sentence-case`-Regel ist für die deutsche UI bewusst aus).
- **PROF-TS-04** — kein `tsconfig.build.json`-Split. *Grund:* klein genug; ein `tsconfig.json` (IDE + Tests)
  + `vitest.config.ts` (obsidian-Mock-Alias) reicht aktuell.
- **PROF-OBS-01** — ✅ erfüllt: manifest-`id` = `vault-retrieval` (fachlich, ≠ Repo-Slug `vault-rag`).
  Umbenannt 2026-06-22, weil `vault-rag` in der Community-Directory bereits belegt ist (fremdes Plugin von
  vasallo94). Interne Bezeichner (`vault-rag-*`-CSS, `vault-rag-chat`-ViewTypes, `_vaultrag`-Index) bleiben
  bewusst unverändert — unsichtbar, ein Umbenennen wäre nur Risiko.
- **PROF-OBS-02** — kein `deploy`-Script. *Grund:* aktuell manueller Plugin-Deploy; env-gesteuertes
  `npm run deploy` (`cp main.js manifest.json styles.css "$OBSIDIAN_PLUGIN_DIR"/`) nachzuziehen.
- **UI-STANDARD §1 (Ein-Frontend)** — ✅ erfüllt: Sidebar-Hub-Konsolidierung (2026-07) ersetzt die
  vier Einzel-Views (`RelatedNotesView`/`SearchView`/`ChatView`/`SmartApplyView`) durch **einen**
  `VaultRetrievalView` (`VIEW_TYPE_HUB="vault-retrieval-hub"`) mit Tab-Leiste; die vier Panels
  (`view.ts`/`search_view.ts`/`chat_view.ts`/`smart_apply_view.ts`) implementieren nur noch das
  `HubPanel`-Interface (`hub_panel.ts`), sind keine `ItemView`s mehr. **Begründete Abweichung vom
  vault-crews-Pilot:** der Hub rendert **nicht** render-from-scratch pro Tab, sondern hält alle
  Panels dauerhaft gemountet (`display:none` beim Tab-Wechsel), weil Chat (SSE-Stream) und Smart
  Apply (Zustandsmaschine + Stream) zustandsreich sind und ein Neuaufbau laufende Streams/State
  verwürfe.

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `obsidian-plugins/` (das Verzeichnis `..` über diesem Repo).
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im
`obsidian-kit` bereits gelöst.

**Vor jeder UI-Arbeit** (Views, Modals, Settings-Tabs, CSS): `../UI-STANDARD.md` ist
verbindlich (Obsidian-nativ first, ein Frontend pro Plugin, nur Theme-CSS-Variablen).
