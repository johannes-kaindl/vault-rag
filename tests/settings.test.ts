import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, VaultRagSettings, migrateEndpointList, applyEndpointEdit } from "../src/settings";

describe("settings", () => {
  it("hat sinnvolle Defaults", () => {
    expect(DEFAULT_SETTINGS.k).toBe(20);
    expect(DEFAULT_SETTINGS.minSim).toBeCloseTo(0.3);
    expect(DEFAULT_SETTINGS.indexDir).toBe("_vaultrag");
    expect(DEFAULT_SETTINGS.exclude).toContain("Templates/");
  });

  it("hat embeddingEndpoints-Default (Liste)", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual(["http://localhost:11434"]);
  });

  it("hat embeddingModel-Default", () => {
    expect(DEFAULT_SETTINGS.embeddingModel).toBe("qwen3-embedding:8b");
  });

  it("showStatusBar-Default ist false", () => {
    expect(DEFAULT_SETTINGS.showStatusBar).toBe(false);
  });

  it("debounceMs-Default ist 3000", () => {
    expect(DEFAULT_SETTINGS.debounceMs).toBe(3000);
  });

  it("hat Chat-Defaults", () => {
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual(["http://localhost:1234"]);
    expect(DEFAULT_SETTINGS.chatModel).toBe("qwen3");
    expect(DEFAULT_SETTINGS.chatK).toBe(5);
    expect(DEFAULT_SETTINGS.contextCharBudget).toBe(12000);
  });

  it("hat Chat-Modell-UX-Defaults", () => {
    expect(DEFAULT_SETTINGS.chatTemperature).toBe(0.7);
    expect(DEFAULT_SETTINGS.chatInputPosition).toBe("bottom");
    expect(DEFAULT_SETTINGS.chatSystemPrompt).toContain("gegroundet");
  });

  it("hat UX-Politur-Defaults", () => {
    expect(DEFAULT_SETTINGS.suppressThinking).toBe(false);
    expect(DEFAULT_SETTINGS.enterSends).toBe(true);
  });

  it("hat Smart-Apply-Defaults", () => {
    expect(DEFAULT_SETTINGS.smartApplyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.templateDir).toBe("Templates/");
    expect(DEFAULT_SETTINGS.smartApplyTemperature).toBe(0);
  });

  it("Default-Merge ergänzt fehlende Smart-Apply-Felder aus altem data.json (Backward-Compat)", () => {
    // altes data.json — vor Smart Apply geschrieben, kennt die drei Felder nicht
    const loaded: Partial<VaultRagSettings> = {
      k: 30,
      chatModel: "mein-altes-modell",
      exclude: ["Archive/"],
    };
    const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // bestehende Werte aus data.json gewinnen
    expect(merged.k).toBe(30);
    expect(merged.chatModel).toBe("mein-altes-modell");
    expect(merged.exclude).toEqual(["Archive/"]);
    // die drei neuen Felder fehlen im alten data.json → fallen auf die Defaults zurück
    expect(merged.smartApplyEnabled).toBe(false);
    expect(merged.templateDir).toBe("Templates/");
    expect(merged.smartApplyTemperature).toBe(0);
  });

  it("hat Smart-Apply-Dashboard-Defaults", () => {
    expect(DEFAULT_SETTINGS.smartApplyModel).toBe("");
    expect(DEFAULT_SETTINGS.smartApplySuppressThinking).toBe(false);
    expect(DEFAULT_SETTINGS.smartApplyMaxTokens).toBe(4096);
  });

  it("Default-Merge ergänzt fehlende Dashboard-Felder (Backward-Compat)", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, { smartApplyEnabled: true } as Partial<VaultRagSettings>);
    expect(merged.smartApplyModel).toBe("");
    expect(merged.smartApplySuppressThinking).toBe(false);
    expect(merged.smartApplyMaxTokens).toBe(4096);
  });

  it("hideIndexFolder-Default ist true", () => {
    expect(DEFAULT_SETTINGS.hideIndexFolder).toBe(true);
  });

  it("Default-Merge ergänzt fehlendes hideIndexFolder aus altem data.json (Backward-Compat)", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, { k: 30 } as Partial<VaultRagSettings>);
    expect(merged.hideIndexFolder).toBe(true);
  });
});

describe("migrateEndpointList", () => {
  it("migriert ein altes Einzel-Setting auf eine 1-Element-Liste", () => {
    expect(migrateEndpointList("http://x", undefined)).toEqual(["http://x"]);
  });

  it("trimmt den migrierten Einzel-Endpunkt", () => {
    expect(migrateEndpointList("  http://x  ", undefined)).toEqual(["http://x"]);
  });

  it("lässt eine vorhandene Liste unverändert (gewinnt über das Einzelfeld)", () => {
    expect(migrateEndpointList("http://alt", ["http://a", "http://b"])).toEqual(["http://a", "http://b"]);
  });

  it("filtert leere Einträge aus einer vorhandenen Liste", () => {
    expect(migrateEndpointList(undefined, ["http://a", "", "  "])).toEqual(["http://a"]);
  });

  it("gibt [] bei fehlenden/leeren Eingaben zurück (Aufrufer fällt auf Default)", () => {
    expect(migrateEndpointList(undefined, undefined)).toEqual([]);
    expect(migrateEndpointList("   ", [])).toEqual([]);
  });
});

describe("applyEndpointEdit", () => {
  it("hängt einen nicht-leeren Adder-Wert an", () => {
    expect(applyEndpointEdit(["http://a"], 1, "http://b", true)).toEqual(["http://a", "http://b"]);
  });

  it("ignoriert einen leeren Adder-Wert", () => {
    expect(applyEndpointEdit(["http://a"], 1, "   ", true)).toEqual(["http://a"]);
  });

  it("setzt einen vorhandenen Index auf einen neuen Wert (Edit)", () => {
    expect(applyEndpointEdit(["http://a", "http://b"], 0, "http://c", false)).toEqual(["http://c", "http://b"]);
  });

  it("entfernt den Eintrag, wenn ein Nicht-Adder-Feld geleert wird", () => {
    expect(applyEndpointEdit(["http://a", "http://b"], 0, "", false)).toEqual(["http://b"]);
  });

  it("trimmt und filtert leere Einträge im Ergebnis", () => {
    expect(applyEndpointEdit(["  http://a  ", "http://b"], 1, "  http://c  ", false)).toEqual(["http://a", "http://c"]);
  });
});

describe("DEFAULT_SETTINGS Endpunkte", () => {
  it("Chat-Default ist LM Studio :1234", () => {
    expect(DEFAULT_SETTINGS.chatEndpoints).toEqual(["http://localhost:1234"]);
  });
  it("Embedding-Default bleibt Ollama :11434", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoints).toEqual(["http://localhost:11434"]);
  });
});
