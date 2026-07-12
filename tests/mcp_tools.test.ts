import { describe, it, expect } from "vitest";
import { McpTools } from "../src/mcp/tools";
import { RetrievalFacade } from "../src/retrieval_facade";
import { parseIndex } from "../src/index";

function idx() {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
  return parseIndex(m, ["a.md", "b.md", "c.md"], bytes.buffer);
}
function tools(over = {}) {
  const facade = new RetrievalFacade({
    getIndex: () => idx(),
    embedderReady: async () => true,
    embed: async () => [new Float32Array([1, 0])],
    settings: () => ({ k: 5, minSim: 0, exclude: ["Templates/"] }),
    readVault: async (r: string) => `INHALT ${r}`,
    ...over,
  });
  return new McpTools(facade);
}

describe("McpTools.search", () => {
  it("liefert gerundete Hits", async () => {
    const r = await tools().search({ query: "x" });
    expect(r.hits[0]).toEqual({ path: "a.md", score: 1 });
  });
  it("wirft bei fehlendem Index", async () => {
    await expect(tools({ getIndex: () => null }).search({ query: "x" })).rejects.toThrow(/Kein Index/);
  });
  it("wirft bei offline", async () => {
    await expect(tools({ embedderReady: async () => false }).search({ query: "x" })).rejects.toThrow(/nicht erreichbar/);
  });
});

describe("McpTools.related", () => {
  it("verwandte Notizen", async () => {
    const r = await tools().related({ path: "a.md" });
    expect(r.hits.map(h => h.path)).toEqual(["b.md", "c.md"]);
  });
  it("wirft bei nicht-indexierter Notiz", async () => {
    await expect(tools().related({ path: "missing.md" })).rejects.toThrow(/nicht im Index/);
  });
});

describe("McpTools.readNote", () => {
  it("liest Volltext", async () => {
    expect(await tools().readNote({ path: "a/b.md" })).toEqual({ path: "a/b.md", content: "INHALT a/b.md" });
  });
  it("wirft mit Guard-Grund bei Traversal", async () => {
    await expect(tools().readNote({ path: "../x.md" })).rejects.toThrow(/verlässt den Vault/);
  });
  it("wirft bei exclude-Präfix", async () => {
    await expect(tools().readNote({ path: "Templates/x.md" })).rejects.toThrow(/Ausschluss-Präfix/);
  });
});
