# Sync-Race-Wurzelfix: Container-Index statt Datei-Tripel

**Datum:** 2026-07-29 · **Status:** freigegeben (Jay, abschnittsweise) · **Ziel-Release:** 0.18.0

## Problem

`LiveIndexer.persist` schreibt drei unabhängige Dateien (`notes.i8` → `paths.json` →
`manifest.json`). Obsidian Sync löst Konflikte **pro Datei** und kennt keine
Gruppen-Transaktion: Zwei Geräte können einen Zustand erzeugen, den nie ein Gerät geschrieben
hat (Vorfall 2026-07-22: Manifest vom 21.07. mit `count: 4661` neben `notes.i8`/`paths.json`
vom 22.07. mit 6 Notizen). Der 0.15.2-Guard prüft, bevor *wir* schreiben — der Schaden
entsteht, während *Sync* schreibt. Solange der logisch atomare Index physisch als drei einzeln
gesyncte Objekte lebt, ist kein plugin-seitiger Guard ausreichend (systematic-debugging
Phase 1, 2026-07-28: „keine fehlende Prüfung, sondern die Datenstruktur").

**Verschärfung:** Der heutige Byte-Guard fängt nur Mischungen mit divergierenden Counts.
Mischt Sync zwei Generationen mit **gleichem Count** (z. B. nach reinen Umbenennungen),
lädt der Index still — mit falsch zugeordneten Vektoren.

## Entscheidung

**Ein Container-File statt drei Dateien.** Sync überträgt Dateien als Ganzes und wählt bei
Konflikten eine vollständige Generation — gemischte Generationen werden **strukturell
unmöglich**, nicht nur erkennbar. Vorentscheidungen (Jay, 2026-07-29):

1. **Nur das Plugin schreibt.** Der HyperForge-Export nach `_vaultrag/` ist stillgelegt und
   wird nicht nachgezogen (Hinweis in AGENTS.md; bei Reaktivierung muss er das
   Container-Format lernen).
2. **Harter Schnitt.** Neue Version migriert das Alt-Tripel einmalig; ein Gerät mit alter
   Plugin-Version zeigt übergangsweise „kein Index" (kein Datenverlust, Notizen unberührt).
   Kein Dual-Write — das würde die Race-Anfälligkeit konservieren.
3. **Auto-Heal mit Endpoint, Backup-Kaskade als Basis.** Bei korruptem Container wird ein
   CRC-beweisbar intaktes geräte-lokales Backup übernommen und per Delta-Reindex ergänzt —
   nur bei erreichbarem Endpoint; sonst Status quo (Schreibschutz + Notice).

## Format-Spezifikation `_vaultrag/index.bin`

```
Offset  Inhalt
0       Magic "VRIX" (4 Byte ASCII)
4       u32 headerLen (little-endian)
8       Header-JSON (UTF-8, headerLen Bytes)
8+H     Int8-Matrix (count × index_dim Bytes)
Ende−4  CRC32 (u32 LE) über alle Bytes ab Offset 0 bis Matrix-Ende
```

- **Header-JSON** = bisheriges Manifest **plus** `paths: string[]` (ersetzt `paths.json`),
  mit `schema_version: 2` als Container-Marker.
- Die Matrix ist Int8 — keine Endianness-Frage; nur `headerLen` und CRC sind u32 LE.
- `pending.json` bleibt bewusst **außerhalb** des Containers: Dirty-List, kein Teil des
  atomaren Zustands; gemischte Generationen dort sind harmlos (schlimmstenfalls ein
  Re-Embed zu viel).
- Größe wie heute (~1,4 MB Matrix + wenige KB Header).

## Komponenten

### Neu: `src/index_container.ts` (pur, obsidian-frei)

- `encodeContainer(manifest, paths, i8: Int8Array): ArrayBuffer`
- `decodeContainer(buf: ArrayBuffer): { manifest, paths, matrix: ArrayBuffer }` — wirft bei
  falschem Magic, falscher `schema_version`, Truncation (jede Grenze), CRC-Mismatch.
- `decodeContainer` liefert an das **bestehende** `parseIndex` weiter; dessen Count-/Byte-
  Guards bleiben als zweite Verteidigungslinie unverändert.

### `src/index.ts`

- `IndexLoader.load()`: liest `index.bin` → `decodeContainer` → `parseIndex`. Fallback-Pfad
  für das Alt-Tripel (nur für Migration/Klassifikation, s. Load-Pfad).
- `VaultAdapter` bekommt **additiv** `remove(path: string): Promise<void>` (Obsidians
  `DataAdapter.remove`) — begründete Ausnahme von „Interface nicht ändern": Migration und
  Aufräumen brauchen Löschen.

### `src/live_indexer.ts`

- `persist(reason)`: schreibt **eine** Datei per direktem `writeBinary` — bewusst **ohne**
  Temp-File+Rename (Rename-Semantik auf Mobile/Capacitor unzuverlässig; der gefährliche
  Mechanismus war Syncs Per-Datei-Konfliktauflösung über mehrere Dateien, nicht der lokale
  Schreibvorgang; ein Mid-Write-Upload ist selten, wird vom CRC erkannt und von der
  Heal-Kaskade repariert).
- `readDiskCount()`: liest `index.bin`, dekodiert nur den Header (~ms bei 1,4 MB). Kein
  Container vorhanden = `0` (legitim frisch), unlesbar/korrupt = `null` (blocken) — Semantik
  wie heute. **Kein Legacy-Fallback nötig:** `loadIndex` migriert das Tripel, bevor im
  Plugin-Lebenszyklus der erste Live-Persist laufen kann; ein „nur Tripel auf Platte"-Zustand
  existiert zum Persist-Zeitpunkt nicht mehr.
- Persist-Guards unverändert: `assertSafeToPersist` (±1-Regel), `PersistBlockedError`-Kinds,
  `markUnready`/`markFresh`.

### `src/main.ts` — Load-Pfad (neue Reihenfolge)

1. `index.bin` vorhanden → dekodieren + parsen → `loaded-ok`. Liegt daneben noch ein
   Alt-Tripel (z. B. von einem Gerät mit alter Plugin-Version nachgeschrieben), wird es bei
   jedem erfolgreichen Container-Load **still gelöscht** (idempotentes Aufräumen).
2. Kein Container, Alt-Tripel lädt sauber → **einmalige Migration**: übernehmen, sofort als
   Container persistieren, Tripel löschen (`notes.i8`, `paths.json`, `manifest.json` —
   `pending.json` bleibt). Die Migration repackt **byte-level**: das originale Int8-`notes.i8`
   wandert unverändert in den Container (kein Umweg über `LiveIndexer.persist`, der die
   dekodierten Float-Vektoren re-quantisieren und Rundungsdrift über den ganzen Index
   einführen würde). Verifikation vor dem Schreiben via `parseIndex`; keine neue
   `PersistReason` nötig. Schlägt das Container-Schreiben/Aufräumen fehl, gilt der Load
   trotzdem als erfolgreich — der nächste Load wiederholt die Migration.
3. Beides fehlt → `no-index` (`markFresh`, wie heute).
4. Container (oder nur Tripel) vorhanden, aber korrupt → Gefahrenzustand → Heal-Kaskade.

`classifyLoadResult` wird vom Signal `manifestExists` auf „Container **oder**
Legacy-Manifest existiert" umgestellt; die Drei-Zustands-Logik bleibt identisch.
`maybeReload` pollt die mtime von `index.bin` statt `manifest.json`; Suspicious-Shrink-Guard
unverändert.

### Heal-Kaskade (Gefahrenzustand, ersetzt reines Schreibschutz+Notice)

1. **Backup-Kaskade:** geräte-lokale Backups neueste-zuerst durchgehen; Kandidat per CRC +
   `parseIndex` **beweisen**, erst dann übernehmen; korrupte überspringen (max. 3 vorhanden).
2. **Auto-Delta-Heal:** nur bei erreichbarem Endpoint — ab der Backup-Basis fehlende Notizen
   via `healMissing` nachziehen, Ergebnis-Notice („Index aus Backup wiederhergestellt,
   N Notizen ergänzt"), geheilten Index persistieren (verteilt sich per Sync).
3. **Kein beweisbares Backup / kein Endpoint:** Status quo — Schreibschutz + Notice +
   bestehender Reindex-/Restore-Dialog. iPhone wartet auf die Desktop-Heilung via Sync.

**Konkrete Schutzregeln des Backup-Pfads:** (a) Es wird nie etwas übernommen, das nicht per
CRC + `parseIndex` als konsistent bewiesen ist. (b) Persistiert wird der geheilte Index nur,
wenn der Heal-Lauf im Wesentlichen durchlief (`failed` leer bzw. marginal) — bricht der
Endpoint mitten im Heal weg, bleibt der Gefahrenzustand bestehen statt einen halb geheilten
Winz-Index zu verteilen. (c) Auf Empfängerseite verteidigt zusätzlich der bestehende
Suspicious-Shrink-Guard in `maybeReload` die anderen Geräte, falls doch je ein kleinerer
Index ankommt.

### `src/index_migrate.ts` / Backups

- `migrateIndex` kopiert `index.bin` + `pending.json`; `INDEX_REQUIRED_FILES = ["index.bin"]`;
  `INDEX_ALL_FILES` behält zusätzlich die Legacy-Namen (damit `onlyContainsIndexFiles` alte
  Ordner weiterhin als sicher-löschbar erkennt).
- Backup-Ordnerstruktur (Zeitstempel-Ordner, Rotation 3) bleibt unangetastet. Der
  Backup-Leichen-Bug (`adapter.rmdir` wirkungslos, 936 leere Ordner) ist eine **eigene**
  TaskNote — hier weder fixen noch verschlimmern.
- Ein Backup ist künftig **eine** Datei, per CRC verifizierbar — die Fehlerklasse
  „unvollständige Datei-für-Datei-Kopie" verschwindet.

### MCP-Server

Nutzt denselben `IndexLoader` — Änderung transparent, kein Umbau.

## Tests (TDD)

- **`index_container` (pur):** Round-Trip byte-genau · Truncation an jeder Grenze wirft ·
  CRC-Flip an beliebiger Position wirft · falsche `schema_version` wirft · 0-Notizen-Index
  round-trippt.
- **Load-Pfad (Fake-Adapter):** volle Matrix — Container ok · nur Tripel (Migration:
  Container da, Tripel weg, `pending.json` überlebt) · beides da (Tripel weggeräumt) ·
  nichts (no-index) · Container korrupt (Heal-Kaskade).
- **Heal-Kaskade:** korruptes Backup übersprungen, intaktes übernommen, Delta-Heal ergänzt;
  ohne Endpoint → Schreibschutz + Notice; Suspicious-Shrink blockt Winz-Backup.
- **Persist/Guards:** genau eine Datei geschrieben; `readDiskCount` aus Container-Header;
  ±1-Regel grün.
- **Effekt-Tests statt Auswahllogik** (Lehre aus dem Backup-Leichen-Bug): Assertions auf den
  Zustand des Fake-Dateisystems (existiert `index.bin`? Tripel weg?), nicht nur auf
  Rückgabewerte.
- **Manueller Smoke (headless unerreichbar):** Migration auf Jays Desktop (echter
  Pallas-Index), iPhone-Sync-Roundtrip, Obsidian-1.12.4-Pfad. Checkliste im Handoff.

## Nicht-Ziele (YAGNI)

Kein Dual-Write · keine Kompression · kein Sharding/inkrementelles Format · `pending.json`
unangetastet · Backup-Rotation/Leichen-Bug separat · i18n separat (neue Notices deutsch,
konsistent zur heutigen UI; der i18n-Slice fegt sie mit).

## Doku-/Release-Folgen

- **Release 0.18.0** (Format-Bruch = Minor-Bump; i18n rückt auf 0.19.0).
- **AGENTS.md:** „Index-Format (Slice A, unveränderlich)" → Container-Format; Modul-Layout
  (`index_container.ts`, `VaultAdapter.remove`); HyperForge-Hinweis (Export stillgelegt,
  müsste bei Reaktivierung das Container-Format lernen).
- **`docs/explanation/index.md`:** Absatz „known open problem" ersetzt durch die
  Container-Begründung. **README (beide Fassungen!)** auf neue Dateistruktur prüfen
  (`_vaultrag/`-Beschreibung).
- **CHANGELOG:** Migration + Mixed-Version-Verhalten („altes Gerät zeigt übergangsweise
  ‚kein Index'") ehrlich dokumentieren.
