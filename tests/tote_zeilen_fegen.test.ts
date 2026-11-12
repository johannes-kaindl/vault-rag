import { describe, it, expect, vi } from "vitest";
import { Platform } from "obsidian";
import VaultRagPlugin from "../src/main";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import { parseIndex } from "../src/vendor/kit/vector-index";
import { decodeContainer, CONTAINER_FILE } from "../src/vendor/kit/index-container";
import type { Embedder } from "../src/vendor/kit/embeddings-client";
import { DeadRowGrace, DEAD_ROW_GRACE_MS, type DeadRowStorage } from "../src/dead_rows";

/**
 * Tote Zeilen fegen (Welle 33, Task „Tote Zeilen im Index aufräumen“; Pallas-Index 2026-11-12: 3.113 von 14.990 Zeilen ohne Datei). Die echte Methode `sweepDeadRows` läuft auf einem Objekt mit den
 * Mitgliedern, die sie liest, mit echtem LiveIndexer, echter Platte (Speicher-Adapter) und der echten Frist (`DeadRowGrace`, Uhr und Speicher gestellt).
 */
const DIM = 256;
const MODEL = "qwen3-embedding:8b";
const TAG = DEAD_ROW_GRACE_MS;

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

function speicher(): DeadRowStorage {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { d.set(k, v); } };
}

interface Lage { fake: Record<string, unknown>; platte: Map<string, ArrayBuffer | string>; vault: Set<string>; uhr: { t: number }; notices: number }

/** 10 Zeilen im Index; `tot` davon ohne Datei im Vault. Platte trägt `plattenModell`. */
async function aufbau(tot: number, plattenModell = MODEL): Promise<Lage> {
  const a = adapter();
  const emb = { ping: async () => true, embed: async (ts: string[]) => ts.map((t, i) => { const v = new Float32Array(DIM); v[(t.length + i) % DIM] = 1; return v; }) } as unknown as Embedder;
  const paths = Array.from({ length: 10 }, (_, i) => `n${i}.md`);
  const alt = new LiveIndexer(a as never, "_vaultrag", emb, plattenModell, { dim: DIM });
  alt.init(parseIndex({ schema_version: 1, embedding_model: plattenModell, index_dim: DIM, scale: 127, count: 0, granularity: "note", quant: "int8" }, [], new ArrayBuffer(0)));
  await alt.reindexAll(paths, async (p) => `# ${p}\nInhalt, lang genug für genau einen Chunk in dieser Notiz.`);
  await alt.persist("reindex");
  const li = new LiveIndexer(a as never, "_vaultrag", emb, MODEL, { dim: DIM });
  li.init(alt.buildIndex());
  const vault = new Set(paths.slice(tot));   // die ersten `tot` Dateien fehlen
  const uhr = { t: 1_000_000 };
  const lage: Lage = { fake: {}, platte: a.written, vault, uhr, notices: 0 };
  Object.assign(lage.fake, {
    liveIndexer: li, index: li.buildIndex(), indexHealthy: true, isSwitchingIndexDir: false, indexOpsRunning: 0,
    embeddingProgress: { isEmbedding: false }, emptyNotePaths: new Set<string>(), stampGap: { stamped: () => undefined },
    vaultMarkdownPaths: () => [...vault],
    app: { vault: { getAbstractFileByPath: (p: string) => (vault.has(p) ? {} : null) } },
    deadRows: new DeadRowGrace(speicher(), "k", TAG, () => uhr.t),
    snapshotIndex: vi.fn(async () => undefined), runIndexOp: async (fn: () => Promise<void>) => fn(),
    adoptOwnIndexWrite: async () => undefined, syncProgress: () => undefined, refresh: () => undefined, persistBlockedMessage: (e: unknown) => String(e),
  });
  return lage;
}

function zeilen(platte: Map<string, ArrayBuffer | string>): string[] {
  const roh = [...platte.entries()].find(([p]) => p.endsWith(CONTAINER_FILE))?.[1] as ArrayBuffer;
  return [...decodeContainer(roh).paths];
}

const fegen = (l: Lage) => (VaultRagPlugin.prototype as unknown as { sweepDeadRows(this: unknown): Promise<{ removed: number; waiting: number; refused: boolean }> }).sweepDeadRows.call(l.fake);

describe("sweepDeadRows", () => {
  it("die erste Beobachtung entfernt nichts (Frist läuft), die Platte bleibt gleich", async () => {
    const l = await aufbau(3);
    const r = await fegen(l);
    expect(r).toEqual({ removed: 0, waiting: 3, refused: false });
    expect(zeilen(l.platte)).toHaveLength(10);
  });

  it("nach der Frist verschwinden genau die Zeilen ohne Datei, die anderen bleiben; Platte und Index im Speicher stimmen", async () => {
    const l = await aufbau(3);
    await fegen(l);
    l.uhr.t += TAG;
    const r = await fegen(l);
    expect(r).toEqual({ removed: 3, waiting: 0, refused: false });
    expect(zeilen(l.platte)).toEqual(["n3.md", "n4.md", "n5.md", "n6.md", "n7.md", "n8.md", "n9.md"]);
    expect((l.fake.index as { count: number }).count).toBe(7);
    expect(l.fake.snapshotIndex).toHaveBeenCalled();
  });

  it("kommt eine Datei vor dem Ablauf zurück (Sync-Rückstand), bleibt ihre Zeile; die Frist beginnt von vorn", async () => {
    const l = await aufbau(3);
    await fegen(l);
    l.uhr.t += TAG / 2;
    l.vault.add("n0.md");
    await fegen(l);
    l.uhr.t += TAG / 2;
    l.vault.delete("n0.md");           // wieder weg, aber nicht durchgehend
    const r = await fegen(l);
    expect(r.removed).toBe(2);         // n1 und n2 fehlten durchgehend, n0 nicht
    expect(zeilen(l.platte)).toContain("n0.md");
    expect(zeilen(l.platte)).not.toContain("n1.md");
  });

  it("verweigert, wenn es die Hälfte des Index oder mehr wäre (halb synchronisierter Vault): nichts ändert sich, auch nach der Frist", async () => {
    const l = await aufbau(6);
    await fegen(l);
    l.uhr.t += TAG;
    const r = await fegen(l);
    expect(r.refused).toBe(true);
    expect(r.removed).toBe(0);
    expect(zeilen(l.platte)).toHaveLength(10);
  });

  it("am Handy wird nie gefegt", async () => {
    const mobil = Platform as unknown as { isMobile: boolean };
    mobil.isMobile = true;
    try {
      const l = await aufbau(3);
      await fegen(l); l.uhr.t += TAG;
      expect(await fegen(l)).toEqual({ removed: 0, waiting: 0, refused: false });
      expect(zeilen(l.platte)).toHaveLength(10);
    } finally { mobil.isMobile = false; }
  });

  it("unter fremdem Modell auf der Platte wird nicht geschrieben (Modell-Guard des Grundes heal)", async () => {
    const l = await aufbau(3, "anderes-modell");
    await fegen(l); l.uhr.t += TAG;
    const r = await fegen(l);
    expect(r.removed).toBe(0);
    expect(zeilen(l.platte)).toHaveLength(10);
  });

  it("ein Vault ohne eine einzige Notiz (nicht geladen) ist keine Beobachtung", async () => {
    const l = await aufbau(10);
    await fegen(l); l.uhr.t += TAG;
    expect(await fegen(l)).toEqual({ removed: 0, waiting: 0, refused: false });
  });
});
