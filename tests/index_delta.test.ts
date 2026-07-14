import { describe, it, expect } from "vitest";
import { indexDeltaReadout, computeIndexDelta, classifyChunkless, healResultMessage } from "../src/index_delta";

describe("indexDeltaReadout", () => {
  it("zeigt embedded/total mit de-DE-Tausendertrennung", () => {
    expect(indexDeltaReadout(980, 1000)).toBe("980 / 1.000 Notizen");
  });
  it("markiert Vollständigkeit bei embedded === total", () => {
    expect(indexDeltaReadout(1000, 1000)).toBe("1.000 / 1.000 Notizen (vollständig)");
  });
  it("behandelt total = 0", () => {
    expect(indexDeltaReadout(0, 0)).toBe("0 / 0 Notizen (vollständig)");
  });
  it("hängt bei emptyCount > 0 einen Leere-Notizen-Hinweis an", () => {
    expect(indexDeltaReadout(4571, 4572, 178)).toBe("4.571 / 4.572 Notizen · 178 leere Notizen ignoriert");
    expect(indexDeltaReadout(4572, 4572, 178)).toBe("4.572 / 4.572 Notizen (vollständig) · 178 leere Notizen ignoriert");
  });
  it("emptyCount 0 ändert nichts", () => {
    expect(indexDeltaReadout(10, 10, 0)).toBe("10 / 10 Notizen (vollständig)");
  });
});

describe("computeIndexDelta", () => {
  it("zieht leere missing-Notizen vom Soll ab", () => {
    const missing = ["leer1.md", "leer2.md", "voll.md"];
    const empty = new Set(["leer1.md", "leer2.md"]);
    expect(computeIndexDelta(100, missing, empty)).toEqual({ embedded: 97, total: 98, emptyCount: 2 });
  });
  it("ohne leere Notizen bleibt das Delta unverändert", () => {
    expect(computeIndexDelta(100, ["a.md"], new Set())).toEqual({ embedded: 99, total: 100, emptyCount: 0 });
  });
  it("leere Pfade außerhalb von missing zählen nicht (Schnittmenge)", () => {
    const empty = new Set(["indexiert-inzwischen.md"]);
    expect(computeIndexDelta(50, [], empty)).toEqual({ embedded: 50, total: 50, emptyCount: 0 });
  });
  it("alles fehlend und alles leer → vollständig", () => {
    const missing = ["a.md", "b.md"];
    expect(computeIndexDelta(2, missing, new Set(missing))).toEqual({ embedded: 0, total: 0, emptyCount: 2 });
  });
});

describe("classifyChunkless", () => {
  it("erkennt Notizen ohne embeddbaren Inhalt (leer / nur Frontmatter)", async () => {
    const files: Record<string, string> = {
      "leer.md": "---\ntitle: x\n---\n   ",
      "ganz-leer.md": "",
      "voll.md": "# Überschrift\nInhalt",
    };
    const r = await classifyChunkless(Object.keys(files), async (p) => files[p]);
    expect(r).toEqual(["leer.md", "ganz-leer.md"]);
  });
  it("unlesbare Dateien gelten nicht als leer", async () => {
    const r = await classifyChunkless(["weg.md"], async () => { throw new Error("weg"); });
    expect(r).toEqual([]);
  });
});

describe("healResultMessage", () => {
  it("nur ergänzt → schlichte Erfolgsmeldung", () => {
    expect(healResultMessage(5, 0, 0)).toBe("Index vervollständigt: 5 Notizen ergänzt.");
    expect(healResultMessage(1, 0, 0)).toBe("Index vervollständigt: 1 Notiz ergänzt.");
  });
  it("leere übersprungen werden ausgewiesen", () => {
    expect(healResultMessage(1, 178, 0)).toBe("Index vervollständigt: 1 Notiz ergänzt · 178 leere übersprungen.");
  });
  it("fehlgeschlagene werden ausgewiesen", () => {
    expect(healResultMessage(0, 178, 1)).toBe("Index vervollständigt: 0 Notizen ergänzt · 178 leere übersprungen · 1 fehlgeschlagen.");
  });
  it("nichts ergänzt, nur leere → Index ist faktisch vollständig", () => {
    expect(healResultMessage(0, 178, 0)).toBe("Index vollständig — 178 leere Notizen übersprungen (kein Inhalt).");
  });
});
