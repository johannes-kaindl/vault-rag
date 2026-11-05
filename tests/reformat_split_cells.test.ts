// Differentialtest: die Zellteilung ohne Lookbehind (src/reformat_mechanical.ts) liefert auf einem Randfall-Korpus
// dasselbe wie die frühere Regex `split(/(?<!\\)\|/)`. Geprüft über die öffentliche Funktion transposeTable: eine
// Kopfzeile plus Ein-Zellen-Trennzeile wird zu "eine Zelle pro Zeile", das macht die Teilung sichtbar.
import { describe, it, expect } from "vitest";
import { transposeTable } from "../src/reformat_mechanical";
import { renderMarkdownTable } from "../src/vendor/kit/markdown-table";

/** Der alte Stand von splitCells, wörtlich (Referenz). */
function referenceSplitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
}

function referenceTranspose(line: string): string {
  const cells = referenceSplitCells(line);
  return renderMarkdownTable([cells[0]], cells.slice(1).map(c => [c]));
}

const CORPUS: string[] = [
  "| a | b | c |",
  "a | b",
  "| a |",
  "|| a",
  "a ||",
  "| | |",
  "|||",
  "a || b",
  "a ||| b",
  "| x \\| y | z |",
  "| \\| |",
  "| x \\\\| y |",
  "x \\\\\\| y | z",
  "a\\|b|c\\|d",
  "\\|a|b",
  "a|b\\|",
  "a|\\|b",
  "a|b|c|d|e|f",
  "| a\\| | b |",
  "| \\|\\| | b |",
  "a \\| b \\| c | d",
  "ä | ö \\| ü | ß",
  "|a|b|",
  "| a | b \\|",
  "| a | b \\\\|",
  "x\\ | y",
  "a | \\",
];

describe("splitCells ohne Lookbehind (Differential gegen die frühere Regex)", () => {
  for (const line of CORPUS) {
    it(`gleiche Zellen: ${JSON.stringify(line)}`, () => {
      const out = transposeTable(`${line}\n| --- |`);
      expect(out).toBe(referenceTranspose(line));
    });
  }
  it("Korpus ist nicht leer und enthält Treffer am Anfang, nach Backslash, mehrfach und am Ende", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(25);
    expect(referenceSplitCells("|| a")).toEqual(["", "a"]);
  });
});
