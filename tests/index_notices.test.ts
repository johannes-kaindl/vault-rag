import { describe, it, expect } from "vitest";
import { RecurringFindings, shouldOfferCompletion } from "../src/index_notices";

const paths = (n: number) => Array.from({ length: n }, (_, i) => `n${i + 1}.md`);

describe("shouldOfferCompletion — Fenster „Index vervollständigen“", () => {
  const base = { missing: paths(30), total: 100, running: false, paused: false, queued: (_p: string) => false, offered: false };
  const queuedSet = (ps: string[]) => { const set = new Set(ps); return (p: string) => set.has(p); };

  it.each([
    ["Lücke, nichts im Weg", {}, true],
    ["ein Lauf schreibt gerade", { running: true }, false],
    ["die Einbettung ist pausiert", { paused: true }, false],
    ["das Fenster kam in dieser Sitzung schon", { offered: true }, false],
    ["alle fehlenden Notizen stehen schon in der Warteschlange", { queued: queuedSet(paths(30)) }, false],
    ["15 von 25 fehlenden stehen nicht in der Warteschlange: unter der Schwelle", { missing: paths(25), queued: queuedSet(paths(10)) }, false],
    ["21 fehlende von 100: über 20 und über 5 Prozent", { missing: paths(21) }, true],
    ["20 fehlende von 100: nicht über 20", { missing: paths(20) }, false],
    ["25 fehlende von 1000: unter 5 Prozent", { missing: paths(25), total: 1000 }, false],
  ])("%s", (_name, over, expected) => {
    expect(shouldOfferCompletion({ ...base, ...over })).toBe(expected);
  });
});

describe("RecurringFindings — derselbe Pfad in drei Reloads derselben Sitzung", () => {
  it("meldet beim ersten und zweiten Mal normal, beim dritten Mal einmal als wiederkehrend, danach nichts mehr", () => {
    const f = new RecurringFindings();
    expect(f.observe(["a.md", "b.md"])).toEqual({ report: ["a.md", "b.md"], recurring: [] });
    expect(f.observe(["a.md", "b.md"])).toEqual({ report: ["a.md", "b.md"], recurring: [] });
    expect(f.observe(["a.md", "b.md"])).toEqual({ report: [], recurring: ["a.md", "b.md"] });
    expect(f.observe(["a.md", "b.md"])).toEqual({ report: [], recurring: [] });
  });

  it("ein Pfad, der in einem Reload fehlt, fängt von vorn an zu zählen", () => {
    const f = new RecurringFindings();
    f.observe(["a.md"]);
    f.observe(["a.md"]);
    f.observe([]);                                   // a.md war in Ordnung
    expect(f.observe(["a.md"])).toEqual({ report: ["a.md"], recurring: [] });
  });

  it("neue Pfade neben alten zählen für sich", () => {
    const f = new RecurringFindings();
    f.observe(["a.md"]);
    f.observe(["a.md", "b.md"]);
    expect(f.observe(["a.md", "b.md"])).toEqual({ report: ["b.md"], recurring: ["a.md"] });
  });
});
