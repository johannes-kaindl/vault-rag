import { describe, it, expect, vi } from "vitest";
import { RelatedNotesView, VIEW_TYPE_RELATED } from "../src/view";
import { makeFakeApp } from "./__mocks__/obsidian";

describe("RelatedNotesView", () => {
  it("rendert eine Zeile pro Hit", async () => {
    const app = makeFakeApp();
    const leaf: any = { app };
    const view = new RelatedNotesView(leaf, {
      getHits: () => [{ path: "x.md", score: 0.9 }, { path: "y.md", score: 0.7 }],
      openPath: () => {},
    });
    expect(view.getViewType()).toBe(VIEW_TYPE_RELATED);
    view.render();
    const rows = view.contentEl.children.filter((c: any) => c.className?.includes("vault-rag-hit"));
    expect(rows.length).toBe(2);
  });

  it("zeigt Empty-State wenn keine Hits", () => {
    const app = makeFakeApp();
    const leaf: any = { app };
    const view = new RelatedNotesView(leaf, {
      getHits: () => [],
      openPath: () => {},
    });
    view.render();
    const emptyEls = view.contentEl.children.filter((c: any) => c.className?.includes("vault-rag-empty"));
    const hitEls = view.contentEl.children.filter((c: any) => c.className?.includes("vault-rag-hit"));
    expect(emptyEls.length).toBe(1);
    expect(hitEls.length).toBe(0);
  });

  it("Click auf Hit-Zeile ruft openPath mit dem korrekten Pfad auf", () => {
    const app = makeFakeApp();
    const leaf: any = { app };
    const openPath = vi.fn();
    const view = new RelatedNotesView(leaf, {
      getHits: () => [{ path: "notes/foo.md", score: 0.85 }],
      openPath,
    });
    view.render();
    const row = view.contentEl.children.find((c: any) => c.className?.includes("vault-rag-hit"));
    expect(row).toBeDefined();
    row.click();
    expect(openPath).toHaveBeenCalledWith("notes/foo.md");
  });

  it("Score wird als zweistellige Dezimalzahl gerendert", () => {
    const app = makeFakeApp();
    const leaf: any = { app };
    const view = new RelatedNotesView(leaf, {
      getHits: () => [{ path: "a.md", score: 0.8 }],
      openPath: () => {},
    });
    view.render();
    const row = view.contentEl.children.find((c: any) => c.className?.includes("vault-rag-hit"));
    const scoreEl = row?.children.find((c: any) => c.className?.includes("vault-rag-hit-score"));
    expect(scoreEl?.textContent).toBe("0.80");
  });
});
