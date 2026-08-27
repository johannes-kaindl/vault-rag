import { describe, it, expect } from "vitest";
import { transposeTable, tableToList, splitSelectionAffix } from "../src/reformat_mechanical";
import { TRANSFORMS } from "../src/reformat_transforms";

describe("transposeTable", () => {
  it("kippt Header und Zeilen (erste Spalte wird Header-Zeile)", () => {
    const input = ["| Name | Alter |", "| --- | --- |", "| Anna | 30 |", "| Ben | 25 |"].join("\n");
    expect(transposeTable(input)).toBe(
      ["| Name | Anna | Ben |", "| --- | --- | --- |", "| Alter | 30 | 25 |"].join("\n"),
    );
  });
  it("entschärft escapte Pipes in Zellen und escaped sie beim Rendern wieder", () => {
    const input = ["| A | B |", "| --- | --- |", "| x \\| y | z |"].join("\n");
    // Zelle "x | y" bleibt EINE Zelle (escapte Pipe), z bleibt zweite — und das gerenderte
    // Pipe-Zeichen in der Zelle muss wieder escaped werden, sonst läse ein späteres Parsen
    // (z.B. ein zweites Transpose) die Zelle fälschlich als zwei Spalten.
    expect(transposeTable(input)).toBe(
      ["| A | x \\| y |", "| --- | --- |", "| B | z |"].join("\n"),
    );
  });
  it("überlebt einen Transpose-Rundtrip mit escapter Pipe (Regression)", () => {
    const input = ["| A | B |", "| --- | --- |", "| x \\| y | z |"].join("\n");
    expect(transposeTable(transposeTable(input)!)).toBe(input);
  });
  it("füllt ragged rows mit leeren Zellen auf", () => {
    const input = ["| A | B | C |", "| --- | --- | --- |", "| 1 | 2 |"].join("\n");
    expect(transposeTable(input)).toBe(
      ["| A | 1 |", "| --- | --- |", "| B | 2 |", "| C |  |"].join("\n"),
    );
  });
  it("gibt null bei Nicht-Tabelle zurück", () => {
    expect(transposeTable("nur ein Fließtext")).toBeNull();
    expect(transposeTable("| A | B |")).toBeNull(); // keine Delimiter-Zeile
  });
});

describe("tableToList", () => {
  it("macht aus jeder Zeile einen Listenpunkt mit Header:Wert-Paaren", () => {
    const input = ["| Name | Alter |", "| --- | --- |", "| Anna | 30 |", "| Ben | 25 |"].join("\n");
    expect(tableToList(input)).toBe(
      ["- **Name:** Anna · **Alter:** 30", "- **Name:** Ben · **Alter:** 25"].join("\n"),
    );
  });
  it("gibt null bei Nicht-Tabelle zurück", () => {
    expect(tableToList("kein Table")).toBeNull();
  });
});

// Der Callout-Bau liegt seit Kit 0.27.0 im Kit (`vendor/kit/callout`). Geprüft wird hier der
// Nutzerpfad, der ihn benutzt: der Registry-Eintrag hinter dem Befehl „In Callout einpacken".
describe("transform wrap-callout", () => {
  const run = (text: string) => {
    const entry = TRANSFORMS.find(t => t.id === "wrap-callout");
    if (entry?.kind !== "mechanical") throw new Error("wrap-callout fehlt in TRANSFORMS");
    return entry.run(text);
  };

  it("packt jede Zeile hinter das Callout-Präfix", () => {
    expect(run("Hallo\nWelt")).toBe("> [!note]\n> Hallo\n> Welt");
  });
  it("baut auch für eine einzelne Zeile einen gültigen Callout", () => {
    expect(run("X")).toBe("> [!note]\n> X");
  });
  it("eine leere Body-Zeile wird `>` ohne nachlaufendes Leerzeichen", () => {
    // Verhaltensänderung mit Kit 0.27.0: die lokale Fassung schrieb hier "> " (mit Space).
    // Obsidian rendert beides identisch — der Unterschied ist im Nutzer-Dokument nur mit
    // sichtbarem Whitespace zu sehen. Festgenagelt, damit es eine Entscheidung bleibt.
    expect(run("a\n\nb")).toBe("> [!note]\n> a\n>\n> b");
  });
});

describe("splitSelectionAffix", () => {
  const cases: Array<[string, string]> = [
    ["Trailing-Newline bleibt erhalten", "| A |\n| --- |\n| 1 |\n"],
    ["Regressionsfall: reiner Spalten-Einzug gehört zum Kern", "    - item a\n    - item b"],
    ["Führende Leerzeile bleibt erhalten", "\n\ntext"],
    ["Mix: führender Newline gefolgt von Einzug", "\n    text  "],
    ["Kein umgebender Whitespace", "text"],
  ];

  it("Trailing-Newline bleibt erhalten, Core ohne Trailing-Newline", () => {
    const { lead, core, trail } = splitSelectionAffix("| A |\n| --- |\n| 1 |\n");
    expect(trail).toBe("\n");
    expect(core.endsWith("\n")).toBe(false);
    expect(core).toBe("| A |\n| --- |\n| 1 |");
    expect(lead).toBe("");
  });

  it("Regressionsfall: reiner Spalten-Einzug ohne Newline bleibt Teil des Kerns", () => {
    const { lead, core, trail } = splitSelectionAffix("    - item a\n    - item b");
    expect(lead).toBe("");
    expect(core).toBe("    - item a\n    - item b");
    expect(trail).toBe("");
  });

  it("Führende Leerzeilen bleiben im Lead", () => {
    const { lead, core, trail } = splitSelectionAffix("\n\ntext");
    expect(lead).toBe("\n\n");
    expect(core).toBe("text");
    expect(trail).toBe("");
  });

  it("Mix: führender Newline im Lead, Einzug bleibt im Core, Trailing-Spaces im Trail", () => {
    const { lead, core, trail } = splitSelectionAffix("\n    text  ");
    expect(lead).toBe("\n");
    expect(core.startsWith("    ")).toBe(true);
    expect(core).toBe("    text");
    expect(trail).toBe("  ");
  });

  it("Kein umgebender Whitespace", () => {
    const { lead, core, trail } = splitSelectionAffix("text");
    expect(lead).toBe("");
    expect(core).toBe("text");
    expect(trail).toBe("");
  });

  it("Invariante lead + core + trail === text gilt für alle Fälle", () => {
    for (const [, text] of cases) {
      const { lead, core, trail } = splitSelectionAffix(text);
      expect(lead + core + trail).toBe(text);
    }
  });
});
