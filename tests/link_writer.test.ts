import { describe, it, expect } from "vitest";
import { wikilinkFor, linkTargetOf, containsLink, appendSectionLink, appendFrontmatterLink } from "../src/link_writer";

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

const L = '"[[Notes/B|B]]"';
describe("appendFrontmatterLink", () => {
  it("Schlüssel fehlt → Blockliste als letzte Zeilen vor dem schließenden ---", () => {
    const r = appendFrontmatterLink("---\ntitle: A\n---\nBody\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\ntitle: A\nrelated:\n  - ${L}\n---\nBody\n`);
  });
  it("related: [] → Blockliste mit einem Eintrag", () => {
    const r = appendFrontmatterLink("---\nrelated: []\ntags: [x]\n---\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\nrelated:\n  - ${L}\ntags: [x]\n---\n`);
  });
  it("related: ohne Fortsetzung → Blockliste mit einem Eintrag", () => {
    const r = appendFrontmatterLink("---\nrelated:\ntags: [x]\n---\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\nrelated:\n  - ${L}\ntags: [x]\n---\n`);
  });
  it("Inline-Liste bleibt inline, Eintrag angehängt", () => {
    const r = appendFrontmatterLink("---\nrelated: ['[[a]]', '[[b]]']\n---\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe("---\nrelated: ['[[a]]', '[[b]]', '[[Notes/B|B]]']\n---\n");
  });
  it("Blockliste: gleiche Einrückung und Quote-Form wie die letzte nicht-leere Zeile", () => {
    const r = appendFrontmatterLink("---\nrelated:\n  - '[[a]]'\n  - \ntags: [x]\n---\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe("---\nrelated:\n  - '[[a]]'\n  - \n  - '[[Notes/B|B]]'\ntags: [x]\n---\n");
  });
  it("Blockliste auf Spalte 0 bleibt auf Spalte 0", () => {
    const r = appendFrontmatterLink("---\nrelated:\n- \"[[a]]\"\n---\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\nrelated:\n- "[[a]]"\n- ${L}\n---\n`);
  });
  it("Ziel schon enthalten (mit Alias) → unverändert", () => {
    const text = "---\nrelated:\n  - \"[[Notes/B|Bee]]\"\n---\n";
    expect(appendFrontmatterLink(text, "related", "Notes/B.md")).toEqual({ ok: true, content: text, changed: false });
  });
  it("Block-Skalar am Schlüssel → block-scalar", () => {
    expect(appendFrontmatterLink("---\nrelated: >-\n  bla\n---\n", "related", "Notes/B.md")).toEqual({ ok: false, reason: "block-scalar" });
  });
  it("Skalar am Schlüssel → not-a-list", () => {
    expect(appendFrontmatterLink("---\nrelated: foo\n---\n", "related", "Notes/B.md")).toEqual({ ok: false, reason: "not-a-list" });
  });
  it("kein Frontmatter → neuer Block vor dem Text", () => {
    const r = appendFrontmatterLink("Body\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\nrelated:\n  - ${L}\n---\nBody\n`);
  });
  it("--- ohne Abschluss → frontmatter-unparseable", () => {
    expect(appendFrontmatterLink("---\nrelated: []\nBody", "related", "Notes/B.md")).toEqual({ ok: false, reason: "frontmatter-unparseable" });
  });
  it("fremde Zeilen bleiben byteweise, auch ein Block-Skalar an ANDEREM Schlüssel", () => {
    const text = "---\ntitle: A\nfokus: >-\n  erste Zeile\n  zweite   Zeile\nrelated: []\nnested:\n  a: 1\n---\nBody\n";
    const r = appendFrontmatterLink(text, "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\ntitle: A\nfokus: >-\n  erste Zeile\n  zweite   Zeile\nrelated:\n  - ${L}\nnested:\n  a: 1\n---\nBody\n`);
  });
  it("erhält CRLF", () => {
    const r = appendFrontmatterLink("---\r\nrelated: []\r\n---\r\nB\r\n", "related", "Notes/B.md");
    expect(r.ok && r.content).toBe(`---\r\nrelated:\r\n  - ${L}\r\n---\r\nB\r\n`);
  });
  it("idempotent über beide Fälle (fehlend → vorhanden → unverändert)", () => {
    const a = appendFrontmatterLink("---\ntitle: A\n---\n", "related", "Notes/B.md");
    const b = appendFrontmatterLink(a.ok ? a.content : "", "related", "Notes/B.md");
    expect(b).toEqual({ ok: true, content: a.ok ? a.content : "", changed: false });
  });
});
