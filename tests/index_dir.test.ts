import { describe, it, expect } from "vitest";
import { normalizeIndexDir, isDotPath, buildHideCss } from "../src/index_dir";

describe("normalizeIndexDir", () => {
  it("trimmt und entfernt Trailing-Slashes", () => {
    expect(normalizeIndexDir("  _vaultrag/  ")).toBe("_vaultrag");
    expect(normalizeIndexDir("a/b//")).toBe("a/b");
    expect(normalizeIndexDir("_vaultrag")).toBe("_vaultrag");
  });
});

describe("isDotPath", () => {
  it("erkennt Dot-Präfix", () => {
    expect(isDotPath(".vaultrag")).toBe(true);
    expect(isDotPath("  .foo/ ")).toBe(true);
    expect(isDotPath("_vaultrag")).toBe(false);
  });
});

describe("buildHideCss", () => {
  it("hide=false → leerer String", () => {
    expect(buildHideCss("_vaultrag", false)).toBe("");
  });
  it("leerer/whitespace Pfad → leerer String", () => {
    expect(buildHideCss("", true)).toBe("");
    expect(buildHideCss("   ", true)).toBe("");
  });
  it("hide=true → display:none-Regel auf Titel + Kinder", () => {
    const css = buildHideCss("_vaultrag", true);
    expect(css).toContain('.nav-folder-title[data-path="_vaultrag"]');
    expect(css).toContain("+ .nav-folder-children");
    expect(css).toContain("display: none");
    expect(css).not.toContain(":has(");
  });
  it("escapt Sonderzeichen/Leerzeichen via JSON.stringify", () => {
    expect(buildHideCss("99 System/idx", true)).toContain('[data-path="99 System/idx"]');
  });
  it("normalisiert Trailing-Slash im Selektor", () => {
    expect(buildHideCss("_vaultrag/", true)).toContain('[data-path="_vaultrag"]');
  });
});
