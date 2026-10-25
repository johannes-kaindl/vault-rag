# Architektur

Modul-Layout, Obsidian-Grenze und gevendorte Kit-Module von `vault-rag`. Lädt nie von selbst; der Kern der `AGENTS.md` verweist hierher.

## Architecture principles

**Obsidian-Grenze über `VaultAdapter`:** `src/index.ts` definiert das `VaultAdapter`-Interface
(`read/readBinary/write/writeBinary/mkdir`). Alle Index-/Embedding-Module sprechen **nur** dieses
Interface an, nie direkt die Obsidian-API → in Node testbar ohne DOM-Mock (PROF-OBS-03/04).
**Dieses Interface nicht ohne Not ändern** — Tests und `LiveIndexer` hängen daran.

`obsidian` wird nur an der Kante importiert — **seit 2026-08-23 von `npm run check:pure` erzwungen**
(Allowlist `EDGE` in `scripts/check-pure.mjs`, Teil von `npm run gate`; wer die Kante verschiebt,
ändert beide Stellen) — **dreizehn Dateien, hier vollständig aufgezählt**: `main.ts`, `hub_view.ts`,
`settings.ts`, `http.ts`, die dünnen Modal-/Picker-Wrapper (`note_picker.ts`,
`template_picker.ts`, `reformat_picker.ts`, `reformat_preview_modal.ts`), das
`reformat_panel.ts`, `chat_view.ts`, `integrator_panel.ts` und `smart_apply_view.ts` (`setIcon`, der `App`-Typ für die Modellzeile bzw. zusätzlich
`Notice`) sowie `mcp/http_server.ts` (Platform-Gate, desktop-only). Diese Wrapper
sind **bewusst nicht unit-getestet** — das Test-Gewicht trägt der pure Kern; neue obsidian-Views
folgen diesem Muster statt Tests mit DOM-Mocks aufzubauen. Historisch —
`hub_view.ts` + `main.ts` sind die einzigen View-Layer-obsidian-Importe (Hub-Konsolidierung,
siehe „Abweichungen"). Die vier Hub-Panels (`view.ts`/`search_view.ts`/`chat_view.ts`/
`smart_apply_view.ts`) sind obsidian-frei bis auf `setIcon` (`chat_view.ts`, `smart_apply_view.ts`)
bzw. zusätzlich `Notice` (nur `smart_apply_view.ts`, Fehler-Feedback). `http.ts` kapselt Obsidians
`requestUrl` (CORS-frei, mobil-tauglich) als einzigen Netz-Helfer — die
Client-Module (`chat_client`, `embedder`, `capabilities`) sprechen nur `http.ts` an und bleiben damit
obsidian-frei + in Node testbar. **Streaming:** `ChatClient.stream` ruft seit Welle 15 `llm.complete` der Kit-Verbindung `createLlmConnection` (`vendor/kit-obsidian/llm-connection.ts`, Optionen in `connection_options.ts`), die den Kit-Client `createChatClient` mit `xhrSseTransport` (`XMLHttpRequest` via `onprogress`, weil `requestUrl` nicht streamen kann und `fetch` von der obsidianmd-Lint-Regel gesperrt ist) und `requestUrlTransport` als Fallback ohne Stream. `main.ts` orchestriert:
`file-Events → Debounce → embed → buildIndex → persist → refresh`.

### Modul-Layout (`src/`)

**Seit Welle 17 (2026-10-11) liegt der Index-Kern in code-kit 0.22.x (`src/vendor/kit/`, nie von Hand ändern):** `vector-index` (`VectorIndex`, `IndexStorage`, `parseIndex`, `Retriever`; früher `VaultIndex`/`VaultAdapter`/`retriever.ts`), `index-container` und `crc32`, `chunker`, `embed-vector`, `index-guard`, `index-delta` (Rechnung), `index-store` (`loadContainerIndex`), `live-indexer`, `embeddings-client` und `retrieval-facade`. Die gleichnamigen Einträge unten (`index.ts` mit `parseIndex`, `index-container`, `index-guard`, `retriever.ts`, `chunker.ts`, `live-indexer`, `index_delta.ts`-Rechnung) beschreiben das Verhalten weiter, die Dateien sind entfallen. Lokal bleiben: `index.ts` (nur `VaultAdapter` mit Text-Lesen/-Schreiben), `index_store.ts` (dünne Hülle um `loadContainerIndex` mit dem Prä-0.18-Tripel, `verifyBackupCandidate`), `index_delta.ts` (Anzeige-Texte), `http.ts` (`probeEndpoint`; der `EmbeddingClient` und `managed_endpoint.ts` sind seit der Embedding-Hülle entfallen), `retrieval_facade.ts` (Unterklasse mit `readNote`/`resolveNotePath`), `index_backup.ts`. Die Embedding-Anbindung ist `createLlmConnection({ capability: "embedding" })` (Kit `embedding-connection`, in `main.ts` als `emb`): Auflösung, Zustände je Zeile, der `Embedder` für `LiveIndexer` und Fassade und der Einstellungs-Abschnitt; der Index-Guard ist die `accept`-Closure über `manifest.embedding_model`, `applyEmbeddingResolution` übernimmt jede Auflösung (LiveIndexer, aktiver Endpunkt, Notice). Die Trefferzeile ist `renderHitList` aus dem Kit. Die Tests der vendorten Kerne (`tests/chunker`, `index_guard`, `index_container`, `live_indexer`, …) laufen weiter gegen die Kit-Module und sind der Differentialbeleg zum alten Verhalten.

```
i18n/strings.ts   EN/DE-Wörterbücher (`EN`/`DE`, 471 Keys je Sprache) für `t()`
                  (`src/vendor/kit/i18n.ts`) — EN kanonisch, DE die aktuelle deutsche
                  Übersetzung, Wort für Wort. Schlüsselschema `<datei-ohne-endung>.<sache>
                  [.variante]`; vorhandene Schlüssel wiederverwenden statt duplizieren.
                  Wird ausschließlich importiert (`import "./i18n/strings"` in `main.ts`, für
                  den Registrierungs-Seiteneffekt) — kein Modul greift direkt auf `EN`/`DE` zu.
embedding_pause.ts  Pause-Schalter für Embeddings (Spec Cockpit `_SDD/2026-09-17-vault-rag-vanilla-und-schalter-design`): `EmbeddingPause` über einen injizierten Speicher (`window.localStorage` in `main.ts`, pro Rechner, alle Vaults, nicht gesynct), `isPaused`/`setPaused`/`subscribe`/`refresh` (nach einem `storage`-Event)/`whenResumed`; `EmbeddingPausedError`, `EmbeddingPauseStorageError`. Obsidian-frei.
embedding_pause.ts (Methode `gate`)  `pause.gate(inner, "wait"|"throw", beforeCall?)`: die Garantie am Engpass. Der Indexer-Embedder WARTET (ein Reindex steht an der Gruppengrenze, Ergebnis danach Zeile für Zeile gleich wie ohne Pause — bewiesen in `tests/embedding_pause_gate.test.ts` mit > 32 Chunks), Abfragen WERFEN `EmbeddingPausedError`. `main.ts` baut beide über `countedEmbedder` (zählt zugleich je Aufrufer, `embed_counter.ts`).
embed_counter.ts  Zähler je Aufrufer für Embedding-Anfragen (Befehl „Embedding-Anfragen der letzten Stunde anzeigen“): Etiketten `indexer:modify|drain|reindex|heal|auto-heal`, `api`, `mcp`, `chat-context`, `search-panel`, `smart-apply`, `template-ranker`; eine `RetrievalFacade` je Verbraucher (`facadeFor`), damit das Etikett im `embed`-Anschluss steht und nicht in einem gemeinsamen Feld.
index.ts          VaultAdapter-Interface · IndexManifest · VaultIndex · parseIndex ·
                  IndexLoader — Legacy-Leser für das Prä-0.18-Tripel (notes.i8/paths.json/
                  manifest.json), int8→float32 + Renormalisierung (Quant-Drift). `parseIndex`
                  validiert neben `count == paths` auch `notes.i8.byteLength == count × dim`
                  (Byte-Guard) — wirft laut statt stillem Clobber/NaN. Wird von `index_store.ts`
                  für die byte-level Migration alter Indizes genutzt.
index-container  Container-Codec (seit 0.18.0): kodiert/dekodiert `_vaultrag/index.bin` —
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
index-guard    Pure-core Datenverlust-Entscheidungen: classifyLoadResult (no-index/loaded-ok/
                  load-failed-index-present) · assertSafeToPersist (Live-Persist darf Count nur
                  ±1 senken) · isSuspiciousShrink (Cross-Device-Clobber-Heuristik) ·
                  diffIndexVsVault (missing/stale) · PersistBlockedError · planAutoHeal
                  (restore-and-reindex/restore-only/wait-for-sync/no-backup — `canCompleteIndex`
                  trennt „Endpunkt gerade tot" von „dieses Gerät hat nie einen").
index_backup.ts   Pure-core Namens-/Rotationslogik für geräte-lokale Index-Backups:
                  BACKUP_SUBDIR ("index-backups") · backupDirName (ISO-Zeitstempel → FS-sicher) ·
                  selectBackupsToDelete (Rotation Großvater-Vater-Sohn über Kit `rotation`, höchstens 23; `keepNewest` + `protect`, weil der Name `built_at` trägt) · sortBackupsNewestFirst (Restore-Auswahl).
                  Die eigentliche Datei-I/O liegt in main.ts (migrateIndex).
retriever.ts      Retriever(index).related(path, {k,minSim,exclude}) → Hit[];
                  Brute-Force-Cosinus auf normalisierten Vektoren, Top-k über minSim.
retrieval_facade.ts  Gemeinsame obsidian-freie Fassade über Retriever/Embedder für UI + MCP:
                  RetrievalFacade(deps).embedQuery/searchVector/search/related/readNote →
                  getypte Result-Unions (hits/no-index/offline/not-indexed/…), nie throw.
                  resolveNotePath (Path-Guard) lebt hier. Kein this.retriever-Feld mehr.
chunker.ts        Frontmatter-Strip + Heading-Split (Port von HyperForge chunker.py).
endpoint_config.ts Dünner Re-Export des Kit-Moduls `src/vendor/kit/endpoint_config.ts` (seit Welle 15 und der Verbindung `createLlmConnection` gibt es hier keine eigene Logik mehr): `EndpointConfig { url, apiKey?, model? }`, `authHeaders` (EINZIGE Stelle, an der ein Bearer aus einem Endpunkt-/Anbieter-Schlüssel gebaut wird; der MCP-Server baut seinen Loopback-Token-Bearer separat), `rowModel` (Zeilen-Modell, getrimmt, einzige Quelle seit 0.31.0; ein nicht leeres `opts.model` am Feature gewinnt in `ChatClient.stream`, leer lässt die Verbindung das Zeilen-Modell nehmen), `migrateEndpointList` (alte String-Liste → Configs, behält `id`/`secretId`), `applyEndpointEdit`, `moveEndpointToFront` (die Liste IST die Priorität), `carriesApiKey` (der Schlüssel zeigt den Drittanbieter, nicht die URL), `endpointRole`/`EndpointRole`. Die Texte zu Status und Eingabe-Regeln (`endpointStatusText`, `endpointWarningText`) liegen im vendorten Kit-Modul `src/vendor/kit-obsidian/endpoint-status-text.ts` und kommen über das Kit-Listenbündel in die Oberfläche; `describeEndpointRole` und `endpointInputWarnings` gibt es nicht mehr. Obsidian-frei. Aufrufer importieren direkt hier, settings.ts und settings_core.ts reichen diese Helfer nicht durch.
(entfallen) Die Endpunkt-Wahl des EMBEDDINGS über den LLM Endpoint Manager liegt in der Kit-Verbindung `createLlmConnection` (Kit `embedding-connection`, in `main.ts` als `emb`; Auflösung über Kit `endpoint-source`). Gesendet und gegen den Index geprüft wird die aufgelöste Schreibweise (`sentModel`), nie `config.model` des Managers (der trägt das Standardmodell und würde die Nutzerwahl überschreiben, lingotuner-Fund C1). Die Zeile trägt den Schlüssel nur im Speicher. Die CHAT-Auflösung liegt ebenfalls in `createLlmConnection`; `connection_options.ts` hält die Optionen (Modi, Budget je Modus, `levelPicker`, Settings-Abbildung), `tests/chat_manager.test.ts` die Manager-Regeln.
request_profile.ts  Anfrage-Profile (Welle 14): die Werte, die das Plugin sendet, entscheidet die Kit-Tabelle `sampling-profiles`; hier stehen nur die MODI je Aufrufstelle (`MODE_CHAT` = `grounded`, `MODE_SMART_APPLY` = `structured`, `MODE_REFORMAT` = `transform`, `PLUGIN_MODES`) und die einmalige Legacy-Migration `migrateLegacySampling` (Chat-/Smart-Apply-Temperatur ≠ altem Default → Überschreibung unter `unknown`, die beiden „Thinking unterdrücken“-Schalter → Denk-Stufe je Modus). Seit Welle 15 baut die Kit-Verbindung die Parameter selbst (die Wrapper `build*Params` und `SourceFacts` sind entfallen); die goldenen Requests (`tests/request-golden.test.ts`, 45 Zeilen ausgeschrieben, nicht als Snapshot) messen den Body, der durch die echte Verbindung in den Transport geht. Obsidian-frei.
request_text.ts   `requestText(gruppe, id)` (aus lingotuner übernommen, Herkunftsstempel): der Schlüssel entsteht erst dort, weil der Schlüssel-Wächter Template-Literale in `t()` nicht auflösen kann; gruppiert ist nur noch `request.level` (Denk-Knopf), die Vollständigkeit bewacht `tests/request_text.test.ts` gegen die Kit-Tabelle. Die Abweichungs-Texte und alle Texte des Abschnitts „Anfrage“ kommen seit Welle 15 aus dem Kit (`llm-connection-strings`).
capabilities.ts   Reine Vision/Thinking-Erkennung, geschichtet L1 Metadaten (Ollama /api/show,
                  LM Studio /api/v1|v0) → L2 Name-Heuristik → L3 live-bestätigt (monotones Upgrade);
                  geteilter fetchCapabilities(baseUrl, model)-Probe-Helper.
embedder.ts       EmbeddingClient → Ollama/MLX HTTP-Endpoint; ping() + Batch-Embed (32/Req) +
                  listModels() + fetchCapabilities().
http.ts           httpJson() über Obsidians requestUrl — einziger obsidian-Import der Netz-Schicht.
pending_queue.ts  PendingQueue → Dirty-List in pending.json; drain-on-reconnect.
index_reload.ts  IndexReloadWatch → wann `maybeReload` neu lädt: nur bei fremder Änderung von index.bin, nie während eines eigenen Laufs; eigene Schreibvorgänge (`runIndexOp`, Voll-Reindex, Heilung) ziehen die mtime nach.
index_notices.ts Meldungen nach dem Laden: `shouldOfferCompletion` (Fenster „Index vervollständigen“), `formatPathList` (bis fünf Pfade), `RecurringFindings` (derselbe Pfad in drei Reloads).
live-indexer   LiveIndexer → note-level Vektor-Map; update/remove/rename · buildIndex ·
                  persist(reason) schreibt EINE Datei (`index-container` → `index.bin`, kein
                  Multi-File-Write mehr), gegen `index_guard` geguarded (ready + Live-Disk-Read des
                  tatsächlichen Counts vor jedem live-Persist statt gecachtem Zustand) ·
                  reindexAll buendelt seit 2026-09-05 die Chunks MEHRERER Notizen in eine
                  Embedding-Anfrage (EMBED_BATCH = 32, deckungsgleich mit der internen
                  Batchgroesse von `EmbeddingClient.embed`, die vorher leer lief, weil sie nur
                  die Chunks EINER Notiz sah). Die Antwort wird nach Chunk-Zahl aufgeteilt —
                  stimmt ihre Laenge nicht, faellt der Lauf auf Einzelverarbeitung zurueck
                  statt zu verteilen (ein Versatz von eins erzeugt sonst genau die
                  treppenfoermige Fehlzuordnung aus dem Gotcha „Eine Pruefsumme beglaubigt
                  Konsistenz, nicht Richtigkeit"); scheitert die Gruppen-Anfrage, wird Notiz
                  fuer Notiz nachgefasst, damit `failed` seinen Zuschnitt behaelt.
                  `cancelReindex` bittet den Lauf, an der naechsten GRUPPENGRENZE aufzuhoeren
                  (mittendrin waeren die Vektoren der laufenden Anfrage verloren); uebernommen
                  wird dann `mischeMitBestand` — neu berechnete Zeilen plus die noch nicht
                  erreichten aus dem bisherigen Bestand, dieselbe Mischung wie beim Checkpoint.
                  Ohne sie liesse `this.noteVectors = fresh` den Index auf die erreichten Notizen
                  schrumpfen. Verpufft, wenn kein Lauf aktiv ist, und wird bei jedem Start
                  zurueckgesetzt.
                  reindexAll persistiert seit 0.29.0 alle CHECKPOINT_EVERY (250) Notizen einen
                  VOLLSTAENDIGEN Zwischenstand (persistCheckpoint: neu berechnete Vektoren +
                  noch nicht erreichte aus dem bisherigen Bestand) — der In-Memory-Stand bleibt
                  dabei unberührt, damit die Suche während des Laufs stabil bleibt; nur bei
                  unverändertem Modell (checkpointsAllowed) ·
                  healMissing (additiver Delta-Reindex für Self-Heal) · markUnready/markFresh
                  (Gefahrenzustand-Schalter) · noteCount-Getter.
settings.ts       ⚠️ **Der Endpunkt-Zeilen-Editor kommt seit 2026-09-06 aus dem Kit**
                  (`vendor/kit-obsidian/endpoint-list.ts` @0.31.0, dazu `model-picker` und die
                  pure-Teile `endpoint_config`/`model-choice`/`model-list-cache`). Das lokale
                  `buildEndpointList` (278 Zeilen) ist entfallen — es WAR die Vorlage der
                  Kit-Extraktion und lief danach anderthalb Monate daneben weiter. Hier bleibt
                  nur die Sprach-Hälfte: `endpointStrings(label)` bildet die 22 Textstellen des
                  Kit-Vertrags auf unsere i18n-Schlüssel ab (`label` ist Parameter, weil auf
                  diesem Tab ZWEI Listen stehen und ein gemeinsames Objekt beiden dasselbe
                  `aria-label` gäbe). Die CSS-Grammatik heißt entsprechend `okit-ep-*`, nicht
                  mehr `vault-rag-ep-*`; `styles.css` trägt die Consumer-Hälfte aus
                  `ENDPOINT_LIST_CSS`, `scripts/gui-smoke.ts` und `scripts/shots.ts` greifen auf
                  dieselben Klassen zu.
                  VaultRagSettings · DEFAULT_SETTINGS · VaultRagSettingTab — vollständig deklarativ
                  (Obsidian 1.13 `getSettingDefinitions()`, 7 Gruppen, durchsuchbar): einfache
                  Zeilen sind `control`-Definitionen, `get/setControlValue` liest/schreibt sie
                  (mit Coercion + Seiteneffekten wie refresh/setStatusBarVisible). Dynamische
                  Zeilen (Endpoint-Listen — pro Zeile URL + maskiertes API-Schlüssel-Feld +
                  Modell als Dropdown, ein „Zuerst verwenden"-Knopf (ab Zeile 2, bewusst
                  nicht gezeichnet statt deaktiviert an Platz 1 — ein `setDisabled`-Tooltip bleibt in
                  Electron unsichtbar) verschiebt die Zeile per `moveEndpointToFront` an die Spitze,
                  eine `okit-ep-state`-Zeile zeigt pro Endpunkt seine `endpointRole` (aktiv/
                  Platz N/nicht erreichbar/Modell-Mismatch) synchron angelegt + asynchron nach der
                  Probe befüllt, gesperrt während einer form-ändernden Mutation läuft,
                  plus `alert-triangle`-Hinweis-Icon bei gesetztem Schlüssel (`carriesApiKey`) —
                  Form/Icon + Tooltip, nie Farbe allein, Schlüssel selbst nie im Text; das Icon
                  schaltet sich beim apiKey-Commit **in-place** um, weil dieser Commit bewusst kein
                  `refreshUi()` auslöst (Tab-Neuaufbau bleibt URL-Commits vorbehalten) —,
                  Status-Poll alle 2 s, MCP-Sektion) sind render-Hatches. Das eine verbliebene
                  Modellfeld (Smart Apply) und die Endpunkt-Zeilen zeichnet der Kit-Picker
                  (`vendor/kit-obsidian/model-picker`), Hint-Codes übersetzt `modelHint`
                  (`hintAs: "desc"|"tooltip"`: Endpunkt-Zeilen
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
view.ts           RelatedPanel (HubPanel) — rendert Hits (`renderHitList` aus dem Kit, auch von search_view.ts
                  genutzt), Klick öffnet Notiz.
search_view.ts    SearchPanel (HubPanel) — Wortsuche über den Index (Debounce 400 ms, Min. 3 Zeichen).
chat_view.ts      ChatPanel (HubPanel) — dünne Hülle um das Kit-Chat-Fenster (`buildChatWindow`, UI-STANDARD § 8
                  Baustein 12): `send` (Kontext und Prompt über `prepareChatAsk`, Tracing, Fehlerabbildung über
                  `chatSendFailure`), Auto-Kontext (`ContextPanel`, Suche über das `input`-Ereignis an der Fenster-
                  Wurzel), Quellen-Chips unter fertigen Antworten, Modellzeile (`buildModelBar`, Denk-Steuerung in
                  der Zeile). Verlauf (`ChatHistory`), Eingabe, Abbruch, Fehlerzeile und Markdown trägt das Kit.
chat_ask.ts       `prepareChatAsk` (Anfrage einer Runde: System-Prompt + Kontext, frühere Runden, Frage), `sentFromMeta`.
chat_error.ts     Fehlerklassen des Chat-Transports (`ChatHttpError`, `ChatTimeoutError`, `ChatNoEndpointError`,
                  `ChatNetworkError`) und `chatSendFailure`: bildet einen geworfenen Fehler auf das Ergebnis ab, das das
                  Kit-Fenster erwartet (die Serverbegründung eines HTTP-Fehlers bleibt erhalten).
smart_apply_view.ts SmartApplyPanel (HubPanel) — Diff-Gate-Cockpit (Scan-Guard, Frontmatter-Diff,
                  Body-Reflow, Relevanz-Rangliste, Rohtext on-demand).
hub_panel.ts      HubPanel-Interface + TabId ("related"|"search"|"chat"|"smart-apply"|"reformat"|
                  "integrator") — Vertrag zwischen Hub und den sechs Panels (mount/onShow/onHide/
                  onFileOpen/destroy).
                  Bleibt bewusst lokal, obwohl das Kit ein `HubPanel<Id>` mitbringt: er ist
                  strukturell zuweisbar, und die Doku hier gehört zu DIESEN Panels.
hub_view.ts       VaultRetrievalView (ItemView, VIEW_TYPE_HUB="vault-retrieval-hub") — EIN
                  Sidebar-View mit Tab-Leiste statt fünf Views; hält alle Panels dauerhaft gemountet
                  (State-Persistenz), blendet nur per `is-hidden` um (kein render-from-scratch).
                  **Der Aufbau selbst liegt seit Kit 0.27.0 im Kit** (`buildHubInto`,
                  `vendor/kit-obsidian/hub.ts`); diese Datei ist nur noch die Obsidian-Kante
                  (ItemView-Lebenszyklus, `getState`/`setState`, Datei-Events). Die CSS-Grammatik
                  heißt entsprechend `okit-hub-*`, nicht mehr `vault-rag-hub-*` — `styles.css`
                  trägt die Consumer-Hälfte (`HUB_CSS`), `scripts/shots.ts` greift auf dieselben
                  Klassen zu.
plugin_api.ts     Öffentlicher Vertrag für ANDERE Obsidian-Plugins, hängt als `plugin.api` am
                  Plugin-Objekt (`app.plugins.plugins["vault-retrieval"]?.api`). Dünner Adapter
                  über die RetrievalFacade, exakt nach dem Muster von `mcp/tools.ts` — bewusst
                  NICHT die Facade selbst: die trägt readNote/embedQuery/searchVector, also
                  Dateizugriff und Vektor-Interna, und ist unser internes Refactoring-Objekt.
                  Fläche: `apiVersion` (1) · `status()` (synchron, netzfrei) · `search(query)` ·
                  `related(path)` · seit 0.32.0 `proposeLinks(path)` (rechnet nur, legt NICHTS in die
                  Inbox) und `applyLink(path, target)` (schreibt sofort, ohne Hash-Guard) — alle async, auch `related`, obwohl es intern synchron
                  rechnet: ein synchroner Vertrag ließe sich nie wieder async machen.
                  Rückgaben sind laufzeit-lesbare Diskriminatoren (`{ok:true,hits}` /
                  `{ok:false,reason}`), keine Compile-Zeit-Unions — ein Fremdplugin kann unsere
                  Typen nicht importieren. `reason` ist ein CODE, nie übersetzter Text (die
                  Formulierung gehört dem Aufrufer; hält zugleich den i18n-Sink-Guard sauber).
                  `exclude` ist NICHT überschreibbar (Nutzergrenze, kein Tuning-Parameter),
                  Scores kommen ungerundet (Darstellung entscheidet der Konsument).
                  `status().reindexing` meldet einen laufenden Voll-Reindex — eine STRUKTURELLE
                  Aussage über die Quelle, die sonst der Konsument raten müsste (und dafür eine
                  Heuristik über Trefferqualität bauen, also die verbotene Reparatur). Bewusst
                  ein Boolean ohne Fortschrittszahl: eine Zahl lädt zu einer Schwelle ein
                  („ab 80 % vertraue ich den Treffern wieder"). `indexed` bleibt dabei `true` —
                  das Feld qualifiziert es, es widerspricht ihm nicht.
tool_provider.ts  Werkzeug-Anbieter an `plugin.api` (seit Welle 22 auf `main`), additiv, `apiVersion` bleibt 1; Vertrag `ToolProviderApi` aus obsidian-kit 0.60.x: `version` ist `TOOL_PROVIDER_API_VERSION` (Kit `tool-provider`, der Wirt prüft sie mit `isToolProviderApi`), die Methode heißt `executeTool`; Festlegungen mit koda-agent 2026-09-25. `TOOL_REGISTRY` ist die einzige Stelle, an der Namen entstehen (`semantic_search`, `related_notes`; der Name ist Wire-Identität, Eindeutigkeit je Anbieter ist getestet). `tools(opts?: {lang})` liefert OpenAI-Function-Definitionen (`name`/`description`/`parameters`/`writes`), leer ohne Index. `executeTool(name, args, opts?: {lang, confirm})` wirft nie und liefert `{ok:true, content, data?}` bzw. `{ok:false, reason, message}` — `content`/`message` sind der Text fürs Modell (die Sätze aus koda-agents `formatRelatedResult`, hier i18n), `data` (`{hits}`) ist für die Oberfläche des Wirts. `reason`: `unknown-tool`, `bad-args`+`field`, `failed`, `needs-confirm`, `unavailable`+`detail` (`no-index`/`offline`), zusätzlich `not-indexed`+`path`. Ein `writes:true`-Werkzeug ruft `confirm` mit nebenwirkungsfreier Vorschau und endet ohne `confirm` oder bei `false` mit `needs-confirm` (per Test-Werkzeug bewiesen; `applyLink` ist noch kein Werkzeug). Die Sprache wird nur synchron um die Textbildung gesetzt (`run` rechnet, `render` formuliert), nie über ein await. `exclude` bleibt Nutzergrenze.
settings_core.ts  Obsidian-freie Settings-Wahrheit: VaultRagSettings (embeddingEndpoints/
                  chatEndpoints als EndpointConfig[]) · DEFAULT_SETTINGS · migrateGlobalModels
                  (Prä-0.31-Altwert der entfallenen globalen Modell-Felder in die Zeilen, die noch
                  kein eigenes Modell tragen — Zeilen mit Modell bleiben unberührt) ·
                  `stripLegacyGlobalModels` räumt die Alt-Schlüssel nach der Migration, sonst
                  liefe sie bei jedem Start erneut — die Endpunkt-Helfer liegen in
                  endpoint_config.ts und werden von dort importiert, nicht hier durchgereicht.
                  Vom MCP-Server direkt importiert.
mcp/              In-Plugin HTTP-MCP-Server (Loopback, `/mcp`, StreamableHTTP): `http_server.ts` ·
                  `register_tools.ts` · `tools.ts` (dünner Adapter über RetrievalFacade) · `auth.ts`.
                  Kein Node-Adapter/kein stdio mehr.
reformat_mechanical.ts  Pure Markdown-Struktur-Transforms (Slice C.1): `transposeTable` (Tabelle
                  kippen) · `tableToList` · `splitSelectionAffix` (Rand-Whitespace
                  vom Kern trennen; ein reiner Spalten-Einzug gehört zum KERN, sonst klebt er nur
                  an der ersten Ergebniszeile). Interner `parseTable`-Helper. **Pipes werden beim
                  Rendern re-escaped** — sonst zerreißt eine `\|`-Zelle die Tabelle (s. Gotchas).
reformat_prompts.ts     Pure Prompt-Builder je LLM-Zielformat (`buildTransformMessages`) +
                  `transformPromptTemplate` (der stabile Anteil fuer llm-labs `promptTemplate`,
                  s. u.) + `REFORMAT_MAX_TOKENS`. Anti-Fabrication im System-Prompt; NICHT verwandt mit
                  `note_restructurer.antiFabrication()` (das ist SmartApplys JSON-Protokoll; dort eine
                  Funktion, weil sie erst zur Prompt-Bauzeit übersetzt werden darf).
reformat_transforms.ts  (seit Welle 22: `buildTransforms(presets)` ergänzt die Registry um eigene LLM-Funktionen aus `settings.reformatPresets` — Titel + feste Anweisung, laufen wie `freetext`, `label` statt `labelKey`, `transformLabel(def)` für die Anzeige; Eingebaute bleiben fest, halb ausgefüllte Zeilen werden nicht angeboten) `TRANSFORMS`-Registry — **einzige Wahrheit** für Picker UND Sidebar-Panel.
                  Diskriminierte Union über `kind`; jeder Eintrag trägt `labelKey` (nicht das
                  fertige Label) — die Registry ist eine Modul-Konstante, ihre Labels müssen
                  deshalb erst zur Zeichenzeit übersetzt werden. Mechanisch trägt zusätzlich
                  `run(text) → string|null` (null = Struktur passt nicht), llm trägt
                  `buildMessages` UND verpflichtend `promptTemplate: () => string` (fuer llm-labs
                  Prompt-Fassungs-Hash); genau ein Eintrag hat `freetext: true`.
reformat_selection_state.ts  Pure Bereitschafts-/Anzeige-Logik (Slice C.2): `ReformatReadiness`
                  (ready/reading-mode/no-selection/no-editor) · `readinessMessage` (EINE Wahrheit
                  für Notice und Panel-Kopfzeile) · `canRun` · `selectionPreview` ·
                  `isRangeStale` · `groupTransforms` (teilt die Registry in die zwei Panel-Gruppen).
reformat_progress.ts    Pure `waitingMessage(elapsedMs)` für die Vorschau, solange kein Token da
                  ist. Bewusst ohne Diagnose — der Endpoint sagt nicht, ob geladen oder gedacht wird.
                  Dazu `truncationKey(finishReason)` → i18n-**Schlüssel** oder null: nur `"length"`
                  ist ein Befund, und der Text entsteht erst an der Anzeigestelle (i18n Teil 3 —
                  entstünde er hier, läge zwischen Erzeugung und Senke keine Literalstelle mehr,
                  die der Sink-Guard sehen könnte).
reformat_picker.ts      `pickTransform` (FuzzySuggestModal über die Registry) + `promptInstruction`
                  (Freitext-Modal). obsidian-gekoppelt, nach `note_picker.ts`-Muster.
reformat_preview_modal.ts  `ReformatPreviewModal` — Ur-Text vs. gestreamtes Ergebnis, Anwenden/
                  Neu/Verwerfen. Stale-Run-Guard (`this.controller !== ctrl`) auf allen Pfaden;
                  `onClose` nullt den Controller, sonst wäre der Guard nach dem Schließen wirkungslos.
reformat_panel.ts       `ReformatPanel` (HubPanel, 5. Tab) — rendert die Gruppen aus `TRANSFORMS`,
                  zeigt Auswahl-Vorschau bzw. den Grund, deaktiviert alle Buttons wenn `canRun` false.
link_writer.ts    Reine Textfunktionen des Integrators: `wikilinkFor(path)` (`[[pfad|basename]]` oder
                  null — die Zeichen `[ ] # ^ |` kann Obsidian nicht klammern; uebernommen aus mailstone)
                  · `containsLink(text, path)` (voller Pfad oder nackter Basename, mit/ohne Alias und
                  Ueberschrift) · `appendSectionLink(text, heading, path)` (Abschnitt am Notiz-Ende,
                  idempotent) · `appendFrontmatterLink(text, field, path)` (ZEILENWEISE: nur die Zeilen
                  des einen Schluessels aendern sich, alles andere bleibt byteweise — Scanner-Semantik
                  aus mailstone `merge.ts`; sieben Formen von `related:` gemessen im Arbeits-Vault, dazu
                  `block-scalar`/`not-a-list`/`frontmatter-unparseable` als Codes statt Schreiben).
integrator_store.ts  Inbox des Integrators als reines Zustandsobjekt: ein Vorschlag je Notiz (`upsert`
                  ersetzt), Ablehnungs-Gedaechtnis je Notiz, `markStale`/`updateHash` fuer den
                  Hash-Guard, `rename`/`remove` folgen dem Vault. Persistiert als `integrator.json` im
                  Plugin-Ordner (geraete-lokal, KEIN Vault-Footprint — Spec E5); I/O in main.ts.
integrator.ts     `proposeLinks(path, noteText, deps)` → Kandidaten aus `facade.related` (offline, kein
                  LLM), deterministisch gefiltert (selbst, schon verlinkt per `metadataCache.resolvedLinks`,
                  abgelehnt, nicht als Wikilink darstellbar) → Ergebnis-Union proposal/no-index/
                  not-indexed/nothing-new. `inScope(path, folders)` (leer = automatischer Ausloeser aus),
                  `hashText` (djb2, bewusst Kopie aus smart_apply.ts statt Kopplung).
integrator_panel.ts  `IntegratorPanel` (HubPanel, 6. Tab, Icon `link`) — Karte je Notiz (Rezept
                  vault-crews), Ziel-Zeilen ueber `renderHitList` (Kit) mit Aktions-Slot, Annehmen/Ablehnen je
                  Ziel und je Notiz, Stale-Hinweis als Icon+Text, Empty-State mit genau einem CTA,
                  Doppelklick-Schutz (`pending`). Fehlercodes werden erst hier zu Text.
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
                  Integrator (Slice D): drei Ausloeser fuer `proposeFor` — automatisch im Modify-Pfad
                  NACH erfolgreichem Persist und AUSSERHALB von `runIndexOp` (nur `integratorEnabled`
                  + `indexHealthy` + `inScope`), Kommando „aktive Notiz", Kommando „Bereich" (Stapel
                  ueber `integratorFolders`). `acceptLink` liest frisch, prueft den djb2-Hash gegen den
                  Stand der Berechnung (Abweichung → `markStale`, kein Schreiben), waehlt den Schreiber
                  nach `linkTarget`, schreibt nur bei `changed` und setzt den Hash auf den geschriebenen
                  Stand. `saveIntegratorStore` ist eine Promise-Kette, `serialize()` laeuft erst im
                  Kettenglied — sonst ueberschriebe ein aelterer Snapshot einen juengeren.
                  `applyLinkNow` ist die Plugin-API-Flaeche: sofort, ohne Inbox, ohne Hash-Guard.
                  Aktive Endpunkt-Modelle: `embeddingModelInUse` (Embedder + LiveIndexer/Manifest
                  als Paar); Chat: `llm` (Kit-Verbindung) → Getter `chatModelInUse` (aufgelöstes
                  Modell, bis zur neuen Auflösung die Dropdown-Wahl `pendingChatModel`) /
                  `smartApplyModelInUse` (Feature-Modell vor Zeilen-Modell). Smart Apply gibt
                  `smartApplyModel` als `opts.model`; leer heißt: Zeilen-Modell (E1, 0.31.0).
```

**Index-Format (seit 0.18.0):** EINE Container-Datei `_vaultrag/index.bin` — `"VRIX"` · u32 headerLen LE
· Header-JSON (Manifest inkl. `paths`, `schema_version: 2`) · Int8-Matrix · CRC32. Ein File statt drei,
damit Obsidian Sync keine Generationen mischen kann (Spec
im Vault-Cockpit unter `_SDD/`: `2026-07-29-sync-race-container-index-design.md`). Embedding-Dimension **256**,
`INT8_SCALE = 127`, **mean**-Aggregation. `pending.json` bleibt eigenständig (Dirty-List, unkritisch).
Das Prä-0.18-Tripel (`notes.i8`/`paths.json`/`manifest.json`) wird beim ersten Load byte-level migriert.
Der Index entsteht im Plugin (`LiveIndexer.persist`, Container-Format); ein früherer externer Export (HyperForge) ist stillgelegt. Ein extern erzeugter Index muss dieses Container-Format tragen.

### Vendored Kit Module (`src/vendor/kit/` + `src/vendor/kit-obsidian/`)

**Zwei Ablagen seit 2026-07-27 (workspace-weite Konvention):** `src/vendor/kit/` hält die
**obsidian-freien** Module — seit dem code-kit-Split (obsidian-kit 0.28.0) aus **zwei Quellen**:
`callout.ts`/`frontmatter.ts` kommen weiterhin aus **obsidian-kit** (0.31.0), die restlichen dreizehn
(`clipboard.ts`, `endpoint.ts`, `endpoint_config.ts`, `endpoint_diagnostics.ts`, `error_body.ts`,
`i18n.ts`, `model-choice.ts`, `model-list-cache.ts`, `reasoning.ts`, `settings.ts`, `sse.ts`,
`think-splitter.ts` (bis Welle 11 lokal `think.ts`), `timeout.ts`) aus **code-kit** (0.5.0), das die pure-Schicht seither führt.
`src/vendor/kit-obsidian/` hält die **obsidian-gekoppelten** Module, alle aus obsidian-kit 0.31.0
(`clipboard.ts`, `collapsible.ts`, `confirm.ts`, `endpoint-list.ts`, `folder-suggest.ts`, `hub.ts`,
`model-picker.ts`, `settings_walker.ts`). Beide sind **verbatim-Snapshots — nie von Hand editieren**,
Updates nur per Neu-Kopie über `tools/sync-kit.sh`.

**Stand des Pins seit 2026-09-25 (Welle 8): `obsidian-kit` 0.41.1 und `code-kit` 0.7.0** — die Versionsangaben in den Absätzen hier sind älter, maßgeblich ist die `VENDOR.json` im jeweiligen Ordner. Neu dazu kamen `endpoint-source` (pure in `kit/`, Obsidian-Baustein in `kit-obsidian/`) und `sampling-profiles`; `endpoint-source` trägt einen Querimport auf die code-kit-Schicht, den `sync-kit.sh` per `relayer_pure` auf `./` umschreibt (zweite mechanische Abweichung von verbatim, Vorbild `lingotuner`).
**Nachtrag Welle 14 (Sampling-Profile, Pins unverändert `obsidian-kit` 0.43.0 / `code-kit` 0.7.0):** dazu kamen `request-section`, `request-session` und `thinking-control` (kit-obsidian) sowie `capabilities` (code-kit, für `probeEndpoint`/`probeBaseUrl` hinter `cachedProbe`; nicht zu verwechseln mit der eigenen `src/capabilities.ts`, die Vision/Thinking-Anzeige bleibt). Die Consumer-CSS der beiden UI-Bausteine steht in `styles.css` (`REQUEST_SECTION_CSS` verbatim, Denk-Steuerung nach lingotuner). Die Denk-Steuerung ersetzt den eigenen Suppress-Schalter im Chat- UND im Smart-Apply-Panel; den Tab-Refresh `installTabRefreshOnOpen` hängt der Abschnitt „Anfrage“ bewusst NICHT an (eigene Backlog-Task, ändert das Render-Verhalten des ganzen Tabs).

**Seit 2026-08-27 macht das `tools/sync-kit.sh`** statt einer Handkopie, und beide Verzeichnisse
tragen eine `VENDOR.json` (vorher hatte nur `kit-obsidian/` eine, in `kit/` stand der Pin je Datei
in Zeile 1 — sechs verschiedene Versionen nebeneinander). Drei Eigenschaften des Skripts sind
load-bearing, nicht kosmetisch:
- **Es liest über `git show <ref>:<pfad>`, nicht aus dem Arbeitsstand des Nachbar-Repos.**
  obsidian-kit läuft weiter: seit 0.28.0 sind 23 `pure/`-Module nach `code-kit` gezogen, darunter
  `error_body` und `clipboard`. Ein `cp` aus dem Kit-Arbeitsverzeichnis liefert je nach dessen HEAD
  etwas anderes — oder gar nichts.
- **Es löst den Tag-Commit auf, nicht `HEAD`.** Der Kit-HEAD steht auf einem späteren Stand als der
  Tag; ein daraus gelesener SHA widerspräche der vendorierten Version in derselben Datei.
- **Annotierte Tags brauchen `^{commit}`.** code-kit taggt annotiert; ohne das Peel stünde in
  `VENDOR.json` die SHA des Tag-*Objekts*, die in der `git log` der Quelle nie auftaucht.

Ein zweiter Lauf darf keinen Diff erzeugen — das ist die Probe darauf, dass Header und
`VENDOR.json` deterministisch sind (deshalb steht dort **kein** Datum).

`src/vendor/kit-obsidian/confirm.ts` (@0.31.0) — `confirmAction(app, opts)` als einzige
Bestätigungs-Modal-Wahrheit; ersetzt seit `210b43c` die repo-eigenen `ConfirmModal`-Klassen in
`main.ts`/`settings.ts` (UI-STANDARD §2: Cancel als Link, `modal-button-container`).
**Gotcha:** der Heal-Dialog beim Start läuft bewusst **fire-and-forget** (`.then(…)`, kein `await`) —
ein `await` in `onload` blockiert den Plugin-Start, bis der Nutzer klickt (`bee6a2a`).

`src/vendor/kit-obsidian/collapsible.ts` (@0.31.0; bis zum Re-Vendoring 2026-08-27 hing es als
einziges auf einem eigenen Datei-Header-Pin @0.13.0 an der `VENDOR.json` vorbei) — erste
obsidian-gekoppelte UI-Schicht des
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
