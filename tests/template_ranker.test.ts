import { describe, it, expect } from "vitest";
import { TemplateRanker, RankDeps, TemplateRank } from "../src/template_ranker";

function deps(over: Partial<RankDeps> = {}): RankDeps {
  return {
    read: async (p) => (p.startsWith("Templates/") ? p : "Body"),
    stat: async () => ({ mtime: 1 }),
    listTemplates: async () => ["Templates/Besprechung.md", "Templates/Buch.md"],
    indexVector: () => null,            // Default: nicht indexiert → Embed-Fallback
    embed: async () => new Float32Array([1, 0]),
    ...over,
  };
}

describe("TemplateRanker", () => {
  it("sortiert Vorlagen nach Cosinus absteigend", async () => {
    const vecs: Record<string, Float32Array> = {
      "Body": new Float32Array([1, 0]),
      "Templates/Besprechung.md": new Float32Array([0.9, 0.436]),
      "Templates/Buch.md": new Float32Array([0.1, 0.995]),
    };
    const r = new TemplateRanker(deps({ embed: async (t) => vecs[t] ?? vecs["Body"] }));
    const out = await r.rank("note.md");
    expect(out.map(x => x.templatePath)).toEqual(["Templates/Besprechung.md", "Templates/Buch.md"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[0].source).toBe("match");
  });

  it("Frontmatter-type pinnt die passende Vorlage als confirmed nach oben — trotz niedrigerem Score", async () => {
    const r = new TemplateRanker(deps({
      read: async (p) => (p.startsWith("Templates/") ? p : "---\ntype: Buch\n---\nBody"),
      embed: async (t) => {
        if (!t.startsWith("Templates/")) return new Float32Array([1, 0]);      // query
        return t.includes("Besprechung") ? new Float32Array([1, 0]) : new Float32Array([0.5, 0.866]);
      },
    }));
    const out = await r.rank("note.md");
    expect(out[0].templatePath).toBe("Templates/Buch.md");
    expect(out[0].source).toBe("confirmed");
  });

  it("Embedder offline → kein Throw, alphabetischer Fallback (score 0, source fallback)", async () => {
    const r = new TemplateRanker(deps({ embed: async () => { throw new Error("offline"); } }));
    const out = await r.rank("note.md");
    expect(out.every(x => x.score === 0 && x.source === "fallback")).toBe(true);
    expect(out.map(x => x.templatePath)).toEqual(["Templates/Besprechung.md", "Templates/Buch.md"]);
  });

  it("Offline mit Frontmatter-type → passende Vorlage bleibt confirmed", async () => {
    const r = new TemplateRanker(deps({
      read: async (p) => (p.startsWith("Templates/") ? p : "---\ntype: Buch\n---\nBody"),
      embed: async () => { throw new Error("offline"); },
    }));
    const out = await r.rank("note.md");
    expect(out[0].templatePath).toBe("Templates/Buch.md");
    expect(out[0].source).toBe("confirmed");
  });

  it("cached das Vorlagen-Embedding per mtime; re-embed erst bei mtime-Änderung", async () => {
    let embedCalls = 0;
    let mtime = 1;
    const r = new TemplateRanker(deps({
      listTemplates: async () => ["Templates/Besprechung.md"],
      stat: async () => ({ mtime }),
      embed: async () => { embedCalls++; return new Float32Array([1, 0]); },
    }));
    await r.rank("note.md");                       // query(1) + tpl(1)
    await r.rank("note.md");                       // query(1) + cache-hit(0)
    expect(embedCalls).toBe(3);
    mtime = 2;
    await r.rank("note.md");                        // query(1) + re-embed(1)
    expect(embedCalls).toBe(5);
  });
});

describe("TemplateRanker — Index-Reuse", () => {
  it("nutzt persistierte Index-Vektoren statt neu zu embedden (kein embed-Call)", async () => {
    const vecs: Record<string, Float32Array> = {
      "note.md": new Float32Array([1, 0]),
      "Templates/Besprechung.md": new Float32Array([0.9, 0.436]),
      "Templates/Buch.md": new Float32Array([0.1, 0.995]),
    };
    let embedCalls = 0;
    const r = new TemplateRanker(deps({
      indexVector: (p) => vecs[p] ?? null,
      embed: async () => { embedCalls++; return new Float32Array([1, 0]); },
    }));
    const out = await r.rank("note.md");
    expect(embedCalls).toBe(0);                                   // alles aus dem Index
    expect(out.map(x => x.templatePath)).toEqual(["Templates/Besprechung.md", "Templates/Buch.md"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("embeddet nur bei Index-Miss (Fallback für nicht-indexierte Datei)", async () => {
    const vecs: Record<string, Float32Array> = {
      "note.md": new Float32Array([1, 0]),
      "Templates/Besprechung.md": new Float32Array([1, 0]),
      // Buch.md fehlt im Index → Fallback embed
    };
    let embedCalls = 0;
    const r = new TemplateRanker(deps({
      indexVector: (p) => vecs[p] ?? null,
      embed: async () => { embedCalls++; return new Float32Array([0, 1]); },
    }));
    const out = await r.rank("note.md");
    expect(embedCalls).toBe(1);                                   // nur Buch.md
    expect(out.find(x => x.templatePath === "Templates/Buch.md")?.source).toBe("match");
  });

  it("Query-Vektor kommt aus dem Index, wenn die aktive Notiz indexiert ist", async () => {
    const vecs: Record<string, Float32Array> = {
      "note.md": new Float32Array([0, 1]),                        // Query betont Dim 2
      "Templates/Besprechung.md": new Float32Array([1, 0]),
      "Templates/Buch.md": new Float32Array([0, 1]),
    };
    const r = new TemplateRanker(deps({
      indexVector: (p) => vecs[p] ?? null,
      embed: async () => { throw new Error("sollte nicht aufgerufen werden"); },
    }));
    const out = await r.rank("note.md");
    expect(out[0].templatePath).toBe("Templates/Buch.md");        // Query≈Buch
  });
});
