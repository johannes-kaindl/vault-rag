import { describe, it, expect, vi } from "vitest";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import type { VaultAdapter } from "../src/index";
import type { Embedder } from "../src/vendor/kit/embeddings-client";
import { CONTAINER_FILE, encodeContainer } from "../src/vendor/kit/index-container";

/**
 * Task „Leerer Index auf Platte sperrt Schreibvorgänge anderer Modelle — der Schreib-Guard liest count nicht“ (Welle 33, gemessen 2026-11-12).
 * Ein Container mit `count: 0` und fremdem Modellstempel legt kein Modell fest (derselbe Grundsatz wie `indexedModel` in `main.ts`): `persist("live")` und
 * `checkModelAgainstDisk("heal")` des echten LiveIndexers dürfen ihn nicht mit `model-mismatch` sperren. Gegenprobe: mit einer Zeile bleibt die Sperre.
 */
const DIM = 256;

function adapter(): VaultAdapter & { written: Map<string, ArrayBuffer | string> } {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: vi.fn(async (p: string) => { if (!written.has(p)) throw new Error("not found: " + p); return written.get(p) as string; }),
    readBinary: vi.fn(async (p: string) => { if (!written.has(p)) throw new Error("not found: " + p); return written.get(p) as ArrayBuffer; }),
    write: vi.fn(async (p: string, d: string) => { written.set(p, d); }),
    writeBinary: vi.fn(async (p: string, d: ArrayBuffer) => { written.set(p, d); }),
    mkdir: vi.fn(),
    exists: vi.fn(async (p: string) => written.has(p)),
    remove: vi.fn(async (p: string) => { written.delete(p); }),
    written,
  } as never;
}

function embedder(): Embedder {
  return { ping: vi.fn().mockResolvedValue(true), embed: vi.fn().mockResolvedValue([new Float32Array([1, ...Array(DIM - 1).fill(0)])]) } as unknown as Embedder;
}

function containerAufPlatte(count: number, model: string): ArrayBuffer {
  const manifest = { schema_version: 1, embedding_model: model, index_dim: DIM, scale: 127, count, granularity: "note", quant: "int8" };
  return encodeContainer(manifest, Array.from({ length: count }, (_, i) => `platte-${i}.md`), new Uint8Array(count * DIM));
}

function indexerMitPlatte(count: number) {
  const a = adapter();
  a.written.set(`_vaultrag/${CONTAINER_FILE}`, containerAufPlatte(count, "qwen3-embedding:8b"));
  const indexer = new LiveIndexer(a, "_vaultrag", embedder(), "text-embedding-3-small");
  indexer.markFresh();
  return { a, indexer };
}

describe("leerer Container auf Platte (count 0) legt kein Modell fest", () => {
  it("persist(live) mit anderem Modell ist erlaubt", async () => {
    const { indexer } = indexerMitPlatte(0);
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).resolves.toBeUndefined();
  });

  it("checkModelAgainstDisk(heal) mit anderem Modell ist erlaubt", async () => {
    const { indexer } = indexerMitPlatte(0);
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: true });
  });

  it("Gegenprobe: mit einer Zeile auf Platte bleibt das fremde Modell gesperrt", async () => {
    const { indexer } = indexerMitPlatte(1);
    await indexer.update("a.md", "#A");
    await expect(indexer.persist("live")).rejects.toMatchObject({ kind: "model-mismatch" });
    expect(await indexer.checkModelAgainstDisk("heal")).toMatchObject({ allowed: false, kind: "model-mismatch" });
  });
});
