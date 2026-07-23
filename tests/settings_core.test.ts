import { describe, it, expect } from "vitest";
import { splitExcludePaths, normalizeTemplateDir } from "../src/settings_core";

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
