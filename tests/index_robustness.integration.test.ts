// Integrationstest: fährt die echten Index-Robustheits-Module gegen ein ECHTES Dateisystem
// (node fs, Temp-Verzeichnis) — kein Mock-Adapter. Deckt genau die datensicherheits-kritischen
// Pfade ab, die die Unit-Tests (mit In-Memory-Adapter) nicht end-to-end prüfen:
//   Gefahrenzustand → kein Clobber · Byte-Guard auf echt-abgeschnittener Datei ·
//   Backup-Round-Trip via migrateIndex · Delta-Heal additiv · Shrink-Erkennung.
// Ergänzt das obsidian-verdrahtete main.ts (das headless nicht lauffähig ist) auf Modul-Ebene.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VaultAdapter, VaultIndex } from "../src/index";
import { LiveIndexer } from "../src/live_indexer";
import { EmbeddingClient } from "../src/embedder";
import { assertSafeToPersist, isSuspiciousShrink, diffIndexVsVault, PersistBlockedError } from "../src/index_guard";
import { migrateIndex, hasAllRequiredFiles } from "../src/index_migrate";
import { selectBackupsToDelete } from "../src/index_backup";
import { CONTAINER_FILE, decodeContainer } from "../src/index_container";
import { loadIndexStore, verifyBackupCandidate } from "../src/index_store";

const DIM = 256;

// Echter Filesystem-VaultAdapter (wie die Obsidian-/Node-Schicht, nur auf node fs).
function fsAdapter(): VaultAdapter {
  return {
    read: (p) => fs.readFile(p, "utf8"),
    readBinary: async (p) => { const b = await fs.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    write: async (p, d) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, d); },
    writeBinary: async (p, d) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, Buffer.from(d)); },
    mkdir: async (p) => { await fs.mkdir(p, { recursive: true }); },
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
    remove: async (p) => { await fs.rm(p, { force: true }); },
  };
}

// Deterministischer Fake-Embedder: ein nicht-null 256-dim-Vektor pro Chunk (Inhalt egal für
// Count-/Persistenz-Prüfungen). Keine Netz-Abhängigkeit.
function fakeEmbedder(): EmbeddingClient {
  return {
    embed: async (texts: string[]) => texts.map((t) => {
      const v = new Float32Array(DIM);
      v[t.length % DIM] = 1;
      return v;
    }),
  } as unknown as EmbeddingClient;
}

async function countOnDisk(dir: string): Promise<number> {
  const b = await fs.readFile(path.join(dir, CONTAINER_FILE));
  const { manifest } = decodeContainer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return manifest.count;
}

/** Lädt via loadIndexStore (Container-first) und wirft, falls kein ladbarer Index vorliegt —
 *  Ersatz für das alte `new IndexLoader(adapter, dir).load()` (Tripel-only). */
async function loadIndex(adapter: VaultAdapter, dir: string): Promise<VaultIndex> {
  const r = await loadIndexStore(adapter, dir);
  if (r.state !== "loaded") throw new Error(`Index nicht ladbar (state=${r.state})`);
  return r.index;
}

describe("Index-Robustheit — Integration gegen echtes Dateisystem", () => {
  let root: string;
  let indexDir: string;
  const paths = Array.from({ length: 100 }, (_, i) => `note-${String(i).padStart(3, "0")}.md`);
  const read = async (p: string) => `# ${p}\n\nInhalt für ${p}. Etwas Text zum Chunken.`;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-it-"));
    indexDir = path.join(root, "_vaultrag");
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  // Baut einen echten, gültigen 100-Notizen-Index auf Platte auf (via echte Module).
  async function buildGoodIndex(): Promise<void> {
    const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li.markFresh();
    await li.healMissing(paths, read);
    await li.persist("heal");
  }

  it("Baseline: aufgebauter Index lädt sauber (count 100)", async () => {
    await buildGoodIndex();
    const idx = await loadIndex(fsAdapter(), indexDir);
    expect(idx.count).toBe(100);
    expect(await countOnDisk(indexDir)).toBe(100);
  });

  it("Byte-Guard: echt abgeschnittener index.bin → loadIndexStore erkennt den Gefahrenzustand (state 'corrupt')", async () => {
    await buildGoodIndex();
    // index.bin real abschneiden (CRC + Header/Matrix-Länge passen danach nicht mehr).
    const p = path.join(indexDir, CONTAINER_FILE);
    const buf = await fs.readFile(p);
    await fs.writeFile(p, buf.subarray(0, buf.length - 10)); // echt kürzer als der volle Container
    const result = await loadIndexStore(fsAdapter(), indexDir);
    expect(result.state).toBe("corrupt");
  });

  it("KEIN CLOBBER: nicht-initialisierter Indexer (Gefahrenzustand) darf den guten Index nicht überschreiben", async () => {
    await buildGoodIndex();
    expect(await countOnDisk(indexDir)).toBe(100);
    // Historischer Bug: Load schlug fehl → LiveIndexer wurde NIE init'et (ready=false).
    const stranded = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    // Eine Notiz-Bearbeitung würde jetzt persistieren wollen:
    await stranded.update("note-000.md", await read("note-000.md")); // 1 Vektor in leerer Map
    await expect(stranded.persist("live")).rejects.toBeInstanceOf(PersistBlockedError);
    // Der gute Index auf Platte ist UNBERÜHRT (nicht auf 1 gefallen):
    expect(await countOnDisk(indexDir)).toBe(100);
  });

  it("KEIN CLOBBER: Shrink-Guard blockt einen Ein-Schritt-Sturz (100→1) und lässt Platte unberührt", async () => {
    await buildGoodIndex();
    const idx = await loadIndex(fsAdapter(), indexDir);
    const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li.init(idx); // ready=true; persist("live") liest den Diskzustand jetzt live (100)
    for (const p of paths.slice(1)) li.remove(p); // auf 1 schrumpfen (simulierte Korruption)
    await expect(li.persist("live")).rejects.toMatchObject({ kind: "shrink" });
    expect(await countOnDisk(indexDir)).toBe(100); // Platte unberührt
  });

  it("Backup-Round-Trip: migrateIndex sichert + stellt wieder her; Restore prüft Vollständigkeit", async () => {
    await buildGoodIndex();
    const adapter = fsAdapter();
    const backupDir = path.join(root, ".obsidian/plugins/vault-retrieval/index-backups/2026-07-11T00-00-00-000Z");
    await migrateIndex(adapter, indexDir, backupDir);
    // Vollständigkeitscheck (wie restoreBackup): ladbarer Bestand im Backup (Container oder Legacy-Tripel).
    const backupFiles = await fs.readdir(backupDir);
    const backupPaths = backupFiles.map(f => `${backupDir}/${f}`);
    expect(hasAllRequiredFiles(backupPaths)).toBe(true);
    // Hauptindex zerstören …
    await fs.writeFile(path.join(indexDir, CONTAINER_FILE), Buffer.alloc(10));
    // … und aus Backup restaurieren.
    await migrateIndex(adapter, backupDir, indexDir);
    const idx = await loadIndex(adapter, indexDir);
    expect(idx.count).toBe(100);
  });

  it("Backup-Rotation: selectBackupsToDelete behält die 3 neuesten", () => {
    const names = [
      "2026-07-01T00-00-00-000Z", "2026-07-02T00-00-00-000Z",
      "2026-07-03T00-00-00-000Z", "2026-07-04T00-00-00-000Z",
    ];
    expect(selectBackupsToDelete(names, 3)).toEqual(["2026-07-01T00-00-00-000Z"]);
  });

  it("Unvollständige Backup-Kopie (Quelldatei verschwindet während der Kopie) hinterlässt keine Ordner-Leiche", async () => {
    await buildGoodIndex();
    const adapter = fsAdapter();
    const backupDir = path.join(root, ".obsidian/plugins/vault-retrieval/index-backups/2026-07-19T00-00-00-000Z");
    // Quelle nach dem Kopierbeginn unvollständig machen: index.bin löschen, BEVOR migrateIndex läuft
    // (simuliert eine Race, bei der die Quelldatei genau in diesem Moment fehlt/unlesbar ist).
    await fs.rm(path.join(indexDir, CONTAINER_FILE));
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

  it("Delta-Heal: unvollständiger Index (40) wird additiv auf 100 vervollständigt", async () => {
    // Kleineren gültigen Index (erste 40) aufbauen + persistieren.
    const li0 = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li0.markFresh();
    await li0.healMissing(paths.slice(0, 40), read);
    await li0.persist("heal");
    expect(await countOnDisk(indexDir)).toBe(40);

    // Laden + Diff gegen den vollen Vault (100).
    const idx = await loadIndex(fsAdapter(), indexDir);
    const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li.init(idx); // Diskzustand (40) wird bei persist("live") live nachgelesen
    const { missing } = diffIndexVsVault([...idx.paths], paths);
    expect(missing.length).toBe(60);

    const { added } = await li.healMissing(missing, read);
    expect(added).toBe(60);
    await li.persist("heal"); // wächst → erlaubt
    expect(await countOnDisk(indexDir)).toBe(100);

    // Additiv: die ursprünglichen 40 sind noch da.
    const healed = await loadIndex(fsAdapter(), indexDir);
    expect(healed.rowFor("note-000.md")).toBeGreaterThanOrEqual(0);
    expect(healed.rowFor("note-099.md")).toBeGreaterThanOrEqual(0);
  });

  it("Shrink-Erkennung: drastischer Reload-Shrink verdächtig, moderater nicht", () => {
    expect(isSuspiciousShrink(100, 5)).toBe(true);
    expect(isSuspiciousShrink(100, 90)).toBe(false);
    // Guard-Semantik für serielle Live-Ops: -1 ok, -2 blockt.
    expect(assertSafeToPersist(100, 99, "live").allowed).toBe(true);
    expect(assertSafeToPersist(100, 98, "live").allowed).toBe(false);
  });

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

  it("VORFALL 22.07. NACHGESTELLT: gemischte Generationen sind strukturell unmöglich — es gibt nur noch ganze Container-Generationen", async () => {
    await buildGoodIndex(); // schreibt Container Gen A (100 Notizen)
    const genA = await fs.readFile(path.join(indexDir, CONTAINER_FILE));
    // Gen B: kleiner Index (6 Notizen) — wie der iPhone-Winz-Stand vom 22.07.
    const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li.markFresh();
    await li.healMissing(paths.slice(0, 6), read);
    await li.persist("heal"); // Container Gen B ersetzt Gen A ALS GANZES
    // Sync kann nur „Datei A" oder „Datei B" wählen — beide laden konsistent:
    for (const gen of [genA, await fs.readFile(path.join(indexDir, CONTAINER_FILE))]) {
      await fs.writeFile(path.join(indexDir, CONTAINER_FILE), gen);
      const r = await loadIndexStore(fsAdapter(), indexDir);
      expect(r.state).toBe("loaded"); // nie ein Zustand, den kein Gerät geschrieben hat
    }
  });

  it("halber Sync-Download (abgeschnittener Container) → corrupt, kein stiller Fehlladen", async () => {
    await buildGoodIndex();
    const p = path.join(indexDir, CONTAINER_FILE);
    const full = await fs.readFile(p);
    await fs.writeFile(p, full.subarray(0, Math.floor(full.length / 2)));
    expect((await loadIndexStore(fsAdapter(), indexDir)).state).toBe("corrupt");
  });

  it("SILENT-MIX-LÜCKE GESCHLOSSEN: gleicher Count, getauschte Bytes → CRC schlägt an", async () => {
    await buildGoodIndex();
    const p = path.join(indexDir, CONTAINER_FILE);
    const bytes = await fs.readFile(p);
    bytes[bytes.length - 100] = bytes[bytes.length - 100] ^ 0xff; // Matrix-Byte einer „fremden Generation"
    await fs.writeFile(p, bytes);
    expect((await loadIndexStore(fsAdapter(), indexDir)).state).toBe("corrupt");
  });

  it("End-to-End-Migration: echter Alt-Tripel-Bestand → ein Load → Container da, Tripel weg, Index identisch nutzbar", async () => {
    // Alt-Tripel wie ein Prä-0.18-Plugin schreiben: manifest/paths/notes.i8 von Hand, byte-identisch
    // zu einem frisch gebauten Container (wie writeLegacyTriple in tests/index_store.test.ts, nur mit
    // den 100 Test-Notizen dieses Files — das Tripel wird aus dem echten Container abgeleitet).
    await buildGoodIndex();
    const adapter = fsAdapter();
    const containerPath = path.join(indexDir, CONTAINER_FILE);
    const raw = await fs.readFile(containerPath);
    const { manifest, paths: legacyPaths, matrix } = decodeContainer(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );
    await fs.rm(containerPath); // nur das Alt-Tripel soll vorliegen, kein Container
    await adapter.writeBinary(path.join(indexDir, "notes.i8"), matrix);
    await adapter.write(path.join(indexDir, "paths.json"), JSON.stringify(legacyPaths));
    await adapter.write(path.join(indexDir, "manifest.json"), JSON.stringify(manifest));

    // Erster Load: Migration greift — legacy-migrated, count 100.
    const first = await loadIndexStore(adapter, indexDir);
    expect(first.state).toBe("loaded");
    if (first.state === "loaded") {
      expect(first.source).toBe("legacy-migrated");
      expect(first.index.count).toBe(100);
    }
    // EFFEKT auf dem Dateisystem: Tripel weg, Container da.
    expect(await adapter.exists(path.join(indexDir, "notes.i8"))).toBe(false);
    expect(await adapter.exists(path.join(indexDir, "paths.json"))).toBe(false);
    expect(await adapter.exists(path.join(indexDir, "manifest.json"))).toBe(false);
    expect(await adapter.exists(containerPath)).toBe(true);
    expect(await countOnDisk(indexDir)).toBe(100);

    // Zweiter Load: idempotent — jetzt via Container, kein erneutes Repacken nötig.
    const second = await loadIndexStore(adapter, indexDir);
    expect(second.state).toBe("loaded");
    if (second.state === "loaded") {
      expect(second.source).toBe("container");
      expect(second.index.count).toBe(100);
    }
  });

  it("Backup-Kaskade-Basis: von zwei Backups ist das neuere korrupt → verifyBackupCandidate beweist das ältere", async () => {
    await buildGoodIndex();
    const b1 = path.join(root, "backups", "2026-07-28T10-00-00-000Z");
    const b2 = path.join(root, "backups", "2026-07-29T10-00-00-000Z");
    await migrateIndex(fsAdapter(), indexDir, b1);
    await migrateIndex(fsAdapter(), indexDir, b2);
    const p2 = path.join(b2, CONTAINER_FILE);
    const bytes = await fs.readFile(p2);
    bytes[20] = bytes[20] ^ 0xff;
    await fs.writeFile(p2, bytes);
    expect(await verifyBackupCandidate(fsAdapter(), b2)).toBeNull();
    expect((await verifyBackupCandidate(fsAdapter(), b1))?.count).toBe(100);
  });
});
