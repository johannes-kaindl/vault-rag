import { describe, it, expect } from "vitest";
import { parseIndex, VaultIndex } from "../src/index";
import { RetrievalFacade, RetrievalDeps } from "../src/retrieval_facade";

function idx(): VaultIndex {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  // a=[1,0]  b=[0.92,0.39]  c=[0,1]
  const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
  return parseIndex(m, ["a.md", "b.md", "c.md"], bytes.buffer);
}

function deps(over: Partial<RetrievalDeps> = {}): RetrievalDeps {
  return {
    getIndex: () => idx(),
    embedderReady: async () => true,
    embed: async () => [new Float32Array([1, 0])],
    settings: () => ({ k: 5, minSim: 0, exclude: [] }),
    readVault: async () => "",
    ...over,
  };
}

describe("RetrievalFacade.embedQuery", () => {
  it("no-index wenn kein Index geladen", async () => {
    const f = new RetrievalFacade(deps({ getIndex: () => null }));
    expect(await f.embedQuery("x")).toEqual({ kind: "no-index" });
  });
  it("offline wenn Embedder nicht bereit", async () => {
    const f = new RetrievalFacade(deps({ embedderReady: async () => false }));
    expect(await f.embedQuery("x")).toEqual({ kind: "offline" });
  });
  it("offline wenn embed leer antwortet", async () => {
    const f = new RetrievalFacade(deps({ embed: async () => [] }));
    expect(await f.embedQuery("x")).toEqual({ kind: "offline" });
  });
  it("offline wenn embed wirft", async () => {
    const f = new RetrievalFacade(deps({ embed: async () => { throw new Error("net"); } }));
    expect(await f.embedQuery("x")).toEqual({ kind: "offline" });
  });
  it("vec: toIndexVector auf Index-dim, L2-normalisiert", async () => {
    const f = new RetrievalFacade(deps());
    const r = await f.embedQuery("x");
    expect(r.kind).toBe("vec");
    if (r.kind === "vec") { expect(r.vec.length).toBe(2); expect(r.vec[0]).toBeCloseTo(1, 5); }
  });
});

describe("RetrievalFacade.searchVector", () => {
  it("no-index wenn kein Index", () => {
    const f = new RetrievalFacade(deps({ getIndex: () => null }));
    expect(f.searchVector(new Float32Array([1, 0]))).toEqual({ kind: "no-index" });
  });
  it("hits: rankt per Query-Vektor über settings-Defaults", () => {
    const f = new RetrievalFacade(deps());
    const r = f.searchVector(new Float32Array([1, 0]));
    expect(r).toEqual({ kind: "hits", hits: expect.any(Array) });
    if (r.kind === "hits") expect(r.hits.map(h => h.path)).toEqual(["a.md", "b.md", "c.md"]);
  });
  it("opts überschreiben k/minSim; exclude bleibt aus settings", () => {
    const f = new RetrievalFacade(deps({ settings: () => ({ k: 5, minSim: 0, exclude: ["a.md"] }) }));
    const r = f.searchVector(new Float32Array([1, 0]), { k: 1, minSim: 0 });
    if (r.kind === "hits") expect(r.hits.map(h => h.path)).toEqual(["b.md"]); // a.md excluded, k=1
  });
});

describe("RetrievalFacade.search", () => {
  it("no-index / offline werden durchgereicht", async () => {
    expect(await new RetrievalFacade(deps({ getIndex: () => null })).search("x")).toEqual({ kind: "no-index" });
    expect(await new RetrievalFacade(deps({ embedderReady: async () => false })).search("x")).toEqual({ kind: "offline" });
  });
  it("hits: embed dann cosine", async () => {
    const r = await new RetrievalFacade(deps()).search("x");
    expect(r.kind).toBe("hits");
    if (r.kind === "hits") expect(r.hits[0].path).toBe("a.md");
  });
});

describe("RetrievalFacade.related", () => {
  it("no-index wenn kein Index", () => {
    expect(new RetrievalFacade(deps({ getIndex: () => null })).related("a.md")).toEqual({ kind: "no-index" });
  });
  it("not-indexed wenn Pfad nicht im Index", () => {
    expect(new RetrievalFacade(deps()).related("missing.md")).toEqual({ kind: "not-indexed", path: "missing.md" });
  });
  it("hits: verwandte Notizen, self ausgeschlossen", () => {
    const r = new RetrievalFacade(deps()).related("a.md", { k: 2 });
    if (r.kind === "hits") expect(r.hits.map(h => h.path)).toEqual(["b.md", "c.md"]);
    else throw new Error("erwartete hits");
  });
});
