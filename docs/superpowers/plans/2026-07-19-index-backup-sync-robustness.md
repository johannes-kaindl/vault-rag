# Backup-Rotation-Fix + Mobile-Sync-Race-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backup-Ordner sammeln sich nicht mehr unbegrenzt an (Rotation auf 3 hält zuverlässig),
und ein Live-Persist auf einem Gerät kann den geteilten Index nicht mehr mit einem veralteten
In-Memory-Zustand überschreiben (schließt den iPhone-Sync-Race, der wiederholt zu einem leeren
Index führte).

**Architecture:** Zwei unabhängige, aber verwandte Härtungen im bestehenden
Index-Robustheits-Layer (`index_guard.ts`/`index_migrate.ts`/`index_backup.ts`/`live_indexer.ts`/
`main.ts`). Bug A (Rotation) wird durch Serialisierung (bestehender `runIndexOp`-Mutex) +
Copy-Verifikation gelöst. Bug B (Sync-Race) wird durch Ersetzen eines gecachten In-Memory-Werts
(`LiveIndexer.diskCount`) durch einen Live-Read der tatsächlichen `manifest.json` unmittelbar vor
jedem Live-Persist gelöst. Beide Fixes nutzen ausschließlich bestehende Bausteine (kein neues
Subsystem).

**Tech Stack:** TypeScript strict, vitest (Unit + node-fs-Integrationstests), Obsidian Plugin API
(nur `main.ts`).

## Global Constraints

- TS strict + `noImplicitAny` — keine `any`-Casts für neue Typen (bestehende `as any`-Casts in
  Test-Mocks dürfen bleiben, siehe Task 1/5).
- Nach jeder Änderung müssen alle Tests grün bleiben (`npm test`, Stand vor diesem Plan: 631).
- `npm run typecheck` und `npm run lint` müssen sauber bleiben.
- Commits: Conventional Commits, deutsche Beschreibung erlaubt, nur berührte Dateien stagen (nie
  `git add -A`). Trailer: `Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>`.
- `index_guard.ts` bleibt pure-core (kein Obsidian-Import) — nur `live_indexer.ts`/`main.ts` dürfen
  den `VaultAdapter` tatsächlich ansprechen.
- Spec: `docs/superpowers/specs/2026-07-19-index-backup-sync-robustness-design.md`.

---

### Task 1: `VaultAdapter.exists()` — Interface-Erweiterung

Fügt `exists()` zum obsidian-freien `VaultAdapter`-Interface hinzu (bisher hatte nur die volle
Obsidian-`DataAdapter`-API diese Methode; `main.ts` nutzte sie bereits direkt über
`this.app.vault.adapter.exists(...)`, aber `LiveIndexer` — konstruiert mit dem schmaleren
`VaultAdapter`-Typ — hatte keinen Zugriff darauf). Das ist die Voraussetzung für Task 5.

**Files:**
- Modify: `src/index.ts:11-17` (Interface)
- Modify: `tests/index_migrate.test.ts:5-17` (`makeMemAdapter`)
- Modify: `tests/index_robustness.integration.test.ts:22-30` (`fsAdapter`)
- Test: bestehende Suite dient als Regressionstest (kein neuer Testfall nötig — reiner
  Typ-/Compile-Schritt)

**Interfaces:**
- Produces: `VaultAdapter.exists(path: string): Promise<boolean>` — ab jetzt Teil des Interfaces,
  von Task 5 (`LiveIndexer.readDiskCount`) konsumiert.

- [ ] **Step 1: Interface erweitern**

In `src/index.ts`, Zeile 11-17:

```ts
export interface VaultAdapter {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
```

- [ ] **Step 2: Typecheck laufen lassen — erwartet zwei Fehler**

Run: `npm run typecheck`
Expected: FAIL — `tests/index_migrate.test.ts` und `tests/index_robustness.integration.test.ts`
melden je einen Fehler ("Property 'exists' is missing in type ...").
(`tests/live_indexer.test.ts` und `tests/pending_queue.test.ts` casten ihre Mocks mit `as any` und
sind daher NICHT betroffen — dort wird `exists` erst in Task 5 funktional gebraucht.)

- [ ] **Step 3: `makeMemAdapter` in `tests/index_migrate.test.ts` ergänzen**

Zeile 5-17, `exists` zur Rückgabe hinzufügen:

```ts
function makeMemAdapter(seed: Record<string, string | ArrayBuffer> = {}): VaultAdapter & { store: Map<string, string | ArrayBuffer>; mkdirs: string[] } {
  const store = new Map<string, string | ArrayBuffer>(Object.entries(seed));
  const mkdirs: string[] = [];
  return {
    read: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as string; },
    readBinary: async (p: string) => { if (!store.has(p)) throw new Error("not found: " + p); return store.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { store.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { store.set(p, d); },
    mkdir: async (p: string) => { mkdirs.push(p); },
    exists: async (p: string) => store.has(p),
    store,
    mkdirs,
  };
}
```

- [ ] **Step 4: `fsAdapter` in `tests/index_robustness.integration.test.ts` ergänzen**

Zeile 22-30, `exists` zur Rückgabe hinzufügen:

```ts
function fsAdapter(): VaultAdapter {
  return {
    read: (p) => fs.readFile(p, "utf8"),
    readBinary: async (p) => { const b = await fs.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    write: async (p, d) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, d); },
    writeBinary: async (p, d) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, Buffer.from(d)); },
    mkdir: async (p) => { await fs.mkdir(p, { recursive: true }); },
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
  };
}
```

- [ ] **Step 5: Typecheck + volle Suite grün**

Run: `npm run typecheck && npm test`
Expected: beide PASS, weiterhin 631 Tests grün (keine neuen, keine entfernt).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index_migrate.test.ts tests/index_robustness.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(index): VaultAdapter um exists() erweitern

Voraussetzung für einen Live-Disk-Check vor jedem Persist (LiveIndexer
konnte bisher nicht zwischen "kein Manifest" und "Manifest gerade
unlesbar" unterscheiden, da die schmale VaultAdapter-Schnittstelle kein
exists() hatte).

Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `hasAllRequiredFiles` — pure Copy-Verifikation

Neue pure Hilfsfunktion in `index_migrate.ts`, analog zu `onlyContainsIndexFiles`. Prüft, ob eine
Datei-Liste (volle Pfade, Obsidian-`list()`-Format) alle `INDEX_REQUIRED_FILES` enthält —
Grundlage für Task 3 (Backup gilt nur als vollständig, wenn diese Prüfung `true` liefert).

**Files:**
- Modify: `src/index_migrate.ts`
- Test: `tests/index_migrate.test.ts`

**Interfaces:**
- Consumes: `INDEX_REQUIRED_FILES` (bereits in `index_migrate.ts` exportiert).
- Produces: `hasAllRequiredFiles(files: string[]): boolean` — von Task 3 (`main.ts`) konsumiert.

- [ ] **Step 1: Failing Test schreiben**

In `tests/index_migrate.test.ts`, neuer `describe`-Block ans Dateiende anhängen:

```ts
describe("hasAllRequiredFiles", () => {
  it("alle drei Pflichtdateien vorhanden → true", () => {
    expect(hasAllRequiredFiles(["dest/notes.i8", "dest/paths.json", "dest/manifest.json"])).toBe(true);
  });
  it("manifest.json fehlt → false", () => {
    expect(hasAllRequiredFiles(["dest/notes.i8", "dest/paths.json"])).toBe(false);
  });
  it("leere Liste (fehlgeschlagene Kopie) → false", () => {
    expect(hasAllRequiredFiles([])).toBe(false);
  });
  it("zusätzliche optionale Datei (pending.json) ändert nichts an true", () => {
    expect(hasAllRequiredFiles(["dest/notes.i8", "dest/paths.json", "dest/manifest.json", "dest/pending.json"])).toBe(true);
  });
});
```

Import-Zeile am Dateianfang ergänzen (Zeile 3):

```ts
import { migrateIndex, onlyContainsIndexFiles, INDEX_ALL_FILES, hasAllRequiredFiles } from "../src/index_migrate";
```

- [ ] **Step 2: Test laufen lassen — erwartet Fehlschlag**

Run: `npx vitest run tests/index_migrate.test.ts`
Expected: FAIL mit "hasAllRequiredFiles is not defined" / Importfehler.

- [ ] **Step 3: Implementierung**

In `src/index_migrate.ts`, nach `onlyContainsIndexFiles` (Dateiende) ergänzen:

```ts
/**
 * True, wenn `files` (volle Pfade, Obsidian `DataAdapter.list`-Format) alle Pflichtdateien
 * (`INDEX_REQUIRED_FILES`) als Basename enthält — Backup-/Kopiervorgang gilt nur dann als
 * vollständig. Verhindert, dass eine durch eine Race abgebrochene `migrateIndex`-Kopie (z. B.
 * Quelldatei wird währenddessen von Sync überschrieben) als gültiges Backup gezählt wird.
 */
export function hasAllRequiredFiles(files: string[]): boolean {
  const present = new Set(files.map(p => p.split("/").pop() ?? p));
  return INDEX_REQUIRED_FILES.every(f => present.has(f));
}
```

- [ ] **Step 4: Test laufen lassen — erwartet Erfolg**

Run: `npx vitest run tests/index_migrate.test.ts`
Expected: PASS, alle Fälle grün.

- [ ] **Step 5: Commit**

```bash
git add src/index_migrate.ts tests/index_migrate.test.ts
git commit -m "$(cat <<'EOF'
feat(index_migrate): hasAllRequiredFiles für Copy-Verifikation

Pure Hilfsfunktion, Grundlage für die Backup-Rotation-Fix (main.ts
verwirft künftig unvollständige Backup-Kopien statt sie als
Ordner-Leiche stehen zu lassen).

Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `main.ts` — Snapshot serialisieren + Copy-Verifikation

Kern-Fix für Bug A. `snapshotIndex()` läuft künftig durch den bestehenden `runIndexOp`-Mutex
(verhindert die Race gegen einen parallelen Live-Persist) und verwirft eine unvollständige Kopie
sofort statt sie stehen zu lassen. Die Rotations-Lösch-Logik wird in eine wiederverwendbare
`removeBackupDir`-Hilfsmethode extrahiert (DRY — sie wird jetzt an zwei Stellen gebraucht).

**Files:**
- Modify: `src/main.ts:458-483` (`snapshotIndex`, `backupsRoot`)
- Test: `tests/index_robustness.integration.test.ts`

**Interfaces:**
- Consumes: `hasAllRequiredFiles` (Task 2), `INDEX_REQUIRED_FILES` (bereits importiert),
  `this.runIndexOp` (bestehend, `main.ts:81`).
- Produces: keine neuen öffentlichen Symbole — reines Verhaltens-Fix an bestehender Methode.

`main.ts` selbst ist obsidian-gekoppelt und läuft nicht headless (kein `main.test.ts` existiert in
diesem Repo, konsistent für die ganze Codebase — vgl. 0.12.0-Review: „Restrisiko = obsidian-Glue
zur Laufzeit, reviewed, nicht runtime-ausgeführt"). Dieser Task lässt sich daher NICHT per
klassischem Failing-Test-vor-Fix auf `main.ts` selbst verifizieren. Stattdessen: ein
Integrationstest belegt gegen echtes Dateisystem, dass die Bausteine, die `snapshotIndex()` jetzt
nutzt (`migrateIndex` + `hasAllRequiredFiles`), das Race-Symptom (unvollständige Kopie bei
verschwindender Quelldatei) korrekt erkennen — das ist der Mechanismus, den der main.ts-Fix
verdrahtet. Die main.ts-Verdrahtung selbst wird durch Code-Review + die volle Regressionssuite
(Step 5) sowie die manuelle Beobachtung nach Release (Task 7) abgesichert.

- [ ] **Step 1: Integrationstest für den Erkennungsmechanismus schreiben**

In `tests/index_robustness.integration.test.ts`, Import-Zeile 16 erweitern:

```ts
import { migrateIndex, INDEX_REQUIRED_FILES, hasAllRequiredFiles } from "../src/index_migrate";
```

Neuen Test nach dem bestehenden "Backup-Rotation"-Test (nach Zeile 134) einfügen:

```ts
it("Unvollständige Backup-Kopie (Quelldatei verschwindet während der Kopie) hinterlässt keine Ordner-Leiche", async () => {
  await buildGoodIndex();
  const adapter = fsAdapter();
  const backupDir = path.join(root, ".obsidian/plugins/vault-retrieval/index-backups/2026-07-19T00-00-00-000Z");
  // Quelle nach dem Kopierbeginn unvollständig machen: notes.i8 löschen, BEVOR migrateIndex läuft
  // (simuliert eine Race, bei der die Quelldatei genau in diesem Moment fehlt/unlesbar ist).
  await fs.rm(path.join(indexDir, "notes.i8"));
  await migrateIndex(adapter, indexDir, backupDir);
  // migrateIndex überspringt die fehlende Datei still — Zielordner ist unvollständig.
  const listing = await fs.readdir(backupDir);
  expect(hasAllRequiredFiles(listing.map(f => `${backupDir}/${f}`))).toBe(false);
  // Das ist exakt der Zustand, den snapshotIndex() jetzt erkennt + aufräumt (main.ts-Verhalten,
  // hier auf Modul-Ebene nachgebildet, da main.ts nicht headless ausführbar ist):
  for (const f of listing) await fs.rm(path.join(backupDir, f));
  await fs.rmdir(backupDir);
  await expect(fs.access(backupDir)).rejects.toThrow();
});
```

- [ ] **Step 2: Test laufen lassen — erwartet Erfolg (belegt den Erkennungsmechanismus)**

Run: `npx vitest run tests/index_robustness.integration.test.ts`
Expected: PASS. Das ist bewusst kein Red-Green für `main.ts` (das dieser Test nicht anfasst),
sondern der Beleg, dass `migrateIndex` bei einer verschwindenden Quelldatei tatsächlich eine
unvollständige Kopie erzeugt (`hasAllRequiredFiles` → `false`) — exakt der Zustand, den
`snapshotIndex()` in main.ts bisher NICHT prüft. Step 3 schließt diese Lücke in main.ts selbst.

- [ ] **Step 3: `main.ts` implementieren**

Ersetze `src/main.ts:458-483` (`backupsRoot` + `snapshotIndex`) durch:

```ts
  private backupsRoot(): string { return `${this.manifest.dir}/${BACKUP_SUBDIR}`; }

  /** Kopiert den aktuellen Index geräte-lokal (Plugin-Ordner, synct nicht) und rotiert auf 3.
   *  Läuft über runIndexOp (Fix Backup-Rotation): verhindert, dass ein Snapshot mitten in einen
   *  laufenden Live-Persist hineinkopiert und dadurch eine unvollständige Kopie erzeugt. */
  async snapshotIndex(): Promise<void> {
    if (!this.index || !this.indexHealthy) return; // nur bekannt-guten Zustand sichern
    return this.runIndexOp(async () => {
      try {
        const root = this.backupsRoot();
        // Zeitstempel aus dem Manifest (fällt sonst auf lastMtime zurück).
        let builtAt = "";
        try { const m = JSON.parse(await this.app.vault.adapter.read(`${this.settings.indexDir}/manifest.json`)) as { built_at?: string }; builtAt = m.built_at ?? ""; } catch { /* ignore */ }
        if (!builtAt) builtAt = new Date(this.lastMtime || Date.now()).toISOString();
        const name = backupDirName(builtAt);
        const dest = `${root}/${name}`;
        if (await this.app.vault.adapter.exists(`${dest}/manifest.json`)) return; // schon gesichert
        await migrateIndex(this.app.vault.adapter, this.settings.indexDir, dest);
        if (!(await this.backupComplete(dest))) {
          // Race (z. B. Quelldatei wurde währenddessen von Sync überschrieben) — keine
          // Ordner-Leiche stehen lassen. Der nächste reguläre Snapshot-Versuch holt es nach.
          await this.removeBackupDir(root, name);
          return;
        }
        // Rotation: vorhandene Backup-Verzeichnisse listen → älteste über 3 löschen.
        const existing = await this.backupNames();
        for (const del of selectBackupsToDelete(existing, 3)) {
          await this.removeBackupDir(root, del);
        }
      } catch (e) { console.warn("vault-rag: snapshotIndex failed", e); }
    });
  }

  private async backupComplete(dest: string): Promise<boolean> {
    const listing = await this.app.vault.adapter.list(dest);
    return hasAllRequiredFiles(listing.files ?? []);
  }

  private async removeBackupDir(root: string, name: string): Promise<void> {
    try {
      const listing = await this.app.vault.adapter.list(`${root}/${name}`);
      for (const f of listing.files ?? []) await this.app.vault.adapter.remove(f);
      await this.app.vault.adapter.rmdir(`${root}/${name}`, false);
    } catch { /* Rotations-/Cleanup-Fehler nicht fatal */ }
  }
```

Import-Zeile `src/main.ts:25` erweitern:

```ts
import { migrateIndex, onlyContainsIndexFiles, hasAllRequiredFiles, INDEX_REQUIRED_FILES } from "./index_migrate";
```

- [ ] **Step 4: Test laufen lassen — erwartet Erfolg**

Run: `npx vitest run tests/index_robustness.integration.test.ts`
Expected: PASS, alle Fälle inkl. des neuen Tests grün.

- [ ] **Step 5: Typecheck + volle Suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: alle drei PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/index_robustness.integration.test.ts
git commit -m "$(cat <<'EOF'
fix(main): Backup-Snapshot serialisieren + unvollständige Kopien verwerfen

snapshotIndex() lief bisher unserialisiert (fire-and-forget, u. a. alle
30s aus dem maybeReload-Poll) und konnte mitten in einen laufenden
Live-Persist hineinkopieren — migrateIndex überspringt fehlende
Quelldateien still, wodurch ein leerer Backup-Ordner zurückblieb statt
eines echten Backups. Live-Fund im Pallas-Vault: 1127 Backup-Ordner
statt der vorgesehenen 3 (1124 davon leer). Fix: snapshotIndex läuft
jetzt durch den bestehenden runIndexOp-Mutex + verwirft eine
unvollständige Kopie sofort (hasAllRequiredFiles-Check) statt sie
stehen zu lassen.

Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `index_guard.ts` — `PersistBlockedError` um `"unreadable"` erweitern

Kleine, eigenständige Typ-Erweiterung — Voraussetzung für Task 5.

**Files:**
- Modify: `src/index_guard.ts:64-69`
- Test: `tests/index_guard.test.ts`

**Interfaces:**
- Produces: `PersistBlockedError.kind: "not-ready" | "shrink" | "unreadable"` — von Task 5
  (`live_indexer.ts`) konsumiert.

- [ ] **Step 1: Failing Test schreiben**

In `tests/index_guard.test.ts`, im bestehenden `describe("PersistBlockedError", ...)`-Block (ab
Zeile 84) neuen Fall ergänzen:

```ts
  it("trägt kind 'unreadable'", () => {
    const e = new PersistBlockedError("unreadable", "y");
    expect(e.kind).toBe("unreadable");
  });
```

- [ ] **Step 2: Test laufen lassen — erwartet Fehlschlag**

Run: `npx vitest run tests/index_guard.test.ts`
Expected: FAIL — TypeScript-Fehler, `"unreadable"` ist kein gültiger `kind`-Wert.

- [ ] **Step 3: Implementierung**

In `src/index_guard.ts`, Zeile 64-69:

```ts
export class PersistBlockedError extends Error {
  constructor(readonly kind: "not-ready" | "shrink" | "unreadable", message: string) {
    super(message);
    this.name = "PersistBlockedError";
  }
}
```

- [ ] **Step 4: Test laufen lassen — erwartet Erfolg**

Run: `npx vitest run tests/index_guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index_guard.ts tests/index_guard.test.ts
git commit -m "$(cat <<'EOF'
feat(index_guard): PersistBlockedError um kind 'unreadable' erweitern

Grundlage für den Live-Disk-Check in LiveIndexer.persist() (Task 5):
ein Manifest, das zwar existiert, aber gerade nicht lesbar/parsebar
ist (Race mit einem fremden Schreibvorgang), muss anders blockiert
werden können als 'not-ready'/'shrink'.

Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `live_indexer.ts` — Live-Disk-Check statt gecachtem `diskCount`

Kern-Fix für Bug B. Ersetzt das im Speicher gehaltene `diskCount`-Feld durch einen Read der
tatsächlichen `manifest.json` unmittelbar vor jedem `persist("live")`. Das ist der größte Task
dieses Plans — er berührt die Test-Infrastruktur von `tests/live_indexer.test.ts` (das
`makeAdapter()`-Mock muss künftig Schreib-/Lesevorgänge tatsächlich spiegeln, damit die
Disk-Wahrheit testbar ist).

**Files:**
- Modify: `src/live_indexer.ts`
- Modify: `tests/live_indexer.test.ts`

**Interfaces:**
- Consumes: `VaultAdapter.exists()` (Task 1), `PersistBlockedError` mit `kind: "unreadable"`
  (Task 4), `assertSafeToPersist` (unverändert, `index_guard.ts`).
- Produces: `LiveIndexer.persist()` — Signatur unverändert (`(reason?: PersistReason) =>
  Promise<void>`), aber Verhalten für `reason === "live"` jetzt disk-truth-basiert statt
  cache-basiert. Das `diskCount`-Feld existiert danach nicht mehr (kein anderer Task/Konsument
  greift darauf zu — verifiziert per `grep -rn "diskCount" src/ tests/` vor diesem Task).

- [ ] **Step 1: `makeAdapter()` auf echtes Round-Tripping umstellen**

In `tests/live_indexer.test.ts`, Zeile 10-20 ersetzen durch:

```ts
function makeAdapter(): VaultAdapter & { written: Map<string, ArrayBuffer | string> } {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: vi.fn(async (p: string) => {
      if (!written.has(p)) throw new Error("not found: " + p);
      return written.get(p) as string;
    }),
    readBinary: vi.fn(async (p: string) => {
      if (!written.has(p)) throw new Error("not found: " + p);
      return written.get(p) as ArrayBuffer;
    }),
    write: vi.fn(async (p: string, d: string) => { written.set(p, d); }),
    writeBinary: vi.fn(async (p: string, d: ArrayBuffer) => { written.set(p, d); }),
    mkdir: vi.fn(),
    exists: vi.fn(async (p: string) => written.has(p)),
    written,
  } as any;
}
```

Das ändert das DEFAULT-Verhalten von "jeder `read()` wirft immer" zu "wirft nur, wenn nichts unter
diesem Pfad geschrieben wurde" — für alle bestehenden Tests mit leerem Adapter (kein vorheriger
`write`) bleibt das Verhalten identisch (weiterhin ein Reject beim ersten Read), da `written`
initial leer ist.

- [ ] **Step 2: Bestehende Suite laufen lassen — erwartet, dass alles noch grün ist**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: PASS (Step 1 ändert nur die Mock-Semantik, noch nicht `live_indexer.ts` selbst — alle
20 bestehenden Fälle müssen unverändert grün bleiben, weil `persist()` `adapter.exists()` noch gar
nicht aufruft).

- [ ] **Step 3: Zwei neue Regressionstests schreiben (failing)**

Im `describe("LiveIndexer persist-Guard", ...)`-Block (nach dem letzten bestehenden Test, vor der
schließenden `});` bei Zeile 388) ergänzen:

```ts
  it("Sync-Race: markFresh (kein sichtbares Manifest) + später erscheinender großer Index auf Platte blockt live-persist (kein Clobber)", async () => {
    const a = makeAdapter();
    // Simuliert: der echte Index kommt gerade erst per Obsidian Sync an (z. B. iPhone-Start,
    // Manifest war beim eigenen loadIndex() noch nicht da) — DIESES LiveIndexer-Objekt hat ihn
    // nie über init() gesehen, sondern wurde per markFresh() als "frisch" eingestuft.
    a.written.set("_vaultrag/manifest.json", JSON.stringify({ count: 4700 }));
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); // 1 Notiz im Speicher
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "shrink" });
    // Der echte Index auf Platte bleibt unangetastet:
    expect(JSON.parse(a.written.get("_vaultrag/manifest.json") as string).count).toBe(4700);
  });

  it("Manifest vorhanden, aber gerade unlesbar/korrupt (Race mit fremdem Schreibvorgang) → blockt mit 'unreadable'", async () => {
    const a = makeAdapter();
    a.written.set("_vaultrag/manifest.json", "{ das ist kein valides JSON");
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "unreadable" });
  });
```

- [ ] **Step 4: Tests laufen lassen — erwartet Fehlschlag**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: FAIL — beide neuen Tests schlagen fehl (aktuell wird `assertSafeToPersist` noch mit dem
gecachten `diskCount = 0` aus `markFresh()` aufgerufen, `0 → 1` ist erlaubt → kein Reject; der
korrupte-Manifest-Fall wird aktuell gar nicht gelesen, also ebenfalls kein Reject).

- [ ] **Step 5: `live_indexer.ts` implementieren**

In `src/live_indexer.ts` folgende Änderungen:

Zeile 5, Import um `PersistDecision`-losen Zugriff unverändert lassen, nur sicherstellen, dass
`assertSafeToPersist`/`PersistBlockedError` weiter importiert sind (bereits der Fall).

Zeile 27, Feld entfernen:

```ts
  private ready = false;
```

(die Zeile `private diskCount = 0;` direkt darunter komplett löschen)

Zeile 36-45, `init()` — die `diskCount`-Zeile entfernen:

```ts
  init(index: VaultIndex): void {
    this.loadedManifest = index.manifest;
    this.noteVectors.clear();
    for (const path of index.paths) {
      const v = index.vectorFor(path);
      if (v) this.noteVectors.set(path, v.slice());
    }
    this.ready = true;
  }
```

Zeile 72-73, `markFresh()` — die `diskCount`-Zeile entfernen:

```ts
  /** No-Index-Pfad: kein Index auf Platte → leerer Indexer darf gefahrlos aufbauen. */
  markFresh(): void { this.ready = true; }
```

Zeile 141-181, `persist()` komplett ersetzen durch:

```ts
  async persist(reason: PersistReason = "live"): Promise<void> {
    const nextCount = this.noteVectors.size;
    if (!this.ready && reason === "live") {
      throw new PersistBlockedError("not-ready", "Persist verweigert: Index ist nicht initialisiert (Load-Fehler) — der gute Index auf Platte bleibt erhalten.");
    }
    if (reason === "live") {
      // Live-Wahrheit statt gecachtem Zustand prüfen: verhindert, dass ein veralteter
      // In-Memory-Stand (z. B. nach markFresh() während ein Sync-Download noch lief) einen
      // inzwischen echten, größeren Index auf Platte überschreibt.
      const diskCountNow = await this.readDiskCount();
      if (diskCountNow === null) {
        throw new PersistBlockedError("unreadable", "Persist verweigert: Der Index auf Platte ist gerade nicht lesbar (z. B. laufender Sync/Parallel-Schreibvorgang) — der gute Index bleibt unangetastet, ein erneuter Versuch folgt automatisch.");
      }
      const decision = assertSafeToPersist(diskCountNow, nextCount, reason);
      if (!decision.allowed) {
        throw new PersistBlockedError(decision.kind ?? "shrink", decision.message ?? "Persist verweigert.");
      }
    }
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const i8 = new Int8Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) {
        i8[r * INDEX_DIM + c] = Math.max(-INT8_SCALE, Math.min(INT8_SCALE, Math.round((v[c] ?? 0) * INT8_SCALE)));
      }
    }
    await this.adapter.mkdir(this.indexDir);
    // Write-Order: binary → paths → manifest (manifest letztes = reload-Trigger)
    await this.adapter.writeBinary(`${this.indexDir}/notes.i8`, i8.buffer);
    await this.adapter.write(`${this.indexDir}/paths.json`, JSON.stringify(paths));
    const manifest = {
      schema_version: 1,
      vault: (this.loadedManifest as { vault?: string } | null)?.vault ?? "10_Pallas",
      embedding_model: this.embeddingModel,
      source_dim: INDEX_DIM,
      index_dim: INDEX_DIM,
      granularity: "note",
      aggregation: "mean",
      quant: "int8",
      scale: INT8_SCALE,
      count: n,
      shards: ["notes.i8"],
      source_commit: "",
      built_at: new Date().toISOString(),
    };
    await this.adapter.write(`${this.indexDir}/manifest.json`, JSON.stringify(manifest, null, 2));
    this.ready = true;
  }

  /** Liest den aktuellen Notiz-Count direkt aus der Platte (nicht aus dem In-Memory-Zustand).
   *  `null` = "Zustand unbekannt, sicherheitshalber blocken" (Manifest da, aber nicht lesbar/
   *  parsebar — z. B. während ein fremder Prozess/Sync es gerade neu schreibt). Kein Manifest
   *  vorhanden gilt hingegen als legitim frisch (`0`). */
  private async readDiskCount(): Promise<number | null> {
    const manifestPath = `${this.indexDir}/manifest.json`;
    let exists: boolean;
    try { exists = await this.adapter.exists(manifestPath); } catch { return null; }
    if (!exists) return 0;
    try {
      const raw = await this.adapter.read(manifestPath);
      const parsed = JSON.parse(raw) as { count?: number };
      return typeof parsed.count === "number" ? parsed.count : null;
    } catch { return null; }
  }
```

- [ ] **Step 6: Neue Tests laufen lassen — erwartet Erfolg**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: PASS für die beiden neuen Fälle.

- [ ] **Step 7: Bestehende Titel an neue Mechanik anpassen (kein Verhaltenswechsel)**

Zwei Testtitel referenzieren die jetzt entfernte `diskCount`-Implementierungsdetails — Titel
umbenennen, Testkörper unverändert lassen (Verhalten bleibt identisch, nur jetzt disk-truth-
basiert statt cache-basiert):

- Zeile 327 (`"init setzt diskCount → Clobber (großer Index, dann leer) wird geblockt"`) →
  `"Clobber via In-Memory-Leerung wird gegen den echten Diskzustand geblockt (3→0)"`
- Zeile 351 (`"erfolgreicher persist aktualisiert diskCount (Löschungen bleiben möglich)"`) →
  `"nach erfolgreichem persist erlaubt der (jetzt aktuelle) Diskzustand eine Ein-Schritt-Löschung"`

- [ ] **Step 8: Volle Suite laufen lassen**

Run: `npx vitest run tests/live_indexer.test.ts`
Expected: PASS, alle 22 Fälle (20 bestehende + 2 neue) grün.

- [ ] **Step 9: `diskCount` vollständig entfernt verifizieren**

Run: `grep -rn "diskCount" src/ tests/`
Expected: keine Treffer mehr.

- [ ] **Step 9b: `AGENTS.md`-Modulbeschreibung nachziehen**

`AGENTS.md:95` beschreibt `persist(reason)` noch als „gegen `index_guard` geguarded
(ready/diskCount)" — das Klammer-Detail wird mit diesem Task falsch. Zeile 93-96 ersetzen durch:

```
live_indexer.ts   LiveIndexer → note-level Vektor-Map; update/remove/rename · buildIndex ·
                  persist(reason) (Write-Order: notes.i8 → paths.json → manifest.json), gegen
                  `index_guard` geguarded (ready + Live-Disk-Read des tatsächlichen Counts vor
                  jedem live-Persist statt gecachtem Zustand) · healMissing (additiver Delta-Reindex
```

(nur die dritte Zeile ändert sich inhaltlich; die erste/zweite/vierte bleiben wortgleich —
Kontext beim Ersetzen mit angeben, da „healMissing (additiver Delta-Reindex" sonst nicht eindeutig
lokalisierbar ist.)

- [ ] **Step 10: Typecheck + Lint + volle Suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: alle drei PASS.

- [ ] **Step 11: Commit**

```bash
git add src/live_indexer.ts tests/live_indexer.test.ts AGENTS.md
git commit -m "$(cat <<'EOF'
fix(live_indexer): Live-Disk-Check statt gecachtem diskCount

LiveIndexer.persist("live") prüfte den Persist-Schutz bisher gegen ein
rein im Speicher gehaltenes diskCount-Feld (gesetzt bei init()/
markFresh(), nie erneut gegen die tatsächliche Platte verifiziert).
Startet das Plugin (v. a. auf dem iPhone), bevor Obsidian Sync den
geteilten _vaultrag/-Index fertig heruntergeladen hat, klassifiziert
loadIndex() das fälschlich als frische Installation (markFresh,
diskCount=0) — ein späterer Live-Persist überschrieb dann den
inzwischen echten, großen Index mit einem winzigen, was sich über
Obsidian Sync auf alle Geräte verteilte.

Fix: persist("live") liest jetzt unmittelbar vor der Entscheidung den
tatsächlichen Count aus der echten manifest.json auf der Platte statt
aus einem veralteten Cache. Manifest fehlt → legitim frisch (0).
Manifest da, aber gerade unlesbar (Race) → blockt mit 'unreadable'
statt optimistisch 0 anzunehmen. Blockierte Live-Persists fallen wie
bisher automatisch in die PendingQueue (nächster Drain-Zyklus).

Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Integrationstest — Sync-Race gegen echtes Dateisystem

Der End-to-End-Beweis, dass der Fix aus Task 5 auch gegen ein echtes Dateisystem (nicht nur den
Unit-Test-Mock) greift — im selben Stil wie die bestehenden 9 Fälle in
`index_robustness.integration.test.ts`.

**Files:**
- Modify: `tests/index_robustness.integration.test.ts`

**Interfaces:**
- Consumes: `LiveIndexer` (Task 5), `fsAdapter()` (Task 1), `PersistBlockedError` (bereits
  importiert in dieser Datei).

- [ ] **Step 1: Test schreiben**

Nach dem bestehenden Test `"Shrink-Erkennung: ..."` (Dateiende, vor der schließenden `});` bei
Zeile 169) ergänzen:

```ts
  it("Sync-Race gegen echtes Dateisystem: markFresh + später auf Platte erscheinender großer Index blockt live-persist, kein Clobber", async () => {
    // Simuliert exakt das iPhone-Startup-Szenario: dieses LiveIndexer-Objekt sieht beim eigenen
    // loadIndex() kein Manifest (Sync war noch nicht fertig) → markFresh(). ERST DANACH landet
    // der echte, große Index auf der Platte (Sync holt ihn nach) — bevor dieses Gerät seinen
    // ersten Live-Edit persistiert.
    const adapter = fsAdapter();
    const stranded = new LiveIndexer(adapter, indexDir, fakeEmbedder(), "fake-model");
    stranded.markFresh();

    // Sync liefert jetzt den echten 100-Notizen-Index nach (von einem ANDEREN LiveIndexer/Gerät
    // geschrieben, "stranded" hat davon nichts mitbekommen):
    await buildGoodIndex();
    expect(await countOnDisk(indexDir)).toBe(100);

    // Erster Live-Edit auf dem "frischen" Gerät:
    await stranded.update("note-000.md", await read("note-000.md"));
    await expect(stranded.persist("live")).rejects.toBeInstanceOf(PersistBlockedError);

    // Der echte Index auf Platte ist UNBERÜHRT:
    expect(await countOnDisk(indexDir)).toBe(100);
  });
```

- [ ] **Step 2: Test laufen lassen — erwartet Erfolg (Fix aus Task 5 bereits vorhanden)**

Run: `npx vitest run tests/index_robustness.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Kontrollprobe — ohne Fix hätte dieser Test fehlschlagen müssen**

Kein Code-Schritt. Nachvollziehbarkeitshinweis für die Review: vor Task 5 hätte `stranded`
weiterhin `diskCount = 0` (aus `markFresh()`) gegen `nextCount = 1` geprüft → `assertSafeToPersist`
hätte das erlaubt → `stranded.persist("live")` hätte den 100er-Index mit einem 1-Notiz-Index
überschrieben → `countOnDisk(indexDir)` wäre `1` statt `100` gewesen. Das ist exakt der Bug, den
Johannes auf dem iPhone beobachtet hat.

- [ ] **Step 4: Volle Suite + Typecheck + Lint**

Run: `npm run typecheck && npm run lint && npm test`
Expected: alle drei PASS, Gesamt-Testzahl 631 + 4 neue Bug-B-Tests (2 aus Task 5, 2 aus Task 2/3)
+ 4 neue Bug-A-Tests (Task 2) = 631 + 10.

- [ ] **Step 5: Commit**

```bash
git add tests/index_robustness.integration.test.ts
git commit -m "$(cat <<'EOF'
test(integration): Sync-Race-Regressionstest gegen echtes Dateisystem

End-to-End-Beweis für den Fix aus live_indexer.ts: ein Gerät, das per
markFresh() startet (kein sichtbares Manifest beim eigenen Load) und
danach einen echten, großen Index auf der Platte vorfindet (z. B.
durch Obsidian Sync nachgeliefert), darf ihn nicht mehr mit einem
Live-Persist überschreiben.

Co-Authored-By: Claude Sonnet 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Gesamt-Verifikation

Kein Code — Abschluss-Gate vor Release-Entscheidung.

**Files:** keine

- [ ] **Step 1: Volle Suite + Typecheck + Lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle drei PASS, 631 + 10 = 641 Tests grün.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `main.js` baut ohne Fehler.

- [ ] **Step 3: Manuelle Beobachtung ankündigen (kein CI-Schritt)**

Kein automatisierter Schritt — Hinweis für den Handoff an Johannes (siehe Spec, Abschnitt
„Verifikation"): nach dem Release beobachten, ob `index-backups/` bei ~3 Ordnern stabil bleibt und
ob nach iPhone-Nutzung weiterhin Index-Verluste auftreten. Das ist die pragmatische Nagelprobe im
Alltag, kein Vollbeweis (Cross-Device-Race bleibt headless nicht 100%ig nachstellbar, siehe
„Bekannte Grenze" in der Spec).
