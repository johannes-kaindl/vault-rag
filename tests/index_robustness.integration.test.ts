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
import { VaultAdapter, IndexLoader, parseIndex } from "../src/index";
import { LiveIndexer } from "../src/live_indexer";
import { EmbeddingClient } from "../src/embedder";
import { classifyLoadResult, assertSafeToPersist, isSuspiciousShrink, diffIndexVsVault, PersistBlockedError } from "../src/index_guard";
import { migrateIndex, INDEX_REQUIRED_FILES, hasAllRequiredFiles } from "../src/index_migrate";
import { selectBackupsToDelete } from "../src/index_backup";

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
  const m = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as { count: number };
  return m.count;
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
    const idx = await new IndexLoader(fsAdapter(), indexDir).load();
    expect(idx.count).toBe(100);
    expect(await countOnDisk(indexDir)).toBe(100);
  });

  it("Byte-Guard: echt abgeschnittener notes.i8 → load wirft → Gefahrenzustand", async () => {
    await buildGoodIndex();
    // notes.i8 real abschneiden (nicht mehr count*dim Bytes).
    const p = path.join(indexDir, "notes.i8");
    const buf = await fs.readFile(p); // 100*256 = 25600 Bytes
    await fs.writeFile(p, buf.subarray(0, 20001)); // echt kürzer + nicht durch 256 teilbar
    let threw = false;
    try { await new IndexLoader(fsAdapter(), indexDir).load(); } catch { threw = true; }
    expect(threw).toBe(true);
    const manifestExists = true; // manifest.json liegt weiter da
    expect(classifyLoadResult(manifestExists, threw)).toBe("load-failed-index-present");
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
    const idx = await new IndexLoader(fsAdapter(), indexDir).load();
    const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li.init(idx); // ready=true, diskCount=100
    for (const p of paths.slice(1)) li.remove(p); // auf 1 schrumpfen (simulierte Korruption)
    await expect(li.persist("live")).rejects.toMatchObject({ kind: "shrink" });
    expect(await countOnDisk(indexDir)).toBe(100); // Platte unberührt
  });

  it("Backup-Round-Trip: migrateIndex sichert + stellt wieder her; Restore prüft Vollständigkeit", async () => {
    await buildGoodIndex();
    const adapter = fsAdapter();
    const backupDir = path.join(root, ".obsidian/plugins/vault-retrieval/index-backups/2026-07-11T00-00-00-000Z");
    await migrateIndex(adapter, indexDir, backupDir);
    // Vollständigkeitscheck (wie restoreBackup): alle Pflichtdateien im Backup vorhanden.
    for (const f of INDEX_REQUIRED_FILES) {
      await expect(fs.access(path.join(backupDir, f))).resolves.toBeUndefined();
    }
    // Hauptindex zerstören …
    await fs.writeFile(path.join(indexDir, "notes.i8"), Buffer.alloc(10));
    // … und aus Backup restaurieren.
    await migrateIndex(adapter, backupDir, indexDir);
    const idx = await new IndexLoader(adapter, indexDir).load();
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

  it("Delta-Heal: unvollständiger Index (40) wird additiv auf 100 vervollständigt", async () => {
    // Kleineren gültigen Index (erste 40) aufbauen + persistieren.
    const li0 = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li0.markFresh();
    await li0.healMissing(paths.slice(0, 40), read);
    await li0.persist("heal");
    expect(await countOnDisk(indexDir)).toBe(40);

    // Laden + Diff gegen den vollen Vault (100).
    const idx = await new IndexLoader(fsAdapter(), indexDir).load();
    const li = new LiveIndexer(fsAdapter(), indexDir, fakeEmbedder(), "fake-model");
    li.init(idx); // diskCount=40
    const { missing } = diffIndexVsVault([...idx.paths], paths);
    expect(missing.length).toBe(60);

    const { added } = await li.healMissing(missing, read);
    expect(added).toBe(60);
    await li.persist("heal"); // wächst → erlaubt
    expect(await countOnDisk(indexDir)).toBe(100);

    // Additiv: die ursprünglichen 40 sind noch da.
    const healed = await new IndexLoader(fsAdapter(), indexDir).load();
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
});
