import { describe, it, expect } from "vitest";
import { parseIndex } from "../src/index";
import { Retriever } from "../src/retriever";

function idx() {
  const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
  // a=[1,0]  b=[0.92,0.39]  c=[0,1]
  const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
  return parseIndex(m, ["a.md", "b.md", "c.md"], bytes.buffer);
}

describe("Retriever", () => {
  it("liefert nächste Nachbarn der aktiven Notiz, self ausgeschlossen", () => {
    const r = new Retriever(idx());
    const hits = r.related("a.md", { k: 2, minSim: 0, exclude: [] });
    expect(hits.map(h => h.path)).toEqual(["b.md", "c.md"]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
  it("respektiert minSim + exclude + fehlende Notiz", () => {
    const r = new Retriever(idx());
    expect(r.related("a.md", { k: 5, minSim: 0.5, exclude: [] }).map(h => h.path)).toEqual(["b.md"]);
    expect(r.related("a.md", { k: 5, minSim: 0, exclude: ["b.md"] }).map(h => h.path)).toEqual(["c.md"]);
    expect(r.related("missing.md", { k: 5, minSim: 0, exclude: [] })).toEqual([]);
  });
  it("Präfix-Exclude filtert Ordner-Präfix korrekt", () => {
    const m = { schema_version: 1, embedding_model: "x", index_dim: 2, scale: 127, count: 3, granularity: "note", quant: "int8" };
    const bytes = new Int8Array([127, 0, 117, 50, 0, 127]);
    const index = parseIndex(m, ["a.md", "Templates/x.md", "c.md"], bytes.buffer);
    const r = new Retriever(index);
    const paths = r.related("a.md", { k: 5, minSim: 0, exclude: ["Templates/"] }).map(h => h.path);
    expect(paths).not.toContain("Templates/x.md");
    expect(paths).toContain("c.md");
  });
  it("k > verfügbare Notizen → gibt ≤ (count-1) Treffer zurück", () => {
    const r = new Retriever(idx());
    const hits = r.related("a.md", { k: 99, minSim: 0, exclude: [] });
    expect(hits.length).toBeLessThanOrEqual(2); // 3 notes minus active
    expect(hits.length).toBeGreaterThan(0);
  });
});
