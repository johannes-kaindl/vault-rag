# GUI-Smoke — Durchlauf-Protokoll

Der Treiber ist `scripts/gui-smoke.ts` (`npm run smoke:gui`); was er prüft und warum, steht
in seinem Kopf-Kommentar. Hier stehen nur die **gefahrenen Läufe** — CORE-TEST-02 (b) verlangt
den festgehaltenen Lauf als Nachweis, und ohne Baseline ist ein grüner Lauf nach einem Umbau
nicht von „anders grün" zu unterscheiden.

## Voraussetzung

```bash
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222
npm run smoke:gui -- --port 9222 --vault 10_Pallas
```

Läuft Obsidian bereits mit offenem Port, aber ohne den Ziel-Vault: `open "obsidian://open?vault=10_Pallas"`
öffnet ihn als **zusätzliches Fenster derselben Instanz** — der Port bleibt, und parallel geöffnete
Vaults (andere Sessions) verlieren ihr Fenster nicht.

`10_Pallas` braucht keinen Deploy: dessen Plugin-Ordner ist ein Symlink aufs Repo, `npm run build`
genügt. Jeder andere Vault trägt eine Kopie und braucht `npm run deploy`.

## Läufe

| Datum | Version / Commit | Obsidian | Ergebnis | Gegenprobe |
|---|---|---|---|---|
| 2026-08-23 | llm-lab-Pruefpunkte (5 neue) | 1.13.7 | **25/25** | **ja** — `trace` aus `chat_session.ts` entfernt, gebaut, Plugin neu geladen: genau die zwei Chat-Punkte fielen rot, die uebrigen blieben gruen |
| 2026-08-23 | `a4d0130` (Branch `fix/backlog-kleinfixes`, vor Merge) | 1.13.7 | **20/20** (derselbe Punkt übersprungen) | Parität zum Lauf davor — der Treiber ist unverändert, geändert hat sich nur der Prüfling |
| 2026-08-23 | `0d49ab0` (vor Merge 0.26.0) | 1.13.7 | **20/20** (1 Punkt übersprungen: kein Embedding-Endpunkt mit Modell-Override konfiguriert) | keine — Treiber unverändert seit dem Lauf, der ihn eingeführt hat |
| 2026-08-18 | Migration auf die zentrale CDP-Brücke | 1.13.7 | 18/18 | — |

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
