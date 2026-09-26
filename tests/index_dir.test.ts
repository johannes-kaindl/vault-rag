import { describe, it, expect } from "vitest";
import { isDotPath } from "../src/index_dir";

// normalizeFolder/buildHideCss (bis Welle 11 hier: normalizeIndexDir/buildHideCss) liegen im Kit (folder-hide).
describe("isDotPath", () => {
  it("erkennt Dot-Pfade (Sync ignoriert sie)", () => {
    expect(isDotPath(".vaultrag")).toBe(true);
    expect(isDotPath("  .foo/ ")).toBe(true);
    expect(isDotPath("_vaultrag")).toBe(false);
  });
});
