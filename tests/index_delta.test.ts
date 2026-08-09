import { describe, it, expect } from "vitest";
import "../src/i18n/strings"; // Register i18n strings
import { indexDeltaReadout, computeIndexDelta, classifyChunkless, healResultMessage, splitHealTargets } from "../src/index_delta";

describe("indexDeltaReadout", () => {
  // Locale ist über vitest.config.ts auf de-DE gepinnt; schlägt diese Prüfung fehl,
  // hat sich die Umgebung geändert, nicht der Code.
  it("nutzt de-DE-Tausendertrennung", () => {
    expect((1000).toLocaleString()).toBe("1.000");
  });
  it("zeigt embedded/total mit Tausendertrennung", () => {
    expect(indexDeltaReadout(980, 1000)).toBe("980 / 1.000 notes");
  });
  it("markiert Vollständigkeit bei embedded === total", () => {
    expect(indexDeltaReadout(1000, 1000)).toBe("1.000 / 1.000 notes (complete)");
  });
  it("behandelt total = 0", () => {
    expect(indexDeltaReadout(0, 0)).toBe("0 / 0 notes (complete)");
  });
  it("hängt bei emptyCount > 0 einen Leere-Notizen-Hinweis an", () => {
    expect(indexDeltaReadout(4571, 4572, 178)).toBe("4.571 / 4.572 notes · 178 empty notes ignored");
    expect(indexDeltaReadout(4572, 4572, 178)).toBe("4.572 / 4.572 notes (complete) · 178 empty notes ignored");
  });
  it("emptyCount 0 ändert nichts", () => {
    expect(indexDeltaReadout(10, 10, 0)).toBe("10 / 10 notes (complete)");
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

describe("splitHealTargets", () => {
  it("bekannte leere Pfade fliegen aus dem Heal-Lauf (Fortschritt zählt nur Embeddbares)", () => {
    const missing = ["leer1.md", "voll.md", "leer2.md"];
    const empty = new Set(["leer1.md", "leer2.md"]);
    expect(splitHealTargets(missing, empty)).toEqual({
      embeddable: ["voll.md"],
      knownEmpty: ["leer1.md", "leer2.md"],
    });
  });
  it("ohne bekannte leere bleibt alles embeddbar", () => {
    expect(splitHealTargets(["a.md"], new Set())).toEqual({ embeddable: ["a.md"], knownEmpty: [] });
  });
});

describe("healResultMessage", () => {
  it("nur ergänzt → schlichte Erfolgsmeldung", () => {
    expect(healResultMessage(5, 0, 0)).toBe("Index completed: 5 notes added.");
    expect(healResultMessage(1, 0, 0)).toBe("Index completed: 1 note added.");
  });
  it("leere übersprungen werden ausgewiesen", () => {
    expect(healResultMessage(1, 178, 0)).toBe("Index completed: 1 note added · 178 empty skipped.");
  });
  it("fehlgeschlagene werden ausgewiesen", () => {
    expect(healResultMessage(0, 178, 1)).toBe("Index completed: 0 notes added · 178 empty skipped · 1 failed.");
  });
  it("nichts ergänzt, nur leere → Index ist faktisch vollständig", () => {
    expect(healResultMessage(0, 178, 0)).toBe("Index complete — 178 empty notes skipped (no content).");
  });
});
