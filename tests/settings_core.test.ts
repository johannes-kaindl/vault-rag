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
