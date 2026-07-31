import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  mergeFrontmatter,
  diffFrontmatter,
} from "../src/frontmatter";
import type { ParsedFrontmatter, FmAssignedValue, FmRow } from "../src/frontmatter";

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
    const merged = mergeFrontmatter(tplKeys, {}, original, llm);
    expect(merged.order).toEqual(["type", "up", "tags", "created"]);
    expect(merged.data.type).toBe("💻 Coding");   // bestehend gewinnt
    expect(merged.data.up).toBe("[[Parent]]");
    expect(merged.data.tags).toBe("");
    expect(merged.data.created).toBe("2026-01-01"); // preserve-unknown
  });
  it("Template-Default füllt auf wenn kein bestehender + kein gültiger LLM-Wert (type=Besprechung)", () => {
    const tplKeys = ["type", "status"];
    const tplDefaults = { type: "Besprechung", status: "offen" };
    const original: ParsedFrontmatter = { data: {}, order: [], body: "" };
    const llm: Record<string, FmAssignedValue> = {
      type: { source: "empty", value: "" },
      status: { source: "empty", value: "" },
    };
    const merged = mergeFrontmatter(tplKeys, tplDefaults, original, llm);
    expect(merged.data["type"]).toBe("Besprechung");
    expect(merged.data["status"]).toBe("offen");
  });
  it("gültiger LLM-content-Wert schlägt Template-Default", () => {
    const tplKeys = ["status"];
    const tplDefaults = { status: "offen" };
    const original: ParsedFrontmatter = { data: {}, order: [], body: "" };
    const llm: Record<string, FmAssignedValue> = {
      status: { source: "content", value: "geschlossen" },
    };
    const merged = mergeFrontmatter(tplKeys, tplDefaults, original, llm);
    expect(merged.data["status"]).toBe("geschlossen");
  });
  it("bestehender Notizverweis schlägt Template-Default und LLM-Wert", () => {
    const tplKeys = ["type"];
    const tplDefaults = { type: "Besprechung" };
    const original: ParsedFrontmatter = { data: { type: "Retrospektive" }, order: ["type"], body: "" };
    const llm: Record<string, FmAssignedValue> = {
      type: { source: "content", value: "Planung" },
    };
    const merged = mergeFrontmatter(tplKeys, tplDefaults, original, llm);
    expect(merged.data["type"]).toBe("Retrospektive");
  });
  it("preserve-unknown-keys bleibt erhalten (kein Template-Key am Tail)", () => {
    const tplKeys = ["type"];
    const tplDefaults = { type: "Besprechung" };
    const original: ParsedFrontmatter = { data: { type: "", erstelltAm: "2026-01-01" }, order: ["type", "erstelltAm"], body: "" };
    const llm: Record<string, FmAssignedValue> = {};
    const merged = mergeFrontmatter(tplKeys, tplDefaults, original, llm);
    expect(merged.data["erstelltAm"]).toBe("2026-01-01");
    expect(merged.order).toContain("erstelltAm");
  });
});

describe("mergeFrontmatter inferred + audit", () => {
  const orig = parseFrontmatter(`---\n---\nBody`);
  const keys = ["bereich", "status"];
  const defaults = { bereich: "", status: "Entwurf" };
  const llm: Record<string, FmAssignedValue> = { bereich: { source: "inferred", value: "System", confidence: "mittel" } };
  it("ohne Auswahl bleibt inferred draußen (Default)", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm);
    expect(m.data.bereich).toBe(""); // fällt auf leer/Default
  });
  it("mit Auswahl wird inferred eingesetzt", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm, { acceptInferred: new Set(["bereich"]) });
    expect(m.data.bereich).toBe("System");
  });
  it("auditTrail setzt smartapply_erschlossen-Liste", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm, { acceptInferred: new Set(["bereich"]), auditTrail: true });
    expect(m.data.smartapply_erschlossen).toEqual(["bereich"]);
    expect(m.order).toContain("smartapply_erschlossen");
  });
  it("auditTrail ohne akzeptierte inferred setzt KEIN Feld", () => {
    const m = mergeFrontmatter(keys, defaults, orig, llm, { acceptInferred: new Set(), auditTrail: true });
    expect(m.data).not.toHaveProperty("smartapply_erschlossen");
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

describe("parseFrontmatter opt-in #-Kommentar-Flag (Datenverlust-Regression)", () => {
  it("Round-trip: unquoted #-Wert übersteht parse→merge→serialize ohne Flag", () => {
    const original = parseFrontmatter("---\nnote: some text # detail\n---\n");
    const merged = mergeFrontmatter([], {}, original, {});
    const out = serializeFrontmatter(merged.data, merged.order);
    expect(out).toContain("some text # detail");
  });
});

describe("Notiz ohne Frontmatter → sauber erzeugen", () => {
  it("erzeugt einen wohlgeformten Block mit genau einer Leerzeile vor dem Body", () => {
    const original = parseFrontmatter("Roher Body ohne Frontmatter.\n");
    const merged = mergeFrontmatter(["type"], {}, original, { type: { source: "content", value: "📓 Note" } });
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
