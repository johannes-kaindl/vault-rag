import { describe, it, expect } from "vitest";
import { TRANSFORMS, buildTransforms, transformLabel, type LlmTransform } from "../src/reformat_transforms";
import "../src/i18n/strings"; // Register i18n strings
import { t } from "../src/vendor/kit/i18n";

describe("TRANSFORMS-Registry", () => {
  it("enthält die erwarteten v1-Transform-IDs", () => {
    const ids = TRANSFORMS.map(t => t.id).sort();
    expect(ids).toEqual([
      "freetext", "remove-line-breaks", "table-to-list", "to-list", "to-mermaid", "to-prose", "to-table", "transpose", "wrap-callout",
    ].sort());
  });
  it("hat eindeutige IDs und nicht-leere Label-Keys", () => {
    const ids = TRANSFORMS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TRANSFORMS.every(t => t.labelKey.length > 0)).toBe(true);
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
  it("Absatz-Umbrüche entfernen läuft end-to-end über run() und steht in der mechanischen Gruppe", () => {
    const d = TRANSFORMS.find(x => x.id === "remove-line-breaks");
    expect(d?.kind).toBe("mechanical");
    expect(d?.kind === "mechanical" ? d.run("a\nb") : null).toBe("a b");
  });
  it("markiert genau den Freitext-Eintrag als freetext", () => {
    const ft = TRANSFORMS.filter(t => t.kind === "llm" && t.freetext);
    expect(ft.map(t => t.id)).toEqual(["freetext"]);
  });
});

describe("TRANSFORMS labelKey", () => {
  it("trägt Keys statt fertiger Labels (Sprache erst zur Zeichenzeit)", () => {
    for (const def of TRANSFORMS) {
      expect(def.labelKey, def.id).toMatch(/^transform\./);
    }
  });
  it("jeder labelKey löst zu einem englischen Label auf", () => {
    const byId = Object.fromEntries(TRANSFORMS.map(d => [d.id, t(d.labelKey)]));
    expect(byId["transpose"]).toBe("Transpose table");
    expect(byId["freetext"]).toBe("Custom instruction…");
  });
});

describe("buildTransforms — eigene Funktionen aus den Einstellungen", () => {
  const preset = { id: "a1", title: "Protokoll", prompt: "Schreibe als Protokoll mit Beschlüssen um." };

  it("ohne eigene Funktionen ist es genau die feste Registry", () => {
    expect(buildTransforms([]).map(d => d.id)).toEqual(TRANSFORMS.map(d => d.id));
    expect(buildTransforms().map(d => d.id)).toEqual(TRANSFORMS.map(d => d.id));
  });
  it("eine eigene Funktion steht nach den eingebauten und VOR der freien Anweisung (freetext bleibt die letzte)", () => {
    const ids = buildTransforms([preset]).map(d => d.id);
    expect(ids[ids.length - 1]).toBe("freetext");
    expect(ids[ids.length - 2]).toBe("preset:a1");
    expect(ids.length).toBe(TRANSFORMS.length + 1);
  });
  it("der Titel des Nutzers ist das Label; eingebaute behalten die Übersetzung", () => {
    const defs = buildTransforms([preset]);
    expect(transformLabel(defs.find(d => d.id === "preset:a1")!)).toBe("Protokoll");
    expect(transformLabel(defs.find(d => d.id === "to-list")!)).toBe(t("transform.toList"));
  });
  it("sie läuft wie freetext, nur mit der gespeicherten Anweisung, und trägt sie in den Prompt-Fassungs-Text für llm-lab", () => {
    const d = buildTransforms([preset]).find(x => x.id === "preset:a1") as LlmTransform;
    const msgs = d.buildMessages("Text");
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).toContain("Schreibe als Protokoll mit Beschlüssen um.");
    expect(msgs[1]).toEqual({ role: "user", content: "Text" });
    expect(d.promptTemplate()).toContain("Schreibe als Protokoll mit Beschlüssen um.");
    expect(d.freetext).toBeUndefined();            // keine Rückfrage nach einer Anweisung
    expect(d.custom).toBe(true);
  });
  it("halb ausgefüllte oder kaputte Zeilen werden nicht angeboten (Gegenprobe: die vollständige schon)", () => {
    const kaputt = [
      { id: "b", title: "  ", prompt: "x" },
      { id: "c", title: "T", prompt: "   " },
      { id: "d" } as never,
      null as never,
    ];
    expect(buildTransforms(kaputt).length).toBe(TRANSFORMS.length);
    expect(buildTransforms([...kaputt, preset]).length).toBe(TRANSFORMS.length + 1);
  });
  it("ändert die feste Registry nicht (keine gemeinsame Mutation)", () => {
    const vorher = TRANSFORMS.map(d => d.id).join(",");
    buildTransforms([preset]);
    expect(TRANSFORMS.map(d => d.id).join(",")).toBe(vorher);
  });
});
