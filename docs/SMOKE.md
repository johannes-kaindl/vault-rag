# GUI-Smoke — Durchlauf-Protokoll

Der Treiber ist `scripts/gui-smoke.ts` (`npm run smoke:gui`); was er prüft und warum, steht
in seinem Kopf-Kommentar. Hier stehen nur die **gefahrenen Läufe** — CORE-TEST-02 (b) verlangt
den festgehaltenen Lauf als Nachweis, und ohne Baseline ist ein grüner Lauf nach einem Umbau
nicht von „anders grün" zu unterscheiden.

## Voraussetzung

Der Lauf gehört in eine **Zweitinstanz** mit eigenem Profil und eigenem Port auf dem **Staging-Vault** `vault-rag`; die reguläre Instanz (9222) wird weder genutzt noch beendet. Der Port ist Pflicht (`--port`, Rezept-Wert 9399), der Treiber hat keinen Default und bricht ohne ihn mit Exit 2 ab. Das vollständige Rezept steht im Kopf von `scripts/gui-smoke.ts` und weiter unten. Gegen den Arbeits-Vault `10_Pallas` ist der Lauf nicht vorgesehen: dort sind die Punkte des llm-lab-Zweigs und der zweiten Endpunkt-Zeile strukturell nicht messbar und zählen als „nichts gemessen“.

Jeder Vault trägt eine Kopie des Plugins und braucht `npm run deploy` (gemessen 2026-09-03: der Plugin-Ordner ist kein Symlink aufs Repo, `7adf475`). Ohne Deploy bricht der Herkunfts-Guard `requireEigenerBuild` ab, statt eine falsche Bilanz zu liefern.

Die Bilanz zählt in vier Zuständen (grün · rot · übersprungen · nichts gemessen) gegen die Soll-Liste `PUNKTE`. Was im Staging-Vault nicht herstellbar ist (zweite Endpunkt-Zeile, Embedding-Endpunkt, Probe-Notiz, ein echtes llm-lab oder ein echter Endpoint Manager im Vault), ist „nichts gemessen“ und setzt wie Rot Exit 1. „Übersprungen“ kommt in diesem Treiber nicht vor. Abbruch ist Exit 2.

## Stub-Lage und `--only` (seit Welle 20)

Der volle Lauf schickt keine Anfrage an die Fixture-Endpunkte (Ollama `:11434`, LM Studio `:1234`): Die jeweils erste Zeile beider Listen zeigt auf den zentralen LLM-Stub (`tools/obsidian-cdp/llm-stub.ts`, Anfrage-Vektor ist der gespeicherte Vektor einer indexierten Notiz, die Chat-Zeile 1 trägt einen Schlüssel für das Icon), die zweite Zeile bleibt der tote Fixture-Port. Die Fixture-Listen schreibt das `finally` ganz zuletzt zurück, sonst überschreiben die mitten im Lauf gesicherten Listen (Heal, Reihenfolge) sie mit Stub-Adressen. „Nichts gemessen“ bleiben nur `search()` und die Selbstfindung (Rang 0 braucht das echte Embedding-Modell). Der Index im Staging-Vault entsteht weiterhin nur mit echtem Embedding-Endpunkt (`shots --prepare`).

`--only w15,w16` fährt allein die Schlüsselbund-Sektionen (eigene Stub-Instanzen, Soll = ihre elf Punkte, Exit 0 bei grün). Die Stream-Punkte (Folge-Regel, Kontrolle mit token- und absatzgroßen Stücken, Denkblock live) stehen in Sektion 7j; gültig sind sie nur bei Überlauf ≥ 80 px und laufendem Strom, sonst „nichts gemessen“.

## Der Smoke braucht einen erreichbaren Embedding-Endpunkt

⚠️ **Läuft der lokale Ollama nicht, sieht der Lauf aus wie ein kaputter Index** (gemessen 2026-10-11, Welle 17): `shots --prepare` baut keinen Index, `status()` meldet `indexed=false`, und ein Dutzend Prüfpunkte (Kontext, Integrator, `related()`, `search()`) werden rot mit „no-index“ oder „Index NICHT geladen“ — kein Befund am Plugin. Vor dem Lauf: `curl -s localhost:11434/v1/embeddings -H 'content-type: application/json' -d '{"model":"qwen3-embedding:8b","input":["x"]}'` muss einen Vektor liefern. Auf dem M5 liegen die Modelle unter `~/Models/ollama`, nicht im Standardpfad: ein Start ohne `OLLAMA_MODELS=$HOME/Models/ollama ollama serve` meldet leere Modelle. Den Dienst, den man selbst gestartet hat, beendet man nach dem Lauf wieder.

## Staging-Vault frisch aus dem Fixture, mit dem Index-Schnappschuss (seit Welle 22)

`npm run fresh-vault -- --port 9420` baut den Vault aus dem Fixture (wie `shots -- --setup`) und setzt den Index aus einem **Schnappschuss** wieder ein, statt ihn neu zu embedden (`buildVault` löscht `_vaultrag/index.bin`, und ein neuer Index braucht das echte Modell). Der Aufbau bricht ab, wenn auf dem Port noch eine Instanz lauscht (sie hält den Vault offen).

- **Ort:** `$STAGING_VAULTS_DIR/_snapshots/vault-rag/` (`index.bin`, `meta.json`), außerhalb des Repos, nicht getrackt.
- **Gültig,** solange Fixture-Fingerprint (Pfade + Inhalt von `docs/images/fixture/notes`) und Modell zum Fixture passen. Ändert sich eine Notiz, meldet `--status` „ungültig“ und der Aufbau läuft ohne Index (die Index-Punkte sind dann „nichts gemessen“, nie falsch grün).
- **Erneuert** wird er von Hand nach einem guten Lauf mit dem echten Modell: `npm run shots -- --prepare`, dann `npm run fresh-vault -- --snapshot` (prüft Container-CRC, dass jeder Pfad eine Fixture-Notiz ist und das Modell stimmt).
- ⚠️ **Jeder Smoke mit Stub-Lage schreibt Stub-Vektoren in den Index des Vaults** (der Drain nach einer Notiz-Änderung): gemessen in der Modell-Runde 2026-10-14, ein aus einem solchen Vault gezogener Schnappschuss ließ drei Notizen mit dem identischen Score 0,73 antworten. Darum zieht `--snapshot` nur mit `--echtes-modell`, und nur nach einem Voll-Reindex gegen das echte Modell (`npm run modell-runde -- --port <p> --chat-model <id> --embedding-model <id> --neu-indizieren`, Modell-IDs ausdrücklich, kein JIT-Laden). Der Schnappschuss vom 2026-10-14 20:35 stammt aus einem solchen Lauf (Selbstfindung 6/6 auf Rang 0, drei Suchanfragen mit sinnvollen Treffern). Und: ein Vault nach einem Stub-Lauf ist für den nächsten Lauf kein Ausgangspunkt, sondern wird mit `fresh-vault` neu gebaut.
- **Belegt 2026-10-14:** `--status` ohne Schnappschuss „ungültig“, nach `--snapshot` „gültig“, mit einer um ein Leerzeichen geänderten Fixture-Notiz wieder „ungültig“ (zurückgeschrieben); frisch gebauter Vault + Schnappschuss-Index: Smoke 99 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 102), identisch zum Lauf davor.

## Staging-Vault auf einer Zweitinstanz — der Normalweg seit 2026-09-03

Im Arbeitsvault `10_Pallas` sind Prüfpunkte **strukturell** nicht messbar: dort ist ein echtes
llm-lab installiert (der Meldestrecken-Zweig wird übersprungen, damit der Smoke dessen
Aufzeichnung nicht verunreinigt), und die Endpunkt-Listen tragen je **eine** Zeile. Am 2026-09-02
liefen deshalb 25 von 40 Punkten, und die Bilanz „23/25 grün" verschwieg das. Der Staging-Vault
`vault-rag` hat beides nicht: Fixture `docs/images/fixture/` (Notizen + `.obsidian/`) und
`docs/images/fixture/plugin/settings.json` (je **zwei** Endpunkt-Zeilen, die zweite auf einem Port
ohne Listener, damit „nicht erreichbar" echt gemessen wird).

Weil ein zweiter Lauf in derselben Obsidian-Sitzung nicht sauber ist (Target-Leichen, s.
Kopfkommentar des Treibers) und die reguläre Instanz fremden Sessions gehört, läuft der Smoke auf
einer **Zweitinstanz mit eigenem Profil** (Dach-AGENTS.md § Staging-Vaults):

```bash
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label vault-rag --intent "GUI-Smoke :9399" --exclusive focus --port 9399 --ttl 900
npm run build && npm run shots -- --setup            # Vault aus dem Fixture — der Index ist danach weg
UD=/tmp/obs-test-vault-rag; mkdir -p "$UD"
cp ~/Library/Application\ Support/obsidian/obsidian-<version>.asar "$UD"/   # genau eine .asar, sonst ist unbestimmt, welche läuft
node -e 'const p=process.env.STAGING_VAULTS_DIR+"/vault-rag";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{v:{path:p,ts:Date.now(),open:true}},language:"en"}))' "$UD"
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9399 &
npm run shots -- --port 9399 --prepare               # Index bauen (18 Notizen, Sekunden)
npm run smoke:gui -- --port 9399
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

Ein frischer Vault startet im Restricted Mode (das Plugin steht in `enabledPlugins` und `manifests`, aber nicht in `app.plugins.plugins`; `--prepare` scheitert dann mit „Cannot read properties of undefined (reading 'settings')“, was wie ein Plugin-Defekt aussieht). Den Vertrauensdialog und den Restricted Mode hebt `bereiteInstanzVor` im Smoke-Treiber auf, nur im Staging-Vault; für `--prepare` auf einem ganz frischen Profil einmal den Smoke starten oder die Zeile `await app.plugins.setEnable(true); await app.plugins.enablePlugin("vault-retrieval");` über CDP absetzen. Der Lock gilt je Port; ein fremdes `pkill -f Obsidian` träfe auch die Zweitinstanz, deshalb `--exclusive focus`.

## Läufe

| Datum | Version / Commit | Obsidian | Ergebnis | Gegenprobe |
|---|---|---|---|---|
| 2026-10-25 | Arbeitsbaum nach Welle 27 V2 (Reload-Wächter `index_reload.ts`, `pending.json` nach dem Drain neu geschrieben, Meldungen mit Pfaden; Pin obsidian-kit 0.67.1; code-kit 0.36.0 im ersten Lauf, danach auf 0.37.2 gehoben und ein zweiter Lauf mit gleicher Bilanz 123 · 1 · 1 · 3 (von 128, 210 s)), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9562, frischer Prozess, Vault aus dem Fixture mit Schnappschuss-Index (ohne `--prepare`, kein Modell geladen), Brücke `f837064` | 1.14.5 (Fenstertitel) | Baseline vor dem Umbau **119 grün · 1 rot · 1 übersprungen · 2 nichts gemessen (von 123, 167 s)**; danach **123 grün · 1 rot · 1 übersprungen · 3 nichts gemessen (von 128, 206 s)**: das eine Rot ist unverändert der Linkschutz-Punkt. Neu: vier grüne Punkte (Reload nach eigenem Drain-Persist 0, Reload während des laufenden Drains 0, fremde Änderung von `index.bin` genau 1, `pending.json` nach dem Drain `[]`) und ein „nichts gemessen“ (Zwischenstände von `reindexAll`: das Fixture hat 20 Notizen, `CHECKPOINT_EVERY` ist 250). Der Punkt „während ein Drain läuft“ sieht den Lauf bei nur drei bis vier Aufrufen von `maybeReload`, ein enges Fenster. **Danach V4 (Stempel-Lücke in der Index-Zustand-Zeile): 126 grün · 1 rot · 1 übersprungen · 3 nichts gemessen (von 131, 211 s)**, drei neue Punkte: Nullfall (alle Stempel echt, Zeile ohne Satz), Positivfall (drei Stempel im Staging-Index auf `[0, 0]` gesetzt, Zeile „3 of 20 notes have no change mark“) und Live-Änderung (nach dem Drain einer dieser Notizen 2, ohne Neuladen). ⚠️ Der Aufbau-Zustand (Schnappschuss mit 20 echten Stempeln) ist an dieser Stelle des Laufs nicht mehr da: im ersten Anlauf zeigte der Nullfall 18 von 20 Zeilen auf `[0, 0]`, weil das Neusäen des LiveIndexer die Stempel verliert (Task „Stempel gehen verloren …“); der Treiber stellt darum die Ausgangslage selbst her (Stempel aus den Dateien) und setzt die Original-Bytes danach zurück. **Danach V5 (Modellzeile im Umformatier-Tab): 127 grün · 1 rot · 1 übersprungen · 3 nichts gemessen (von 132, 221 s)**, ein neuer Punkt: der Wechsel in der Umformatier-Zeile ändert `chatModelInUse` und das Chat-Dropdown, „Automatisch“ stellt es zurück (der erste Anlauf war rot, weil der Chat-Abschnitt davor „fake-model-2“ gewählt hatte: der Punkt stellt seine Ausgangslage jetzt selbst her). **Danach der Stempel-Fix (code-kit 0.37.3, Neusäen mit `stampsSnapshot`): 128 grün · 1 rot · 1 übersprungen · 3 nichts gemessen (von 133, 225 s)**, ein neuer Punkt: nach `resolveAndReconnectEmbedder` und dem Drain einer Notiz stehen auf der Platte 0 von 20 Zeilen auf `[0,0]`. **Mutation:** der alte Aufruf `init(this.index)` wiederhergestellt, gebaut, ein Lauf: der Punkt rot mit „19 von 20 Zeilen auf [0,0]“ (127 · 2 rot · 1 · 3), danach zurückgenommen. **Danach der Pin obsidian-kit 0.70.0 / code-kit 0.37.5 allein: 129 grün · 0 rot · 1 übersprungen · 3 nichts gemessen (von 133, 226 s)**: der Linkschutz-Punkt, bisher rot, ist von selbst grün (6 Links, keiner klickbar; Standard des Kits: Linkschutz aus). **Danach V6 (Behelfe des Chat-Fensters auf `running()`, `onRunChange`, Abmelde-Rückgabe) und der Linkschutz-Nachzug: 130 grün · 0 rot · 1 übersprungen · 3 nichts gemessen (von 134, 225 s)**, ein neuer Punkt: die Einstellungsgruppe „Links and images in answers“ (zwei Zeilen, beide aus, ein Klick schreibt die Einstellung und zurück). Brücke weiter `7467bd0`. **Schleifenschutz nachgeprüft (Teillauf `--only w15,w16`):** mit dem Wächter in `applyChatResolution` 11 von 11 in 19 s, ohne ihn (`refreshModelBars({ models: true })` bei jeder Auflösung) 11 von 11 in 20 s: mit obsidian-kit 0.70.0 hängt der Teillauf ohne den Wächter nicht mehr | **ja** — das Nachziehen in `runIndexOp` und das `flush()` entfernt, gebaut, ein Lauf: genau drei Punkte rot (120 · 4 rot · 1 · 3, die drei Reload- und Warteschlangen-Punkte, die Gegenprobe „fremde Änderung“ blieb grün), danach zurückgenommen |
| 2026-10-24 | Arbeitsbaum nach Welle 26 (Pin obsidian-kit 0.67.1 / code-kit 0.36.0, Chat-Fenster und Modellzeile aus dem Kit im Chat, Modellzeile in Smart Apply, Rolle `search-only`), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9545, frischer Prozess, Vault aus dem Fixture mit Schnappschuss-Index (ohne `--prepare`, kein Modell geladen) | 1.14.5 (Fenstertitel) | Baseline vor dem Umbau **109 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 112)**; danach **119 grün · 1 rot · 1 übersprungen · 2 nichts gemessen (von 123)**: das eine Rot ist der Linkschutz-Punkt, ein **bekannter Befund** (Kit-Task Welle 27; dieselbe Probe gegen den Tag 0.45.0 liefert dieselben Hrefs: `javascript:` und `data:` ohne `href`, `file:`, `obsidian:`, `app:` klickbar). Neu: zehn Punkte (Markdown im Lauf, Auto-Kontext über das `input`-Ereignis, Quellen-Chip, Linkschutz, Modellzeile Chat mit Sperre, Modellzeile Smart Apply, Sperre Smart Apply, Escape, Eingabe oben/unten) plus der Punkt zur Rolle `search-only` | **ja, dreifach** — (a) `isSearchOnly`, `disabled` der Chat-Zeile, `disabled` der Smart-Apply-Zeile und die Quellen-Chips (`afterAnswer`) zugleich abgeklemmt: genau die zwei Rollen-Punkte, die Chat-Sperre, „Quellen-Chip öffnet die Notiz“ und die Smart-Apply-Sperre rot (114/6/1/2, dazu der bekannte Linkschutz); (b) Schleifen-Guard in `applyChatResolution` entfernt: der Teillauf `--only w15,w16` hängt an „Schlüsselbund (Embedding) mit installiertem Manager“ bis zum Abbruch (10 grün, 1 nichts gemessen); mit dem Guard 11/11; (c) Pflichtpunkt-Gegenprobe `art: "wachsen"` am neuen Fenster: 4 von 5 Elementen unerreichbar. ⚠️ Zwei Treiber-Fallen: die Modellzeile steht zweimal im Dokument (Chat und Smart Apply), `messeErreichbarkeit` mit dem bloßen Selektor traf die versteckte und war ohne Befund rot; und die Fensterwurzel trägt `okit-chat` und `vault-rag-chat` am selben Knoten (`.vault-rag-chat .okit-chat` findet sie nicht). Ein Integrator-Punkt („Zweiter Klick auf Annehmen …“) war in einem von vier Läufen nach dem Umbau rot und in den anderen und in der Baseline grün (kein Änderungsbezug, ungeklärt) |
| 2026-10-23 | Arbeitsbaum nach Welle 25 (Teil A: Brücken-Bausteine `gegenprobeErreichbarkeit` mit `art: "wachsen"`, `messeDenkblockKopierbar`/`zeichneDenkblock`, `schliesseEinstellungen`, code-kit 0.34.0 mit `markdown-table`; Teil B: obsidian-kit 0.66.1, Denkblock nach dem Strom über `buildReasoningBlock`), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9553, frischer Prozess, Vault aus dem Fixture mit Schnappschuss-Index | 1.14.5 (Fenstertitel; die Baseline-Version ist nicht gemessen, aber das Plugin lud trotz `minAppVersion` 1.12.7 über der gebündelten 1.12.4, also lief die kopierte `.asar`) | Baseline vor dem Umbau **108 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 111)**; nach Teil A **109 / 0 / 1 / 2 (von 112)**; nach Teil B **109 / 0 / 1 / 2 (von 112)** — neu: Gegenprobe zum Kopier-Knopf (vorher ein Punkt, jetzt zwei: `kopie` und `gegen`); die Pflichtpunkte sind durch die Bausteine ersetzt, nicht erweitert | **ja** — Kopier-Knopf im Kit-Bereich abgeklemmt (`syncCopyButton` kehrt früh zurück): zuerst **107 / 0 / 1 / 4**, beide Kopier-Punkte „nichts gemessen“ (der Baustein wertete einen fehlenden Knopf als ungültige Messung); danach setzt der Treiber `erwartetKnopf: true` (Dach `fb176d6`), und dieselbe Mutante gibt **107 / 1 rot / 1 / 3**: „Denkblock lässt sich kopieren“ rot, die Gegenprobe nicht gemessen. Sauberer Lauf mit der Option: 109 / 0 / 1 / 2. ⚠️ Der Denkblock im Chat hängt für den Gemma-Punkt jetzt an `.vault-rag-chat-messages .okit-stream-reasoning`; im Lauf grün |
| 2026-10-18 | Arbeitsbaum nach Welle 24 Teil B (Pin obsidian-kit 0.63.0 / code-kit 0.31.0, `rel-path` für `resolveNotePath`, `thinkingOffTexts`, frisches `STREAM_AREA_CSS`/`REQUEST_SECTION_CSS`, code-kit `probe-core`), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9522, frischer Prozess, Vault aus dem Fixture mit Schnappschuss-Index | 1.14.4 | Baseline vor dem Umbau **102 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 105)**; danach **108 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 111)** — neu: Denkblock kopierbar (Smart Apply), Pflichtpunkte am Chat-Tab (Fokus-Erhalt im laufenden Strom, Erreichbarkeit bei natürlicher und kurzer Höhe, je mit Gegenprobe) | **ja** — Kopier-Knopf im Kit-Bereich abgeklemmt (`syncCopyButton` kehrt früh zurück): genau der Kopier-Punkt rot („kein Kopier-Knopf am Denkblock“). Die Erreichbarkeits-Gegenprobe des Bausteins (Rollbalken nehmen) blieb im Chat grün-leer, weil die Bedienelemente neben dem Rollbereich liegen; sie ist durch „Nachrichtenbereich wächst statt zu rollen“ ersetzt (3 von 4 Elementen unerreichbar). ⚠️ Die erste Fassung maß mit einer schmalen Seitenleiste (Panel außerhalb des Fensters, alle Elemente „unerreichbar“): der Punkt stellt die Breite jetzt selbst her |
| 2026-10-16 | Arbeitsbaum nach Welle 23 (Pin obsidian-kit 0.61.0 / code-kit 0.28.0, Heil-Regel `decideHealWrite`, Index-Modell im Manager-Weg, Gemma-4-Punkt im Chat), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9522, frischer Prozess, Vault aus dem Fixture mit Schnappschuss-Index | 1.14.4 | Baseline vor dem Umbau **99 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 102)**; danach **102 grün · 0 rot · 1 übersprungen · 2 nichts gemessen (von 105)** — neu: Gemma 4 ohne Öffner (Chat, mitten im Strom gemessen), Heil-Regel 8b, Index-Modell im Manager-Weg | **ja** — Gemma: `onContentReset` in `chat_session.ts` abgeklemmt: Punkt rot (Anzeige „Ich wäge erst die QuDie fertige“); Heil-Regel: `!verdict.write` abgeschaltet: 8b rot (Index geladen). ⚠️ `fresh-vault` baut nicht: die ersten drei Mutationsläufe liefen auf dem alten Build und blieben grün |
| 2026-10-09 | Arbeitsbaum nach Welle 15 (Chat-Verbindung über Kit `createLlmConnection`, obsidian-kit 0.51.3 / code-kit 0.15.4; sechs neue Prüfpunkte: Schlüsselbund, zwei Neustarts, Bearer, Schwärzung, Bild-URL, `onResolved`), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9378, frischer Prozess, Vault aus dem Fixture | 1.14.4 | Baseline vor dem Umbau **62 grün · 1 rot · 0 übersprungen · 1 nichts gemessen** (rot: Kontext-Chips, Embedding-Endpunkt zu langsam — Umgebung); danach **69/69 grün · 1 nichts gemessen** (Smart-Apply-Body, Fixture ohne bedienbare Vorlage) | **ja** — `onResolved`-Aufruf auskommentiert: genau der neue Punkt rot (0× gerufen), 68/69 |
| 2026-09-11 | Arbeitsbaum nach 0.32.0 (Gegenproben-Task: `is-disabled` am Anwenden-Knopf sichtbar machen, Smart Apply im Fixture an, neuer Prüfpunkt 7d), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9333 | 1.14.0 | **44/44 grün · 0 übersprungen** (43 + 7d). Mit Smart Apply im Fixture zählt der Hub jetzt sechs Tabs; der Integrator-Punkt misst die Liste, nicht die Zahl, und blieb grün | **ja** — CSS-Regel entfernt, Plugin per disable/enable neu geladen: `opacity 0.7 · pointer-events auto` → die `pointer-events`-Hälfte des Punkts wäre rot. ⚠️ Der erste Anlauf der Gegenprobe war ungültig: `enablePlugin` auf ein aktives Plugin ist ein No-op, die alte CSS lief weiter und die Probe sah grün aus |
| 2026-09-07 | Branch `feat/integrator` (Integrator Stufe 1: Verlinkung mit Review-Inbox — sechs neue Prüfpunkte 7c), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9333 | 1.14.0 | **43/43 grün · 0 übersprungen** (37 bisherige + 6 neue; ein bisheriger Punkt umbenannt: „Fläche ist auf status/search/related begrenzt" → „…/proposeLinks/applyLink begrenzt", weil die API zwei Flächen dazubekommt). Lauf 1 war 42/43 — rot war **der Treiber**: „Tab ist der sechste Tab" hatte die Sechs hart verdrahtet, im Fixture ist Smart Apply aus, also fünf Tabs; jetzt Tab-Liste gegen Panel-Liste. Lauf 2 43/43, Lauf 3 Gegenprobe, Lauf 4 43/43 mit identischer Prüfpunktmenge (Namen gediffed) | **ja** — Idempotenz-Guard in `appendSectionLink` temporär entfernt (Lauf 3): **42/43**, genau „Zweites Anwenden … byte-identisch" rot („changed=true · Bytes VERSCHIEDEN"), kein anderer Punkt fiel mit |
| 2026-09-07 | Branch `feat/kit-buendel` (Kit-Bündel: Vendor code-kit 0.5.0 / obsidian-kit 0.31.0, Modell je Endpunkt, Smart-Apply-Vorrang), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9333 | 1.14.0 | Baseline vor dem Umbau **35/35 grün · 1 übersprungen**; nach dem Umbau **36/36 grün · 0 übersprungen** — Prüfpunktmenge bis auf einen Namen identisch: „Rolle folgt dem Modell-Override" (dauerhaft übersprungen, weil die Leer-Option des Dropdowns entfallen ist) wurde zu „Rolle folgt dem Zeilen-Modell" und läuft jetzt. Dazwischen ein Abnahme-Befund, den kein Prüfpunkt sah: die Alt-Schlüssel `embeddingModel`/`chatModel` blieben in `data.json` (der Kit-Merge kopiert unbekannte Schlüssel), die Migration lief bei jedem Start erneut — gefunden per CDP-Probe auf `Object.keys(p.settings)`, behoben, jetzt Prüfpunkt | **ja** — E1 am laufenden Plugin: `smartApplyModelInUse` folgt dem Feature-Feld, `chatModelInUse` der Zeile (CDP-Probe, Wert gesetzt und zurückgesetzt) |
| 2026-09-04 | `5551f4b` (Stempel-Waechter + Reindex-Race-Fix), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9333 | **1.14.0** | **34/34 gruen · 1 uebersprungen** (Modell-Override, wie immer). Erster Lauf war 33/34 — der Umbruch-Punkt rot mit „560px (ist 300px) · 240px (ist 300px)“: zweimal dieselbe Breite, also eine Mutation, die nie ankam. Ursache im TREIBER, nicht im Plugin — `pollUntil` kehrt beim ersten truthy Wert zurueck, und `TAB_ROWS` lieferte immer ein Objekt, der Poll mass also den Zustand vor `setSize`. Mit Breiten-Guard gruen (`8c44c1b`). | **ja, zweifach** — (a) isoliert nachgemessen: 560px zu 1 Zeile, 240px zu 2 Zeilen, das Plugin war also durchgehend korrekt; (b) der neue Waechter am laufenden System: vor einer Aenderung **0** verdaechtige Notizen, nach einem `vault.append` auf EINE Notiz **genau diese eine** |
| 2026-09-03 | Arbeitsbaum nach `679a9f5` (Skip-Liste, Fixture mit zwei Endpunkt-Zeilen, Modal-Prüfpunkt), Staging-Vault `vault-rag` auf **Zweitinstanz** Port 9333 | 1.13.7 | **34/34 grün · 1 übersprungen** (Modell-Override — kein Endpunkt mit Override im Fixture). Erstmals liefen **alle** Lab- und Endpunkt-Punkte; `679a9f5` damit inhaltlich belegt (Vorschau nach dem Verwerfen aus dem DOM). Achter und letzter Lauf des Tages mit Warmup über `chatEndpointInUse` und `suppressThinking` im Fixture: Warmup HTTP 200 nach 3 s, erster Token nach **2,9 s** (vorher 55–110 s) | **ja** — Verwerfen-Klick im Treiber ausgesetzt: **33/34**, genau der neue Modal-Punkt rot („Vorschau steht noch"), kein anderer fiel mit |
| 2026-08-30 | `1df2cd1` (deployt), Staging-Vault `vault-rag` | — | **25/30** — zwei rot sind die bekannte Ein-Endpunkt-Fixture-Luecke, drei rot sind ein Sprachbefund des Treibers (s. u.) | — |
| 2026-08-24 | `f3c7f71` (Lab-Stub auf `apiVersion 2`), Staging-Vault `vault-rag` | 1.13.7 | **20/22** — alle fuenf Lab-Pruefpunkte gruen; die zwei roten sind Deckungsluecken der Umgebung (nur je EIN Endpunkt konfiguriert), keine Defekte | — Treiber unveraendert seit `f3c7f71`; der Fix selbst ist die Gegenprobe: mit `apiVersion 1` waeren genau diese fuenf Punkte rot, drei davon erst nach je 180 s Timeout |
| 2026-08-23 | llm-lab-Pruefpunkte (5 neue) | 1.13.7 | **25/25** | **ja** — `trace` aus `chat_session.ts` entfernt, gebaut, Plugin neu geladen: genau die zwei Chat-Punkte fielen rot, die uebrigen blieben gruen |
| 2026-08-23 | `a4d0130` (Branch `fix/backlog-kleinfixes`, vor Merge) | 1.13.7 | **20/20** (derselbe Punkt übersprungen) | Parität zum Lauf davor — der Treiber ist unverändert, geändert hat sich nur der Prüfling |
| 2026-08-23 | `0d49ab0` (vor Merge 0.26.0) | 1.13.7 | **20/20** (1 Punkt übersprungen: kein Embedding-Endpunkt mit Modell-Override konfiguriert) | keine — Treiber unverändert seit dem Lauf, der ihn eingeführt hat |
| 2026-08-18 | Migration auf die zentrale CDP-Brücke | 1.13.7 | 18/18 | — |

### 2026-10-25 — Start-Lage der frischen Instanz und der Integrator-Punkt (Welle 27, V1)

Zehn frische volle Läufe auf dem unveränderten Stand `e683fb7` (0.46.0), je ein frischer Prozess und ein frischer Vault über `fresh-vault`, Port 9562, Obsidian 1.14.5. **Der Integrator-Punkt „Zweiter Klick auf Annehmen“ war in 0 von 10 Läufen rot**; jeder Lauf endete mit 119 grün · 1 rot (Linkschutz) · 1 übersprungen · 2 nichts gemessen (von 123) in 152 bis 175 s (ohne Aufbau, 175 bis 460 s mit Aufbau, Start und Warten auf den Lock). Mit den vier Läufen der Welle 26 ist es 1 von 14; die Ursache des einen Rots ist ungeklärt (Task geschlossen).

Die Start-Lage der frischen Instanz, gemessen mit einem Sampler alle 3 s auf `pending.json` und `index.bin` (neun Läufe): `pending.json` trägt 3 s nach dem Start die 20 Fixture-Pfade (die Notizen sind jünger als die Stempel des Schnappschusses, der Stale-Wächter des ersten `loadIndex` merkt sie vor), der Start-Drain schreibt `index.bin` 36 bis 40 s nach dem Start, und `pending.json` fiel erst 43 bis 58 s nach diesem Persist auf 0 (vor dem Fix für `pending.json`: die Datei wurde nach dem Drain nicht neu geschrieben, erst das nächste Vormerken schrieb sie). Jeder Messpunkt, der an `loadIndex`, `pending.json`, Stempel oder `index.bin` hängt, wartet darum zuerst, bis die Warteschlange leer und kein Lauf aktiv ist (Poll mit `null`, Abschnitt 7k des Treibers).

### 2026-09-11 — Zwei Gegenproben am laufenden Obsidian (Task vom 2026-08-23)

Beide Punkte per CDP auf der Zweitinstanz gemessen, Skript im Session-Scratchpad, Ergebnis hier.

1. **Einstellungen auf und zu lässt `data.json` unberührt.** mtime vor Öffnen, nach Öffnen des
   Plugin-Tabs (2,5 s), nach Schließen: dreimal `06:51:06.829` — kein Write. Gegenprobe zur
   Gegenprobe: den Regler „Kontext-Budget" per `input`/`change` von 12.000 auf 13.000 bewegt →
   mtime springt (`06:55:22` → `06:56:12`), Rücksetzen schreibt erneut. Der Regler ist im DOM nicht
   über `max=32000` zu finden — das Maximum ist modellabhängig (hier 1.049.000); gefunden über den
   `setting-item-name`. ✅ `297c5c2` hält.
2. **Der gesperrte „Auf aktive Notiz anwenden"-Knopf las sich NICHT als gesperrt.** Klasse
   `is-disabled` stand (Unit-Test pinnt sie), Computed Style aber `opacity 1 · cursor default ·
   pointer-events auto · derselbe Hintergrund` — der Screenshot zeigte gesperrt und aktiv identisch,
   während „Transformativ" daneben (eigene Regel) korrekt gedimmt war. **Obsidians Theme kennt
   `.is-disabled` auf `<button>` nicht.** Fix: `aria-disabled` am Run- und Stop-Knopf (Obsidians
   eigene CSS dimmt darauf schon auf 0.7) plus eigene Regel wie bei den Modus-Knöpfen (0.5,
   `not-allowed`, `pointer-events: none`). Form + Cursor, nicht Farbe. Prüfpunkt 7d misst den
   Computed Style, nicht die Klasse — eine Klasse ohne Regel ist eine Zusage ohne Wirkung.
3. Der dritte Punkt (denkendes Modell, `reasoning-consumed-budget`) war am 2026-09-06 erledigt.

### 2026-09-07 — Integrator: sechs Prüfpunkte, ein Treiber-Befund, eine Gegenprobe

Anlass: Slice D (Integrator Stufe 1, Spec im Cockpit `_SDD/2026-09-07-integrator-linking-design.md`).
Der Abschnitt 7c misst die **Verdrahtung** — die reinen Hälften (`link_writer`, `integrator_store`,
`integrator`) sind unit-getestet, ob `acceptLink` den richtigen Schreiber wählt und der Store
gespeichert wird, sieht nur der Lauf. Zwei neue Fixture-Notizen (`Integrator plain.md` ohne
Frontmatter, `Integrator related.md` mit `related: []`), Fixture-Einstellungen mit
`integratorEnabled` und `integratorFolders: ["Notes/"]`.

Vier Läufe, jeder mit Neustart der Zweitinstanz (Target-Leichen, s. Kopfkommentar):

1. **42/43 — Treiber-Befund, kein Prüfling.** „Tab ist der sechste Tab" hatte die Sechs aus der Spec
   übernommen; im Fixture ist Smart Apply aus, der Hub trägt fünf Tabs, der Integrator stand korrekt
   an vierter Stelle vor „Umformatieren". Ein Prüfpunkt, der eine Konstante behauptet, die von einer
   anderen Einstellung abhängt (CORE-TEST-22). Jetzt: Tab-Liste gegen Panel-Liste des Hubs, plus
   Position vor `reformat`.
2. **43/43.** Alle sechs Integrator-Punkte grün: Vorschlag über `proposeFor` (5 Ziele), Annehmen per
   Klick auf den Knopf der Karte „Integrator plain" schreibt `## Verwandte Notizen` + Wikilink
   (+74 Bytes), zweites Anwenden byte-identisch (`changed=false`), abgelehntes Ziel fehlt nach der
   Neuberechnung, Frontmatter-Modus macht aus `related: []` eine Blockliste mit einem Eintrag bei
   byte-identischem Rest.
3. **Gegenprobe (CORE-TEST-13): 42/43.** Idempotenz-Guard in `appendSectionLink` entfernt, gebaut,
   deployt — genau der Punkt „Zweites Anwenden … byte-identisch" rot, kein anderer fiel mit. Der
   Punkt kann fehlschlagen, misst also etwas.
4. **43/43** mit wiederhergestelltem Guard, Prüfpunktmenge gegen Lauf 2 gediffed: identisch.

Aufräumen im `finally`: beide Fixture-Notizen werden byteweise zurückgeschrieben und aus der Inbox
entfernt. **Der Rückschreib-Vorgang trifft den automatischen Auslöser** (Notizen liegen unter
`Notes/`), drei Sekunden später stehen die Vorschläge wieder in `integrator.json` — erwartet und
harmlos, das Ablehnungs-Gedächtnis bleibt leer. Ein zweiter Lauf ohne `--setup` findet dieselbe Lage.

Nicht gemessen und bewusst offen: die Sortierung „aktive Notiz zuerst" wird nur indirekt geprüft
(der erste Accept-Knopf gehört zur Karte „Integrator plain", nachdem sie geöffnet wurde); der
Doppelklick-Schutz ist unit-getestet, nicht am laufenden Obsidian.

### 2026-09-03 — Staging-Vault auf der Zweitinstanz: sechs Läufe bis zum grünen, fünf Treiber-Befunde

Anlass: die Task „17 von 40 Prüfpunkten sind in Pallas tot". Die Zahl 17 war falsch gezählt (grep über
`record(` samt Definition und Kommentaren) — der llm-lab-Zweig trägt **fünf** Punkte, mit dem neuen
Modal-Punkt sechs, dazu die zwei Endpunkt-Punkte: **acht** strukturell nicht messbare Punkte, nicht 17.
Der Befund selbst stand: alle acht liefen in Pallas nie, und die Bilanz schwieg.

Was die Läufe gegen den frisch gebauten Vault gefunden haben — **alles Treiber, nichts Prüfling**:

1. **Selbstfindungs-Probe sprengt `Cdp.send`.** Sechs `search()`-Aufrufe in EINEM `evaluate`; unter
   Last (neun fremde Verbindungen an Ollama) dauert einer 5–8 s, die 30-s-Grenze fiel mit
   „Zeitüberschreitung: Runtime.evaluate". Umbau: im Renderer starten, auf der Node-Seite pollen
   (Dach-Muster „Mutation und Wartephase trennen"). In Pallas war das Modell warm — die Zeitbombe
   lag unter der Schwelle und sah wie ein funktionierender Prüfpunkt aus.
2. **Sprachquelle.** Der Treiber las `localStorage.language` (leer auf einem frischen Profil → „en"),
   das Plugin nimmt `getLanguage()` → `document.documentElement.lang` („de"). Drei falsch-rote
   Punkte. Zweiter Sprachbefund am Prüfstand nach dem vom 30.08., gleiche Wurzel, andere Quelle.
3. **Kollabierte Sidebar.** `rightSplit.setSize()` wirkt nicht, solange die Sidebar eingeklappt ist
   (frisches Profil): Hub 24 px breit, beide Breiten „2 Zeilen", Punkt rot ohne Befund. Jetzt wird
   vorher ausgeklappt, nachher zurückgeklappt, und die **gemessene** Breite steht im Detail.
4. **Kalter Chat-Endpunkt.** LM Studio lädt das 27B-Modell erst beim ersten Request und entlädt es
   nach Leerlauf; der erste Chat-Punkt lief in die 180-s-Frist, der zweite kam in Sekunden. Ladezeit
   ist Umgebung — deshalb ein Warmup vor dem Punkt, mit Dauer im Protokoll. Drei Anläufe: aus dem
   Renderer scheitert `fetch` am CORS-Preflight; auf der Node-Seite traf er den **umsortierten**
   Endpunkt (der Klick-Prüfpunkt hat den toten 1235 an Platz 1 gesetzt, zurückgeschrieben wird erst im
   `finally`) → ECONNREFUSED. Jetzt über `chatEndpointInUse`, den Endpunkt, den das Plugin wirklich
   benutzt. **Und der Warmup allein reichte nicht:** bei warmem Modell brauchte derselbe Prompt per
   `curl` **218 s** — 1.191 Reasoning-Tokens für das Wort „Hallo". Die 180-s-Frist war also nicht
   knapp, sondern falsch bemessen. Zwei Maßnahmen: das Fixture setzt `suppressThinking` (der Smoke
   misst die Meldestrecke, nicht das Denken), und die Frist ist 360 s für den Fall, dass ein Modell
   trotzdem denkt. Die rote Zeile nennt seitdem den gemessenen Widerspruch („Warmup sagte HTTP 200,
   keine Ergebniszeile in 360 s") statt der geratenen Ursache „Endpunkt erreichbar?".
5. **`\/` in einem Template-String wird zu `/`** — aus `/\/+$/` wurde `//+$/`, ein Zeilenkommentar,
   der Rest der Zeile fiel weg, der Renderer warf „Uncaught" ohne Text. Zeichenklasse `[/]` statt Escape.

Dazu die zwei Bilanz-Fehler, die die Task nannte: „nur eine Endpunkt-Zeile — nicht prüfbar" zählte
als ✗ (jetzt `skipped()`), der Lab-Skip verbarg fünf Punkte hinter einem Gedankenstrich (jetzt einer
je Punkt, mit Grund). Ein Skip ohne Grund wäre von einem vergessenen Prüfpunkt nicht zu unterscheiden.

**Warum Zweitinstanz statt eigenes Fenster in der regulären:** der Treiber-Kopf verlangt vor jedem
erneuten Lauf einen Neustart (Target-Leichen); sechs Läufe hätten sechs Neustarts auf vier fremde
Vault-Fenster bedeutet. Die Zweitinstanz wurde sechsmal neu gestartet, `lsof` auf 9222 zeigte die
reguläre Instanz jedes Mal unverändert. `pkill -f "user-data-dir=/tmp/obs-vault-rag"` trifft nur sie —
ein ungefiltertes `pkill -f Obsidian` träfe beide.

### 2026-08-30 — Sprachbefund: der Treiber prueft hart gegen deutsche Zustandstexte

`npm run smoke:gui -- --vault vault-rag` gegen `1df2cd1` (deployt). **25/30 gruen.** Fuenf rote
Punkte, zwei davon sind der bekannte, dokumentierte Deckungsluecken-Fund dieser Fixture (nur je
EIN Endpunkt konfiguriert — „Zeile 2 traegt den Prioritaets-Knopf", „Klick setzt die Zeile an
die Spitze"), **kein Rueckschritt.**

**Die anderen drei sind neu und ein Treiber-/Umgebungs-Befund, keine Produktregression:**
„Embedding: genau eine Zeile als aktiv markiert" (0 von 1), „Chat: genau eine Zeile als aktiv
markiert" (0 von 1) und „Alle Zustandstexte sind bekannte Formulierungen" (`"active",
"active"`) schlagen fehl, weil `scripts/gui-smoke.ts` die Zustandstexte hart gegen deutsche
Literale prueft (`aktiv`, `nicht erreichbar`, `pruefe…`, …), die Obsidian-Instanz in diesem
Lauf aber mit Oberflaeche **en** lief (`localStorage.getItem("language") === "en"`,
`moment.locale() === "en"` — gemessen per CDP direkt am Fenster) und deshalb „active" statt
„aktiv" rendert. Dieselbe Instanz zeigte auch fuer den Vault `llm-lab` „Oberflaeche en" —
die Sprache ist eine Eigenschaft des **laufenden Obsidian-Prozesses**, nicht des einzelnen
Vaults, und acht Vault-Fenster liefen zum Zeitpunkt dieses Laufs gleichzeitig in derselben
Instanz (mehrere parallele Sessions). Die Sprache selbst zu korrigieren wurde bewusst
unterlassen, um laufende Messungen anderer Sessions am selben Port nicht zu stoeren. Betroffen
ist ausschliesslich das Rendering der Endpunkt-Zustandszeile hier im eigenen UI-Code
(`i18n`-Text) plus die Haertung dieses Treibers gegen Nicht-Deutsch. Mit deutscher Oberflaeche
waeren nach dieser Diagnose 27/30 zu erwarten (die zwei Endpunkt-Luecken bleiben bestehen).
Diagnose gemessen und dokumentiert in `llm-lab/docs/SMOKE.md` (derselbe Lauf, aus Sicht des
Anbieters); der Treiber-Fix selbst ist noch offen.

### 2026-08-24 — der `apiVersion`-2-Bump, erstmals gegen ein laufendes Obsidian

Der Fix `f3c7f71` (Lab-Stub von `apiVersion: 1` auf `2`) war bis dahin **nie gefahren** — die
Umgebung dafuer fehlte. Jetzt hergestellt: Staging-Vault `~/StagingVaults/vault-rag`, dort ist
`vault-retrieval` deployt und **kein echtes llm-lab installiert**, also greift genau der
Stub-Pfad, den der Bump anfasst. Ergebnis: alle fuenf Lab-Punkte gruen (`chat` mit
`ttftMs`/`latencyMs`, `settings-probe` unter eigenem `feature`, `reformat:to-list`, und der
Fall ohne Lab).

**Zwei Punkte blieben rot und sind es zu Recht:** „Zeile 2 traegt den Prioritaets-Knopf" und
„Klick setzt die Zeile an die Spitze" melden selbst, dass sie **nicht pruefbar** sind — der
Staging-Vault hat je nur einen Embedding- und einen Chat-Endpunkt. Der Versuch, einen zweiten
per `data.json` nachzulegen, scheitert erwartbar: Obsidian haelt die Datei im Speicher und
schreibt sie beim naechsten `saveData` zurueck: **eine Plugin-Einstellung an einem laufenden
Obsidian aendert man ueber die Oberflaeche oder gar nicht.** Beide Punkte sind eine
Deckungsluecke der Umgebung, kein Defekt und nicht Gegenstand des Bumps.

### 2026-08-23 — llm-lab-Meldestrecke (fünf Prüfpunkte)

Die Abnahme der llm-lab-Anbindung lief bis dahin **einmalig von Hand**; die Skripte lagen im
Session-Scratchpad und sind weg. Jetzt getrackt (CORE-TEST-02 b), im vorhandenen Treiber als
Abschnitt 7b.

**Bauart — der Treiber hängt ein Lab-Stub ein, statt ein echtes llm-lab zu verlangen.** Das ist
das Spiegelbild von `llm-lab/scripts/gui-smoke.ts`, wo der Treiber den *Konsumenten* spielt, um
den Anbieter zu prüfen. Unsere Zusage lautet „wir rufen `readLabApi(app)?.log(...)` mit diesen
Feldern" — die prüft ein Stub vollständig, ohne den Lauf an eine fremde Installation zu binden.
Ob das Lab die Zeile speichert, filtert oder verwirft, ist dessen Zusage und dessen Smoke.
Ist ein **echtes** Lab installiert, hängt der Treiber nichts ein und überspringt: er darf eine
echte Aufzeichnung nicht mit Testzeilen verunreinigen.

Was gemessen wird: ein Chat **über die Oberfläche** (Eingabefeld → Senden), die Endpunkt-Probe,
ein Reformat-Transform über den echten Panel-Knopf, und der Fall ohne Lab.

**Der Punkt zu Abschnitt 2 ist bewusst anders geschnitten als in der TaskNote.** Dort stand
„`settings-probe` läuft und schreibt **nicht**". Das Nicht-Schreiben ist aber llm-labs
Ausschlussliste, nicht unsere Verdrahtung — hier geprüft wird, dass die Probe unter einem
**eigenen** `feature` ankommt. Ohne das kann sie dort niemand ausschließen.

**Drei Fallen, die der Bau aufgedeckt hat** (alle sahen aus wie Verdrahtungsfehler, keine war einer):
- `require("obsidian")` existiert im CDP-Renderer-Kontext nicht (`Cannot find module 'obsidian'`) —
  der Editor kommt über `app.workspace.activeEditor.editor`.
- Der **letzte** Knopf im Reformat-Panel ist der Freitext-Knopf, und der kehrt bei leerer
  Anweisung bewusst sofort zurück. Der Prüfpunkt meldete „Transform lief nicht" und las sich wie
  ein fehlender `trace`. Gewählt wird jetzt gezielt der erste Knopf der **zweiten** Gruppe.
- Ein Backtick in einem Kommentar **innerhalb** des Renderer-Template-Strings beendet diesen
  mitten im Code (`TS1005`).

Gegenprobe gefahren (die Zeile in der Tabelle): ohne `trace` in `chat_session.ts` fallen genau
die zwei Chat-Punkte, die übrigen bleiben grün.

### 2026-08-23 — Backlog-Durchgang (sechs Korrekturen)

Gefahren als Regressionsschutz, nicht als Abnahme: von den sechs Änderungen betritt **keine** einen
Prüfpunkt (der Treiber prüft Plugin-API, Endpunkt-Zeilen und Auto-Heal; Smart Apply und der
Budget-Slider kommen darin nicht vor). Der Lauf beantwortet also „nichts kaputt gemacht", nicht
„die Fixes wirken" — die Fixes selbst tragen Unit-Tests.

**Zwei Punkte bleiben danach ausdrücklich offen**, weil nur ein Mensch am laufenden Obsidian sie
beantworten kann: ob das Öffnen und Schließen der Einstellungen `data.json` unberührt lässt
(Zeitstempel-Vergleich), und ob der gesperrte „Auf aktive Notiz anwenden"-Knopf sich in der
Oberfläche auch als gesperrt liest.

### 2026-08-23 — Abnahme der llm-lab-Anbindung

Der Lauf enthält den Prüfpunkt, der `index.bin` **absichtlich beschädigt**: die Auto-Heal-Kaskade
holte den Index aus dem geräte-lokalen Backup zurück (6432 Notizen vorher wie nachher), Endpunkt-
Reihenfolge und Index-Datei wurden im `finally` wiederhergestellt.

**Was der Smoke bei dieser Änderung strukturell nicht zeigen konnte:** die neue Meldestrecke sitzt
in `ChatClient.stream`, und kein Prüfpunkt betritt sie. Deshalb zusätzlich einmalig gemessen (nicht
getrackt, weil ein echter Modell-Aufruf weder schnell noch deterministisch ist): ein Chat-Turn in
einem Vault **ohne** llm-lab — Antwort nach 25,6 s, Reasoning-Stream sauber, keine Fehlerbox.

**Falle, die dabei auffiel:** Der Sende-Knopf (`Senden` ↔ `Stop`) ist als Ende-Signal untauglich —
er durchläuft im selben Turn mehrere Übergänge, und ein Messskript, das darauf wartet, meldet zu
früh „fertig" und liest null Antworten. Verlässlich ist die Ergebnis-Zeile `✓ Antwort in N s`:
der Zustand, den nur ein fertiges Ergebnis herstellt. (`_docs/LESSONS.md`, 2026-08-23, n=2)
