---
paths:
  - "scripts/**"
  - "docs/SMOKE.md"
  - "docs/images/**"
---

# GUI-Smoke und Messen — Gotchas

Gotchas zu Treiber, Staging-Vault und dem Beleg, dass ein neuer Build läuft (`scripts/`, `docs/SMOKE.md`).

- **`plugin.manifest.version` ist nach einem `disablePlugin`/`enablePlugin` VERALTET — sie taugt
  nicht als Beleg, dass der neue Build läuft.** Obsidian hält die Manifeste in
  `app.plugins.manifests` und liest sie beim Wieder-Einschalten nicht von der Platte neu; das
  `plugin.manifest`-Objekt bleibt das vom Programmstart. Gemessen 2026-09-06 nach dem Deploy von
  0.30.0 in zwei Fenster: `manifest.json` auf der Platte trug `0.30.0`, `plugin.manifest.version`
  meldete weiter `0.29.1` — **während der neue Code nachweislich lief.** Der Beleg war ein
  Feature, das es in der alten Version nicht gab: `status().reindexing` (erst seit `0cc800e`,
  im Tag `0.29.1` kein einziges Vorkommen). **Wer prüfen will, ob ein Reload gegriffen hat,
  fragt nach einer Fähigkeit, nicht nach einer Nummer** — eine Version ist eine Behauptung des
  Manifests, ein Feld im Rückgabewert ist der laufende Code. Ergänzt den Grund unter PROF-OBS-02
  („`manifest.version` wäre blind, weil Repo- und Vault-Build dieselbe Nummer tragen") um den
  umgekehrten Fall: sie ist auch dann blind, wenn die Nummern verschieden sind.

- **Der Staging-Vault ist zu klein, um irgendetwas an einer GRUPPENGRENZE zu belegen.** Seine 18
  Notizen ergeben zusammen weniger als `EMBED_BATCH` = 32 Chunks, passen also in **eine** einzige
  Embedding-Anfrage. Ein Verhalten, das erst zwischen zwei Gruppen greift (der Reindex-Abbruch;
  jeder künftige Zwischenschritt in `reindexAll`), kommt dort nie zum Zug — und die Messung sieht
  aus wie ein Ergebnis, statt sich als ungültig zu melden. Gemessen 2026-09-05: der erste
  Abbruch-Beleg meldete „Vault indiziert: 18 Notizen" und konnte „griff nicht" nicht von „hatte
  keine Gelegenheit" unterscheiden. Wer so etwas belegt, legt vorher genug Wegwerf-Notizen an
  (150 reichten) und räumt sie danach weg — der Vault ist Wegwerfware, aber sein Fixture ist
  getrackt. Dieselbe Wurzel wie CORE-TEST-22: eine Messung braucht eine Definition davon, wann
  sie gültig ist.

- **Der Smoke lässt NACH der Stub-Lage nichts mehr an einen echten Endpunkt gehen** (gemessen 2026-10-14, 21:31): Zeile 1 der Fixture-Listen zeigt nach dem Zurückstellen auf Ollama; ein Rest in der Pending-Queue oder ein Debounce-Timer einer Notiz-Änderung hätte dort das Embedding-Modell geladen. Deshalb setzt der Treiber VOR dem Zurückstellen die Pause, leert Queue und Timer (`STUB_LAGE_SCHUTZ`), und die Stub-Lage hebt sie beim nächsten Lauf erst NACH dem Umschalten auf den Stub auf. Beleg: der Punkt „Stub-Lage-Hygiene“ mit einem zweiten Stub als „echtem“ Endpunkt, Gegenprobe ohne Aufräumen zählt dort eine Anfrage.

- **Drei Fallen im GUI-Smoke-Treiber, alle in Welle 14 gemessen** (`scripts/gui-smoke.ts`): **(1) Ein Pop-out aus einem abgebrochenen Lauf (Punkt 7f) steht als `floating` in der persistierten `workspace.json` und wird beim nächsten Start zum Ziel von `attachTo`** — sein `document` trägt den Hub nicht, `.okit-hub-root` fehlt, fünf Punkte werden rot, obwohl das Plugin fehlerfrei ist (Hub-Mount-Task, Commit `cb16cec`; der Treiber schließt verwaiste Pop-outs jetzt vor dem Anhängen, und die Brücke bevorzugt das Hauptfenster). **(2) Die Panel-Knöpfe des Umformatieren-Tabs sperrt das `disabled`-Attribut, nicht die Klasse `is-disabled`** — eine Klassenprüfung lässt gesperrte Knöpfe durch, der Klick läuft still ins Leere. **(3) Das Panel zieht einen per API gesetzten Editor-Bereich nur über das entprellte `selectionchange` nach** — wer eine Auswahl per `setSelection` herstellt und danach klickt, ruft `p.reformatPanel.refresh()` selbst (sonst ist der Knopf noch gesperrt). Dazu: `getLeaf(false)` nach dem Schließen eines Fensters kann ein Blatt aus diesem Fenster liefern und `openFile` hängt — die Probe-Notizen öffnen in einem neuen Tab (`getLeaf("tab")`). Die Wurzel dahinter steht als Cockpit-Task: der Treiber baut den Staging-Vault nie aus dem Fixture (`buildVault`), Zustand aus abgebrochenen Läufen überlebt.

- **`npm run fresh-vault` baut das Plugin NICHT** (`buildVault` kopiert den vorhandenen Stand): vor einer Mutationsprobe oder nach jeder Quelländerung erst `npm run build`, sonst läuft der alte Build und die Probe bleibt grün (gemessen Welle 23, die Gemma-Mutation blieb dreimal grün).

- **Einen Stream-Fehler im Anzeigetext sieht nur, wer MITTEN im Strom liest.** Am Ende setzt das Kit-Chat-Fenster den Antworttext aus dem Ergebnis neu; ein fehlendes `onContentReset` (Gemma 4 ohne Öffner) fiele dort nicht mehr auf. Der Smoke-Punkt „Gemma 4 ohne Öffner“ liest deshalb bei gedrosseltem Stub-Takt, solange die Antwort noch läuft; der Denkblock ist ein Geschwister des Antwortkörpers (`.okit-stream-body`), kein Kind (Kit `buildStreamArea`).

- **Der Name des Arbeits-Vaults ist kein Fixpunkt, und ein hartverdrahteter Pfad in einer Prüfung schaltet sie still ab.** Am 2026-09-06 hieß der Vault zwischen 13:20 und 13:57 `Pallas` und danach wieder `10_Pallas`; `tests/smartapply_templates.vault.test.ts` übersprang in dem Fenster seine 31 Tests bei grünem Gate. Dort steht deshalb eine Kandidatenliste, und `--vault` bleibt ein Parameter. Der Plugin-Ordner des Arbeits-Vaults ist ein echtes Verzeichnis mit Kopien, kein Symlink (siehe `npm run deploy`).

- **Das Chat-Fenster trägt zwei Klassen an EINEM Knoten, und die Modellzeile steht zweimal im Dokument (seit Welle 26).** Die Wurzel ist `.okit-chat.vault-rag-chat` (`cls` des Fensters): `.vault-rag-chat .okit-chat` findet sie nicht, `.okit-chat.vault-rag-chat` schon. Chat und Smart Apply haben je ein `.okit-model-bar-select`, das des versteckten Tabs hat keine Fläche: wer die Modellzeile misst (auch `messeErreichbarkeit`), schränkt auf `.vault-rag-chat .okit-model-bar-select` bzw. `.vault-rag-sa-root …` ein, sonst wird der Punkt rot ohne Befund am Plugin. „Fertig“ steht in der Zustandszeile des Fensters (`.okit-chat-status` = `statusDone` der Sprache), nicht mehr im Arbeitstext. Beleg: Welle 26, Lauf vom 2026-10-24.

