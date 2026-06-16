import { describe, it, expect } from "vitest";
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
});
