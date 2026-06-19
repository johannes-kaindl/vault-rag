import { describe, it, expect } from "vitest";
import { assembleContext, ContextDeps, buildContext } from "../src/context_source";

function deps(over: Partial<ContextDeps> = {}): ContextDeps {
  return {
    embed: async () => new Float32Array([1, 0]),
    search: () => ["a.md", "b.md"],
    related: () => ["y.md"],
    read: async (p) => `Inhalt von ${p}`,
    activePath: () => "x.md",
    picked: () => ["p.md"],
    k: 5, budget: 1000,
    ...over,
  };
}

describe("assembleContext", () => {
  it("auto-rag: embed→search→Notiztexte + sources", async () => {
    const r = await assembleContext("auto-rag", "frage", deps());
    expect(r.sources).toEqual(["a.md", "b.md"]);
    expect(r.text).toContain("## a.md");
    expect(r.text).toContain("Inhalt von a.md");
  });
  it("active-note: aktive Notiz + verwandte", async () => {
    const r = await assembleContext("active-note", "", deps());
    expect(r.sources).toEqual(["x.md", "y.md"]);
  });
  it("picked-notes: gewählte Notizen", async () => {
    const r = await assembleContext("picked-notes", "", deps());
    expect(r.sources).toEqual(["p.md"]);
  });
  it("budget kürzt pro Notiz", async () => {
    const r = await assembleContext("auto-rag", "f", deps({ read: async () => "x".repeat(5000), budget: 100 }));
    expect(r.text.length).toBeLessThan(300);
  });
  it("read-Fehler überspringt die Notiz", async () => {
    const r = await assembleContext("auto-rag", "f", deps({
      read: async (p) => { if (p === "a.md") throw new Error("weg"); return "ok"; },
    }));
    expect(r.sources).toEqual(["b.md"]);
  });
  it("active-note ohne aktive Notiz → leer", async () => {
    const r = await assembleContext("active-note", "", deps({ activePath: () => null }));
    expect(r.sources).toEqual([]);
  });
});

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
