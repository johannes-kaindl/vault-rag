import { describe, it, expect, vi } from "vitest";
import { SearchPanel, SearchResult } from "../src/search_view";
import { makeFakeEl } from "./__mocks__/obsidian";

function mkPanel(search: (q: string) => Promise<SearchResult>, openPath = () => {}) {
  const container = makeFakeEl();
  const panel = new SearchPanel({ search, openPath });
  panel.mount(container);
  return { panel, container };
}
const states = (container: any) =>
  container.children.flatMap((c: any) => c.children ?? []).filter((c: any) => c.className?.includes("vault-rag-search-state"));
const hits = (container: any) =>
  container.children.flatMap((c: any) => c.children ?? []).filter((c: any) => c.className?.includes("vault-rag-hit"));

describe("SearchPanel", () => {
  it("id ist 'search'", () => {
    const { panel } = mkPanel(async () => ({ kind: "hits", hits: [] }));
    expect(panel.id).toBe("search");
  });
  it("kurze Query (<3) zeigt Hinweis, ruft search nicht", async () => {
    const search = vi.fn(async () => ({ kind: "hits", hits: [] }) as SearchResult);
    const { panel, container } = mkPanel(search);
    await panel.runQuery("ab");
    expect(search).not.toHaveBeenCalled();
    expect(states(container).length).toBe(1);
  });
  it("Treffer werden gerendert", async () => {
    const { panel, container } = mkPanel(async () => ({ kind: "hits", hits: [{ path: "a.md", score: 0.9 }] }));
    await panel.runQuery("hallo welt");
    expect(hits(container).length).toBe(1);
  });
  it("offline-Zustand", async () => {
    const { panel, container } = mkPanel(async () => ({ kind: "offline" }));
    await panel.runQuery("hallo welt");
    expect(states(container).some((s: any) => s.textContent.includes("nicht erreichbar"))).toBe(true);
  });
  it("no-index-Zustand", async () => {
    const { panel, container } = mkPanel(async () => ({ kind: "no-index" }));
    await panel.runQuery("hallo welt");
    expect(states(container).some((s: any) => s.textContent.includes("Kein Index"))).toBe(true);
  });
  it("0 Treffer zeigt Schwellen-Hinweis", async () => {
    const { panel, container } = mkPanel(async () => ({ kind: "hits", hits: [] }));
    await panel.runQuery("hallo welt");
    expect(states(container).some((s: any) => s.textContent.includes("Keine Treffer"))).toBe(true);
  });
});
