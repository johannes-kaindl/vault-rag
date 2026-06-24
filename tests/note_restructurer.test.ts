import { describe, it, expect } from "vitest";
import {
  splitBlocks,
  assembleBody,
  permutationCheck,
  buildRestructurePrompt,
  parseAssignment,
  reconcileAssignment,
  EMPTY_SECTION_SENTINEL,
  UEBRIG_HEADING,
  ANTI_FABRICATION,
  SourceBlock,
  Assignment,
} from "../src/note_restructurer";
import type { TemplateSpec, TemplateSection } from "../src/template_matcher";

function spec(headings: string[]): TemplateSpec {
  const sections: TemplateSection[] = headings.map((h, i) => ({
    heading: h,
    level: 2,
    placeholder: `ph${i}`,
    guidance: "",
  }));
  return {
    type: "Test",
    keys: ["type", "tags"],
    fmDefaults: {},
    sections,
    raw: "## " + headings.join("\n\n## "),
  };
}

function asg(partial: Partial<Assignment>): Assignment {
  return {
    version: 1,
    sections: [],
    unassigned: [],
    frontmatter: {},
    ...partial,
  };
}

describe("splitBlocks", () => {
  it("zerlegt Absätze und behandelt Überschriften als eigene Blöcke", () => {
    const body = "# Titel\n\nErster Absatz.\n\nZweiter Absatz.\n\n## Abschnitt\n\nDritter.";
    const blocks = splitBlocks(body);
    expect(blocks.map(b => b.id)).toEqual(["block_0", "block_1", "block_2", "block_3", "block_4"]);
    expect(blocks[0].text).toBe("# Titel");
    expect(blocks[1].text).toBe("Erster Absatz.");
    expect(blocks[3].text).toBe("## Abschnitt");
  });

  it("ist deterministisch (gleiche Eingabe → identische Ausgabe)", () => {
    const body = "A\n\nB\n\n## H\n\nC";
    expect(splitBlocks(body)).toEqual(splitBlocks(body));
  });

  it("erhält den Originaltext jedes Blocks byteweise (Round-Trip der Block-Texte)", () => {
    const body = "Absatz eins\nmit Umbruch.\n\n## Überschrift\n\nLetzter Absatz.";
    const blocks = splitBlocks(body);
    // Reconstruction: blocks joined by "\n\n" must reproduce the body exactly
    // (splitBlocks drops blank-only lines between blocks; blanks become the separator)
    const reconstructed = blocks.map(b => b.text).join("\n\n");
    expect(reconstructed).toBe(body);
  });

  it("erhält führende Leerzeichen (Regression: eingerückte Liste und Code-Block)", () => {
    // Indented list items and 4-space code blocks must survive verbatim
    const body = "Normal paragraph.\n\n  - indented list item\n  - second item\n\nAnother paragraph.";
    const blocks = splitBlocks(body);
    // The indented list block must be preserved with its original leading whitespace
    const listBlock = blocks.find(b => b.text.includes("- indented list item"));
    expect(listBlock).toBeDefined();
    expect(listBlock!.text).toBe("  - indented list item\n  - second item");
    // Full round-trip
    expect(blocks.map(b => b.text).join("\n\n")).toBe(body);
  });

  it("ignoriert reine Leerzeilen und liefert kein leeres Block", () => {
    const body = "Eins.\n\n\n\nZwei.";
    const blocks = splitBlocks(body);
    expect(blocks.map(b => b.text)).toEqual(["Eins.", "Zwei."]);
  });
});

describe("permutationCheck", () => {
  const all = ["block_0", "block_1", "block_2"];

  it("akzeptiert eine vollständige Permutation (sections ∪ unassigned == alle IDs)", () => {
    const a = asg({
      sections: [{ heading: "H", blocks: ["block_0", "block_2"] }],
      unassigned: ["block_1"],
    });
    const r = permutationCheck(all, a);
    expect(r.id).toBe("permutation");
    expect(r.ok).toBe(true);
  });

  it("lehnt eine doppelte Block-ID ab", () => {
    const a = asg({
      sections: [{ heading: "H", blocks: ["block_0", "block_0"] }],
      unassigned: ["block_1", "block_2"],
    });
    expect(permutationCheck(all, a).ok).toBe(false);
  });

  it("lehnt eine fehlende Block-ID ab (Drop NICHT in unassigned → still verloren)", () => {
    const a = asg({
      sections: [{ heading: "H", blocks: ["block_0"] }],
      unassigned: ["block_1"], // block_2 fehlt komplett
    });
    const r = permutationCheck(all, a);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("block_2");
  });

  it("verlangt weggelassene Blöcke in unassigned (vollständige Abdeckung)", () => {
    const a = asg({
      sections: [{ heading: "H", blocks: ["block_0"] }],
      unassigned: ["block_1", "block_2"],
    });
    expect(permutationCheck(all, a).ok).toBe(true);
  });

  it("lehnt eine unbekannte Block-ID ab", () => {
    const a = asg({
      sections: [{ heading: "H", blocks: ["block_0", "block_99"] }],
      unassigned: ["block_1", "block_2"],
    });
    const r = permutationCheck(all, a);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("block_99");
  });
});

describe("assembleBody", () => {
  it("baut den Body byte-für-byte aus den Original-Blöcken zusammen", () => {
    const blocks: SourceBlock[] = [
      { id: "block_0", text: "Inhalt für Setup." },
      { id: "block_1", text: "Inhalt für Ablauf." },
    ];
    const tpl = spec(["Setup", "Ablauf"]);
    const a = asg({
      sections: [
        { heading: "Setup", blocks: ["block_0"] },
        { heading: "Ablauf", blocks: ["block_1"] },
      ],
    });
    const body = assembleBody(tpl, a, blocks);
    expect(body).toContain("Inhalt für Setup.");
    expect(body).toContain("Inhalt für Ablauf.");
    expect(body).toContain("## Setup");
    expect(body).toContain("## Ablauf");
    // Reihenfolge folgt der Template-Reihenfolge, nicht der Assignment-Reihenfolge
    expect(body.indexOf("## Setup")).toBeLessThan(body.indexOf("## Ablauf"));
  });

  it("rendert einen gedämpften „(noch leer)\"-Sentinel für Template-only-Sektionen", () => {
    const blocks: SourceBlock[] = [{ id: "block_0", text: "Nur Setup." }];
    const tpl = spec(["Setup", "Ablauf"]);
    const a = asg({ sections: [{ heading: "Setup", blocks: ["block_0"] }] });
    const body = assembleBody(tpl, a, blocks);
    expect(body).toContain("## Ablauf");
    expect(body).toContain("(noch leer)");
  });

  it("verwendet ausschließlich Original-Block-Bytes (kein erfundener Text)", () => {
    const blocks: SourceBlock[] = [{ id: "block_0", text: "EXAKTER ORIGINALTEXT" }];
    const tpl = spec(["Setup"]);
    const a = asg({ sections: [{ heading: "Setup", blocks: ["block_0"] }] });
    const body = assembleBody(tpl, a, blocks);
    expect(body).toContain("EXAKTER ORIGINALTEXT");
  });

  it("wirft einen Fehler bei unbekannter Block-ID statt sie still zu verwerfen", () => {
    const blocks: SourceBlock[] = [{ id: "block_0", text: "Inhalt." }];
    const tpl = spec(["Setup"]);
    const a = asg({ sections: [{ heading: "Setup", blocks: ["block_0", "block_99"] }] });
    expect(() => assembleBody(tpl, a, blocks)).toThrow(/block_99/);
  });
  it("fügt ## Übrig-Sektion an wenn unassigned Blöcke vorhanden", () => {
    const blocks: SourceBlock[] = [
      { id: "block_0", text: "Inhalt für Setup." },
      { id: "block_1", text: "Abseits-Absatz." },
    ];
    const tpl = spec(["Setup"]);
    const a = asg({
      sections: [{ heading: "Setup", blocks: ["block_0"] }],
      unassigned: ["block_1"],
    });
    const body = assembleBody(tpl, a, blocks);
    expect(body).toContain("## Übrig");
    expect(body).toContain("Abseits-Absatz.");
    // Übrig comes after the last template section
    expect(body.indexOf("## Setup")).toBeLessThan(body.indexOf("## Übrig"));
  });
  it("keine ## Übrig-Sektion wenn keine unassigned Blöcke", () => {
    const blocks: SourceBlock[] = [{ id: "block_0", text: "Inhalt." }];
    const tpl = spec(["Setup"]);
    const a = asg({ sections: [{ heading: "Setup", blocks: ["block_0"] }] });
    const body = assembleBody(tpl, a, blocks);
    expect(body).not.toContain("## Übrig");
  });
});

describe("assembleBody Inhaltskonservierung (Property)", () => {
  function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  function tokens(s: string): string[] {
    return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  it("Tokens des zusammengebauten Inhalts (ohne Host-Tokens) sind Teilmenge der Original-Tokens", () => {
    const rnd = mulberry32(42);
    for (let run = 0; run < 50; run++) {
      // zufälligen Body bauen (nur Absätze, keine Überschriften → reine Inhalts-Tokens)
      const nPara = 1 + Math.floor(rnd() * 5);
      const paras: string[] = [];
      for (let p = 0; p < nPara; p++) {
        const nW = 1 + Math.floor(rnd() * 4);
        const w: string[] = [];
        for (let i = 0; i < nW; i++) w.push(words[Math.floor(rnd() * words.length)]);
        paras.push(w.join(" "));
      }
      const body = paras.join("\n\n");
      const blocks = splitBlocks(body);

      // gültige Assignment: jeden Block zufällig einer Sektion ODER unassigned zuordnen
      const headings = ["S1", "S2"];
      const tpl = spec(headings);
      const sections = headings.map(h => ({ heading: h, blocks: [] as string[] }));
      const unassigned: string[] = [];
      for (const b of blocks) {
        const slot = Math.floor(rnd() * (headings.length + 1));
        if (slot === headings.length) unassigned.push(b.id);
        else sections[slot].blocks.push(b.id);
      }
      const a = asg({ sections, unassigned });

      // Vorbedingung: gültige Permutation
      expect(permutationCheck(blocks.map(b => b.id), a).ok).toBe(true);

      const assembled = assembleBody(tpl, a, blocks);
      const original = new Set(tokens(body));
      // Host-injizierte Tokens (Überschriften + Sentinel-Wort + Übrig-Heading) ausnehmen
      const hostTokens = new Set([...tokens(headings.join(" ")), ...tokens(EMPTY_SECTION_SENTINEL), ...tokens(UEBRIG_HEADING)]);
      for (const t of tokens(assembled)) {
        if (hostTokens.has(t)) continue;
        expect(original.has(t)).toBe(true);
      }
    }
  });
});

describe("parseAssignment", () => {
  const valid = {
    version: 1,
    sections: [{ heading: "Setup", blocks: ["block_0"] }],
    unassigned: ["block_1"],
    frontmatter: { type: { source: "content", value: "Test" }, tags: { source: "empty", value: "" } },
  };

  it("parst nacktes JSON", () => {
    const a = parseAssignment(JSON.stringify(valid));
    expect(a).not.toBeNull();
    expect(a?.sections[0].heading).toBe("Setup");
    expect(a?.frontmatter.type.value).toBe("Test");
  });

  it("extrahiert JSON aus einem ```json-Fence mit Prosa drumherum", () => {
    const raw = "Hier ist die Zuordnung:\n```json\n" + JSON.stringify(valid) + "\n```\nFertig.";
    const a = parseAssignment(raw);
    expect(a?.unassigned).toEqual(["block_1"]);
  });

  it("extrahiert das erste balancierte JSON-Objekt aus reinem Geschwafel", () => {
    const raw = "blah " + JSON.stringify(valid) + " trailing tokens";
    expect(parseAssignment(raw)).not.toBeNull();
  });

  it("liefert null bei fehlendem/unparsebarem JSON", () => {
    expect(parseAssignment("kein json hier")).toBeNull();
    expect(parseAssignment("```json\n{ kaputt \n```")).toBeNull();
    expect(parseAssignment("")).toBeNull();
  });

  it("liefert null wenn die Struktur nicht zum Assignment-Schema passt", () => {
    expect(parseAssignment(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseAssignment(JSON.stringify({ version: 1, sections: "nein", unassigned: [], frontmatter: {} }))).toBeNull();
  });
});

describe("buildRestructurePrompt", () => {
  const tpl = spec(["Setup", "Ablauf"]);
  const blocks: SourceBlock[] = [
    { id: "block_0", text: "Erster." },
    { id: "block_1", text: "Zweiter." },
  ];

  it("liefert genau eine system- und eine user-Nachricht", () => {
    const msgs = buildRestructurePrompt(tpl, blocks);
    expect(msgs.map(m => m.role)).toEqual(["system", "user"]);
  });

  it("enthält die strukturierte Vorlagen-Struktur mit Überschriften als Liste", () => {
    const msgs = buildRestructurePrompt(tpl, blocks);
    const all = msgs.map(m => m.content).join("\n");
    expect(all).toContain("## Vorlagen-Struktur");
    expect(all).toContain("- Setup");
    expect(all).toContain("- Ablauf");
  });

  it("nummeriert die Blöcke mit ihren IDs und Texten", () => {
    const all = buildRestructurePrompt(tpl, blocks).map(m => m.content).join("\n");
    expect(all).toContain("block_0");
    expect(all).toContain("Erster.");
    expect(all).toContain("block_1");
    expect(all).toContain("Zweiter.");
  });

  it("wiederholt die Anti-Fabrikations-Klausel (nur Zuordnung, keine Prosa, nur JSON)", () => {
    const sys = buildRestructurePrompt(tpl, blocks)[0].content;
    const user = buildRestructurePrompt(tpl, blocks)[1].content;
    // in der system-Nachricht UND in der user-Nachricht: exakter ANTI_FABRICATION-String
    expect(sys).toContain(ANTI_FABRICATION);
    expect(user).toContain(ANTI_FABRICATION);
  });
});

describe("buildRestructurePrompt %%-guidance", () => {
  function tplWith(guidance: string): TemplateSpec {
    return {
      type: "Besprechung",
      keys: ["type", "status"],
      fmDefaults: { type: "Besprechung", status: "offen" },
      sections: [
        { heading: "Tagesordnung", level: 2, placeholder: "", guidance },
        { heading: "Notizen", level: 2, placeholder: "", guidance: "" },
      ],
      raw: "egal",
    };
  }
  const blocks: SourceBlock[] = [{ id: "block_0", text: "- Punkt A" }];

  it("rendert Anleitung pro Überschrift, Beispiel pro Key und die kein-Inhalt-Instruktion", () => {
    const [system, userMsg] = buildRestructurePrompt(tplWith("Stichpunkte zur Agenda hierher"), blocks);
    expect(userMsg.content).toContain("Tagesordnung — Anleitung: Stichpunkte zur Agenda hierher");
    expect(userMsg.content).toContain("- Notizen");
    expect(userMsg.content).not.toContain("Notizen — Anleitung:");
    expect(userMsg.content).toContain("status (Beispiel: offen)");
    expect(userMsg.content).toContain("Geordnete Überschriften: Tagesordnung, Notizen");
    expect(system.content).toContain("KEIN zuzuordnender Inhalt");
  });

  it("Vorlage ohne %% bleibt rückwärtskompatibel (Überschriften + Keys, keine Anleitung-Zeile)", () => {
    const [, userMsg] = buildRestructurePrompt(tplWith(""), blocks);
    expect(userMsg.content).not.toContain("Anleitung:");
    expect(userMsg.content).toContain("- Tagesordnung");
    expect(userMsg.content).toContain("## Original-Body in nummerierten Blöcken");
  });

  it("Guidance-Text landet nie im assembleBody-Output", () => {
    const tpl: TemplateSpec = {
      type: "X", keys: [], fmDefaults: {},
      sections: [{ heading: "A", level: 2, placeholder: "", guidance: "GEHEIM" }], raw: "egal",
    };
    const out = assembleBody(tpl, asg({ sections: [{ heading: "A", blocks: ["block_0"] }] }), [{ id: "block_0", text: "echter inhalt" }]);
    expect(out).not.toContain("GEHEIM");
    expect(out).toContain("echter inhalt");
  });
});

describe("reconcileAssignment", () => {
  it("bewegt Blöcke unter nicht-Template-Überschriften nach unassigned (dedup)", () => {
    const tpl = spec(["Setup", "Ablauf"]);
    const a = asg({
      sections: [
        { heading: "Setup", blocks: ["block_0"] },
        { heading: "Unbekannt", blocks: ["block_1", "block_2"] }, // not in template
      ],
      unassigned: [],
    });
    const r = reconcileAssignment(tpl, a);
    expect(r.sections.map(s => s.heading)).toEqual(["Setup"]);
    expect(r.unassigned).toContain("block_1");
    expect(r.unassigned).toContain("block_2");
  });

  it("dedupliziert: Blöcke schon in unassigned werden nicht doppelt hinzugefügt", () => {
    const tpl = spec(["Setup"]);
    const a = asg({
      sections: [
        { heading: "Fremd", blocks: ["block_0"] }, // not in template
      ],
      unassigned: ["block_0"], // already there
    });
    const r = reconcileAssignment(tpl, a);
    expect(r.unassigned.filter(id => id === "block_0")).toHaveLength(1);
  });

  it("lässt korrekt zugeordnete Sektionen unverändert", () => {
    const tpl = spec(["Setup", "Ablauf"]);
    const a = asg({
      sections: [
        { heading: "Setup", blocks: ["block_0"] },
        { heading: "Ablauf", blocks: ["block_1"] },
      ],
      unassigned: [],
    });
    const r = reconcileAssignment(tpl, a);
    expect(r.sections).toEqual(a.sections);
    expect(r.unassigned).toEqual([]);
  });

  it("version und frontmatter werden durchgereicht", () => {
    const tpl = spec(["Setup"]);
    const a = asg({ version: 2, frontmatter: { x: { source: "empty", value: "" } } });
    const r = reconcileAssignment(tpl, a);
    expect(r.version).toBe(2);
    expect(r.frontmatter).toEqual(a.frontmatter);
  });
});
