# Entscheidungen

Das Warum von `vault-rag`: Designentscheidungen und begründete Abweichungen von der Leitkonvention. Lädt nie von selbst; der Kern der `AGENTS.md` verweist hierher. Die Herleitung bleibt im Cockpit.

## Bewusste Designentscheidungen

- **Retrieval ≠ Generierung.** Retrieval läuft über den lokalen Index; Chat/Composer (spätere Slices)
  über lokale LLMs. Das Panel selbst braucht **keinen** Daemon, kein VPN, kein On-Device-LLM.
- **Slices statt Monolith:** **A Related-Notes** (✅ gebaut + live) · **B Chat** · **C Inline-Composer** ·
  **D Integrator Stufe 1 — Verlinkung mit Review-Inbox** (✅ seit 0.32.0; ADR-031, Spec im Cockpit
  `_SDD/2026-09-07-integrator-linking-design.md`).
- **IMG→MD ausgegliedert (2026-06-21):** Bild-Transkription ist kein RAG → eigenständiges
  Plugin [`image-to-markdown`](https://git.jkaindl.de/jkaindl/vault-rag) (Schwester-Repo `../image-to-markdown`).
  vault-rag bleibt der schlanke RAG-Kern. Der Chat-Client (Streaming, Fristen, Fallback ohne Stream) kommt seit
  Welle 11 aus dem Kit (`createChatClient`), nicht mehr aus einer Kopie in beiden Plugins.
- **Offline-first & cross-device:** Das Plugin baut beim Reindex einen note-level
  Matryoshka-256-int8-Mini-Index (~1,4 MB) nach `<vault>/_vaultrag/` (ein extern erzeugter Index im selben Format wird ebenso gelesen). Es liest ihn und
  rechnet **Brute-Force-Cosinus lokal** — auf allen Geräten, auch auf dem iPhone.
- **Live-Embedding (Slice A+):** Bei `file:modify` wird die Notiz via konfigurierbarem
  Ollama/MLX-Endpoint neu vektorisiert; Offline-Edits landen in einer Dirty-List und werden
  bei Reconnect nachgezogen. Der statische `_vaultrag/`-Index bleibt das Sync-Artefakt.
- **Chat und Modellwahl aus dem Kit (Welle 26, 2026-10-24).** Der Chat ist eine dünne Hülle um `buildChatWindow` (Kit 0.67.1), der Kopf von Chat und Smart Apply ist `buildModelBar`. Entscheidungen im Umbau, je mit Grund:
  - **Der Kontext bleibt im System-Prompt, nicht in der letzten Frage.** Der Steckbrief aus settings-assistant setzt ihn in die Frage; vault-rag schickte ihn immer im System und das Lab-Tracing (`promptTemplate` = nur der Preamble, `contextPaths`) hängt an dieser Trennung. Ein Wechsel wäre ein Verhaltenswechsel des Modells ohne Auftrag.
  - **Die Statuszeile „Chat LLM verbunden/offline“ entfällt.** Die Modellzeile zeigt bei einem Endpunkt, der nicht antwortet, ein Warnzeichen mit Text (`aria-label`/`title`: „The endpoint does not answer; the saved model stays selected.“, gemessen mit einem toten Port) und einen Neu-laden-Knopf; der Klick auf die alte Zeile „neu prüfen“ ist darin aufgegangen. Smart Apply behält seine Verbindungszeile (`ping`, `renderConnStatus`): sie ist dort Teil des Cockpits, nicht der Modellwahl.
  - **Smart Apply zeigt die WAHL (`smartApplyModel`), nicht das wirksame Modell.** `modelInUse` des Adapters ist das Feld; leer heißt „folgt dem Chat“ und steht als „Automatisch (<Chat-Modell>)“ da (`source().defaultModel` wird dafür auf das Chat-Modell gesetzt). Das wirksame Modell anzuzeigen hieße, dass „Automatisch“ nie ausgewählt aussähe und die Anzeige nach der Wahl auf einen Modellnamen spränge. Der Speicherort bleibt `smartApplyModel`.
  - **Linkschutz: unverändert gegenüber 0.45.0, keine Ausnahme.** Das Kit-Fenster kappt in Links keine Skript-Schemata; dieselbe Probe gegen den Tag 0.45.0 und gegen den Umbau (Antwort mit Links `javascript:`, `data:`, `file:`, `obsidian:`, `app:`) liefert dieselben Hrefs: `javascript:` und `data:` ohne `href` (das kappt Obsidians Renderer), `file:`, `obsidian:`, `app:` klickbar. Der Smoke-Punkt bleibt rot und trägt „bekannter Befund“ (Kit-Task Welle 27: Linkschutz in Modellantworten); kein Eigenbau.
  - **Fehler des Clients werden abgebildet, nicht übersetzt.** `ChatClient.stream` wirft, das Fenster erwartet ein Ergebnis: `chatSendFailure` ordnet `ChatHttpError`, `ChatTimeoutError`, `ChatNoEndpointError`, `ChatNetworkError` und `AbortError` zu, sonst wirft `send` weiter und das Fenster zeigt die Nachricht. `chatErrorMessage` (eigene Texte je Status) entfiel, weil das Kit-Bündel inhaltsgleich ist (401/403 Schlüssel, 404 Adresse, 429 später, 5xx Server, Serverbegründung angehängt).
  - **Die Modellzeilen laden ihre Liste nach einer Auflösung nur bei einem Endpunktwechsel neu** (`chat-endpunkte.md`): ohne die Bedingung eine Endlosschleife mit einem Manager ohne Endpunkt.
- **`related_notes` unterscheidet bei `not-indexed` die Ursache nur im Werkzeug (Welle 26).** Die Datei wird nur in `RetrievalFacade.notIndexedCause` gelesen, hinter `resolveNotePath` und einer Sperre für Backslash und Steuerzeichen, und nur vom Werkzeugweg (`executeTool`); die öffentliche API (`related()`) liest nie eine Datei und bleibt bei `reason: "not-indexed"`. Preis: die Werkzeug-Antwort verrät, dass eine nicht ausgeschlossene Notiz dieses Pfads im Vault liegt (derselbe Umfang wie `read_note` des MCP-Servers); für alles andere (fehlt, unzulässig, ausgeschlossen) bleibt die allgemeine Antwort.
- **Rolle `search-only` (Welle 26).** Passt kein lokaler Embedding-Endpunkt zum Index-Modell, beantwortet die erste erreichbare Zeile mit Modell weiter jede Suche (der Modell-Guard sperrt nur das Schreiben). Die Liste nennt sie „für Suche genutzt, schreibt nicht“ statt „übersprungen“ (`isSearchOnly` der Embedding-Verbindung, Prädikat aus der letzten Auflösung: `state === "skipped-model"`, lokale Quelle). Ein Manager-Endpunkt behält seinen eigenen Text.

## Abweichungen von der Leitkonvention

Stand: siehe `CHANGELOG.md` / `manifest.json` (dort steht die maßgebliche Version — hier bewusst
keine, damit dieser Block nicht durch Zeitablauf falsch wird). Öffentlich released, Forgejo
kanonisch + GitHub-Mirror. Bewusste, begründete Abweichungen (comply-or-explain):

- **CORE-META-02** — ✅ erledigt (2026-08-23): Badge-Zeile vollständig — Lizenz · Docs · Release
  (Forgejo/gitea) · **CI** · Plattform, in beiden READMEs. Der CI-Badge zeigt auf
  `.github/workflows/ci.yml`, das bei jedem Push auf `main` und jedem PR `npm run gate` fährt.
  *Vorgeschichte, weil sie die Reihenfolge begründet:* bis dahin fehlte der Badge zu Recht — der
  einzige Workflow war tag-getriggert, ein Badge darauf hätte den Zustand des letzten *Releases*
  gemeldet und wie ein grüner Build auf `main` ausgesehen. Erst kam die CI, dann der erste grüne
  Lauf (`32664167655`), dann der Badge — ein Badge, der auf einen nie gelaufenen Workflow zeigt,
  ist schlechter als keiner.
  *(Diese Zeile behauptete bis 2026-08-22, auch der Release-Badge fehle — er steht seit v0.2.0 in beiden
  READMEs. Nachgemessen beim Doku-Audit.)*
- **CORE-META-03** — ✅ erledigt (2026-08-22): **alle acht** Bilder in `docs/images/`, eingebettet in beide
  READMEs über `raw.githubusercontent.com` (PROF-OBS-14), `shots:check` ohne Befund. Die frühere Begründung
  („Screenshots brauchen eine laufende GUI und sind agentenseitig nicht erzeugbar") ist mit `npm run shots`
  gegenstandslos — der Treiber fährt den Vertrag aus `docs/images/README.md` gegen ein laufendes Obsidian.
  Das letzte Bild (`smart-apply.png`) hat drei Anläufe gekostet, und **jeder Fehlschlag sah gleich aus**:
  leeres Panel, kein Fehler. Ursachen waren der Reihe nach ein Fixture-Defekt (s. Gotcha „Eine Vorlage ohne
  erkennbare Überschriften…"), eine zu kurze Wartefrist (der Lauf braucht 560–590 s, gewartet wurden 300)
  und ein zu früher Klick, den die View **still** auf `idle` zurückstellt. Die Rezept-Hälfte davon steht in
  `scripts/shots.ts`, die Erzählung in `docs/images/README.md`.
- **CORE-META-04** — ✅ erledigt (2026-07-28): Diátaxis-Manual unter `docs/` (`tutorial.md` · `how-to/index.md` ·
  `reference/index.md` · `explanation/index.md`), aus der README verlinkt. **Links absolut** (`…/blob/main/…`) —
  der Community-Directory-Renderer löst relative Pfade nicht auf (PROF-OBS-14).
- **CORE-META-06** — ✅ erledigt: `CHANGELOG.md`, `CONTRIBUTING.md` und `SECURITY.md` vorhanden.
- **CORE-META-07** — ✅ **`LICENSING.md` seit 2026-08-22**, `CLA.md` **bewusst nicht**. *Anlass:* README und
  `CONTRIBUTING.md` sagten beide „a commercial dual-license is available on request" — die Zusage stand also
  längst im Repo, nur ohne die Datei, die sie einlöst. *Warum kein CLA:* eine Rechteübertragung zu
  unterschreiben ist eine echte Hürde für einen Drive-by-Fix, und der ist hier mehr wert als eine
  Lizenzoption, nach der noch nie jemand gefragt hat. Inbound bleibt AGPL-3.0-or-later.
  **Die Konsequenz ist in `LICENSING.md` benannt statt verschwiegen:** die Option trägt nur, solange
  *eine* Partei alle Rechte hält (Stand 2026-08-22: alle 681 Commits von Johannes Kaindl). Mit dem ersten
  gemergten Fremdbeitrag ist sie für das Ganze nicht mehr erteilbar — dann heißt es fragen, nachbauen oder
  das Angebot zurückziehen, und die Datei sagt, welches davon.
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
- **PROF-TS-04** — kein `tsconfig.build.json`-Split. *Grund:* **der Zweck des Splits ist hier schon auf
  anderem Weg erfüllt.** Er existiert laut Overlay PROF-OBS-08, damit der von ESLint aufgelöste
  `tsconfig.json` **keinen** obsidian-Mock-`paths`-Alias enthält — sonst entsteht die
  `no-unsafe-*`-Kaskade und im Store-Review ein „Caution". Genau das ist gegeben: der Mock kommt aus
  `vitest.config.ts`, nicht aus tsconfig-`paths`, und gebaut wird mit esbuild ohne `tsc`-Emit. Ein
  `tsconfig.build.json` würde also nichts ausschließen, was schadet — es wäre Form ohne Wirkung.
  (Für `scripts/` existiert bereits ein eigener `tsconfig.scripts.json`; wo ein Split etwas trennt,
  steht er.) *Frühere Begründung „klein genug" war zu schwach — nachgemessen beim Doku-Audit 2026-08-22.*
- **PROF-OBS-01** — ✅ erfüllt: manifest-`id` = `vault-retrieval` (fachlich, ≠ Repo-Slug `vault-rag`).
  Umbenannt 2026-06-22, weil `vault-rag` in der Community-Directory bereits belegt ist (fremdes Plugin von
  vasallo94). Interne Bezeichner (`vault-rag-*`-CSS, `vault-rag-chat`-ViewTypes, `_vaultrag`-Index) bleiben
  bewusst unverändert — unsichtbar, ein Umbenennen wäre nur Risiko.
- **PROF-OBS-02** — ✅ erledigt (2026-08-22): `npm run deploy` in der kanonischen, workspace-weit
  identischen Form (16 Nachbar-Repos fahren sie wortgleich). **Deploy-Target ist pro Vault verschieden,
  und das ist der Grund, warum die Lücke so lange unauffällig blieb.**
  ⚠️ **Hier stand bis 2026-09-02, der Arbeits-Vault `10_Pallas` (so hiess er damals) habe sein Plugin-Verzeichnis als
  „Symlink auf dieses Repo", ein Deploy sei dort „wirkungslos". Das ist gemessen falsch:**
  `.obsidian/plugins/vault-retrieval/` ist ein **echtes Verzeichnis** (`os.path.islink` false für den
  Ordner und für jede Datei darin), es trägt Kopien wie jeder andere Vault. Ein `.hotreload`-Marker
  liegt darin — der lädt das Plugin neu, wenn sich die Datei **im Vault** ändert, er kopiert aber
  nichts aus dem Repo. **Folge: nach jeder `src/`-Änderung ist `npm run deploy` auch für den Arbeits-Vault
  Pflicht; ein blosser Reload misst den alten Build.**
  ⚠️ **Und der Deploy allein reicht auch nicht: der Marker ist in `10_Pallas` WIRKUNGSLOS, weil das
  Community-Plugin „Hot Reload" dort gar nicht installiert ist** (gemessen 2026-09-05: kein
  `plugins/*hot*`-Verzeichnis, kein Eintrag in `community-plugins.json` — die Datei `.hotreload`
  ist nur ein Marker, gelesen wird sie von jenem Plugin). Nach einem `deploy` läuft also weiter
  der alte Build, bis jemand das Plugin explizit neu lädt:
  `await app.plugins.disablePlugin("vault-retrieval"); await app.plugins.enablePlugin("vault-retrieval")`.
  Aufgefallen an einer Messung, die den neuen Build belegen sollte und ihn nicht fand (das
  Stempel-Feld des LiveIndexer fehlte zwei Minuten nach dem Deploy noch). **Wer nach einem Deploy
  misst, ohne neu zu laden, misst den Stand von vorher** — und der Unterschied ist an
  `manifest.version` nicht zu sehen. Aufgefallen am 2026-09-02 beim Vorbereiten
  eines GUI-Smokes — folgenlos nur deshalb, weil `src/` seit dem letzten Deploy unverändert war
  (sha1 des gebauten `main.js` identisch mit dem im Vault).
  **Der GUI-Smoke fängt das seit `5d90449` ab:** `scripts/gui-smoke.ts` ruft `requireEigenerBuild`
  (`tools/obsidian-cdp/vault.ts`) und vergleicht per sha1 — `manifest.version` wäre blind, weil Repo-
  und Vault-Build dieselbe Nummer tragen. Scharf gesehen am 2026-09-02 (32 Bytes an die Vault-`main.js`
  angehängt → Abbruch vor dem ersten Prüfpunkt). *Bis 2026-09-03 behauptete diese Zeile, der Guard fehle.*
  *Jeder Vault trägt eine Kopie und altert still.* Gemessen am
  2026-08-22, als das Script entstand: vier weitere Vaults standen auf 0.24.0, 0.17.3, 0.13.0 und
  **0.7.1** — letzterer achtzehn Versionen zurück, also vor Container-Index (0.18.0),
  Backup-Rotations-Fix (0.15.2) und Index-Robustheit (0.12.0). Wer hier nichts kopiert, lässt genau
  die Releases liegen, die Datenverlust verhindern.
  ```bash
  OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/vault-retrieval" npm run deploy
  ```
- **UI-STANDARD §1 (Ein-Frontend)** — ✅ erfüllt: Sidebar-Hub-Konsolidierung (2026-07) ersetzt die
  vier Einzel-Views (`RelatedNotesView`/`SearchView`/`ChatView`/`SmartApplyView`) durch **einen**
  `VaultRetrievalView` (`VIEW_TYPE_HUB="vault-retrieval-hub"`) mit Tab-Leiste; die vier Panels
  (`view.ts`/`search_view.ts`/`chat_view.ts`/`smart_apply_view.ts`) implementieren nur noch das
  `HubPanel`-Interface (`hub_panel.ts`), sind keine `ItemView`s mehr. **Begründete Abweichung vom
  vault-crews-Pilot:** der Hub rendert **nicht** render-from-scratch pro Tab, sondern hält alle
  Panels dauerhaft gemountet (`display:none` beim Tab-Wechsel), weil Chat (SSE-Stream) und Smart
  Apply (Zustandsmaschine + Stream) zustandsreich sind und ein Neuaufbau laufende Streams/State
  verwürfe.
