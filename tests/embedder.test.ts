import { describe, it, expect, vi, afterEach } from "vitest";
import { EmbeddingClient } from "../src/embedder";
import { requestUrl } from "obsidian";

function makeVec(n: number, val = 1.0): number[] {
  return Array(n).fill(val);
}
const ok = (json: unknown) => ({ status: 200, json });

describe("EmbeddingClient", () => {
  afterEach(() => vi.mocked(requestUrl).mockReset());

  describe("ping", () => {
    it("true bei 200 mit gültiger Modell-Liste", async () => {
      vi.mocked(requestUrl).mockResolvedValue(ok({ data: [] }) as any);
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(true);
    });
    it("false wenn 200 aber kein OpenAI-Body (Fremd-Server)", async () => {
      vi.mocked(requestUrl).mockResolvedValue(ok({}) as any);
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(false);
    });
    it("false wenn nicht erreichbar", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(false);
    });
    it("false bei HTTP 500", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
      expect(await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").ping()).toBe(false);
    });
  });

  describe("probe", () => {
    it("liefert kind=refused mit Klartext bei ECONNREFUSED", async () => {
      vi.mocked(requestUrl).mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
      const s = await new EmbeddingClient("http://localhost:1243", "m").probe();
      expect(s.kind).toBe("refused");
      expect(s.klartext).toContain("Port");
    });
  });

  describe("embed", () => {
    it("gibt Float32Array pro Input zurück", async () => {
      const vec = makeVec(256);
      vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ embedding: vec }, { embedding: vec }] }) as any);
      const result = await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").embed(["text1", "text2"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Float32Array);
      expect(result[0].length).toBe(256);
    });

    it("batcht > 32 Inputs in mehrere Requests", async () => {
      const vec = makeVec(256);
      const batchBody = (n: number) => ({ data: Array(n).fill({ embedding: vec }) });
      vi.mocked(requestUrl)
        .mockResolvedValueOnce(ok(batchBody(32)) as any)
        .mockResolvedValueOnce(ok(batchBody(5)) as any);
      const result = await new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").embed(Array(37).fill("x"));
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(37);
    });

    it("wirft bei HTTP-Fehler", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 503 } as any);
      await expect(new EmbeddingClient("http://localhost:11434", "qwen3-embedding:8b").embed(["x"])).rejects.toThrow("503");
    });
  });

  describe("listModels", () => {
    it("parst data[].id und sortiert", async () => {
      vi.mocked(requestUrl).mockResolvedValue(ok({ data: [{ id: "b" }, { id: "a" }] }) as any);
      expect(await new EmbeddingClient("http://localhost:11434", "m").listModels()).toEqual(["a", "b"]);
    });
    it("gibt [] bei Fehler", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 500 } as any);
      expect(await new EmbeddingClient("http://x", "m").listModels()).toEqual([]);
    });
  });

  describe("fetchCapabilities", () => {
    it("liest Ollama /api/show capabilities", async () => {
      vi.mocked(requestUrl).mockResolvedValue(ok({ capabilities: ["completion"] }) as any);
      expect(await new EmbeddingClient("http://localhost:11434", "m").fetchCapabilities("m")).not.toBeNull();
    });
    it("gibt null wenn keine Metadaten verfügbar", async () => {
      vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
      expect(await new EmbeddingClient("http://x", "m").fetchCapabilities("m")).toBeNull();
    });
  });
});
