import { describe, it, expect, vi } from "vitest";
import VaultRagPlugin from "../src/main";
import { Platform } from "obsidian";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import { parseIndex } from "../src/vendor/kit/vector-index";
import { decodeContainer, CONTAINER_FILE } from "../src/vendor/kit/index-container";
import type { Embedder } from "../src/vendor/kit/embeddings-client";

/**
 * Löschen und Umbenennen brauchen keinen Embedder (Task „Löschen und Umbenennen ohne erreichbaren Embedder lässt tote Zeilen im Index“, Welle 33): `handleDelete` kehrte bei
 * `embedderReady() === false` zurück (ohne Warteschlange), `handleRename` merkte nur den neuen Pfad vor. Die Bedingung stammt aus a4c1f92 („offline: defer to next HyperForge reindex“,
 * als ein externer Reindex den Index baute) und gilt nicht mehr: `LiveIndexer.remove`/`rename` und `persist` rechnen keinen Vektor. Die echten Methoden laufen auf einem Objekt mit den Mitgliedern, die sie lesen.
 */
const DIM = 256;
const MODEL = "qwen3-embedding:8b";

function adapter() {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: async (p: string) => { if (!written.has(p)) throw new Error("nf"); return written.get(p) as string; },
    readBinary: async (p: string) => { if (!written.has(p)) throw new Error("nf"); return written.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { written.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { written.set(p, d); },
    mkdir: async () => undefined,
    exists: async (p: string) => written.has(p),
    remove: async (p: string) => { written.delete(p); },
    written,
  };
}

async function aufbau(embedderBereit: boolean) {
  const a = adapter();
  const embed = vi.fn(async (texts: string[]) => texts.map((t, i) => { const v = new Float32Array(DIM); v[(t.length + i) % DIM] = 1; return v; }));
  const emb = { ping: async () => true, embed } as unknown as Embedder;
  const li = new LiveIndexer(a as never, "_vaultrag", emb, MODEL, { dim: DIM });
  li.init(parseIndex({ schema_version: 1, embedding_model: MODEL, index_dim: DIM, scale: 127, count: 0, granularity: "note", quant: "int8" }, [], new ArrayBuffer(0)));
  await li.reindexAll(["a.md", "b.md", "c.md", "d.md"], async (p) => `# ${p}\nInhalt, lang genug für genau einen Chunk in dieser Notiz.`);
  await li.persist("reindex");
  embed.mockClear();
  const pending: string[] = [];
  const fake: Record<string, unknown> = {
    liveIndexer: li, index: li.buildIndex(), indexHealthy: true, isSwitchingIndexDir: false,
    integratorStore: { remove: () => false, rename: () => false }, saveIntegratorStore: async () => undefined,
    embedderReady: async () => embedderBereit,
    runIndexOp: async (fn: () => Promise<void>) => fn(),
    stampGap: { stamped: () => undefined, moved: () => undefined }, emptyNotePaths: new Set<string>(),
    syncProgress: () => undefined, refresh: () => undefined, persistBlockedMessage: (e: unknown) => String(e),
    pendingQueue: { add: async (p: string) => { pending.push(p); } },
    mayWriteIndexWithoutEmbedder: (VaultRagPlugin.prototype as unknown as Record<string, unknown>)["mayWriteIndexWithoutEmbedder"],
  };
  return { fake, a, embed, pending };
}

function zeilen(platte: Map<string, ArrayBuffer | string>): string[] {
  const roh = [...platte.entries()].find(([p]) => p.endsWith(CONTAINER_FILE))?.[1] as ArrayBuffer;
  return [...decodeContainer(roh).paths];
}

const proto = VaultRagPlugin.prototype as unknown as {
  handleDelete(this: unknown, path: string): Promise<void>;
  handleRename(this: unknown, n: string, o: string): Promise<void>;
};

describe("Löschen und Umbenennen ohne erreichbaren Embedder", () => {
  it("Löschen: die Zeile verschwindet aus Platte und Index, es wird nichts eingebettet", async () => {
    const x = await aufbau(false);
    await proto.handleDelete.call(x.fake, "b.md");
    expect(zeilen(x.a.written)).toEqual(["a.md", "c.md", "d.md"]);
    expect((x.fake.index as { count: number }).count).toBe(3);
    expect(x.embed).not.toHaveBeenCalled();
  });

  it("Umbenennen: die Zeile zieht mit, der alte Pfad ist weg, nichts wird eingebettet oder vorgemerkt", async () => {
    const x = await aufbau(false);
    await proto.handleRename.call(x.fake, "neu/b.md", "b.md");
    expect(zeilen(x.a.written)).toEqual(["a.md", "c.md", "d.md", "neu/b.md"]);
    expect(x.pending).toEqual([]);
    expect(x.embed).not.toHaveBeenCalled();
  });

  it("Kontrolle des Aufbaus: mit erreichbarem Embedder ergibt dasselbe Löschen dieselbe Platte", async () => {
    const x = await aufbau(true);
    await proto.handleDelete.call(x.fake, "b.md");
    expect(zeilen(x.a.written)).toEqual(["a.md", "c.md", "d.md"]);
  });

  it("am Handy ohne erreichbaren Embedder bleibt der Index unberührt (Sync-Stand kann hinter dem Desktop liegen); Umbenennen merkt den neuen Pfad vor", async () => {
    const mobil = Platform as unknown as { isMobile: boolean };
    mobil.isMobile = true;
    try {
      const x = await aufbau(false);
      await proto.handleDelete.call(x.fake, "b.md");
      await proto.handleRename.call(x.fake, "neu/c.md", "c.md");
      expect(zeilen(x.a.written)).toEqual(["a.md", "b.md", "c.md", "d.md"]);
      expect(x.pending).toEqual(["neu/c.md"]);
      const y = await aufbau(true);   // Gegenprobe: am Handy MIT erreichbarem Embedder schreibt es wie bisher
      await proto.handleDelete.call(y.fake, "b.md");
      expect(zeilen(y.a.written)).toEqual(["a.md", "c.md", "d.md"]);
    } finally { mobil.isMobile = false; }
  });
});
