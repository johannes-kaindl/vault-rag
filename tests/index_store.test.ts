import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VaultAdapter, IndexManifest } from "../src/index";
import { CONTAINER_FILE, encodeContainer, decodeContainer } from "../src/index_container";
import { loadIndexStore, verifyBackupCandidate } from "../src/index_store";

const DIM = 4;

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

function makeManifest(count: number): IndexManifest {
  return { schema_version: 1, embedding_model: "fake", index_dim: DIM, scale: 127, count, granularity: "note", quant: "int8" };
}
function makeMatrix(count: number): Uint8Array {
  const m = new Uint8Array(count * DIM);
  for (let i = 0; i < m.length; i++) m[i] = (i % 200) - 100;
  return m;
}
const PATHS3 = ["a.md", "b.md", "c.md"];

describe("index_store", () => {
  let root: string; let dir: string; let a: VaultAdapter;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vaultrag-store-"));
    dir = path.join(root, "_vaultrag");
    a = fsAdapter();
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  async function writeLegacyTriple(count = 3, paths = PATHS3): Promise<void> {
    await a.mkdir(dir);
    await a.writeBinary(`${dir}/notes.i8`, makeMatrix(count).buffer);
    await a.write(`${dir}/paths.json`, JSON.stringify(paths));
    await a.write(`${dir}/manifest.json`, JSON.stringify(makeManifest(count)));
  }
  async function writeContainer(count = 3, paths = PATHS3): Promise<void> {
    await a.mkdir(dir);
    await a.writeBinary(`${dir}/${CONTAINER_FILE}`, encodeContainer(makeManifest(count), paths, makeMatrix(count)));
  }

  it("Container vorhanden → loaded (source container)", async () => {
    await writeContainer();
    const r = await loadIndexStore(a, dir);
    expect(r.state).toBe("loaded");
    if (r.state === "loaded") { expect(r.source).toBe("container"); expect(r.index.count).toBe(3); }
  });

  it("nur Legacy-Tripel → Migration: loaded, Container existiert, Tripel weg, pending.json überlebt", async () => {
    await writeLegacyTriple();
    await a.write(`${dir}/pending.json`, JSON.stringify(["x.md"]));
    const r = await loadIndexStore(a, dir);
    expect(r.state).toBe("loaded");
    if (r.state === "loaded") { expect(r.source).toBe("legacy-migrated"); expect(r.index.count).toBe(3); }
    // EFFEKT auf dem Dateisystem:
    expect(await a.exists(`${dir}/${CONTAINER_FILE}`)).toBe(true);
    expect(await a.exists(`${dir}/notes.i8`)).toBe(false);
    expect(await a.exists(`${dir}/paths.json`)).toBe(false);
    expect(await a.exists(`${dir}/manifest.json`)).toBe(false);
    expect(await a.exists(`${dir}/pending.json`)).toBe(true);
  });

  it("Migration ist BYTE-LEVEL: Matrix im Container ist identisch zum alten notes.i8", async () => {
    await writeLegacyTriple();
    await loadIndexStore(a, dir);
    const { matrix } = decodeContainer(await a.readBinary(`${dir}/${CONTAINER_FILE}`));
    expect(new Uint8Array(matrix)).toEqual(makeMatrix(3));
  });

  it("Container UND Tripel vorhanden → Container gewinnt, Tripel wird still aufgeräumt", async () => {
    await writeContainer(3);
    await writeLegacyTriple(1, ["alt.md"]); // z. B. von einem Alt-Geräte-Plugin nachgeschrieben
    const r = await loadIndexStore(a, dir);
    expect(r.state).toBe("loaded");
    if (r.state === "loaded") { expect(r.source).toBe("container"); expect(r.index.count).toBe(3); }
    expect(await a.exists(`${dir}/notes.i8`)).toBe(false);
    expect(await a.exists(`${dir}/manifest.json`)).toBe(false);
  });

  it("nichts vorhanden → no-index", async () => {
    expect((await loadIndexStore(a, dir)).state).toBe("no-index");
  });

  it("korrupter Container (Bit-Flip) → corrupt; Datei bleibt unangetastet", async () => {
    await writeContainer();
    const p = `${dir}/${CONTAINER_FILE}`;
    const bytes = new Uint8Array(await a.readBinary(p));
    bytes[10] = bytes[10] ^ 0xff;
    await a.writeBinary(p, bytes.buffer);
    expect((await loadIndexStore(a, dir)).state).toBe("corrupt");
    expect(await a.exists(p)).toBe(true);
  });

  it("korruptes Legacy-Tripel (count-Mismatch) → corrupt; KEINE Migration, Tripel bleibt", async () => {
    await writeLegacyTriple(3);
    await a.write(`${dir}/paths.json`, JSON.stringify(["nur-einer.md"])); // count 3 ≠ 1 Pfad
    expect((await loadIndexStore(a, dir)).state).toBe("corrupt");
    expect(await a.exists(`${dir}/${CONTAINER_FILE}`)).toBe(false);
    expect(await a.exists(`${dir}/notes.i8`)).toBe(true);
  });

  it("verifyBackupCandidate: Container-Backup wird bewiesen geladen", async () => {
    const bdir = path.join(root, "backup-1");
    await a.mkdir(bdir);
    await a.writeBinary(`${bdir}/${CONTAINER_FILE}`, encodeContainer(makeManifest(3), PATHS3, makeMatrix(3)));
    const idx = await verifyBackupCandidate(a, bdir);
    expect(idx?.count).toBe(3);
  });

  it("verifyBackupCandidate: Legacy-Tripel-Backup (Prä-0.18-Bestand) wird geladen", async () => {
    const bdir = path.join(root, "backup-legacy");
    await a.mkdir(bdir);
    await a.writeBinary(`${bdir}/notes.i8`, makeMatrix(2).buffer);
    await a.write(`${bdir}/paths.json`, JSON.stringify(["a.md", "b.md"]));
    await a.write(`${bdir}/manifest.json`, JSON.stringify(makeManifest(2)));
    const idx = await verifyBackupCandidate(a, bdir);
    expect(idx?.count).toBe(2);
  });

  it("verifyBackupCandidate: korruptes Backup → null (kein Throw)", async () => {
    const bdir = path.join(root, "backup-bad");
    await a.mkdir(bdir);
    await a.writeBinary(`${bdir}/${CONTAINER_FILE}`, new Uint8Array([1, 2, 3]).buffer);
    expect(await verifyBackupCandidate(a, bdir)).toBeNull();
  });

  it("verifyBackupCandidate: leerer Ordner → null", async () => {
    const bdir = path.join(root, "backup-leer");
    await a.mkdir(bdir);
    expect(await verifyBackupCandidate(a, bdir)).toBeNull();
  });
});
