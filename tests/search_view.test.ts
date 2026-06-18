import { describe, it, expect, vi } from "vitest";
import { SemanticSearchView, VIEW_TYPE_SEARCH, SearchResult } from "../src/search_view";
import { makeFakeApp } from "./__mocks__/obsidian";

function mkView(search: (q: string) => Promise<SearchResult>, openPath = () => {}) {
  const leaf: any = { app: makeFakeApp() };
  return new SemanticSearchView(leaf, { search, openPath });
}
const states = (v: any) =>
  v.contentEl.children.flatMap((c: any) => c.children ?? []).filter((c: any) => c.className?.includes("vault-rag-search-state"));
const hits = (v: any) =>
  v.contentEl.children.flatMap((c: any) => c.children ?? []).filter((c: any) => c.className?.includes("vault-rag-hit"));

describe("SemanticSearchView", () => {
  it("getViewType ist VIEW_TYPE_SEARCH", () => {
    expect(mkView(async () => ({ kind: "hits", hits: [] })).getViewType()).toBe(VIEW_TYPE_SEARCH);
  });
  it("kurze Query (<3) zeigt Hinweis, ruft search nicht", async () => {
    const search = vi.fn(async () => ({ kind: "hits", hits: [] }) as SearchResult);
    const v = mkView(search); await v.onOpen(); await v.runQuery("ab");
    expect(search).not.toHaveBeenCalled();
    expect(states(v).length).toBe(1);
  });
  it("Treffer werden gerendert", async () => {
    const v = mkView(async () => ({ kind: "hits", hits: [{ path: "a.md", score: 0.9 }] }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(hits(v).length).toBe(1);
  });
  it("offline-Zustand", async () => {
    const v = mkView(async () => ({ kind: "offline" }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(states(v).some((s: any) => s.textContent.includes("nicht erreichbar"))).toBe(true);
  });
  it("no-index-Zustand", async () => {
    const v = mkView(async () => ({ kind: "no-index" }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(states(v).some((s: any) => s.textContent.includes("Kein Index"))).toBe(true);
  });
  it("0 Treffer zeigt Schwellen-Hinweis", async () => {
    const v = mkView(async () => ({ kind: "hits", hits: [] }));
    await v.onOpen(); await v.runQuery("hallo welt");
    expect(states(v).some((s: any) => s.textContent.includes("Keine Treffer"))).toBe(true);
  });
});
