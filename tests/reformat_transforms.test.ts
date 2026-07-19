import { describe, it, expect } from "vitest";
import { TRANSFORMS } from "../src/reformat_transforms";

describe("TRANSFORMS-Registry", () => {
  it("enthält die erwarteten v1-Transform-IDs", () => {
    const ids = TRANSFORMS.map(t => t.id).sort();
    expect(ids).toEqual([
      "freetext", "table-to-list", "to-list", "to-mermaid", "to-prose", "to-table", "transpose", "wrap-callout",
    ].sort());
  });
  it("hat eindeutige IDs und nicht-leere Labels", () => {
    const ids = TRANSFORMS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TRANSFORMS.every(t => t.label.length > 0)).toBe(true);
  });
  it("mechanische Transforms tragen run(), LLM-Transforms buildMessages()", () => {
    for (const t of TRANSFORMS) {
      if (t.kind === "mechanical") expect(typeof t.run).toBe("function");
      else expect(typeof t.buildMessages).toBe("function");
    }
  });
  it("der Transpose-Eintrag funktioniert end-to-end über run()", () => {
    const t = TRANSFORMS.find(x => x.id === "transpose");
    expect(t?.kind).toBe("mechanical");
    const out = t?.kind === "mechanical"
      ? t.run(["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"))
      : null;
    expect(out).toBe(["| A | 1 |", "| --- | --- |", "| B | 2 |"].join("\n"));
  });
  it("markiert genau den Freitext-Eintrag als freetext", () => {
    const ft = TRANSFORMS.filter(t => t.kind === "llm" && t.freetext);
    expect(ft.map(t => t.id)).toEqual(["freetext"]);
  });
});
