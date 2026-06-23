import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  mergeFrontmatter,
  diffFrontmatter,
  assertParseable,
} from "../src/frontmatter";
import type { ParsedFrontmatter, FmAssignedValue, FmRow } from "../src/frontmatter";

describe("parseFrontmatter", () => {
  it("ohne Delimiter → leeres data/order, ganzer Text als body", () => {
    const text = "# Titel\n\nNur Body, kein Frontmatter.\n";
    const r = parseFrontmatter(text);
    expect(r.data).toEqual({});
    expect(r.order).toEqual([]);
    expect(r.body).toBe(text);
  });
});

describe("serializeFrontmatter Round-Trip", () => {
  it("Emoji-Wert, Wikilink und Liste überleben serialize→parse unverändert", () => {
    const data = { type: "💻 Coding", up: "[[X]]", tags: ["a", "b"] };
    const order = ["type", "up", "tags"];
    const out = serializeFrontmatter(data, order);
    const rt = parseFrontmatter(out + "Body\n");
    expect(rt.data).toEqual(data);
    expect(rt.order).toEqual(order);
    expect(rt.body).toBe("Body\n");
  });
});

describe("serializeFrontmatter Quoting-Edge-Cases", () => {
  it("Werte mit ':' '#' und führendem Emoji bleiben reparse-stabil", () => {
    const data = {
      title: "Plan: Phase 1",     // ":" → muss gequotet werden
      note: "C# und #tag",         // "#" → sonst YAML-Kommentar
      icon: "🔥 heiß",             // führendes Emoji
    };
    const order = ["title", "note", "icon"];
    const out = serializeFrontmatter(data, order);
    expect(out).toContain('title: "Plan: Phase 1"');
    expect(out).toContain('note: "C# und #tag"');
    expect(parseFrontmatter(out + "x").data).toEqual(data);
  });
});

describe("mergeFrontmatter", () => {
  it("bestehender nicht-leerer Wert gewinnt, unbekannter Key bleibt am Ende erhalten", () => {
    const tplKeys = ["type", "up", "tags"];
    const original: ParsedFrontmatter = {
      data: { type: "💻 Coding", created: "2026-01-01" },
      order: ["type", "created"],
      body: "",
    };
    const llm: Record<string, FmAssignedValue> = {
      type: { source: "content", value: "📓 Note" },   // verliert gegen bestehendes
      up: { source: "content", value: "[[Parent]]" },   // neu aus LLM
      tags: { source: "empty", value: "" },             // leer
    };
    const merged = mergeFrontmatter(tplKeys, original, llm);
    expect(merged.order).toEqual(["type", "up", "tags", "created"]);
    expect(merged.data.type).toBe("💻 Coding");   // bestehend gewinnt
    expect(merged.data.up).toBe("[[Parent]]");
    expect(merged.data.tags).toBe("");
    expect(merged.data.created).toBe("2026-01-01"); // preserve-unknown
  });
});

describe("diffFrontmatter", () => {
  it("klassifiziert unveraendert/geaendert/neu/entfernt", () => {
    const original: ParsedFrontmatter = {
      data: { type: "💻 Coding", old: "weg", tags: ["a"] },
      order: ["type", "old", "tags"],
      body: "",
    };
    const proposed = {
      data: { type: "📓 Note", tags: ["a"], up: "[[P]]" },
      order: ["type", "tags", "up"],
    };
    const rows = diffFrontmatter(original, proposed);
    const by = (k: string): FmRow => rows.find(r => r.key === k)!;
    expect(by("type").change).toBe("geaendert");
    expect(by("tags").change).toBe("unveraendert");
    expect(by("up").change).toBe("neu");
    expect(by("old").change).toBe("entfernt");
    expect(by("old").proposed).toBeUndefined();
    expect(by("up").original).toBeUndefined();
  });
});

describe("Round-Trip-Self-Check", () => {
  it("akzeptiert sauber serialisierbares Frontmatter", () => {
    const fm = { data: { title: "Plan: X", up: "[[Y]]" }, order: ["title", "up"] };
    expect(() => assertParseable(fm)).not.toThrow();
  });
  it("verweigert nicht reparse-stabiles Frontmatter (Korruption)", () => {
    // Wert mit eingebetteter Zeilenschaltung kann unser flacher Serializer nicht
    // reparse-stabil emittieren → Self-Check MUSS werfen statt korruptes YAML zu liefern.
    const fm = { data: { note: "Zeile1\nZeile2: kaputt" }, order: ["note"] };
    expect(() => assertParseable(fm)).toThrow();
  });
});

describe("parseInlineList – Kommas in gequoteten Listenelementen", () => {
  it("serialize→parse Round-Trip für Listenelement mit Komma bleibt stabil und wirft nicht", () => {
    const data = { tags: ["machine learning, ai", "obsidian"] };
    const order = ["tags"];
    const out = serializeFrontmatter(data, order);
    const rt = parseFrontmatter(out + "Body\n");
    expect(rt.data).toEqual(data);
    expect(rt.order).toEqual(order);
    const fm = { data, order };
    expect(() => assertParseable(fm)).not.toThrow();
  });
});

describe("Notiz ohne Frontmatter → sauber erzeugen", () => {
  it("erzeugt einen wohlgeformten Block mit genau einer Leerzeile vor dem Body", () => {
    const original = parseFrontmatter("Roher Body ohne Frontmatter.\n");
    const merged = mergeFrontmatter(["type"], original, { type: { source: "content", value: "📓 Note" } });
    const fmBlock = serializeFrontmatter(merged.data, merged.order);
    const full = fmBlock + "\n" + original.body;
    expect(full).toBe('---\ntype: "📓 Note"\n---\n\nRoher Body ohne Frontmatter.\n');
    // und es ist als Ganzes wieder parsebar:
    const rt = parseFrontmatter(full);
    expect(rt.data).toEqual({ type: "📓 Note" });
    // DELIM_RE konsumiert genau das schließende "---\n"; die Leerzeile bleibt im Body.
    expect(rt.body).toBe("\nRoher Body ohne Frontmatter.\n");
  });
});
