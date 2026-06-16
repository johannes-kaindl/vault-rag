import { describe, it, expect } from "vitest";
import { parseIndex } from "../src/index";

describe("parseIndex", () => {
  it("dequantisiert int8 → Float32 und mappt Pfade", () => {
    const manifest = { schema_version: 1, embedding_model: "qwen3-embedding:8b", index_dim: 2, scale: 127, count: 2, granularity: "note", quant: "int8" };
    const paths = ["a.md", "b.md"];
    const bytes = new Int8Array([127, 0, 0, 127]); // a=[1,0], b=[0,1]
    const idx = parseIndex(manifest, paths, bytes.buffer);
    expect(idx.count).toBe(2);
    expect(idx.rowFor("a.md")).toBe(0);
    expect(idx.rowFor("missing.md")).toBe(-1);
    const v = idx.vectorFor("a.md")!;
    expect(v[0]).toBeCloseTo(1, 2); expect(v[1]).toBeCloseTo(0, 2);
  });
});
