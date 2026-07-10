# Spec: Index-Robustheit

**Datum:** 2026-07-10
**Status:** Design freigegeben (Brainstorming), bereit für Plan
**Slice:** Index-Robustheit (Prävention + günstige Recovery)

## Motivation

Am 2026-07-09 (~17:10) kollabierte der Pallas-Index von ~4700 auf 3 Notizen. Die
Code-Analyse zeigt den exakten Pfad — und er ist **nicht** primär ein Multi-Device-Problem,
sondern ein selbst zugefügter In-Process-Clobber:

1. `onload()` → `loadIndex()`. Schlägt das Laden fehl (z.B. abgeschnittener `notes.i8` aus
   einem halb-fertigen Sync von einem anderen Gerät), fängt `catch` (`main.ts`) den Fehler,
   setzt `index = null` — **aber `liveIndexer` bleibt der leere Frisch-Konstruktor**, weil
   `liveIndexer.init(index)` nie erreicht wird (der throw kam davor).
2. Erste Notiz-Änderung → `handleModify` → `liveIndexer.update()` fügt **einen** Vektor in die
   leere Map → `liveIndexer.persist()` **überschreibt den guten 4700-Index auf Platte mit 1 Notiz**.

Genau die „~4700 → 3"-Signatur (die 3 = die zuletzt editierten Notizen). Der Load-Fehler ist nur
der Auslöser; **der Schaden entsteht, weil ein nicht-initialisierter `LiveIndexer` persistieren darf.**

Zwei bestätigte Nebenlöcher:
- **`parseIndex` hat keinen Byte-Längen-Guard** (`index.ts`): ein zu kurzer `notes.i8` wirft nicht,
  sondern liest `undefined → NaN`-Vektoren → stiller Garbage statt lautem Fehler.
- **Load-Fehler sind stumm** (`console.warn`) — der Nutzer merkt nicht, dass RAG blind auf einem
  kaputten/leeren Index läuft.

Ein **zweiter, separater** Bedrohungsvektor: Der Vault wird auf mehrere Rechner gesynct. Gerät B kann
einen kleineren/älteren/abgeschnittenen Index **direkt auf Platte** über Gerät As guten synchronisieren.
Ein In-Process-„never-shrink"-Guard fängt das nicht (es ist nicht unser `persist`) — dagegen braucht es
Erkennung + Recovery.

## Threat-Modell

| Vektor | Mechanismus | Verteidigung |
|--------|-------------|--------------|
| In-Process-Clobber | Load-Fehler → leerer Indexer → persist plättet guten Index | Byte-Guard (laut) + Gefahrenzustand + persist-Guard |
| Stiller Garbage | Zu kurzer `notes.i8` → NaN-Vektoren, kein throw | Byte-Längen-Guard in `parseIndex` |
| Cross-Device-Clobber | Gerät B synct kleineren Index auf Platte | Reload-Shrink-Guard + Self-Heal (Vereinigung) + Backup |
| Unbemerkter Teilverlust | Nutzer merkt Verlust tagelang nicht | Laute Sichtbarkeit + Auto-Erkennung mit Bestätigung |

## Architektur-Entscheidung

Die datenverlust-kritische Logik wird in einem **separaten pure-core-Modul `src/index_guard.ts`**
gebündelt (obsidian-frei, in Node getestet) — konsistent mit dem bestehenden Muster (`index_dir.ts`,
`index_migrate.ts`). Grund: Es zentralisiert genau die Entscheidungen, die schiefgingen
(persistieren-ja/nein, Load-Ergebnis-Klassifikation, Shrink-Erkennung) an *einer* isoliert
testbaren Stelle — statt sie über die vier persist-Aufrufstellen in `main.ts` zu verstreuen
(genau die Fehlerklasse, die den Verlust mitverursachte).

## Komponenten

### `src/index_guard.ts` (neu, pure-core)

Drei reine Funktionen:

- **`classifyLoadResult(manifestExists: boolean, parseThrew: boolean): LoadState`**
  → `"no-index"` (kein Manifest — frische Installation, leerer Indexer darf aufbauen)
  | `"loaded-ok"`
  | `"load-failed-index-present"` (**Gefahrenzustand**: Index-Datei da, ließ sich nicht laden →
    darf NICHT überschrieben werden).

- **`assertSafeToPersist(diskCount: number, nextCount: number, reason: PersistReason): PersistDecision`**
  mit `PersistReason = "live" | "reindex" | "heal"`.
  - `reason="reindex"` oder `"heal"` → immer erlaubt (explizit vom Nutzer ausgelöst, darf legitim schrumpfen).
  - `reason="live"` (jede Notiz-Änderung über handleModify/Delete/Rename/drain):
    - erlaubt, wenn `nextCount >= diskCount` (Wachstum/gleich).
    - erlaubt bei normalen Einzel-Löschungen (`nextCount >= diskCount - 5`).
    - **verweigert bei einem Ein-Schritt-Sturz** unter Schwelle:
      `nextCount < max(diskCount * 0.5, diskCount - 5)`.
  - Rückgabe: `{ allowed: boolean, reason?: string }` (Grund für die Sichtbarkeit).
  - Wirkung: 4700→1 wird hart geblockt; 4700→4699 (Löschen) nie. Der Guard fängt den historischen
    Bug **auch ohne** den Gefahrenzustand-Flag ab (Defense-in-depth): leerer Indexer → nextCount=1 <
    4700·0.5 → verweigert.

- **`diffIndexVsVault(indexPaths: string[], vaultPaths: string[], exclude: string[]): { missing: string[] }`**
  → Pfade, die im Vault (nach exclude-Filter) vorhanden, aber im Index fehlen. Basis für Self-Heal
  UND Resume abgebrochener Voll-Reindexe.

### 1 · Prävention

- **Byte-Längen-Guard in `parseIndex`** (`index.ts`): `if (matrix.byteLength !== n * dim) throw`
  mit klarer Fehlermeldung. Der Dreh- und Angelpunkt — verwandelt einen abgeschnittenen
  `notes.i8` von einem laut werfenden Fehler in den sauberen Gefahrenzustand statt in NaN-Garbage.

- **Gefahrenzustand in `loadIndex`** (`main.ts`): erst `stat` auf `manifest.json`, um Existenz zu
  klären. `classifyLoadResult` entscheidet:
  - `no-index` → leerer Indexer darf aufbauen (frische Installation).
  - `load-failed-index-present` → `indexHealthy = false`; `liveIndexer` wird **nicht** init'et,
    darf nicht persistieren; laute persistente Anzeige (nicht nur `console.warn`).
  - `loaded-ok` → `liveIndexer.init(index)`, `diskCount` merken, `indexHealthy = true`.

- **persist-Guard**: `LiveIndexer.persist(reason)` bekommt einen `reason`-Parameter und ruft
  `assertSafeToPersist(this.diskCount, nextCount, reason)`; verweigert (wirft eine typisierte
  `IndexShrinkGuardError` o.ä.) im Gefahrenzustand und bei Ratio-Sturz. `handleModify/Delete/drain`
  fangen die Verweigerung → Notiz wandert in die pending-Queue statt den Index zu plätten; einmalige
  laute Meldung. Der `LiveIndexer` kennt seinen `diskCount` (aus `init` bzw. letztem erfolgreichen
  persist) und einen `ready`-Zustand.

- **Reload-Shrink-Guard (cross-device)** in `maybeReload` (`main.ts`): Ändert sich die mtime und der
  neu geladene Index ist drastisch kleiner als der aktuelle In-Memory-Index (gleiche Ratio-Schwelle),
  wird er **nicht blind übernommen** — der gute In-Memory-Index bleibt aktiv, Meldung + Heal-Angebot.
  Heal erzeugt die Vereinigung und persistiert sie zurück (heilt via Sync alle Geräte).
  Bewusste Vereinfachung: keine Device-ID-Verfolgung, keine Vektor-Uhr (YAGNI).

### 2 · Self-Heal / „Index vervollständigen" (Recovery-Variante C)

- **`LiveIndexer.healMissing(missing, read, onProgress)`** — wie `reindexAll`, aber **additiv**:
  behält die vorhandenen `noteVectors`, embeddet nur die fehlenden Pfade, resettet die Map **nicht**.
  Danach `persist("heal")` (wächst nur → Guard passiert). Dient zugleich als **Resume** für
  abgebrochene Voll-Reindexe (derselbe Diff-Mechanismus).

- **Auslöser (Variante C — laut erkennen, ein Klick bestätigen):**
  - Bei `loaded-ok` vergleicht `loadIndex` Index-Count gegen die Vault-Notizzahl (Markdown-Dateien
    nach exclude-Filter). Große Lücke → **Notice + Bestätigungs-Modal** (bestehendes
    `ReindexConfirmModal`-Muster) „N von M Notizen fehlen — jetzt vervollständigen?".
  - Plus **Command** „Index vervollständigen (Delta)" und **Settings-Button** für jederzeit.
  - Im **Gefahrenzustand** (nichts geladen) wird stattdessen **Restore / Voll-Reindex** angeboten —
    Delta-Heal braucht einen Basis-Index zum Ergänzen.
  - Schwelle für die Auto-Erkennung: konservativ (z.B. Lücke > 5% UND absolut > 20 Notizen), um
    Fehlalarme bei kleinen Vault-Änderungen zu vermeiden. Bei Endpoint-Ausfall (Embedder nicht
    erreichbar) wird nicht zum Heal gedrängt — die Lücke ist dann evtl. nur temporär.

### 3 · Backup-Rotation (geräte-lokal, N=3)

- **Ort:** `${this.manifest.dir}/index-backups/` (Plugin-Verzeichnis → außerhalb der Obsidian-Sync-
  Whitelist, synct **nicht**, kein iPhone-Bloat, immun gegen Fremd-Geräte-Clobber).
- **Auslöser:** Snapshot **bei erfolgreichem Load** (= letzter bekannt-guter Zustand) + **vor einem
  riskanten persist** (Guard meldet Shrink, bevor er verweigert — als Sofort-Netz). Kopiert die drei
  Index-Dateien (`notes.i8`, `paths.json`, `manifest.json`) in `index-backups/<timestamp>/`.
- **Rotation:** auf die letzten **3** (ältestes Verzeichnis löschen).
- **Restore:** Command + Settings-Button „Aus Backup wiederherstellen" → listet Backups (Notizzahl +
  Zeitstempel), kopiert das gewählte zurück in `indexDir`, anschließend `loadIndex`.
- Der Backup-/Restore-Code lebt in einem eigenen pure-core-nahen Modul (`index_backup.ts`) über den
  `VaultAdapter`, analog zu `index_migrate.ts`; die Rotations-/Auswahl-Logik ist rein testbar.

### 4 · Sichtbarkeit (ND-gerecht: laut, aber ein Klick)

- **Statusleiste** bekommt einen Gesundheits-Zustand: gesund `● N` (wie bisher) vs. degradiert
  `⚠ Index beschädigt`. Der Gefahrenzustand ist **nicht mehr stumm**.
- **Settings-Sektion „Index-Robustheit"**: Health-Readout („4700 Notizen · gesund" /
  „⚠ Laden fehlgeschlagen — beschädigter Index erkannt") + drei Buttons: Vervollständigen /
  Wiederherstellen / Voll-Reindex.

## Tests

- `index_guard.ts` voll unit-getestet: alle `classifyLoadResult`-Fälle; `assertSafeToPersist`-
  Grenzfälle (Wachstum, Einzel-Löschung, 4700→1-Sturz, reindex/heal-Bypass, leerer-Indexer-Fall);
  `diffIndexVsVault` (missing korrekt, exclude respektiert).
- `parseIndex`-Byte-Guard-Test (= der schon vorgemerkte „corrupt-index-Test"): zu kurzer/zu langer
  Buffer wirft; korrekte Länge lädt.
- `LiveIndexer.healMissing`-Additiv-Test: vorhandene Vektoren bleiben, nur fehlende kommen dazu.
- `index_backup.ts`-Rotations-Logik pure-testbar (N=3, ältestes fällt raus, Auswahl sortiert).
- Alle bestehenden Tests bleiben grün.

## Bewusste Scope-Grenzen (YAGNI)

- Keine Device-ID / Vektor-Uhr / Merge-Konfliktauflösung auf Vektor-Ebene.
- Keine automatischen (unbestätigten) Heal-Läufe — immer mit Bestätigung.
- Kein `schema_version`-Bump — das Index-Format (`notes.i8` / `paths.json` / `manifest.json`,
  Dim 256, INT8_SCALE 127, mean-Aggregation) bleibt **unverändert**.
- `VaultAdapter`-Interface bleibt unangetastet, soweit möglich; falls Backup/Restore ein `stat`/
  `list`/`remove` braucht, wird die kleinste nötige Erweiterung dokumentiert.

## Offene Detail-Entscheidungen für den Plan

- Exakte Schwellwerte final festzurren (Ratio 0.5, Delta 5, Auto-Erkennung 5%/20).
- Ob der Reload-Shrink-Guard denselben `assertSafeToPersist`-Pfad nutzt oder eine eigene, klar
  benannte Vergleichsfunktion bekommt (Lesbarkeit).
- `VaultAdapter`-Erweiterung für Backup-Verzeichnis-Listing (Obsidian bietet `adapter.list`/`stat`/
  `rmdir` — prüfen, ob sie ins Interface aufgenommen oder nur in der Obsidian-Schicht genutzt werden).
