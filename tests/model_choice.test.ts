import { describe, it, expect } from "vitest";
import { resolveModelChoice } from "../src/model_choice";

describe("resolveModelChoice", () => {
  it("erreichbar mit Liste, gespeichertes Modell ist dabei → Dropdown", () => {
    const c = resolveModelChoice({
      reachable: true, models: ["a", "b"], current: "b", allowEmpty: false,
    });
    expect(c.mode).toBe("dropdown");
    expect(c.options.map(o => o.value)).toEqual(["a", "b"]);
    expect(c.value).toBe("b");
    expect(c.hint).toBe("");
  });

  it("gespeichertes Modell fehlt in der Liste → steht vorn und ist markiert", () => {
    const c = resolveModelChoice({
      reachable: true, models: ["a", "b"], current: "weg", allowEmpty: false,
    });
    expect(c.mode).toBe("dropdown");
    expect(c.options[0]).toEqual({ value: "weg", label: "weg (gespeichert)" });
    // Invariante: der gespeicherte Wert ist IMMER eine Option — sonst fällt das
    // <select> still auf die erste zurück und überschreibt ihn beim nächsten Speichern.
    expect(c.options.some(o => o.value === c.value)).toBe(true);
  });

  it("allowEmpty → Leer-Option zuerst, mit der übergebenen Beschriftung", () => {
    const c = resolveModelChoice({
      reachable: true, models: ["a"], current: "", allowEmpty: true,
      emptyLabel: "globales Modell",
    });
    expect(c.options[0]).toEqual({ value: "", label: "globales Modell" });
    expect(c.value).toBe("");
  });

  it("erreichbar, aber keine Liste → Freitext-Notausgang mit Hinweis", () => {
    const c = resolveModelChoice({
      reachable: true, models: [], current: "gpt-4o", allowEmpty: false,
    });
    expect(c.mode).toBe("freetext");
    expect(c.value).toBe("gpt-4o");
    expect(c.hint).toContain("keine Modell-Liste");
  });

  it("nicht erreichbar → gesperrt, Optionen enthalten genau den gespeicherten Wert", () => {
    const c = resolveModelChoice({
      reachable: false, models: [], current: "qwen3", allowEmpty: false,
    });
    expect(c.mode).toBe("locked");
    expect(c.options).toEqual([{ value: "qwen3", label: "qwen3" }]);
    expect(c.value).toBe("qwen3");
    expect(c.hint).toContain("nicht erreichbar");
  });

  it("nicht erreichbar, nichts gespeichert, allowEmpty → nur die Leer-Option", () => {
    const c = resolveModelChoice({
      reachable: false, models: [], current: "", allowEmpty: true,
      emptyLabel: "globales Modell",
    });
    expect(c.mode).toBe("locked");
    // Kein Dropdown ganz ohne Optionen — sonst zeigt die Zeile ein leeres Steuerelement.
    expect(c.options).toEqual([{ value: "", label: "globales Modell" }]);
  });

  it("nicht erreichbar, nichts gespeichert, ohne allowEmpty → gesperrt mit Platzhalter-Option", () => {
    const c = resolveModelChoice({
      reachable: false, models: [], current: "", allowEmpty: false,
    });
    expect(c.mode).toBe("locked");
    expect(c.options).toEqual([{ value: "", label: "—" }]);
    expect(c.value).toBe("");
  });

  it("gespeicherter Wert mit Leerzeichen gilt als in der Liste (Erbe des Freitextfelds)", () => {
    const c = resolveModelChoice({
      reachable: true, models: ["qwen3"], current: " qwen3 ", allowEmpty: false,
    });
    expect(c.value).toBe("qwen3");
    expect(c.options.map(o => o.value)).toEqual(["qwen3"]);
    expect(c.options.some(o => o.label.includes("gespeichert"))).toBe(false);
  });
});
