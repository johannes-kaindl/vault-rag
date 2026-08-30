import { describe, it, expect } from "vitest";
import { buildTransformMessages, transformPromptTemplate, REFORMAT_MAX_TOKENS } from "../src/reformat_prompts";

describe("buildTransformMessages", () => {
  it("liefert genau [system, user] mit dem Text als User-Content", () => {
    const msgs = buildTransformMessages("to-list", "Ein Text");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1]).toEqual({ role: "user", content: "Ein Text" });
  });
  it("System-Prompt enthält die Anti-Fabrication-Anweisung", () => {
    const sys = buildTransformMessages("to-prose", "x")[0].content;
    expect(sys).toMatch(/keine.*(Fakten|Inhalte)/i);
    expect(sys).toMatch(/AUSSCHLIESSLICH/);
  });
  it("Mermaid-Format fordert einen ```mermaid-Codeblock", () => {
    const sys = buildTransformMessages("to-mermaid", "x")[0].content;
    expect(sys).toContain("```mermaid");
  });
  it("Freitext hängt die Nutzer-Anweisung an", () => {
    const sys = buildTransformMessages("freetext", "x", "mach eine Vergleichstabelle")[0].content;
    expect(sys).toContain("mach eine Vergleichstabelle");
  });
  it("exportiert einen Token-Deckel", () => {
    expect(REFORMAT_MAX_TOKENS).toBe(4096);
  });
});

describe("transformPromptTemplate", () => {
  it("liefert fuer ein festes Format das komplette Rezept — es ist ueber Aufrufe stabil", () => {
    const t = transformPromptTemplate("to-list");
    expect(t).toContain("Markdown-Aufzählungsliste");
    expect(transformPromptTemplate("to-list")).toBe(t);
  });

  it("unterscheidet die Formate — sie sind verschiedene Prompt-Fassungen", () => {
    expect(transformPromptTemplate("to-list")).not.toBe(transformPromptTemplate("to-table"));
  });

  it("laesst bei freetext die Nutzer-Anweisung weg — sie ist der variable Anteil", () => {
    const t = transformPromptTemplate("freetext");
    expect(t).not.toContain("Befolge die Anweisung des Nutzers");
    expect(buildTransformMessages("freetext", "text", "MEINE ANWEISUNG")[0].content).toContain("MEINE ANWEISUNG");
    expect(t).not.toContain("MEINE ANWEISUNG");
  });
});
