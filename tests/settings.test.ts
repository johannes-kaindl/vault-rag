import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";

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
});
