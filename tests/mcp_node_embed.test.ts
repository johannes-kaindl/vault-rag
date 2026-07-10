// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { nodeProbe, embedQueryVector } from "../src/mcp/node_embed";

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("nodeProbe", () => {
  it("200 + Modell-Listen-Form → ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: [] })));
    expect((await nodeProbe("http://x:1")).kind).toBe("ok");
  });
  it("200 ohne data-Form → not-an-llm-api", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { hello: 1 })));
    expect((await nodeProbe("http://x:1")).kind).toBe("not-an-llm-api");
  });
  it("ECONNREFUSED in cause.code → refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }));
    expect((await nodeProbe("http://x:1")).kind).toBe("refused");
  });
  it("TimeoutError → timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    }));
    expect((await nodeProbe("http://x:1")).kind).toBe("timeout");
  });
});

describe("embedQueryVector", () => {
  it("bettet ein und transformiert in den Index-Vektorraum (truncate+normalisiert)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: [{ embedding: [3, 4, 0, 0, 99, 99] }] })));
    const v = await embedQueryVector("http://x:1", "m", "query", 4);
    expect(v.length).toBe(4);                       // auf dim truncated (Matryoshka)
    expect(v[0]).toBeCloseTo(0.6); expect(v[1]).toBeCloseTo(0.8); // L2-normalisiert
  });
  it("HTTP-Fehler → Error mit Status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, {})));
    await expect(embedQueryVector("http://x:1", "m", "q", 4)).rejects.toThrow(/500/);
  });
  it("ungültiges Response-Schema → Error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: "quatsch" })));
    await expect(embedQueryVector("http://x:1", "m", "q", 4)).rejects.toThrow(/Schema/);
  });
});
