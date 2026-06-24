import { describe, it, expect } from "vitest";
import {
  stripAnnotations,
  extractType,
  parseTemplate,
  resolveTemplateForType,
  detectType,
  templateFilesUnder,
  isFolderNote,
  extractAnnotations,
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
  it("erfasst fmDefaults aus dem Template-Frontmatter", () => {
    // Template with type: Besprechung + status: offen
    const tpl2 = parseTemplate("---\ntype: Besprechung\nstatus: offen\n---\n## Tagesordnung\n");
    expect(tpl2.fmDefaults["type"]).toBe("Besprechung");
    expect(tpl2.fmDefaults["status"]).toBe("offen");
    expect(tpl2.type).toBe("Besprechung");
  });
  it("keys-Reihenfolge folgt der Frontmatter-Reihenfolge", () => {
    const tpl2 = parseTemplate("---\ntype: Besprechung\nstatus: offen\nteilnehmer:\n---\n## Tagesordnung\n");
    expect(tpl2.keys).toEqual(["type", "status", "teilnehmer"]);
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

  it("RAG-Treffer ohne auflösbares Template → type gesetzt, templatePath=null, source=rag", async () => {
    const deps = baseDeps({
      search: () => [{ path: "a.md", score: 0.9 }],
      typeOf: async () => "Aufgabe", // kein Template dafür
    });
    const s = await detectType("note.md", deps);
    expect(s.source).toBe("rag");
    expect(s.type).toBe("Aufgabe");
    expect(s.templatePath).toBeNull();
    expect(s.confidence).toBe("likely");
  });

  it("negativer RAG-Hit wird durch minSim-Filter ausgeschlossen und fließt nicht in den Vote", async () => {
    let capturedMinSim: number | undefined;
    const deps = baseDeps({
      search: (vec, opts) => {
        capturedMinSim = opts.minSim;
        // Fake honors the minSim contract — same as the real index would do.
        return [
          { path: "a.md", score: 0.5 },
          { path: "b.md", score: -0.3 },
        ].filter(h => h.score >= opts.minSim);
      },
      typeOf: async (p) => (p === "a.md" ? "Buch" : "Coding"),
    });
    const s = await detectType("note.md", deps);
    // minSim must be positive so negative-score hits are filtered out by the real index.
    expect(capturedMinSim).toBeGreaterThan(0);
    // Only "a.md" (Buch, score 0.5) enters the vote; "b.md" is excluded.
    expect(s.type).toBe("Buch");
    expect(s.source).toBe("rag");
  });
});

describe("templateFilesUnder", () => {
  const paths = ["A/x.md", "A/sub/deep/y.md", "AB/z.md", "B/q.md"];

  it('dir "A" liefert Pfade unter A/ (rekursiv) und schließt AB/ aus (sibling-safety)', () => {
    expect(templateFilesUnder(paths, "A")).toEqual(["A/x.md", "A/sub/deep/y.md"]);
  });

  it('dir "A/" (mit trailing slash) liefert dasselbe Ergebnis wie "A"', () => {
    expect(templateFilesUnder(paths, "A/")).toEqual(["A/x.md", "A/sub/deep/y.md"]);
  });

  it('leeres dir "" liefert []', () => {
    expect(templateFilesUnder(paths, "")).toEqual([]);
  });

  it('dir mit nur Whitespace wird wie "" behandelt und liefert []', () => {
    expect(templateFilesUnder(paths, "   ")).toEqual([]);
  });

  it("schließt Folder Notes aus (Name === Elternordner), behält echte Vorlagen", () => {
    const p = [
      "Templates/Besprechung.md",            // echte Vorlage (Parent = Templates)
      "Templates/Projekt/Projekt.md",        // Folder Note → raus
      "Templates/Meetings/Standup.md",       // echte Vorlage
      "Templates/Meetings/Meetings.md",      // Folder Note → raus
    ];
    expect(templateFilesUnder(p, "Templates")).toEqual([
      "Templates/Besprechung.md",
      "Templates/Meetings/Standup.md",
    ]);
  });
});

describe("isFolderNote", () => {
  it("erkennt Folder Note (Basename === unmittelbarer Elternordner)", () => {
    expect(isFolderNote("Templates/Projekt/Projekt.md")).toBe(true);
    expect(isFolderNote("A/B/B.md")).toBe(true);
  });

  it("echte Vorlage in einem Ordner ist keine Folder Note", () => {
    expect(isFolderNote("Templates/Besprechung.md")).toBe(false);
    expect(isFolderNote("Templates/Meetings/Standup.md")).toBe(false);
  });

  it("Top-Level-Datei ohne Elternordner ist keine Folder Note", () => {
    expect(isFolderNote("Projekt.md")).toBe(false);
  });

  it("nur der unmittelbare Ordner zählt (nicht ein gleichnamiger Großelternordner)", () => {
    expect(isFolderNote("Projekt/sub/Projekt.md")).toBe(false);
  });

  it("erkennt case-insensitiv (wie Obsidian auf macOS/Windows)", () => {
    expect(isFolderNote("Projekt/projekt.md")).toBe(true);
    expect(isFolderNote("A/B/b.md")).toBe(true);
  });
});

describe("parseTemplate %%-guidance", () => {
  it("extrahiert %%-Annotation als guidance und hält placeholder sauber", () => {
    const tpl = parseTemplate("## Tagesordnung\n%% Stichpunkte zur Agenda hierher %%\n- Beispiel\n");
    const sec = tpl.sections[0];
    expect(sec.heading).toBe("Tagesordnung");
    expect(sec.guidance).toBe("Stichpunkte zur Agenda hierher");
    expect(sec.placeholder).not.toContain("%%");
    expect(sec.placeholder).toContain("- Beispiel");
  });

  it("Section ohne %% → guidance leer", () => {
    const tpl = parseTemplate("## Notizen\n- frei\n");
    expect(tpl.sections[0].guidance).toBe("");
  });

  it("mehrere %%-Blöcke einer Section werden zusammengefügt", () => {
    const tpl = parseTemplate("## A\n%% eins %%\nText\n%% zwei %%\n");
    expect(tpl.sections[0].guidance).toBe("eins zwei");
  });

  it("unbalanciertes %% crasht nicht und liefert guidance leer", () => {
    const tpl = parseTemplate("## X\n%% offen ohne Ende\n- y\n");
    expect(tpl.sections[0].guidance).toBe("");
    expect(tpl.sections[0].heading).toBe("X");
  });
});
