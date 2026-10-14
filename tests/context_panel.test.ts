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

describe("ContextPanel — k=0 und Pause (Spec 2026-09-17)", () => {
  it("k = 0: kein Embedding-Aufruf, keine autoDocs; Gepinntes geht trotzdem mit", async () => {
    let calls = 0;
    const p = new ContextPanel(deps({ embed: async () => { calls++; return new Float32Array([1, 0]); } }), 0);
    await p.setQuery("eine frage");
    p.pin("x.md");
    expect(calls).toBe(0);
    expect(p.autoDocs).toEqual([]);
    expect(p.currentPaths()).toEqual(["x.md"]);
  });
  it("Gegenprobe: mit k > 0 wird embedded (sonst misst der Test über k=0 nichts)", async () => {
    let calls = 0;
    const p = new ContextPanel(deps({ embed: async () => { calls++; return new Float32Array([1, 0]); } }), 2);
    await p.setQuery("eine frage");
    expect(calls).toBe(1);
  });
  it("Pause: kein Embedding, autoK bleibt gespeichert, effectiveK ist 0; Fortsetzen sucht die letzte Eingabe neu", async () => {
    let paused = false; let calls = 0;
    const p = new ContextPanel(deps({ isPaused: () => paused, embed: async () => { calls++; return new Float32Array([1, 0]); } }), 3);
    await p.setQuery("meine frage");
    expect(calls).toBe(1);
    paused = true; p.onPause();
    expect(p.autoDocs).toEqual([]);
    expect(p.effectiveK()).toBe(0);
    expect(p.autoK).toBe(3);
    await p.setQuery("andere frage");
    expect(calls).toBe(1);                       // während der Pause kein einziger Aufruf
    paused = false; p.onResume();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toBe(2);                       // Fortsetzen: genau die letzte Eingabe wird neu gesucht
    expect(p.autoDocs.length).toBe(3);
  });
  it("setAutoK von 0 auf ≥ 1 sucht die aktuelle Eingabe neu", async () => {
    let calls = 0;
    const p = new ContextPanel(deps({ embed: async () => { calls++; return new Float32Array([1, 0]); } }), 0);
    await p.setQuery("eine frage");
    p.setAutoK(2);
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toBe(1);
    expect(p.autoDocs).toEqual(["a.md", "b.md"]);
  });
});

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
