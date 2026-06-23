import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, VaultRagSettings } from "../src/settings";

describe("settings", () => {
  it("hat sinnvolle Defaults", () => {
    expect(DEFAULT_SETTINGS.k).toBe(20);
    expect(DEFAULT_SETTINGS.minSim).toBeCloseTo(0.3);
    expect(DEFAULT_SETTINGS.indexDir).toBe("_vaultrag");
    expect(DEFAULT_SETTINGS.exclude).toContain("Templates/");
  });

  it("hat embeddingEndpoint-Default", () => {
    expect(DEFAULT_SETTINGS.embeddingEndpoint).toBe("http://localhost:11434");
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
    expect(DEFAULT_SETTINGS.chatEndpoint).toBe("http://localhost:8080");
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
    expect(DEFAULT_SETTINGS.smartApplyMaxTokens).toBe(2048);
  });

  it("Default-Merge ergänzt fehlende Dashboard-Felder (Backward-Compat)", () => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, { smartApplyEnabled: true } as Partial<VaultRagSettings>);
    expect(merged.smartApplyModel).toBe("");
    expect(merged.smartApplySuppressThinking).toBe(false);
    expect(merged.smartApplyMaxTokens).toBe(2048);
  });
});
