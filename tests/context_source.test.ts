import { describe, it, expect } from "vitest";
import { buildContext } from "../src/context_source";

describe("buildContext", () => {
  const read = async (p: string) => `Inhalt von ${p}`;
  it("baut Kontext aus gegebenen Pfaden + sources", async () => {
    const r = await buildContext(["a.md", "b.md"], { read, budget: 1000 });
    expect(r.sources).toEqual(["a.md", "b.md"]);
    expect(r.text).toContain("## a.md");
    expect(r.text).toContain("Inhalt von a.md");
  });
  it("kürzt pro Notiz aufs Budget", async () => {
    const r = await buildContext(["a.md", "b.md"], { read: async () => "x".repeat(5000), budget: 100 });
    expect(r.text.length).toBeLessThan(300);
  });
  it("überspringt nicht lesbare Notizen", async () => {
    const r = await buildContext(["a.md", "b.md"], { read: async (p) => { if (p === "a.md") throw new Error("weg"); return "ok"; }, budget: 1000 });
    expect(r.sources).toEqual(["b.md"]);
  });
  it("leere Pfadliste → leerer Kontext", async () => {
    const r = await buildContext([], { read, budget: 1000 });
    expect(r).toEqual({ text: "", sources: [] });
  });
});
