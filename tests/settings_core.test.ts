import { describe, it, expect } from "vitest";
import { splitExcludePaths, normalizeTemplateDir, DEFAULT_SETTINGS } from "../src/settings_core";

describe("DEFAULT_SETTINGS Endpunkte", () => {
  it("Default-Endpunkte sind EndpointConfig-Objekte ohne Schlüssel", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual([{ url: "http://localhost:11434" }]);
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual([{ url: "http://localhost:1234" }]);
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
