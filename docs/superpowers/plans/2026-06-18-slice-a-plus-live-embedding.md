# Slice A+ Live-Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei jedem file:modify wird die geänderte Notiz via konfigurierbarem Ollama-Endpoint neu vektorisiert und der Index inkrementell aktualisiert; Offline-Edits landen in einer Dirty-List und werden bei Reconnect nachgezogen.

**Architecture:** Vier neue Module (`chunker.ts`, `embedder.ts`, `pending_queue.ts`, `live_indexer.ts`) mit sauberen Interfaces. `main.ts` orchestriert: file-Events → debounce → embed → buildIndex → persist → refresh. Der statische Index (`_vaultrag/`) bleibt das Sync-Artefakt für iPhone.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest, happy-dom, vi.stubGlobal für fetch-Mocks.

## Global Constraints

- TypeScript strict mode, `noImplicitAny: true`
- Test-Runner: `npm test` (vitest run)
- Obsidian-Mock unter `tests/__mocks__/obsidian.ts` — kein echter Obsidian-Import in Tests
- Index-Format: unverändertes Slice-A-Format (`notes.i8` / `paths.json` / `manifest.json`)
- Write-Order bei persist: `notes.i8` → `paths.json` → `manifest.json` (manifest letztes = reload-Trigger)
- Embedding-Dimension: 256 (INT8_SCALE = 127)
- Batch-Limit Ollama: 32 Chunks/Request
- Debounce file:modify: 3000 ms

---

## File Map

| Aktion | Pfad | Zweck |
|---|---|---|
| Create | `src/chunker.ts` | Port von chunker.py — Frontmatter strip + Heading-Split |
| Create | `src/embedder.ts` | HTTP-Client für `/v1/embeddings` + ping |
| Create | `src/pending_queue.ts` | Dirty-List in `pending.json` |
| Create | `src/live_indexer.ts` | Note-Vektor-Map + rebuild + persist |
| Modify | `src/index.ts` | VaultAdapter um write/writeBinary/mkdir erweitern |
| Modify | `src/settings.ts` | embeddingEndpoint + embeddingModel + Status-Badge |
| Modify | `src/main.ts` | Wiring: file-Events, Debounce, LiveIndexer, PendingQueue |
| Modify | `tests/__mocks__/obsidian.ts` | vault.on + write/writeBinary/mkdir im Adapter |
| Create | `tests/chunker.test.ts` | Unit-Tests chunker |
| Create | `tests/embedder.test.ts` | Unit-Tests embedder (fetch-Mock) |
| Create | `tests/pending_queue.test.ts` | Unit-Tests PendingQueue |
| Create | `tests/live_indexer.test.ts` | Unit-Tests LiveIndexer |
| Modify | `tests/settings.test.ts` | Neue Default-Felder prüfen |

---

## Task 1: Chunker

**Files:**
- Create: `src/chunker.ts`
- Create: `tests/chunker.test.ts`

**Interfaces:**
- Produces: `Chunk { text: string; startOffset: number; endOffset: number }`, `chunkMarkdown(text: string, maxChars?: number, overlap?: number): Chunk[]`

- [ ] **Step 1: Test schreiben**

```typescript
// tests/chunker.test.ts
import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../src/chunker";

describe("chunkMarkdown", () => {
  it("gibt einen Chunk für kurzen Text zurück", () => {
    const chunks = chunkMarkdown("kurzer text");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("kurzer text");
  });

  it("strippt YAML-Frontmatter", () => {
    const text = "---\ntitle: Test\n---\nBody-Inhalt";
    const chunks = chunkMarkdown(text);
    expect(chunks[0].text).not.toContain("title:");
    expect(chunks[0].text).toContain("Body-Inhalt");
  });

  it("splittet an Heading-Grenzen", () => {
    const h = "# Heading\n";
    const body = "x".repeat(500) + "\n" + h + "y".repeat(500);
    const chunks = chunkMarkdown(body, 800, 150);
    const texts = chunks.map(c => c.text);
    expect(texts.some(t => t.startsWith("# Heading"))).toBe(true);
  });

  it("garantiert Terminierung bei vielen kurzen Headings", () => {
    let body = "";
    for (let i = 0; i < 200; i++) body += `# H${i}\ntext\n`;
    expect(() => chunkMarkdown(body, 800, 150)).not.toThrow();
    const chunks = chunkMarkdown(body, 800, 150);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("gibt leeres Array für leeren Text nach Frontmatter", () => {
    const chunks = chunkMarkdown("---\ntitle: x\n---\n   ");
    expect(chunks).toHaveLength(0);
  });

  it("erzeugt Overlap zwischen Chunks", () => {
    const body = "a".repeat(800) + "b".repeat(800);
    const chunks = chunkMarkdown(body, 800, 150);
    expect(chunks.length).toBeGreaterThan(1);
    // Letzter Char von Chunk N überlappt mit Anfang von Chunk N+1
    const c0end = chunks[0].endOffset;
    const c1start = chunks[1].startOffset;
    expect(c1start).toBeLessThan(c0end);
  });
});
```

- [ ] **Step 2: Test scheitern lassen**

```bash
cd /Users/Shared/code/vault-rag && npm test -- --reporter=verbose tests/chunker.test.ts
```

Erwartet: `Error: Cannot find module '../src/chunker'`

- [ ] **Step 3: Implementierung schreiben**

```typescript
// src/chunker.ts
export interface Chunk { text: string; startOffset: number; endOffset: number; }

const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;

export function chunkMarkdown(text: string, maxChars = 800, overlap = 150): Chunk[] {
  const body = text.replace(FRONTMATTER_RE, "");
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [{ text: trimmed, startOffset: 0, endOffset: trimmed.length }];

  const headingRe = /^#{1,6}\s+/gm;
  const positions: number[] = [0];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(trimmed)) !== null) positions.push(m.index);
  positions.push(trimmed.length);

  const minChunkSize = Math.max(maxChars - overlap, Math.floor(maxChars / 2));
  const chunks: Chunk[] = [];
  let curStart = 0;

  while (curStart < trimmed.length) {
    const targetEnd = curStart + maxChars;
    const candidates = positions.filter(p => p >= curStart + minChunkSize && p <= targetEnd);
    let curEnd = candidates.length > 0 ? Math.max(...candidates) : Math.min(targetEnd, trimmed.length);
    if (curEnd <= curStart) curEnd = Math.min(curStart + maxChars, trimmed.length);

    const chunkText = trimmed.slice(curStart, curEnd).trim();
    if (chunkText) chunks.push({ text: chunkText, startOffset: curStart, endOffset: curEnd });
    if (curEnd >= trimmed.length) break;
    curStart = Math.max(curEnd - overlap, curStart + minChunkSize);
  }
  return chunks;
}
```

- [ ] **Step 4: Tests grün**

```bash
npm test -- tests/chunker.test.ts
```

Erwartet: 6 Tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/chunker.ts tests/chunker.test.ts
git commit -m "feat(chunker): TypeScript-Port von chunker.py mit Tests"
```

---

## Task 2: EmbeddingClient

**Files:**
- Create: `src/embedder.ts`
- Create: `tests/embedder.test.ts`

**Interfaces:**
- Produces: `class EmbeddingClient { constructor(endpoint: string, model: string); ping(): Promise<boolean>; embed(texts: string[]): Promise<Float32Array[]>; }`

- [ ] **Step 1: Test schreiben**

```typescript
// tests/embedder.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmbeddingClient } from "../src/embedder";

function makeVec(n: number, val = 1.0): number[] {
  return Array(n).fill(val);
}

function mockFetch(responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  let call = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[call++ % responses.length];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    };
  });
}

describe("EmbeddingClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("ping", () => {
    it("gibt true zurück wenn Endpoint 200 liefert", async () => {
      vi.stubGlobal("fetch", mockFetch([{ ok: true }]));
      const c = new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b");
      expect(await c.ping()).toBe(true);
    });

    it("gibt false zurück wenn Endpoint nicht erreichbar", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const c = new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b");
      expect(await c.ping()).toBe(false);
    });

    it("gibt false zurück bei HTTP 500", async () => {
      vi.stubGlobal("fetch", mockFetch([{ ok: false, status: 500 }]));
      const c = new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b");
      expect(await c.ping()).toBe(false);
    });
  });

  describe("embed", () => {
    it("gibt Float32Array pro Input zurück", async () => {
      const vec = makeVec(256);
      vi.stubGlobal("fetch", mockFetch([{
        ok: true,
        body: { data: [{ embedding: vec }, { embedding: vec }] },
      }]));
      const c = new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b");
      const result = await c.embed(["text1", "text2"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Float32Array);
      expect(result[0].length).toBe(256);
    });

    it("batcht > 32 Inputs in mehrere Requests", async () => {
      const vec = makeVec(256);
      const batchBody = (n: number) => ({ data: Array(n).fill({ embedding: vec }) });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => batchBody(32) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => batchBody(5) });
      vi.stubGlobal("fetch", fetchMock);
      const c = new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b");
      const result = await c.embed(Array(37).fill("x"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(37);
    });

    it("wirft bei HTTP-Fehler", async () => {
      vi.stubGlobal("fetch", mockFetch([{ ok: false, status: 503 }]));
      const c = new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b");
      await expect(c.embed(["x"])).rejects.toThrow("503");
    });
  });
});
```

- [ ] **Step 2: Test scheitern lassen**

```bash
npm test -- tests/embedder.test.ts
```

Erwartet: `Cannot find module '../src/embedder'`

- [ ] **Step 3: Implementierung schreiben**

```typescript
// src/embedder.ts
export class EmbeddingClient {
  constructor(private endpoint: string, private model: string) {}

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      return r.ok;
    } catch { return false; }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const r = await fetch(`${this.endpoint}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!r.ok) throw new Error(`Embedding HTTP ${r.status}`);
      const data = await r.json() as { data: { embedding: number[] }[] };
      for (const item of data.data) results.push(new Float32Array(item.embedding));
    }
    return results;
  }
}
```

- [ ] **Step 4: Tests grün**

```bash
npm test -- tests/embedder.test.ts
```

Erwartet: 6 Tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/embedder.ts tests/embedder.test.ts
git commit -m "feat(embedder): EmbeddingClient HTTP zu Ollama + Tests"
```

---

## Task 3: VaultAdapter erweitern + PendingQueue

**Files:**
- Modify: `src/index.ts` (VaultAdapter-Interface)
- Modify: `tests/__mocks__/obsidian.ts` (Adapter-Mock + vault.on)
- Create: `src/pending_queue.ts`
- Create: `tests/pending_queue.test.ts`

**Interfaces:**
- Consumes: erweitertes `VaultAdapter` aus `src/index.ts`
- Produces: `class PendingQueue { constructor(adapter: VaultAdapter, dir: string); load(): Promise<void>; add(path: string): Promise<void>; drain(): string[]; clear(): Promise<void>; size: number; }`

- [ ] **Step 1: VaultAdapter in `src/index.ts` erweitern**

Ändere das Interface (Zeile 11–14):

```typescript
// src/index.ts — VaultAdapter-Interface ersetzen:
export interface VaultAdapter {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
}
```

- [ ] **Step 2: Mock in `tests/__mocks__/obsidian.ts` erweitern**

In `makeFakeApp()` den `adapter`-Block ergänzen und `vault.on` hinzufügen:

```typescript
// tests/__mocks__/obsidian.ts — makeFakeApp() komplett ersetzen:
export function makeFakeApp(): any {
  return {
    vault: {
      adapter: {
        read: vi.fn().mockResolvedValue(""),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        write: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        stat: vi.fn().mockResolvedValue({ mtime: 0 }),
      },
      on: vi.fn().mockReturnValue({ id: "mock-event" }),
    },
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(null),
      getLeavesOfType: vi.fn().mockReturnValue([]),
      getRightLeaf: vi.fn().mockReturnValue({ setViewState: vi.fn() }),
      on: vi.fn(),
      revealLeaf: vi.fn(),
    },
  };
}
```

- [ ] **Step 3: Vorhandene Tests noch grün**

```bash
npm test
```

Erwartet: alle bisherigen Tests weiterhin PASS (keine breaking changes)

- [ ] **Step 4: PendingQueue-Test schreiben**

```typescript
// tests/pending_queue.test.ts
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
```

- [ ] **Step 5: Test scheitern lassen**

```bash
npm test -- tests/pending_queue.test.ts
```

Erwartet: `Cannot find module '../src/pending_queue'`

- [ ] **Step 6: Implementierung schreiben**

```typescript
// src/pending_queue.ts
import { VaultAdapter } from "./index";

export class PendingQueue {
  private pending = new Set<string>();

  constructor(private adapter: VaultAdapter, private dir: string) {}

  async load(): Promise<void> {
    try {
      const raw = await this.adapter.read(`${this.dir}/pending.json`);
      const arr = JSON.parse(raw) as string[];
      this.pending = new Set(arr);
    } catch { this.pending = new Set(); }
  }

  async add(path: string): Promise<void> {
    this.pending.add(path);
    await this.save();
  }

  drain(): string[] {
    const paths = [...this.pending];
    this.pending.clear();
    return paths;
  }

  async clear(): Promise<void> {
    this.pending.clear();
    await this.adapter.write(`${this.dir}/pending.json`, "[]");
  }

  get size(): number { return this.pending.size; }

  private async save(): Promise<void> {
    await this.adapter.write(`${this.dir}/pending.json`, JSON.stringify([...this.pending]));
  }
}
```

- [ ] **Step 7: Tests grün**

```bash
npm test -- tests/pending_queue.test.ts
```

Erwartet: 6 Tests PASS

- [ ] **Step 8: Alle Tests grün**

```bash
npm test
```

Erwartet: alle Tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/index.ts src/pending_queue.ts tests/pending_queue.test.ts tests/__mocks__/obsidian.ts
git commit -m "feat(pending-queue): VaultAdapter-Erweiterung + PendingQueue + Mock-Update"
```

---

## Task 4: LiveIndexer

**Files:**
- Create: `src/live_indexer.ts`
- Create: `tests/live_indexer.test.ts`

**Interfaces:**
- Consumes: `VaultAdapter` (src/index.ts), `VaultIndex`, `parseIndex`, `IndexManifest` (src/index.ts), `EmbeddingClient` (src/embedder.ts), `chunkMarkdown` (src/chunker.ts)
- Produces:
  ```typescript
  class LiveIndexer {
    constructor(adapter: VaultAdapter, indexDir: string, embedder: EmbeddingClient, embeddingModel: string)
    init(index: VaultIndex): void
    update(path: string, content: string): Promise<void>
    remove(path: string): void
    rename(oldPath: string, newPath: string): void
    buildIndex(): VaultIndex
    persist(): Promise<void>
  }
  ```

- [ ] **Step 1: Test schreiben**

```typescript
// tests/live_indexer.test.ts
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
});
```

- [ ] **Step 2: Test scheitern lassen**

```bash
npm test -- tests/live_indexer.test.ts
```

Erwartet: `Cannot find module '../src/live_indexer'`

- [ ] **Step 3: Implementierung schreiben**

```typescript
// src/live_indexer.ts
import { VaultAdapter, VaultIndex, IndexManifest, parseIndex } from "./index";
import { EmbeddingClient } from "./embedder";
import { chunkMarkdown } from "./chunker";

const INDEX_DIM = 256;
const INT8_SCALE = 127;

export class LiveIndexer {
  private noteVectors = new Map<string, Float32Array>();
  private loadedManifest: IndexManifest | null = null;

  constructor(
    private adapter: VaultAdapter,
    private indexDir: string,
    private embedder: EmbeddingClient,
    private embeddingModel: string,
  ) {}

  init(index: VaultIndex): void {
    this.loadedManifest = index.manifest;
    for (const path of index.paths) {
      const v = index.vectorFor(path);
      if (v) this.noteVectors.set(path, v.slice());
    }
  }

  async update(path: string, content: string): Promise<void> {
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) { this.noteVectors.delete(path); return; }

    const vecs = await this.embedder.embed(chunks.map(c => c.text));
    const dim = Math.min(INDEX_DIM, vecs[0].length);
    const mean = new Float32Array(dim);
    for (const v of vecs) {
      for (let i = 0; i < dim; i++) mean[i] += v[i] / vecs.length;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += mean[i] * mean[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) mean[i] /= norm;

    this.noteVectors.set(path, mean);
  }

  remove(path: string): void { this.noteVectors.delete(path); }

  rename(oldPath: string, newPath: string): void {
    const v = this.noteVectors.get(oldPath);
    if (v) { this.noteVectors.set(newPath, v); this.noteVectors.delete(oldPath); }
  }

  buildIndex(): VaultIndex {
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const f = new Float32Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) f[r * INDEX_DIM + c] = v[c] ?? 0;
    }
    const manifest: IndexManifest = {
      schema_version: 1,
      embedding_model: this.embeddingModel,
      index_dim: INDEX_DIM,
      scale: INT8_SCALE,
      count: n,
      granularity: "note",
      quant: "int8",
    };
    return new VaultIndex(manifest, paths, f);
  }

  async persist(): Promise<void> {
    const paths = [...this.noteVectors.keys()].sort();
    const n = paths.length;
    const i8 = new Int8Array(n * INDEX_DIM);
    for (let r = 0; r < n; r++) {
      const v = this.noteVectors.get(paths[r])!;
      for (let c = 0; c < INDEX_DIM; c++) {
        i8[r * INDEX_DIM + c] = Math.max(-INT8_SCALE, Math.min(INT8_SCALE, Math.round((v[c] ?? 0) * INT8_SCALE)));
      }
    }
    await this.adapter.mkdir(this.indexDir);
    // Write-Order: binary → paths → manifest (manifest letztes = reload-Trigger)
    await this.adapter.writeBinary(`${this.indexDir}/notes.i8`, i8.buffer);
    await this.adapter.write(`${this.indexDir}/paths.json`, JSON.stringify(paths));
    const manifest = {
      schema_version: 1,
      vault: (this.loadedManifest as any)?.vault ?? "10_Pallas",
      embedding_model: this.embeddingModel,
      source_dim: INDEX_DIM,
      index_dim: INDEX_DIM,
      granularity: "note",
      aggregation: "mean",
      quant: "int8",
      scale: INT8_SCALE,
      count: n,
      shards: ["notes.i8"],
      source_commit: "",
      built_at: new Date().toISOString(),
    };
    await this.adapter.write(`${this.indexDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  }
}
```

- [ ] **Step 4: Tests grün**

```bash
npm test -- tests/live_indexer.test.ts
```

Erwartet: 9 Tests PASS

- [ ] **Step 5: Alle Tests grün**

```bash
npm test
```

Erwartet: alle Tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/live_indexer.ts tests/live_indexer.test.ts
git commit -m "feat(live-indexer): Note-Vektor-Map + rebuild + persist + Tests"
```

---

## Task 5: Settings update

**Files:**
- Modify: `src/settings.ts`
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Produces: `VaultRagSettings.embeddingEndpoint: string`, `VaultRagSettings.embeddingModel: string`

- [ ] **Step 1: Test erweitern**

```typescript
// tests/settings.test.ts — komplett ersetzen:
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("settings", () => {
  it("hat sinnvolle Defaults", () => {
    expect(DEFAULT_SETTINGS.k).toBe(20);
    expect(DEFAULT_SETTINGS.minSim).toBeCloseTo(0.3);
    expect(DEFAULT_SETTINGS.indexDir).toBe("_vaultrag");
    expect(DEFAULT_SETTINGS.exclude).toContain("Templates/");
  });

  it("hat embeddingEndpoint-Default", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoint).toBe("http://localhost:11434");
  });

  it("hat embeddingModel-Default", () => {
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("qwen3-embedding:8b");
  });
});
```

- [ ] **Step 2: Test scheitern lassen**

```bash
npm test -- tests/settings.test.ts
```

Erwartet: 2 Tests FAIL (embeddingEndpoint / embeddingModel nicht in DEFAULT_SETTINGS)

- [ ] **Step 3: `src/settings.ts` erweitern**

```typescript
// src/settings.ts
import { App, PluginSettingTab, Setting } from "obsidian";

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  exclude: string[];
  embeddingEndpoint: string;
  embeddingModel: string;
}

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  exclude: ["Templates/", "Archive/", ".trash/"],
  embeddingEndpoint: "http://localhost:11434",
  embeddingModel: "qwen3-embedding:8b",
};

export class VaultRagSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: any) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Anzahl Treffer (k)").addSlider(s =>
      s.setLimits(5, 50, 1).setValue(this.plugin.settings.k).onChange(async (v: number) => {
        this.plugin.settings.k = v; await this.plugin.saveSettings(); this.plugin.refresh();
      }));

    new Setting(containerEl).setName("Min. Ähnlichkeit").addSlider(s =>
      s.setLimits(0, 0.9, 0.05).setValue(this.plugin.settings.minSim).onChange(async (v: number) => {
        this.plugin.settings.minSim = v; await this.plugin.saveSettings(); this.plugin.refresh();
      }));

    new Setting(containerEl).setName("Index-Ordner").addText(t =>
      t.setValue(this.plugin.settings.indexDir).onChange(async (v: string) => {
        this.plugin.settings.indexDir = v; await this.plugin.saveSettings(); await this.plugin.loadIndex();
      }));

    new Setting(containerEl).setName("Embedding Endpoint")
      .setDesc("Ollama- oder MLX-Endpoint, z.B. http://localhost:11434")
      .addText(t =>
        t.setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));

    new Setting(containerEl).setName("Embedding Modell")
      .setDesc("Modell-Name wie auf dem Endpoint verfügbar")
      .addText(t =>
        t.setPlaceholder("qwen3-embedding:8b")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));

    // Status-Badge (readonly)
    const statusEl = containerEl.createDiv({ cls: "vault-rag-status" });
    statusEl.setText("Status: prüfe…");
    this.plugin.embedder?.ping().then((ok: boolean) => {
      statusEl.setText(ok ? "● Verbunden" : "○ Offline");
    });
  }
}
```

- [ ] **Step 4: Tests grün**

```bash
npm test -- tests/settings.test.ts
```

Erwartet: 3 Tests PASS

- [ ] **Step 5: Alle Tests grün**

```bash
npm test
```

Erwartet: alle Tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): embeddingEndpoint + embeddingModel + Status-Badge"
```

---

## Task 6: main.ts Wiring

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `EmbeddingClient` (src/embedder.ts), `LiveIndexer` (src/live_indexer.ts), `PendingQueue` (src/pending_queue.ts), `Retriever` (src/retriever.ts), alle Settings-Felder
- Produces: vollständig verdrahtetes Plugin

- [ ] **Step 1: `src/main.ts` komplett ersetzen**

```typescript
// src/main.ts
import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import { IndexLoader, VaultIndex } from "./index";
import { Retriever, Hit } from "./retriever";
import { RelatedNotesView, VIEW_TYPE_RELATED } from "./view";
import { DEFAULT_SETTINGS, VaultRagSettings, VaultRagSettingTab } from "./settings";
import { EmbeddingClient } from "./embedder";
import { LiveIndexer } from "./live_indexer";
import { PendingQueue } from "./pending_queue";

export default class VaultRagPlugin extends Plugin {
  settings!: VaultRagSettings;
  private index: VaultIndex | null = null;
  private retriever: Retriever | null = null;
  private lastMtime = 0;
  embedder!: EmbeddingClient;
  private liveIndexer!: LiveIndexer;
  private pendingQueue!: PendingQueue;
  private debounceTimers = new Map<string, ReturnType<typeof window.setTimeout>>();

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.embedder = new EmbeddingClient(this.settings.embeddingEndpoint, this.settings.embeddingModel);
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, this.settings.indexDir, this.embedder, this.settings.embeddingModel);
    this.pendingQueue = new PendingQueue(this.app.vault.adapter, this.settings.indexDir);

    this.addSettingTab(new VaultRagSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_RELATED, (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, {
      getHits: () => this.currentHits(),
      openPath: (p) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
      },
    }));
    this.addRibbonIcon("search", "Verwandte Notizen", () => this.activateView());
    this.addCommand({ id: "open-related", name: "Verwandte Notizen öffnen", callback: () => this.activateView() });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));

    // File-Events
    this.registerEvent(this.app.vault.on("modify", (file: TFile) => {
      if (file.extension !== "md") return;
      this.scheduleEmbed(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file: TFile) => {
      if (file.extension !== "md") return;
      void this.handleDelete(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file: TFile, oldPath: string) => {
      if (file.extension !== "md") return;
      void this.handleRename(file.path, oldPath);
    }));

    await this.pendingQueue.load();
    await this.loadIndex();

    // Index-Refresh nach Sync (30s) + Pending-Drain (60s)
    this.registerInterval(window.setInterval(() => this.maybeReload(), 30000));
    this.registerInterval(window.setInterval(() => void this.maybeDrainPending(), 60000));
  }

  reconnectEmbedder(): void {
    this.embedder = new EmbeddingClient(this.settings.embeddingEndpoint, this.settings.embeddingModel);
    this.liveIndexer = new LiveIndexer(this.app.vault.adapter, this.settings.indexDir, this.embedder, this.settings.embeddingModel);
    if (this.index) this.liveIndexer.init(this.index);
  }

  async loadIndex() {
    try {
      this.index = await new IndexLoader(this.app.vault.adapter, this.settings.indexDir).load();
      this.retriever = new Retriever(this.index);
      this.liveIndexer.init(this.index);
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st) this.lastMtime = st.mtime;
      this.refresh();
    } catch (e) {
      this.index = null; this.retriever = null;
      console.warn("vault-rag: loadIndex failed", e);
    }
  }

  async maybeReload() {
    try {
      const st = await this.app.vault.adapter.stat(`${this.settings.indexDir}/manifest.json`);
      if (st && st.mtime !== this.lastMtime) { this.lastMtime = st.mtime; await this.loadIndex(); }
    } catch { /* noch kein Index */ }
  }

  private scheduleEmbed(path: string): void {
    const existing = this.debounceTimers.get(path);
    if (existing !== undefined) window.clearTimeout(existing);
    const tid = window.setTimeout(() => {
      this.debounceTimers.delete(path);
      void this.handleModify(path);
    }, 3000);
    this.debounceTimers.set(path, tid);
  }

  private async handleModify(path: string): Promise<void> {
    if (this.settings.exclude.some(e => path.startsWith(e))) return;
    if (path.startsWith(this.settings.indexDir + "/")) return;
    let content: string;
    try { content = await this.app.vault.adapter.read(path); } catch { return; }

    if (await this.embedder.ping()) {
      try {
        await this.liveIndexer.update(path, content);
        this.index = this.liveIndexer.buildIndex();
        this.retriever = new Retriever(this.index);
        await this.liveIndexer.persist();
        this.refresh();
      } catch { await this.pendingQueue.add(path); }
    } else {
      await this.pendingQueue.add(path);
    }
  }

  private async handleDelete(path: string): Promise<void> {
    if (!(await this.embedder.ping())) return; // offline: defer to next HyperForge reindex
    this.liveIndexer.remove(path);
    this.index = this.liveIndexer.buildIndex();
    this.retriever = new Retriever(this.index);
    await this.liveIndexer.persist();
    this.refresh();
  }

  private async handleRename(newPath: string, oldPath: string): Promise<void> {
    if (await this.embedder.ping()) {
      this.liveIndexer.rename(oldPath, newPath);
      this.index = this.liveIndexer.buildIndex();
      this.retriever = new Retriever(this.index);
      await this.liveIndexer.persist();
      this.refresh();
    } else {
      await this.pendingQueue.add(newPath);
    }
  }

  private async maybeDrainPending(): Promise<void> {
    if (this.pendingQueue.size === 0) return;
    if (!(await this.embedder.ping())) return;
    await this.drainPending();
  }

  private async drainPending(): Promise<void> {
    const paths = this.pendingQueue.drain();
    for (const path of paths) {
      try {
        const content = await this.app.vault.adapter.read(path);
        await this.liveIndexer.update(path, content);
      } catch { /* Datei gelöscht oder unlesbar — überspringen */ }
    }
    await this.pendingQueue.clear();
    this.index = this.liveIndexer.buildIndex();
    this.retriever = new Retriever(this.index);
    await this.liveIndexer.persist();
    this.refresh();
  }

  currentHits(): Hit[] {
    const f = this.app.workspace.getActiveFile();
    if (!f || !this.retriever) return [];
    return this.retriever.related(f.path, { k: this.settings.k, minSim: this.settings.minSim, exclude: this.settings.exclude });
  }

  refresh() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED)) {
      const v = leaf.view as RelatedNotesView;
      v.render?.();
    }
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_RELATED, active: true });
  }

  async saveSettings() { await this.saveData(this.settings); }
}
```

- [ ] **Step 2: Alle Tests grün**

```bash
npm test
```

Erwartet: alle Tests PASS (main.ts hat keine eigenen Unit-Tests — Integration via loadIndex-Smoke in scaffold.test.ts)

- [ ] **Step 3: Build prüfen**

```bash
npm run build 2>&1 | tail -5
```

Erwartet: kein Fehler, `main.js` aktualisiert

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): file-Events + Debounce + LiveIndexer + PendingQueue-Wiring"
```

---

## Task 7: Abschluss

- [ ] **Step 1: Vollständiger Test-Lauf**

```bash
npm test
```

Erwartet: alle Tests PASS (mindestens 13 + 6 + 6 + 6 + 9 + 3 = bisherige + neue Tests)

- [ ] **Step 2: Build final**

```bash
npm run build
```

Erwartet: kein TypeScript-Fehler, `main.js` ohne Warnungen

- [ ] **Step 3: Symlink prüfen**

```bash
ls -la "/Users/Shared/10_ObsidianVaults/10_Pallas/.obsidian/plugins/vault-rag/main.js"
```

Erwartet: Symlink zeigt auf `/Users/Shared/code/vault-rag/main.js` — build hat den Live-Code direkt aktualisiert.

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/plans/2026-06-18-slice-a-plus-live-embedding.md
git commit -m "docs(plan): Slice A+ Implementierungsplan committed"
```
