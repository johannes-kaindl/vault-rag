import { describe, it, expect, vi } from "vitest";
import { LiveIndexer } from "../src/live_indexer";
import { VaultAdapter, parseIndex, VaultIndex } from "../src/index";
import { EmbeddingClient } from "../src/embedder";
import { PersistBlockedError } from "../src/index_guard";

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

  describe("LiveIndexer.healMissing", () => {
    it("behält vorhandene Vektoren und ergänzt nur fehlende", async () => {
      const a = makeAdapter();
      const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      await indexer.update("a.md", "#A");         // vorhanden
      const contents: Record<string, string> = { "b.md": "#B", "c.md": "#C" };
      const { added } = await indexer.healMissing(["b.md", "c.md"], async (p) => contents[p]);
      expect(added).toBe(2);
      const idx = indexer.buildIndex();
      expect(idx.count).toBe(3);
      expect(idx.rowFor("a.md")).toBeGreaterThanOrEqual(0);
      expect(idx.rowFor("b.md")).toBeGreaterThanOrEqual(0);
      expect(idx.rowFor("c.md")).toBeGreaterThanOrEqual(0);
    });

    it("überspringt unlesbare Dateien ohne Abbruch", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const { added } = await indexer.healMissing(["x.md", "y.md"], async (p) => {
        if (p === "x.md") throw new Error("weg");
        return "#Y";
      });
      expect(added).toBe(1);
      expect(indexer.buildIndex().rowFor("y.md")).toBeGreaterThanOrEqual(0);
    });

    it("meldet Fortschritt", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const seen: Array<[number, number, number]> = [];
      await indexer.healMissing(["a.md", "b.md"], async () => "#X", (d, i, t) => seen.push([d, i, t]));
      expect(seen[seen.length - 1]).toEqual([2, 2, 2]);
    });

    it("klassifiziert ergänzt / leer übersprungen / fehlgeschlagen", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const contents: Record<string, string> = {
        "voll.md": "# A\nInhalt",
        "leer.md": "---\ntitle: leer\n---\n   ",
      };
      const result = await indexer.healMissing(["voll.md", "leer.md", "weg.md"], async (p) => {
        if (!(p in contents)) throw new Error("weg");
        return contents[p];
      });
      expect(result.added).toBe(1);
      expect(result.skippedEmpty).toEqual(["leer.md"]);
      expect(result.failed).toEqual(["weg.md"]);
      // leer.md darf NICHT im Index landen
      expect(indexer.buildIndex().paths).toEqual(["voll.md"]);
    });
  });

  describe("LiveIndexer.update Klassifikation", () => {
    it("meldet 'indexed' für Notiz mit Inhalt und 'empty' für chunk-lose", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.init(emptyIndex());
      expect(await indexer.update("a.md", "# Inhalt")).toBe("indexed");
      expect(await indexer.update("a.md", "---\ntitle: x\n---\n")).toBe("empty");
      expect(indexer.noteCount).toBe(0);
    });
  });

  describe("LiveIndexer.reindexAll Klassifikation", () => {
    it("meldet skippedEmpty und failed wie healMissing", async () => {
      const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
      indexer.markFresh();
      const contents: Record<string, string> = {
        "voll.md": "# A\nInhalt",
        "leer.md": "---\ntitle: leer\n---\n",
      };
      const result = await indexer.reindexAll(["voll.md", "leer.md", "weg.md"], async (p) => {
        if (!(p in contents)) throw new Error("weg");
        return contents[p];
      });
      expect(result.added).toBe(1);
      expect(result.skippedEmpty).toEqual(["leer.md"]);
      expect(result.failed).toEqual(["weg.md"]);
    });
  });
});

describe("LiveIndexer persist-Guard", () => {
  it("frisch konstruiert ist NICHT ready → live-persist wirft not-ready", async () => {
    const indexer = new LiveIndexer(makeAdapter(), "_vaultrag", makeEmbedder(), "m");
    await expect(indexer.persist("live")).rejects.toBeInstanceOf(PersistBlockedError);
    expect(indexer.isReady()).toBe(false);
  });

  it("markFresh macht ready → leerer Vault darf aufbauen (0→1)", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "# A");
    await expect(indexer.persist("live")).resolves.toBeUndefined();
    expect(a.written.has("_vaultrag/manifest.json")).toBe(true);
  });

  it("init setzt diskCount → Clobber (großer Index, dann leer) wird geblockt", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    // 3-Noten-Index simulieren via init
    const big = oneNoteIndex("a.md"); // count 1 – wir brauchen >1; baue 3 per reindex
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B"); await indexer.update("c.md", "#C");
    await indexer.persist("live");           // diskCount = 3
    // jetzt Map leeren (simuliert verwirrten Zustand) und live-persist → Sturz 3→0
    indexer.remove("a.md"); indexer.remove("b.md"); indexer.remove("c.md");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "shrink" });
    void big;
  });

  it("reindex-Grund darf schrumpfen", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B");
    await indexer.persist("live");           // diskCount = 2
    indexer.remove("a.md"); indexer.remove("b.md");
    await expect(indexer.persist("reindex")).resolves.toBeUndefined(); // 2→0 erlaubt
  });

  it("erfolgreicher persist aktualisiert diskCount (Löschungen bleiben möglich)", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A"); await indexer.update("b.md", "#B");
    await indexer.persist("live");           // diskCount = 2
    indexer.remove("b.md");
    await expect(indexer.persist("live")).resolves.toBeUndefined(); // 2→1 (-1) erlaubt
  });

  it("markUnready blockt live-persist mid-session, auch wenn der Indexer zuvor schon ready war", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await indexer.persist("live"); // ready war true, persist erfolgreich
    expect(indexer.isReady()).toBe(true);

    indexer.markUnready(); // Gefahrenzustand mid-session (z.B. maybeReload → load-failed-index-present)
    expect(indexer.isReady()).toBe(false);
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "not-ready" });
  });

  it("nach markUnready stellt ein erneutes init() den ready-Zustand wieder her", async () => {
    const a = makeAdapter();
    const indexer = new LiveIndexer(a, "_vaultrag", makeEmbedder(), "m");
    indexer.markFresh();
    await indexer.update("a.md", "#A");
    await indexer.persist("live");

    indexer.markUnready();
    await expect(indexer.persist("live")).rejects.toBeInstanceOf(PersistBlockedError);

    indexer.init(oneNoteIndex("a.md")); // z.B. erfolgreicher Reload/Recovery
    expect(indexer.isReady()).toBe(true);
    await expect(indexer.persist("live")).resolves.toBeUndefined();
  });
});
