import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../src/chunker";

describe("chunkMarkdown", () => {
  it("gibt einen Chunk für kurzen Text zurück", () => {
    const chunks = chunkMarkdown("kurzer text");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("kurzer text");
  });

  it("strippt YAML-Frontmatter", () => {
    const text = "---\ntitle: Test\n---\nBody-Inhalt";
    const chunks = chunkMarkdown(text);
    expect(chunks[0].text).not.toContain("title:");
    expect(chunks[0].text).toContain("Body-Inhalt");
  });

  it("splittet an Heading-Grenzen", () => {
    const h = "# Heading\n";
    const body = "x".repeat(500) + "\n" + h + "y".repeat(500);
    const chunks = chunkMarkdown(body, 800, 150);
    const texts = chunks.map(c => c.text);
    expect(texts.some(t => t.startsWith("# Heading"))).toBe(true);
  });

  it("garantiert Terminierung bei vielen kurzen Headings", () => {
    let body = "";
    for (let i = 0; i < 200; i++) body += `# H${i}\ntext\n`;
    expect(() => chunkMarkdown(body, 800, 150)).not.toThrow();
    const chunks = chunkMarkdown(body, 800, 150);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("gibt leeres Array für leeren Text nach Frontmatter", () => {
    const chunks = chunkMarkdown("---\ntitle: x\n---\n   ");
    expect(chunks).toHaveLength(0);
  });

  it("erzeugt Overlap zwischen Chunks", () => {
    const body = "a".repeat(800) + "b".repeat(800);
    const chunks = chunkMarkdown(body, 800, 150);
    expect(chunks.length).toBeGreaterThan(1);
    // Letzter Char von Chunk N überlappt mit Anfang von Chunk N+1
    const c0end = chunks[0].endOffset;
    const c1start = chunks[1].startOffset;
    expect(c1start).toBeLessThan(c0end);
  });
});
