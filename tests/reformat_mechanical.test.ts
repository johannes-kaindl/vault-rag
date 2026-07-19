import { describe, it, expect } from "vitest";
import { transposeTable, tableToList, wrapInCallout } from "../src/reformat_mechanical";

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

describe("wrapInCallout", () => {
  it("packt mehrzeiligen Text in einen Callout", () => {
    expect(wrapInCallout("Hallo\nWelt", "note")).toBe("> [!note]\n> Hallo\n> Welt");
  });
  it("nutzt den übergebenen Typ", () => {
    expect(wrapInCallout("X", "warning")).toBe("> [!warning]\n> X");
  });
});
