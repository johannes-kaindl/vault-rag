import { describe, it, expect } from "vitest";
import { RelatedPanel, renderHits } from "../src/view";
import { makeFakeEl } from "./__mocks__/obsidian";

function mountPanel(deps: ConstructorParameters<typeof RelatedPanel>[0]) {
  const container = makeFakeEl();
  const panel = new RelatedPanel(deps);
  panel.mount(container);
  return { panel, container };
}

describe("RelatedPanel", () => {
  it("zeigt Treffer", () => {
    const { container } = mountPanel({ getHits: () => [{ path: "A.md", score: 0.9 } as any], openPath: () => {} });
    expect(container.children.filter((c: any) => c.className?.includes("vault-rag-hit")).length).toBe(1);
  });

  it("Leerzustand ohne Treffer", () => {
    const { container } = mountPanel({ getHits: () => [], openPath: () => {} });
    expect(container.children.find((c: any) => c.className?.includes("vault-rag-empty"))).toBeTruthy();
  });

  it("onFileOpen rendert nur wenn sichtbar (lazy)", () => {
    let hits: any[] = [];
    const { panel, container } = mountPanel({ getHits: () => hits, openPath: () => {} });
    panel.onHide();                       // unsichtbar
    hits = [{ path: "A.md", score: 0.9 }];
    panel.onFileOpen("A.md");             // dirty, kein Re-Render
    expect(container.children.filter((c: any) => c.className?.includes("vault-rag-hit")).length).toBe(0);
    panel.onShow();                       // holt nach
    expect(container.children.filter((c: any) => c.className?.includes("vault-rag-hit")).length).toBe(1);
  });
});

describe("renderHits", () => {
  it("rendert eine Row pro Hit mit Titel, Score und Klick", () => {
    const el: any = makeFakeEl();
    const opened: string[] = [];
    renderHits(el, [{ path: "notes/foo.md", score: 0.85 }, { path: "bar.md", score: 0.5 }], p => opened.push(p));
    const rows = el.children.filter((c: any) => c.className?.includes("vault-rag-hit"));
    expect(rows.length).toBe(2);
    const score = rows[0].children.find((c: any) => c.className?.includes("vault-rag-hit-score"));
    expect(score.textContent).toBe("0.85");
    rows[0].click();
    expect(opened).toEqual(["notes/foo.md"]);
  });
});
