import { describe, it, expect, vi } from "vitest";
import { PendingQueue } from "../src/pending_queue";
import { VaultAdapter } from "../src/index";

function makeAdapter(initial: Record<string, string> = {}): VaultAdapter & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    read: vi.fn(async (p: string) => {
      if (!store.has(p)) throw new Error(`not found: ${p}`);
      return store.get(p)!;
    }),
    readBinary: vi.fn(),
    write: vi.fn(async (p: string, d: string) => { store.set(p, d); }),
    writeBinary: vi.fn(),
    mkdir: vi.fn(),
    store,
  } as any;
}

describe("PendingQueue", () => {
  it("startet leer wenn keine pending.json", async () => {
    const q = new PendingQueue(makeAdapter(), "_vaultrag");
    await q.load();
    expect(q.size).toBe(0);
  });

  it("lädt bestehende pending.json", async () => {
    const adapter = makeAdapter({ "_vaultrag/pending.json": '["a.md","b.md"]' });
    const q = new PendingQueue(adapter, "_vaultrag");
    await q.load();
    expect(q.size).toBe(2);
  });

  it("add schreibt sofort nach pending.json", async () => {
    const adapter = makeAdapter();
    const q = new PendingQueue(adapter, "_vaultrag");
    await q.load();
    await q.add("notes/foo.md");
    expect(q.size).toBe(1);
    expect(adapter.write).toHaveBeenCalledWith("_vaultrag/pending.json", expect.stringContaining("foo.md"));
  });

  it("add dedupliziert", async () => {
    const adapter = makeAdapter();
    const q = new PendingQueue(adapter, "_vaultrag");
    await q.load();
    await q.add("a.md");
    await q.add("a.md");
    expect(q.size).toBe(1);
  });

  it("drain gibt alle Pfade zurück und leert in-memory", async () => {
    const adapter = makeAdapter({ "_vaultrag/pending.json": '["a.md","b.md"]' });
    const q = new PendingQueue(adapter, "_vaultrag");
    await q.load();
    const paths = q.drain();
    expect(paths).toHaveLength(2);
    expect(paths).toContain("a.md");
    expect(q.size).toBe(0);
  });

  it("clear schreibt leeres Array nach pending.json", async () => {
    const adapter = makeAdapter();
    const q = new PendingQueue(adapter, "_vaultrag");
    await q.load();
    await q.add("x.md");
    await q.clear();
    expect(q.size).toBe(0);
    expect(adapter.write).toHaveBeenLastCalledWith("_vaultrag/pending.json", "[]");
  });
});
