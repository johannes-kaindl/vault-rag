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

  describe("listModels", () => {
    it("parst data[].id und sortiert", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "b" }, { id: "a" }] }) }));
      const c = new EmbeddingClient("http://localhost:11434", "m");
      expect(await c.listModels()).toEqual(["a", "b"]);
    });
    it("gibt [] bei Fehler", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      expect(await new EmbeddingClient("http://x", "m").listModels()).toEqual([]);
    });
  });

  describe("fetchCapabilities", () => {
    it("liest Ollama /api/show capabilities", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: ["completion"] }) }));
      const c = await new EmbeddingClient("http://localhost:11434", "m").fetchCapabilities("m");
      expect(c).not.toBeNull();
    });
    it("gibt null wenn keine Metadaten verfügbar", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      expect(await new EmbeddingClient("http://x", "m").fetchCapabilities("m")).toBeNull();
    });
  });
});
