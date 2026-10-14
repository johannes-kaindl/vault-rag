import { describe, it, expect, vi } from "vitest";
import { EmbeddingPause, EmbeddingPausedError, type PauseStorage } from "../src/embedding_pause";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import { CONTAINER_FILE } from "../src/vendor/kit/index-container";
import type { Embedder } from "../src/vendor/kit/embeddings-client";

function memStorage(): PauseStorage {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { d.set(k, v); }, removeItem: (k) => { d.delete(k); } };
}
const DIM = 256;
/** Vektor hängt vom TEXT ab (ein Versatz um eine Zeile fiele sonst nicht auf). */
function textEmbedder(calls: string[][]): Embedder {
  return {
    embed: vi.fn(async (texts: string[]) => {
      calls.push(texts);
      return texts.map((x) => { let h = 0; for (const c of x) h = (h * 31 + c.charCodeAt(0)) % (DIM - 1); const v = new Float32Array(DIM); v[h + 1] = 1; return v; });
    }),
  } as unknown as Embedder;
}
function adapter() {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: async (p: string) => { if (!written.has(p)) throw new Error("nf"); return written.get(p) as string; },
    readBinary: async (p: string) => { if (!written.has(p)) throw new Error("nf"); return written.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { written.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { written.set(p, d); },
    mkdir: async () => {}, exists: async (p: string) => written.has(p), remove: async (p: string) => { written.delete(p); }, written,
  } as any;
}

describe("EmbeddingPause.gate", () => {
  it("throw: bei Pause scheitert der Aufruf typisiert und die Gegenstelle sieht KEINEN Aufruf; ohne Pause geht er durch (Gegenprobe)", async () => {
    const calls: string[][] = []; const pause = new EmbeddingPause(memStorage());
    const e = pause.gate(() => textEmbedder(calls), "throw");
    await e.embed(["a"]);
    expect(calls.length).toBe(1);                       // Gegenprobe: ohne Pause geht der Aufruf durch
    pause.setPaused(true);
    await expect(e.embed(["b"])).rejects.toBeInstanceOf(EmbeddingPausedError);
    expect(calls.length).toBe(1);                       // pausiert: nichts ging hinaus
  });
  it("wait: der Aufruf hängt bis zum Fortsetzen und geht dann genau einmal hinaus", async () => {
    const calls: string[][] = []; const pause = new EmbeddingPause(memStorage()); pause.setPaused(true);
    const e = pause.gate(() => textEmbedder(calls), "wait");
    let done = false; const p = e.embed(["x"]).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 10));
    expect(done).toBe(false); expect(calls.length).toBe(0);
    pause.setPaused(false); await p;
    expect(calls).toEqual([["x"]]);
  });
  it("beforeCall (Zähler) läuft nur für Aufrufe, die wirklich hinausgehen", async () => {
    const pause = new EmbeddingPause(memStorage()); const n: number[] = [];
    const e = pause.gate(() => textEmbedder([]), "throw", (k) => n.push(k));
    await e.embed(["a", "b"]); pause.setPaused(true);
    await expect(e.embed(["c"])).rejects.toThrow();
    expect(n).toEqual([2]);
  });

  // §6.3: ein Reindex, der an der Gruppengrenze pausiert und danach weiterläuft, ist Zeile für Zeile derselbe wie ohne Pause.
  // > 32 Chunks (mindestens zwei Gruppen), sonst misst der Test keine Grenze.
  it("Reindex mit Pause an der Gruppengrenze: Ergebnis byte-gleich zum Lauf ohne Pause, und während der Pause geht keine Anfrage hinaus", async () => {
    const paths = Array.from({ length: 80 }, (_, i) => `n${String(i).padStart(3, "0")}.md`);
    const read = async (p: string) => `# ${p}\nInhalt für ${p} lang genug für genau einen Chunk.`;

    const aCalls: string[][] = [];
    const a = adapter();
    const refIdx = new LiveIndexer(a, "_vaultrag", textEmbedder(aCalls), "m");
    await refIdx.reindexAll(paths, read);
    await refIdx.persist("reindex");
    expect(aCalls.length).toBeGreaterThanOrEqual(2);     // mindestens zwei Gruppen — sonst gäbe es keine Grenze

    const bCalls: string[][] = [];
    const b = adapter(); const pause = new EmbeddingPause(memStorage());
    const inner = textEmbedder(bCalls);
    // pausiert, sobald die erste Gruppe draußen ist
    const gated = pause.gate(() => inner, "wait", () => { if (bCalls.length === 0) queueMicrotask(() => pause.setPaused(true)); });
    const idx = new LiveIndexer(b, "_vaultrag", gated, "m");
    const run = idx.reindexAll(paths, read);
    await new Promise(r => setTimeout(r, 30));
    const beiPause = bCalls.length;
    expect(pause.isPaused()).toBe(true);
    await new Promise(r => setTimeout(r, 30));
    expect(bCalls.length).toBe(beiPause);                // während der Pause keine weitere Anfrage
    expect(beiPause).toBeLessThan(aCalls.length);        // der Lauf steht wirklich mittendrin
    pause.setPaused(false);
    await run;
    await idx.persist("reindex");
    expect(bCalls.length).toBe(aCalls.length);
    const bytesA = new Uint8Array(a.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    const bytesB = new Uint8Array(b.written.get(`_vaultrag/${CONTAINER_FILE}`) as ArrayBuffer);
    // `built_at` im Kopf unterscheidet die Läufe; verglichen werden Pfade und Matrix über den Index
    expect(bytesB.length).toBe(bytesA.length);
    const ia = refIdx.buildIndex(); const ib = idx.buildIndex();
    expect(ib.paths).toEqual(ia.paths);
    for (const p of ia.paths) expect(Array.from(ib.vectorFor(p)!)).toEqual(Array.from(ia.vectorFor(p)!));
  });
});
