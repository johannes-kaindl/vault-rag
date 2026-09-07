import { describe, it, expect } from "vitest";
import { proposeLinks, inScope, hashText, ProposeDeps } from "../src/integrator";
import type { RelatedResult } from "../src/retrieval_facade";

function deps(over: Partial<ProposeDeps> = {}): ProposeDeps {
  return {
    related: (): RelatedResult => ({ kind: "hits", hits: [{ path: "b.md", score: 0.9 }, { path: "c.md", score: 0.8 }, { path: "d#x.md", score: 0.7 }] }),
    existingLinks: () => new Set<string>(),
    rejected: () => new Set<string>(),
    now: () => 42,
    ...over,
  };
}

describe("proposeLinks", () => {
  it("liefert einen Vorschlag mit Hash, Zeit und gefilterten Zielen (unlinkable fliegt raus)", () => {
    const r = proposeLinks("a.md", "Text", deps());
    expect(r).toEqual({ kind: "proposal", proposal: {
      notePath: "a.md", noteHash: hashText("Text"), createdAt: 42, stale: false,
      links: [{ path: "b.md", score: 0.9 }, { path: "c.md", score: 0.8 }],
    } });
  });
  it("filtert bereits verlinkte und abgelehnte Ziele", () => {
    const r = proposeLinks("a.md", "T", deps({ existingLinks: () => new Set(["b.md"]), rejected: () => new Set(["c.md"]) }));
    expect(r).toEqual({ kind: "nothing-new" });
  });
  it("reicht no-index und not-indexed durch", () => {
    expect(proposeLinks("a.md", "T", deps({ related: () => ({ kind: "no-index" }) }))).toEqual({ kind: "no-index" });
    expect(proposeLinks("a.md", "T", deps({ related: () => ({ kind: "not-indexed", path: "a.md" }) }))).toEqual({ kind: "not-indexed" });
  });
  it("nothing-new bei leerer Trefferliste", () => {
    expect(proposeLinks("a.md", "T", deps({ related: () => ({ kind: "hits", hits: [] }) }))).toEqual({ kind: "nothing-new" });
  });
});

describe("inScope", () => {
  it("leere Liste → nie im Bereich", () => expect(inScope("00_Inbox/x.md", [])).toBe(false));
  it("Präfix-Treffer", () => {
    expect(inScope("00_Inbox/x.md", ["00_Inbox/"])).toBe(true);
    expect(inScope("00_Inbox2/x.md", ["00_Inbox/"])).toBe(false);
    expect(inScope("Notes/a/b.md", ["Templates/", "Notes/"])).toBe(true);
  });
});

describe("hashText", () => {
  it("ist deterministisch und unterscheidet Texte", () => {
    expect(hashText("a")).toBe(hashText("a"));
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});
