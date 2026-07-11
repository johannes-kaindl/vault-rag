// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VaultIndex, IndexManifest } from "../src/index";
import { McpTools, resolveNotePath } from "../src/mcp/tools";
import type { McpDeps } from "../src/mcp/mcp_deps";

const DIM = 4;
function idx(entries: [string, number[]][]): VaultIndex {
  const manifest: IndexManifest = { schema_version: 1, embedding_model: "m", index_dim: DIM, scale: 127, count: entries.length, granularity: "note", quant: "int8" };
  const paths = entries.map(e => e[0]);
  const vecs = new Float32Array(entries.length * DIM);
  entries.forEach(([, v], r) => { const n = Math.hypot(...v) || 1; v.forEach((x, c) => vecs[r * DIM + c] = x / n); });
  return new VaultIndex(manifest, paths, vecs);
}

function deps(over: Partial<McpDeps> = {}): McpDeps {
  const index = idx([["a.md", [1, 0, 0, 0]], ["fast-a.md", [0.9, 0.1, 0, 0]], ["weit.md", [0, 0, 1, 0]]]);
  return {
    getIndex: () => index,
    embedQuery: async () => new Float32Array([1, 0, 0, 0]),
    readNote: async (p) => `# Inhalt von ${p}`,
    settings: () => ({ k: 20, minSim: 0.5, exclude: ["Templates/"] }),
    ...over,
  };
}

describe("resolveNotePath (vault-relativ)", () => {
  it("gibt normalisierten Pfad zurück, wirft bei Traversal/Nicht-md/Ausschluss", () => {
    expect(resolveNotePath("Ordner/Notiz.md", [])).toBe("Ordner/Notiz.md");
    expect(() => resolveNotePath("../x.md", [])).toThrow();
    expect(() => resolveNotePath("x.txt", [])).toThrow();
    expect(() => resolveNotePath("templates/x.md", ["Templates/"])).toThrow(); // case-insensitiv
    expect(() => resolveNotePath("/abs.md", [])).toThrow();
  });
});

describe("McpTools", () => {
  it("related liefert die nächste Notiz", async () => {
    const t = new McpTools(deps());
    const r = await t.related({ path: "a.md", min_similarity: 0.5 });
    expect(r.hits.map(h => h.path)).toEqual(["fast-a.md"]);
  });
  it("related wirft für nicht-indizierte Notiz", async () => {
    const t = new McpTools(deps());
    await expect(t.related({ path: "fehlt.md" })).rejects.toThrow();
  });
  it("search embeddet die Query und rankt", async () => {
    const t = new McpTools(deps());
    const r = await t.search({ query: "egal", min_similarity: 0.5 });
    expect(r.hits[0].path).toBe("a.md");
  });
  it("readNote respektiert den Pfad-Guard und liest via deps", async () => {
    const t = new McpTools(deps());
    expect(await t.readNote({ path: "a.md" })).toEqual({ path: "a.md", content: "# Inhalt von a.md" });
    await expect(t.readNote({ path: "Templates/x.md" })).rejects.toThrow();
  });
  it("wirft wenn kein Index geladen ist", async () => {
    const t = new McpTools(deps({ getIndex: () => null }));
    await expect(t.search({ query: "x" })).rejects.toThrow(/Index/);
  });
});
