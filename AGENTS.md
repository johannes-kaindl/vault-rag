# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../_docs/CONVENTIONS.md`](../_docs/CONVENTIONS.md).

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
  Plugin [`image-to-markdown`](https://codeberg.org/jkaindl/vault-rag) (`/Users/Shared/code/obsidian-plugins/image-to-markdown`).
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

Nur `main.ts`, `hub_view.ts`, `settings.ts` und `http.ts` importieren `obsidian` —
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
                  IndexLoader — liest den statischen _vaultrag/-Index (notes.i8/paths.json/
                  manifest.json), int8→float32 + Renormalisierung (Quant-Drift).
retriever.ts      Retriever(index).related(path, {k,minSim,exclude}) → Hit[];
                  Brute-Force-Cosinus auf normalisierten Vektoren, Top-k über minSim.
chunker.ts        Frontmatter-Strip + Heading-Split (Port von HyperForge chunker.py).
reasoning.ts      Reine Thinking-Helfer: suppressParams (Cross-Server-Union reasoning_effort/
                  chat_template_kwargs/reasoning_budget — nie Boolean/„minimal") · reasoningHappened
                  (griff der Suppress? <think>/reasoning-Feld) · isAlwaysOnThinker (gpt-oss/Harmony).
capabilities.ts   Reine Vision/Thinking-Erkennung, geschichtet L1 Metadaten (Ollama /api/show,
                  LM Studio /api/v1|v0) → L2 Name-Heuristik → L3 live-bestätigt (monotones Upgrade);
                  geteilter fetchCapabilities(baseUrl, model)-Probe-Helper.
embedder.ts       EmbeddingClient → Ollama/MLX HTTP-Endpoint; ping() + Batch-Embed (32/Req) +
                  listModels() + fetchCapabilities().
http.ts           httpJson() über Obsidians requestUrl — einziger obsidian-Import der Netz-Schicht.
pending_queue.ts  PendingQueue → Dirty-List in pending.json; drain-on-reconnect.
live_indexer.ts   LiveIndexer → note-level Vektor-Map; update/remove/rename · buildIndex ·
                  persist (Write-Order: notes.i8 → paths.json → manifest.json) · noteCount-Getter.
settings.ts       VaultRagSettings · DEFAULT_SETTINGS · VaultRagSettingTab (Sektionen, Slider,
                  Debounce, Ausschluss-Editor, Live-Progress-Refresh alle 2 s).
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
settings_core.ts  Obsidian-freie Settings-Wahrheit: VaultRagSettings · DEFAULT_SETTINGS ·
                  migrateEndpointList — von settings.ts re-exportiert, vom MCP-Server direkt genutzt.
mcp/              Headless stdio-MCP-Server (2. esbuild-Entry → mcp-server.js, Node-Programm,
                  NIE obsidian importieren): server.ts (SDK-Schale) · tools.ts (search/related/
                  read_note, mtime-Reload) · config.ts (liest Plugin-data.json) ·
                  node_adapter.ts (read-only VaultAdapter) · node_embed.ts (fetch-Probe/-Embedding).
main.ts           Plugin-Entry: Hub-View/Ribbon("layers")/Commands/SettingTab registrieren, file-Events
                  (modify/delete/rename), 3 s-Debounce, 60 s-Drain, EmbeddingProgress + Statusleiste.
```

**Index-Format (Slice A, unveränderlich):** `notes.i8` (Int8-Matrix) · `paths.json` · `manifest.json`.
`manifest.json` wird **zuletzt** geschrieben — es ist der Reload-Trigger. Embedding-Dimension **256**,
`INT8_SCALE = 127`, **mean**-Aggregation der Chunk-Vektoren.

## Commands

```bash
npm install                       # Deps
npm run dev                       # esbuild watch  (= node esbuild.config.mjs)
npm run build                     # baut main.js UND mcp-server.js
npm test                          # vitest run     (191 Tests, 21 Files)
npm run lint                      # eslint src     (typescript-eslint + eslint-plugin-obsidianmd)
npm run typecheck                 # tsc --noEmit
npx vitest run tests/<datei>      # eine Test-Datei
npx tsc --noEmit                  # Typecheck (noch kein npm-Script — siehe Abweichungen)
```

esbuild: `entryPoints: src/main.ts`, `format: cjs`, `externals: obsidian, electron`, Output `main.js`
(gitignored). Kein `lint`/`typecheck`/`deploy`-Script vorhanden (siehe Abweichungen).

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
  Specs/Pläne unter `docs/superpowers/{specs,plans}/`.

## Gotchas

- **`data.json`** ist die von Obsidian persistierte Plugin-Konfig (`saveData`) — maschinen-/vault-spezifisch,
  daher git-ignored (nicht committen).
- **`_vaultrag/` ist bewusst kein Dot-Ordner:** Obsidian Sync ignoriert Dot-Ordner. Daher braucht
  Sync „Sync all other file types"; im Pallas-Vault ist `_vaultrag/` git-ignored (derived, synct via
  Obsidian Sync, nicht git).
- **Dot-Pfade auto-ausgeschlossen:** `handleModify/Delete/Rename` returnen bei `path.startsWith(".")`
  (deckt `.obsidian/`, `.trash/` ab) — daher `.trash/` **nicht** mehr in `DEFAULT_SETTINGS.exclude`.
- **`parseIndex`** validiert `count == paths`, aber **nicht** `byteLength`. Partielle Sync-Downloads
  heilen self-healing über mtime-Reload; optionaler Byte-Guard ist offen.
- **HyperForge-Export** braucht Daemon-Stopp bei Live-Lauf (embedded-Qdrant ist single-process).
- **`main.js`** ist Build-Artefakt (gitignored) — nie von Hand editieren.
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
- **`mcp-server.js`** ist Build-Artefakt (gitignored) — der MCP-Server für externe Clients
  (`node mcp-server.js <vault>`); Spec `docs/superpowers/specs/2026-07-09-mcp-server-design.md`.
  obsidianmd-ESLint-Regeln gelten für `src/mcp/**` bewusst nicht (Node-Programm, fetch erlaubt).

## Memory

- **Projekt-Memory:** `~/.claude/projects/-Users-Shared-code-vault-rag/memory/` (Index `MEMORY.md`,
  aktuell leer). Verwandtes Wissen liegt im HyperForge-Memory: `…-code-hyperforge/memory/project_vault_rag.md`.
- **Coding-Cockpit (SSOT für Stand/Tasks/History):**
  `/Users/Shared/10_ObsidianVaults/10_Pallas/25_Coding/vault-rag/vault-rag.md`. Wird vom
  SessionEnd-Hook gestempelt (`letzter_commit`, `letzte_session`, `fokus`); §🧭 hält die dauerhafte
  Architektur-/Warum-/Gotcha-Wahrheit. **Beim Start lesen, am Ende fortschreiben.**
- **Session-Handoff:** `.remember/` (gitignored).

## Abweichungen von der Leitkonvention

Stand 2026-06-21 — `vault-rag` ist mit **v0.2.0** erstmals öffentlich released (Codeberg kanonisch
+ GitHub-Mirror). Bewusste, begründete Abweichungen (comply-or-explain):

- **CORE-META-02** — Badge-Zeile **partiell**: Lizenz/Docs/Obsidian gesetzt; Release/CI-Badges fehlen.
  *Grund:* Release-Badge mit v0.2.0 nachziehbar; CI-Badges erst mit CI.
- **CORE-META-03** — kein Hero-Bild/Feature-Screenshots in `docs/images/`. *Grund:* pre-release;
  reproduzierbar generierte Screenshots vor dem ersten Release.
- **CORE-META-04** — kein Diátaxis-Manual unter `docs/`. *Grund:* pre-release; skaliert mit Reife.
- **CORE-META-06** — ✅ erledigt: `CHANGELOG.md`, `CONTRIBUTING.md` und `SECURITY.md` vorhanden.
- **CORE-META-07** — `LICENSE` (AGPL-3.0) vorhanden; Dual-License-Option (`LICENSING.md`/`CLA.md`)
  noch nicht. *Grund:* erst bei Bedarf/Release.
- **CORE-META-09** — kein `README.de.md` (Bilingual). *Grund:* optional; EN-`README.md` ist kanonisch.
- **CORE-META-10** — ✅ erledigt (v0.2.0): `package.json`/Manifest konsistent; Forge-Description + Topics
  auf Codeberg **und** GitHub gesetzt.
- **CORE-GIT-01** — ✅ erledigt (v0.2.0, 2026-06-21): Codeberg-`origin` gesetzt (`codeberg.org/jkaindl/vault-rag`,
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

Dieses Repo liegt unter dem Koordinations-Dach `/Users/Shared/code/obsidian-plugins/`.
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im
`obsidian-kit` bereits gelöst.

**Vor jeder UI-Arbeit** (Views, Modals, Settings-Tabs, CSS): `../UI-STANDARD.md` ist
verbindlich (Obsidian-nativ first, ein Frontend pro Plugin, nur Theme-CSS-Variablen).
