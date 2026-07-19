# Spec: Backup-Rotation-Fix + Mobile-Sync-Race-Fix (Index-Robustheit Nachzug)

**Datum:** 2026-07-19
**Status:** approved (brainstorming abgeschlossen)
**Repo:** vault-rag

## Problem

Johannes berichtete zwei zusammenhängende Symptome:

1. **Backup-Ordner sammeln sich unbegrenzt an.** Live-Check im Pallas-Vault
   (`.obsidian/plugins/vault-retrieval/index-backups/`) zeigte **1127 Ordner** statt der
   vorgesehenen 3 (Rotation `keep=3`, `index_backup.ts`). Davon waren **1124 komplett leer**
   (nur `.`/`..`, kein `manifest.json`), nur die 3 jeweils neuesten enthielten echte Daten.
2. **Der geteilte Index wird wiederholt komplett leer**, spürbar häufig nach Nutzung von
   Obsidian auf dem iPhone — Johannes muss seitdem regelmäßig manuell heilen/reindexen.

### Root Cause 1 — Backup-Rotation

`snapshotIndex()` (`main.ts`) wird per `void this.snapshotIndex()` fire-and-forget aus mehreren
Stellen ausgelöst, u. a. alle 30s aus `maybeReload()` (Poll-Intervall), sobald sich die Manifest-
mtime ändert — bei aktiver Live-Nutzung sehr häufig. Diese Aufrufe sind **nicht** über den
bestehenden `runIndexOp`-Mutex serialisiert (anders als `handleModify`/`handleDelete`/
`handleRename`/Reindex/Heal). `migrateIndex()` (`index_migrate.ts`) kopiert jede Indexdatei
einzeln mit stillem Skip bei Lesefehler ("fehlende Datei überspringen") und legt den Zielordner
dabei **immer** unconditional an. Race ein `snapshotIndex()`-Lauf gegen einen gleichzeitigen
Live-Persist (oder gegen Obsidian Sync, das die Quelldateien gerade neu schreibt), schlagen alle
Datei-Reads fehl → leerer Zielordner bleibt stehen. Die Namens-basierte Rotation
(`selectBackupsToDelete`) selbst ist korrekt (verifiziert per Unit-Test), aber jeder neue
fehlgeschlagene Snapshot-Versuch erzeugt einen neuen, eindeutig benannten Leichen-Ordner, sodass
sich die Menge trotz funktionierender Rotation der letzten 3 unbegrenzt aufsummiert.

### Root Cause 2 — Mobile-Sync-Race

`LiveIndexer` (`live_indexer.ts`) hält den Referenzwert für den Persist-Schutz (`diskCount`) rein
im Speicher — gesetzt bei `init()` (aus dem geladenen Index) oder `markFresh()` (`= 0`), nie
erneut gegen die tatsächliche Datei auf der Platte verifiziert. Startet das Plugin auf dem
iPhone, **bevor** Obsidian Sync den geteilten `_vaultrag/`-Index fertig heruntergeladen hat, sieht
`loadIndex()` kein Manifest → klassifiziert das (korrekt für den echten Fresh-Install-Fall, aber
hier fälschlich) als frische Installation → `markFresh()`, `diskCount = 0`. Kommt danach ein
Live-Persist (ausgelöst durch eine echte Notiz-Änderung oder ein von Sync selbst erzeugtes
`modify`-Event), prüft `assertSafeToPersist` nur gegen den veralteten `diskCount = 0` — das lässt
das Schreiben zu, obwohl der echte, gerade erst synchronisierte Index tausende Notizen enthält.
Das Plugin überschreibt den echten Index mit einem winzigen. Weil `_vaultrag/` per Obsidian Sync
geteilt wird, verteilt sich der Verlust auf alle Geräte.

## Ziel & Scope

**In Scope:**
- Backup-Rotation so reparieren, dass dauerhaft nur die 3 neuesten (echten) Backups existieren.
- Den Live-Persist-Schutz gegen den tatsächlichen Diskzustand statt gegen einen veralteten
  In-Memory-Cache prüfen lassen.

**Explizit NICHT (verworfene Alternativen, siehe Brainstorming):**
- **Kein Self-Heal bestehender Leichen-Ordner beim Plugin-Start** (Johannes' Entscheidung) — der
  Fix verhindert nur die *Neuentstehung*. Bestehende Leichen auf anderen Geräten (v. a. iPhone)
  werden extern/manuell bereinigt.
- **Kein manueller "Backups löschen"-Button** in den Settings — mit funktionierender Rotation
  nicht nötig (YAGNI).
- **Keine Start-Verzögerung auf Mobile** und **keine aktive Sync-Status-Erkennung** über
  Obsidian-interne APIs (fragil, keine stabile öffentliche API) — stattdessen ein struktureller
  Guard, der unabhängig von der *Ursache* eines veralteten In-Memory-Zustands funktioniert.
- **Kein Umbau der Backup-Sync-Architektur:** Backups bleiben bewusst geräte-lokal/ungesynct
  (Schutz vor Cross-Device-Clobber — würde ein Sync der Backups selbst untergraben).

## Design

### Bug A — Backup-Rotation (`main.ts`, `index_migrate.ts`)

1. **Serialisierung:** `snapshotIndex()`-Körper wird durch den bestehenden `runIndexOp`-Mutex
   gezogen (`return this.runIndexOp(async () => { … })`), identisch zum Muster in
   `handleModify`/`handleDelete`/`handleRename`. Verhindert, dass ein Snapshot mitten in einen
   laufenden Live-Persist (oder einen anderen Snapshot) hineinkopiert.
2. **Copy-Verifikation (Defense-in-Depth):** neue pure Funktion in `index_migrate.ts`, z. B.
   `hasAllRequiredFiles(files: string[]): boolean` (prüft `INDEX_REQUIRED_FILES` gegen eine
   Datei-Liste, analog zu `onlyContainsIndexFiles`). Nach `migrateIndex(...)` in `snapshotIndex()`
   wird `dest` gelistet und geprüft; fehlt etwas (z. B. weil eine Quelldatei genau in diesem
   Moment von Obsidian Sync selbst überschrieben wurde — das kann der eigene Mutex nicht
   verhindern), wird `dest` sofort wieder entfernt (gleicher list+remove+rmdir-Mechanismus wie in
   der bestehenden Rotation) statt als Leiche stehen zu bleiben. Kein Notice nötig — der nächste
   reguläre Snapshot-Versuch holt es nach.
3. **Rotation unverändert:** `selectBackupsToDelete(existing, 3)` bleibt wie es ist — sie war
   nicht die Ursache, sondern hatte durch die vielen leeren Ordner nur ständig neue Kandidaten.

### Bug B — Mobile-Sync-Race (`live_indexer.ts`, `index_guard.ts`)

1. **Live-Diskcheck statt Cache:** `persist(reason)` liest für `reason === "live"` **vor** der
   Entscheidung den aktuellen Notiz-Count direkt aus der echten `manifest.json` auf der Platte
   (`adapter.read` + Parse). Drei Ausgänge:
   - Manifest fehlt → `diskCountNow = 0` (legitim frisch — unverändertes Verhalten).
   - Manifest lesbar → `diskCountNow` = echter `count` → geht in
     `assertSafeToPersist(diskCountNow, nextCount, "live")` (pure Funktion **unverändert**).
   - Manifest vorhanden, aber gerade nicht lesbar/parsebar (Race mit fremdem Schreibvorgang) →
     **nicht** optimistisch auf 0 fallen, sondern blocken.
2. **Neuer Block-Kind:** `PersistBlockedError` bekommt ein drittes `kind`: `"unreadable"` (neben
   bestehend `"not-ready"`/`"shrink"`), für den obigen dritten Fall.
3. **Cache-Feld entfernt:** das `diskCount`-Instanzfeld in `LiveIndexer` sowie seine Pflege in
   `init()`/`markFresh()`/nach erfolgreichem Persist entfallen ersatzlos — es wird nach diesem
   Fix nirgends mehr gebraucht.
4. **Fehlerbehandlung nutzt vorhandene Infrastruktur:** blockiert `persist()` (jeder der drei
   `kind`s), fängt `handleModify` das wie bisher ab und legt die Notiz in der `PendingQueue` ab —
   kein neuer Code nötig. Der nächste 60s-Drain versucht es erneut, i. d. R. mit einem inzwischen
   fertig synchronisierten Manifest.

**Bekannte Grenze (bewusst akzeptiert):** Das schließt das Zeitfenster drastisch (von "ganze
Session" auf die wenigen hundert Millisekunden zwischen Disk-Read und Schreiben), macht einen
Clobber aber nicht mathematisch unmöglich — Obsidian Sync ist nicht transaktional/beobachtbar.
Passt zur bestehenden Philosophie des Moduls (mehrere unperfekte, geschichtete Guards statt ein
perfekter).

## Tests

**Bug A:**
- `tests/index_migrate.test.ts`: neue Unit-Tests für `hasAllRequiredFiles` (pure, kein
  Obsidian-Mock).
- `tests/index_robustness.integration.test.ts` (echtes node-fs, wie die bestehenden 8 Tests dort):
  - Quelldatei verschwindet/wird während der Kopie unlesbar → erwartet, dass kein Ordner-Rumpf
    zurückbleibt (Reinigung greift).
  - `snapshotIndex()` parallel zu einer laufenden Mutations-Operation ausgelöst → erwartet
    strikte Serialisierung (keine Überlappung, kein leerer Ordner).

**Bug B:**
- `tests/live_indexer.test.ts`: neue Fälle für die drei Disk-Read-Ausgänge von `persist("live")`:
  Manifest fehlt (erlaubt) · Manifest zeigt hohen Count trotz `markFresh()`-Zustand (blockt — der
  eigentliche Regressionstest für den Bug) · Manifest kaputt/unlesbar (blockt mit `"unreadable"`).
- `tests/index_robustness.integration.test.ts`: Sync-Race nachgestellt — `markFresh()` aufrufen
  (wie beim iPhone-Start ohne sichtbares Manifest), danach eine echte große `manifest.json` auf
  die Platte schreiben (simuliert nachgeholten Sync), dann `persist("live")` aufrufen → erwartet
  `PersistBlockedError`, nicht Clobber. Kern-Beweis, dass der Fix greift.

Bestehende Tests (631) bleiben unverändert grün, insbesondere `index_guard.test.ts` — die pure
Funktion `assertSafeToPersist` selbst wird nicht angefasst.

## Verifikation

- **Headless:** `npm test` (neue + bestehende Tests grün), `npm run typecheck` + `npm run lint`.
- **Manuell (Cross-Device-Race ist real nur bedingt headless prüfbar):** nach Release beobachten,
  ob nach iPhone-Nutzung weiterhin Index-Verluste auftreten und ob `index-backups/` bei ~3
  Ordnern stabil bleibt (kein Vollbeweis, aber die pragmatische Nagelprobe für Johannes' Alltag).
