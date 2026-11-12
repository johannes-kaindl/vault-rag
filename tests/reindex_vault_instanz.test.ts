import { describe, it, expect, vi } from "vitest";
import VaultRagPlugin from "../src/main";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import { parseIndex } from "../src/vendor/kit/vector-index";
import { decodeContainer, CONTAINER_FILE } from "../src/vendor/kit/index-container";
import type { Embedder } from "../src/vendor/kit/embeddings-client";

/**
 * Datenverlust beim Voll-Reindex (llm-setup, 2026-11-03, jkaindl-docs: 2 h 14 min Rechenzeit, am Ende `count: 0`).
 *
 * Mit dem Endpunkt-Manager löst jedes `embed` die Verbindung neu auf, und `applyEmbeddingResolution` ersetzt dabei `this.liveIndexer` durch einen NEUEN,
 * aus dem Index von vor dem Lauf gesäten Indexer. `reindexVault` rief `reindexAll` auf der alten Instanz, danach aber `buildIndex` und `persist` auf
 * `this.liveIndexer`, also auf der neuen: die Vektoren des Laufs steckten in der alten Instanz und gingen verloren.
 *
 * `main.ts` ist die Kante und wird nicht als Ganzes aufgebaut. Der Test ruft die ECHTE Methode `reindexVault` aus dem Prototyp auf einem Objekt auf, das nur
 * die Mitglieder trägt, die sie liest, mit einem echten `LiveIndexer` und echter Platte (Speicher-Adapter) dahinter. Der Tausch des Indexers geschieht im Embedder,
 * genau dort, wo ihn `onResolved` auslöst.
 */

const DIM = 256;
const MODEL = "qwen3-embedding:8b";

function adapter() {
  const written = new Map<string, ArrayBuffer | string>();
  return {
    read: async (p: string) => { if (!written.has(p)) throw new Error("not found: " + p); return written.get(p) as string; },
    readBinary: async (p: string) => { if (!written.has(p)) throw new Error("not found: " + p); return written.get(p) as ArrayBuffer; },
    write: async (p: string, d: string) => { written.set(p, d); },
    writeBinary: async (p: string, d: ArrayBuffer) => { written.set(p, d); },
    mkdir: async () => undefined,
    exists: async (p: string) => written.has(p),
    remove: async (p: string) => { written.delete(p); },
    written,
  };
}

function leererIndex() {
  const m = { schema_version: 1, embedding_model: MODEL, index_dim: DIM, scale: 127, count: 0, granularity: "note", quant: "int8" };
  return parseIndex(m, [], new ArrayBuffer(0));
}

interface Aufbau {
  fake: Record<string, unknown>;
  platte: Map<string, ArrayBuffer | string>;
  tauschZaehler: () => number;
}

/** Ein Objekt mit den Mitgliedern, die `reindexVault` liest. `tausche` = true: der Embedder ersetzt `fake.liveIndexer` beim ersten Aufruf durch einen neu gesäten. */
function bauen(tausche: boolean, pfade: string[], nachTausch?: (fake: Record<string, unknown>) => void): Aufbau {
  const a = adapter();
  let tausch = 0;
  const fake: Record<string, unknown> = {};
  const embedder = {
    ping: async () => true,
    embed: vi.fn(async (texts: string[]) => {
      if (tausche && tausch === 0) {
        tausch++;
        // Was `applyEmbeddingResolution` tut: neuer Indexer, gesät aus dem Index von vor dem Lauf, mit demselben Embedder.
        const neu = new LiveIndexer(a as never, "_vaultrag", embedder as unknown as Embedder, MODEL, { dim: DIM });
        neu.init(leererIndex());
        fake.liveIndexer = neu;
        nachTausch?.(fake);
      }
      return texts.map((t, i) => { const v = new Float32Array(DIM); v[(t.length + i) % DIM] = 1; return v; });
    }),
  };
  const li = new LiveIndexer(a as never, "_vaultrag", embedder as unknown as Embedder, MODEL, { dim: DIM });
  li.init(leererIndex());
  Object.assign(fake, {
    liveIndexer: li,
    // die echten Methoden des Plugins, die `reindexVault` und der Abbruch benutzen
    runningIndexers: new Set<LiveIndexer>(),
    whileRunning: (VaultRagPlugin.prototype as unknown as Record<string, unknown>).whileRunning,
    index: leererIndex(),
    indexHealthy: true,
    pause: { isPaused: () => false },
    embedderReady: async () => true,
    vaultMarkdownPaths: () => pfade,
    statusBarEl: {},
    setStatusBarVisible: () => undefined,
    updateStatusBar: () => undefined,
    embeddingProgress: { isEmbedding: false, reindex: null as unknown, embeddedNotes: 0 },
    emptyNotePaths: new Set<string>(),
    underEmbedOp: async (_op: string, fn: () => Promise<unknown>) => fn(),
    stampOf: () => [1, 1] as [number, number],
    stampGap: { settle: () => undefined },
    refresh: () => undefined,
    snapshotIndex: async () => undefined,
    persistBlockedMessage: (e: unknown) => String(e),
    adoptOwnIndexWrite: async () => undefined,
    syncProgress: () => undefined,
    settings: { showStatusBar: true },
    app: { vault: { adapter: { read: async (p: string) => `# ${p}\nEin Inhalt, lang genug für genau einen Chunk in der Notiz.` } } },
  });
  return { fake, platte: a.written, tauschZaehler: () => tausch };
}

async function lauf(aufbau: Aufbau): Promise<void> {
  await (VaultRagPlugin.prototype as unknown as { reindexVault(this: unknown): Promise<void> }).reindexVault.call(aufbau.fake);
}

function zeilenAufPlatte(platte: Map<string, ArrayBuffer | string>): number {
  const roh = [...platte.entries()].find(([p]) => p.endsWith(CONTAINER_FILE))?.[1];
  if (!(roh instanceof ArrayBuffer)) return -1;
  return decodeContainer(roh).manifest.count;
}

describe("reindexVault: der Indexer, der gerechnet hat, schreibt", () => {
  const pfade = ["a.md", "b.md", "c.md", "d.md"];

  it("ohne Tausch während des Laufs steht jede Notiz auf der Platte und im Index (Kontrolle des Aufbaus)", async () => {
    const x = bauen(false, pfade);
    await lauf(x);
    expect(x.tauschZaehler()).toBe(0);
    expect(zeilenAufPlatte(x.platte)).toBe(pfade.length);
    expect((x.fake.index as { count: number }).count).toBe(pfade.length);
  });

  it("wird der Indexer während des Laufs ersetzt, gehen die Vektoren des Laufs trotzdem auf die Platte", async () => {
    const x = bauen(true, pfade);
    await lauf(x);
    expect(x.tauschZaehler()).toBe(1);   // der Tausch hat stattgefunden, sonst misst der Test nichts
    expect(zeilenAufPlatte(x.platte)).toBe(pfade.length);
    expect((x.fake.index as { count: number }).count).toBe(pfade.length);
  });
});

describe("Abbruch trifft den Indexer, der gerade rechnet", () => {
  const viele = Array.from({ length: 300 }, (_, i) => `n${i}.md`);

  it("ein Abbruch nach dem Tausch beendet den Lauf an der nächsten Gruppengrenze, die fertigen Notizen bleiben auf der Platte", async () => {
    // Der Befehl „cancel-reindex“ kommt, nachdem der Indexer ersetzt wurde (im Embedder, gleich nach dem Tausch).
    const x = bauen(true, viele, (fake) => (VaultRagPlugin.prototype as unknown as { cancelRunningReindex(this: unknown): void }).cancelRunningReindex.call(fake));
    await lauf(x);
    const aufPlatte = zeilenAufPlatte(x.platte);
    expect(x.tauschZaehler()).toBe(1);
    expect(aufPlatte).toBeGreaterThan(0);
    expect(aufPlatte).toBeLessThan(viele.length);
  });

  it("Kontrolle: ohne Abbruch läuft dieselbe Pfadliste bis zum Ende", async () => {
    const x = bauen(true, viele);
    await lauf(x);
    expect(zeilenAufPlatte(x.platte)).toBe(viele.length);
  });
});

/**
 * Abbruch des Voll-Reindex unter fremdem Modell (Task „Abbruch des Voll-Reindex unter fremdem Modell …“, Welle 28/33):
 * Der Kit-Abbruch schreibt bei fremdem Modell nichts und behält den Bestand im Speicher; `reindexVault` rief danach trotzdem
 * `persist("reindex")` und stempelte den Bestand von Modell A unter den Namen von Modell B (Index im falschen Vektorraum, Zahl, Dimension und CRC unauffällig).
 */
describe("Abbruch unter fremdem Modell: die Platte bleibt, wie sie war", () => {
  const MODELL_A = "modell-a";
  const MODELL_B = "modell-b";
  const viele = Array.from({ length: 300 }, (_, i) => `n${i}.md`);

  function manifestAufPlatte(platte: Map<string, ArrayBuffer | string>): { embedding_model: string; count: number } {
    const roh = [...platte.entries()].find(([p]) => p.endsWith(CONTAINER_FILE))?.[1] as ArrayBuffer;
    return decodeContainer(roh).manifest as unknown as { embedding_model: string; count: number };
  }

  /** Platte und Speicher tragen Modell A; der rechnende Indexer und sein Embedder nennen Modell B. Der Abbruch kommt im ersten `embed`. */
  async function fremdesModell(diskModell: string): Promise<{ platteVorher: ArrayBuffer; platte: Map<string, ArrayBuffer | string>; fake: Record<string, unknown>; indexVorher: unknown }> {
    const a = adapter();
    const lesen = async (p: string) => `# ${p}\nEin Inhalt, lang genug für genau einen Chunk in der Notiz.`;
    const vektor = async (texts: string[]) => texts.map((t, i) => { const v = new Float32Array(DIM); v[(t.length + i) % DIM] = 1; return v; });
    // Bestand von Modell A auf die Platte legen
    const alt = new LiveIndexer(a as never, "_vaultrag", { ping: async () => true, embed: vektor } as unknown as Embedder, diskModell, { dim: DIM });
    alt.init(parseIndex({ schema_version: 1, embedding_model: diskModell, index_dim: DIM, scale: 127, count: 0, granularity: "note", quant: "int8" }, [], new ArrayBuffer(0)));
    await alt.reindexAll(["alt1.md", "alt2.md", "alt3.md"], lesen);
    await alt.persist("reindex");
    const platteVorher = (a.written.get("_vaultrag/" + CONTAINER_FILE) as ArrayBuffer).slice(0);
    const indexVorher = alt.buildIndex();

    const fake: Record<string, unknown> = {};
    const embedder = {
      ping: async () => true,
      embed: vi.fn(async (texts: string[]) => {
        (VaultRagPlugin.prototype as unknown as { cancelRunningReindex(this: unknown): void }).cancelRunningReindex.call(fake);
        return vektor(texts);
      }),
    };
    const li = new LiveIndexer(a as never, "_vaultrag", embedder as unknown as Embedder, MODELL_B, { dim: DIM });
    li.init(indexVorher);
    Object.assign(fake, {
      liveIndexer: li,
      runningIndexers: new Set<LiveIndexer>(),
      whileRunning: (VaultRagPlugin.prototype as unknown as Record<string, unknown>).whileRunning,
      index: indexVorher,
      indexHealthy: true,
      pause: { isPaused: () => false },
      embedderReady: async () => true,
      vaultMarkdownPaths: () => viele,
      statusBarEl: {},
      setStatusBarVisible: () => undefined,
      updateStatusBar: () => undefined,
      embeddingProgress: { isEmbedding: false, reindex: null as unknown, embeddedNotes: 0 },
      emptyNotePaths: new Set<string>(),
      underEmbedOp: async (_op: string, fn: () => Promise<unknown>) => fn(),
      stampOf: () => [1, 1] as [number, number],
      stampGap: { settle: () => undefined },
      refresh: () => undefined,
      snapshotIndex: async () => undefined,
      persistBlockedMessage: (e: unknown) => String(e),
      adoptOwnIndexWrite: async () => undefined,
      syncProgress: () => undefined,
      settings: { showStatusBar: true },
      app: { vault: { adapter: { read: lesen } } },
    });
    return { platteVorher, platte: a.written, fake, indexVorher };
  }

  it("Modell auf der Platte ≠ Modell des Indexers: index.bin bleibt Byte für Byte gleich, der Index im Speicher bleibt dasselbe Objekt", async () => {
    const x = await fremdesModell(MODELL_A);
    await lauf({ fake: x.fake, platte: x.platte, tauschZaehler: () => 0 });
    const jetzt = x.platte.get("_vaultrag/" + CONTAINER_FILE) as ArrayBuffer;
    expect(manifestAufPlatte(x.platte).embedding_model).toBe(MODELL_A);
    expect(Buffer.from(jetzt).equals(Buffer.from(x.platteVorher))).toBe(true);
    expect(x.fake.index).toBe(x.indexVorher);
  });

  it("Gegenprobe: passt das Modell auf der Platte, schreibt der Abbruch den Zwischenstand (mehr als die drei alten Zeilen, Modell unverändert)", async () => {
    const x = await fremdesModell(MODELL_B);
    await lauf({ fake: x.fake, platte: x.platte, tauschZaehler: () => 0 });
    const m = manifestAufPlatte(x.platte);
    expect(m.embedding_model).toBe(MODELL_B);
    expect(m.count).toBeGreaterThan(3);
    expect(m.count).toBeLessThan(viele.length + 3);
  });
});
