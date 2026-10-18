---
paths:
  - "src/main.ts"
  - "src/index_dir.ts"
  - "src/index_migrate.ts"
  - "src/pending_queue.ts"
---

# Index-Heilung, Ablage und Reindex — Gotchas

Gotchas zu Auto-Heal, leeren Notizen, Index-Ordner und Reindex (`src/main.ts`, `src/index_migrate.ts`).

- **`_vaultrag/` ist bewusst kein Dot-Ordner:** Obsidian Sync ignoriert Dot-Ordner. Daher braucht
  Sync „Sync all other file types"; im Pallas-Vault ist `_vaultrag/` git-ignored (derived, synct via
  Obsidian Sync, nicht git).

- **Dot-Pfade auto-ausgeschlossen:** `handleModify/Delete/Rename` returnen bei `path.startsWith(".")`
  (deckt `.obsidian/`, `.trash/` ab) — daher `.trash/` **nicht** mehr in `DEFAULT_SETTINGS.exclude`.

- **Auto-Heal-Kaskade (höchstens einmal je Episode):** Liefert der Load einen CRC-defekten Container,
  sucht `main.ts` das neueste per `verifyBackupCandidate` CRC-bewiesene geräte-lokale Backup, übernimmt
  es und ergänzt fehlende Notizen per Delta-Reindex. **Die Reihenfolge ist bedeutungstragend:**
  Backup-Suche und Modell-Guard laufen VOR jeder Endpunkt-Bedingung, weil beide kein Netz brauchen —
  nur der Delta-Reindex braucht einen. Vorher stand ein `if (!ready) return` davor, und damit hing die
  Übernahme am Reindex: wer offline war, blieb dauerhaft auf dem defekten Container sitzen, obwohl die
  CRC-bewiesene Rettung lokal danebenlag (so gemeldet 2026-08-14, ein manuelles `restore-index-backup`
  heilte es in Sekunden). `planAutoHeal` (`index-guard`, pure) macht die Aufteilung explizit:
  `restore-and-reindex` · `restore-only` · `wait-for-sync` · `no-backup`.
  **`restore-only` persistiert ebenfalls** — die Basis ist CRC-bewiesen und in sich vollständig, sie
  kann nur älter sein; sie nur im Speicher zu halten hieße, den defekten Container liegen zu lassen und
  beim nächsten Start wieder bei „kein Index" zu stehen. Die Notice sagt dann ausdrücklich, dass neuere
  Notizen noch fehlen — und die fehlenden Pfade wandern in die `PendingQueue` (`addMany`, EIN Write),
  damit der 60-s-Drain sie holt, sobald ein Endpunkt antwortet; ohne das war die Zusage der Notice
  unwahr. Gestempelt wird dabei das Modell **des Backups**, nicht das aktive: von dort stammt jeder
  Vektor, und der Modell-Guard hält genau dieses Feld beim nächsten Live-Persist gegen das aktive
  Modell.
  **`wait-for-sync` heilt gar nicht** (seit 0.24.0): `embedderReady` trug zwei Bedeutungen, und nur
  eine durfte fallen. Ein toter Endpunkt ist auf dem Desktop vorübergehend; ein Gerät, das
  **strukturell** keinen hat (iPhone, `Platform.isMobile`), kann die Lücke dagegen nie schließen —
  und der Index-Ordner ist **gesynct**, ein älterer Stand ginge von dort an alle Geräte zurück, wo
  `isSuspiciousShrink` ihn erst unter 50 % aufhielte. Dort bleiben Schreibschutz und Notice, die
  Heilung kommt vom Desktop. ⚠️ **Ein Zwischenweg stand hier für ein paar Stunden und ist wieder
  raus:** „nur in den Speicher übernehmen, Platte unberührt lassen" gibt eine Nicht-Schreib-Zusage,
  die nirgends durchgesetzt war — nach `init(base)` bleibt der Indexer mit den Backup-Vektoren
  **scharf**, der einzige Schutz wäre ein Nebeneffekt (`persist`s `readDiskState() === null`, das
  zudem schwächer prüft als `loadIndexStore`), und ein `markUnready()` hebt
  `resolveAndReconnectEmbedder` beim nächsten Endpunktwechsel wieder auf (`if (this.index)
  li.init(this.index)`). Wer Sitzungs-Retrieval auf dem Telefon will, braucht ein echtes
  geräteweites Schreib-Lock — eigener Slice, nicht nebenbei.
  Beim Reindex-Zweig wird **nur bei restlos sauberem Lauf** persistiert (`failed === 0`) — ein
  teilweiser Heal bleibt im Speicher; die Kaskade läuft pro Plugin-Start/Episode nur einmal an statt
  in einer Schleife zu hämmern.

- **Leere Notizen sind nie im Index (by design):** `embedNote` → null bei 0 Chunks (nur Frontmatter/
  leer, z.B. Ordner-Notizen). Damit sie kein Phantom-Defizit erzeugen, hält `main.ts` ein
  `emptyNotePaths`-Set — **bewusst nicht persistiert**: bei jedem `loadIndex` frisch klassifiziert
  (`classifyChunkless` über die missing-Pfade), in-Session von den Live-Handlern gepflegt, von
  Heal/Reindex aus dem `HealReport` neu aufgebaut. Delta-Anzeige/Heal-Lauf/Auto-Heal-Prompt rechnen
  alle auf der bereinigten Basis (`computeIndexDelta`/`splitHealTargets`).

- **Die Fortschrittsrate eines Reindex ist kein Prädiktor — sie misst die Notizlänge, nicht die
  Restzeit.** An einem Abend im Arbeits-Vault gemessen: 3,5 → 130 → 76 → 35 → 4,8 Notizen/Minute,
  im selben Lauf. Nicht Last und nicht der Endpunkt (Modell durchgehend im VRAM laut
  `/api/ps`, Ein-Chunk-Latenz 2,35 s), sondern die **Bündelung**: `reindexAll` füllt eine Gruppe
  bis `EMBED_BATCH` = 32 **Chunks**, geht die Pfade aber alphabetisch durch — eine Notiz mit 30+
  Chunks ist damit allein eine ganze Gruppe, dreißig kurze passen in eine. Jede Hochrechnung aus
  einem Zeitfenster sagt deshalb nur, wie lang die Notizen gerade sind. Gemessen führte das an
  einem Abend zu drei Schätzungen von 35 h, 3,4 h und 21 h für denselben Lauf, und die
  Faktor-5-Fehlschätzung vom 2026-09-05 mittags hat dieselbe Ursache. Belastbar wäre ein
  Fortschritt in **Chunks**; `EmbeddingProgress.reindex` zählt Notizen.

- **`adapter.rmdir(path, false)` löscht in Obsidian NIE ein Verzeichnis** — auch kein leeres.
  Der Adapter setzt es intern auf `fs.rm()` **ohne** `recursive` um; das wirft auf jedem
  Verzeichnis `ERR_FS_EISDIR` (`syscall: "rm"`). Gemessen 2026-08-03 in echtem Obsidian, in allen
  Fällen identisch — Vault-Ordner, Plugin-Ordner hinter Symlink, leerer wie befüllter Ordner.
  **Immer `rmdir(path, true)`** — `removeDirDeep` (`index_migrate.ts`) ist die eine Wahrheit dafür.
  Die falsche Form hat über Wochen 1309 leere Backup-Ordner erzeugt, weil ein stummer `catch` den
  Fehler schluckte; **ein `catch`, der einen FS-Fehler verwirft, ohne ihn zu loggen, ist hier
  verboten.** Fallstrick bei der Diagnose: eine `fs.rmdir`-Probe in Node ist **kein** Beleg — sie
  prüft nicht den Weg, den Obsidian tatsächlich geht (genau daran ist die erste Analyse gescheitert).

- **Index-Ordner-Hide ist rein kosmetisch (CSS):** `buildHideCss` (Kit `folder-hide`, bis Welle 11 lokal in `index_dir.ts`) erzeugt eine
  `display:none`-Regel auf `.nav-folder-title[data-path=…]`, injiziert via Constructable Stylesheet
  (`adoptedStyleSheets`) — `createEl("style")`/`<style>`-Elemente sind von der Lint-Regel
  `no-forbidden-elements` gesperrt. `refreshIndexFolderHiding` (`main.ts`, `installFolderHide` auf `rootSplit.doc` statt `activeDocument`) feature-detektet die API
  (erst iOS/Safari 16.4+) und überspringt sie still auf älteren WebViews (Ordner bleibt sichtbar,
  kein Crash). `data-path` ist internes Obsidian-Markup — bricht es, taucht der Ordner nur wieder auf
  (kein Datenverlust).

- **Pfad-Wechsel migriert per Copy + verifiziert vor Delete:** `changeIndexDir` (`main.ts`) kopiert via
  `migrateIndex` an den neuen Ort (kein Reindex), prüft mit `indexComplete`, dass der neue Index
  vollständig ist, und löscht den alten Ordner nur dann — und nur, wenn er ausschließlich Index-Dateien
  enthält (`onlyContainsIndexFiles`). Hatte der alte einen vollständigen Index und der neue nicht →
  nichts geändert (Datenverlust-Schutz, B-vor-A).

- **Die Heilung schreibt ein Backup ohne Reindex nur unter einer Bedingung (seit Welle 23, Entscheidung Johannes 2026-10-15).** `attemptAutoHeal` fragt `decideHealWrite` (code-kit `index-guard`): bei `restore-only` wird nur geschrieben, wenn das Backup jünger als 7 Tage ist (Alter aus dem Namen, das ist `built_at` des gesicherten Containers, also das Alter der INHALTE) oder in dieser Sitzung ein Embedding-Endpunkt geantwortet hat (`embeddingReachedThisSession`, gesetzt in `embedderPing` und `applyEmbeddingResolution`). Sonst bleibt der Schreibschutz, die Notice `main.autoHealBackupTooOld` nennt den Grund, und der Versuch wird freigegeben. Smoke-Punkt 8b misst das mit Backups auf „vor 8 Tagen“; der Punkt davor benennt die Backups auf JETZT um, sonst alterte er mit dem Kalender. Gegenprobe: die Abfrage `!verdict.write` abschalten, dann ist 8b rot.
