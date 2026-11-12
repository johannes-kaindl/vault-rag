import { describe, it, expect } from "vitest";
import VaultRagPlugin from "../src/main";
import { LiveIndexer } from "../src/vendor/kit/live-indexer";
import { parseIndex } from "../src/vendor/kit/vector-index";
import type { Embedder } from "../src/vendor/kit/embeddings-client";

/**
 * `applyEmbeddingResolution` säte bei JEDER abgeschlossenen Auflösung einen neuen LiveIndexer (Task „Neu säen ohne Änderung …“, Punkt 2; Quelle des Voll-Reindex-Fehlers
 * vom 2026-11-03). Der Indexer trägt nur das Modell (der Embedder löst den Endpunkt bei jedem Aufruf selbst auf): ohne Modellwechsel ersetzt das Neusäen einen laufenden
 * Indexer durch einen gleichen und hebt dabei einen gesetzten Schreibschutz (`markUnready`) auf. Die echte Methode läuft auf einem Objekt mit den Mitgliedern, die sie liest.
 */
const DIM = 256;
const emb = { ping: async () => true, embed: async () => [] } as unknown as Embedder;

function idx(model: string) {
  return parseIndex({ schema_version: 1, embedding_model: model, index_dim: DIM, scale: 127, count: 1, granularity: "note", quant: "int8" }, ["a.md"], new ArrayBuffer(DIM));
}

function bauen(modell: string) {
  const adapter = { exists: async () => false } as never;
  const li = new LiveIndexer(adapter, "_vaultrag", emb, modell, { dim: DIM });
  const index = idx(modell);
  li.init(index);
  const fake: Record<string, unknown> = {
    liveIndexer: li, index, indexHealthy: true, embeddingModelInUse: modell,
    app: { vault: { adapter } }, settings: { indexDir: "_vaultrag" },
    countedEmbedder: () => emb, noticeSkippedEmbeddingEndpoints: () => undefined, hydratedEmbeddingEndpoints: () => [],
    indexedModel: (VaultRagPlugin.prototype as unknown as Record<string, unknown>)["indexedModel"],
    embeddingReachedThisSession: false, embedOp: "indexer", activeEmbeddingEndpoint: null, searchOnlyEndpoint: null,
  };
  return { fake, li };
}

function aufloesen(fake: Record<string, unknown>, url: string, modell: string): void {
  const r = { state: "active", skipped: [], source: { kind: "local", config: { url }, model: modell, sentModel: modell } };
  (VaultRagPlugin.prototype as unknown as { applyEmbeddingResolution(this: unknown, r: unknown): void }).applyEmbeddingResolution.call(fake, r);
}

describe("applyEmbeddingResolution: neu säen nur bei Modellwechsel", () => {
  it("gleiches Modell, gleicher Endpunkt: derselbe Indexer", () => {
    const x = bauen("qwen3-embedding:8b");
    aufloesen(x.fake, "http://a:11434", "qwen3-embedding:8b");
    expect(x.fake.liveIndexer).toBe(x.li);
  });

  it("anderer Endpunkt, gleiches Modell: derselbe Indexer (er trägt keine URL)", () => {
    const x = bauen("qwen3-embedding:8b");
    aufloesen(x.fake, "http://a:11434", "qwen3-embedding:8b");
    aufloesen(x.fake, "http://b:1234", "qwen3-embedding:8b");
    expect(x.fake.liveIndexer).toBe(x.li);
  });

  it("ein gesetzter Schreibschutz überlebt eine Auflösung ohne Wechsel", () => {
    const x = bauen("qwen3-embedding:8b");
    x.li.markUnready();
    aufloesen(x.fake, "http://a:11434", "qwen3-embedding:8b");
    expect((x.fake.liveIndexer as LiveIndexer).isReady()).toBe(false);
  });

  it("Gegenprobe: bei einem anderen Modell kommt ein neuer Indexer mit dem neuen Modell, aus dem Index gesät", () => {
    const x = bauen("qwen3-embedding:8b");
    aufloesen(x.fake, "http://a:11434", "anderes-modell");
    expect(x.fake.liveIndexer).not.toBe(x.li);
    expect((x.fake.liveIndexer as LiveIndexer).isReady()).toBe(true);
    expect((x.fake.liveIndexer as LiveIndexer).buildIndex().manifest.embedding_model).toBe("anderes-modell");
    expect((x.fake.liveIndexer as LiveIndexer).buildIndex().count).toBe(1);
  });
});
