import { describe, it, expect, vi } from "vitest";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import { parseIndex } from "../src/vendor/kit/vector-index";
import { CONTAINER_FILE, encodeContainer, decodeContainer, type FileStamp } from "../src/vendor/kit/index-container";
import type { Embedder } from "../src/vendor/kit/embeddings-client";
import { countUnstampedRows } from "../src/vendor/kit/index-guard";

// Welle 27: `resolveAndReconnectEmbedder`, `attemptAutoHeal` und der Rückfall in `maybeReload` säen einen LiveIndexer aus einem VectorIndex neu.
// Der Index trägt keine Stempel; ohne den Snapshot des Vorgängers schreibt der nächste Persist `[0, 0]` für jede Zeile, die er nicht selbst anfasst
// (so wurden aus 20 echten Stempeln im Staging-Vault 18 Zeilen ohne Stempel; im Pallas-Index 11 670 von 11 671).
const DIM = 256;
function adapter() {
  const w = new Map<string, ArrayBuffer | string>();
  return {
    read: vi.fn(async (p: string) => { if (!w.has(p)) throw new Error("nf"); return w.get(p) as string; }),
    readBinary: vi.fn(async (p: string) => { if (!w.has(p)) throw new Error("nf"); return w.get(p) as ArrayBuffer; }),
    write: vi.fn(async (p: string, d: string) => { w.set(p, d); }),
    writeBinary: vi.fn(async (p: string, d: ArrayBuffer) => { w.set(p, d); }),
    mkdir: vi.fn(), exists: vi.fn(async (p: string) => w.has(p)), remove: vi.fn(), w,
  } as never as { w: Map<string, ArrayBuffer | string> } & import("../src/index").VaultAdapter;
}
const embedder = { ping: vi.fn().mockResolvedValue(true), embed: vi.fn().mockResolvedValue([new Float32Array([1, ...Array(DIM - 1).fill(0)])]) } as unknown as Embedder;

const PATHS = ["a.md", "b.md", "c.md"];
const STAMPS: FileStamp[] = [[100, 10], [200, 20], [300, 30]];
const manifest = { schema_version: 2, embedding_model: "m", dim: DIM, index_dim: DIM, scale: 127, count: 3, built_at: "2026-01-01T00:00:00.000Z" } as never;

function seeded() {
  const a = adapter();
  a.w.set(`d/${CONTAINER_FILE}`, encodeContainer(manifest, PATHS, new Uint8Array(3 * DIM).fill(1), STAMPS));
  const dec = decodeContainer(a.w.get(`d/${CONTAINER_FILE}`) as ArrayBuffer);
  const idx = parseIndex(dec.manifest as never, dec.paths, dec.matrix);
  const old = new LiveIndexer(a, "d", embedder, "m", { dim: DIM });
  old.init(idx, dec.stamps);
  return { a, idx, old };
}
const stampsOnDisk = (a: ReturnType<typeof adapter>) => decodeContainer(a.w.get(`d/${CONTAINER_FILE}`) as ArrayBuffer).stamps;

describe("Neusäen des LiveIndexer — die Stempel des Vorgängers gehen mit", () => {
  it("mit stampsSnapshot() bleiben die Stempel der nicht angefassten Zeilen nach einem Update und Persist erhalten", async () => {
    const { a, idx, old } = seeded();
    const next = new LiveIndexer(a, "d", embedder, "m", { dim: DIM });
    next.init(idx, old.stampsSnapshot());
    await next.update("b.md", "neuer Text\n\nAbsatz", [999, 99]);
    await next.persist("live");
    expect(stampsOnDisk(a)).toEqual([[100, 10], [999, 99], [300, 30]]);
    expect(countUnstampedRows(stampsOnDisk(a))).toBe(0);
  });

  it("Gegenprobe: ohne den Snapshot (der alte Aufruf `init(index)`) stehen die übrigen Zeilen auf [0, 0]", async () => {
    const { a, idx } = seeded();
    const next = new LiveIndexer(a, "d", embedder, "m", { dim: DIM });
    next.init(idx);
    await next.update("b.md", "neuer Text\n\nAbsatz", [999, 99]);
    await next.persist("live");
    expect(stampsOnDisk(a)).toEqual([[0, 0], [999, 99], [0, 0]]);
    expect(countUnstampedRows(stampsOnDisk(a))).toBe(2);
  });

  it("der Snapshot ist eine Kopie: eine spätere Änderung am Vorgänger ändert den Nachfolger nicht, und es wird nichts nachgestempelt", async () => {
    const { a, idx, old } = seeded();
    const snap = old.stampsSnapshot();
    snap.delete("c.md");                        // c.md hatte keinen Stempel
    const next = new LiveIndexer(a, "d", embedder, "m", { dim: DIM });
    next.init(idx, snap);
    await old.update("a.md", "ganz anderer Text\n\nAbsatz", [555, 55]);   // der Vorgänger arbeitet weiter
    await next.update("b.md", "neuer Text\n\nAbsatz", [999, 99]);
    await next.persist("live");
    expect(stampsOnDisk(a)).toEqual([[100, 10], [999, 99], [0, 0]]);
  });
});
