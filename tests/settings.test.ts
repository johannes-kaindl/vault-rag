import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
describe("settings", () => it("hat sinnvolle Defaults", () => {
  expect(DEFAULT_SETTINGS.k).toBe(20);
  expect(DEFAULT_SETTINGS.minSim).toBeCloseTo(0.3);
  expect(DEFAULT_SETTINGS.indexDir).toBe("_vaultrag");
  expect(DEFAULT_SETTINGS.exclude).toContain("Templates/");
}));
