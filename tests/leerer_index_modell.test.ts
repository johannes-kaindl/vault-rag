import { describe, it, expect } from "vitest";
import VaultRagPlugin from "../src/main";
import { parseIndex } from "../src/vendor/kit/vector-index";
import { embeddingModelMatchesIndex } from "../src/vendor/kit/index-guard";

/**
 * Ein Index mit `count: 0` legt kein Embedding-Modell fest (Task „Leerer Index hält das Modell eines Endpunkts fest, der nie einen Vektor geliefert hat“,
 * llm-setup, 2026-11-03: Chat-Modell als Embedding-Endpunkt, dreimal ein leerer Index mit dessen Namen, danach wurde der richtige Endpunkt übersprungen).
 * `main.ts` ist die Kante: die echte Methode `indexedModel` läuft auf einem Objekt, das nur `index` trägt; die Modell-Frage stellt der echte Guard.
 */
const DIM = 256;

function index(model: string, paths: string[]) {
  const n = paths.length;
  return parseIndex({ schema_version: 1, embedding_model: model, index_dim: DIM, scale: 127, count: n, granularity: "note", quant: "int8" }, paths, new ArrayBuffer(n * DIM));
}

function gehalten(idx: ReturnType<typeof index> | null): string | undefined {
  const proto = VaultRagPlugin.prototype as unknown as { indexedModel(this: unknown): string | undefined };
  return proto.indexedModel.call({ index: idx });
}

describe("Modell, das der geladene Index festhält", () => {
  it("ein leerer Index hält kein Modell fest: ein anderes Embedding-Modell wird angenommen", () => {
    const gehaltenes = gehalten(index("qwen/qwen3.8-27b", []));
    expect(gehaltenes).toBeUndefined();
    expect(embeddingModelMatchesIndex("qwen3-embedding:8b", gehaltenes)).toBe(true);
  });

  it("Gegenprobe: ein Index mit einer Zeile hält sein Modell fest, ein fremdes Modell wird abgelehnt", () => {
    const gehaltenes = gehalten(index("qwen3-embedding:8b", ["a.md"]));
    expect(gehaltenes).toBe("qwen3-embedding:8b");
    expect(embeddingModelMatchesIndex("anderes-modell", gehaltenes)).toBe(false);
  });

  it("ohne geladenen Index: undefined", () => {
    expect(gehalten(null)).toBeUndefined();
  });
});
