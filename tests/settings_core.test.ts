import { describe, it, expect } from "vitest";
import { splitExcludePaths, normalizeTemplateDir, DEFAULT_SETTINGS, migrateGlobalModels, stripLegacyGlobalModels } from "../src/settings_core";
import { mergeSettings } from "../src/vendor/kit/settings";

describe("DEFAULT_SETTINGS Endpunkte", () => {
  it("Default-Endpunkte tragen ihr Modell in der Zeile (E2: Erstinstallation wie vorher)", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual([{ url: "http://localhost:11434", model: "qwen3-embedding:8b" }]);
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual([{ url: "http://localhost:1234", model: "qwen3" }]);
  });
});

describe("migrateGlobalModels — Prä-0.31 globales Modellfeld in die Zeilen ziehen", () => {
  it("eine Zeile ohne Modell bekommt den alten globalen Wert", () => {
    expect(migrateGlobalModels([{ url: "u" }], "qwen3")).toEqual([{ url: "u", model: "qwen3" }]);
  });
  it("eine Zeile mit eigenem Modell bleibt unangetastet — auch wenn es leer-getrimmt anders wäre", () => {
    expect(migrateGlobalModels([{ url: "u", model: "gemma" }], "qwen3")).toEqual([{ url: "u", model: "gemma" }]);
  });
  it("Whitespace-Modell zählt als fehlend", () => {
    expect(migrateGlobalModels([{ url: "u", model: "  " }], "qwen3")).toEqual([{ url: "u", model: "qwen3" }]);
  });
  it("kein alter globaler Wert (neue data.json) → Liste unverändert, gleiche Objekte nicht nötig, aber gleicher Inhalt", () => {
    expect(migrateGlobalModels([{ url: "u" }], undefined)).toEqual([{ url: "u" }]);
    expect(migrateGlobalModels([{ url: "u" }], "")).toEqual([{ url: "u" }]);
  });
  it("mutiert die Eingabe nicht", () => {
    const eps = [{ url: "u" }];
    migrateGlobalModels(eps, "qwen3");
    expect(eps).toEqual([{ url: "u" }]);
  });
  it("gemischte Liste: nur die leeren Zeilen werden gefüllt", () => {
    expect(migrateGlobalModels([{ url: "a" }, { url: "b", model: "x" }, { url: "c", apiKey: "k" }], "g"))
      .toEqual([{ url: "a", model: "g" }, { url: "b", model: "x" }, { url: "c", apiKey: "k", model: "g" }]);
  });
});

describe("stripLegacyGlobalModels — Alt-Schlüssel raus, sonst liefe die Migration bei jedem Start erneut", () => {
  it("entfernt genau embeddingModel/chatModel, behält andere Felder", () => {
    const obj = { k: 20, embeddingModel: "alt-embed", chatModel: "alt-chat" };
    expect(stripLegacyGlobalModels(obj)).toEqual({ k: 20 });
  });

  it("ein Objekt ohne die Alt-Schlüssel bleibt unverändert", () => {
    const obj = { k: 20 };
    expect(stripLegacyGlobalModels(obj)).toEqual({ k: 20 });
  });

  it("Ende-zu-Ende: mergeSettings kopiert den Alt-Schlüssel, stripLegacyGlobalModels räumt ihn wieder weg", () => {
    const merged = stripLegacyGlobalModels(mergeSettings(DEFAULT_SETTINGS, { chatModel: "alt", k: 9 } as Partial<typeof DEFAULT_SETTINGS>));
    expect("chatModel" in merged).toBe(false);
    expect(merged.k).toBe(9);
  });
});

describe("splitExcludePaths", () => {
  it("splittet komma-getrennt, trimmt, filtert leere", () => {
    expect(splitExcludePaths("Templates/, Archive/ ,")).toEqual(["Templates/", "Archive/"]);
  });
  it("leere Eingabe → leere Liste", () => {
    expect(splitExcludePaths("   ")).toEqual([]);
  });
});

describe("normalizeTemplateDir", () => {
  it("ergänzt fehlenden Trailing-Slash", () => {
    expect(normalizeTemplateDir("Templates")).toBe("Templates/");
  });
  it("lässt vorhandenen Trailing-Slash unangetastet", () => {
    expect(normalizeTemplateDir("Templates/")).toBe("Templates/");
  });
  it("leere Eingabe bleibt leer (kein Slash)", () => {
    expect(normalizeTemplateDir("  ")).toBe("");
  });
});

describe("Smart-Apply-Defaults", () => {
  // Smart Apply fuellt ein JSON-Schema aus; eine Denkphase davor bringt nichts und teilt sich
  // mit der Antwort dasselbe `maxTokens`. Gemessen 2026-08-23: 14.083 Zeichen Reasoning,
  // Antwort leer, 105,9 s ohne Ergebnis. Der Toggle existierte, er stand nur falsch herum.
  it("Thinking ist fuer Smart Apply per Default unterdrueckt", () => {
    expect(DEFAULT_SETTINGS.smartApplySuppressThinking).toBe(true);
  });
});

describe("Integrator-Defaults (Spec §5)", () => {
  it("sind exakt die Werks-Defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      integratorEnabled: false, integratorFolders: [], linkTarget: "section",
      linkHeading: "Verwandte Notizen", linkField: "related", linkK: 5, linkMinSim: 0.5,
    });
  });
});
