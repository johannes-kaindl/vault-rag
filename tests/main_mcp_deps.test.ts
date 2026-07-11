// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VaultIndex, IndexManifest } from "../src/index";
import { buildMcpDeps, type McpDepsHost } from "../src/main";

function idx(): VaultIndex {
  const m: IndexManifest = { schema_version: 1, embedding_model: "x", index_dim: 4, scale: 127, count: 1, granularity: "note", quant: "int8" };
  return new VaultIndex(m, ["a.md"], new Float32Array([1, 0, 0, 0]));
}

describe("buildMcpDeps", () => {
  it("liefert Index/Settings/read/embed aus dem Host", async () => {
    const host: McpDepsHost = {
      getIndex: () => idx(),
      embedderReady: async () => true,
      embed: async () => [new Float32Array([1, 0, 0, 0])],
      readVault: async (p) => `# ${p}`,
      settings: { k: 5, minSim: 0.2, exclude: ["Templates/"] },
    };
    const deps = buildMcpDeps(host);
    expect(deps.getIndex()?.count).toBe(1);
    expect(deps.settings()).toEqual({ k: 5, minSim: 0.2, exclude: ["Templates/"] });
    expect(await deps.readNote("a.md")).toBe("# a.md");
    const v = await deps.embedQuery("q", 4);
    expect(v.length).toBe(4);
  });
  it("embedQuery wirft wenn Embedder offline", async () => {
    const host: McpDepsHost = {
      getIndex: () => idx(), embedderReady: async () => false,
      embed: async () => [], readVault: async () => "", settings: { k: 5, minSim: 0, exclude: [] },
    };
    await expect(buildMcpDeps(host).embedQuery("q", 4)).rejects.toThrow();
  });
});
