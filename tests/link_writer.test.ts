import { describe, it, expect } from "vitest";
import { wikilinkFor, linkTargetOf, containsLink, appendSectionLink } from "../src/link_writer";

describe("wikilinkFor", () => {
  it("bildet [[pfad|basename]] ohne .md", () => {
    expect(wikilinkFor("Notes/Foo bar.md")).toBe("[[Notes/Foo bar|Foo bar]]");
  });
  it("liefert null bei Zeichen, die Obsidian nicht klammern kann", () => {
    for (const p of ["a#b.md", "a|b.md", "a[b.md", "a]b.md", "a^b.md", ""]) expect(wikilinkFor(p)).toBeNull();
  });
  it("linkTargetOf streicht nur die Endung", () => {
    expect(linkTargetOf("Notes/Foo.md")).toBe("Notes/Foo");
    expect(linkTargetOf("Notes/Foo")).toBe("Notes/Foo");
  });
});

describe("containsLink", () => {
  it("erkennt voller Pfad, mit Alias, mit Überschrift, und den nackten Basename", () => {
    expect(containsLink("x [[Notes/Foo]] y", "Notes/Foo.md")).toBe(true);
    expect(containsLink("[[Notes/Foo|Alias]]", "Notes/Foo.md")).toBe(true);
    expect(containsLink("[[Notes/Foo#Abschnitt]]", "Notes/Foo.md")).toBe(true);
    expect(containsLink("[[Foo]]", "Notes/Foo.md")).toBe(true);
  });
  it("verwechselt Präfixe nicht", () => {
    expect(containsLink("[[Notes/Foobar]]", "Notes/Foo.md")).toBe(false);
    expect(containsLink("[[Foo bar]]", "Notes/Foo.md")).toBe(false);
  });
});

describe("appendSectionLink", () => {
  it("hängt Abschnitt mit Link an eine Notiz ohne Abschnitt an (eine Leerzeile, Endung \\n)", () => {
    const r = appendSectionLink("# A\n\nText", "Verwandte Notizen", "Notes/B.md");
    expect(r).toEqual({ ok: true, changed: true, content: "# A\n\nText\n\n## Verwandte Notizen\n- [[Notes/B|B]]\n" });
  });
  it("fügt unter vorhandener Überschrift als letzte Listenzeile ein", () => {
    const text = "# A\n\n## Verwandte Notizen\n- [[Notes/C|C]]\n\n## Sonst\nx\n";
    const r = appendSectionLink(text, "Verwandte Notizen", "Notes/B.md");
    expect(r.ok && r.content).toBe("# A\n\n## Verwandte Notizen\n- [[Notes/C|C]]\n- [[Notes/B|B]]\n\n## Sonst\nx\n");
  });
  it("ist idempotent: zweiter Aufruf ändert nichts", () => {
    const first = appendSectionLink("Text", "Verwandte Notizen", "Notes/B.md");
    const second = appendSectionLink(first.ok ? first.content : "", "Verwandte Notizen", "Notes/B.md");
    expect(second).toEqual({ ok: true, changed: false, content: first.ok ? first.content : "" });
  });
  it("erkennt den Link auch, wenn er woanders in der Notiz steht", () => {
    const r = appendSectionLink("Siehe [[Notes/B]].", "Verwandte Notizen", "Notes/B.md");
    expect(r).toEqual({ ok: true, changed: false, content: "Siehe [[Notes/B]]." });
  });
  it("erhält CRLF", () => {
    const r = appendSectionLink("A\r\nB", "Verwandte Notizen", "Notes/B.md");
    expect(r.ok && r.content).toBe("A\r\nB\r\n\r\n## Verwandte Notizen\r\n- [[Notes/B|B]]\r\n");
  });
  it("meldet unlinkable statt zu schreiben", () => {
    expect(appendSectionLink("A", "H", "a#b.md")).toEqual({ ok: false, reason: "unlinkable" });
  });
});
