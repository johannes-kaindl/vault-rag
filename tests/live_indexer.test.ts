import { describe, it, expect, vi } from "vitest";
import { LiveIndexer } from "../src/live_indexer";
import { VaultAdapter, parseIndex, VaultIndex } from "../src/index";
import { EmbeddingClient } from "../src/embedder";

const DIM = 256;
const SCALE = 127;

function makeAdapter(): VaultAdapter & { written: Map<string, ArrayBuffer | string> } {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: vi.fn().mockRejectedValue(new Error("not found")),
    readBinary: vi.fn(),
    write: vi.fn(async (p: string, d: string) => { written.set(p, d); }),
    writeBinary: vi.fn(async (p: string, d: ArrayBuffer) => { written.set(p, d); }),
    mkdir: vi.fn(),
    written,
  } as any;
}

function makeEmbedder(vec?: number[]): EmbeddingClient {
  const v = vec ?? [1, ...Array(DIM - 1).fill(0)];
  return {
    ping: vi.fn().mockResolvedValue(true),
    embed: vi.fn().mockResolvedValue([new Float32Array(v)]),
  } as unknown as EmbeddingClient;
}

function emptyIndex(): VaultIndex {
  const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: 0, granularity: "note", quant: "int8" };
  return parseIndex(manifest, [], new ArrayBuffer(0));
}

function oneNoteIndex(path: string): VaultIndex {
  const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: 1, granularity: "note", quant: "int8" };
  const i8 = new Int8Array(DIM);
  i8[0] = SCALE; // [1, 0, 0, …] normalisiert
  return parseIndex(manifest, [path], i8.buffer);
}

describe("LiveIndexer", () => {
  it("init befüllt noteVectors aus Index", () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    const idx = indexer.buildIndex();
    expect(idx.count).toBe(1);
    expect(idx.rowFor("a.md")).toBe(0);
  });

  it("update fügt neue Notiz zum Index hinzu", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("notes/new.md", "# Heading\nInhalt");
    const idx = indexer.buildIndex();
    expect(idx.count).toBe(1);
    expect(idx.rowFor("notes/new.md")).toBe(0);
  });

  it("update überschreibt bestehenden Vektor", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    await indexer.update("a.md", "neuer Inhalt");
    expect(indexer.buildIndex().count).toBe(1);
  });

  it("update mit leerem Inhalt entfernt Notiz", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    await indexer.update("a.md", "---\ntitle: x\n---\n   "); // nur Frontmatter
    expect(indexer.buildIndex().count).toBe(0);
  });

  it("remove entfernt Notiz aus Index", () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("a.md"));
    indexer.remove("a.md");
    expect(indexer.buildIndex().count).toBe(0);
  });

  it("rename benennt Pfad um", () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(oneNoteIndex("old.md"));
    indexer.rename("old.md", "new.md");
    const idx = indexer.buildIndex();
    expect(idx.rowFor("old.md")).toBe(-1);
    expect(idx.rowFor("new.md")).toBe(0);
  });

  it("persist schreibt notes.i8, paths.json, manifest.json in dieser Reihenfolge", async () => {
    const adapter = makeAdapter();
    const order: string[] = [];
    (adapter.writeBinary as any).mockImplementation(async (p: string) => { order.push(p); });
    (adapter.write as any).mockImplementation(async (p: string) => { order.push(p); });

    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.persist();

    expect(order[0]).toContain("notes.i8");
    expect(order[1]).toContain("paths.json");
    expect(order[2]).toContain("manifest.json");
  });

  it("persist schreibt korrektes int8-Format (Quantisierung)", async () => {
    const adapter = makeAdapter();
    const indexer = new LiveIndexer(adapter, "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("a.md", "Inhalt");
    await indexer.persist();

    const i8call = (adapter.writeBinary as any).mock.calls.find((c: string[]) => c[0].endsWith("notes.i8"));
    expect(i8call).toBeTruthy();
    const buf = i8call[1] as ArrayBuffer;
    expect(buf.byteLength).toBe(DIM); // 1 Notiz × 256 Dims × 1 Byte
    const arr = new Int8Array(buf);
    expect(arr[0]).toBe(SCALE); // erster Dim = 1.0 * 127 = 127
  });

  it("resultierender buildIndex liefert ähnliche Vektoren für identische Inhalte", async () => {
    const vec = Array(DIM).fill(0); vec[5] = 1;
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(vec), "qwen3-embedding:8b");
    indexer.init(emptyIndex());
    await indexer.update("a.md", "x");
    await indexer.update("b.md", "x");
    const idx = indexer.buildIndex();
    const a = idx.vectorFor("a.md")!;
    const b = idx.vectorFor("b.md")!;
    let dot = 0;
    for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
    expect(dot).toBeGreaterThan(0.99);
  });

  it("noteCount gibt die Anzahl der bekannten Notizen zurück", async () => {
    const adapter = makeAdapter();
    const embedder = makeEmbedder();
    const indexer = new LiveIndexer(adapter, "_vaultrag", embedder, "qwen3-embedding:8b");
    expect(indexer.noteCount).toBe(0);
    await indexer.update("a.md", "Hallo Welt das ist ein langer Text für einen Chunk");
    expect(indexer.noteCount).toBe(1);
    indexer.remove("a.md");
    expect(indexer.noteCount).toBe(0);
  });

  describe("reindexAll", () => {
    it("indiziert alle übergebenen Pfade und buildIndex enthält genau diese Pfade", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      const read = vi.fn(async (p: string) => `# ${p}\nInhalt`);
      await indexer.reindexAll(["a.md", "b.md", "c.md"], read);
      expect(indexer.noteCount).toBe(3);
      const idx = indexer.buildIndex();
      expect(idx.paths).toEqual(["a.md", "b.md", "c.md"]);
    });

    it("ruft onProgress als (done,indexed,total) auf — (1,1,N)…(N,N,N)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      const progress: Array<[number, number, number]> = [];
      const read = vi.fn(async (p: string) => `# ${p}\nInhalt`);
      await indexer.reindexAll(["x.md", "y.md", "z.md"], read, (done, indexed, total) => { progress.push([done, indexed, total]); });
      expect(progress).toEqual([[1, 1, 3], [2, 2, 3], [3, 3, 3]]);
    });

    it("reindexAll ersetzt den Index erst am Ende — vorheriger Index bleibt bis zum Abschluss abrufbar (kein Datenverlust bei Abbruch)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      // init with 3-note full index
      const idx0 = (() => {
        const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: DIM, scale: SCALE, count: 3, granularity: "note", quant: "int8" };
        const i8 = new Int8Array(3 * DIM);
        i8[0] = SCALE; i8[DIM] = SCALE; i8[2 * DIM] = SCALE;
        return parseIndex(manifest, ["a.md", "b.md", "c.md"], i8.buffer);
      })();
      indexer.init(idx0);
      expect(indexer.noteCount).toBe(3);

      // capture snapshot of live noteVectors during first read() call
      let snapshotPaths: string[] = [];
      let firstRead = true;
      const read = vi.fn(async (p: string) => {
        if (firstRead) {
          firstRead = false;
          // At this point reindexAll is mid-flight — old index must still be visible
          snapshotPaths = indexer.buildIndex().paths;
        }
        return `# ${p}\nInhalt`;
      });

      await indexer.reindexAll(["neu1.md", "neu2.md"], read);

      // During reindexAll: old 3-note index was still intact
      expect(snapshotPaths).toEqual(["a.md", "b.md", "c.md"]);
      // After reindexAll: new 2-note index
      expect(indexer.buildIndex().paths).toEqual(["neu1.md", "neu2.md"]);
    });

    it("überspringt eine Notiz deren read wirft, andere werden trotzdem indiziert", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      const read = vi.fn(async (p: string) => {
        if (p === "fehler.md") throw new Error("unlesbar");
        return `# ${p}\nInhalt`;
      });
      await indexer.reindexAll(["a.md", "fehler.md", "c.md"], read);
      expect(indexer.noteCount).toBe(2);
      const idx = indexer.buildIndex();
      expect(idx.paths).toEqual(["a.md", "c.md"]);
    });

    it("löscht noteVectors vor dem Neuindizieren (veralteter Pfad wird entfernt)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      // Alten Stand per init laden
      indexer.init(oneNoteIndex("alt.md"));
      expect(indexer.noteCount).toBe(1);
      const read = vi.fn(async (p: string) => `# ${p}\nInhalt`);
      await indexer.reindexAll(["neu.md"], read);
      expect(indexer.noteCount).toBe(1);
      const idx = indexer.buildIndex();
      expect(idx.paths).toEqual(["neu.md"]);
    });

    it("leere Notiz wird übersprungen (kein Chunk → noteVectors bleibt leer)", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "qwen3-embedding:8b");
      // nur Frontmatter, kein Body → chunkMarkdown liefert []
      const read = vi.fn(async () => "---\ntitle: leer\n---\n   ");
      await indexer.reindexAll(["leer.md"], read);
      expect(indexer.noteCount).toBe(0);
    });
  });
});
