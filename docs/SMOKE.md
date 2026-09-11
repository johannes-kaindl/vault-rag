# GUI-Smoke — Durchlauf-Protokoll

Der Treiber ist `scripts/gui-smoke.ts` (`npm run smoke:gui`); was er prüft und warum, steht
in seinem Kopf-Kommentar. Hier stehen nur die **gefahrenen Läufe** — CORE-TEST-02 (b) verlangt
den festgehaltenen Lauf als Nachweis, und ohne Baseline ist ein grüner Lauf nach einem Umbau
nicht von „anders grün" zu unterscheiden.

## Voraussetzung

⚠️ **Erst prüfen, ob schon eine Instanz läuft — nicht blind quitten.** Obsidian ist
Single-Instance: ein `quit` beendet die Fenster *aller* Sessions. Am 2026-08-30 hätte genau
diese Anweisung beinahe zwei Stunden Reindex einer parallel arbeitenden Session vernichtet —
der eigene Lauf wäre danach sauber grün gewesen, der Schaden entstand woanders.

```bash
curl -s http://127.0.0.1:9222/json/version >/dev/null && echo "laeuft schon — MITNUTZEN"
```

**Läuft schon eins: mitnutzen** (der Smoke braucht keinen Neustart). Ein eigenes Vault-Fenster
öffnet man per `vault-open` über IPC; gewählt wird über den Vault-Filter von
`attachTo("workspace", port, "<vault>")`, nicht über die Fenster-Reihenfolge.

**Läuft keins** — oder nur nach Absprache mit dem, der es benutzt:

```bash
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222
```

Dann der Lauf:

```bash
npm run smoke:gui -- --port 9222 --vault 10_Pallas
```

Läuft Obsidian bereits mit offenem Port, aber ohne den Ziel-Vault: `open "obsidian://open?vault=10_Pallas"`
öffnet ihn als **zusätzliches Fenster derselben Instanz** — der Port bleibt, und parallel geöffnete
Vaults (andere Sessions) verlieren ihr Fenster nicht.

⚠️ **Jeder Vault trägt eine Kopie und braucht `npm run deploy` — auch `10_Pallas`.** Hier stand bis
2026-09-03, dessen Plugin-Ordner sei ein Symlink aufs Repo; gemessen ist er ein echtes Verzeichnis
(`7adf475`). Ohne Deploy misst der Lauf den alten Build — der Herkunfts-Guard `requireEigenerBuild`
bricht dann ab, statt eine falsche Bilanz zu liefern.

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
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label vault-rag --intent "GUI-Smoke Zweitinstanz" --exclusive quit-reload --ttl 900
npm run build && npm run shots -- --setup            # Vault aus dem Fixture — der Index ist danach weg
UD=/tmp/obs-vault-rag; mkdir -p "$UD"
cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/   # sonst startet die gebündelte 1.12.4
# WARNUNG: liegen MEHRERE .asar im Profil, ist unbestimmt welche laeuft — fuer einen belegbaren
# Lauf alle ausser der gewuenschten entfernen. Stand 2026-09-04 liegt dort 1.14.0, nicht 1.13.7.
# $UD/obsidian.json: {"vaults":{"<id>":{"path":"$STAGING_VAULTS_DIR/vault-rag","ts":0,"open":true}}}
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9333 &
# WARNUNG: ein frisch gebauter Vault startet im RESTRICTED MODE. Das Plugin steht dann in
# `enabledPlugins` UND in `manifests`, ist aber NICHT in `app.plugins.plugins` — `--prepare`
# scheitert mit "Cannot read properties of undefined (reading 'settings')", was wie ein
# Plugin-Defekt aussieht. Einmal ueber CDP freischalten (gemessen 2026-09-04):
#   await app.plugins.setEnable(true); await app.plugins.enablePlugin("vault-retrieval");
npm run shots -- --port 9333 --prepare               # Index bauen (18 Notizen, Sekunden)
npm run smoke:gui -- --port 9333 --vault vault-rag
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

`quit-reload` statt `focus`: der Lauf fasst die reguläre Instanz nicht an, aber ein fremdes
`pkill -f Obsidian` träfe auch die Zweitinstanz. Der Guard gatet den Kommandotext, der Lock bleibt
also die Eintrittskarte — auch für Port 9333.

## Läufe

| Datum | Version / Commit | Obsidian | Ergebnis | Gegenprobe |
|---|---|---|---|---|
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
