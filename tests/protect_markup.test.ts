import { describe, it, expect } from "vitest";
import { maskProtected, extractLinks, countWikilinks, compareLinks, integrityProblem } from "../src/protect_markup";

describe("extractLinks / countWikilinks", () => {
  it("liest Wikilinks mit Ziel, Überschrift und Alias — der Alias zählt nicht zum Ziel", () => {
    expect(extractLinks("Siehe [[Notiz A]], [[B#Kapitel|Anzeige]] und [[C|x]].")).toEqual(["Notiz A", "B#Kapitel", "C"]);
  });
  it("Embeds sind eigene Einträge und werden nicht als Wikilink doppelt gelesen", () => {
    expect(extractLinks("![[bild.png]] und [[Ziel]]")).toEqual(["!bild.png", "Ziel"]);
  });
  it("Links in Inline-Code und Codeblöcken zählen nicht", () => {
    const text = "`[[im Code]]`\n```\n[[im Block]]\n```\n[[echt]]";
    expect(extractLinks(text)).toEqual(["echt"]);
    expect(countWikilinks(text)).toBe(1);
  });
  it("ohne Links: leere Liste", () => {
    expect(extractLinks("kein Link hier [ ] [x]")).toEqual([]);
  });
});

describe("maskProtected", () => {
  it("ersetzt Wikilinks, Embeds, Inline-Code und Codeblöcke durch Platzhalter ohne Markdown-Sonderzeichen", () => {
    const text = "Ein [[Link|Alias]] und ![[bild.png]] mit `code` und\n```ts\nconst a = [[1]];\n```\nEnde";
    const { masked } = maskProtected(text);
    expect(masked).not.toContain("[[");
    expect(masked).not.toContain("`");
    expect(masked).toContain("Ein ");
    expect(masked).toContain("Ende");
    expect(masked.match(/ZQX\d+QXZ/g)).toHaveLength(4);
    // Platzhalter tragen keine Zeichen, die Markdown deutet
    for (const p of masked.match(/ZQX\d+QXZ/g) ?? []) expect(p).toMatch(/^[A-Z0-9]+$/);
  });
  it("restore ist die Umkehrung: unveränderter Text kommt byte-identisch zurück", () => {
    const text = "a [[X]] b `c` d\n~~~\n[[Y]]\n~~~\n![[Z]] e [[W#h|l]]";
    const m = maskProtected(text);
    const r = m.restore(m.masked);
    expect(r.text).toBe(text);
    expect(r.lost).toBe(0);
  });
  it("restore setzt Platzhalter auch in umgestelltem Text wieder ein", () => {
    const m = maskProtected("Erst [[A]] dann [[B]]");
    const tokens = m.masked.match(/ZQX\d+QXZ/g) ?? [];
    const r = m.restore(`- ${tokens[1]}\n- ${tokens[0]}`);
    expect(r.text).toBe("- [[B]]\n- [[A]]");
    expect(r.lost).toBe(0);
  });
  it("meldet verlorene Platzhalter", () => {
    const m = maskProtected("Erst [[A]] dann [[B]] und `c`");
    const tokens = m.masked.match(/ZQX\d+QXZ/g) ?? [];
    const r = m.restore(`nur ${tokens[0]}`);
    expect(r.text).toBe("nur [[A]]");
    expect(r.lost).toBe(2);
  });
  it("ein offener Codeblock ohne Schluss-Zaun wird bis zum Ende geschützt", () => {
    const m = maskProtected("Text\n```\n[[X]]\nrest");
    expect(m.masked).not.toContain("[[");
    expect(m.restore(m.masked).text).toBe("Text\n```\n[[X]]\nrest");
  });
  it("Text ohne Geschütztes bleibt unverändert", () => {
    const m = maskProtected("ganz normaler Text");
    expect(m.masked).toBe("ganz normaler Text");
    expect(m.restore(m.masked).text).toBe("ganz normaler Text");
  });
  it("enthält der Text schon die Platzhalter-Form, wird nicht maskiert (kein Verwechseln)", () => {
    const text = "Kürzel ZQX1QXZ und [[Link]]";
    const m = maskProtected(text);
    expect(m.masked).toBe(text);
    expect(m.restore(m.masked).text).toBe(text);
  });
});

describe("compareLinks", () => {
  it("gleiche Links in anderer Reihenfolge und mit anderem Alias sind in Ordnung", () => {
    const c = compareLinks("[[A]] und [[B|x]]", "[[B|y]], [[A]]");
    expect(c).toEqual({ ok: true, missing: [], added: [] });
  });
  it("erkennt einen verlorenen Link", () => {
    const c = compareLinks("[[A]] [[B]]", "nur [[A]]");
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(["B"]);
  });
  it("erkennt einen erfundenen oder veränderten Link", () => {
    const c = compareLinks("[[Notiz]]", "[[Notizen]]");
    expect(c).toEqual({ ok: false, missing: ["Notiz"], added: ["Notizen"] });
  });
  it("zählt Mehrfachnennung: zwei Links werden zu einem", () => {
    const c = compareLinks("[[A]] [[A]]", "[[A]]");
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(["A"]);
  });
  it("ein zerstörter Wikilink (eine Klammer weg) zählt als verloren", () => {
    expect(compareLinks("[[A]]", "[A]").ok).toBe(false);
  });
});

describe("integrityProblem", () => {
  it("null, wenn Links stimmen und nichts Geschütztes fehlt", () => {
    expect(integrityProblem("[[A]] `x`", "[[A]] `x`", 0)).toBeNull();
  });
  it("liefert Zahlen statt Text: fehlende/neue Links und verlorene Platzhalter", () => {
    expect(integrityProblem("[[A]] [[B]]", "[[A]]", 1)).toEqual({ missing: 1, added: 0, lost: 1 });
  });
  it("verlorene Platzhalter allein sind schon ein Problem (Code verschwunden)", () => {
    expect(integrityProblem("`x`", "", 1)).toEqual({ missing: 0, added: 0, lost: 1 });
  });
});
