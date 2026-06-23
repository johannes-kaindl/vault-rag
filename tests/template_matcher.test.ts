import { describe, it, expect } from "vitest";
import {
  stripAnnotations,
  extractType,
  parseTemplate,
  resolveTemplateForType,
  detectType,
  type DetectDeps,
} from "../src/template_matcher";

describe("stripAnnotations", () => {
  it("entfernt einzeiliges %% ... %%", () => {
    expect(stripAnnotations("vor %% weg %% nach")).toBe("vor  nach");
  });
  it("entfernt mehrzeilige %% ... %%-Blöcke", () => {
    const input = "# Titel\n%%\nDas ist eine Anweisung\nüber mehrere Zeilen\n%%\nInhalt";
    expect(stripAnnotations(input)).toBe("# Titel\n\nInhalt");
  });
  it("lässt Text ohne Annotation unverändert", () => {
    expect(stripAnnotations("nur normaler Text")).toBe("nur normaler Text");
  });
});

describe("extractType", () => {
  it("liest type: aus dem Frontmatter", () => {
    const note = "---\ntype: 💻 Coding\nup: [[Parent]]\n---\nBody-Text";
    expect(extractType(note)).toBe("💻 Coding");
  });
  it("liefert null ohne Frontmatter", () => {
    expect(extractType("# Nur ein Body\nkein Frontmatter")).toBeNull();
  });
  it("liefert null wenn Frontmatter kein type: hat", () => {
    expect(extractType("---\ntags: [a, b]\n---\nBody")).toBeNull();
  });
  it("trimmt umgebende Anführungszeichen am type-Wert", () => {
    expect(extractType('---\ntype: "Meeting Note"\n---\nBody')).toBe("Meeting Note");
  });
});

describe("parseTemplate", () => {
  const tpl = [
    "---",
    "type: 💻 Coding",
    "up: ",
    "tags: ",
    "---",
    "# Zusammenfassung",
    "Worum geht es?",
    "## Details",
    "",
    "## Offene Fragen",
    "Platzhalter-Text",
  ].join("\n");

  it("extrahiert Frontmatter-Keys in Reihenfolge", () => {
    expect(parseTemplate(tpl).keys).toEqual(["type", "up", "tags"]);
  });
  it("extrahiert geordnete Überschriften mit Level", () => {
    const s = parseTemplate(tpl).sections;
    expect(s.map(x => x.heading)).toEqual(["Zusammenfassung", "Details", "Offene Fragen"]);
    expect(s.map(x => x.level)).toEqual([1, 2, 2]);
  });
  it("sammelt den Text unter einer Überschrift als placeholder", () => {
    const s = parseTemplate(tpl).sections;
    expect(s[0].placeholder).toBe("Worum geht es?");
    expect(s[1].placeholder).toBe("");
    expect(s[2].placeholder).toBe("Platzhalter-Text");
  });
  it("übernimmt den type aus dem Frontmatter und behält raw", () => {
    const spec = parseTemplate(tpl);
    expect(spec.type).toBe("💻 Coding");
    expect(spec.raw).toBe(tpl);
  });
});

describe("resolveTemplateForType", () => {
  const templates = ["Templates/💻 Coding.md", "Templates/Meeting Note.md", "Templates/Buch.md"];
  it("matcht trotz Emoji und Groß/Kleinschreibung", () => {
    expect(resolveTemplateForType("coding", templates)).toBe("Templates/💻 Coding.md");
  });
  it("matcht den exakten Basename", () => {
    expect(resolveTemplateForType("Meeting Note", templates)).toBe("Templates/Meeting Note.md");
  });
  it("liefert null ohne passendes Template", () => {
    expect(resolveTemplateForType("Aufgabe", templates)).toBeNull();
  });
});

describe("detectType", () => {
  const templates = ["Templates/💻 Coding.md", "Templates/Buch.md", "Templates/Meeting Note.md"];
  function baseDeps(over: Partial<DetectDeps> = {}): DetectDeps {
    return {
      read: async () => "Body ohne Frontmatter",
      listTemplates: async () => templates,
      embed: async () => new Float32Array([1, 0]),
      search: () => [],
      typeOf: async () => null,
      ...over,
    };
  }

  it("Frontmatter-type mit passendem Template kurzschließt RAG (source=frontmatter/confirmed)", async () => {
    let searched = false;
    const deps = baseDeps({
      read: async () => "---\ntype: Coding\n---\nBody",
      search: () => { searched = true; return []; },
    });
    const s = await detectType("note.md", deps);
    expect(s).toEqual({
      type: "Coding",
      templatePath: "Templates/💻 Coding.md",
      source: "frontmatter",
      confidence: "confirmed",
    });
    expect(searched).toBe(false);
  });

  it("Frontmatter-type ohne passendes Template fällt auf RAG zurück", async () => {
    const deps = baseDeps({
      read: async () => "---\ntype: Unbekannt\n---\nBody",
      search: () => [{ path: "a.md", score: 0.9 }],
      typeOf: async () => "Buch",
    });
    const s = await detectType("note.md", deps);
    expect(s.source).toBe("rag");
    expect(s.type).toBe("Buch");
  });

  it("RAG wählt per gewichtetem Vote den Typ mit der höchsten Score-Summe", async () => {
    const types: Record<string, string> = { "a.md": "Buch", "b.md": "Coding", "c.md": "Coding" };
    const deps = baseDeps({
      search: () => [
        { path: "a.md", score: 0.9 },
        { path: "b.md", score: 0.6 },
        { path: "c.md", score: 0.55 },
      ],
      typeOf: async (p) => types[p] ?? null,
    });
    const s = await detectType("note.md", deps);
    // Coding: 0.6 + 0.55 = 1.15  >  Buch: 0.9
    expect(s.type).toBe("Coding");
    expect(s.templatePath).toBe("Templates/💻 Coding.md");
    expect(s.source).toBe("rag");
    expect(s.confidence).toBe("likely");
  });

  it("Hits ohne Typ oder unlesbar werden im Vote übersprungen", async () => {
    const deps = baseDeps({
      search: () => [
        { path: "leer.md", score: 5 },     // typeOf -> null
        { path: "kaputt.md", score: 4 },   // typeOf wirft
        { path: "ok.md", score: 0.2 },
      ],
      typeOf: async (p) => {
        if (p === "leer.md") return null;
        if (p === "kaputt.md") throw new Error("unlesbar");
        return "Buch";
      },
    });
    const s = await detectType("note.md", deps);
    expect(s.type).toBe("Buch");
    expect(s.source).toBe("rag");
  });

  it("kein Frontmatter-type und keine RAG-Treffer → source=none/no", async () => {
    const s = await detectType("note.md", baseDeps());
    expect(s).toEqual({ type: null, templatePath: null, source: "none", confidence: "no" });
  });

  it("RAG-Treffer ohne auflösbares Template → source=none", async () => {
    const deps = baseDeps({
      search: () => [{ path: "a.md", score: 0.9 }],
      typeOf: async () => "Aufgabe", // kein Template dafür
    });
    const s = await detectType("note.md", deps);
    expect(s.source).toBe("none");
    expect(s.type).toBeNull();
  });
});
