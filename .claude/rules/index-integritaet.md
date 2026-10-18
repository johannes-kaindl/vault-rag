---
paths:
  - "src/index.ts"
  - "src/index_store.ts"
  - "src/index_backup.ts"
  - "src/index_delta.ts"
  - "src/vendor/kit/index-*.ts"
  - "src/vendor/kit/vector-index.ts"
  - "src/vendor/kit/live-indexer.ts"
  - "src/vendor/kit/crc32.ts"
  - "tests/index*.ts"
  - "tests/live_indexer*.ts"
---

# Index-Integrität — Gotchas

Gotchas zu Index-Format, `persist`, Modell-Bindung und Prüfsumme (`src/index*.ts`, vendorte Index-Module).

- **`parseIndex`** validiert `count == paths` **und** `notes.i8.byteLength == count × dim`
  (Byte-Guard). Ein abgeschnittener `notes.i8` (partieller Sync-Download) wirft laut → `loadIndex`
  erkennt das als Gefahrenzustand (Schreibschutz, keine Live-Persists) statt still zu clobbern
  oder NaN-Vektoren zu produzieren. Der Guard gilt für Plugin **und** MCP-Server gleichermaßen
  (beide nutzen `IndexLoader`/`parseIndex`) — seit 0.18.0 aber nur noch für die byte-level
  Legacy-Migration in `index_store.ts`; der reguläre Load-Pfad ist der Container (`index-container`),
  dessen CRC32 dieselbe Rolle übernimmt: eine CRC-Mismatch beim Load ist der Gefahrenzustand-Trigger,
  nicht mehr der Byte-Guard.

- **`persist` ist gegen Clobber/Shrink geguarded und schreibt seit 0.18.0 EINE Datei:**
  `LiveIndexer.persist(reason)` kodiert den kompletten Container (`index-container` →
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
  Index-Backups liegen unter `<plugin-dir>/index-backups/` (synct **nicht**, rotiert nach GFS (Kit `rotation`, höchstens 23) —
  `index_backup.ts`), Snapshot bei jedem erfolgreichen Load + vor riskanten Operationen.

- **`writeBinary` kürzt die Zieldatei auf 0, bevor es schreibt — und `rename` kann das NICHT heilen.**
  Beides an Obsidian 1.13.7 gemessen (Implementierung aus dem laufenden Renderer gelesen, nicht aus
  `obsidian.d.ts` geschlossen): `writeBinary` ist `this.queue(() => this.fsPromises.writeFile(...))`,
  Node öffnet mit `O_TRUNC` — ein Abbruch dazwischen hinterlässt eine 0-Byte-Datei, der alte Inhalt
  ist weg (so beobachtet 2026-08-14 an `index.bin`). Der naheliegende Ausweg „daneben schreiben,
  per `rename` einhängen" **funktioniert hier aber nicht**: `adapter.rename` wirft
  `Destination file already exists!`, weil Obsidian diese Prüfung selbst vor `fsPromises.rename`
  setzt (POSIX `rename(2)` darunter könnte es); `copy` hat dieselbe Sperre. Ein `writeBinaryAtomic`
  nach diesem Muster fällt deshalb bei **jedem** Aufruf in seinen Fallback zurück, schreibt also
  weiter kürzend — und ein `catch`, der den `rename`-Fehler verwirft, macht genau das unsichtbar
  (dieselbe Fehlerklasse wie bei den 1309 leeren Backup-Ordnern, s. `rmdir`-Gotcha).
  **Diese Fassung stand vom 2026-08-15 bis 2026-08-18 als Fix im Repo und war ein No-op**, der
  zusätzlich 1,4 MB Temp-Datei pro `persist` durch den gesyncten Ordner schob; sie ist
  zurückgezogen. Wer es erneut angeht: TaskNote „Index-Datei atomar ersetzen — der zweite Anlauf"
  (drei Wege, jeder mit Preis). **Bis dahin ist der 0-Byte-Fall offen — aufgefangen wird er von der
  Auto-Heal-Kaskade** (Load ⇒ `corrupt` ⇒ Backup-Übernahme), nicht verhindert.

- **Ein Embedding-Index ist an sein Modell gebunden — der Modell-Guard schützt das doppelt
  (vorbeugend + durchsetzend), weil ein fremdes Modell strukturell unauffällige, aber falsche
  Vektoren erzeugt:** Notiz-Count, Dimension und CRC bleiben in Ordnung, nur die
  Ähnlichkeitssuche wird still schlechter — und nur ein vollständiger Neuaufbau (`reason="reindex"`)
  heilt es. **Vorbeugend:** `resolveAndReconnectEmbedder` überspringt jeden Endpunkt-Kandidaten,
  dessen Modell nicht zu `this.index.manifest.embedding_model` passt
  (`embeddingModelMatchesIndex`, `index-guard`) — auch in der Rückfall-Verdrahtung, die sonst
  einen erreichbaren, aber falschen Kandidaten aktiv geschaltet hätte; nur wenn **kein** Kandidat
  passt, gewinnt trotzdem der erste (bewusster Modellwechsel), mit Notice.
  **Durchsetzend:** `LiveIndexer.persist("live"|"heal")` liest bei **jedem** Aufruf das Modell
  frisch vom Container auf der Platte (nie den In-Memory-Stand — ein zuvor geblockter Persist kann
  die Prüfung also nicht vergiften) und blockt bei Abweichung mit
  `PersistBlockedError("model-mismatch")` (`assertModelSafeToPersist`, `index-guard`).
  Die Auto-Heal-Kaskade prüft ihn **nur noch vor `restore-and-reindex`** — dem einzigen Zweig, der
  fremde Vektoren einmischt; `restore-only` schreibt ausschließlich Backup-Vektoren und stempelt sie
  mit dem Modell des Backups, dort erzeugte der Guard nur eine Sackgasse auf genau dem Gerät, das er
  retten sollte. `healVault` fragt zusätzlich **vorab** per `LiveIndexer.checkModelAgainstDisk("heal")`, bevor es
  überhaupt embedded — sonst bliebe additiv geschriebenes Fremdmodell-Material im In-Memory-Index
  hängen, obwohl der anschließende Persist geblockt worden wäre (das Residuum, das Fix-Runde 4
  schloss). Einziger Ausweg für einen bewussten Modellwechsel: **„Vault neu indizieren"**
  (Voll-Ersatz, vom Guard nie geprüft). Gilt **nur** für Embedding-Endpunkte — für Chat-Endpunkte
  hängt kein Index am Modell, ein Wechsel dort ist folgenlos.

- **Eine Prüfsumme beglaubigt Konsistenz, nicht Richtigkeit — ein CRC-grüner Index kann
  systematisch falsch zugeordnet sein.** Am 2026-08-30 im Arbeits-Vault gemessen: die
  Vektormatrix gehörte zu einer **älteren, kürzeren Pfadliste**. Jeder seither hinzugekommene
  Pfad schiebt alle folgenden Zeilen um eins, der Versatz wuchs treppenförmig von 4 auf 29 —
  ~79 % der Notizen lieferten damit die Ähnlichkeit einer fremden Notiz. **Kein bestehender
  Wächter konnte das sehen:** CRC32 deckt Header+Payload gemeinsam ab und beglaubigt den
  Fehlstand mit, `count == len(paths)` stimmt, der Byte-Guard stimmt, `status()` meldet
  `indexed: true` — und die Scores sahen mit 0.85–0.92 *vertrauenswürdiger* aus, statt
  aufzufallen (gemessen über `api.related()`, Notiz-gegen-Notiz).
  ⚠️ **Hier stand bis 2026-09-04 „…als bei einem gesunden Index (Median dort ~0.4)". Diese
  Vergleichszahl ist ersatzlos gestrichen: sie hatte im ganzen Workspace keine Quelle** — keine
  Messung, keine Stichprobe, kein Aufrufweg, nur diesen Satz. Sie ist trotzdem gewandert: die
  koda-agent-Session übernahm sie am 2026-09-03 als Erwartungswert, maß dagegen und deutete das
  Ergebnis — bis auffiel, dass unklar war, ob die 0.4 aus `search()` (Query-gegen-Notiz) oder
  `related()` (Notiz-gegen-Notiz) stammte. Zwischen beiden ist sie nicht vergleichbar, die
  Deutung war damit gegenstandslos und kostete einen Lauf. **Merksatz von dort: ein Score ohne
  dokumentierten Aufrufweg ist keine Skala.**
  **Was stattdessen trägt, ist der RANG:** „findet sich eine Notiz über ihren eigenen Wortlaut
  auf Rang 0?" hat den Sollwert 0 — unabhängig von Modell, Aufrufweg und Notizklasse. Genau so
  misst `scripts/index-probe.ts`, und der Selbstfindungs-Prüfpunkt im GUI-Smoke ebenso. Wer hier
  eine neue Zahl notiert, schreibt den Aufrufweg dazu **oder** notiert einen Rang.
  Die Trennung war scharf: jede seit Ende Juli angefasste
  Notiz war korrekt (13/15), keine ältere (0/55) — Live-Updates heilen punktuell, weil sie unter
  dem richtigen Key neu schreiben.
  **Zeitlich fällt das mit der Container-Migration (0.18.0) zusammen:** die byte-level Übernahme
  des Prä-0.18-Tripels kann ein durch das damalige Sync-Race auseinandergelaufenes Paar
  (`paths.json` neuer als `notes.i8`) übernommen und im Container zementiert haben. Der heutige
  Schreibpfad ist an allen Stellen korrekt (`persist` sortiert `paths` und füllt Zeile `r` aus
  `paths[r]`, `reindexAll` ist sequenziell, `init`/`vectorFor` gehen über dieselbe `rowMap`) —
  **es ist kein aktiver Bug, sondern ein eingefrorener Altschaden.**
  **Heilung ist ausschließlich „Vault neu indizieren"** (`reason="reindex"`, Voll-Ersatz);
  Heal/Delta helfen nicht, weil kein Pfad *fehlt*. **Erkennbar ist es nur an einer Probe:**
  findet sich eine kurze Notiz über ihren eigenen Wortlaut auf Rang 0? Genau dafür gibt es
  seit `ce08211` den Selbstfindungs-Prüfpunkt im GUI-Smoke — und `findDeadVectorPaths`
  (`index-guard`) für den verwandten Fall der Nullvektor-Zeilen (dort 4 Stück, darunter
  drei zuvor als „nicht auffindbar" gemeldete Notizen).
  ⚠️ **Die naheliegende Fehldiagnose ist dokumentiert und falsch:** der Befund wurde zuerst als
  „`mean` verwässert lange Notizen" gelesen. Gegengemessen ist beides widerlegt — mit der
  heutigen Bauart finden sich 22/23 **lange** Notizen selbst auf Rang 0, und die
  Matryoshka-Kürzung auf 256 Dim ist ebenfalls unschuldig (58/60 bei 256 wie bei 4096). Die
  Länge korrelierte nur mit dem wahren Faktor: dem Änderungsdatum.

- **`rowFor` liefert `-1`, nicht `null` — ein `expect(...).not.toBeNull()` darauf ist immer grün.**
  `VaultIndex.rowFor` (`src/index.ts:28`) ist `this.rowMap.get(path) ?? -1`. Eine Prüfung
  „Pfad ist im Index" muss deshalb `not.toBe(-1)` lauten (oder über `vectorFor` gehen, das
  wirklich `null` liefert). Gemessen 2026-09-04: zwei Läufe der Reindex-Race-Messung meldeten
  ein Loch als **widerlegt**, das tatsächlich existiert — der Test hatte nie etwas gemessen.
  Aufgefallen ist es nur an einer Gegenprobe, die grün sein MUSSTE und es nicht war.
