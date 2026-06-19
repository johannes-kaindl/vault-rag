import { describe, it, expect } from "vitest";
import { ContextPanel, ContextPanelDeps } from "../src/context_panel";

function deps(over: Partial<ContextPanelDeps> = {}): ContextPanelDeps {
  return {
    embed: async () => new Float32Array([1, 0]),
    search: () => ["a.md", "b.md", "c.md", "d.md"],
    getActivePath: () => "aktiv.md",
    pickNote: async () => "gewaehlt.md",
    ...over,
  };
}

describe("ContextPanel", () => {
  it("setQuery füllt autoDocs bis autoK", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("eine frage");
    expect(p.autoDocs).toEqual(["a.md", "b.md"]);
  });
  it("Query <3 Zeichen → keine autoDocs", async () => {
    const p = new ContextPanel(deps(), 3);
    await p.setQuery("ab");
    expect(p.autoDocs).toEqual([]);
  });
  it("excludeAuto → nächst-ähnlicher rückt nach", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.excludeAuto("a.md");
    expect(p.autoDocs).toEqual(["b.md", "c.md"]);
  });
  it("pin schließt aus den autoDocs aus, currentPaths = pinned+auto", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.pin("a.md");
    expect(p.autoDocs).toEqual(["b.md", "c.md"]);
    expect(p.currentPaths()).toEqual(["a.md", "b.md", "c.md"]);
  });
  it("addActive pinnt die aktive Notiz; addViaPicker pinnt die gewählte", async () => {
    const p = new ContextPanel(deps(), 1);
    p.addActive();
    await p.addViaPicker();
    expect(p.pinned).toEqual(["aktiv.md", "gewaehlt.md"]);
  });
  it("setAutoK rechnet neu", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.setAutoK(4);
    expect(p.autoDocs).toEqual(["a.md", "b.md", "c.md", "d.md"]);
    p.setAutoK(0);
    expect(p.autoDocs).toEqual([]);
  });
  it("setAutoK über den Puffer hinaus holt neu", async () => {
    const calls: number[] = [];
    const p = new ContextPanel(deps({ search: (_v, n) => { calls.push(n); return Array.from({ length: n }, (_, i) => `n${i}.md`); } }), 1);
    await p.setQuery("frage");
    expect(p.autoDocs.length).toBe(1);
    p.setAutoK(40);
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toContain(60);
    expect(p.autoDocs.length).toBe(40);
  });
  it("embed-Fehler → autoDocs leer, Pins bleiben", async () => {
    const p = new ContextPanel(deps({ embed: async () => { throw new Error("offline"); } }), 2);
    p.pin("x.md");
    await p.setQuery("frage");
    expect(p.autoDocs).toEqual([]);
    expect(p.currentPaths()).toEqual(["x.md"]);
  });
  it("reset leert Ausschlüsse (Pins bleiben)", async () => {
    const p = new ContextPanel(deps(), 2);
    await p.setQuery("frage");
    p.excludeAuto("a.md");
    expect(p.autoDocs).toEqual(["b.md", "c.md"]);
    p.reset();
    expect(p.autoDocs).toEqual(["a.md", "b.md"]);
  });
});
