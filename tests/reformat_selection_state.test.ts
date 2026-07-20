import { describe, it, expect } from "vitest";
import {
  readinessMessage, canRun, selectionPreview, isRangeStale, groupTransforms,
} from "../src/reformat_selection_state";
import { TRANSFORMS } from "../src/reformat_transforms";

describe("readinessMessage", () => {
  it("nennt für jeden blockierten Zustand einen Klartext-Grund", () => {
    expect(readinessMessage({ kind: "reading-mode" }))
      .toBe("Formatierung im Lese-Modus nicht möglich — wechsle in den Bearbeiten-Modus.");
    expect(readinessMessage({ kind: "no-selection" })).toBe("Nichts markiert.");
    expect(readinessMessage({ kind: "no-editor" })).toBe("Keine Notiz im Bearbeiten-Modus geöffnet.");
  });
  it("ist bei ready leer (dort zeigt das Panel die Auswahl-Vorschau)", () => {
    expect(readinessMessage({ kind: "ready", text: "x" })).toBe("");
  });
});

describe("canRun", () => {
  it("ist nur bei ready true", () => {
    expect(canRun({ kind: "ready", text: "x" })).toBe(true);
    expect(canRun({ kind: "reading-mode" })).toBe(false);
    expect(canRun({ kind: "no-selection" })).toBe(false);
    expect(canRun({ kind: "no-editor" })).toBe(false);
  });
});

describe("selectionPreview", () => {
  it("nimmt die erste Zeile und zählt die Zeilen", () => {
    expect(selectionPreview("Zeile eins\nZeile zwei\nZeile drei"))
      .toEqual({ snippet: "Zeile eins", lines: 3 });
  });
  it("kürzt zu lange erste Zeilen mit Auslassungszeichen", () => {
    expect(selectionPreview("abcdefghij", 4)).toEqual({ snippet: "abcd…", lines: 1 });
  });
  it("kürzt nicht, wenn die Zeile genau maxLen lang ist", () => {
    expect(selectionPreview("abcd", 4)).toEqual({ snippet: "abcd", lines: 1 });
  });
  it("ignoriert umgebenden Whitespace bei Vorschau und Zeilenzahl", () => {
    expect(selectionPreview("\n\n  Text  \n\n")).toEqual({ snippet: "Text", lines: 1 });
  });
  it("liefert für leere/reine Whitespace-Auswahl einen leeren Zustand", () => {
    expect(selectionPreview("")).toEqual({ snippet: "", lines: 0 });
    expect(selectionPreview("   \n  ")).toEqual({ snippet: "", lines: 0 });
  });
});

describe("isRangeStale", () => {
  it("ist false, wenn an der Stelle noch derselbe Text steht", () => {
    expect(isRangeStale("| A |", "| A |")).toBe(false);
  });
  it("ist true, sobald der Text abweicht", () => {
    expect(isRangeStale("| B |", "| A |")).toBe(true);
    expect(isRangeStale("", "| A |")).toBe(true);
  });
});

describe("groupTransforms", () => {
  it("teilt die Registry nach kind und behält die Reihenfolge", () => {
    const g = groupTransforms(TRANSFORMS);
    expect(g.mechanical.map(t => t.id)).toEqual(["transpose", "table-to-list", "wrap-callout"]);
    expect(g.llm.map(t => t.id)).toEqual(["to-list", "to-prose", "to-table", "to-mermaid", "freetext"]);
  });
  it("lässt keinen Registry-Eintrag aus dem Panel fallen", () => {
    const g = groupTransforms(TRANSFORMS);
    expect(g.mechanical.length + g.llm.length).toBe(TRANSFORMS.length);
  });
  it("kommt mit einer leeren Liste klar", () => {
    expect(groupTransforms([])).toEqual({ mechanical: [], llm: [] });
  });
});
